import "./home.scss";
import tpl from "./Home.html";
import { uuid } from "@native/utils/util";
import { MiniAppList } from "@native/pages/miniAppList/miniAppList";

// 微信应用首页

export class Home {
  constructor() {
    // 页面唯一标识
    this.id = `ui_view${uuid()}`;
    // 父节点，也就是application微信应用
    this.parent = null;
    // 组件节点
    this.el = document.createElement("div");
    this.el.classList.add("wx-native-view");
  }

  // 加载视图
  viewDidLoad() {
	// 初始化页面结构
    this.el.innerHTML = tpl;
    this.bindEvent();
  }

  // 绑定相关事件
  bindEvent() {
    const btn = this.el.querySelector(".weixin-app__miniprogram-entry");

    btn.onclick = () => {
      this.jumpToMiniAppListPage();
    };
  }
  // 跳转小程序列表页面
  jumpToMiniAppListPage() {
    const appListPage = new MiniAppList();
	// 调用应用的方法，插入页面
    this.parent.pushView(appListPage);
  }
}
