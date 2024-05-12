import mitt from "mitt";
// 接受原生层的消息/向原生层发送消息
class Message {
  constructor() {
    this.event = mitt();
    this.init();
  }

  init() {
    // 监听原生层的消息
    globalThis.addEventListener("message", (e) => {
      const { type, body } = e.data;
      this.event.emit(type, body);
    });
  }

  //   接受原生层的消息
  receive(type, callback) {
    this.event.on(type, callback);
  }

  //   发送消息给原生层
  send(msg) {
    globalThis.postMessage(msg);
  }
}

export default new Message();
