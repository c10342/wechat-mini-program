import { queryPath } from "@native/utils/util";
import { getMiniAppInfo } from "@native/services";
import { MiniAppSandbox } from "@native/core/miniAppSandbox/miniAppSandbox";

// 小程序实例管理
export class AppManager {
  // 小程序实例
  static appStack = [];
  // 打开一个小程序实例
  static async openApp(opts, wx) {
    const { appId, path, scene } = opts;
    // 获取路径参数和需要打开的页面
    const { pagePath, query } = queryPath(path);
    // 小程序信息
    const { appName, logo } = await getMiniAppInfo(appId);
    // 创建小程序实例
    const miniApp = new MiniAppSandbox({
      appId,
      scene,
      appName,
      logo,
      pagePath,
      query,
    });

    this.appStack.push(miniApp);
    // 将小程序添加到栈首
    wx.presentView(miniApp, false);
  }

  static closeApp(miniApp) {
    // 关闭小程序实例
    miniApp.parent.dismissView({
      destroy: false,
    });
  }
}
