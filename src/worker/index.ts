import { parentPort } from "node:worker_threads";
import { posix } from "node:path";
import { inspect } from "node:util";
import vm from "node:vm";
import type {
  ConsoleLogLevel,
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

interface PendingApi {
  options: ApiOptions;
  pageId?: string;
}

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

interface MiniModule {
  exports: unknown;
}

let bundle: MiniAppBundle | null = null;
let appDefinition: Record<string, unknown> = {};
const pageDefinitions = new Map<string, PageDefinition>();
const pageInstances = new Map<string, PageInstance>();
const pendingApis = new Map<string, PendingApi>();
const moduleCache = new Map<string, MiniModule>();
let apiSeq = 0;
let currentRouteForEval = "";
let currentLogPageId: string | undefined;

function post(message: WorkerOutboundMessage): void {
  parentPort?.postMessage(message);
}

function cloneData<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function withLogPage<T>(pageId: string | undefined, callback: () => T): T {
  const previous = currentLogPageId;
  currentLogPageId = pageId;
  try {
    return callback();
  } finally {
    currentLogPageId = previous;
  }
}

function serializeConsoleArg(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return inspect(value, { depth: 5, colors: false, maxArrayLength: 100, breakLength: 120 });
  } catch {
    return String(value);
  }
}

function postLog(level: ConsoleLogLevel, args: unknown[], pageId = currentLogPageId): void {
  post({ type: "log", level, args: args.map(serializeConsoleArg), pageId });
}

const miniConsole: Pick<Console, ConsoleLogLevel> = {
  log: (...args: unknown[]) => postLog("log", args),
  info: (...args: unknown[]) => postLog("info", args),
  warn: (...args: unknown[]) => postLog("warn", args),
  error: (...args: unknown[]) => postLog("error", args),
  debug: (...args: unknown[]) => postLog("debug", args)
};

function miniSetTimeout(callback: (...args: unknown[]) => void, timeout?: number, ...args: unknown[]): ReturnType<typeof setTimeout> {
  const pageId = currentLogPageId;
  return setTimeout(
    () =>
      withLogPage(pageId, () => {
        try {
          callback(...args);
        } catch (error) {
          postLog("error", [error], pageId);
        }
      }),
    timeout
  );
}

function messageLogPageId(message: WorkerInboundMessage): string | undefined {
  if ("pageId" in message) return message.pageId;
  if (message.type === "dom-event") return message.event.pageId;
  if (message.type === "api-response") return pendingApis.get(message.response.id)?.pageId;
  return undefined;
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
    pendingApis.set(id, { options, pageId: currentLogPageId });
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

function createMiniContext(filename: string): vm.Context {
  // Each script runs in a restricted VM context.
  const context = vm.createContext({
    console: miniConsole,
    setTimeout: miniSetTimeout,
    clearTimeout,
    App(definition: Record<string, unknown>) {
      appDefinition = definition;
    },
    Page(definition: PageDefinition) {
      pageDefinitions.set(currentRouteForEval, definition);
    },
    require: createMiniRequire(filename),
    wx: createWxApi()
  });
  return context;
}

function normalizeModulePath(modulePath: string): string {
  return posix.normalize(modulePath.replace(/\\/g, "/"));
}

function assertInsideMiniApp(modulePath: string, request: string, parentFilename: string): void {
  if (modulePath === ".." || modulePath.startsWith("../") || posix.isAbsolute(modulePath)) {
    throw new Error(`Cannot require '${request}' from '${parentFilename}': module must stay inside the mini program root`);
  }
}

function resolveMiniModule(request: string, parentFilename: string): string {
  if (typeof request !== "string") {
    throw new Error(`Cannot require non-string module from '${parentFilename}'`);
  }
  if (!request.startsWith("./") && !request.startsWith("../")) {
    throw new Error(`Cannot require '${request}' from '${parentFilename}': only relative .js modules are supported`);
  }
  if (!bundle) throw new Error("Mini program bundle is not initialized");

  const parentDirectory = posix.dirname(normalizeModulePath(parentFilename));
  const requestedPath = normalizeModulePath(posix.join(parentDirectory, request));
  assertInsideMiniApp(requestedPath, request, parentFilename);

  const candidates = request.endsWith(".js")
    ? [requestedPath]
    : [`${requestedPath}.js`, posix.join(requestedPath, "index.js")];

  for (const candidate of candidates) {
    const modulePath = normalizeModulePath(candidate);
    assertInsideMiniApp(modulePath, request, parentFilename);
    if (bundle.modules[modulePath] !== undefined) return modulePath;
  }

  throw new Error(`Cannot find module '${request}' from '${parentFilename}'`);
}

function createMiniRequire(parentFilename: string): (request: string) => unknown {
  return (request: string) => executeMiniModule(resolveMiniModule(request, parentFilename));
}

function executeMiniModule(modulePath: string): unknown {
  const cached = moduleCache.get(modulePath);
  if (cached) return cached.exports;
  if (!bundle) throw new Error("Mini program bundle is not initialized");

  const source = bundle.modules[modulePath];
  if (source === undefined) throw new Error(`Cannot find module '${modulePath}'`);

  const module: MiniModule = { exports: {} };
  moduleCache.set(modulePath, module);
  evaluateMiniScript(source, modulePath, module);
  return module.exports;
}

function evaluateMiniScript(code: string, filename: string, module: MiniModule = { exports: {} }): unknown {
  const context = createMiniContext(filename);
  const wrapper = vm.runInContext(`(function(require, module, exports) {\n${code}\n})`, context, {
    filename,
    timeout: 1000
  }) as (require: (request: string) => unknown, module: MiniModule, exports: unknown) => void;
  wrapper(createMiniRequire(filename), module, module.exports);
  return module.exports;
}

function initRuntime(nextBundle: MiniAppBundle): void {
  bundle = nextBundle;
  appDefinition = {};
  pageDefinitions.clear();
  moduleCache.clear();
  evaluateMiniScript(nextBundle.appScript, "app.js");
  // Page() registers each page definition against the route currently being evaluated.
  for (const [route, page] of Object.entries(nextBundle.pages)) {
    currentRouteForEval = route;
    evaluateMiniScript(page.script, `${route}.js`);
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
    withLogPage(pageId, () => callback?.());
  };
  pageInstances.set(pageId, instance);
  withLogPage(pageId, () => instance.onLoad?.call(instance, query));
  post({ type: "page-data", patch: { pageId, data: cloneData(instance.data), patch: cloneData(instance.data) } });
}

function handleEvent(event: MiniDomEvent): void {
  const instance = pageInstances.get(event.pageId);
  const handler = instance?.[event.handler];
  if (typeof handler === "function") {
    withLogPage(event.pageId, () => handler.call(instance, {
      type: event.type,
      currentTarget: { dataset: event.dataset },
      target: { dataset: event.dataset },
      detail: event.detail
    }));
  }
}

function handleApiResponse(response: WxApiResponse): void {
  const pending = pendingApis.get(response.id);
  if (!pending) return;
  pendingApis.delete(response.id);
  const { options, pageId } = pending;
  withLogPage(pageId, () => {
    try {
      if (response.ok) options.success?.(response.data);
      else options.fail?.({ errMsg: response.error ?? "api failed" });
      options.complete?.(response.ok ? response.data : { errMsg: response.error ?? "api failed" });
    } catch (error) {
      postLog("error", [error], pageId);
    }
  });
}

parentPort?.on("message", (message: WorkerInboundMessage) => {
  try {
    if (message.type === "init") initRuntime(message.bundle);
    if (message.type === "create-page") createPage(message.pageId, message.route, message.query);
    if (message.type === "show-page") {
      const instance = pageInstances.get(message.pageId);
      withLogPage(message.pageId, () => instance?.onShow?.());
      // onReady 对每个页面实例只执行一次，即使页面被隐藏后再次展示。
      if (instance && !instance.__ready) {
        instance.__ready = true;
        withLogPage(message.pageId, () => instance.onReady?.());
      }
    }
    if (message.type === "hide-page") withLogPage(message.pageId, () => pageInstances.get(message.pageId)?.onHide?.());
    if (message.type === "unload-page") {
      withLogPage(message.pageId, () => pageInstances.get(message.pageId)?.onUnload?.());
      pageInstances.delete(message.pageId);
    }
    if (message.type === "dom-event") handleEvent(message.event);
    if (message.type === "api-response") handleApiResponse(message.response);
  } catch (error) {
    postLog("error", [error], messageLogPageId(message));
  }
});
