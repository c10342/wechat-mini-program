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
const elementNameToCompName = {};
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
  var compMatch = expr.match(/^(.+?)\s*(===|!==|>=|<=|>|<)\s*(.+)$/);
  if (compMatch) {
    var left = resolveExpr(compMatch[1].trim(), data);
    var op = compMatch[2];
    var rightRaw = compMatch[3].trim();
    var right;
    if (
      (rightRaw.startsWith('"') && rightRaw.endsWith('"')) ||
      (rightRaw.startsWith("'") && rightRaw.endsWith("'"))
    ) {
      right = rightRaw.slice(1, -1);
    } else if (rightRaw === "true") {
      right = true;
    } else if (rightRaw === "false") {
      right = false;
    } else if (rightRaw === "null") {
      right = null;
    } else if (/^-?\d+(\.\d+)?$/.test(rightRaw)) {
      right = Number(rightRaw);
    } else {
      right = resolveExpr(rightRaw, data);
    }
    switch (op) {
      case "===": return left === right;
      case "!==": return left !== right;
      case ">=": return left >= right;
      case "<=": return left <= right;
      case ">": return left > right;
      case "<": return left < right;
    }
  }
  var val = resolveExpr(expr, data);
  return !!val;
}

function processWxFor(tpl, data) {
  var output = tpl;
  output = output.replace(/<(\w+[\w-]*)([^>]*)\swx:for="([^"]*)"(?:\s+wx:for-item="([^"]*)")?(?:\s+wx:for-index="([^"]*)")?([^>]*)>([\s\S]*?)<\/\1>/g, function (match, tag, before, listExpr, itemName, indexName, after, content) {
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

function processWxIf(tpl, data) {
  var output = tpl;
  var changed = true;
  while (changed) {
    changed = false;
    var ifRegex = /<(\w+[\w-]*)([^>]*)\swx:if="([^"]*)"([^>]*)>([\s\S]*?)<\/\1>/;
    var match = ifRegex.exec(output);
    if (!match) break;

    var tag = match[1];
    var chainStart = match.index;
    var chainEnd = chainStart + match[0].length;

    var blocks = [];
    blocks.push({ condition: match[3], before: match[2], after: match[4], content: match[5] });

    var remaining = output.substring(chainEnd);

    var elifRegex = new RegExp(
      "^\\s*<" + tag.replace(/-/g, "\\-") + "([^>]*)\\s+wx:elif=\"([^\"]*)\"([^>]*)>([\\s\\S]*?)<" + tag.replace(/-/g, "\\-") + ">"
    );
    while (true) {
      var elifMatch = remaining.match(elifRegex);
      if (!elifMatch) break;
      blocks.push({
        condition: elifMatch[2],
        before: elifMatch[1],
        after: elifMatch[3],
        content: elifMatch[4],
      });
      chainEnd += elifMatch[0].length;
      remaining = output.substring(chainEnd);
    }

    var elseRegex = new RegExp(
      "^\\s*<" + tag.replace(/-/g, "\\-") + "([^>]*)\\s+wx:else([^>]*)>([\\s\\S]*?)<" + tag.replace(/-/g, "\\-") + ">"
    );
    var elseMatch = remaining.match(elseRegex);
    if (elseMatch) {
      blocks.push({
        condition: null,
        before: elseMatch[1],
        after: elseMatch[2],
        content: elseMatch[3],
      });
      chainEnd += elseMatch[0].length;
    }

    var result = "";
    for (var i = 0; i < blocks.length; i++) {
      var block = blocks[i];
      if (block.condition === null || evaluateCondition(block.condition, data)) {
        result =
          "<" + tag + block.before + block.after + ">" + block.content + "</" + tag + ">";
        break;
      }
    }

    output = output.substring(0, chainStart) + result + output.substring(chainEnd);
    changed = true;
  }
  return output;
}

function processWxDirectives(tpl, data) {
  var output = tpl;
  output = processWxFor(output, data);
  output = processWxIf(output, data);
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

function buildComponentDefs(componentEventMap) {
  if (!componentEventMap || Object.keys(componentEventMap).length === 0) {
    return {};
  }
  var defs = {};
  Object.keys(componentEventMap).forEach(function (compName) {
    var compInfo = componentEventMap[compName];
    defs[compName] = {
      template: componentTemplateCache[compInfo.path] || "",
      style: componentStyleCache[compInfo.path] || "",
    };
    var elementName = compName;
    if (!elementName.includes("-")) {
      elementName = "mp-" + elementName;
    }
    elementNameToCompName[elementName] = compName;
  });
  return defs;
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
  }

  var style = "";
  if (styleResult.success) {
    style = convertWxssSelectors(styleResult.content);
  }

  var componentDefs = buildComponentDefs(componentEventMap);
  var compDataMap = {};
  Object.keys(componentDefs).forEach(function (compName) {
    compDataMap[compName] = data["__comp_" + compName] || {};
  });

  ipcRenderer.send("send-to-page-view", {
    viewId,
    channel: "render",
    data: {
      html: html,
      style: style,
      globalStyle: globalAppStyle,
      componentDefs: componentDefs,
      compDataMap: compDataMap,
    },
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
    compName = elementNameToCompName[eventPayload.target.dataset.compName] || eventPayload.target.dataset.compName;
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
    navigatingTo = msg.data.path;
    console.log("[Container] navigateTo:", msg.data.path);
  },
  navigateBack: async (msg) => {
    handleNavigateBack(msg.data.delta);
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
