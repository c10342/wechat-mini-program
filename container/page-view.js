(function () {
  'use strict';

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

  function renderTemplate(tpl, data) {
    if (!tpl || !data) return "";
    var output = tpl;
    output = output.replace(/<(\w+[\w-]*)([^>]*)\swx:if="([^"]*)"([^>]*)>([\s\S]*?)<\/\1>/g, function (match, tag, before, condition, after, content) {
      var expr = condition.trim();
      if (expr.startsWith("{{") && expr.endsWith("}}")) {
        expr = expr.slice(2, -2).trim();
      }
      var val = resolveExpr(expr, data);
      if (val) {
        return "<" + tag + before + after + ">" + content + "</" + tag + ">";
      }
      return "";
    });
    output = output.replace(/\{\{(.*?)\}\}/g, function (match, expr) {
      var value = resolveExpr(expr, data);
      return value != null ? String(value) : "";
    });
    return convertWxmlTags(output);
  }

  function parseAttrsString(attrs) {
    var result = {};
    if (!attrs) return result;
    var regex = /(\w[\w-]*)\s*=\s*"([^"]*)"/g;
    var m;
    while ((m = regex.exec(attrs)) !== null) {
      result[m[1]] = m[2];
    }
    return result;
  }

  function mergeAttrsToData(compData, attrs) {
    var parsed = parseAttrsString(attrs);
    var merged = {};
    for (var k in compData) {
      merged[k] = compData[k];
    }
    for (var k in parsed) {
      if (k.startsWith("bind:") || k === "class" || k === "data-comp-data") continue;
      merged[k] = parsed[k];
    }
    return merged;
  }

  var registeredElements = {};
  var currentGlobalStyle = "";

  function registerCustomElement(elementName, compDef) {
    if (registeredElements[elementName]) return;
    registeredElements[elementName] = true;

    var tpl = compDef.template || "";
    var style = compDef.style || "";

    var klass = function () {
      var el = Reflect.construct(HTMLElement, [], klass);
      el._shadow = el.attachShadow({ mode: 'open' });
      el._data = {};
      el._connected = false;
      return el;
    };
    klass.prototype = Object.create(HTMLElement.prototype);
    klass.prototype.constructor = klass;

    Object.defineProperty(klass, 'observedAttributes', {
      get: function () { return ['data-comp-data']; }
    });

    klass.prototype.connectedCallback = function () {
      this._connected = true;
      var attrVal = this.getAttribute('data-comp-data');
      if (attrVal) {
        try {
          this._data = JSON.parse(decodeURIComponent(attrVal));
        } catch (e) {
          try {
            this._data = JSON.parse(attrVal);
          } catch (e2) {
            this._data = {};
          }
        }
      }
      console.log('[PageView] CustomElement connected:', this.tagName.toLowerCase(), 'data:', JSON.stringify(this._data));
      this._render();
    };

    klass.prototype.attributeChangedCallback = function (name, oldVal, newVal) {
      if (name === 'data-comp-data' && oldVal !== newVal && this._connected) {
        try {
          this._data = JSON.parse(decodeURIComponent(newVal || '{}'));
        } catch (e) {
          try {
            this._data = JSON.parse(newVal || '{}');
          } catch (e2) {
            this._data = {};
          }
        }
        this._render();
      }
    };

    klass.prototype._render = function () {
      var html = renderTemplate(tpl, this._data);
      var convertedStyle = convertWxssSelectors(style);
      var convertedGlobal = convertWxssSelectors(currentGlobalStyle);
      this._shadow.innerHTML =
        '<style>:host { display: block; width: 100%; }</style>' +
        '<style>' + convertedGlobal + '</style>' +
        '<style>' + convertedStyle + '</style>' +
        html;
      this._bindEvents(this._shadow);
    };

    klass.prototype._bindEvents = function (container) {
      var self = this;
      container.querySelectorAll('[bindtap]').forEach(function (el) {
        el.style.cursor = 'pointer';
        el.addEventListener('click', function (e) {
          e.stopPropagation();
          var eventName = el.getAttribute('bindtap');
          self._fireEvent(eventName, {
            type: 'tap',
            target: { dataset: Object.assign({}, el.dataset) },
          });
        });
      });
      container.querySelectorAll('[catchtap]').forEach(function (el) {
        el.style.cursor = 'pointer';
        el.addEventListener('click', function (e) {
          e.stopPropagation();
          var eventName = el.getAttribute('catchtap');
          self._fireEvent(eventName, {
            type: 'tap',
            target: { dataset: Object.assign({}, el.dataset) },
          });
        });
      });
    };

    klass.prototype._fireEvent = function (eventName, detail) {
      this.dispatchEvent(new CustomEvent('comp-event', {
        bubbles: true,
        composed: true,
        detail: {
          compName: this.tagName.toLowerCase(),
          eventName: eventName,
          eventPayload: detail,
        },
      }));
    };

    try {
      customElements.define(elementName, klass);
      console.log('[PageView] CustomElement registered:', elementName);
    } catch (e) {
      console.warn('[PageView] CustomElement register failed:', elementName, e.message);
    }
  }

  function getElementName(compName) {
    if (compName.includes('-')) return compName;
    return 'mp-' + compName;
  }

  window.pageBridge.onRender(function (data) {
    if (data.showToast) {
      showToast(data.toastTitle, data.toastDuration);
      return;
    }

    var html = data.html;
    var style = data.style;
    var globalStyle = data.globalStyle;
    if (globalStyle) {
      currentGlobalStyle = globalStyle;
    }
    var componentDefs = data.componentDefs || {};
    var compDataMap = data.compDataMap || {};

    Object.keys(componentDefs).forEach(function (compName) {
      var elementName = getElementName(compName);
      registerCustomElement(elementName, componentDefs[compName]);
    });

    var globalStyleEl = document.getElementById('global-style');
    if (globalStyleEl && globalStyle) {
      globalStyleEl.textContent = globalStyle;
    }

    var pageRoot = document.getElementById('page-root');
    var pageStyle = document.getElementById('page-style');

    if (pageStyle) {
      pageStyle.textContent = style;
    }

    if (pageRoot) {
      html = convertWxmlTags(html);

      Object.keys(componentDefs).forEach(function (compName) {
        var elementName = getElementName(compName);
        var compData = compDataMap[compName] || {};
        var escapedName = compName.replace(/-/g, "\\-");

        var tagRegex = new RegExp("<" + escapedName + "(\\s[^>]*)?/?>", "g");

        html = html.replace(tagRegex, function (match, attrs) {
          var merged = mergeAttrsToData(compData, attrs);
          return '<' + elementName + ' data-comp-data="' + encodeURIComponent(JSON.stringify(merged)) + '"></' + elementName + '>';
        });
      });

      html = html.replace(/<(\w+[\w-]*)(\s[^>]*)?\/>/g, function (match, tagName) {
        if (componentDefs[tagName]) return match;
        console.warn('[PageView] Unknown component tag removed:', tagName);
        return '';
      });

      html = html.replace(/<(\w+[\w-]*)(\s[^>]*)?>([\s\S]*?)<\/\1>/g, function (match, tagName) {
        if (componentDefs[tagName]) return match;
        if (['div', 'span', 'img', 'a', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'section', 'header', 'footer', 'main', 'nav', 'article', 'style', 'script'].indexOf(tagName) !== -1) return match;
        console.warn('[PageView] Unknown component open-close tag removed:', tagName);
        return '';
      });

      pageRoot.innerHTML = html;

      bindPageEvents(pageRoot);

      ensureCompEventListener();
    }
  });

  var compEventBound = false;

  function ensureCompEventListener() {
    if (compEventBound) return;
    compEventBound = true;
    var pageRoot = document.getElementById('page-root');
    if (pageRoot) {
      pageRoot.addEventListener('comp-event', function (e) {
        var detail = e.detail;
        window.pageBridge.sendEvent(detail.eventName, {
          type: detail.type || 'tap',
          target: {
            dataset: {
              compName: detail.compName,
            },
          },
        });
      });
    }
  }

  function bindPageEvents(container) {
    container.querySelectorAll('[bindtap]').forEach(function (el) {
      el.style.cursor = 'pointer';
      el.addEventListener('click', function (e) {
        var eventName = el.getAttribute('bindtap');
        window.pageBridge.sendEvent(eventName, {
          type: 'tap',
          target: { dataset: Object.assign({}, el.dataset) },
        });
      });
    });

    container.querySelectorAll('[catchtap]').forEach(function (el) {
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

    container.querySelectorAll('[bindinput]').forEach(function (el) {
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
