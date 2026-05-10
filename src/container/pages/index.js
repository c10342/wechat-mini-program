import {
  pageViewIds,
  pageDataCache,
  pageComponentEventMaps,
  NAV_HEIGHT,
  globalAppStyle,
  appConfig,
  pageStack
} from '../state.js';
import { convertWxssSelectors } from '../utils/index.js';
import { renderTemplate } from '../template/index.js';
import { buildComponentDefs } from '../components/index.js';

const ipcRenderer = window.containerBridge;

export function getBounds(offsetX) {
  offsetX = offsetX || 0;
  return {
    x: offsetX,
    y: NAV_HEIGHT,
    width: window.innerWidth,
    height: window.innerHeight - NAV_HEIGHT,
  };
}

export async function createPageView(pagePath) {
  const viewId = await ipcRenderer.invoke('create-page-view');
  pageViewIds[pagePath] = viewId;
  return viewId;
}

export async function renderPageInView(viewId, pagePath, data, componentEventMap) {
  const tplPath = pagePath + '/index.wxml';
  const stylePath = pagePath + '/index.wxss';
  const configPath = pagePath + '/index.json';

  const [tplResult, styleResult, configResult] = await Promise.all([
    ipcRenderer.invoke('read-file', tplPath),
    ipcRenderer.invoke('read-file', stylePath),
    ipcRenderer.invoke('read-file', configPath),
  ]);

  let pageConfig = {};
  if (configResult.success) {
    try {
      pageConfig = JSON.parse(configResult.content);
    } catch (e) {}
  }

  let html = '';
  if (tplResult.success) {
    html = renderTemplate(tplResult.content, data);
  }

  let style = '';
  if (styleResult.success) {
    style = convertWxssSelectors(styleResult.content);
  }

  const { defs: componentDefs, elementNameToCompName: elemToComp } = buildComponentDefs(componentEventMap);
  const compDataMap = {};
  Object.keys(componentDefs).forEach((compName) => {
    compDataMap[compName] = data['__comp_' + compName] || {};
  });

  ipcRenderer.send('send-to-page-view', {
    viewId,
    channel: 'render',
    data: {
      html: html,
      style: style,
      globalStyle: globalAppStyle(),
      componentDefs: componentDefs,
      compDataMap: compDataMap,
    },
  });

  return { pageConfig, elemToComp };
}

export function updateNavBar(pageConfig) {
  const navTitle = document.getElementById('nav-title');
  const navBack = document.getElementById('nav-back');
  if (navTitle) {
    navTitle.textContent =
      pageConfig.navigationBarTitleText ||
      (appConfig() && appConfig().window && appConfig().window.navigationBarTitleText) ||
      '';
  }
  if (navBack) {
    navBack.style.display = pageStack.length > 1 ? 'flex' : 'none';
  }
}

export function setViewBounds(pagePath, bounds) {
  const viewId = pageViewIds[pagePath];
  if (viewId) {
    ipcRenderer.send('set-page-view-bounds', { viewId, bounds: bounds });
  }
}

export function showPage(pagePath) {
  const viewId = pageViewIds[pagePath];
  if (viewId) {
    ipcRenderer.send('show-page-view', { viewId });
    ipcRenderer.send('set-page-view-bounds', { viewId, bounds: getBounds() });
  }
}

export function hidePage(pagePath) {
  const viewId = pageViewIds[pagePath];
  if (viewId) {
    ipcRenderer.send('hide-page-view', { viewId });
  }
}

export function destroyPage(pagePath) {
  const viewId = pageViewIds[pagePath];
  if (viewId) {
    ipcRenderer.send('destroy-page-view', { viewId });
    delete pageViewIds[pagePath];
    delete pageDataCache[pagePath];
    delete pageComponentEventMaps[pagePath];
  }
}
