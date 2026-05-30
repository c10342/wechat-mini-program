export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type MiniData = Record<string, unknown>;

export interface MiniAppWindowConfig {
  navigationBarTitleText?: string;
  navigationBarBackgroundColor?: string;
  navigationBarTextStyle?: "black" | "white";
  backgroundColor?: string;
}

export interface MiniAppConfig {
  appId: string;
  pages: string[];
  window?: MiniAppWindowConfig;
  tabBar?: {
    color?: string;
    selectedColor?: string;
    backgroundColor?: string;
    list: Array<{ pagePath: string; text: string }>;
  };
  networkTimeout?: Record<string, number>;
}

export interface PageConfig {
  navigationBarTitleText?: string;
  backgroundColor?: string;
}

export interface RouteRecord {
  id: string;
  route: string;
  url: string;
  query: Record<string, string>;
  title: string;
}

export interface PageAssets {
  route: string;
  config: PageConfig;
  wxml: string;
  wxss: string;
}

export interface MiniAppBundle {
  appConfig: MiniAppConfig;
  appScript: string;
  pages: Record<string, PageAssets & { script: string }>;
}

export interface SetDataPatch {
  pageId: string;
  data: MiniData;
  patch: MiniData;
}

export interface HostConfig {
  navigationBarTitleText?: string;
  navigationBarBackgroundColor?: string;
  navigationBarTextStyle?: "black" | "white";
  backgroundColor?: string;
}

export interface MiniDomEvent {
  pageId: string;
  type: string;
  handler: string;
  dataset: Record<string, string>;
  detail?: unknown;
}

export type RouteAction =
  | { type: "navigateTo"; url: string }
  | { type: "redirectTo"; url: string }
  | { type: "navigateBack"; delta?: number }
  | { type: "switchTab"; url: string }
  | { type: "reLaunch"; url: string };

export type HostApiName =
  | "showToast"
  | "hideToast"
  | "showLoading"
  | "hideLoading"
  | "showModal"
  | "setStorage"
  | "getStorage"
  | "removeStorage"
  | "clearStorage"
  | "request"
  | "getSystemInfo";

export interface WxApiRequest {
  id: string;
  name: HostApiName;
  payload?: Record<string, unknown>;
}

export interface WxApiResponse {
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

export type WorkerInboundMessage =
  | { type: "init"; bundle: MiniAppBundle }
  | { type: "create-page"; pageId: string; route: string; query: Record<string, string> }
  | { type: "show-page"; pageId: string }
  | { type: "hide-page"; pageId: string }
  | { type: "unload-page"; pageId: string }
  | { type: "dom-event"; event: MiniDomEvent }
  | { type: "api-response"; response: WxApiResponse };

export type WorkerOutboundMessage =
  | { type: "ready" }
  | { type: "page-data"; patch: SetDataPatch }
  | { type: "route"; action: RouteAction }
  | { type: "host-api"; request: WxApiRequest }
  | { type: "log"; level: "info" | "warn" | "error"; message: string };

export type PageInboundMessage =
  | { type: "init"; pageId: string; route: RouteRecord; assets: PageAssets; data: MiniData; backgroundColor?: string }
  | { type: "set-data"; data: MiniData; patch: MiniData }
  | { type: "host-ui"; name: "toast" | "loading"; payload?: Record<string, unknown> };

export type PageOutboundMessage =
  | { type: "page-ready"; pageId: string }
  | { type: "dom-event"; event: MiniDomEvent };

export type WindowControlAction =
  | "minimize"
  | "toggle-maximize"
  | "close"
  | "open-devtools"
  | "open-page-devtools"
  | "show-debug-menu"
  | "hide-debug-menu";
export interface WindowState {
  maximized: boolean;
}

declare global {
  interface Window {
    miniHost: {
      pageId: string;
      send(message: PageOutboundMessage): void;
      onMessage(listener: (message: PageInboundMessage) => void): () => void;
      onStack?(listener: (stack: RouteRecord[]) => void): () => void;
      onHostConfig?(listener: (config: HostConfig) => void): () => void;
      windowControl?(action: WindowControlAction): void;
      onWindowState?(listener: (state: WindowState) => void): () => void;
    };
  }
}
