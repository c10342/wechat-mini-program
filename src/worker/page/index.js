import {
  pageInstances,
  pageComponentRegistry,
  componentInstances,
  pendingQuery,
  currentPage,
} from '../state.js';
import { deepClone, sendMessage } from '../utils/index.js';
import { initializeComponentInstances, getComponentEventMap } from '../component-loader/index.js';

export function notifyPageDataUpdate(pagePath) {
  const pageInstance = pageInstances[pagePath];
  if (!pageInstance) return;

  const mergedData = deepClone(pageInstance.data);
  const pageComps = pageComponentRegistry[pagePath];
  if (pageComps) {
    Object.keys(pageComps).forEach((compName) => {
      const compInfo = pageComps[compName];
      const compInstance = componentInstances[compInfo.uid];
      if (compInstance) {
        mergedData['__comp_' + compName] = deepClone(compInstance.data);
      }
    });
  }

  sendMessage('setData', {
    path: pagePath,
    data: mergedData,
    fullData: deepClone(mergedData),
  });
}

export function createPageInstance(pagePath, pageDefine) {
  const instance = {
    __path__: pagePath,
    __define__: pageDefine,
    data: deepClone(pageDefine.data || {}),
    setData: function (newData, callback) {
      if (typeof newData !== 'object' || !newData) return;
      Object.assign(instance.data, newData);

      const pageComps = pageComponentRegistry[pagePath];
      if (pageComps) {
        Object.keys(pageComps).forEach((compName) => {
          const compInfo = pageComps[compName];
          const compInstance = componentInstances[compInfo.uid];
          if (!compInstance || !compInfo.definition.properties) return;

          const updatedProps = {};
          Object.keys(compInfo.definition.properties).forEach((propName) => {
            if (newData[propName] !== undefined) {
              compInstance.properties[propName] = newData[propName];
              compInstance.data[propName] = newData[propName];
              updatedProps[propName] = newData[propName];
            }
          });

          if (Object.keys(updatedProps).length > 0 && compInfo.definition.observers) {
            Object.keys(compInfo.definition.observers).forEach((field) => {
              if (updatedProps.hasOwnProperty(field)) {
                compInfo.definition.observers[field].call(compInstance, updatedProps[field]);
              }
            });
          }
        });
      }

      const mergedData = deepClone(instance.data);
      if (pageComps) {
        Object.keys(pageComps).forEach((compName) => {
          const compInfo = pageComps[compName];
          const compInstance = componentInstances[compInfo.uid];
          if (compInstance) {
            mergedData['__comp_' + compName] = deepClone(compInstance.data);
          }
        });
      }
      sendMessage('setData', {
        path: pagePath,
        data: mergedData,
        fullData: deepClone(mergedData),
      });
      if (typeof callback === 'function') callback();
    },
  };

  const reservedKeys = ['data', 'methods'];
  Object.keys(pageDefine).forEach((key) => {
    if (reservedKeys.indexOf(key) !== -1) return;
    if (typeof pageDefine[key] === 'function') {
      instance[key] = function () {
        const args = Array.prototype.slice.call(arguments);
        return pageDefine[key].apply(instance, args);
      };
    }
  });

  if (pageDefine.methods) {
    Object.keys(pageDefine.methods).forEach((methodName) => {
      if (typeof pageDefine.methods[methodName] === 'function') {
        instance[methodName] = function () {
          const args = Array.prototype.slice.call(arguments);
          return pageDefine.methods[methodName].apply(instance, args);
        };
      }
    });
  }

  return instance;
}

export function registerPage(options) {
  if (!currentPage) {
    console.warn('[Worker] Page called without active page context');
    return;
  }

  const pagePath = currentPage;
  const instance = createPageInstance(pagePath, options);
  pageInstances[pagePath] = instance;

  initializeComponentInstances(pagePath, instance.data);

  let mergedData = deepClone(instance.data);
  const pageComps = pageComponentRegistry[pagePath];
  if (pageComps) {
    Object.keys(pageComps).forEach((compName) => {
      const compInfo = pageComps[compName];
      const compInstance = componentInstances[compInfo.uid];
      if (compInstance) {
        mergedData['__comp_' + compName] = deepClone(compInstance.data);
      }
    });
  }

  console.log(
    '[Worker] Page registered:',
    pagePath,
    'data:',
    JSON.stringify(instance.data),
  );
  console.log(
    '[Worker] Page methods:',
    Object.keys(instance).filter((k) => {
      return typeof instance[k] === 'function';
    }),
  );

  if (typeof instance.onLoad === 'function') {
    instance.onLoad(pendingQuery || {});
  }

  mergedData = deepClone(instance.data);
  const pageComps2 = pageComponentRegistry[pagePath];
  if (pageComps2) {
    Object.keys(pageComps2).forEach((compName) => {
      const compInfo = pageComps2[compName];
      const compInstance = componentInstances[compInfo.uid];
      if (compInstance) {
        mergedData['__comp_' + compName] = deepClone(compInstance.data);
      }
    });
  }

  sendMessage('pageReady', {
    path: pagePath,
    data: deepClone(mergedData),
    componentEventMap: getComponentEventMap(pagePath),
  });
}
