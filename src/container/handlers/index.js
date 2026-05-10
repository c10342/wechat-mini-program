import {
  pageStack,
  pageDataCache,
  pageComponentEventMaps,
  navigatingTo,
  worker,
  elementNameToCompName,
  setNavigatingTo,
  pageViewIds
} from '../state.js';
import { deepClone } from '../utils/index.js';
import { loadComponentTemplates } from '../components/index.js';
import { createPageView, renderPageInView, showPage, setViewBounds, updateNavBar, getBounds } from '../pages/index.js';
import { animateSlideIn, handleNavigateBack } from '../animation/index.js';

const ipcRenderer = window.containerBridge;

const messageHandlers = {
  pageReady: async (msg) => {
    const data = msg.data;
    const pagePath = data.path;
    const pageData = data.data;
    const componentEventMap = data.componentEventMap || {};

    pageDataCache[pagePath] = deepClone(pageData);
    pageComponentEventMaps[pagePath] = componentEventMap;

    await loadComponentTemplates(pagePath);

    const viewId = await createPageView(pagePath);

    ipcRenderer.send('set-page-view-bounds', {
      viewId,
      bounds: getBounds(window.innerWidth),
    });
    ipcRenderer.send('hide-page-view', { viewId });

    const { pageConfig, elemToComp } = await renderPageInView(viewId, pagePath, pageData, componentEventMap);
    
    Object.assign(elementNameToCompName, elemToComp);

    const isNavigateTo = navigatingTo() === pagePath;
    setNavigatingTo(null);

    if (isNavigateTo && pageStack.length > 0) {
      pageStack.push(pagePath);
      const oldPage = pageStack[pageStack.length - 2];
      animateSlideIn(pagePath, oldPage, pageConfig);
    } else {
      pageStack.push(pagePath);
      setViewBounds(pagePath, getBounds(0));
      showPage(pagePath);
      updateNavBar(pageConfig);
    }

    console.log(
      '[Container] Page ready:',
      pagePath,
      'stack:',
      JSON.stringify(pageStack),
    );
  },
  setData: async (msg) => {
    const data = msg.data;
    const pagePath = data.path;
    const fullData = data.fullData;

    pageDataCache[pagePath] = deepClone(fullData);

    const viewId = pageViewIds[pagePath];
    if (viewId) {
      const componentEventMap = pageComponentEventMaps[pagePath] || {};
      await renderPageInView(viewId, pagePath, fullData, componentEventMap);
      console.log('[Container] Data updated:', pagePath);
    }
  },
  navigateTo: async (msg) => {
    setNavigatingTo(msg.data.path);
    console.log('[Container] navigateTo:', msg.data.path);
  },
  navigateBack: async (msg) => {
    handleNavigateBack(msg.data.delta);
  },
  showToast: (msg) => {
    const data = msg.data;
    const currentPath = pageStack[pageStack.length - 1];
    const viewId = pageViewIds[currentPath];
    if (viewId) {
      ipcRenderer.send('send-to-page-view', {
        viewId: viewId,
        channel: 'render',
        data: {
          showToast: true,
          toastTitle: data.title,
          toastDuration: data.duration,
        },
      });
    }
  },
  showNotification: async (msg) => {
    const data = msg.data;
    if (Notification.permission === 'granted') {
      new Notification(data.title || 'Notification', {
        body: data.body || '',
        icon: data.icon || '',
        tag: data.tag || '',
      });
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then((perm) => {
        if (perm === 'granted') {
          new Notification(data.title || 'Notification', {
            body: data.body || '',
            icon: data.icon || '',
            tag: data.tag || '',
          });
        }
      });
    }
  },
  readFile: async (msg) => {
    const data = msg.data;
    const id = data.id;
    const filePath = data.path;
    const result = await ipcRenderer.invoke('read-file', filePath);
    worker().postMessage({
      type: 'fileResponse',
      data: { id: id, result: result },
    });
  },
  chooseFile: async (msg) => {
    const data = msg.data;
    const id = data.id;
    const result = await ipcRenderer.invoke('show-open-dialog', {
      title: data.title,
      filters: data.filters,
      multiple: data.multiple,
    });
    worker().postMessage({
      type: 'chooseFileResponse',
      data: {
        id: id,
        cancelled: result.cancelled,
        filePaths: result.filePaths || [],
      },
    });
  },
};

export async function handleWorkerMessage(msg) {
  const type = msg.type;
  const handler = messageHandlers[type];

  if (handler) {
    await handler(msg);
  } else {
    console.error('[Container] Unknown message type:', type);
  }
}
