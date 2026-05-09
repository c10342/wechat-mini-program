(function () {
  'use strict';

  window.pageBridge.onRender(function (data) {
    if (data.showToast) {
      showToast(data.toastTitle, data.toastDuration);
      return;
    }

    var html = data.html;
    var style = data.style;
    var globalStyle = data.globalStyle;

    var pageRoot = document.getElementById('page-root');
    var pageStyle = document.getElementById('page-style');
    var globalStyleEl = document.getElementById('global-style');

    if (globalStyleEl && globalStyle) {
      globalStyleEl.textContent = globalStyle;
    }

    if (pageStyle) {
      pageStyle.textContent = style;
    }

    if (pageRoot) {
      pageRoot.innerHTML = html;
      bindEvents(pageRoot);
    }
  });

  function bindEvents(container) {
    var bindElements = container.querySelectorAll('[bindtap]');
    bindElements.forEach(function (el) {
      el.style.cursor = 'pointer';
      el.addEventListener('click', function (e) {
        var eventName = el.getAttribute('bindtap');
        window.pageBridge.sendEvent(eventName, {
          type: 'tap',
          target: { dataset: Object.assign({}, el.dataset) },
        });
      });
    });

    var catchElements = container.querySelectorAll('[catchtap]');
    catchElements.forEach(function (el) {
      el.style.cursor = 'pointer';
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        var eventName = el.getAttribute('catchtap');
        window.pageBridge.sendEvent(eventName, {
          type: 'tap',
          target: { dataset: Object.assign({}, el.dataset) },
        });
      });
    });

    var inputElements = container.querySelectorAll('[bindinput]');
    inputElements.forEach(function (el) {
      el.addEventListener('input', function (e) {
        var eventName = el.getAttribute('bindinput');
        window.pageBridge.sendEvent(eventName, {
          type: 'input',
          value: e.target.value,
          target: { dataset: Object.assign({}, el.dataset) },
        });
      });
    });
  }

  function showToast(title, duration) {
    var existing = document.getElementById('mp-toast');
    if (existing) existing.remove();

    var toast = document.createElement('div');
    toast.id = 'mp-toast';
    toast.style.cssText =
      'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
      'background:rgba(0,0,0,0.7);color:#fff;padding:12px 24px;border-radius:8px;' +
      'font-size:14px;z-index:9999;text-align:center;max-width:70%;';
    toast.textContent = title || '';
    document.body.appendChild(toast);

    setTimeout(function () { toast.remove(); }, duration || 1500);
  }
})();
