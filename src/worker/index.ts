import { parentPort } from "node:worker_threads";
import { posix } from "node:path";
import { inspect } from "node:util";
import vm from "node:vm";
import { parseDocument } from "htmlparser2";
import type {
  ComponentSnapshot,
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

type PropertyType = StringConstructor | NumberConstructor | BooleanConstructor | ArrayConstructor | ObjectConstructor | null;
type PropertyDefinition = PropertyType | { type?: PropertyType; value?: unknown };

interface ComponentDefinition {
  properties?: Record<string, PropertyDefinition>;
  data?: MiniData;
  methods?: Record<string, unknown>;
  created?: () => void;
  attached?: () => void;
  ready?: () => void;
  detached?: () => void;
  [key: string]: unknown;
}

interface PageInstance extends PageDefinition {
  __pageId: string;
  __route: string;
  __ready: boolean;
  data: MiniData;
  setData(patch: MiniData, callback?: () => void): void;
}

interface ComponentInstance {
  __id: string;
  __pageId: string;
  __path: string;
  __ready: boolean;
  __eventHandlers: Record<string, string>;
  methods?: Record<string, unknown>;
  created?: () => void;
  attached?: () => void;
  ready?: () => void;
  detached?: () => void;
  properties: MiniData;
  data: MiniData;
  setData(patch: MiniData, callback?: () => void): void;
  triggerEvent(name: string, detail?: unknown): void;
  [key: string]: unknown;
}

interface MiniModule {
  exports: unknown;
}

let bundle: MiniAppBundle | null = null;
let appDefinition: Record<string, unknown> = {};
const pageDefinitions = new Map<string, PageDefinition>();
const pageInstances = new Map<string, PageInstance>();
const componentDefinitions = new Map<string, ComponentDefinition>();
const componentInstances = new Map<string, ComponentInstance>();
const pageComponentIds = new Map<string, Set<string>>();
const pendingApis = new Map<string, PendingApi>();
const moduleCache = new Map<string, MiniModule>();
let apiSeq = 0;
let currentRouteForEval = "";
let currentComponentPathForEval = "";
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

function stripMustache(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("{{") && trimmed.endsWith("}}") ? trimmed.slice(2, -2).trim() : trimmed;
}

function isPureMustache(value: string): boolean {
  const trimmed = value.trim();
  return /^\{\{[\s\S]+?\}\}$/.test(trimmed);
}

function evalInScope(expression: string, scope: MiniData): unknown {
  const body = stripMustache(expression);
  if (!body) return "";
  try {
    return Function("scope", `with(scope){return (${body})}`)(scope);
  } catch {
    return "";
  }
}

function interpolate(value: string, scope: MiniData): string {
  return value.replace(/\{\{([\s\S]+?)\}\}/g, (_match, expression: string) => String(evalInScope(expression, scope) ?? ""));
}

function expressionValue(value: string, scope: MiniData): unknown {
  return isPureMustache(value) ? evalInScope(value, scope) : interpolate(value, scope);
}

function isTruthyExpression(value: string | undefined, scope: MiniData): boolean {
  if (value == null) return false;
  return Boolean(evalInScope(value, scope));
}

function elementAttributes(node: unknown): Record<string, string> {
  const attribs = (node as { attribs?: Record<string, string> }).attribs;
  return attribs ?? {};
}

function elementChildren(node: unknown): unknown[] {
  const children = (node as { children?: unknown[] }).children;
  return children ?? [];
}

function elementName(node: unknown): string {
  return String((node as { name?: string }).name ?? "").toLowerCase();
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
    Component(definition: ComponentDefinition) {
      componentDefinitions.set(currentComponentPathForEval, definition);
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

function defaultPropertyValue(definition: PropertyDefinition | undefined): unknown {
  if (!definition) return undefined;
  if (typeof definition === "function") {
    if (definition === String) return "";
    if (definition === Number) return 0;
    if (definition === Boolean) return false;
    if (definition === Array) return [];
    if (definition === Object) return {};
    return undefined;
  }
  return typeof definition.value === "function" ? (definition.value as () => unknown)() : cloneData(definition.value);
}

function defaultProperties(definition: ComponentDefinition): MiniData {
  const properties: MiniData = {};
  for (const [name, property] of Object.entries(definition.properties ?? {})) {
    const value = defaultPropertyValue(property);
    if (value !== undefined) properties[name] = value;
  }
  return properties;
}

function componentSnapshot(instance: ComponentInstance): ComponentSnapshot {
  return {
    id: instance.__id,
    path: instance.__path,
    properties: cloneData(instance.properties),
    data: cloneData(instance.data)
  };
}

function pageComponentState(pageId: string): Record<string, ComponentSnapshot> {
  const ids = pageComponentIds.get(pageId) ?? new Set<string>();
  const state: Record<string, ComponentSnapshot> = {};
  for (const id of ids) {
    const instance = componentInstances.get(id);
    if (instance) state[id] = componentSnapshot(instance);
  }
  return state;
}

function postPageData(instance: PageInstance, patch: MiniData): void {
  syncComponentsForPage(instance);
  post({
    type: "page-data",
    patch: {
      pageId: instance.__pageId,
      data: cloneData(instance.data),
      patch: cloneData(patch),
      components: pageComponentState(instance.__pageId)
    }
  });
}

function postComponentData(instance: ComponentInstance, patch: MiniData): void {
  const page = pageInstances.get(instance.__pageId);
  if (!page) return;
  post({
    type: "page-data",
    patch: {
      pageId: page.__pageId,
      data: cloneData(page.data),
      patch: cloneData(patch),
      components: pageComponentState(page.__pageId)
    }
  });
}

function createComponentInstance(
  id: string,
  pageId: string,
  componentPath: string,
  properties: MiniData,
  eventHandlers: Record<string, string>
): ComponentInstance {
  const definition = componentDefinitions.get(componentPath) ?? {};
  const instance = Object.assign({}, definition, definition.methods ?? {}) as ComponentInstance;
  instance.__id = id;
  instance.__pageId = pageId;
  instance.__path = componentPath;
  instance.__ready = false;
  instance.__eventHandlers = eventHandlers;
  instance.properties = { ...defaultProperties(definition), ...properties };
  instance.data = cloneData(definition.data ?? {});
  instance.setData = (patch: MiniData, callback?: () => void) => {
    mergeData(instance.data, patch);
    postComponentData(instance, patch);
    withLogPage(pageId, () => callback?.());
  };
  instance.triggerEvent = (name: string, detail?: unknown) => {
    const page = pageInstances.get(pageId);
    if (!page) return;
    const handlerName = instance.__eventHandlers[name];
    const handler = handlerName ? page[handlerName] : undefined;
    if (typeof handler === "function") {
      withLogPage(pageId, () =>
        handler.call(page, {
          type: name,
          currentTarget: { dataset: {} },
          target: { dataset: {} },
          detail
        })
      );
    }
    postComponentData(instance, {});
  };
  componentInstances.set(id, instance);
  withLogPage(pageId, () => instance.created?.call(instance));
  withLogPage(pageId, () => instance.attached?.call(instance));
  return instance;
}

function collectComponentsFromChildren(
  nodes: unknown[],
  page: PageInstance,
  scope: MiniData,
  componentMap: Record<string, string>,
  activeIds: Set<string>,
  pathPrefix: string
): void {
  let conditionalMatched = false;
  let inConditionalChain = false;

  nodes.forEach((child, childIndex) => {
    const nodeType = (child as { type?: string }).type;
    if (nodeType !== "tag") {
      if (nodeType === "text" && String((child as { data?: string }).data ?? "").trim()) {
        inConditionalChain = false;
        conditionalMatched = false;
      }
      return;
    }

    const attrs = elementAttributes(child);
    const hasIf = attrs["wx:if"] !== undefined;
    const hasElif = attrs["wx:elif"] !== undefined;
    const hasElse = attrs["wx:else"] !== undefined;
    let shouldRender = true;

    if (hasIf) {
      inConditionalChain = true;
      conditionalMatched = isTruthyExpression(attrs["wx:if"], scope);
      shouldRender = conditionalMatched;
    } else if (hasElif && inConditionalChain) {
      shouldRender = !conditionalMatched && isTruthyExpression(attrs["wx:elif"], scope);
      conditionalMatched = conditionalMatched || shouldRender;
    } else if (hasElse && inConditionalChain) {
      shouldRender = !conditionalMatched;
      conditionalMatched = true;
    } else {
      inConditionalChain = false;
      conditionalMatched = false;
    }

    if (!shouldRender) return;

    const currentPath = `${pathPrefix}.${childIndex}`;
    const forExpr = attrs["wx:for"];
    if (forExpr) {
      const list = evalInScope(forExpr, scope);
      if (Array.isArray(list)) {
        const itemName = attrs["wx:for-item"] || "item";
        const indexName = attrs["wx:for-index"] || "index";
        list.forEach((item, index) => {
          collectComponentFromElement(child, page, { ...scope, [itemName]: item, [indexName]: index }, componentMap, activeIds, `${currentPath}:${index}`);
        });
      }
      return;
    }

    collectComponentFromElement(child, page, scope, componentMap, activeIds, currentPath);
  });
}

function collectComponentFromElement(
  element: unknown,
  page: PageInstance,
  scope: MiniData,
  componentMap: Record<string, string>,
  activeIds: Set<string>,
  renderPath: string
): void {
  const tagName = elementName(element);
  const componentPath = componentMap[tagName];
  if (componentPath) {
    const id = `${page.__pageId}:component:${renderPath}`;
    const attrs = elementAttributes(element);
    const properties: MiniData = {};
    const eventHandlers: Record<string, string> = {};
    for (const [name, value] of Object.entries(attrs)) {
      const eventMatch = /^(?:bind|catch)(.+)$/.exec(name);
      if (eventMatch) {
        eventHandlers[eventMatch[1]] = value;
        continue;
      }
      if (name.startsWith("wx:") || name.startsWith("data-") || name === "class" || name === "style") continue;
      properties[name] = expressionValue(value, scope);
    }
    const existing = componentInstances.get(id);
    if (existing) {
      existing.properties = { ...defaultProperties(componentDefinitions.get(componentPath) ?? {}), ...properties };
      existing.__eventHandlers = eventHandlers;
    } else {
      createComponentInstance(id, page.__pageId, componentPath, properties, eventHandlers);
    }
    activeIds.add(id);
    return;
  }

  collectComponentsFromChildren(elementChildren(element), page, scope, componentMap, activeIds, renderPath);
}

function syncComponentsForPage(page: PageInstance): void {
  if (!bundle) return;
  const assets = bundle.pages[page.__route];
  if (!assets) return;
  const activeIds = new Set<string>();
  const document = parseDocument(assets.wxml, { lowerCaseAttributeNames: false, lowerCaseTags: false });
  collectComponentsFromChildren(elementChildren(document), page, page.data, assets.components, activeIds, "root");

  const previousIds = pageComponentIds.get(page.__pageId) ?? new Set<string>();
  for (const id of previousIds) {
    if (activeIds.has(id)) continue;
    const instance = componentInstances.get(id);
    if (instance) withLogPage(page.__pageId, () => instance.detached?.call(instance));
    componentInstances.delete(id);
  }
  pageComponentIds.set(page.__pageId, activeIds);
}

function markComponentsReady(pageId: string): void {
  for (const id of pageComponentIds.get(pageId) ?? []) {
    const instance = componentInstances.get(id);
    if (instance && !instance.__ready) {
      instance.__ready = true;
      withLogPage(pageId, () => instance.ready?.call(instance));
    }
  }
}

function initRuntime(nextBundle: MiniAppBundle): void {
  bundle = nextBundle;
  appDefinition = {};
  pageDefinitions.clear();
  componentDefinitions.clear();
  componentInstances.clear();
  pageComponentIds.clear();
  moduleCache.clear();
  evaluateMiniScript(nextBundle.appScript, "app.js");
  for (const [componentPath, component] of Object.entries(nextBundle.components)) {
    currentComponentPathForEval = componentPath;
    evaluateMiniScript(component.script, `${componentPath}.js`);
  }
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
    postPageData(instance, patch);
    withLogPage(pageId, () => callback?.());
  };
  pageInstances.set(pageId, instance);
  withLogPage(pageId, () => instance.onLoad?.call(instance, query));
  postPageData(instance, instance.data);
}

function handleEvent(event: MiniDomEvent): void {
  if (event.componentId) {
    const component = componentInstances.get(event.componentId);
    const handler = component?.[event.handler] ?? component?.methods?.[event.handler];
    if (typeof handler === "function") {
      withLogPage(event.pageId, () =>
        handler.call(component, {
          type: event.type,
          currentTarget: { dataset: event.dataset },
          target: { dataset: event.dataset },
          detail: event.detail
        })
      );
    }
    return;
  }
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
        markComponentsReady(message.pageId);
        withLogPage(message.pageId, () => instance.onReady?.());
      }
    }
    if (message.type === "hide-page") withLogPage(message.pageId, () => pageInstances.get(message.pageId)?.onHide?.());
    if (message.type === "unload-page") {
      withLogPage(message.pageId, () => pageInstances.get(message.pageId)?.onUnload?.());
      for (const id of pageComponentIds.get(message.pageId) ?? []) {
        const component = componentInstances.get(id);
        if (component) withLogPage(message.pageId, () => component.detached?.call(component));
        componentInstances.delete(id);
      }
      pageComponentIds.delete(message.pageId);
      pageInstances.delete(message.pageId);
    }
    if (message.type === "dom-event") handleEvent(message.event);
    if (message.type === "api-response") handleApiResponse(message.response);
  } catch (error) {
    postLog("error", [error], messageLogPageId(message));
  }
});
