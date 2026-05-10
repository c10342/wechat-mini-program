import {
  setAppConfig,
  appConfig,
  pageInstances,
  pageComponentRegistry,
  componentInstances,
  pendingFileRequests,
  pendingChooseFileCallbacks,
  appMethods,
} from '../state.js';
import { loadGlobalComponents } from '../component-loader/index.js';
import { loadPage, loadAppScript, handleComponentEvent } from '../page-loader/index.js';

const messageHandlers = {
  init: async (msg) => {
    const data = msg.data;
    setAppConfig(data.config);
    console.log('[Worker] Config loaded:', JSON.stringify(appConfig));

    await loadGlobalComponents();

    await loadAppScript();

    if (typeof appMethods.onLaunch === 'function') {
      appMethods.onLaunch();
    }

    const firstPage = appConfig.pages[0];
    if (firstPage) {
      loadPage(firstPage);
    }
  },
  event: async (msg) => {
    const data = msg.data;
    const pagePath = data.pagePath;
    const eventName = data.eventName;
    const eventPayload = data.eventPayload;
    const compName = data.compName;

    if (compName) {
      handleComponentEvent(pagePath, compName, eventName, eventPayload);
      return;
    }

    console.log('[Worker] Event received:', eventName, 'on page:', pagePath);

    const instance = pageInstances[pagePath];
    if (!instance) {
      console.warn(
        '[Worker] No page instance for event:',
        pagePath,
        'available:',
        Object.keys(pageInstances),
      );
      return;
    }

    const handler = instance[eventName];
    if (typeof handler === 'function') {
      handler.call(instance, eventPayload || {});
    } else {
      console.warn(
        '[Worker] No handler for event:',
        eventName,
        'on page:',
        pagePath,
      );
    }
  },
  loadPage: async (msg) => {
    const data = msg.data;
    loadPage(data.path);
  },
  notifyPageHide: async (msg) => {
    const data = msg.data;
    const hidePath = data.path;
    if (pageInstances[hidePath]) {
      if (typeof pageInstances[hidePath].onUnload === 'function') {
        pageInstances[hidePath].onUnload();
      }

      const pageComps = pageComponentRegistry[hidePath];
      if (pageComps) {
        Object.keys(pageComps).forEach((compName) => {
          const compInfo = pageComps[compName];
          const compInstance = componentInstances[compInfo.uid];
          if (compInstance && compInfo.definition.lifetimes && typeof compInfo.definition.lifetimes.detached === 'function') {
            compInfo.definition.lifetimes.detached.call(compInstance);
          }
          delete componentInstances[compInfo.uid];
        });
      }

      delete pageInstances[hidePath];
      delete pageComponentRegistry[hidePath];
      console.log('[Worker] Page destroyed:', hidePath);
    }
  },
  notifyPageShow: async (msg) => {
    const data = msg.data;
    const showPath = data.path;
    if (
      pageInstances[showPath] &&
      typeof pageInstances[showPath].onShow === 'function'
    ) {
      pageInstances[showPath].onShow();
    }
  },
  fileResponse: async (msg) => {
    const data = msg.data;
    const id = data.id;
    if (pendingFileRequests[id]) {
      pendingFileRequests[id](data.result);
      delete pendingFileRequests[id];
    }
  },
  chooseFileResponse: async (msg) => {
    const data = msg.data;
    const respId = data.id;
    const cb = pendingChooseFileCallbacks[respId];
    if (cb) {
      if (data.cancelled) {
        if (cb.fail) cb.fail({ errMsg: 'cancelled' });
      } else {
        if (cb.success) cb.success({ filePaths: data.filePaths });
      }
      delete pendingChooseFileCallbacks[respId];
    }
  },
};

export async function handleMessage(msg) {
  const type = msg.type;
  if (messageHandlers[type]) {
    await messageHandlers[type](msg);
  } else {
    console.warn('[Worker] Unknown message type:', type);
  }
}
