const utils = require('../../utils')

Page({
  data: {
    draft: "Review container runtime",
    priority: "P1",
    openCount: 2,
    doneCount: 1,
    tasks: [
      { id: "t-101", title: "验证一个页面一个 WebContents", owner: "Runtime", status: "Open", points: 8, done: false },
      { id: "t-102", title: "完善 Worker 与视图层消息桥", owner: "Bridge", status: "Open", points: 5, done: false },
      { id: "t-103", title: "梳理 wx API 示例", owner: "API", status: "Done", points: 3, done: true }
    ],
    capabilities: [
      { id: "binding", name: "数据绑定", copy: "input、列表、条件渲染都由 setData 驱动。" },
      { id: "routing", name: "页面栈", copy: "navigateTo 会创建新的 WebContentsView。" },
      { id: "storage", name: "宿主 API", copy: "storage、modal、systemInfo 通过主进程代理。" }
    ]
  },
  onLoad(query) {
    console.log("index.onLoad", query);
  },
  onShow() {
    console.log("index.onShow");
  },
  onReady() {
    console.log("index.onReady");
  },
  onHide() {
    console.log("index.onHide");
  },
  onUnload() {
    console.log("index.onUnload");
  },
  handleInput(event) {
    this.setData({ draft: event.detail.value });
  },
  refreshMetrics(tasks) {
    var openCount = tasks.filter(function (task) {
      return !task.done;
    }).length;
    var doneCount = tasks.length - openCount;
    this.setData({ openCount: openCount, doneCount: doneCount });
  },
  addTask() {
    var title = this.data.draft || "Untitled task";
    var next = this.data.tasks.concat({
      id: "t-" + Date.now(),
      title: title,
      owner: "You",
      status: "Open",
      points: 2,
      done: false
    });
    this.setData({ tasks: next, draft: "" });
    this.refreshMetrics(next);
    wx.showToast({ title: "任务已添加" });
  },
  saveDraft() {
    wx.setStorage({
      key: "draft",
      data: this.data.draft,
      success: () => wx.showToast({ title: "已写入容器存储" })
    });
  },
  showTip() {
    wx.showToast({ title: "页面运行在独立 WebContents" });
    console.log('showToast');
    utils.setCount()
    
  },
  openTask(event) {
    var taskId = event.currentTarget.dataset.id;
    wx.navigateTo({ url: "pages/detail/detail?id=" + taskId });
  },
  goLogs() {
    wx.reLaunch({ url: "pages/logs/logs" });
  },
  resetTasks() {
    var tasks = [
      { id: "t-101", title: "验证一个页面一个 WebContents", owner: "Runtime", status: "Open", points: 8, done: false },
      { id: "t-102", title: "完善 Worker 与视图层消息桥", owner: "Bridge", status: "Open", points: 5, done: false },
      { id: "t-103", title: "梳理 wx API 示例", owner: "API", status: "Done", points: 3, done: true }
    ];
    this.setData({ tasks: tasks, draft: "Review container runtime" });
    this.refreshMetrics(tasks);
  },
  selectCapability(event) {
    wx.showToast({ title: "能力：" + event.currentTarget.dataset.id });
  }
});
