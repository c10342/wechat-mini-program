"use strict";

let appConfig = null;
let currentPage = null;
let pageInstances = {};
const componentDefinitions = {};
const componentInstances = {};
const pageComponentRegistry = {};

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

function createComponentInstance(compPath, compDef, parentPage, props) {
  props = props || {};
  var instance = {
    __path__: compPath,
    __define__: compDef,
    __parentPage__: parentPage,
    __isComponent__: true,
    data: deepClone(compDef.data || {}),
    properties: {},
    setData: function (newData, callback) {
      if (typeof newData !== "object" || !newData) return;
      Object.assign(instance.data, newData);
      if (compDef.observers) {
        Object.keys(compDef.observers).forEach(function (field) {
          if (newData.hasOwnProperty(field)) {
            compDef.observers[field].call(instance, newData[field]);
          }
        });
      }
      notifyPageDataUpdate(parentPage);
      if (typeof callback === "function") callback();
    },
    triggerEvent: function (eventName, detail) {
      var pageInstance = pageInstances[parentPage];
      if (!pageInstance) return;
      var handlerName = "on" + eventName.charAt(0).toUpperCase() + eventName.slice(1);
      if (typeof pageInstance[handlerName] === "function") {
        pageInstance[handlerName].call(pageInstance, detail || {});
      }
    },
  };

  if (compDef.properties) {
    Object.keys(compDef.properties).forEach(function (propName) {
      var propDef = compDef.properties[propName];
      var value = props.hasOwnProperty(propName) ? props[propName] : (propDef.value !== undefined ? propDef.value : null);
      instance.properties[propName] = value;
      if (!instance.data.hasOwnProperty(propName)) {
        instance.data[propName] = value;
      }
    });
  }

  var reservedKeys = ["data", "methods", "properties", "observers", "lifetimes", "created", "attached", "ready", "moved", "detached"];
  Object.keys(compDef).forEach(function (key) {
    if (reservedKeys.indexOf(key) !== -1) return;
    if (typeof compDef[key] === "function") {
      instance[key] = function () {
        var args = Array.prototype.slice.call(arguments);
        return compDef[key].apply(instance, args);
      };
    }
  });

  if (compDef.methods) {
    Object.keys(compDef.methods).forEach(function (methodName) {
      if (typeof compDef.methods[methodName] === "function") {
        instance[methodName] = function () {
          var args = Array.prototype.slice.call(arguments);
          return compDef.methods[methodName].apply(instance, args);
        };
      }
    });
  }

  if (compDef.lifetimes) {
    if (typeof compDef.lifetimes.created === "function") {
      compDef.lifetimes.created.call(instance);
    }
  }

  return instance;
}

function notifyPageDataUpdate(pagePath) {
  var pageInstance = pageInstances[pagePath];
  if (!pageInstance) return;

  var mergedData = deepClone(pageInstance.data);
  var pageComps = pageComponentRegistry[pagePath];
  if (pageComps) {
    Object.keys(pageComps).forEach(function (compName) {
      var compInfo = pageComps[compName];
      var compInstance = componentInstances[compInfo.uid];
      if (compInstance) {
        mergedData["__comp_" + compName] = deepClone(compInstance.data);
      }
    });
  }

  sendMessage("setData", {
    path: pagePath,
    data: mergedData,
    fullData: deepClone(mergedData),
  });
}

function createPageInstance(pagePath, pageDefine) {
  var instance = {
    __path__: pagePath,
    __define__: pageDefine,
    data: deepClone(pageDefine.data || {}),
    setData: function (newData, callback) {
      if (typeof newData !== "object" || !newData) return;
      Object.assign(instance.data, newData);

      var pageComps = pageComponentRegistry[pagePath];
      if (pageComps) {
        Object.keys(pageComps).forEach(function (compName) {
          var compInfo = pageComps[compName];
          var compInstance = componentInstances[compInfo.uid];
          if (!compInstance || !compInfo.definition.properties) return;

          var updatedProps = {};
          Object.keys(compInfo.definition.properties).forEach(function (propName) {
            if (newData[propName] !== undefined) {
              compInstance.properties[propName] = newData[propName];
              compInstance.data[propName] = newData[propName];
              updatedProps[propName] = newData[propName];
            }
          });

          if (Object.keys(updatedProps).length > 0 && compInfo.definition.observers) {
            Object.keys(compInfo.definition.observers).forEach(function (field) {
              if (updatedProps.hasOwnProperty(field)) {
                compInfo.definition.observers[field].call(compInstance, updatedProps[field]);
              }
            });
          }
        });
      }

      var mergedData = deepClone(instance.data);
      if (pageComps) {
        Object.keys(pageComps).forEach(function (compName) {
          var compInfo = pageComps[compName];
          var compInstance = componentInstances[compInfo.uid];
          if (compInstance) {
            mergedData["__comp_" + compName] = deepClone(compInstance.data);
          }
        });
      }
      sendMessage("setData", {
        path: pagePath,
        data: mergedData,
        fullData: deepClone(mergedData),
      });
      if (typeof callback === "function") callback();
    },
  };

  var reservedKeys = ["data", "methods"];
  Object.keys(pageDefine).forEach(function (key) {
    if (reservedKeys.indexOf(key) !== -1) return;
    if (typeof pageDefine[key] === "function") {
      instance[key] = function () {
        var args = Array.prototype.slice.call(arguments);
        return pageDefine[key].apply(instance, args);
      };
    }
  });

  if (pageDefine.methods) {
    Object.keys(pageDefine.methods).forEach(function (methodName) {
      if (typeof pageDefine.methods[methodName] === "function") {
        instance[methodName] = function () {
          var args = Array.prototype.slice.call(arguments);
          return pageDefine.methods[methodName].apply(instance, args);
        };
      }
    });
  }

  return instance;
}

self.Component = function (options) {
  var compPath = "__pending_component__";
  componentDefinitions[compPath] = options;
  console.log("[Worker] Component registered (pending path)");
};

function registerComponentAtPath(compPath, options) {
  componentDefinitions[compPath] = options;
  console.log("[Worker] Component registered:", compPath);
}

async function loadComponentScript(compPath) {
  if (componentDefinitions[compPath]) {
    return componentDefinitions[compPath];
  }

  var scriptPath = compPath + "/index.js";
  var result = await requestFile(scriptPath);
  if (!result.success) {
    console.error("[Worker] Failed to load component script:", compPath, result.error);
    return null;
  }

  var pendingCompKey = "__pending_component__";
  delete componentDefinitions[pendingCompKey];

  await preloadModules(result.content, scriptPath);
  executeScriptForComponent(result.content, scriptPath);

  var compDef = componentDefinitions[pendingCompKey] || null;
  if (compDef) {
    delete componentDefinitions[pendingCompKey];
    registerComponentAtPath(compPath, compDef);
  }

  return compDef;
}

function executeScriptForComponent(code, fromPath) {
  var moduleExports = {};
  var moduleRef = { exports: moduleExports };
  var localRequire = createRequire(fromPath || "");

  try {
    var fn = new Function("require", "module", "exports", code);
    fn(localRequire, moduleRef, moduleExports);
  } catch (err) {
    console.error("[Worker] Component script execution error:", err);
  }
}

async function loadPageComponents(pagePath) {
  var configPath = pagePath + "/index.json";
  var result = await requestFile(configPath);
  if (!result.success) return;

  var pageConfig;
  try {
    pageConfig = JSON.parse(result.content);
  } catch (e) {
    return;
  }

  var usingComponents = pageConfig.usingComponents;
  if (!usingComponents || typeof usingComponents !== "object") return;

  if (!pageComponentRegistry[pagePath]) {
    pageComponentRegistry[pagePath] = {};
  }

  var compNames = Object.keys(usingComponents);
  for (var i = 0; i < compNames.length; i++) {
    var compName = compNames[i];
    var compPath = usingComponents[compName];
    if (compPath.startsWith("/")) {
      compPath = compPath.slice(1);
    }

    var compDef = await loadComponentScript(compPath);
    if (!compDef) {
      console.error("[Worker] Failed to load component:", compName, "at", compPath);
      continue;
    }

    var uid = pagePath + "::" + compName;
    pageComponentRegistry[pagePath][compName] = {
      path: compPath,
      uid: uid,
      definition: compDef,
    };

    console.log("[Worker] Component loaded:", compName, "->", compPath);
  }
}

function initializeComponentInstances(pagePath, pageData) {
  var pageComps = pageComponentRegistry[pagePath];
  if (!pageComps) return;

  Object.keys(pageComps).forEach(function (compName) {
    var compInfo = pageComps[compName];
    var props = {};

    if (compInfo.definition.properties) {
      Object.keys(compInfo.definition.properties).forEach(function (propName) {
        var dataKey = compName + "." + propName;
        if (pageData && pageData[dataKey] !== undefined) {
          props[propName] = pageData[dataKey];
        }
      });
    }

    var instance = createComponentInstance(compInfo.path, compInfo.definition, pagePath, props);
    componentInstances[compInfo.uid] = instance;

    if (compInfo.definition.lifetimes && typeof compInfo.definition.lifetimes.attached === "function") {
      compInfo.definition.lifetimes.attached.call(instance);
    }
  });
}

function getComponentEventMap(pagePath) {
  var pageComps = pageComponentRegistry[pagePath];
  if (!pageComps) return {};

  var eventMap = {};
  Object.keys(pageComps).forEach(function (compName) {
    var compInfo = pageComps[compName];
    var compInstance = componentInstances[compInfo.uid];
    if (!compInstance) return;

    var methods = compInfo.definition.methods || {};
    var methodNames = Object.keys(methods).filter(function (k) {
      return typeof methods[k] === "function";
    });

    eventMap[compName] = {
      uid: compInfo.uid,
      path: compInfo.path,
      methods: methodNames,
    };
  });

  return eventMap;
}

self.App = function (options) {
  if (options.globalData) {
    appMethods.globalData = options.globalData;
  }
  ["onLaunch", "onShow", "onHide"].forEach(function (hook) {
    if (typeof options[hook] === "function") {
      appMethods[hook] = options[hook];
    }
  });
  console.log("[Worker] App registered");
};

self.Page = function (options) {
  if (!currentPage) {
    console.warn("[Worker] Page called without active page context");
    return;
  }

  var pagePath = currentPage;
  var instance = createPageInstance(pagePath, options);
  pageInstances[pagePath] = instance;

  initializeComponentInstances(pagePath, instance.data);

  var mergedData = deepClone(instance.data);
  var pageComps = pageComponentRegistry[pagePath];
  if (pageComps) {
    Object.keys(pageComps).forEach(function (compName) {
      var compInfo = pageComps[compName];
      var compInstance = componentInstances[compInfo.uid];
      if (compInstance) {
        mergedData["__comp_" + compName] = deepClone(compInstance.data);
      }
    });
  }

  console.log(
    "[Worker] Page registered:",
    pagePath,
    "data:",
    JSON.stringify(instance.data),
  );
  console.log(
    "[Worker] Page methods:",
    Object.keys(instance).filter(function (k) {
      return typeof instance[k] === "function";
    }),
  );

  if (typeof instance.onLoad === "function") {
    instance.onLoad(pendingQuery || {});
  }

  mergedData = deepClone(instance.data);
  pageComps = pageComponentRegistry[pagePath];
  if (pageComps) {
    Object.keys(pageComps).forEach(function (compName) {
      var compInfo = pageComps[compName];
      var compInstance = componentInstances[compInfo.uid];
      if (compInstance) {
        mergedData["__comp_" + compName] = deepClone(compInstance.data);
      }
    });
  }

  sendMessage("pageReady", {
    path: pagePath,
    data: deepClone(mergedData),
    componentEventMap: getComponentEventMap(pagePath),
  });
};

self.wx = {
  navigateTo: function (params) {
    var url = params.url;
    var queryIndex = url.indexOf("?");
    var cleanUrl = queryIndex >= 0 ? url.substring(0, queryIndex) : url;
    var queryStr = queryIndex >= 0 ? url.substring(queryIndex + 1) : "";
    var pagePath = cleanUrl.startsWith("/") ? cleanUrl.slice(1) : cleanUrl;
    if (pagePath.endsWith("/index")) {
      pagePath = pagePath.slice(0, -6);
    }
    var query = parseQuery(queryStr);
    console.log(
      "[Worker] navigateTo:",
      params.url,
      "-> pagePath:",
      pagePath,
      "query:",
      JSON.stringify(query),
    );
    sendMessage("navigateTo", { path: pagePath });
    loadPage(pagePath, query);
    if (params.success) params.success();
  },
  navigateBack: function (params) {
    console.log("[Worker] navigateBack");
    sendMessage("navigateBack", { delta: params.delta || 1 });
    if (params.success) params.success();
  },
  redirectTo: function (params) {
    var url = params.url;
    var queryIndex = url.indexOf("?");
    var cleanUrl = queryIndex >= 0 ? url.substring(0, queryIndex) : url;
    var queryStr = queryIndex >= 0 ? url.substring(queryIndex + 1) : "";
    var pagePath = cleanUrl.startsWith("/") ? cleanUrl.slice(1) : cleanUrl;
    if (pagePath.endsWith("/index")) {
      pagePath = pagePath.slice(0, -6);
    }
    var query = parseQuery(queryStr);
    console.log(
      "[Worker] redirectTo:",
      params.url,
      "-> pagePath:",
      pagePath,
      "query:",
      JSON.stringify(query),
    );
    sendMessage("redirectTo", { path: pagePath });
    loadPage(pagePath, query);
    if (params.success) params.success();
  },
  getSystemInfoSync: function () {
    return {
      brand: "MiniProgram",
      model: "Electron",
      pixelRatio: 1,
      screenWidth: 375,
      screenHeight: 667,
      windowWidth: 375,
      windowHeight: 667,
      platform: "devtools",
    };
  },
  showToast: function (params) {
    sendMessage("showToast", params);
  },
  showNotification: function (params) {
    sendMessage("showNotification", {
      title: params.title || "",
      body: params.body || "",
      icon: params.icon || "",
      tag: params.tag || "",
    });
    if (params.success) params.success();
  },
  chooseFile: function (params) {
    params = params || {};
    var id = ++requestIdCounter;
    pendingChooseFileCallbacks[id] = {
      success: params.success || null,
      fail: params.fail || null,
    };
    sendMessage("chooseFile", {
      id: id,
      title: params.title || "Select File",
      filters: params.filters || [],
      multiple: params.multiple || false,
    });
  },
  getApp: function () {
    return { globalData: appMethods.globalData };
  },
};

self.getCurrentPages = function () {
  return Object.values(pageInstances);
};

var pendingFileRequests = {};
var pendingChooseFileCallbacks = {};
var requestIdCounter = 0;

function requestFile(relativePath) {
  return new Promise(function (resolve) {
    var id = ++requestIdCounter;
    pendingFileRequests[id] = resolve;
    sendMessage("readFile", { id: id, path: relativePath });
  });
}

var moduleCache = {};

function resolvePath(fromPath, requirePath) {
  if (requirePath.startsWith("/")) {
    var resolved = requirePath.slice(1);
  } else {
    var parts = fromPath.split("/");
    parts.pop();
    requirePath.split("/").forEach(function (seg) {
      if (seg === "..") {
        parts.pop();
      } else if (seg !== ".") {
        parts.push(seg);
      }
    });
    var resolved = parts.join("/");
  }
  if (!resolved.endsWith(".js")) {
    resolved += ".js";
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

    sendMessage("readFile", { id: requestId, path: resolvedPath });

    var listener = function (e) {
      var msg = e.data;
      if (msg.type === "fileResponse" && msg.data.id === requestId) {
        self.removeEventListener("message", listener);
        result = msg.data.result;
        fulfilled = true;
      }
    };
    self.addEventListener("message", listener);

    throw new Error(
      '[Worker] require("' +
        requirePath +
        '") from "' +
        fromPath +
        '" failed: ' +
        "synchronous require is not supported in async Worker. " +
        "Use loadModuleAsync instead.",
    );
  };
}

async function loadModuleAsync(modulePath) {
  if (moduleCache[modulePath] !== undefined) {
    return moduleCache[modulePath].exports;
  }

  var result = await requestFile(modulePath);
  if (!result.success) {
    console.error("[Worker] Failed to load module:", modulePath, result.error);
    return {};
  }

  var mod = { exports: {}, loaded: false };
  moduleCache[modulePath] = mod;

  var moduleExports = {};
  var moduleRef = { exports: moduleExports };
  var localRequire = createRequire(modulePath);

  try {
    var fn = new Function("require", "module", "exports", result.content);
    fn(localRequire, moduleRef, moduleExports);
    mod.exports = moduleRef.exports;
    mod.loaded = true;
  } catch (err) {
    console.error("[Worker] Module execution error (" + modulePath + "):", err);
    mod.exports = {};
  }

  return mod.exports;
}

function executeScriptWithRequire(code, fromPath) {
  var moduleExports = {};
  var moduleRef = { exports: moduleExports };

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
    var fn = new Function("require", "module", "exports", code);
    fn(syncRequire, moduleRef, moduleExports);
  } catch (err) {
    console.error("[Worker] Script execution error:", err);
    return;
  }

  return pendingRequires;
}

async function preloadModules(code, fromPath) {
  var requireRegex =
    /(?:const|let|var)\s+\w+\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
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
  var localRequire = createRequire(fromPath || "");

  try {
    var fn = new Function("require", "module", "exports", code);
    fn(localRequire, moduleRef, moduleExports);
  } catch (err) {
    console.error("[Worker] Script execution error:", err);
  }
}

function parseQuery(queryStr) {
  var query = {};
  if (!queryStr) return query;
  queryStr.split("&").forEach(function (pair) {
    var parts = pair.split("=");
    var key = decodeURIComponent(parts[0]);
    var value = parts.length > 1 ? decodeURIComponent(parts[1]) : "";
    query[key] = value;
  });
  return query;
}

var pendingQuery = null;

async function loadPageScript(pagePath) {
  var scriptPath = pagePath + "/index.js";
  var result = await requestFile(scriptPath);
  if (result.success) {
    currentPage = pagePath;

    await loadPageComponents(pagePath);

    await preloadModules(result.content, scriptPath);
    executeScript(result.content, scriptPath);
  } else {
    console.error(
      "[Worker] Failed to load page script:",
      pagePath,
      result.error,
    );
  }
}

async function loadPage(pagePath, query) {
  if (pageInstances[pagePath]) {
    if (typeof pageInstances[pagePath].onHide === "function") {
      pageInstances[pagePath].onHide();
    }
  }

  pendingQuery = query || null;
  await loadPageScript(pagePath);
  pendingQuery = null;

  if (
    pageInstances[pagePath] &&
    typeof pageInstances[pagePath].onShow === "function"
  ) {
    pageInstances[pagePath].onShow();
  }
}

async function loadAppScript() {
  var result = await requestFile("app.js");
  if (result.success) {
    executeScript(result.content);
  }
}

function handleComponentEvent(pagePath, compName, eventName, eventPayload) {
  var pageComps = pageComponentRegistry[pagePath];
  if (!pageComps || !pageComps[compName]) {
    console.warn("[Worker] Unknown component:", compName, "on page:", pagePath);
    return;
  }

  var compInfo = pageComps[compName];
  var compInstance = componentInstances[compInfo.uid];
  if (!compInstance) {
    console.warn("[Worker] No component instance:", compName);
    return;
  }

  var handler = compInstance[eventName];
  if (typeof handler === "function") {
    handler.call(compInstance, eventPayload || {});
  } else {
    console.warn("[Worker] No handler for event:", eventName, "on component:", compName);
  }
}

var messageHandlers = {
  init: async (msg) => {
    var data = msg.data;
    appConfig = data.config;
    console.log("[Worker] Config loaded:", JSON.stringify(appConfig));

    await loadAppScript();

    if (typeof appMethods.onLaunch === "function") {
      appMethods.onLaunch();
    }

    var firstPage = appConfig.pages[0];
    if (firstPage) {
      loadPage(firstPage);
    }
  },
  event: async (msg) => {
    var data = msg.data;
    var pagePath = data.pagePath;
    var eventName = data.eventName;
    var eventPayload = data.eventPayload;
    var compName = data.compName;

    if (compName) {
      handleComponentEvent(pagePath, compName, eventName, eventPayload);
      return;
    }

    console.log("[Worker] Event received:", eventName, "on page:", pagePath);

    var instance = pageInstances[pagePath];
    if (!instance) {
      console.warn(
        "[Worker] No page instance for event:",
        pagePath,
        "available:",
        Object.keys(pageInstances),
      );
      return;
    }

    var handler = instance[eventName];
    if (typeof handler === "function") {
      handler.call(instance, eventPayload || {});
    } else {
      console.warn(
        "[Worker] No handler for event:",
        eventName,
        "on page:",
        pagePath,
      );
    }
  },
  loadPage: async (msg) => {
    var data = msg.data;
    loadPage(data.path);
  },
  notifyPageHide: async (msg) => {
    var data = msg.data;
    var hidePath = data.path;
    if (pageInstances[hidePath]) {
      if (typeof pageInstances[hidePath].onUnload === "function") {
        pageInstances[hidePath].onUnload();
      }

      var pageComps = pageComponentRegistry[hidePath];
      if (pageComps) {
        Object.keys(pageComps).forEach(function (compName) {
          var compInfo = pageComps[compName];
          var compInstance = componentInstances[compInfo.uid];
          if (compInstance && compInfo.definition.lifetimes && typeof compInfo.definition.lifetimes.detached === "function") {
            compInfo.definition.lifetimes.detached.call(compInstance);
          }
          delete componentInstances[compInfo.uid];
        });
      }

      delete pageInstances[hidePath];
      delete pageComponentRegistry[hidePath];
      console.log("[Worker] Page destroyed:", hidePath);
    }
  },
  notifyPageShow: async (msg) => {
    var data = msg.data;
    var showPath = data.path;
    if (
      pageInstances[showPath] &&
      typeof pageInstances[showPath].onShow === "function"
    ) {
      pageInstances[showPath].onShow();
    }
  },
  fileResponse: async (msg) => {
    var data = msg.data;
    var id = data.id;
    if (pendingFileRequests[id]) {
      pendingFileRequests[id](data.result);
      delete pendingFileRequests[id];
    }
  },
  chooseFileResponse: async (msg) => {
    var data = msg.data;
    var respId = data.id;
    var cb = pendingChooseFileCallbacks[respId];
    if (cb) {
      if (data.cancelled) {
        if (cb.fail) cb.fail({ errMsg: "cancelled" });
      } else {
        if (cb.success) cb.success({ filePaths: data.filePaths });
      }
      delete pendingChooseFileCallbacks[respId];
    }
  },
};

self.onmessage = async function (e) {
  var msg = e.data;
  var type = msg.type;
  if (messageHandlers[type]) {
    await messageHandlers[type](msg);
  } else {
    console.warn("[Worker] Unknown message type:", type);
  }
};
