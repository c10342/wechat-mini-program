import { parentPort } from "node:worker_threads";
import vm from "node:vm";
import type {
  MiniAppBundle,
  MiniData,
  MiniDomEvent,
  RouteAction,
  WorkerInboundMessage,
  WorkerOutboundMessage,
  WxApiRequest,
  WxApiResponse
} from "../shared/types";

type MiniCallback = (result?: unknown) => void;
type ApiOptions = Record<string, unknown> & { success?: MiniCallback; fail?: MiniCallback; complete?: MiniCallback };

interface PageDefinition {
  data?: MiniData;
  onLoad?: (query: Record<string, string>) => void;
  onShow?: () => void;
  onReady?: () => void;
  onHide?: () => void;
  onUnload?: () => void;
  [key: string]: unknown;
}

interface PageInstance extends PageDefinition {
  __pageId: string;
  __route: string;
  __ready: boolean;
  data: MiniData;
  setData(patch: MiniData, callback?: () => void): void;
}

let bundle: MiniAppBundle | null = null;
let appDefinition: Record<string, unknown> = {};
const pageDefinitions = new Map<string, PageDefinition>();
const pageInstances = new Map<string, PageInstance>();
const pendingApis = new Map<string, ApiOptions>();
let apiSeq = 0;
let currentRouteForEval = "";

function post(message: WorkerOutboundMessage): void {
  parentPort?.postMessage(message);
}

function cloneData<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function setByPath(target: MiniData, path: string, value: unknown): void {
  // 支持小程序 setData 路径写法，例如 "user.name" 和 "items[0].done"。
  const segments = path.replace(/\[(\d+)\]/g, ".$1").split(".");
  let cursor: Record<string, unknown> = target;
  for (let index = 0; index < segments.length - 1; index++) {
    const key = segments[index];
    if (typeof cursor[key] !== "object" || cursor[key] === null) cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[segments.at(-1)!] = value;
}

function mergeData(target: MiniData, patch: MiniData): void {
  for (const [key, value] of Object.entries(patch)) {
    if (key.includes(".") || key.includes("[")) setByPath(target, key, value);
    else target[key] = value;
  }
}

function createWxApi() {
  const route = (action: RouteAction) => post({ type: "route", action });
  const callHost = (name: WxApiRequest["name"], options: ApiOptions = {}) => {
    // 由宿主实现的 wx API 都是异步的，主进程返回后再恢复回调。
    const id = `api-${++apiSeq}`;
    pendingApis.set(id, options);
    const { success: _success, fail: _fail, complete: _complete, ...payload } = options;
    post({ type: "host-api", request: { id, name, payload } });
  };

  return {
    navigateTo: (options: { url: string }) => route({ type: "navigateTo", url: options.url }),
    redirectTo: (options: { url: string }) => route({ type: "redirectTo", url: options.url }),
    navigateBack: (options: { delta?: number } = {}) => route({ type: "navigateBack", delta: options.delta }),
    switchTab: (options: { url: string }) => route({ type: "switchTab", url: options.url }),
    reLaunch: (options: { url: string }) => route({ type: "reLaunch", url: options.url }),
    showToast: (options: ApiOptions = {}) => callHost("showToast", options),
    hideToast: (options: ApiOptions = {}) => callHost("hideToast", options),
    showLoading: (options: ApiOptions = {}) => callHost("showLoading", options),
    hideLoading: (options: ApiOptions = {}) => callHost("hideLoading", options),
    showModal: (options: ApiOptions = {}) => callHost("showModal", options),
    setStorage: (options: ApiOptions = {}) => callHost("setStorage", options),
    getStorage: (options: ApiOptions = {}) => callHost("getStorage", options),
    removeStorage: (options: ApiOptions = {}) => callHost("removeStorage", options),
    clearStorage: (options: ApiOptions = {}) => callHost("clearStorage", options),
    request: (options: ApiOptions = {}) => callHost("request", options),
    getSystemInfo: (options: ApiOptions = {}) => callHost("getSystemInfo", options),
    setStorageSync: (key: string, data: unknown) => callHost("setStorage", { key, data }),
    getStorageSync: () => undefined,
    getSystemInfoSync: () => ({ platform: "electron" })
  };
}

function evaluateMiniScript(code: string, filename: string): void {
  // 每个脚本都在受限 VM 上下文里注册 App/Page 定义。
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    App(definition: Record<string, unknown>) {
      appDefinition = definition;
    },
    Page(definition: PageDefinition) {
      pageDefinitions.set(currentRouteForEval, definition);
    },
    wx: createWxApi()
  });
  vm.runInContext(code, context, { filename, timeout: 1000 });
}

function initRuntime(nextBundle: MiniAppBundle): void {
  bundle = nextBundle;
  evaluateMiniScript(nextBundle.appScript, "app.ts");
  // 执行页面脚本时，Page() 会按 currentRouteForEval 记录对应页面定义。
  for (const [route, page] of Object.entries(nextBundle.pages)) {
    currentRouteForEval = route;
    evaluateMiniScript(page.script, `${route}.ts`);
  }
  (appDefinition.onLaunch as (() => void) | undefined)?.call(appDefinition);
  (appDefinition.onShow as (() => void) | undefined)?.call(appDefinition);
  post({ type: "ready" });
}

function createPage(pageId: string, route: string, query: Record<string, string>): void {
  const definition = pageDefinitions.get(route) ?? {};
  const instance = Object.assign({}, definition) as PageInstance;
  instance.__pageId = pageId;
  instance.__route = route;
  instance.__ready = false;
  instance.data = cloneData(definition.data ?? {});
  instance.setData = (patch: MiniData, callback?: () => void) => {
    // Worker 持有页面权威数据，并把完整数据和本次 patch 一起发给视图层。
    mergeData(instance.data, patch);
    post({ type: "page-data", patch: { pageId, data: cloneData(instance.data), patch: cloneData(patch) } });
    callback?.();
  };
  pageInstances.set(pageId, instance);
  instance.onLoad?.call(instance, query);
  post({ type: "page-data", patch: { pageId, data: cloneData(instance.data), patch: cloneData(instance.data) } });
}

function handleEvent(event: MiniDomEvent): void {
  const instance = pageInstances.get(event.pageId);
  const handler = instance?.[event.handler];
  if (typeof handler === "function") {
    handler.call(instance, {
      type: event.type,
      currentTarget: { dataset: event.dataset },
      target: { dataset: event.dataset },
      detail: event.detail
    });
  }
}

function handleApiResponse(response: WxApiResponse): void {
  const options = pendingApis.get(response.id);
  if (!options) return;
  pendingApis.delete(response.id);
  if (response.ok) options.success?.(response.data);
  else options.fail?.({ errMsg: response.error ?? "api failed" });
  options.complete?.(response.ok ? response.data : { errMsg: response.error ?? "api failed" });
}

parentPort?.on("message", (message: WorkerInboundMessage) => {
  try {
    if (message.type === "init") initRuntime(message.bundle);
    if (message.type === "create-page") createPage(message.pageId, message.route, message.query);
    if (message.type === "show-page") {
      const instance = pageInstances.get(message.pageId);
      instance?.onShow?.();
      // onReady 对每个页面实例只执行一次，即使页面被隐藏后再次展示。
      if (instance && !instance.__ready) {
        instance.__ready = true;
        instance.onReady?.();
      }
    }
    if (message.type === "hide-page") pageInstances.get(message.pageId)?.onHide?.();
    if (message.type === "unload-page") {
      pageInstances.get(message.pageId)?.onUnload?.();
      pageInstances.delete(message.pageId);
    }
    if (message.type === "dom-event") handleEvent(message.event);
    if (message.type === "api-response") handleApiResponse(message.response);
  } catch (error) {
    post({ type: "log", level: "error", message: error instanceof Error ? error.stack ?? error.message : String(error) });
  }
});
