import {
  setCurrentPage,
  setPendingQuery,
  pageInstances,
  pageComponentRegistry,
  componentInstances,
} from '../state.js';
import { loadPageComponents } from '../component-loader/index.js';
import { preloadModules, executeScript } from '../module/index.js';
import { requestFile } from '../file/index.js';

export async function loadPageScript(pagePath) {
  const scriptPath = pagePath + '/index.js';
  const result = await requestFile(scriptPath);
  if (result.success) {
    setCurrentPage(pagePath);

    await loadPageComponents(pagePath);

    await preloadModules(result.content, scriptPath);
    executeScript(result.content, scriptPath);
  } else {
    console.error(
      '[Worker] Failed to load page script:',
      pagePath,
      result.error,
    );
  }
}

export async function loadPage(pagePath, query) {
  if (pageInstances[pagePath]) {
    if (typeof pageInstances[pagePath].onHide === 'function') {
      pageInstances[pagePath].onHide();
    }
  }

  setPendingQuery(query || null);
  await loadPageScript(pagePath);
  setPendingQuery(null);

  if (
    pageInstances[pagePath] &&
    typeof pageInstances[pagePath].onShow === 'function'
  ) {
    pageInstances[pagePath].onShow();
  }
}

export async function loadAppScript() {
  const result = await requestFile('app.js');
  if (result.success) {
    executeScript(result.content);
  }
}

export function handleComponentEvent(pagePath, compName, eventName, eventPayload) {
  const pageComps = pageComponentRegistry[pagePath];
  if (!pageComps || !pageComps[compName]) {
    console.warn('[Worker] Unknown component:', compName, 'on page:', pagePath);
    return;
  }

  const compInfo = pageComps[compName];
  const compInstance = componentInstances[compInfo.uid];
  if (!compInstance) {
    console.warn('[Worker] No component instance:', compName);
    return;
  }

  const handler = compInstance[eventName];
  if (typeof handler === 'function') {
    handler.call(compInstance, eventPayload || {});
  } else {
    console.warn('[Worker] No handler for event:', eventName, 'on component:', compName);
  }
}
