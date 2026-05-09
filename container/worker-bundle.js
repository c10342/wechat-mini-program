'use strict';

let appConfig = null;
let currentPage = null;
let pageInstances = {};

const appMethods = {
  onLaunch: null,
  onShow: null,
  onHide: null,
  globalData: {},
};

function sendMessage(type, data) {
  self.postMessage({ type: type, data: data });
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function createPageInstance(pagePath, pageDefine) {
  var instance = {
    __path__: pagePath,
    __define__: pageDefine,
    data: deepClone(pageDefine.data || {}),
    setData: function (newData, callback) {
      if (typeof newData !== 'object' || !newData) return;
      Object.assign(instance.data, newData);
      sendMessage('setData', {
        path: pagePath,
        data: newData,
        fullData: deepClone(instance.data),
      });
      if (typeof callback === 'function') callback();
    },
  };

  var reservedKeys = ['data', 'methods'];
  Object.keys(pageDefine).forEach(function (key) {
    if (reservedKeys.indexOf(key) !== -1) return;
    if (typeof pageDefine[key] === 'function') {
      instance[key] = function () {
        var args = Array.prototype.slice.call(arguments);
        return pageDefine[key].apply(instance, args);
      };
    }
  });

  if (pageDefine.methods) {
    Object.keys(pageDefine.methods).forEach(function (methodName) {
      if (typeof pageDefine.methods[methodName] === 'function') {
        instance[methodName] = function () {
          var args = Array.prototype.slice.call(arguments);
          return pageDefine.methods[methodName].apply(instance, args);
        };
      }
    });
  }

  return instance;
}

self.App = function (options) {
  if (options.globalData) {
    appMethods.globalData = options.globalData;
  }
  ['onLaunch', 'onShow', 'onHide'].forEach(function (hook) {
    if (typeof options[hook] === 'function') {
      appMethods[hook] = options[hook];
    }
  });
  console.log('[Worker] App registered');
};

self.Page = function (options) {
  if (!currentPage) {
    console.warn('[Worker] Page called without active page context');
    return;
  }

  var pagePath = currentPage;
  var instance = createPageInstance(pagePath, options);
  pageInstances[pagePath] = instance;

  console.log('[Worker] Page registered:', pagePath, 'data:', JSON.stringify(instance.data));
  console.log('[Worker] Page methods:', Object.keys(instance).filter(function (k) { return typeof instance[k] === 'function'; }));

  if (typeof instance.onLoad === 'function') {
    instance.onLoad(pendingQuery || {});
  }

  sendMessage('pageReady', {
    path: pagePath,
    data: deepClone(instance.data),
  });
};

self.wx = {
  navigateTo: function (params) {
    var url = params.url;
    var queryIndex = url.indexOf('?');
    var cleanUrl = queryIndex >= 0 ? url.substring(0, queryIndex) : url;
    var queryStr = queryIndex >= 0 ? url.substring(queryIndex + 1) : '';
    var pagePath = cleanUrl.startsWith('/') ? cleanUrl.slice(1) : cleanUrl;
    if (pagePath.endsWith('/index')) {
      pagePath = pagePath.slice(0, -6);
    }
    var query = parseQuery(queryStr);
    console.log('[Worker] navigateTo:', params.url, '-> pagePath:', pagePath, 'query:', JSON.stringify(query));
    sendMessage('navigateTo', { path: pagePath });
    loadPage(pagePath, query);
    if (params.success) params.success();
  },
  navigateBack: function (params) {
    console.log('[Worker] navigateBack');
    sendMessage('navigateBack', { delta: params.delta || 1 });
    if (params.success) params.success();
  },
  redirectTo: function (params) {
    var url = params.url;
    var queryIndex = url.indexOf('?');
    var cleanUrl = queryIndex >= 0 ? url.substring(0, queryIndex) : url;
    var queryStr = queryIndex >= 0 ? url.substring(queryIndex + 1) : '';
    var pagePath = cleanUrl.startsWith('/') ? cleanUrl.slice(1) : cleanUrl;
    if (pagePath.endsWith('/index')) {
      pagePath = pagePath.slice(0, -6);
    }
    var query = parseQuery(queryStr);
    console.log('[Worker] redirectTo:', params.url, '-> pagePath:', pagePath, 'query:', JSON.stringify(query));
    sendMessage('redirectTo', { path: pagePath });
    loadPage(pagePath, query);
    if (params.success) params.success();
  },
  getSystemInfoSync: function () {
    return {
      brand: 'MiniProgram',
      model: 'Electron',
      pixelRatio: 1,
      screenWidth: 375,
      screenHeight: 667,
      windowWidth: 375,
      windowHeight: 667,
      platform: 'devtools',
    };
  },
  showToast: function (params) {
    sendMessage('showToast', params);
  },
  getApp: function () {
    return { globalData: appMethods.globalData };
  },
};

self.getCurrentPages = function () {
  return Object.values(pageInstances);
};

var pendingFileRequests = {};
var requestIdCounter = 0;

function requestFile(relativePath) {
  return new Promise(function (resolve) {
    var id = ++requestIdCounter;
    pendingFileRequests[id] = resolve;
    sendMessage('readFile', { id: id, path: relativePath });
  });
}

var moduleCache = {};

function resolvePath(fromPath, requirePath) {
  if (requirePath.startsWith('/')) {
    var resolved = requirePath.slice(1);
  } else {
    var parts = fromPath.split('/');
    parts.pop();
    requirePath.split('/').forEach(function (seg) {
      if (seg === '..') {
        parts.pop();
      } else if (seg !== '.') {
        parts.push(seg);
      }
    });
    var resolved = parts.join('/');
  }
  if (!resolved.endsWith('.js')) {
    resolved += '.js';
  }
  return resolved;
}

function createRequire(fromPath) {
  return function require(requirePath) {
    var resolvedPath = resolvePath(fromPath, requirePath);

    if (moduleCache[resolvedPath] !== undefined) {
      return moduleCache[resolvedPath].exports;
    }

    var mod = { exports: {}, loaded: false };
    moduleCache[resolvedPath] = mod;

    var result = null;
    var requestId = ++requestIdCounter;
    var fulfilled = false;

    sendMessage('readFile', { id: requestId, path: resolvedPath });

    var listener = function (e) {
      var msg = e.data;
      if (msg.type === 'fileResponse' && msg.data.id === requestId) {
        self.removeEventListener('message', listener);
        result = msg.data.result;
        fulfilled = true;
      }
    };
    self.addEventListener('message', listener);

    var spin = function () {
      var done = false;
      var start = Date.now();
      while (!done && Date.now() - start < 5000) {
        // busy wait
      }
    };

    throw new Error(
      '[Worker] require("' + requirePath + '") from "' + fromPath + '" failed: ' +
      'synchronous require is not supported in async Worker. ' +
      'Use loadModuleAsync instead.'
    );
  };
}

async function loadModuleAsync(modulePath) {
  if (moduleCache[modulePath] !== undefined) {
    return moduleCache[modulePath].exports;
  }

  var result = await requestFile(modulePath);
  if (!result.success) {
    console.error('[Worker] Failed to load module:', modulePath, result.error);
    return {};
  }

  var mod = { exports: {}, loaded: false };
  moduleCache[modulePath] = mod;

  var moduleExports = {};
  var moduleRef = { exports: moduleExports };
  var localRequire = createRequire(modulePath);

  try {
    var fn = new Function('require', 'module', 'exports', result.content);
    fn(localRequire, moduleRef, moduleExports);
    mod.exports = moduleRef.exports;
    mod.loaded = true;
  } catch (err) {
    console.error('[Worker] Module execution error (' + modulePath + '):', err);
    mod.exports = {};
  }

  return mod.exports;
}

function executeScriptWithRequire(code, fromPath) {
  var moduleExports = {};
  var moduleRef = { exports: moduleExports };
  var localRequire = createRequire(fromPath);

  var pendingRequires = [];
  var syncRequire = function (p) {
    var resolved = resolvePath(fromPath, p);
    if (moduleCache[resolved] !== undefined) {
      return moduleCache[resolved].exports;
    }
    pendingRequires.push(resolved);
    return {};
  };

  try {
    var fn = new Function('require', 'module', 'exports', code);
    fn(syncRequire, moduleRef, moduleExports);
  } catch (err) {
    console.error('[Worker] Script execution error:', err);
    return;
  }

  return pendingRequires;
}

async function preloadModules(code, fromPath) {
  var requireRegex = /(?:const|let|var)\s+\w+\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  var match;
  var modules = [];

  while ((match = requireRegex.exec(code)) !== null) {
    var resolved = resolvePath(fromPath, match[1]);
    modules.push(resolved);
  }

  for (var i = 0; i < modules.length; i++) {
    await loadModuleAsync(modules[i]);
  }
}

function executeScript(code, fromPath) {
  var moduleExports = {};
  var moduleRef = { exports: moduleExports };
  var localRequire = createRequire(fromPath || '');

  try {
    var fn = new Function('require', 'module', 'exports', code);
    fn(localRequire, moduleRef, moduleExports);
  } catch (err) {
    console.error('[Worker] Script execution error:', err);
  }
}

function parseQuery(queryStr) {
  var query = {};
  if (!queryStr) return query;
  queryStr.split('&').forEach(function (pair) {
    var parts = pair.split('=');
    var key = decodeURIComponent(parts[0]);
    var value = parts.length > 1 ? decodeURIComponent(parts[1]) : '';
    query[key] = value;
  });
  return query;
}

var pendingQuery = null;

async function loadPageScript(pagePath) {
  var scriptPath = pagePath + '/index.js';
  var result = await requestFile(scriptPath);
  if (result.success) {
    currentPage = pagePath;
    await preloadModules(result.content, scriptPath);
    executeScript(result.content, scriptPath);
  } else {
    console.error('[Worker] Failed to load page script:', pagePath, result.error);
  }
}

async function loadPage(pagePath, query) {
  if (pageInstances[pagePath]) {
    if (typeof pageInstances[pagePath].onHide === 'function') {
      pageInstances[pagePath].onHide();
    }
  }

  pendingQuery = query || null;
  await loadPageScript(pagePath);
  pendingQuery = null;

  if (pageInstances[pagePath] && typeof pageInstances[pagePath].onShow === 'function') {
    pageInstances[pagePath].onShow();
  }
}

async function loadAppScript() {
  var result = await requestFile('app.js');
  if (result.success) {
    executeScript(result.content);
  }
}

self.onmessage = async function (e) {
  var msg = e.data;
  var type = msg.type;
  var data = msg.data;

  if (type === 'init') {
    appConfig = data.config;
    console.log('[Worker] Config loaded:', JSON.stringify(appConfig));

    await loadAppScript();

    if (typeof appMethods.onLaunch === 'function') {
      appMethods.onLaunch();
    }

    var firstPage = appConfig.pages[0];
    if (firstPage) {
      loadPage(firstPage);
    }
  }

  if (type === 'event') {
    var pagePath = data.pagePath;
    var eventName = data.eventName;
    var eventPayload = data.eventPayload;
    console.log('[Worker] Event received:', eventName, 'on page:', pagePath);

    var instance = pageInstances[pagePath];
    if (!instance) {
      console.warn('[Worker] No page instance for event:', pagePath, 'available:', Object.keys(pageInstances));
      return;
    }

    var handler = instance[eventName];
    if (typeof handler === 'function') {
      handler.call(instance, eventPayload || {});
    } else {
      console.warn('[Worker] No handler for event:', eventName, 'on page:', pagePath);
    }
  }

  if (type === 'loadPage') {
    loadPage(data.path);
  }

  if (type === 'notifyPageHide') {
    var hidePath = data.path;
    if (pageInstances[hidePath]) {
      if (typeof pageInstances[hidePath].onUnload === 'function') {
        pageInstances[hidePath].onUnload();
      }
      delete pageInstances[hidePath];
      console.log('[Worker] Page destroyed:', hidePath);
    }
  }

  if (type === 'notifyPageShow') {
    var showPath = data.path;
    if (pageInstances[showPath] && typeof pageInstances[showPath].onShow === 'function') {
      pageInstances[showPath].onShow();
    }
  }

  if (type === 'fileResponse') {
    var id = data.id;
    if (pendingFileRequests[id]) {
      pendingFileRequests[id](data.result);
      delete pendingFileRequests[id];
    }
  }
};
