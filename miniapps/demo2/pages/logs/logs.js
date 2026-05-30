Page({
  data: {
    draft: "尚未读取",
    system: "尚未读取",
    requestState: "尚未请求"
  },
  readDraft() {
    wx.getStorage({
      key: "draft",
      success: (res) => this.setData({ draft: res.data || "空字符串" }),
      fail: () => this.setData({ draft: "没有存储值" })
    });
  },
  readSystem() {
    wx.getSystemInfo({
      success: (res) => this.setData({ system: res.platform + " / " + res.windowWidth + "x" + res.windowHeight })
    });
  },
  fakeRequest() {
    this.setData({ requestState: "请求中..." });
    wx.request({
      url: "https://httpbin.org/json",
      success: (res) => this.setData({ requestState: "HTTP " + res.statusCode }),
      fail: () => this.setData({ requestState: "请求失败，可检查网络" })
    });
  },
  home() {
    wx.reLaunch({ url: "pages/index/index" });
  }
});
