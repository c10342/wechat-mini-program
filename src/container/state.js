const state = {
  appConfig: null,
  appDir: null,
  worker: null,
  pageStack: [],
  pageViewIds: {},
  pageDataCache: {},
  pageComponentEventMaps: {},
  componentTemplateCache: {},
  componentStyleCache: {},
  elementNameToCompName: {},
  globalAppStyle: '',
  NAV_HEIGHT: 44,
  ANIM_DURATION: 280,
  navigatingTo: null
};

export const appConfig = () => state.appConfig;
export const appDir = () => state.appDir;
export const worker = () => state.worker;
export const pageStack = state.pageStack;
export const pageViewIds = state.pageViewIds;
export const pageDataCache = state.pageDataCache;
export const pageComponentEventMaps = state.pageComponentEventMaps;
export const componentTemplateCache = state.componentTemplateCache;
export const componentStyleCache = state.componentStyleCache;
export const elementNameToCompName = state.elementNameToCompName;
export const globalAppStyle = () => state.globalAppStyle;
export const NAV_HEIGHT = state.NAV_HEIGHT;
export const ANIM_DURATION = state.ANIM_DURATION;
export const navigatingTo = () => state.navigatingTo;

export function setAppConfig(config) {
  state.appConfig = config;
}

export function setAppDir(dir) {
  state.appDir = dir;
}

export function setWorker(w) {
  state.worker = w;
}

export function setGlobalAppStyle(style) {
  state.globalAppStyle = style;
}

export function setNavigatingTo(value) {
  state.navigatingTo = value;
}
