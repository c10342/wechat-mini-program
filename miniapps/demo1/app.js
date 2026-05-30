App({
  globalData: {
    launchedAt: Date.now(),
    productName: "Mission Desk"
  },
  onLaunch() {
    console.log("Mission Desk launched");
  },
  onShow() {
    console.log("App.onShow");
  },
  onHide() {
    console.log("App.onHide");
  }
});
