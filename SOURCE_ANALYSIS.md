# 源码分析：framework 与 container

本文档对 `framework/` 和 `container/` 两个目录下的所有源文件进行逐文件功能分析和代码解读。

---

## 一、framework/ — 逻辑层

该目录下只有一个文件 `logic-worker.js`，它是整个小程序模拟器的**逻辑层核心**，运行在 Web Worker 线程中，天然无法访问 DOM，与微信小程序双线程模型中逻辑层的限制一致。

---

### framework/logic-worker.js

**文件定位**：Web Worker 脚本，由 `container.js` 创建并加载。所有小程序的用户代码（`App()`、`Page()`、`setData()`）都在此线程中执行。

#### 1. 全局状态管理

```javascript
let appConfig = null;
let currentPage = null;
let pageInstances = {};
```

- `appConfig`：存储 `app.json` 解析后的全局配置（页面路由表、窗口样式等），由 `init` 消息注入。
- `currentPage`：当前正在注册的页面路径字符串，作为 `Page()` 调用时的上下文标识。
- `pageInstances`：以页面路径为 key、页面实例为 value 的对象，存储所有已注册的 Page 实例。

#### 2. 工具函数

| 函数 | 作用 |
|------|------|
| `sendMessage(type, data)` | 向渲染层（container.js）发送消息的统一封装，内部调用 `self.postMessage()` |
| `deepClone(obj)` | 通过 `JSON.parse(JSON.stringify())` 实现深拷贝，用于隔离 data 快照 |
| `parseQuery(queryStr)` | 将 URL query string（如 `id=1&name=test`）解析为键值对对象 |

#### 3. App 注册系统 — `self.App(options)`

模拟微信小程序的 `App()` 全局注册函数：

```javascript
self.App = function (options) {
  if (options.globalData) {
    appMethods.globalData = options.globalData;
  }
  ['onLaunch', 'onShow', 'onHide'].forEach(function (hook) {
    if (typeof options[hook] === 'function') {
      appMethods[hook] = options[hook];
    }
  });
};
```

- 提取 `globalData` 存入 `appMethods.globalData`
- 提取生命周期钩子 `onLaunch`、`onShow`、`onHide`
- 通过 `wx.getApp()` 可获取 `globalData`

#### 4. Page 注册系统 — `self.Page(options)`

模拟微信小程序的 `Page()` 页面注册函数。核心流程：

1. **校验上下文**：检查 `currentPage` 是否已设置（防止无页面上下文时调用）
2. **创建实例**：调用 `createPageInstance()` 构建页面实例
3. **存储实例**：以路径为 key 存入 `pageInstances`
4. **触发 onLoad**：立即调用 `instance.onLoad(query)`，传入路由参数
5. **发送 pageReady**：通知渲染层页面数据已就绪

#### 5. Page 实例创建 — `createPageInstance(pagePath, pageDefine)`

这是页面实例化的核心函数，构建了包含以下能力的实例对象：

**数据层**：
```javascript
data: deepClone(pageDefine.data || {}),
setData: function (newData, callback) {
  Object.assign(instance.data, newData);
  sendMessage('setData', {
    path: pagePath,
    data: newData,
    fullData: deepClone(instance.data),
  });
}
```
- `data`：深拷贝初始数据，避免引用污染
- `setData`：合并新数据后，将完整数据快照（`fullData`）发送给渲染层

**方法绑定**：
```javascript
Object.keys(pageDefine).forEach(function (key) {
  if (typeof pageDefine[key] === 'function') {
    instance[key] = function () {
      return pageDefine[key].apply(instance, args);
    };
  }
});
```
- 遍历 Page 定义中的所有函数属性，通过 `.apply(instance)` 将 `this` 绑定到实例
- `methods` 命名空间中的方法也会被展开绑定到实例上
- 保留字 `data`、`methods` 被跳过

#### 6. wx API 兼容层 — `self.wx`

模拟微信小程序的全局 `wx` 对象，提供以下 API：

| API | 实现方式 |
|-----|----------|
| `wx.navigateTo(url)` | 解析 URL 中的路径和 query 参数，调用 `loadPage()` 加载新页面，发送 `navigateTo` 消息触发路由动画 |
| `wx.navigateBack(delta)` | 发送 `navigateBack` 消息，由 container.js 执行出栈动画 |
| `wx.redirectTo(url)` | 类似 navigateTo，发送 `redirectTo` 消息替换当前页面 |
| `wx.getSystemInfoSync()` | 返回硬编码的设备信息对象（brand、model、屏幕尺寸等） |
| `wx.showToast(params)` | 发送 `showToast` 消息，由渲染层显示 Toast 提示 |
| `wx.getApp()` | 返回包含 `globalData` 的 App 实例引用 |

**URL 解析逻辑**（navigateTo/redirectTo 共用）：
1. 从 URL 中分离路径和 query string（以 `?` 为界）
2. 去除前导 `/`（将绝对路径转为相对路径）
3. 去除尾部 `/index`（微信小程序允许省略 index）
4. 调用 `parseQuery()` 解析参数

#### 7. 文件读取代理 — `requestFile(relativePath)`

Worker 无法直接访问文件系统，通过消息机制向渲染层请求文件内容：

```javascript
function requestFile(relativePath) {
  return new Promise(function (resolve) {
    var id = ++requestIdCounter;
    pendingFileRequests[id] = resolve;
    sendMessage('readFile', { id: id, path: relativePath });
  });
}
```

**通信链路**：
1. Worker 发送 `readFile` 消息（携带唯一 id 和路径）
2. container.js 收到后通过 IPC 调用主进程读取文件
3. 主进程返回文件内容后，container.js 发送 `fileResponse` 消息回 Worker
4. Worker 根据 id 匹配 `pendingFileRequests`，resolve 对应的 Promise

#### 8. 模块系统

Worker 中实现了一套简化的 CommonJS 模块系统，支持 `require()` 语法：

**`resolvePath(fromPath, requirePath)`**：
- 处理绝对路径（以 `/` 开头）和相对路径（`./`、`../`）
- 自动补全 `.js` 后缀

**`loadModuleAsync(modulePath)`**：
- 异步加载模块：先通过 `requestFile()` 获取源码
- 使用 `new Function('require', 'module', 'exports', code)` 构建模块执行沙箱
- 支持 `module.exports` 和 `exports` 两种导出方式
- 通过 `moduleCache` 实现模块缓存，避免重复加载

**`preloadModules(code, fromPath)`**：
- 在执行脚本前，用正则扫描所有 `require()` 调用
- 提前异步加载所有依赖模块到缓存
- 确保后续同步执行时依赖已在缓存中

**`executeScript(code, fromPath)`**：
- 在沙箱环境中执行脚本代码
- 注入 `require`、`module`、`exports` 三个 CommonJS 变量
- 用于执行 `app.js` 和各页面的 `index.js`

#### 9. 页面加载流程 — `loadPage(pagePath, query)`

```
loadPage(pagePath, query)
  ├── 对已有页面实例调用 onHide()
  ├── 设置 pendingQuery = query
  ├── loadPageScript(pagePath)
  │     ├── requestFile(pagePath + '/index.js')
  │     ├── preloadModules() 预加载依赖
  │     └── executeScript() 执行页面脚本
  │           → 脚本中调用 Page() 注册页面
  │           → Page() 内部调用 onLoad(query)
  │           → Page() 发送 pageReady 消息
  └── 对新页面实例调用 onShow()
```

#### 10. 消息处理 — `self.onmessage`

Worker 监听来自 container.js 的所有消息，按 `type` 字段分发处理：

| 消息类型 | 处理逻辑 |
|----------|----------|
| `init` | 加载配置 → 执行 app.js → 调用 App.onLaunch() → 加载首页 |
| `event` | 查找页面实例的事件处理函数并调用 |
| `loadPage` | 加载指定页面（路由跳转） |
| `notifyPageHide` | 对页面实例调用 onUnload() 并销毁实例 |
| `notifyPageShow` | 对页面实例调用 onShow() |
| `fileResponse` | 匹配文件请求 id，resolve 对应 Promise |

---

## 二、container/ — 渲染层

渲染层目录包含 7 个文件，协同工作实现页面视图渲染、导航栏管理、路由动画和 IPC 安全桥接。

---

### container/index.html

**文件定位**：主窗口 HTML，是 Electron BrowserWindow 加载的入口页面。

**结构组成**：

| DOM 元素 | 用途 |
|----------|------|
| `#nav-bar` | 固定定位的顶部导航栏（44px 高度），白色背景 + 底部阴影 |
| `#nav-back` | 导航栏左侧的返回按钮，默认隐藏（`display: none`），栈深度 > 1 时显示 |
| `#nav-title` | 导航栏中央的标题文本，动态更新 |
| `#page-mount` | 页面挂载区，位于导航栏下方，占满剩余空间（`overflow: hidden`），WebContentsView 挂载于此区域 |

**样式特点**：
- 全局禁止滚动（`overflow: hidden`），页面滚动由各 WebContentsView 内部处理
- 移动端 viewport 设置（`user-scalable=no`）
- 系统字体栈（-apple-system, BlinkMacSystemFont 等）

**加载脚本**：`container.js`（通过 `<script src="./container.js">` 引入）

---

### container/container.js

**文件定位**：渲染层的核心控制器，负责页面栈管理、Worker 通信、模板编译、路由动画。

#### 1. 全局状态

```javascript
let appConfig = null;
let appDir = null;
let worker = null;
const pageStack = [];
const pageViewIds = {};
const pageDataCache = {};
let globalAppStyle = '';
```

| 变量 | 作用 |
|------|------|
| `pageStack` | 页面路径栈，栈顶为当前可见页面 |
| `pageViewIds` | 页面路径 → WebContentsView ID 的映射 |
| `pageDataCache` | 页面路径 → 最新 data 快照的缓存 |
| `globalAppStyle` | `app.wxss` 全局样式（经 WXSS 选择器转换后） |

#### 2. 模板编译引擎

**`renderTemplate(tpl, data)`**：

将 WXML 模板编译为 HTML，核心逻辑：
1. **数据绑定**：正则匹配 `{{expression}}`，支持多级路径访问（如 `{{user.name}}`）
2. **标签转换**：调用 `convertWxmlTags()` 将 WXML 标签映射为标准 HTML 标签

**`convertWxmlTags(html)`**：

| WXML 标签 | HTML 标签 | 特殊处理 |
|-----------|-----------|----------|
| `<image>` | `<img>` | 提取 src 属性，添加 `display:block;max-width:100%` 样式 |
| `<view>` | `<div>` | 直接替换开闭标签 |
| `<text>` | `<span>` | 直接替换开闭标签 |

**`convertWxssSelectors(css)`**：

将 WXSS 中的小程序标签选择器同步转换为标准 CSS 选择器，使用精确的上下文正则确保只替换标签名（避免替换属性值或内容中的同名字符串）。

#### 3. 页面视图管理

| 函数 | 作用 |
|------|------|
| `createPageView(pagePath)` | 通过 IPC 调用主进程创建 WebContentsView，返回 viewId |
| `renderPageInView(viewId, pagePath, data)` | 读取 wxml/wxss/json 文件，编译后发送渲染指令到页面视图 |
| `showPage(pagePath)` | 显示指定页面视图并设置 bounds |
| `hidePage(pagePath)` | 隐藏指定页面视图 |
| `destroyPage(pagePath)` | 销毁页面视图并清理缓存 |

**`renderPageInView` 详细流程**：
1. 并行读取三个文件：`index.wxml`（模板）、`index.wxss`（样式）、`index.json`（配置）
2. 解析页面配置 JSON
3. 调用 `renderTemplate()` 编译模板为 HTML
4. 调用 `convertWxssSelectors()` 转换样式选择器
5. 通过 `send-to-page-view` IPC 发送渲染指令（html + style + globalStyle）

#### 4. 导航栏控制 — `updateNavBar(pageConfig)`

```javascript
function updateNavBar(pageConfig) {
  navTitle.textContent = pageConfig.navigationBarTitleText ||
    (appConfig.window && appConfig.window.navigationBarTitleText) || '';
  navBack.style.display = pageStack.length > 1 ? 'flex' : 'none';
}
```

- 标题优先级：页面配置 > 全局配置 > 空字符串
- 返回按钮：栈深度 > 1 时显示

#### 5. 路由动画

**`animateSlideIn(newPage, oldPage, pageConfig)`** — 前进动画：

```
新页面从屏幕右侧 (offset = screenWidth) 滑入到 offset = 0
缓动函数：easeOut = 1 - (1 - t)³
动画时长：280ms
```

- 新页面初始位置设为屏幕右侧外
- 通过 `requestAnimationFrame` 逐帧修改 bounds
- 动画结束后更新导航栏

**`animateSlideOut(topPage, bottomPage, callback)`** — 后退动画：

```
当前页面从 offset = 0 滑出到 offset = screenWidth
完成后销毁视图并恢复底层页面位置
```

#### 6. 路由处理

**`handleNavigateBack(delta)`**：
1. 校验栈深度
2. 弹出栈顶页面
3. 发送 `notifyPageHide` 给 Worker（触发 onUnload）
4. 执行 slideOut 动画
5. 动画完成后更新底层页面的导航栏配置
6. 发送 `notifyPageShow` 给 Worker（触发 onShow）

#### 7. Worker 初始化与通信

**`initWorker(bundlePath)`**：
- 将主进程生成的 Worker bundle 路径转为 `file:///` URL
- 创建 Web Worker 实例
- 绑定 `onmessage` 处理函数

**`handleWorkerMessage(msg)`** — 处理 Worker 发来的所有消息：

| 消息类型 | 处理逻辑 |
|----------|----------|
| `pageReady` | 创建页面视图 → 编译渲染 → 根据是否为 navigateTo 决定是否播放动画 |
| `setData` | 重新编译模板并发送渲染指令到页面视图 |
| `navigateTo` | 标记导航方向（用于 pageReady 判断是否需要动画） |
| `navigateBack` | 调用 `handleNavigateBack()` |
| `showToast` | 向当前页面视图发送 Toast 渲染指令 |
| `readFile` | 文件读取代理：IPC 调用主进程 → 结果回传 Worker |

#### 8. 初始化流程

```
ipcRenderer.onInitContainer(initData)
  ├── 保存 appConfig 和 appDir
  ├── loadAppStyles()
  │     └── 读取 app.wxss → 转换选择器 → 注入主窗口 <style>
  ├── ipcRenderer.invoke('build-worker-bundle')
  │     └── 主进程复制 logic-worker.js → container/worker-bundle.js
  ├── initWorker(bundlePath)
  │     └── 创建 Worker 实例
  └── worker.postMessage({ type: 'init', data: { config } })
        └── 触发 Worker 加载 app.js → 执行首页
```

---

### container/container-preload.js

**文件定位**：主窗口的 Preload 脚本，通过 `contextBridge` 实现安全 IPC 桥接。

**安全机制**：

```javascript
contextBridge.exposeInMainWorld('containerBridge', {
  invoke: (channel, ...args) => {
    const allowed = ['create-page-view', 'read-file', 'build-worker-bundle'];
    if (allowed.includes(channel)) return ipcRenderer.invoke(channel, ...args);
    return Promise.reject(new Error('IPC channel not allowed'));
  },
  send: (channel, ...args) => {
    const allowed = ['set-page-view-bounds', 'show-page-view', 'hide-page-view',
                     'destroy-page-view', 'send-to-page-view'];
    if (allowed.includes(channel)) ipcRenderer.send(channel, ...args);
  },
});
```

**白名单机制**：
- `invoke` 白名单（双向通信）：`create-page-view`、`read-file`、`build-worker-bundle`
- `send` 白名单（单向发送）：`set-page-view-bounds`、`show-page-view`、`hide-page-view`、`destroy-page-view`、`send-to-page-view`

**事件监听**：
- `onInitContainer(callback)`：监听主进程的初始化消息
- `onPageViewEvent(callback)`：监听页面视图的事件消息

**设计意义**：`container.js` 通过 `window.containerBridge` 访问 IPC，无法直接 `require('electron')`，实现了渲染进程与 Node.js 能力的安全隔离。

---

### container/page-view.js

**文件定位**：页面视图的渲染脚本，运行在每个 WebContentsView 中，负责 DOM 更新、事件绑定和 Toast 显示。

#### 1. 渲染处理

```javascript
window.pageBridge.onRender(function (data) {
  if (data.showToast) { showToast(data.toastTitle, data.toastDuration); return; }
  // 更新样式和 HTML
  pageRoot.innerHTML = html;
  bindEvents(pageRoot);
});
```

- 监听 `pageBridge.onRender` 回调（来自 page-preload.js）
- 区分两种渲染指令：**普通渲染**（更新 DOM）和 **Toast 渲染**（显示提示）
- 每次更新 `innerHTML` 后重新绑定事件（因为 innerHTML 会销毁旧 DOM 节点）

#### 2. 事件绑定 — `bindEvents(container)`

扫描 DOM 属性，将小程序事件绑定映射为原生事件监听：

| 属性 | 映射 | 行为 |
|------|------|------|
| `[bindtap]` | `click` 事件 | 冒泡事件，发送事件名 + dataset |
| `[catchtap]` | `click` 事件 | 阻止冒泡事件（`stopPropagation`） |
| `[bindinput]` | `input` 事件 | 输入事件，发送事件名 + 当前输入值 |

所有事件通过 `pageBridge.sendEvent()` 发送到主进程，再中转到 Worker。

#### 3. Toast 实现 — `showToast(title, duration)`

```javascript
function showToast(title, duration) {
  var toast = document.createElement('div');
  toast.style.cssText =
    'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
    'background:rgba(0,0,0,0.7);color:#fff;padding:12px 24px;border-radius:8px;' +
    'font-size:14px;z-index:9999;';
  toast.textContent = title;
  document.body.appendChild(toast);
  setTimeout(function () { toast.remove(); }, duration || 1500);
}
```

- 居中定位的半透明黑色提示框
- 默认 1500ms 后自动移除
- 同时只显示一个 Toast（新 Toast 会移除旧的）

---

### container/page-preload.js

**文件定位**：页面视图的 Preload 脚本，为每个 WebContentsView 提供 `pageBridge` 安全 API。

```javascript
contextBridge.exposeInMainWorld('pageBridge', {
  onRender: (callback) => {
    renderCallback = callback;
    flushRenderQueue();
  },
  sendEvent: (eventName, eventPayload) => {
    ipcRenderer.send('page-view-event', { eventName, eventPayload });
  },
});
```

**渲染队列机制**：

```javascript
const renderQueue = [];
let renderCallback = null;

function flushRenderQueue() {
  if (renderCallback && renderQueue.length > 0) {
    const queue = renderQueue.slice();
    renderQueue.length = 0;
    queue.forEach((data) => renderCallback(data));
  }
}
```

- `renderQueue`：在 `onRender` 回调注册之前缓存渲染指令
- `flushRenderQueue()`：回调注册后，一次性清空队列中的所有缓存指令
- **解决的问题**：主进程可能在 page-view.js 执行之前就发送渲染指令，队列机制确保不丢失

**暴露的 API**：
- `onRender(callback)`：注册渲染回调，同时刷新缓存队列
- `sendEvent(eventName, eventPayload)`：发送用户交互事件到主进程

---

### container/page-view.html

**文件定位**：每个 WebContentsView 加载的 HTML 模板。

```html
<style id="page-style"></style>
<style id="global-style"></style>
<div id="page-root"></div>
```

| 元素 | 用途 |
|------|------|
| `#page-style` | 动态注入的页面级样式（`index.wxss` 转换后） |
| `#global-style` | 动态注入的全局样式（`app.wxss` 转换后） |
| `#page-root` | 页面内容挂载点，`innerHTML` 动态更新 |

**样式特点**：
- 全局允许纵向滚动（`overflow-y: auto`）
- `-webkit-overflow-scrolling: touch` 启用 iOS 弹性滚动效果
- 背景色 `#f7f7f7` 模拟微信小程序默认灰色背景

---

### container/worker-bundle.js

**文件定位**：运行时由主进程从 `framework/logic-worker.js` 复制生成的 Worker 脚本副本。

**存在原因**：Web Worker 要求脚本 URL 必须与页面同源或使用 `file:///` 协议。主进程将 `logic-worker.js` 复制到 `container/` 目录下，使 Worker 可以通过 `file:///` URL 正确加载。

**生成时机**：container.js 初始化时通过 `ipcRenderer.invoke('build-worker-bundle')` 触发主进程生成。

**内容**：与 `framework/logic-worker.js` 完全一致，是运行时生成的只读副本，不应手动编辑。

---

## 三、文件间协作关系

### 初始化顺序

```
index.html 加载
  → container.js 执行
    → container-preload.js 已注入 containerBridge
    → 等待 init-container IPC 消息
      → 加载 app.wxss 全局样式
      → 请求主进程构建 worker-bundle.js
      → 创建 Worker（加载 worker-bundle.js）
      → Worker init：加载 app.js → 执行 App() → 加载首页
        → Worker pageReady → container.js 创建 WebContentsView
          → WebContentsView 加载 page-view.html
            → page-preload.js 注入 pageBridge
            → page-view.js 注册 onRender 回调
          → container.js 发送渲染指令
            → page-view.js 更新 DOM → 绑定事件
```

### 数据更新闭环

```
用户点击 → page-view.js 捕获事件
  → pageBridge.sendEvent() → page-preload.js → IPC
  → main.js 中转 → container.js → Worker postMessage
  → logic-worker.js 查找 handler → 执行 → setData()
  → postMessage setData → container.js
  → renderTemplate() 编译 → send-to-page-view IPC
  → page-preload.js → page-view.js onRender
  → 更新 innerHTML → bindEvents() 重新绑定
```

---

## 四、WXML 指令处理引擎

模板编译引擎位于 `container/container.js` 中，通过 `processWxDirectives(tpl, data)` 统一调度，按 `wx:for` → `wx:if/elif/else` 的顺序依次处理。

### 整体调用链

```
renderTemplate(tpl, data)
  ├── processWxDirectives(tpl, data)
  │     ├── processWxFor(tpl, data)         ← 展开 wx:for 循环
  │     └── processWxIf(tpl, data)          ← 解析 if/elif/else 链
  ├── 替换 {{expression}} 数据绑定
  └── convertWxmlTags(html)                 ← 标签名转换
```

**处理顺序的设计意图**：先展开循环（`wx:for`），再进行条件判断（`wx:if/elif/else`），确保条件指令看到的是循环展开后的完整内容。

---

### 基础设施函数

#### resolveExpr(expr, data) — 表达式解析

支持以 `.` 分隔的多级属性路径访问：

```javascript
resolveExpr("user.name", { user: { name: "Tom" } })
// → "Tom"

resolveExpr("todos.length", { todos: ["a", "b"] })
// → 2
```

将表达式按 `.` 分割为键名数组，逐层从 `data` 对象中取值。遇到 `null`/`undefined` 中途返回 `null`。

#### evaluateCondition(condition, data) — 条件求值

兼容两种写法：

| 写法 | 示例 |
|------|------|
| 花括号包裹 | `{{visitCount === 0}}` |
| 裸写 | `visitCount === 0` |

**支持两类条件**：

1. **比较表达式**：通过正则 `^(.+?)\s*(===|!==|>=|<=|>|<)\s*(.+)$` 拆分为左值、运算符、右值
   - 左值通过 `resolveExpr()` 从 data 取值
   - 右值智能推断类型：字符串字面量（`"Tom"`）、布尔（`true`/`false`）、null、数字、或变量路径
2. **简单变量**：不匹配比较运算符时，回退到 `!!resolveExpr()` 真假判断

```
evaluateCondition("{{count < 5}}", { count: 3 })
  → 剥掉 {{ }} → "count < 5"
  → 正则拆分 → left="count", op="<", rightRaw="5"
  → resolveExpr("count", {count:3}) → 3
  → Number("5") → 5
  → 3 < 5 → true
```

---

### processWxFor(tpl, data) — 列表渲染

**正则匹配**：

```
/<(\w+)([^>]*)\swx:for="([^"]*)"
  (?:\s+wx:for-item="([^"]*)")?
  (?:\s+wx:for-index="([^"]*)")?
  ([^>]*)>([\s\S]*?)<\/\1>/g
```

| 捕获组 | 含义 |
|--------|------|
| `tag` | 标签名（view、text 等） |
| `before` | `wx:for` 之前的属性（如 class） |
| `listExpr` | 数组表达式（`{{items}}` 或 `items`） |
| `itemName` | 可选，循环变量名，默认 `item` |
| `indexName` | 可选，索引变量名，默认 `index` |
| `after` | `wx:for-item/wx:for-index` 之后的属性 |
| `content` | 标签子内容 |

**处理流程**：

```
匹配 wx:for 标签
  → 解析列表表达式（兼容 {{ }} 和裸写）
  → resolveExpr() 获取数组
  → 非数组则返回空字符串
  → 遍历数组每个元素：
      → 浅拷贝 data，注入 item 和 index 变量
      → 对子内容中的 {{ }} 做数据绑定替换
      → 拼接结果（移除 wx:for 等指令属性）
```

**支持的语法**：

```xml
<!-- 基本用法 -->
<view wx:for="{{items}}">{{item}}</view>

<!-- 对象数组 -->
<view wx:for="{{users}}">{{item.name}}</view>

<!-- 自定义变量名和索引名 -->
<view wx:for="{{items}}" wx:for-item="todo" wx:for-index="idx">
  {{idx}}: {{todo}}
</view>

<!-- 多级路径 -->
<view wx:for="{{data.list}}">{{item}}</view>
```

---

### processWxIf(tpl, data) — 条件渲染（if/elif/else）

与 `wx:for` 的单次正则替换不同，`wx:if/elif/else` 需要**链式条件组匹配**，因为它们在语义上是一个整体——第一个条件为真时后续分支全部跳过。

**算法流程**：

```
while (还有未处理的 wx:if) {
  1. exec 匹配第一个 wx:if 标签 → 记录 chainStart/chainEnd
  2. blocks = [ { condition, content } ]    ← if 块入队

  3. 从 chainEnd 位置开始，循环匹配 wx:elif（同标签名）
     → 每个 elif 块入队，chainEnd 后移

  4. 检查 chainEnd 位置是否有 wx:else（同标签名）
     → else 块入队（condition = null），chainEnd 后移

  5. 遍历 blocks，第一个 condition 为真（或 condition === null）的块输出
     → 其余块丢弃

  6. 用结果替换 chainStart ~ chainEnd 的整个链
}
```

**关键设计**：

- **标签名一致性**：elif 和 else 的正则动态构建，使用 if 块的标签名（`tag`）确保链的完整性。例如 `view wx:if` 后面只能跟 `view wx:elif`，不会错误匹配 `text wx:elif`
- **chainEnd 追踪**：每次匹配成功后 `chainEnd += match[0].length`，确保连续的 elif/else 被正确收集
- **while 循环**：处理完一条 if 链后 `changed = true`，继续处理模板中的其他独立 if 链
- **condition = null**：`wx:else` 块的 condition 设为 null，在求值时视为"始终为真"，作为兜底分支

**支持的语法**：

```xml
<!-- 单独 wx:if -->
<view wx:if="{{show}}">内容</view>

<!-- if + else -->
<view wx:if="{{isVip}}">VIP</view>
<view wx:else>普通用户</view>

<!-- if + elif + else -->
<view wx:if="{{level === 1}}">初级</view>
<view wx:elif="{{level === 2}}">中级</view>
<view wx:elif="{{level >= 3}}">高级</view>
<view wx:else>未知等级</view>
```

---

### 指令处理在渲染管线中的位置

```
renderTemplate(tpl, data)
  │
  ├─ ① processWxDirectives()
  │     ├─ processWxFor()      展开 wx:for，内部完成子元素的 {{ }} 绑定
  │     └─ processWxIf()       解析 if/elif/else 链式条件
  │
  ├─ ② 全局 {{ }} 替换          处理非 wx:for 子内容的数据绑定
  │
  └─ ③ convertWxmlTags()       view→div, text→span, image→img
```

**① 先于 ② 的原因**：`wx:for` 内部的 `{{ }}` 在 `processWxFor` 中已经完成绑定（因为需要注入 `item`/`index` 变量），步骤 ② 只处理非循环区域的绑定。

**① 中 for 先于 if 的原因**：先展开循环生成所有元素，再对展开后的结果做条件过滤。这与微信小程序的实际行为一致。

---

### 当前实现的局限性

| 局限 | 说明 |
|------|------|
| 嵌套同名标签 | 正则 `[\s\S]*?` 非贪婪匹配遇到嵌套同名标签时会提前截断（如 `<view wx:if>...<view>...</view>...</view>`） |
| wx:for 与 wx:if 同标签 | 同一个标签同时写 `wx:for` 和 `wx:if` 时，只有 `wx:for` 生效（微信小程序中两者可共存） |
| 表达式复杂度 | 比较表达式仅支持单次二元比较，不支持 `&&`、`||`、`!`、三元运算等复合表达式 |
| 属性顺序敏感 | `wx:for` 必须出现在 `wx:for-item`/`wx:for-index` 之前，`wx:elif`/`wx:else` 必须紧跟 `wx:if` 同标签名节点 |
