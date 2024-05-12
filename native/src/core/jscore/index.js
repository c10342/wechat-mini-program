export class JSCore {
  constructor() {
    // 指向小程序容器
    this.parent = null;
    // Worker
    this.worker = null;
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
  }
}
