const { formatTime } = require('../../utils/dice')
const { getRecords } = require('../../utils/storage')

Page({
  data: {
    records: [],
  },

  onShow() {
    const records = getRecords().map((r) => Object.assign({}, r, {
      valuesText: `[${r.values.join(',')}]`,
      timeText: formatTime(r.time),
    }))
    this.setData({ records })
  },
})
