import { uuid } from "@native/utils/util";
export class Bridge {
  constructor(opts) {
    this.opts = opts;
    this.id = `bridge_${uuid()}`;
    this.webview = null;
    this.jscore = opts.jscore;
    // 指向小程序实例
    this.parent = null;
    this.jscore.addEventListener(
      "message",
      this.jscoreMessageHandler.bind(this)
    );
    this.jscore.postMessage({
      type: "test",
      body: {
        a: "我是来自Bridge的消息",
      },
    });
  }

  jscoreMessageHandler(msg) {
    console.log("Bridge", msg);
  }
}
