import { BrowserWindow, dialog, ipcMain, screen, WebContentsView, type BrowserWindowConstructorOptions, type IpcMainEvent } from "electron";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { loadMiniApp } from "./mini-app-loader";
import { parseMiniUrl, routeTitle } from "./route";
import type {
  MiniAppBundle,
  MiniDomEvent,
  PageAssets,
  PageInboundMessage,
  PageOutboundMessage,
  RouteAction,
  RouteRecord,
  WorkerInboundMessage,
  WorkerOutboundMessage,
  WindowControlAction,
  WxApiRequest,
  WxApiResponse
} from "../shared/types";

const ELECTRON_ROOT = join(__dirname, "..");
const RENDERER_ROOT = join(__dirname, "..", "..", "renderer");
// 以 appId 作为进程内单例键，避免同一个小程序被重复打开。
const activeContainers = new Map<string, MiniProgramContainer>();

interface PageViewRecord {
  route: RouteRecord;
  view: WebContentsView;
  assets: PageAssets;
  data: Record<string, unknown>;
}

/**
 * 在一个 BrowserWindow 内承载一个小程序运行时。
 * 页面 UI 运行在 WebContentsView 中，App/Page 逻辑运行在 Worker 中。
 */
export interface MiniProgramContainerOptions {
  appRoot: string;
  windowOptions?: BrowserWindowConstructorOptions;
  hostHeight?: number;
  preloadPath?: string;
  workerPath?: string;
}

export class MiniProgramContainer {
  // 小程序窗口
  readonly window: BrowserWindow;
  // 小程序代码存放的路径
  private readonly appRoot: string;
  // 固定在宿主顶部栏高度，也就是标题栏/窗口控制栏占用的顶部；小程序页面内容会从这个高度以下开始
  private readonly hostHeight: number;
  private readonly preloadPath: string;
  // js运行在worker中
  private readonly workerPath: string;
  private appId: string | null = null;
  // 标题栏/窗口控制栏
  private hostView: WebContentsView | null = null;
  private hostOverlayHeight = 0;
  private runtimeWorker: Worker | null = null;
  private bundle: MiniAppBundle | null = null;
  private pageSeq = 0;
  // 对应小程序页面栈；被覆盖的页面会保活，直到路由把它移除。
  private readonly pageStack: PageViewRecord[] = [];
  private readonly storage = new Map<string, unknown>();
  private readonly ipcHandler = (event: IpcMainEvent, message: PageOutboundMessage) => this.handlePageMessage(event, message);
  private readonly windowControlHandler = (event: IpcMainEvent, action: WindowControlAction) => this.handleWindowControl(event, action);

  constructor(options: MiniProgramContainerOptions) {
    this.appRoot = options.appRoot;
    this.hostHeight = options.hostHeight ?? 58;
    this.preloadPath = options.preloadPath ?? join(ELECTRON_ROOT, "preload", "index.js");
    this.workerPath = options.workerPath ?? join(ELECTRON_ROOT, "worker", "index.js");
    this.window = new BrowserWindow({
      width: 420,
      height: 820,
      minWidth: 360,
      minHeight: 640,
      title: "Mini Program Container",
      backgroundColor: "#f6f3ea",
      ...options.windowOptions,
      frame: false,
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        ...options.windowOptions?.webPreferences
      }
    });
  }

  get id(): string | null {
    return this.appId;
  }

  private get ipcNamespace(): string {
    if (!this.appId) throw new Error("MiniProgramContainer has not been mounted.");
    return `mini-program:${encodeURIComponent(this.appId)}`;
  }

  private get pageMessageChannel(): string {
    return `${this.ipcNamespace}:page-message`;
  }

  private get windowControlChannel(): string {
    return `${this.ipcNamespace}:window-control`;
  }

  async mount(): Promise<void> {
    // 先加载 app/page 资源，让配置错误在创建视图前尽早暴露。
    this.bundle = await loadMiniApp(this.appRoot);
    const appId = this.bundle.appConfig.appId;
    if (!appId) {
      this.window.close();
      throw new Error("Mini program app.json must provide a unique appId.");
    }
    // 同 appId 的容器已经存在时，唤起旧窗口并关闭当前新建窗口。
    const existing = activeContainers.get(appId);
    if (existing && existing !== this) {
      existing.window.show();
      existing.window.focus();
      this.window.close();
      throw new Error(`Mini program already running: ${appId}`);
    }
    this.appId = appId;
    activeContainers.set(appId, this);

    const backgroundColor = this.bundle.appConfig.window?.backgroundColor;
    if (backgroundColor) this.window.setBackgroundColor(backgroundColor);
    this.bindIpc();
    await this.createHostView();
    this.createWorker();
    this.window.on("resize", this.layoutViews);
    this.window.on("maximize", this.sendWindowState);
    this.window.on("unmaximize", this.sendWindowState);
    this.window.on("restore", this.sendWindowState);
    this.window.on("closed", this.destroy);
    await this.pushPage(this.bundle.appConfig.pages[0]);
  }

  destroy = (): void => {
    if (this.appId) {
      ipcMain.off(this.pageMessageChannel, this.ipcHandler);
      ipcMain.off(this.windowControlChannel, this.windowControlHandler);
      if (activeContainers.get(this.appId) === this) activeContainers.delete(this.appId);
    }
    this.window.off("resize", this.layoutViews);
    this.window.off("maximize", this.sendWindowState);
    this.window.off("unmaximize", this.sendWindowState);
    this.window.off("restore", this.sendWindowState);
    this.window.off("closed", this.destroy);
    while (this.pageStack.length) {
      const page = this.pageStack.pop()!;
      if (!page.view.webContents.isDestroyed()) page.view.webContents.close();
    }
    this.runtimeWorker?.terminate();
    this.runtimeWorker = null;
    this.hostView = null;
    this.appId = null;
  };

  getRoutes(): RouteRecord[] {
    return this.pageStack.map((page) => page.route);
  }

  async navigateTo(url: string): Promise<void> {
    await this.pushPage(url);
  }

  async redirectTo(url: string): Promise<void> {
    await this.replacePage(url);
  }

  async reLaunch(url: string): Promise<void> {
    await this.relaunch(url);
  }

  navigateBack(delta = 1): void {
    const count = Math.max(1, delta);
    for (let i = 0; i < count && this.pageStack.length > 1; i++) {
      const page = this.pageStack.pop()!;
      this.sendToWorker({ type: "unload-page", pageId: page.route.id });
      this.window.contentView.removeChildView(page.view);
      page.view.webContents.close();
    }
    const current = this.topPage();
    if (current) this.sendToWorker({ type: "show-page", pageId: current.route.id });
    this.layoutViews();
  }

  private bindIpc(): void {
    // 绑定前先解绑，避免 destroy/mount 多轮后重复注册处理器。
    ipcMain.off(this.pageMessageChannel, this.ipcHandler);
    ipcMain.off(this.windowControlChannel, this.windowControlHandler);
    ipcMain.on(this.pageMessageChannel, this.ipcHandler);
    ipcMain.on(this.windowControlChannel, this.windowControlHandler);
  }

  private createWorker(): void {
    this.runtimeWorker = new Worker(this.workerPath);
    // Worker 是逻辑层：接收事件，发出数据 patch、路由动作和宿主 API 调用。
    this.runtimeWorker.on("message", async (message: WorkerOutboundMessage) => {
      if (message.type === "ready") return;
      if (message.type === "page-data") {
        const page = this.pageStack.find((item) => item.route.id === message.patch.pageId);
        if (page) {
          page.data = message.patch.data;
          this.sendToPage(page.route.id, {
            type: "set-data",
            data: message.patch.data,
            patch: message.patch.patch,
            componentState: message.patch.components
          });
        }
      }
      if (message.type === "route") await this.handleRoute(message.action);
      if (message.type === "host-api") {
        const response = await this.handleHostApi(message.request);
        this.sendToWorker({ type: "api-response", response });
      }
      if (message.type === "log") this.emitMiniConsoleLog(message);
    });
    this.sendToWorker({ type: "init", bundle: this.requireBundle() });
  }

  private async createHostView(): Promise<void> {
    // 宿主视图独立于页面视图，确保自定义标题栏始终浮在页面之上。
    this.hostView = new WebContentsView({
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        additionalArguments: [`--mini-ipc=${this.ipcNamespace}`]
      }
    });
    this.hostView.setBackgroundColor("#00000000");
    this.window.contentView.addChildView(this.hostView);
    await this.hostView.webContents.loadFile(join(RENDERER_ROOT, "host.html"));
    this.hostView.setBounds(this.hostBounds());
    this.sendHostConfig();
    this.sendWindowState();
  }

  private handlePageMessage(event: IpcMainEvent, message: PageOutboundMessage): void {
    // 只有页面 WebContents 可以发送小程序 DOM 事件；忽略宿主栏和未知来源。
    const senderPage = this.pageStack.find((page) => page.view.webContents.id === event.sender.id);
    if (!senderPage) return;
    if (message.type === "dom-event") {
      this.sendToWorker({ type: "dom-event", event: message.event as MiniDomEvent });
    }
    if (message.type === "page-ready") {
      this.sendToWorker({ type: "show-page", pageId: message.pageId });
    }
  }

  private handleWindowControl(event: IpcMainEvent, action: WindowControlAction): void {
    // 窗口控制命令只接受来自可信宿主视图 preload 桥的消息。
    if (event.sender.id !== this.hostView?.webContents.id) return;
    if (action === "open-devtools") {
      this.hostView.webContents.openDevTools({ mode: "detach" });
      return;
    }
    if (action === "open-page-devtools") {
      this.topPage()?.view.webContents.openDevTools({ mode: "detach" });
      return;
    }
    if (action === "show-debug-menu" || action === "hide-debug-menu") {
      this.hostOverlayHeight = action === "show-debug-menu" ? 112 : 0;
      this.hostView.setBounds(this.hostBounds());
      this.bringHostViewToFront();
      return;
    }
    if (action === "minimize") this.window.minimize();
    if (action === "toggle-maximize") {
      if (this.window.isMaximized()) this.window.unmaximize();
      else this.window.maximize();
    }
    if (action === "close") this.window.close();
    this.sendWindowState();
  }

  private sendToWorker(message: WorkerInboundMessage): void {
    this.runtimeWorker?.postMessage(message);
  }

  private sendToPage(pageId: string, message: PageInboundMessage): void {
    const page = this.pageStack.find((item) => item.route.id === pageId);
    if (!page || page.view.webContents.isDestroyed()) return;
    page.view.webContents.send("mini:message", message);
  }

  private emitMiniConsoleLog(message: Extract<WorkerOutboundMessage, { type: "log" }>): void {
    const page = message.pageId ? this.pageStack.find((item) => item.route.id === message.pageId) : undefined;
    const label = page?.route.route ?? message.pageId ?? "app";
    const args = [`[${label}]`, ...message.args];
    this.emitToDevToolsConsole(this.hostView?.webContents, message.level, args);
    if (!message.pageId) return;
    this.emitToDevToolsConsole(page?.view.webContents, message.level, args);
  }

  private emitToDevToolsConsole(webContents: Electron.WebContents | undefined, level: Extract<WorkerOutboundMessage, { type: "log" }>["level"], args: string[]): void {
    if (!webContents || webContents.isDestroyed()) return;
    const script = `console[${JSON.stringify(level)}](...${JSON.stringify(args)})`;
    webContents.executeJavaScript(script).catch(() => undefined);
  }

  private topPage(): PageViewRecord | undefined {
    return this.pageStack.at(-1);
  }

  private hostBounds(): Electron.Rectangle {
    const [width] = this.window.getContentSize();
    return { x: 0, y: 0, width, height: this.hostHeight + this.hostOverlayHeight };
  }

  private contentBounds(): Electron.Rectangle {
    const [width, height] = this.window.getContentSize();
    return { x: 0, y: this.hostHeight, width, height: Math.max(0, height - this.hostHeight) };
  }

  private sendHostStack(): void {
    this.hostView?.webContents.send("host:stack", this.getRoutes());
  }

  private sendHostConfig(): void {
    this.hostView?.webContents.send("host:config", this.requireBundle().appConfig.window ?? {});
  }

  private sendWindowState = (): void => {
    this.hostView?.webContents.send("host:window-state", { maximized: this.window.isMaximized() });
  };

  private currentNavigationTitle(): string {
    const current = this.topPage();
    return current?.route.title || this.requireBundle().appConfig.window?.navigationBarTitleText || "Mini Program";
  }

  private syncNavigationTitle(): void {
    this.window.setTitle(this.currentNavigationTitle());
  }

  private bringHostViewToFront(): void {
    if (!this.hostView) return;
    this.window.contentView.removeChildView(this.hostView);
    this.window.contentView.addChildView(this.hostView);
  }

  private layoutViews = (): void => {
    this.hostView?.setBounds(this.hostBounds());
    const bounds = this.contentBounds();
    const current = this.topPage();
    // 隐藏页面移动到屏幕外而不是销毁，用来保留 DOM 状态和输入值。
    for (const page of this.pageStack) {
      page.view.setBounds(current === page ? bounds : { ...bounds, x: -bounds.width - 100 });
    }
    this.bringHostViewToFront();
    this.syncNavigationTitle();
    this.sendHostStack();
  };

  private createRoute(url: string): RouteRecord {
    const parsed = parseMiniUrl(url);
    const pageAssets = this.requireBundle().pages[parsed.route];
    if (!pageAssets) {
      throw new Error(`Unknown mini program page: ${parsed.route}`);
    }
    return {
      id: `page-${++this.pageSeq}`,
      route: parsed.route,
      url,
      query: parsed.query,
      title: routeTitle(parsed.route, pageAssets.config.navigationBarTitleText ?? this.requireBundle().appConfig.window?.navigationBarTitleText)
    };
  }

  private async createPage(url: string): Promise<PageViewRecord> {
    const route = this.createRoute(url);
    const assets = this.requireBundle().pages[route.route];
    // 页面 WebContents 只运行视图运行时；页面业务 JS 在 Worker 中执行。
    const view = new WebContentsView({
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        additionalArguments: [`--page-id=${route.id}`, `--mini-ipc=${this.ipcNamespace}`]
      }
    });
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    const record: PageViewRecord = { route, view, assets, data: {} };
    this.window.contentView.addChildView(view);
    await view.webContents.loadFile(join(RENDERER_ROOT, "page.html"), { query: { pageId: route.id } });
    return record;
  }

  private async pushPage(url: string): Promise<void> {
    const previous = this.topPage();
    if (previous) this.sendToWorker({ type: "hide-page", pageId: previous.route.id });
    const page = await this.createPage(url);
    this.pageStack.push(page);
    this.layoutViews();
    // 先初始化视图层，再让 Worker 创建并展示对应的逻辑实例。
    this.sendToPage(page.route.id, {
      type: "init",
      pageId: page.route.id,
      route: page.route,
      assets: page.assets,
      components: this.requireBundle().components,
      data: {},
      backgroundColor: page.assets.config.backgroundColor ?? this.requireBundle().appConfig.window?.backgroundColor
    });
    this.sendToWorker({ type: "create-page", pageId: page.route.id, route: page.route.route, query: page.route.query });
    this.sendToWorker({ type: "show-page", pageId: page.route.id });
  }

  private async replacePage(url: string): Promise<void> {
    const current = this.pageStack.pop();
    if (current) {
      this.sendToWorker({ type: "unload-page", pageId: current.route.id });
      this.window.contentView.removeChildView(current.view);
      current.view.webContents.close();
    }
    await this.pushPage(url);
  }

  private async relaunch(url: string): Promise<void> {
    while (this.pageStack.length) {
      const page = this.pageStack.pop()!;
      this.sendToWorker({ type: "unload-page", pageId: page.route.id });
      this.window.contentView.removeChildView(page.view);
      page.view.webContents.close();
    }
    await this.pushPage(url);
  }

  private async handleRoute(action: RouteAction): Promise<void> {
    if (action.type === "navigateTo") await this.pushPage(action.url);
    if (action.type === "redirectTo") await this.replacePage(action.url);
    if (action.type === "navigateBack") this.navigateBack(action.delta);
    if (action.type === "switchTab") await this.relaunch(action.url);
    if (action.type === "reLaunch") await this.relaunch(action.url);
  }

  private async handleHostApi(request: WxApiRequest): Promise<WxApiResponse> {
    try {
      const payload = request.payload ?? {};
      // UI 类 API 通过轻量命令转发给当前页面视图实现。
      if (request.name === "showToast" || request.name === "showLoading") {
        const page = this.topPage();
        if (page) this.sendToPage(page.route.id, { type: "host-ui", name: request.name === "showToast" ? "toast" : "loading", payload });
        return { id: request.id, ok: true, data: {} };
      }
      if (request.name === "hideToast" || request.name === "hideLoading") {
        const page = this.topPage();
        if (page) this.sendToPage(page.route.id, { type: "host-ui", name: request.name === "hideToast" ? "toast" : "loading" });
        return { id: request.id, ok: true, data: {} };
      }
      if (request.name === "showModal") {
        const result = await dialog.showMessageBox(this.window, {
          type: "question",
          title: String(payload.title ?? "Notice"),
          message: String(payload.content ?? ""),
          buttons: ["Cancel", "OK"],
          cancelId: 0,
          defaultId: 1
        });
        return { id: request.id, ok: true, data: { confirm: result.response === 1, cancel: result.response === 0 } };
      }
      if (request.name === "setStorage") {
        this.storage.set(String(payload.key), payload.data);
        return { id: request.id, ok: true, data: {} };
      }
      if (request.name === "getStorage") {
        const key = String(payload.key);
        if (!this.storage.has(key)) throw new Error("storage key not found");
        return { id: request.id, ok: true, data: { data: this.storage.get(key) } };
      }
      if (request.name === "removeStorage") {
        this.storage.delete(String(payload.key));
        return { id: request.id, ok: true, data: {} };
      }
      if (request.name === "clearStorage") {
        this.storage.clear();
        return { id: request.id, ok: true, data: {} };
      }
      if (request.name === "request") {
        // 网络请求由主进程代理，页面和 Worker 运行时都不直接拿宿主能力。
        const response = await fetch(String(payload.url), {
          method: String(payload.method ?? "GET"),
          body: payload.data == null ? undefined : JSON.stringify(payload.data),
          headers: payload.header as HeadersInit | undefined
        });
        const text = await response.text();
        let data: unknown = text;
        try {
          data = JSON.parse(text);
        } catch {
          // wx.request 允许返回纯文本，这里解析失败时保留原始文本。
        }
        return { id: request.id, ok: true, data: { data, statusCode: response.status, header: Object.fromEntries(response.headers) } };
      }
      if (request.name === "getSystemInfo") {
        const display = screen.getPrimaryDisplay();
        const [windowWidth, windowHeight] = this.window.getContentSize();
        return { id: request.id, ok: true, data: { platform: process.platform, pixelRatio: display.scaleFactor, windowWidth, windowHeight } };
      }
      return { id: request.id, ok: false, error: `Unsupported API: ${request.name}` };
    } catch (error) {
      return { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private requireBundle(): MiniAppBundle {
    if (!this.bundle) throw new Error("MiniProgramContainer has not been mounted.");
    return this.bundle;
  }
}
