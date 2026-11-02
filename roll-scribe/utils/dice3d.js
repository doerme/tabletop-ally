const { createScopedThreejs } = require('../libs/threejs-miniprogram')

const DIE_SIZE = 1
const SPACING = 1.5
const MAX_COLS = 5
const DURATION = 1000 // ms
const FOV = 40
// 镜头朝向（从目标点指向相机）和距离范围：骰子少时拉近放大，多时拉远保证放得下
const VIEW_DIR = [0, 9, 5.2]
const VIEW_TARGET = [0, 0, 0.3]
const MIN_DISTANCE = 5
const MAX_DISTANCE = 10.6
const SAFE_NDC = 0.85 // 骰子在画面中占用的最大范围（-1 ~ 1 坐标）

// 点数 -> 该面在骰子局部坐标中的法向（对面之和为 7）
const FACE_NORMALS = {
  1: [0, 1, 0],
  6: [0, -1, 0],
  2: [1, 0, 0],
  5: [-1, 0, 0],
  3: [0, 0, 1],
  4: [0, 0, -1],
}

// 每个面上点的二维坐标（单位：面宽的比例，中心为 0）
const PIP_LAYOUT = {
  1: [[0, 0]],
  2: [[-0.25, -0.25], [0.25, 0.25]],
  3: [[-0.25, -0.25], [0, 0], [0.25, 0.25]],
  4: [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]],
  5: [[-0.25, -0.25], [0.25, -0.25], [0, 0], [-0.25, 0.25], [0.25, 0.25]],
  6: [[-0.25, -0.27], [0.25, -0.27], [-0.25, 0], [0.25, 0], [-0.25, 0.27], [0.25, 0.27]],
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3)
}

function easeOutBounce(t) {
  const n = 7.5625
  const d = 2.75
  if (t < 1 / d) return n * t * t
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375
  return n * (t -= 2.625 / d) * t + 0.984375
}

function DiceScene(canvas, width, height, pixelRatio) {
  const THREE = createScopedThreejs(canvas)
  this.THREE = THREE
  this.canvas = canvas
  this.dice = []
  this.frameId = null

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(pixelRatio)
  renderer.setSize(width, height, false)
  // 深色桌面衬托白色骰子
  renderer.setClearColor(0x3b4858, 1)
  this.renderer = renderer

  this.scene = new THREE.Scene()
  this.camera = new THREE.PerspectiveCamera(FOV, width / height, 0.1, 100)
  this.viewDistance = MAX_DISTANCE

  // 环境光偏弱、主光偏强，拉开骰子各面的明暗
  this.scene.add(new THREE.AmbientLight(0xffffff, 0.45))
  const light = new THREE.DirectionalLight(0xffffff, 0.85)
  light.position.set(3, 10, 6)
  this.scene.add(light)

  const half = DIE_SIZE / 2
  this.boxGeometry = new THREE.BoxBufferGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE)
  this.boxMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff })
  this.edgeGeometry = new THREE.EdgesGeometry(this.boxGeometry)
  this.edgeMaterial = new THREE.LineBasicMaterial({ color: 0x8a96a3 })
  this.shadowGeometry = new THREE.CircleBufferGeometry(DIE_SIZE * 0.72, 24)
  this.shadowMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 })
  this.pipGeometry = new THREE.CircleBufferGeometry(DIE_SIZE * 0.09, 16)
  this.pipMaterial = new THREE.MeshBasicMaterial({ color: 0x1f2833 })
  this.pipMaterialRed = new THREE.MeshBasicMaterial({ color: 0xd0342c })
  this.shadows = []
  this.half = half
}

// 生成一颗带点的骰子
DiceScene.prototype.createDie = function () {
  const { THREE, half } = this
  const die = new THREE.Group()
  die.add(new THREE.Mesh(this.boxGeometry, this.boxMaterial))
  die.add(new THREE.LineSegments(this.edgeGeometry, this.edgeMaterial))
  const z = new THREE.Vector3(0, 0, 1)
  Object.keys(FACE_NORMALS).forEach((value) => {
    const normal = new THREE.Vector3().fromArray(FACE_NORMALS[value])
    const faceQuat = new THREE.Quaternion().setFromUnitVectors(z, normal)
    const material = value === '1' ? this.pipMaterialRed : this.pipMaterial
    PIP_LAYOUT[value].forEach((uv) => {
      const pip = new THREE.Mesh(this.pipGeometry, material)
      pip.position.set(uv[0] * DIE_SIZE, uv[1] * DIE_SIZE, half + 0.002).applyQuaternion(faceQuat)
      pip.quaternion.copy(faceQuat)
      die.add(pip)
    })
  })
  return die
}

DiceScene.prototype.setCount = function (count) {
  while (this.dice.length < count) {
    const die = this.createDie()
    this.scene.add(die)
    this.dice.push(die)
    const shadow = new this.THREE.Mesh(this.shadowGeometry, this.shadowMaterial)
    shadow.rotation.x = -Math.PI / 2
    this.scene.add(shadow)
    this.shadows.push(shadow)
  }
  this.dice.forEach((die, i) => { die.visible = i < count })
  this.shadows.forEach((shadow, i) => { shadow.visible = i < count })
  this.fitCamera(count)
}

// 从最近距离开始逐步拉远，直到所有骰子都落在画面安全区内
DiceScene.prototype.fitCamera = function (count) {
  const { THREE } = this
  const target = new THREE.Vector3().fromArray(VIEW_TARGET)
  const dir = new THREE.Vector3().fromArray(VIEW_DIR).normalize()
  const signs = [-1, 1]
  const corners = []
  for (let i = 0; i < count; i++) {
    const center = this.targetPosition(i, count)
    signs.forEach((x) => signs.forEach((y) => signs.forEach((z) => {
      corners.push(new THREE.Vector3(x, y, z).multiplyScalar(this.half).add(center))
    })))
  }
  const p = new THREE.Vector3()
  const fits = () => corners.every((c) => {
    p.copy(c).project(this.camera)
    return Math.abs(p.x) <= SAFE_NDC && Math.abs(p.y) <= SAFE_NDC
  })

  let distance = MIN_DISTANCE
  for (;;) {
    this.camera.position.copy(target).addScaledVector(dir, distance)
    this.camera.lookAt(target)
    this.camera.updateMatrixWorld()
    if (distance >= MAX_DISTANCE || fits()) break
    distance = Math.min(MAX_DISTANCE, distance + 0.2)
  }
  this.viewDistance = distance
}

// 地面上的圆形阴影跟随骰子，骰子越高阴影越小
DiceScene.prototype.syncShadows = function () {
  this.dice.forEach((die, i) => {
    const shadow = this.shadows[i]
    const scale = Math.max(0.4, 1 - (die.position.y - this.half) * 0.15)
    shadow.position.set(die.position.x, 0.001, die.position.z)
    shadow.scale.set(scale, scale, 1)
  })
}

// 第 i 颗骰子的落点
DiceScene.prototype.targetPosition = function (i, count) {
  const cols = Math.min(count, MAX_COLS)
  const rows = Math.ceil(count / cols)
  const row = Math.floor(i / cols)
  const inRow = row === rows - 1 ? count - row * cols : cols
  const col = i % cols
  return new this.THREE.Vector3(
    (col - (inRow - 1) / 2) * SPACING,
    this.half,
    (row - (rows - 1) / 2) * SPACING,
  )
}

// 让点数 value 朝上，并随机绕竖直轴旋转
DiceScene.prototype.restQuaternion = function (value) {
  const { THREE } = this
  const up = new THREE.Vector3(0, 1, 0)
  const align = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3().fromArray(FACE_NORMALS[value]), up)
  const yaw = new THREE.Quaternion().setFromAxisAngle(up, (Math.random() - 0.5) * 0.6)
  return yaw.multiply(align)
}

// 静态展示一组点数
DiceScene.prototype.show = function (values) {
  this.stop()
  this.setCount(values.length)
  values.forEach((value, i) => {
    const die = this.dice[i]
    die.position.copy(this.targetPosition(i, values.length))
    die.quaternion.copy(this.restQuaternion(value))
  })
  this.render()
}

// 播放投掷动画，结束后停在 values 对应的点数
DiceScene.prototype.roll = function (values, onDone) {
  const { THREE } = this
  this.stop()
  this.setCount(values.length)
  // 起点高度和后退距离随镜头远近缩放，避免镜头拉近时骰子飞到相机后面
  const camY = this.camera.position.y
  const plans = values.map((value, i) => {
    const end = this.targetPosition(i, values.length)
    const start = new THREE.Vector3(
      end.x + (Math.random() - 0.5) * 2,
      this.half + camY * (0.3 + Math.random() * 0.15),
      end.z - this.viewDistance * (0.2 + Math.random() * 0.1),
    )
    const startQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2,
    ))
    return {
      die: this.dice[i],
      start,
      end,
      startQuat,
      endQuat: this.restQuaternion(value),
      spinAxis: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
      spinAngle: Math.PI * (4 + Math.random() * 4),
    }
  })

  const spin = new THREE.Quaternion()
  const begin = Date.now()
  const tick = () => {
    const t = Math.min(1, (Date.now() - begin) / DURATION)
    const move = easeOutCubic(t)
    const drop = easeOutBounce(t)
    plans.forEach((p) => {
      p.die.position.set(
        p.start.x + (p.end.x - p.start.x) * move,
        p.start.y + (p.end.y - p.start.y) * drop,
        p.start.z + (p.end.z - p.start.z) * move,
      )
      // 额外旋转随时间衰减到 0，保证最终精确落在目标朝向
      spin.setFromAxisAngle(p.spinAxis, p.spinAngle * (1 - move))
      THREE.Quaternion.slerp(p.startQuat, p.endQuat, p.die.quaternion, move)
      p.die.quaternion.premultiply(spin)
    })
    this.render()
    if (t < 1) {
      this.frameId = this.canvas.requestAnimationFrame(tick)
    } else {
      this.frameId = null
      if (onDone) onDone()
    }
  }
  tick()
}

DiceScene.prototype.render = function () {
  this.syncShadows()
  this.renderer.render(this.scene, this.camera)
}

DiceScene.prototype.stop = function () {
  if (this.frameId !== null) {
    this.canvas.cancelAnimationFrame(this.frameId)
    this.frameId = null
  }
}

DiceScene.prototype.dispose = function () {
  this.stop()
  this.boxGeometry.dispose()
  this.boxMaterial.dispose()
  this.edgeGeometry.dispose()
  this.edgeMaterial.dispose()
  this.shadowGeometry.dispose()
  this.shadowMaterial.dispose()
  this.pipGeometry.dispose()
  this.pipMaterial.dispose()
  this.pipMaterialRed.dispose()
  this.renderer.dispose()
}

module.exports = { DiceScene, DURATION }
