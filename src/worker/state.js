export let appConfig = null;
export let currentPage = null;
export let pendingQuery = null;
export const pageInstances = {};
export const componentDefinitions = {};
export const componentInstances = {};
export const pageComponentRegistry = {};
export const globalComponentRegistry = {};

export const appMethods = {
  onLaunch: null,
  onShow: null,
  onHide: null,
  globalData: {},
};

export const pendingFileRequests = {};
export const pendingChooseFileCallbacks = {};
export let requestIdCounter = 0;
export const moduleCache = {};

export function setAppConfig(config) {
  appConfig = config;
}

export function setCurrentPage(page) {
  currentPage = page;
}

export function setPendingQuery(query) {
  pendingQuery = query;
}

export function incrementRequestIdCounter() {
  return ++requestIdCounter;
}
