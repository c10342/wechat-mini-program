import {
  appConfig,
  globalComponentRegistry,
  pageComponentRegistry,
  componentInstances,
} from '../state.js';
import { createComponentInstance } from '../component/index.js';
import { loadComponentScript } from '../component/index.js';
import { requestFile } from '../file/index.js';

export async function loadGlobalComponents() {
  if (!appConfig || !appConfig.usingComponents) return;

  const usingComponents = appConfig.usingComponents;
  const compNames = Object.keys(usingComponents);

  for (let i = 0; i < compNames.length; i++) {
    const compName = compNames[i];
    let compPath = usingComponents[compName];
    if (compPath.startsWith('/')) {
      compPath = compPath.slice(1);
    }

    const compDef = await loadComponentScript(compPath);
    if (!compDef) {
      console.error('[Worker] Failed to load global component:', compName, 'at', compPath);
      continue;
    }

    globalComponentRegistry[compName] = {
      path: compPath,
      definition: compDef,
    };

    console.log('[Worker] Global component loaded:', compName, '->', compPath);
  }
}

export async function loadPageComponents(pagePath) {
  if (!pageComponentRegistry[pagePath]) {
    pageComponentRegistry[pagePath] = {};
  }

  Object.keys(globalComponentRegistry).forEach((compName) => {
    const gComp = globalComponentRegistry[compName];
    pageComponentRegistry[pagePath][compName] = {
      path: gComp.path,
      uid: pagePath + '::' + compName,
      definition: gComp.definition,
    };
  });

  const configPath = pagePath + '/index.json';
  const result = await requestFile(configPath);
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

    if (globalComponentRegistry[compName]) {
      console.warn(
        '[Worker] Component \'' + compName + '\' is registered both globally and in page \'' + pagePath + '\'. ' +
        'Page-level registration takes priority.'
      );
    }

    const compDef = await loadComponentScript(compPath);
    if (!compDef) {
      console.error('[Worker] Failed to load component:', compName, 'at', compPath);
      continue;
    }

    const uid = pagePath + '::' + compName;
    pageComponentRegistry[pagePath][compName] = {
      path: compPath,
      uid: uid,
      definition: compDef,
    };

    console.log('[Worker] Page component loaded:', compName, '->', compPath, '(page:', pagePath + ')');
  }
}

export function initializeComponentInstances(pagePath, pageData) {
  const pageComps = pageComponentRegistry[pagePath];
  if (!pageComps) return;

  Object.keys(pageComps).forEach((compName) => {
    const compInfo = pageComps[compName];
    const props = {};

    if (compInfo.definition.properties) {
      Object.keys(compInfo.definition.properties).forEach((propName) => {
        const dataKey = compName + '.' + propName;
        if (pageData && pageData[dataKey] !== undefined) {
          props[propName] = pageData[dataKey];
        }
      });
    }

    const instance = createComponentInstance(compName, compInfo.path, compInfo.definition, pagePath, props);
    componentInstances[compInfo.uid] = instance;

    if (compInfo.definition.lifetimes && typeof compInfo.definition.lifetimes.attached === 'function') {
      compInfo.definition.lifetimes.attached.call(instance);
    }
  });
}

export function getComponentEventMap(pagePath) {
  const pageComps = pageComponentRegistry[pagePath];
  if (!pageComps) return {};

  const eventMap = {};
  Object.keys(pageComps).forEach((compName) => {
    const compInfo = pageComps[compName];
    const compInstance = componentInstances[compInfo.uid];
    if (!compInstance) return;

    const methods = compInfo.definition.methods || {};
    const methodNames = Object.keys(methods).filter((k) => {
      return typeof methods[k] === 'function';
    });

    eventMap[compName] = {
      uid: compInfo.uid,
      path: compInfo.path,
      methods: methodNames,
    };
  });

  return eventMap;
}
