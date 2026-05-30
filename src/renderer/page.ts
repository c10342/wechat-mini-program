import "./page.css";
import type { ComponentAssets, ComponentSnapshot, MiniData, MiniDomEvent, PageAssets, PageInboundMessage, RouteRecord } from "../shared/types";

const appRoot = document.querySelector<HTMLDivElement>("#app")!;
const toast = document.querySelector<HTMLDivElement>("#toast")!;
const loading = document.querySelector<HTMLDivElement>("#loading")!;

let pageId = window.miniHost.pageId;
let route: RouteRecord | null = null;
let assets: PageAssets | null = null;
let componentAssets: Record<string, ComponentAssets> = {};
let componentState: Record<string, ComponentSnapshot> = {};
let data: MiniData = {};
let toastTimer = 0;

function applyBackgroundColor(backgroundColor?: string): void {
  const color = backgroundColor || "#fffaf0";
  document.documentElement.style.setProperty("--mini-page-background", color);
  document.documentElement.style.backgroundColor = color;
  document.body.style.backgroundColor = color;
  appRoot.style.backgroundColor = color;
}

function stripMustache(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("{{") && trimmed.endsWith("}}") ? trimmed.slice(2, -2).trim() : trimmed;
}

function evalInScope(expression: string, scope: MiniData): unknown {
  const body = stripMustache(expression);
  if (!body) return "";
  try {
    // WXML 绑定表达式求值器，作用域包含页面 data 和 wx:for 注入的局部变量。
    return Function("scope", `with(scope){return (${body})}`)(scope);
  } catch {
    return "";
  }
}

function interpolate(value: string, scope: MiniData): string {
  return value.replace(/\{\{([\s\S]+?)\}\}/g, (_match, expression: string) => String(evalInScope(expression, scope) ?? ""));
}

function isTruthyExpression(value: string | null, scope: MiniData): boolean {
  if (value == null) return false;
  return Boolean(evalInScope(value, scope));
}

function renderChildren(source: ParentNode, scope: MiniData, pathPrefix = "root", componentId?: string): Node[] {
  const nodes: Node[] = [];
  let conditionalMatched = false;
  let inConditionalChain = false;

  source.childNodes.forEach((child, childIndex) => {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = interpolate(child.textContent ?? "", scope);
      if (text.trim()) {
        nodes.push(document.createTextNode(text));
        inConditionalChain = false;
        conditionalMatched = false;
      }
      return;
    }
    if (!(child instanceof Element)) return;

    const hasIf = child.hasAttribute("wx:if");
    const hasElif = child.hasAttribute("wx:elif");
    const hasElse = child.hasAttribute("wx:else");
    let shouldRender = true;

    if (hasIf) {
      inConditionalChain = true;
      conditionalMatched = isTruthyExpression(child.getAttribute("wx:if"), scope);
      shouldRender = conditionalMatched;
    } else if (hasElif && inConditionalChain) {
      shouldRender = !conditionalMatched && isTruthyExpression(child.getAttribute("wx:elif"), scope);
      conditionalMatched = conditionalMatched || shouldRender;
    } else if (hasElse && inConditionalChain) {
      shouldRender = !conditionalMatched;
      conditionalMatched = true;
    } else {
      inConditionalChain = false;
      conditionalMatched = false;
    }

    if (!shouldRender) return;

    const currentPath = `${pathPrefix}.${childIndex}`;
    const forExpr = child.getAttribute("wx:for");
    if (forExpr) {
      // 渲染 wx:for 时复用同一个元素模板，并把 item/index 注入作用域。
      const list = evalInScope(forExpr, scope);
      if (Array.isArray(list)) {
        const itemName = child.getAttribute("wx:for-item") || "item";
        const indexName = child.getAttribute("wx:for-index") || "index";
        list.forEach((item, index) => {
          const childScope = { ...scope, [itemName]: item, [indexName]: index };
          const rendered = renderElement(child, childScope, `${currentPath}:${index}`, componentId);
          if (rendered) nodes.push(rendered);
        });
      }
      return;
    }

    const rendered = renderElement(child, scope, currentPath, componentId);
    if (rendered) nodes.push(rendered);
  });

  return nodes;
}

function mapTag(tagName: string): keyof HTMLElementTagNameMap {
  if (tagName === "text") return "span";
  if (tagName === "button") return "button";
  if (tagName === "image") return "img";
  if (tagName === "input") return "input";
  return "div";
}

function renderElement(source: Element, scope: MiniData, renderPath: string, componentId?: string): HTMLElement | null {
  const miniTag = source.tagName.toLowerCase();
  if (!componentId && assets?.components[miniTag]) return renderComponent(source, scope, renderPath);
  const element = document.createElement(mapTag(miniTag));
  element.classList.add(`mini-${miniTag}`);

  for (const attr of Array.from(source.attributes)) {
    const name = attr.name;
    const value = interpolate(attr.value, scope);
    if (name === "class") element.className = `${element.className} ${value}`.trim();
    else if (name === "style") element.setAttribute("style", value);
    else if (name === "src" && element instanceof HTMLImageElement) element.src = value;
    else if (name === "value" && element instanceof HTMLInputElement) element.value = value;
    else if (name.startsWith("data-")) element.setAttribute(name, value);
    else if (name === "scroll-y") element.classList.add("is-scroll-y");
  }

  bindEvent(source, element, "bindtap", "tap", "click", componentId);
  bindEvent(source, element, "catchtap", "tap", "click", componentId);
  bindEvent(source, element, "bindinput", "input", "input", componentId);
  bindEvent(source, element, "bindchange", "change", "change", componentId);

  if (element instanceof HTMLInputElement) {
    element.addEventListener("input", () => {
      element.setAttribute("value", element.value);
    });
  } else {
    element.append(...renderChildren(source, scope, renderPath, componentId));
  }

  return element;
}

function isValidCustomElementName(tagName: string): boolean {
  return /^[a-z][.0-9_a-z]*-[\-.0-9_a-z]*$/.test(tagName);
}

function ensureCustomElement(tagName: string): void {
  if (!isValidCustomElementName(tagName) || customElements.get(tagName)) return;
  customElements.define(tagName, class extends HTMLElement {});
}

function renderComponent(source: Element, scope: MiniData, renderPath: string): HTMLElement {
  const tagName = source.tagName.toLowerCase();
  const componentPath = assets?.components[tagName];
  const id = `${pageId}:component:${renderPath}`;
  ensureCustomElement(tagName);
  const host = document.createElement(isValidCustomElementName(tagName) ? tagName : "div") as HTMLElement;
  host.classList.add("mini-component", `mini-component-${tagName}`);
  host.dataset.componentId = id;

  for (const attr of Array.from(source.attributes)) {
    const name = attr.name;
    if (name.startsWith("wx:") || name.startsWith("bind") || name.startsWith("catch")) continue;
    const value = interpolate(attr.value, scope);
    if (name === "class") host.className = `${host.className} ${value}`.trim();
    else if (name === "style") host.setAttribute("style", value);
    else if (name.startsWith("data-")) host.setAttribute(name, value);
    else host.setAttribute(name, value);
  }

  if (!componentPath) return host;

  const snapshot = componentState[id];
  const component = componentAssets[componentPath];
  if (!snapshot || !component) return host;

  const template = document.createElement("template");
  template.innerHTML = component.wxml;
  const componentScope = { ...snapshot.properties, ...snapshot.data };
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `:host{display:block;box-sizing:border-box}${component.wxss}`;
  shadow.append(style, ...renderChildren(template.content, componentScope, `component:${id}`, id));
  return host;
}

function bindEvent(source: Element, element: HTMLElement, attr: string, miniType: string, domType: keyof HTMLElementEventMap, componentId?: string): void {
  const handler = source.getAttribute(attr);
  if (!handler) return;
  element.addEventListener(domType, (event) => {
    // 事件会回传给 Worker；页面业务方法不会在当前 WebContents 中执行。
    if (attr.startsWith("catch")) event.stopPropagation();
    const dataset: Record<string, string> = {};
    for (const item of Array.from(element.attributes)) {
      if (item.name.startsWith("data-")) dataset[item.name.slice(5)] = item.value;
    }
    const detail = event instanceof InputEvent && event.target instanceof HTMLInputElement ? { value: event.target.value } : undefined;
    const miniEvent: MiniDomEvent = { pageId, componentId, type: miniType, handler, dataset, detail };
    window.miniHost.send({ type: "dom-event", event: miniEvent });
  });
}

function applyPageCss(css: string): void {
  let style = document.querySelector<HTMLStyleElement>("#mini-page-style");
  if (!style) {
    style = document.createElement("style");
    style.id = "mini-page-style";
    document.head.append(style);
  }
  style.textContent = css;
}

function render(): void {
  if (!assets) return;
  // 先用浏览器 template 解析 WXML，再转换为当前支持的小程序组件。
  const template = document.createElement("template");
  template.innerHTML = assets.wxml;
  appRoot.replaceChildren(...renderChildren(template.content, data));
}

function setRpxUnit(): void {
  document.documentElement.style.setProperty("--rpx", `${document.documentElement.clientWidth / 750}px`);
}

function showToast(payload?: Record<string, unknown>): void {
  window.clearTimeout(toastTimer);
  if (!payload) {
    toast.hidden = true;
    return;
  }
  toast.textContent = String(payload.title ?? "");
  toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, Number(payload.duration ?? 1600));
}

function showLoading(payload?: Record<string, unknown>): void {
  loading.hidden = !payload;
  loading.title = String(payload?.title ?? "加载中");
}

function handleMessage(message: PageInboundMessage): void {
  if (message.type === "init") {
    // WebContents 加载完成并压入路由栈后，主进程会发送 init 消息。
    pageId = message.pageId;
    route = message.route;
    assets = message.assets;
    componentAssets = message.components;
    componentState = message.componentState ?? {};
    data = message.data;
    document.title = route.title;
    applyBackgroundColor(message.backgroundColor);
    applyPageCss(assets.wxss);
    render();
  }
  if (message.type === "set-data") {
    data = message.data;
    componentState = message.componentState ?? {};
    render();
  }
  if (message.type === "host-ui" && message.name === "toast") showToast(message.payload);
  if (message.type === "host-ui" && message.name === "loading") showLoading(message.payload);
}

setRpxUnit();
window.addEventListener("resize", () => {
  setRpxUnit();
  render();
});
window.miniHost.onMessage(handleMessage);
