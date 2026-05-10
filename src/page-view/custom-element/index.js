import { convertWxssSelectors, renderTemplate } from '../utils/index.js';
import { sendEvent } from '../events/index.js';

const registeredElements = {};
let currentGlobalStyle = '';

export function setCurrentGlobalStyle(style) {
  currentGlobalStyle = style;
}

export function getElementName(compName) {
  if (compName.includes('-')) return compName;
  return 'mp-' + compName;
}

export function registerCustomElement(elementName, compDef) {
  if (registeredElements[elementName]) return;
  registeredElements[elementName] = true;

  const tpl = compDef.template || '';
  const style = compDef.style || '';

  const klass = function () {
    const el = Reflect.construct(HTMLElement, [], klass);
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
    const attrVal = this.getAttribute('data-comp-data');
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
    const html = renderTemplate(tpl, this._data);
    const convertedStyle = convertWxssSelectors(style);
    const convertedGlobal = convertWxssSelectors(currentGlobalStyle);
    this._shadow.innerHTML =
      '<style>:host { display: block; width: 100%; }</style>' +
      '<style>' + convertedGlobal + '</style>' +
      '<style>' + convertedStyle + '</style>' +
      html;
    this._bindEvents(this._shadow);
  };

  klass.prototype._bindEvents = function (container) {
    const self = this;
    container.querySelectorAll('[bindtap]').forEach((el) => {
      el.style.cursor = 'pointer';
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const eventName = el.getAttribute('bindtap');
        self._fireEvent(eventName, {
          type: 'tap',
          target: { dataset: Object.assign({}, el.dataset) },
        });
      });
    });
    container.querySelectorAll('[catchtap]').forEach((el) => {
      el.style.cursor = 'pointer';
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const eventName = el.getAttribute('catchtap');
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
