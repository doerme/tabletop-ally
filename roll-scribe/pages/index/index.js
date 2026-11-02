const {
  MIN_COUNT, MAX_COUNT, NAME_MAX_LENGTH, clampCount, rollDice, formatTime,
} = require('../../utils/dice')
const { addRecord, getPlayers, savePlayers } = require('../../utils/storage')
const { DiceScene } = require('../../utils/dice3d')

const MIN_PLAYERS = 1
const MAX_PLAYERS = 10

function clampPlayers(n) {
  return Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, n))
}

function getPixelRatio() {
  try {
    return (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).pixelRatio || 2
  } catch (e) {
    return 2
  }
}

Page({
  data: {
    stage: 'setup', // setup | play
    playerCount: 2,
    names: ['', ''],
    players: [], // [{ name, last }]
    count: 1,
    minCount: MIN_COUNT,
    maxCount: MAX_COUNT,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    nameMaxLength: NAME_MAX_LENGTH,
    rollingName: '',
    result: null,
  },

  onLoad() {
    const saved = getPlayers()
    if (saved.length) {
      this.setData({ playerCount: saved.length, names: saved.slice() })
      this.enterPlay(saved)
    }
  },

  onUnload() {
    this.destroyScene()
  },

  // ---------- 设置人数 ----------
  resizeNames(n) {
    const names = this.data.names.slice(0, n)
    while (names.length < n) names.push('')
    this.setData({ playerCount: n, names })
  },

  decreasePlayers() {
    this.resizeNames(clampPlayers(this.data.playerCount - 1))
  },

  increasePlayers() {
    this.resizeNames(clampPlayers(this.data.playerCount + 1))
  },

  onNameInput(e) {
    // 直接写入 data，避免每次输入触发重渲染
    this.data.names[e.currentTarget.dataset.index] = e.detail.value
  },

  startPlay() {
    const names = this.data.names.map((n, i) => n.trim() || `玩家${i + 1}`)
    if (new Set(names).size !== names.length) {
      wx.showToast({ title: '昵称不能重复', icon: 'none' })
      return
    }
    savePlayers(names)
    this.enterPlay(names)
  },

  backToSetup() {
    if (this.data.rollingName) return
    this.destroyScene()
    this.setData({ stage: 'setup', result: null })
  },

  enterPlay(names) {
    this.setData({
      stage: 'play',
      players: names.map((name) => ({ name, last: '' })),
    }, () => this.initScene())
  },

  // ---------- 3D 场景 ----------
  initScene() {
    wx.createSelectorQuery()
      .select('#dice3d')
      .fields({ node: true, size: true })
      .exec((res) => {
        const info = res && res[0]
        if (!info || !info.node) return
        try {
          this.diceScene = new DiceScene(info.node, info.width, info.height, getPixelRatio())
          const values = this.data.result ? this.data.result.values : []
          this.diceScene.show(values.length ? values : Array(clampCount(this.data.count)).fill(6))
        } catch (e) {
          // WebGL 不可用时退化为无动画
          this.diceScene = null
        }
      })
  },

  destroyScene() {
    if (this.diceScene) {
      this.diceScene.dispose()
      this.diceScene = null
    }
  },

  // ---------- 投掷 ----------
  setCount(count) {
    this.setData({ count })
    if (this.diceScene && !this.data.rollingName) this.diceScene.show(Array(count).fill(6))
  },

  decrease() {
    this.setCount(clampCount(this.data.count - 1))
  },

  increase() {
    this.setCount(clampCount(this.data.count + 1))
  },

  onRoll(e) {
    if (this.data.rollingName) return
    const { name } = e.currentTarget.dataset
    const { count } = this.data
    // 结果在动画开始前确定并保存，动画只负责展示
    const { values, total } = rollDice(count)
    const time = Date.now()
    const record = {
      id: `${time}-${Math.floor(Math.random() * 1e6)}`,
      name,
      count,
      values,
      total,
      time,
    }
    addRecord(record)
    this.setData({ rollingName: name })

    const finish = () => {
      const players = this.data.players.map((p) => (
        p.name === name ? Object.assign({}, p, { last: `[${values.join(',')}] = ${total}` }) : p
      ))
      this.setData({
        players,
        rollingName: '',
        result: Object.assign({}, record, { valuesText: values.join(','), timeText: formatTime(time) }),
      })
    }
    if (this.diceScene) {
      this.diceScene.roll(values, finish)
    } else {
      finish()
    }
  },

  goHistory() {
    wx.navigateTo({ url: '/pages/history/history' })
  },
})
