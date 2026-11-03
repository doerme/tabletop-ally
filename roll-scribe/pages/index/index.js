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
    players: [], // [{ name, last, counters, nextCounterId }]
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
      players: names.map((name) => ({
        name,
        last: '',
        counters: [{ id: 1, name: '计数1', value: 0 }],
        nextCounterId: 2,
      })),
    }, () => this.initScene())
  },

  // ---------- 玩家计数 ----------
  addCounter(e) {
    const { playerIndex } = e.currentTarget.dataset
    const player = this.data.players[playerIndex]
    if (!player) return
    const id = player.nextCounterId
    this.setData({
      [`players[${playerIndex}].counters`]: player.counters.concat({
        id, name: `计数${id}`, value: 0,
      }),
      [`players[${playerIndex}].nextCounterId`]: id + 1,
    })
  },

  getCounterTarget(e) {
    const { playerIndex, counterId } = e.currentTarget.dataset
    const player = this.data.players[playerIndex]
    if (!player) return null
    const counterIndex = player.counters.findIndex((counter) => counter.id === Number(counterId))
    if (counterIndex < 0) return null
    return {
      player,
      counter: player.counters[counterIndex],
      path: `players[${playerIndex}].counters[${counterIndex}]`,
      playerIndex,
    }
  },

  changeCounter(e) {
    const target = this.getCounterTarget(e)
    if (!target) return
    const delta = Number(e.currentTarget.dataset.delta)
    if (delta !== 1 && delta !== -1) return
    const value = Math.max(0, target.counter.value + delta)
    if (!Number.isSafeInteger(value)) return
    this.setData({ [`${target.path}.value`]: value })
  },

  onCounterNameInput(e) {
    const target = this.getCounterTarget(e)
    if (!target) return
    this.setData({ [`${target.path}.name`]: e.detail.value.slice(0, 20) })
  },

  onCounterNameBlur(e) {
    const target = this.getCounterTarget(e)
    if (!target) return
    const name = e.detail.value.slice(0, 20).trim() || `计数${target.counter.id}`
    this.setData({ [`${target.path}.name`]: name })
  },

  removeCounter(e) {
    const target = this.getCounterTarget(e)
    if (!target || target.player.counters.length <= 1) return
    this.setData({
      [`players[${target.playerIndex}].counters`]: target.player.counters.filter(
        (counter) => counter.id !== target.counter.id,
      ),
    })
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
