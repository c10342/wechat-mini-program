import { convertWxmlTags, mergeAttrsToData } from './utils/index.js';
import { registerCustomElement, getElementName, setCurrentGlobalStyle } from './custom-element/index.js';
import { bindPageEvents, ensureCompEventListener } from './events/index.js';
import { showToast } from './toast/index.js';

window.pageBridge.onRender((data) => {
  if (data.showToast) {
    showToast(data.toastTitle, data.toastDuration);
    return;
  }

  let html = data.html;
  let style = data.style;
  const globalStyle = data.globalStyle;
  if (globalStyle) {
    setCurrentGlobalStyle(globalStyle);
  }
  const componentDefs = data.componentDefs || {};
  const compDataMap = data.compDataMap || {};

  Object.keys(componentDefs).forEach((compName) => {
    const elementName = getElementName(compName);
    registerCustomElement(elementName, componentDefs[compName]);
  });

  const globalStyleEl = document.getElementById('global-style');
  if (globalStyleEl && globalStyle) {
    globalStyleEl.textContent = globalStyle;
  }

  const pageRoot = document.getElementById('page-root');
  const pageStyle = document.getElementById('page-style');

  if (pageStyle) {
    pageStyle.textContent = style;
  }

  if (pageRoot) {
    html = convertWxmlTags(html);

    Object.keys(componentDefs).forEach((compName) => {
      const elementName = getElementName(compName);
      const compData = compDataMap[compName] || {};
      const escapedName = compName.replace(/-/g, '\\-');

      const tagRegex = new RegExp('<' + escapedName + '(\\s[^>]*)?/?>', 'g');

      html = html.replace(tagRegex, (match, attrs) => {
        const merged = mergeAttrsToData(compData, attrs);
        return '<' + elementName + ' data-comp-data="' + encodeURIComponent(JSON.stringify(merged)) + '"></' + elementName + '>';
      });
    });

    html = html.replace(/<(\w+[\w-]*)(\s[^>]*)?\/>/g, (match, tagName) => {
      if (componentDefs[tagName]) return match;
      console.warn('[PageView] Unknown component tag removed:', tagName);
      return '';
    });

    html = html.replace(/<(\w+[\w-]*)(\s[^>]*)?>([\s\S]*?)<\/\1>/g, (match, tagName) => {
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
