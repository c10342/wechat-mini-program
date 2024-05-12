# 模拟手机设备

```javascript
import "./device.scss";
import tpl from "./device.html";

// 模拟设备
export class Device {
  constructor() {
    // 应用容器
    this.appContainer = null;
    // 根节点
    this.root = document.querySelector("#root");
    this.init();
  }

  // 初始化
  init() {
    // 初始化手机
    this.root.innerHTML = tpl;
    // 初始化应用容器
    this.appContainer = this.root.querySelector(".iphone__apps");
    // 调用原生方法
    this.updateDeviceBarColor("black");
  }

  // 模拟原生方法
  // 修改app状态栏
  updateDeviceBarColor(color) {}

  // 打开应用
  open(app) {
    app.parent = this;
    // 添加应用到手机
    this.appContainer.appendChild(app.el);
  }
}
```
