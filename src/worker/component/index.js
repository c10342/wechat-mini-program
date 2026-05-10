import {
  componentDefinitions,
  componentInstances,
  pageInstances,
} from '../state.js';
import { deepClone, sendMessage } from '../utils/index.js';
import { notifyPageDataUpdate } from '../page/index.js';
import { requestFile } from '../file/index.js';
import { preloadModules } from '../module/index.js';

export function createComponentInstance(compPath, compDef, parentPage, props) {
  props = props || {};
  const instance = {
    __path__: compPath,
    __define__: compDef,
    __parentPage__: parentPage,
    __isComponent__: true,
    data: deepClone(compDef.data || {}),
    properties: {},
    setData: function (newData, callback) {
      if (typeof newData !== 'object' || !newData) return;
      Object.assign(instance.data, newData);
      if (compDef.observers) {
        Object.keys(compDef.observers).forEach((field) => {
          if (newData.hasOwnProperty(field)) {
            compDef.observers[field].call(instance, newData[field]);
          }
        });
      }
      notifyPageDataUpdate(parentPage);
      if (typeof callback === 'function') callback();
    },
    triggerEvent: function (eventName, detail) {
      const pageInstance = pageInstances[parentPage];
      if (!pageInstance) return;
      const handlerName = 'on' + eventName.charAt(0).toUpperCase() + eventName.slice(1);
      if (typeof pageInstance[handlerName] === 'function') {
        pageInstance[handlerName].call(pageInstance, detail || {});
      }
    },
  };

  if (compDef.properties) {
    Object.keys(compDef.properties).forEach((propName) => {
      const propDef = compDef.properties[propName];
      const value = props.hasOwnProperty(propName) ? props[propName] : (propDef.value !== undefined ? propDef.value : null);
      instance.properties[propName] = value;
      if (!instance.data.hasOwnProperty(propName)) {
        instance.data[propName] = value;
      }
    });
  }

  const reservedKeys = ['data', 'methods', 'properties', 'observers', 'lifetimes', 'created', 'attached', 'ready', 'moved', 'detached'];
  Object.keys(compDef).forEach((key) => {
    if (reservedKeys.indexOf(key) !== -1) return;
    if (typeof compDef[key] === 'function') {
      instance[key] = function () {
        const args = Array.prototype.slice.call(arguments);
        return compDef[key].apply(instance, args);
      };
    }
  });

  if (compDef.methods) {
    Object.keys(compDef.methods).forEach((methodName) => {
      if (typeof compDef.methods[methodName] === 'function') {
        instance[methodName] = function () {
          const args = Array.prototype.slice.call(arguments);
          return compDef.methods[methodName].apply(instance, args);
        };
      }
    });
  }

  if (compDef.lifetimes) {
    if (typeof compDef.lifetimes.created === 'function') {
      compDef.lifetimes.created.call(instance);
    }
  }

  return instance;
}

export function registerComponent(options) {
  const compPath = '__pending_component__';
  componentDefinitions[compPath] = options;
  console.log('[Worker] Component registered (pending path)');
}

export function registerComponentAtPath(compPath, options) {
  componentDefinitions[compPath] = options;
  console.log('[Worker] Component registered:', compPath);
}

function executeScriptForComponent(code, fromPath) {
  const moduleExports = {};
  const moduleRef = { exports: moduleExports };
  const localRequire = (path) => {
    console.warn('[Worker] require not fully supported in component:', path);
    return {};
  };

  try {
    const fn = new Function('require', 'module', 'exports', code);
    fn(localRequire, moduleRef, moduleExports);
  } catch (err) {
    console.error('[Worker] Component script execution error:', err);
  }
}

export async function loadComponentScript(compPath) {
  if (componentDefinitions[compPath]) {
    return componentDefinitions[compPath];
  }

  const scriptPath = compPath + '/index.js';
  const result = await requestFile(scriptPath);
  if (!result.success) {
    console.error('[Worker] Failed to load component script:', compPath, result.error);
    return null;
  }

  const pendingCompKey = '__pending_component__';
  delete componentDefinitions[pendingCompKey];

  await preloadModules(result.content, scriptPath);
  executeScriptForComponent(result.content, scriptPath);

  const compDef = componentDefinitions[pendingCompKey] || null;
  if (compDef) {
    delete componentDefinitions[pendingCompKey];
    registerComponentAtPath(compPath, compDef);
  }

  return compDef;
}
