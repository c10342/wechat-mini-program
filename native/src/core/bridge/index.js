import { uuid } from "@native/utils/util";
export class Bridge {
  constructor(opts) {
    this.opts = opts;
    this.id = `bridge_${uuid()}`;
    this.webview = null;
    this.jscore = null;
    // 指向小程序实例
    this.parent = null;
  }
}
