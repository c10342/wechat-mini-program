import "./device.scss";
import tpl from "./device.html";

// 模拟设备
export class Device {
  constructor() {
	// 应用容器
    this.appContainer = null;
    this.root = document.querySelector("#root");
    this.init();
  }

  // 初始化
  init() {
    this.root.innerHTML = tpl;
		this.appContainer = this.root.querySelector('.iphone__apps');
    this.updateDeviceBarColor("black");
  }

  // 原生方法
  // black white，修改app状态栏
  updateDeviceBarColor(color) {
    const statusBar = this.root.querySelector(".iphone__status-bar");
    const homeBar = this.root.querySelector(".iphone__home-touch-bar");

    if (color === "black") {
      statusBar.classList.remove("iphone__status-bar--white");
      statusBar.classList.add("iphone__status-bar--black");

      homeBar.classList.remove("iphone__home-touch-bar--white");
      homeBar.classList.add("iphone__home-touch-bar--black");
    }

    if (color === "white") {
      statusBar.classList.add("iphone__status-bar--white");
      statusBar.classList.remove("iphone__status-bar--black");

      homeBar.classList.add("iphone__home-touch-bar--white");
      homeBar.classList.remove("iphone__home-touch-bar--black");
    }
  }

//   打开应用
  open(app) {
    app.parent = this;
    this.appContainer.appendChild(app.el);
  }
}
