import { componentTemplateCache, componentStyleCache, appConfig } from '../state.js';

const ipcRenderer = window.containerBridge;

export async function loadGlobalComponentTemplates() {
  if (!appConfig() || !appConfig().usingComponents) return;

  const usingComponents = appConfig().usingComponents;
  const compNames = Object.keys(usingComponents);

  for (let i = 0; i < compNames.length; i++) {
    let compPath = usingComponents[compNames[i]];
    if (compPath.startsWith('/')) {
      compPath = compPath.slice(1);
    }

    if (componentTemplateCache[compPath]) continue;

    const [tplResult, styleResult] = await Promise.all([
      ipcRenderer.invoke('read-file', compPath + '/index.wxml'),
      ipcRenderer.invoke('read-file', compPath + '/index.wxss'),
    ]);

    componentTemplateCache[compPath] = tplResult.success ? tplResult.content : '';
    componentStyleCache[compPath] = styleResult.success ? styleResult.content : '';
  }
}

export async function loadComponentTemplates(pagePath) {
  await loadGlobalComponentTemplates();

  const configPath = pagePath + '/index.json';
  const result = await ipcRenderer.invoke('read-file', configPath);
  if (!result.success) return;

  let pageConfig;
  try {
    pageConfig = JSON.parse(result.content);
  } catch (e) {
    return;
  }

  const usingComponents = pageConfig.usingComponents;
  if (!usingComponents || typeof usingComponents !== 'object') return;

  const compNames = Object.keys(usingComponents);
  for (let i = 0; i < compNames.length; i++) {
    const compName = compNames[i];
    let compPath = usingComponents[compName];
    if (compPath.startsWith('/')) {
      compPath = compPath.slice(1);
    }

    if (componentTemplateCache[compPath]) continue;

    const [tplResult, styleResult] = await Promise.all([
      ipcRenderer.invoke('read-file', compPath + '/index.wxml'),
      ipcRenderer.invoke('read-file', compPath + '/index.wxss'),
    ]);

    componentTemplateCache[compPath] = tplResult.success ? tplResult.content : '';
    componentStyleCache[compPath] = styleResult.success ? styleResult.content : '';
  }
}

export function buildComponentDefs(componentEventMap) {
  if (!componentEventMap || Object.keys(componentEventMap).length === 0) {
    return {};
  }
  const defs = {};
  const elementNameToCompName = {};
  Object.keys(componentEventMap).forEach((compName) => {
    const compInfo = componentEventMap[compName];
    defs[compName] = {
      template: componentTemplateCache[compInfo.path] || '',
      style: componentStyleCache[compInfo.path] || '',
    };
    let elementName = compName;
    if (!elementName.includes('-')) {
      elementName = 'mp-' + elementName;
    }
    elementNameToCompName[elementName] = compName;
  });
  return { defs, elementNameToCompName };
}
