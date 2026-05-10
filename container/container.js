const ipcRenderer = window.containerBridge;

let appConfig = null;
let appDir = null;
let worker = null;

const pageStack = [];
const pageViewIds = {};
const pageDataCache = {};
const pageComponentEventMaps = {};
const componentTemplateCache = {};
const componentStyleCache = {};
let globalAppStyle = "";

const NAV_HEIGHT = 44;
const ANIM_DURATION = 280;

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function convertWxssSelectors(css) {
  var output = css;
  output = output.replace(/(^|[\s{},>~+])view(?=[\s{},:>.~+\[]|$)/g, "$1div");
  output = output.replace(/(^|[\s{},>~+])text(?=[\s{},:>.~+\[]|$)/g, "$1span");
  output = output.replace(/(^|[\s{},>~+])image(?=[\s{},:>.~+\[]|$)/g, "$1img");
  return output;
}

function convertWxmlTags(html) {
  var temp = html;
  temp = temp.replace(/<image([^>]*?)\/?\s*>/gi, function (match, attrs) {
    var srcMatch = attrs.match(/src=["']([^"']*)["']/);
    var src = srcMatch ? srcMatch[1] : "";
    return '<img src="' + src + '" style="display:block;max-width:100%;" />';
  });
  temp = temp.replace(/<view(\s[^>]*)?>/gi, "<div$1>");
  temp = temp.replace(/<\/view>/gi, "</div>");
  temp = temp.replace(/<text(\s[^>]*)?>/gi, "<span$1>");
  temp = temp.replace(/<\/text>/gi, "</span>");
  return temp;
}

function resolveExpr(expr, data) {
  try {
    var keys = expr.trim().split(".");
    var value = data;
    for (var i = 0; i < keys.length; i++) {
      if (value == null) return null;
      value = value[keys[i]];
    }
    return value;
  } catch (e) {
    return null;
  }
}

function evaluateCondition(condition, data) {
  var expr = condition.trim();
  if (expr.startsWith("{{") && expr.endsWith("}}")) {
    expr = expr.slice(2, -2).trim();
  }
  var val = resolveExpr(expr, data);
  return !!val;
}

function processWxFor(tpl, data) {
  var output = tpl;
  output = output.replace(/<(\w+)([^>]*)\swx:for="([^"]*)"(?:\s+wx:for-item="([^"]*)")?(?:\s+wx:for-index="([^"]*)")?([^>]*)>([\s\S]*?)<\/\1>/g, function (match, tag, before, listExpr, itemName, indexName, after, content) {
    var expr = listExpr.trim();
    if (expr.startsWith("{{") && expr.endsWith("}}")) {
      expr = expr.slice(2, -2).trim();
    }
    var list = resolveExpr(expr, data);
    if (!Array.isArray(list)) return "";
    var item = itemName || "item";
    var index = indexName || "index";
    var result = "";
    for (var i = 0; i < list.length; i++) {
      var itemData = Object.assign({}, data);
      itemData[item] = list[i];
      itemData[index] = i;
      var rendered = content.replace(/\{\{(.*?)\}\}/g, function (m, e) {
        var value = resolveExpr(e.trim(), itemData);
        return value != null ? String(value) : "";
      });
      result += "<" + tag + before + after + ">" + rendered + "</" + tag + ">";
    }
    return result;
  });
  return output;
}

function processWxDirectives(tpl, data) {
  var output = tpl;
  output = processWxFor(output, data);
  output = output.replace(/<(\w+)([^>]*)\swx:if="([^"]*)"([^>]*)>([\s\S]*?)<\/\1>/g, function (match, tag, before, condition, after, content) {
    if (evaluateCondition(condition, data)) {
      return "<" + tag + before + after + ">" + content + "</" + tag + ">";
    }
    return "";
  });
  return output;
}

function renderTemplate(tpl, data) {
  if (!tpl || !data) return "";
  var output = tpl;
  output = processWxDirectives(output, data);
  output = output.replace(/\{\{(.*?)\}\}/g, function (match, expr) {
    var value = resolveExpr(expr, data);
    return value != null ? String(value) : "";
  });
  return convertWxmlTags(output);
}

async function loadComponentTemplates(pagePath) {
  var configPath = pagePath + "/index.json";
  var result = await ipcRenderer.invoke("read-file", configPath);
  if (!result.success) return;

  var pageConfig;
  try {
    pageConfig = JSON.parse(result.content);
  } catch (e) {
    return;
  }

  var usingComponents = pageConfig.usingComponents;
  if (!usingComponents || typeof usingComponents !== "object") return;

  var compNames = Object.keys(usingComponents);
  for (var i = 0; i < compNames.length; i++) {
    var compName = compNames[i];
    var compPath = usingComponents[compName];
    if (compPath.startsWith("/")) {
      compPath = compPath.slice(1);
    }

    if (componentTemplateCache[compPath]) continue;

    var tplPath = compPath + "/index.wxml";
    var stylePath = compPath + "/index.wxss";

    var [tplResult, styleResult] = await Promise.all([
      ipcRenderer.invoke("read-file", tplPath),
      ipcRenderer.invoke("read-file", stylePath),
    ]);

    componentTemplateCache[compPath] = tplResult.success ? tplResult.content : "";
    componentStyleCache[compPath] = styleResult.success ? styleResult.content : "";
  }
}

function resolveComponentTags(html, data, componentEventMap) {
  if (!componentEventMap || Object.keys(componentEventMap).length === 0) {
    return html;
  }

  var output = html;

  Object.keys(componentEventMap).forEach(function (compName) {
    var compInfo = componentEventMap[compName];
    var compPath = compInfo.path;
    var compTpl = componentTemplateCache[compPath];
    if (!compTpl) return;

    var compData = data["__comp_" + compName] || {};

    var compHtml = renderTemplate(compTpl, compData);

    var selfClosingRegex = new RegExp("<" + compName + "\\s([^>]*)/>", "g");
    var openCloseRegex = new RegExp("<" + compName + "\\s([^>]*)>([\\s\\S]*?)</" + compName + ">", "g");
    var bareTagRegex = new RegExp("<" + compName + "\\s?/>", "g");

    output = output.replace(selfClosingRegex, function (match, attrs) {
      var parsedAttrs = parseComponentAttrs(attrs);
      var mergedData = deepClone(compData);
      Object.keys(parsedAttrs).forEach(function (key) {
        if (mergedData.hasOwnProperty(key)) {
          mergedData[key] = resolveAttrValue(parsedAttrs[key], data);
        }
      });
      return '<div class="comp-' + compName + '" data-comp-name="' + compName + '">' +
        renderTemplate(compTpl, mergedData) +
        '</div>';
    });

    output = output.replace(openCloseRegex, function (match, attrs, slotContent) {
      var parsedAttrs = parseComponentAttrs(attrs);
      var mergedData = deepClone(compData);
      Object.keys(parsedAttrs).forEach(function (key) {
        if (mergedData.hasOwnProperty(key)) {
          mergedData[key] = resolveAttrValue(parsedAttrs[key], data);
        }
      });
      return '<div class="comp-' + compName + '" data-comp-name="' + compName + '">' +
        renderTemplate(compTpl, mergedData) +
        '</div>';
    });

    output = output.replace(bareTagRegex, function () {
      return '<div class="comp-' + compName + '" data-comp-name="' + compName + '">' +
        renderTemplate(compTpl, compData) +
        '</div>';
    });
  });

  return output;
}

function parseComponentAttrs(attrStr) {
  var attrs = {};
  if (!attrStr) return attrs;
  var regex = /(\w[\w-]*)\s*=\s*"([^"]*)"/g;
  var match;
  while ((match = regex.exec(attrStr)) !== null) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function resolveAttrValue(attrVal, pageData) {
  if (attrVal.startsWith("{{") && attrVal.endsWith("}}")) {
    var expr = attrVal.slice(2, -2).trim();
    var keys = expr.split(".");
    var value = pageData;
    for (var i = 0; i < keys.length; i++) {
      if (value == null) return attrVal;
      value = value[keys[i]];
    }
    return value != null ? value : attrVal;
  }
  return attrVal;
}

function collectComponentStyles(componentEventMap) {
  if (!componentEventMap) return "";
  var styles = "";
  Object.keys(componentEventMap).forEach(function (compName) {
    var compInfo = componentEventMap[compName];
    var compStyle = componentStyleCache[compInfo.path];
    if (compStyle) {
      var scopedCss = scopeCss(compStyle, ".comp-" + compName);
      styles += scopedCss + "\n";
    }
  });
  return styles;
}

function scopeCss(css, scopeSelector) {
  var output = css;
  output = convertWxssSelectors(output);
  output = output.replace(/([^{}]+)\{/g, function (match, selectors) {
    var scopedSelectors = selectors.split(",").map(function (sel) {
      sel = sel.trim();
      if (!sel) return sel;
      return scopeSelector + " " + sel;
    }).join(", ");
    return scopedSelectors + " {";
  });
  return output;
}

function getBounds(offsetX) {
  offsetX = offsetX || 0;
  return {
    x: offsetX,
    y: NAV_HEIGHT,
    width: window.innerWidth,
    height: window.innerHeight - NAV_HEIGHT,
  };
}

async function createPageView(pagePath) {
  const viewId = await ipcRenderer.invoke("create-page-view");
  pageViewIds[pagePath] = viewId;
  return viewId;
}

async function renderPageInView(viewId, pagePath, data, componentEventMap) {
  var tplPath = pagePath + "/index.wxml";
  var stylePath = pagePath + "/index.wxss";
  var configPath = pagePath + "/index.json";

  var [tplResult, styleResult, configResult] = await Promise.all([
    ipcRenderer.invoke("read-file", tplPath),
    ipcRenderer.invoke("read-file", stylePath),
    ipcRenderer.invoke("read-file", configPath),
  ]);

  var pageConfig = {};
  if (configResult.success) {
    try {
      pageConfig = JSON.parse(configResult.content);
    } catch (e) {}
  }

  var html = "";
  if (tplResult.success) {
    html = renderTemplate(tplResult.content, data);
    html = resolveComponentTags(html, data, componentEventMap);
  }

  var style = "";
  if (styleResult.success) {
    style = convertWxssSelectors(styleResult.content);
  }

  var compStyles = collectComponentStyles(componentEventMap);
  style = compStyles + style;

  ipcRenderer.send("send-to-page-view", {
    viewId,
    channel: "render",
    data: { html, style, globalStyle: globalAppStyle },
  });

  return pageConfig;
}

function updateNavBar(pageConfig) {
  var navTitle = document.getElementById("nav-title");
  var navBack = document.getElementById("nav-back");
  if (navTitle) {
    navTitle.textContent =
      pageConfig.navigationBarTitleText ||
      (appConfig.window && appConfig.window.navigationBarTitleText) ||
      "";
  }
  if (navBack) {
    navBack.style.display = pageStack.length > 1 ? "flex" : "none";
  }
}

function setViewBounds(pagePath, bounds) {
  var viewId = pageViewIds[pagePath];
  if (viewId) {
    ipcRenderer.send("set-page-view-bounds", { viewId, bounds: bounds });
  }
}

function showPage(pagePath) {
  var viewId = pageViewIds[pagePath];
  if (viewId) {
    ipcRenderer.send("show-page-view", { viewId });
    ipcRenderer.send("set-page-view-bounds", { viewId, bounds: getBounds() });
  }
}

function hidePage(pagePath) {
  var viewId = pageViewIds[pagePath];
  if (viewId) {
    ipcRenderer.send("hide-page-view", { viewId });
  }
}

function destroyPage(pagePath) {
  var viewId = pageViewIds[pagePath];
  if (viewId) {
    ipcRenderer.send("destroy-page-view", { viewId });
    delete pageViewIds[pagePath];
    delete pageDataCache[pagePath];
    delete pageComponentEventMaps[pagePath];
  }
}

function animateSlideIn(newPage, oldPage, pageConfig) {
  var screenWidth = window.innerWidth;

  setViewBounds(newPage, getBounds(screenWidth));

  showPage(newPage);

  if (oldPage) {
    showPage(oldPage);
  }

  var startTime = null;

  function step(timestamp) {
    if (!startTime) startTime = timestamp;
    var elapsed = timestamp - startTime;
    var progress = Math.min(elapsed / ANIM_DURATION, 1);

    var eased = 1 - Math.pow(1 - progress, 3);
    var offset = screenWidth * (1 - eased);

    setViewBounds(newPage, getBounds(offset));

    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      setViewBounds(newPage, getBounds(0));
      updateNavBar(pageConfig);
    }
  }

  requestAnimationFrame(step);
}

function animateSlideOut(topPage, bottomPage, callback) {
  var screenWidth = window.innerWidth;

  showPage(topPage);
  if (bottomPage) {
    showPage(bottomPage);
  }

  var startTime = null;

  function step(timestamp) {
    if (!startTime) startTime = timestamp;
    var elapsed = timestamp - startTime;
    var progress = Math.min(elapsed / ANIM_DURATION, 1);

    var eased = 1 - Math.pow(1 - progress, 3);
    var offset = screenWidth * eased;

    setViewBounds(topPage, getBounds(offset));

    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      hidePage(topPage);
      destroyPage(topPage);
      if (bottomPage) {
        setViewBounds(bottomPage, getBounds(0));
      }
      if (callback) callback();
    }
  }

  requestAnimationFrame(step);
}

function handleNavigateBack(delta) {
  if (pageStack.length <= 1) return;
  delta = delta || 1;

  var topPage = pageStack.pop();
  var bottomPage = pageStack[pageStack.length - 1];

  worker.postMessage({ type: "notifyPageHide", data: { path: topPage } });

  animateSlideOut(topPage, bottomPage, function () {
    if (bottomPage) {
      var configPath = bottomPage + "/index.json";
      ipcRenderer.invoke("read-file", configPath).then(function (result) {
        var pc = {};
        if (result.success) {
          try {
            pc = JSON.parse(result.content);
          } catch (e) {}
        }
        updateNavBar(pc);
      });

      worker.postMessage({
        type: "notifyPageShow",
        data: { path: bottomPage },
      });
    }
  });
}

document.getElementById("nav-back").addEventListener("click", function () {
  handleNavigateBack(1);
});

window.addEventListener("resize", function () {
  var current = pageStack[pageStack.length - 1];
  if (current) {
    setViewBounds(current, getBounds(0));
  }
});

ipcRenderer.onPageViewEvent(function (msg) {
  var viewId = msg.viewId;
  var eventName = msg.eventName;
  var eventPayload = msg.eventPayload;

  var currentPath = pageStack[pageStack.length - 1];
  if (!currentPath) return;

  var compName = null;
  if (eventPayload && eventPayload.target && eventPayload.target.dataset && eventPayload.target.dataset.compName) {
    compName = eventPayload.target.dataset.compName;
  }

  console.log("[Container] Event from view:", eventName, "page:", currentPath, "component:", compName || "page");

  worker.postMessage({
    type: "event",
    data: {
      pagePath: currentPath,
      eventName: eventName,
      eventPayload: eventPayload,
      compName: compName,
    },
  });
});

function initWorker(bundlePath) {
  var workerUrl = new URL("file:///" + bundlePath.replace(/\\/g, "/"));
  worker = new Worker(workerUrl);

  worker.onmessage = function (e) {
    handleWorkerMessage(e.data);
  };

  worker.onerror = function (err) {
    console.error("[Container] Worker error:", err);
  };
}

var navigatingTo = null;

var messageHandlers = {
  pageReady: async (msg) => {
    var data = msg.data;
    var pagePath = data.path;
    var pageData = data.data;
    var componentEventMap = data.componentEventMap || {};

    pageDataCache[pagePath] = deepClone(pageData);
    pageComponentEventMaps[pagePath] = componentEventMap;

    await loadComponentTemplates(pagePath);

    var viewId = await createPageView(pagePath);

    ipcRenderer.send("set-page-view-bounds", {
      viewId,
      bounds: getBounds(window.innerWidth),
    });
    ipcRenderer.send("hide-page-view", { viewId });

    var pageConfig = await renderPageInView(viewId, pagePath, pageData, componentEventMap);

    var isNavigateTo = navigatingTo === pagePath;
    navigatingTo = null;

    if (isNavigateTo && pageStack.length > 0) {
      pageStack.push(pagePath);
      var oldPage = pageStack[pageStack.length - 2];
      animateSlideIn(pagePath, oldPage, pageConfig);
    } else {
      pageStack.push(pagePath);
      setViewBounds(pagePath, getBounds(0));
      showPage(pagePath);
      updateNavBar(pageConfig);
    }

    console.log(
      "[Container] Page ready:",
      pagePath,
      "stack:",
      JSON.stringify(pageStack),
    );
  },
  setData: async (msg) => {
    var data = msg.data;

    var pagePath = data.path;
    var fullData = data.fullData;

    pageDataCache[pagePath] = deepClone(fullData);

    var viewId = pageViewIds[pagePath];
    if (viewId) {
      var componentEventMap = pageComponentEventMaps[pagePath] || {};
      await renderPageInView(viewId, pagePath, fullData, componentEventMap);
      console.log("[Container] Data updated:", pagePath);
    }
  },
  navigateTo: async (msg) => {
    var data = msg.data;

    navigatingTo = data.path;
    console.log("[Container] navigateTo:", data.path);
  },
  navigateBack: async (msg) => {
    var data = msg.data;
    handleNavigateBack(data.delta);
  },
  showToast: (msg) => {
    var data = msg.data;
    var currentPath = pageStack[pageStack.length - 1];
    var viewId = pageViewIds[currentPath];
    if (viewId) {
      ipcRenderer.send("send-to-page-view", {
        viewId: viewId,
        channel: "render",
        data: {
          showToast: true,
          toastTitle: data.title,
          toastDuration: data.duration,
        },
      });
    }
  },
  showNotification: async (msg) => {
    var data = msg.data;
    if (Notification.permission === "granted") {
      new Notification(data.title || "Notification", {
        body: data.body || "",
        icon: data.icon || "",
        tag: data.tag || "",
      });
    } else if (Notification.permission !== "denied") {
      Notification.requestPermission().then(function (perm) {
        if (perm === "granted") {
          new Notification(data.title || "Notification", {
            body: data.body || "",
            icon: data.icon || "",
            tag: data.tag || "",
          });
        }
      });
    }
  },
  readFile: async (msg) => {
    var data = msg.data;
    var id = data.id;
    var filePath = data.path;
    var result = await ipcRenderer.invoke("read-file", filePath);
    worker.postMessage({
      type: "fileResponse",
      data: { id: id, result: result },
    });
  },
  chooseFile: async (msg) => {
    var data = msg.data;
    var id = data.id;
    var result = await ipcRenderer.invoke("show-open-dialog", {
      title: data.title,
      filters: data.filters,
      multiple: data.multiple,
    });
    worker.postMessage({
      type: "chooseFileResponse",
      data: {
        id: id,
        cancelled: result.cancelled,
        filePaths: result.filePaths || [],
      },
    });
  },
};

async function handleWorkerMessage(msg) {
  var type = msg.type;
  var handler = messageHandlers[type];

  if (handler) {
    await handler(msg);
  } else {
    console.error("[Container] Unknown message type:", type);
  }
}

async function loadAppStyles() {
  var result = await ipcRenderer.invoke("read-file", "app.wxss");
  if (result.success) {
    globalAppStyle = convertWxssSelectors(result.content);
    var style = document.createElement("style");
    style.id = "app-style";
    style.textContent = globalAppStyle;
    document.head.appendChild(style);
  }
}

ipcRenderer.onInitContainer(async function (initData) {
  appConfig = initData.config;
  appDir = initData.appDir;

  console.log("[Container] Config loaded:", JSON.stringify(appConfig));

  await loadAppStyles();

  var bundlePath = await ipcRenderer.invoke("build-worker-bundle");

  initWorker(bundlePath);

  worker.postMessage({ type: "init", data: { config: appConfig } });
});
