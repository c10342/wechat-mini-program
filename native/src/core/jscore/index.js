import mitt from "mitt";


export class JSCore {
  constructor() {
    // 指向小程序容器
    this.parent = null;
    // Worker
    this.worker = null;
    this.event = mitt()
  }

  async init() {
    // 获取逻辑线程的内容
    const jsContent = await fetch("http://127.0.0.1:3100/logic/core.js");
    const codeString = await jsContent.text();
    const jsBlob = new Blob([codeString], {
      type: "application/javascript",
    });
    const urlObj = window.URL.createObjectURL(jsBlob);
    this.worker = new Worker(urlObj);
    this.worker.addEventListener("message", (e) => {
      this.event.emit("message", e.data);
    });
  }
// 监听消息
  addEventListener(type, handler) {
    this.event.on(type, handler);
  }
// 发送消息
  postMessage(msg) {
    this.worker.postMessage(msg);
  }
}
