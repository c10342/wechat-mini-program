

Page({
  data: {
    from: 'unknown',
    homeCount: 0,
    visitCount: 0,
  },

  onLoad: function (options) {
    console.log('[Detail Page] onLoad', options);
    this.setData({
      from: options.from || 'direct',
      homeCount: options.count || 0,
    });
  },

  onShow: function () {
    console.log('[Detail Page] onShow');
  },

  addVisit: function () {
    var count = this.data.visitCount + 1;
    this.setData({ visitCount: count });
    wx.showToast({
      title: 'Visit #' + count,
      duration: 800,
    });
  },

  goBack: function () {
    wx.navigateBack({ delta: 1 });
  },
});
