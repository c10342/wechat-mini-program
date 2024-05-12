# 模拟微信应用

```javascript
import "./application.scss";
import { uuid, sleep } from "@native/utils/util";

// 模拟微信应用
export class Application {
  constructor() {
    // 组件节点
    this.el = null;
    // 应用页面挂载的节点
    this.window = null;
    // 页面列表
    this.views = [];
    // 根视图(首页)
    this.rootView = null;
    // 父节点，也就是device设备
    this.parent = null;
    // 页面入栈或者出栈，防抖用的
    this.done = true;
    // 初始化
    this.init();
  }

  // 组件初始化
  init() {
    this.el = document.createElement("div");
    this.el.classList.add("wx-application");
    this.window = document.createElement("div");
    this.window.classList.add("wx-native-window");
    this.el.appendChild(this.window);
  }
  // 设置根视图
  initRootView(view) {
    this.rootView = view;
    // 设置父节点
    view.parent = this;
    view.el.classList.add("wx-native-view--instage");
    view.el.style.zIndex = 1;
    this.views.push(view);
    this.window.appendChild(view.el);
    // 初始化页面视图
    view.viewDidLoad && view.viewDidLoad();
  }

  //   应用页面入栈
  async pushView(view) {
    // 防抖
    if (!this.done) {
      return;
    }
    this.done = false;

    // 在视图栈里找到上一个视图(最后一个视图)
    const preView = this.views[this.views.length - 1];

    // 当前视图入栈
    view.parent = this;
    this.views.push(view);
    view.el.style.zIndex = this.views.length;
    view.el.classList.add("wx-native-view--before-enter");
    this.window.appendChild(view.el);
    // 调用生命周期函数
    view.viewDidLoad && view.viewDidLoad();
    await sleep(1);

    // 上一个视图向左动画推出
    preView.el.classList.remove("wx-native-view--instage");
    preView.el.classList.add("wx-native-view--slide-out");
    preView.el.classList.add("wx-native-view--linear-anima");

    // 当前视图向左动画推入
    view.el.classList.add("wx-native-view--enter-anima");
    view.el.classList.add("wx-native-view--instage");
    await sleep(540);
    this.done = true;

    // 动画结束之后移出相关class
    preView.el.classList.remove("wx-native-view--linear-anima");
    view.el.classList.remove("wx-native-view--before-enter");
    view.el.classList.remove("wx-native-view--enter-anima");
    view.el.classList.remove("wx-native-view--instage");
  }
  // 应用页面出栈
  async popView() {
    if (this.views.length < 2) {
      return;
    }

    if (!this.done) {
      return;
    }

    this.done = false;
    // 找到倒数第一和第二个视图
    const preView = this.views[this.views.length - 2];
    const currentView = this.views[this.views.length - 1];
    // 动画
    preView.el.classList.remove("wx-native-view--slide-out");
    preView.el.classList.add("wx-native-view--instage");
    preView.el.classList.add("wx-native-view--enter-anima");

    currentView.el.classList.remove("wx-native-view--instage");
    currentView.el.classList.add("wx-native-view--before-enter");
    currentView.el.classList.add("wx-native-view--enter-anima");

    await sleep(540);
    this.done = true;
    // 删除页面
    this.views.pop();
    // 移除dom元素
    this.window.removeChild(currentView.el);
    // 移除动画
    preView.el.classList.remove("wx-native-view--enter-anima");
  }

  //   小程序实例入栈
  async presentView(view, useCache) {}

  //   小程序实例出栈
  async dismissView(opts = {}) {}

  // 更新手机状态栏
  updateStatusBarColor(color) {
    this.parent.updateDeviceBarColor && this.parent.updateDeviceBarColor(color);
  }
}
```
