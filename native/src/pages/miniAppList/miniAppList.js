import "./style.scss";
import tpl from "./miniAppList.html";
import { uuid, closest } from "@native/utils/util";
import { AppManager } from "../../core/appManager/appManager";

// 微信应用小程序列表页

const appList = [
  {
    appId: "douyin",
    name: "抖音",
    logo: "https://img.zcool.cn/community/0173a75b29b349a80121bbec24c9fd.jpg@1280w_1l_2o_100sh.jpg",
    path: "pages/home/index?param1=参数1&param2=参数2",
  },

  {
    appId: "meituan",
    name: "美团",
    logo: "https://s3plus.meituan.net/v1/mss_e2821d7f0cfe4ac1bf9202ecf9590e67/cdn-prod/file:9528bfdf/20201023%E7%94%A8%E6%88%B7%E6%9C%8D%E5%8A%A1logo/%E7%BE%8E%E5%9B%A2app.png",
    path: "pages/home/index?param1=参数1&param2=参数2",
  },

  {
    appId: "jingdong",
    name: "京东",
    logo: "https://ts1.cn.mm.bing.net/th/id/R-C.8e130498abf4685d15ecb977869a5a39?rik=%2f%2bLRdQM48y8y0A&riu=http%3a%2f%2fwww.xiue.cc%2fwp-content%2fuploads%2f2017%2f09%2fjd.jpg&ehk=hUzDTV9xjw%2flaGD5eZcKGl%2fN7UkzBSHRjo73I%2bMeVvo%3d&risl=&pid=ImgRaw&r=0",
    path: "pages/home/index?param1=参数1&param2=参数2",
  },
];

export class MiniAppList {
  constructor() {
    this.id = `ui_view${uuid()}`;
    // 微信应用
    this.parent = null;
    this.el = document.createElement("div");
    this.el.classList.add("wx-native-view");
  }

  // 页面视图加载
  viewDidLoad() {
    this.el.innerHTML = tpl;
    this.createAppList();
    this.bindReturnEvent();
    this.bindOpenMiniApp();
  }

  // 创建小程序列表
  createAppList() {
    const list = this.el.querySelector(".weixin-app__mini-used-list");

    appList.forEach((appInfo) => {
      const item = `
				<li class="weixin-app__mini-used-list-item" data-appid="${appInfo.appId}">
					<div class="weixin-app__mini-used-logo">
						<img src="${appInfo.logo}" alt="">
					</div>
					<p class="weixin-app__mini-used-name">${appInfo.name}</p>
				</li>
			`;
      const temp = document.createElement("div");

      temp.innerHTML = item;
      list.appendChild(temp.children[0]);
    });
  }

  // 返回上一个页面
  bindReturnEvent() {
    const backBtn = this.el.querySelector(".weixin-app-navigation__left-btn");

    backBtn.onclick = () => {
      this.parent.popView();
    };
  }

  // 点击打开微信小程序
  bindOpenMiniApp() {
    const appList = this.el.querySelector(".weixin-app__mini-used-list");

    appList.onclick = (e) => {
      const app = closest(e.target, "weixin-app__mini-used-list-item");

      if (!app) {
        return;
      }
      // 获取appid
      const appId = app.getAttribute("data-appid");
      // 获取小程序信息
      const appInfo = this.getAppInfoByAppId(appId);

      if (!appInfo) {
        return;
      }
      // 打开一个小程序容器实例
      AppManager.openApp(
        {
          appId,
          path: appInfo.path,
          scene: 1001,
        },
        this.parent
      );
    };
  }

  // 根据appid获取小程序信息
  getAppInfoByAppId(appId) {
    for (let i = 0; i < appList.length; i++) {
      if (appList[i].appId === appId) {
        return appList[i];
      }
    }

    return null;
  }

  //   生命周期
  // 离开页面
  onPresentOut() {
    console.log("MiniAppList：onPresentOut");
  }
  // 进入页面
  onPresentIn() {
    console.log("MiniAppList：onPresentIn");
    this.parent.updateStatusBarColor("black");
  }
}
