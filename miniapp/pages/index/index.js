



Page({
  data: {
    motto: 'Hello MiniApp!',
    subtitle: 'Dual-Thread Architecture Demo',
    count: 0,
    clickCount: 0,
    platform: 'Electron',
    version: '1.0.0',
  },

  onLoad: function () {
    console.log('[Index Page] onLoad');
    var sysInfo = wx.getSystemInfoSync();
    this.setData({
      platform: sysInfo.platform,
    });
  },

  onShow: function () {
    console.log('[Index Page] onShow');
  },

  increment: function () {
    var newCount = this.data.count + 1;
    var newClickCount = this.data.clickCount + 1;
    this.setData({
      count: newCount,
      clickCount: newClickCount,
    });
  },

  decrement: function () {
    var newCount = this.data.count - 1;
    var newClickCount = this.data.clickCount + 1;
    this.setData({
      count: newCount,
      clickCount: newClickCount,
    });
  },

  reset: function () {
    this.setData({
      count: 0,
      clickCount: 0,
    });
    wx.showToast({
      title: 'Reset!',
      duration: 1000,
    });
  },

  showNotification: function () {
    wx.showNotification({
      title: 'MiniApp Notification',
      body: 'This is a desktop notification from your mini program!',
      tag: 'demo-notification',
      success: function () {
        console.log('[Index Page] Notification sent');
      },
    });
  },

  chooseFile: function () {
    var that = this;
    wx.chooseFile({
      title: 'Choose a File',
      filters: [
        { name: 'Images', extensions: ['jpg', 'png', 'gif'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      success: function (res) {
        console.log('[Index Page] Files selected:', res.filePaths);
        that.setData({
          selectedFile: res.filePaths[0] || '',
        });
      },
      fail: function (err) {
        console.log('[Index Page] File selection cancelled');
      },
    });
  },

  goToDetail: function () {
    wx.navigateTo({
      url: '/pages/detail/index?from=home&count=' + this.data.count,
    });
  },
});
