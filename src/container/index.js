import {
  setAppConfig,
  setAppDir,
  setGlobalAppStyle,
  appConfig,
  worker,
  pageStack,
  elementNameToCompName,
} from './state.js';
import { convertWxssSelectors } from './utils/index.js';
import { initWorker } from './worker/index.js';
import { handleNavigateBack } from './animation/index.js';
import { getBounds, setViewBounds } from './pages/index.js';

const ipcRenderer = window.containerBridge;

async function loadAppStyles() {
  const result = await ipcRenderer.invoke('read-file', 'app.wxss');
  if (result.success) {
    const style = convertWxssSelectors(result.content);
    setGlobalAppStyle(style);
    const styleEl = document.createElement('style');
    styleEl.id = 'app-style';
    styleEl.textContent = style;
    document.head.appendChild(styleEl);
  }
}

ipcRenderer.onInitContainer(async (initData) => {
  setAppConfig(initData.config);
  setAppDir(initData.appDir);

  console.log('[Container] Config loaded:', JSON.stringify(appConfig()));

  await loadAppStyles();

  const bundlePath = await ipcRenderer.invoke('build-worker-bundle');

  initWorker(bundlePath);

  worker().postMessage({ type: 'init', data: { config: appConfig() } });
});

document.getElementById('nav-back').addEventListener('click', () => {
  handleNavigateBack(1);
});

window.addEventListener('resize', () => {
  const current = pageStack[pageStack.length - 1];
  if (current) {
    setViewBounds(current, getBounds(0));
  }
});

ipcRenderer.onPageViewEvent((msg) => {
  const viewId = msg.viewId;
  const eventName = msg.eventName;
  const eventPayload = msg.eventPayload;

  const currentPath = pageStack[pageStack.length - 1];
  if (!currentPath) return;

  let compName = null;
  if (eventPayload && eventPayload.target && eventPayload.target.dataset && eventPayload.target.dataset.compName) {
    compName = elementNameToCompName[eventPayload.target.dataset.compName] || eventPayload.target.dataset.compName;
  }

  console.log('[Container] Event from view:', eventName, 'page:', currentPath, 'component:', compName || 'page');

  worker().postMessage({
    type: 'event',
    data: {
      pagePath: currentPath,
      eventName: eventName,
      eventPayload: eventPayload,
      compName: compName,
    },
  });
});
