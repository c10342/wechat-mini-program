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

  function findComponentName(el) {
    var current = el;
    while (current && current !== document.body) {
      if (current.hasAttribute && current.hasAttribute('data-comp-name')) {
        return current.getAttribute('data-comp-name');
      }
      current = current.parentElement;
    }
    return null;
  }

  function bindEvents(container) {
    var bindElements = container.querySelectorAll('[bindtap]');
    bindElements.forEach(function (el) {
      el.style.cursor = 'pointer';
      el.addEventListener('click', function (e) {
        var eventName = el.getAttribute('bindtap');
        var compName = findComponentName(el);
        var dataset = Object.assign({}, el.dataset);
        if (compName) {
          dataset.compName = compName;
        }
        window.pageBridge.sendEvent(eventName, {
          type: 'tap',
          target: { dataset: dataset },
        });
      });
    });

    var catchElements = container.querySelectorAll('[catchtap]');
    catchElements.forEach(function (el) {
      el.style.cursor = 'pointer';
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        var eventName = el.getAttribute('catchtap');
        var compName = findComponentName(el);
        var dataset = Object.assign({}, el.dataset);
        if (compName) {
          dataset.compName = compName;
        }
        window.pageBridge.sendEvent(eventName, {
          type: 'tap',
          target: { dataset: dataset },
        });
      });
    });

    var inputElements = container.querySelectorAll('[bindinput]');
    inputElements.forEach(function (el) {
      el.addEventListener('input', function (e) {
        var eventName = el.getAttribute('bindinput');
        var compName = findComponentName(el);
        var dataset = Object.assign({}, el.dataset);
        if (compName) {
          dataset.compName = compName;
        }
        window.pageBridge.sendEvent(eventName, {
          type: 'input',
          value: e.target.value,
          target: { dataset: dataset },
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
