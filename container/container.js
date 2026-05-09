const ipcRenderer = window.containerBridge;

let appConfig = null;
let appDir = null;
let worker = null;

const pageStack = [];
const pageViewIds = {};
const pageDataCache = {};
let globalAppStyle = '';

const NAV_HEIGHT = 44;
const ANIM_DURATION = 280;

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function convertWxssSelectors(css) {
  var output = css;
  output = output.replace(/(^|[\s{},>~+])view(?=[\s{},:>.~+\[]|$)/g, '$1div');
  output = output.replace(/(^|[\s{},>~+])text(?=[\s{},:>.~+\[]|$)/g, '$1span');
  output = output.replace(/(^|[\s{},>~+])image(?=[\s{},:>.~+\[]|$)/g, '$1img');
  return output;
}

function convertWxmlTags(html) {
  var temp = html;
  temp = temp.replace(/<image([^>]*?)\/?\s*>/gi, function (match, attrs) {
    var srcMatch = attrs.match(/src=["']([^"']*)["']/);
    var src = srcMatch ? srcMatch[1] : '';
    return '<img src="' + src + '" style="display:block;max-width:100%;" />';
  });
  temp = temp.replace(/<view(\s[^>]*)?>/gi, '<div$1>');
  temp = temp.replace(/<\/view>/gi, '</div>');
  temp = temp.replace(/<text(\s[^>]*)?>/gi, '<span$1>');
  temp = temp.replace(/<\/text>/gi, '</span>');
  return temp;
}

function renderTemplate(tpl, data) {
  if (!tpl || !data) return '';
  var output = tpl;
  output = output.replace(/\{\{(.*?)\}\}/g, function (match, expr) {
    try {
      var keys = expr.trim().split('.');
      var value = data;
      for (var i = 0; i < keys.length; i++) {
        if (value == null) return '';
        value = value[keys[i]];
      }
      return value != null ? String(value) : '';
    } catch (e) { return ''; }
  });
  return convertWxmlTags(output);
}

function getBounds(offsetX) {
  offsetX = offsetX || 0;
  return {
    x: offsetX,
    y: NAV_HEIGHT,
    width: window.innerWidth,
    height: window.innerHeight - NAV_HEIGHT
  };
}

async function createPageView(pagePath) {
  const viewId = await ipcRenderer.invoke('create-page-view');
  pageViewIds[pagePath] = viewId;
  return viewId;
}

async function renderPageInView(viewId, pagePath, data) {
  var tplPath = pagePath + '/index.wxml';
  var stylePath = pagePath + '/index.wxss';
  var configPath = pagePath + '/index.json';

  var [tplResult, styleResult, configResult] = await Promise.all([
    ipcRenderer.invoke('read-file', tplPath),
    ipcRenderer.invoke('read-file', stylePath),
    ipcRenderer.invoke('read-file', configPath),
  ]);

  var pageConfig = {};
  if (configResult.success) {
    try { pageConfig = JSON.parse(configResult.content); } catch (e) {}
  }

  var html = '';
  if (tplResult.success) {
    html = renderTemplate(tplResult.content, data);
  }

  var style = '';
  if (styleResult.success) {
    style = convertWxssSelectors(styleResult.content);
  }

  ipcRenderer.send('send-to-page-view', {
    viewId,
    channel: 'render',
    data: { html, style, globalStyle: globalAppStyle },
  });

  return pageConfig;
}

function updateNavBar(pageConfig) {
  var navTitle = document.getElementById('nav-title');
  var navBack = document.getElementById('nav-back');
  if (navTitle) {
    navTitle.textContent = pageConfig.navigationBarTitleText ||
      (appConfig.window && appConfig.window.navigationBarTitleText) || '';
  }
  if (navBack) {
    navBack.style.display = pageStack.length > 1 ? 'flex' : 'none';
  }
}

function setViewBounds(pagePath, bounds) {
  var viewId = pageViewIds[pagePath];
  if (viewId) {
    ipcRenderer.send('set-page-view-bounds', { viewId, bounds: bounds });
  }
}

function showPage(pagePath) {
  var viewId = pageViewIds[pagePath];
  if (viewId) {
    ipcRenderer.send('show-page-view', { viewId });
    ipcRenderer.send('set-page-view-bounds', { viewId, bounds: getBounds() });
  }
}

function hidePage(pagePath) {
  var viewId = pageViewIds[pagePath];
  if (viewId) {
    ipcRenderer.send('hide-page-view', { viewId });
  }
}

function destroyPage(pagePath) {
  var viewId = pageViewIds[pagePath];
  if (viewId) {
    ipcRenderer.send('destroy-page-view', { viewId });
    delete pageViewIds[pagePath];
    delete pageDataCache[pagePath];
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

  worker.postMessage({ type: 'notifyPageHide', data: { path: topPage } });

  animateSlideOut(topPage, bottomPage, function () {
    if (bottomPage) {
      var configPath = bottomPage + '/index.json';
      ipcRenderer.invoke('read-file', configPath).then(function (result) {
        var pc = {};
        if (result.success) { try { pc = JSON.parse(result.content); } catch (e) {} }
        updateNavBar(pc);
      });

      worker.postMessage({ type: 'notifyPageShow', data: { path: bottomPage } });
    }
  });
}

document.getElementById('nav-back').addEventListener('click', function () {
  handleNavigateBack(1);
});

window.addEventListener('resize', function () {
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

  console.log('[Container] Event from view:', eventName, 'page:', currentPath);
  worker.postMessage({
    type: 'event',
    data: {
      pagePath: currentPath,
      eventName: eventName,
      eventPayload: eventPayload,
    },
  });
});

function initWorker(bundlePath) {
  var workerUrl = new URL('file:///' + bundlePath.replace(/\\/g, '/'));
  worker = new Worker(workerUrl);

  worker.onmessage = function (e) {
    handleWorkerMessage(e.data);
  };

  worker.onerror = function (err) {
    console.error('[Container] Worker error:', err);
  };
}

var navigatingTo = null;

async function handleWorkerMessage(msg) {
  var type = msg.type;
  var data = msg.data;

  if (type === 'pageReady') {
    var pagePath = data.path;
    var pageData = data.data;

    pageDataCache[pagePath] = deepClone(pageData);

    var viewId = await createPageView(pagePath);

    ipcRenderer.send('set-page-view-bounds', { viewId, bounds: getBounds(window.innerWidth) });
    ipcRenderer.send('hide-page-view', { viewId });

    var pageConfig = await renderPageInView(viewId, pagePath, pageData);

    var isNavigateTo = (navigatingTo === pagePath);
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

    console.log('[Container] Page ready:', pagePath, 'stack:', JSON.stringify(pageStack));
  }

  if (type === 'setData') {
    var pagePath = data.path;
    var fullData = data.fullData;

    pageDataCache[pagePath] = deepClone(fullData);

    var viewId = pageViewIds[pagePath];
    if (viewId) {
      await renderPageInView(viewId, pagePath, fullData);
      console.log('[Container] Data updated:', pagePath);
    }
  }

  if (type === 'navigateTo') {
    navigatingTo = data.path;
    console.log('[Container] navigateTo:', data.path);
  }

  if (type === 'navigateBack') {
    handleNavigateBack(data.delta);
  }

  if (type === 'showToast') {
    var currentPath = pageStack[pageStack.length - 1];
    var viewId = pageViewIds[currentPath];
    if (viewId) {
      ipcRenderer.send('send-to-page-view', {
        viewId: viewId,
        channel: 'render',
        data: { showToast: true, toastTitle: data.title, toastDuration: data.duration },
      });
    }
  }

  if (type === 'readFile') {
    var id = data.id;
    var filePath = data.path;
    var result = await ipcRenderer.invoke('read-file', filePath);
    worker.postMessage({ type: 'fileResponse', data: { id: id, result: result } });
  }
}

async function loadAppStyles() {
  var result = await ipcRenderer.invoke('read-file', 'app.wxss');
  if (result.success) {
    globalAppStyle = convertWxssSelectors(result.content);
    var style = document.createElement('style');
    style.id = 'app-style';
    style.textContent = globalAppStyle;
    document.head.appendChild(style);
  }
}

ipcRenderer.onInitContainer(async function (initData) {
  appConfig = initData.config;
  appDir = initData.appDir;

  console.log('[Container] Config loaded:', JSON.stringify(appConfig));

  await loadAppStyles();

  var bundlePath = await ipcRenderer.invoke('build-worker-bundle');

  initWorker(bundlePath);

  worker.postMessage({ type: 'init', data: { config: appConfig } });
});
