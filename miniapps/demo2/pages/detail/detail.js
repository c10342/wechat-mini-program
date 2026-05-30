Page({
  data: {
    taskId: "unknown",
    title: "Task detail",
    localCount: 1
  },
  onLoad(query) {
    this.setData({
      taskId: query.id || "unknown",
      title: "Inspect " + (query.id || "task")
    });
  },
  addLocal() {
    this.setData({ localCount: this.data.localCount + 1 });
  },
  openModal() {
    wx.showModal({
      title: "独立页面",
      content: "这个 modal 由主进程代理执行。"
    });
  },
  back() {
    wx.navigateBack();
  }
});
