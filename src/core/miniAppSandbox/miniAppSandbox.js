import "./style.scss";
import tpl from "./tpl.html";
import { uuid } from "@native/utils/util";
import { AppManager } from "@native/core/appManager/appManager";
import { readFile, mergePageConfig } from "./util";

// 小程序实例
export class MiniAppSandbox {
  constructor(opts) {
    this.appInfo = opts;
    this.id = `ui_view${uuid()}`;
    this.parent = null;
    this.appId = opts.appId;
    this.el = document.createElement("div");
    this.el.classList.add("wx-native-view");
    // 小程序配置信息
    this.appConfig = null;
  }

  viewDidLoad() {
    this.initPageFrame();
    this.showLaunchScreen();
    this.bindCloseEvent();
    this.initApp();
  }

  // 初始化小程序
  async initApp() {
    // 1、读取小程序资源
    // 2、读取配置
    const configPath = `${this.appInfo.appId}/config.json`;
    const configContent = await readFile(configPath);
    this.appConfig = JSON.parse(configContent);

    // 3. 设置状态栏的颜色模式
    const entryPagePath =
      this.appInfo.pagePath || this.appConfig.app.entryPagePath;
    // 根据页面信息配置状态栏颜色
    this.updateTargetPageColorStyle(entryPagePath);
  }

  // 生命周期
  onPresentIn() {
    console.log("MiniAppSandbox：onPresentIn");
  }

  onPresentOut() {
    console.log("MiniAppSandbox：onPresentOut");
  }
  // 初始化容器
  initPageFrame() {
    this.el.innerHTML = tpl;
  }

  // 加载loading页面
  showLaunchScreen() {
    const launchScreen = this.el.querySelector(".wx-mini-app__launch-screen");
    const name = this.el.querySelector(".wx-mini-app__name");
    const logo = this.el.querySelector(".wx-mini-app__logo-img-url");

    this.updateActionColorStyle("black");
    name.innerHTML = this.appInfo.appName;
    logo.src = this.appInfo.logo;
    launchScreen.style.display = "block";
  }

  // 设置指定页面状态栏的颜色模式
  updateTargetPageColorStyle(pagePath) {
    // 获取相关页面的配置
    const pageConfig = this.appConfig.modules[pagePath];
    // 合并配置
    const mergeConfig = mergePageConfig(this.appConfig.app, pageConfig);
    // 得到最终要修改的颜色
    const { navigationBarTextStyle } = mergeConfig;

    this.updateActionColorStyle(navigationBarTextStyle);
  }

  // 更新状态栏颜色
  updateActionColorStyle(color) {
    const action = this.el.querySelector(".wx-mini-app-navigation__actions");

    if (color === "white") {
      action.classList.remove("wx-mini-app-navigation__actions--black");
      action.classList.add("wx-mini-app-navigation__actions--white");
    }

    if (color === "black") {
      action.classList.remove("wx-mini-app-navigation__actions--white");
      action.classList.add("wx-mini-app-navigation__actions--black");
    }

    this.parent.updateStatusBarColor(color);
  }

  // 关闭小程序
  bindCloseEvent() {
    const closeBtn = this.el.querySelector(
      ".wx-mini-app-navigation__actions-close"
    );

    closeBtn.onclick = () => {
      AppManager.closeApp(this);
    };
  }
}
