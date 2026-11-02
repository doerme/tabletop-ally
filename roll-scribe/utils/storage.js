const KEY = 'roll_records'
const MAX_RECORDS = 100

// 读取记录（最新在前），异常时静默返回空列表
function getRecords() {
  try {
    const list = wx.getStorageSync(KEY)
    return Array.isArray(list) ? list : []
  } catch (e) {
    return []
  }
}

// 新记录插入头部，超过上限丢弃最早的记录
function addRecord(record) {
  const list = [record].concat(getRecords()).slice(0, MAX_RECORDS)
  try {
    wx.setStorageSync(KEY, list)
  } catch (e) {
    // 缓存写入失败静默容错
  }
  return list
}

const PLAYERS_KEY = 'roll_players'

// 玩家列表（昵称数组），异常时静默返回空列表
function getPlayers() {
  try {
    const list = wx.getStorageSync(PLAYERS_KEY)
    return Array.isArray(list) ? list : []
  } catch (e) {
    return []
  }
}

function savePlayers(list) {
  try {
    wx.setStorageSync(PLAYERS_KEY, list)
  } catch (e) {
    // 缓存写入失败静默容错
  }
}

module.exports = {
  MAX_RECORDS,
  getRecords,
  addRecord,
  getPlayers,
  savePlayers,
}
