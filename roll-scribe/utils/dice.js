const MIN_COUNT = 1
const MAX_COUNT = 10
const NAME_MAX_LENGTH = 20

function clampCount(value) {
  const n = parseInt(value, 10)
  if (Number.isNaN(n)) return MIN_COUNT
  return Math.min(MAX_COUNT, Math.max(MIN_COUNT, n))
}

// 单颗六面骰，[1,6] 均匀随机
function rollD6() {
  return Math.floor(Math.random() * 6) + 1
}

function rollDice(count) {
  const n = clampCount(count)
  const values = []
  for (let i = 0; i < n; i++) values.push(rollD6())
  const total = values.reduce((sum, v) => sum + v, 0)
  return { count: n, values, total }
}

function pad(n) {
  return n < 10 ? `0${n}` : `${n}`
}

// 2026-11-02 22:30
function formatTime(ts) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

module.exports = {
  MIN_COUNT,
  MAX_COUNT,
  NAME_MAX_LENGTH,
  clampCount,
  rollDice,
  formatTime,
}
