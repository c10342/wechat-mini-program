# 源码分析：src/worker 与 src/container

本文档对 `src/worker/` 和 `src/container/` 两个核心目录下的所有源文件进行逐文件功能分析和代码解读。

---

## 一、src/worker/ — 逻辑层

逻辑层运行在 Web Worker 线程中，天然无法访问 DOM，与微信小程序双线程模型中逻辑层的限制一致。该目录采用模块化架构，将 App 注册、Page 注册、模块系统、wx API 等功能分离为独立模块。

---

### src/worker/index.js

**文件定位**：Worker 入口文件，负责初始化消息监听、加载 App 脚本和首页。

**核心职责**：
1. **消息分发中心**：监听来自渲染层的所有消息，按 `type` 字段分发到对应处理器
2. **初始化流程**：接收 `init` 消息后，加载 app.json 配置 → 执行 app.js → 调用 App.onLaunch() → 加载首页
3. **全局状态管理**：维护 `appConfig`、`pageInstances` 等全局状态

**消息处理映射**：

| 消息类型 | 处理逻辑 |
|----------|----------|
| `init` | 加载配置 → 执行 app.js → 调用 App.onLaunch() → 加载首页 |
| `event` | 查找页面实例的事件处理函数并调用 |
| `loadPage` | 加载指定页面（路由跳转） |
| `notifyPageHide` | 对页面实例调用 onHide() |
| `notifyPageShow` | 对页面实例调用 onShow() |
| `fileResponse` | 匹配文件请求 id，resolve 对应 Promise |

---

### src/worker/state.js

**文件定位**：Worker 全局状态管理，集中存储所有共享状态。

**状态变量**：

| 变量 | 类型 | 作用 |
|------|------|------|
| `appConfig` | `Object` | 存储 `app.json` 解析后的全局配置（页面路由表、窗口样式等） |
| `currentPage` | `string` | 当前正在注册的页面路径，作为 `Page()` 调用时的上下文标识 |
| `pageInstances` | `Object` | 以页面路径为 key、页面实例为 value 的对象，存储所有已注册的 Page 实例 |
| `appMethods` | `Object` | 存储 App 注册时的生命周期钩子和 globalData |
| `pendingFileRequests` | `Object` | 文件请求队列，用于异步文件读取的 Promise 管理 |
| `requestIdCounter` | `number` | 文件请求 ID 计数器，确保每个请求唯一 |
| `moduleCache` | `Object` | 模块缓存，key 为模块路径，value 为导出对象 |

---

### src/worker/app/index.js

**文件定位**：App 注册系统，实现微信小程序的 `App()` 全局注册函数。

**核心实现**：

```javascript
self.App = function (options) {
  // 提取 globalData
  if (options.globalData) {
    appMethods.globalData = options.globalData;
  }
  // 提取生命周期钩子
  ['onLaunch', 'onShow', 'onHide'].forEach(function (hook) {
    if (typeof options[hook] === 'function') {
      appMethods[hook] = options[hook];
    }
  });
};
```

**API 暴露**：
- `wx.getApp()` — 返回包含 `globalData` 的 App 实例引用
- `getApp()` — 全局快捷函数，等同于 `wx.getApp()`

---

### src/worker/page/index.js

**文件定位**：Page 注册系统，实现微信小程序的 `Page()` 页面注册函数。

**核心职责**：

#### 1. Page 实例创建 — `createPageInstance(pagePath, pageDefine)`

构建包含以下能力的实例对象：

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
- 遍历 Page 定义中的所有函数属性，通过 `.apply(instance)` 将 `this` 绑定到实例
- `methods` 命名空间中的方法也会被展开绑定到实例上
- 保留字 `data`、`methods` 被跳过

#### 2. Page 注册流程

1. **校验上下文**：检查 `currentPage` 是否已设置
2. **创建实例**：调用 `createPageInstance()` 构建页面实例
3. **存储实例**：以路径为 key 存入 `pageInstances`
4. **触发 onLoad**：立即调用 `instance.onLoad(query)`，传入路由参数
5. **发送 pageReady**：通知渲染层页面数据已就绪

---

### src/worker/page-loader/index.js

**文件定位**：页面加载器，负责加载页面脚本、管理页面生命周期。

**核心流程 — `loadPage(pagePath, query)`**：

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

**生命周期触发时机**：

| 生命周期 | 触发时机 |
|---------|---------|
| `onLoad(query)` | Page 注册后立即调用 |
| `onShow()` | 页面脚本加载完成后调用 |
| `onHide()` | 被新页面覆盖时调用（`wx.navigateTo`） |
| `onUnload()` | 页面出栈销毁时调用（`wx.navigateBack`） |

---

### src/worker/component/index.js

**文件定位**：组件系统，实现小程序自定义组件的注册和实例化。

**核心功能**：
- `Component(options)` — 组件注册函数
- `createComponentInstance()` — 创建组件实例
- 支持组件的 `data`、`properties`、`methods`、生命周期钩子

**组件生命周期**：
- `created` — 组件实例化时调用
- `attached` — 组件挂载到页面时调用
- `detached` — 组件从页面卸载时调用

---

### src/worker/component-loader/index.js

**文件定位**：组件加载器，负责加载组件文件并创建组件实例。

**组件加载流程**：
1. 读取组件的 `.js`、`.json`、`.wxml`、`.wxss` 文件
2. 解析组件配置
3. 创建组件实例
4. 编译组件模板

---

### src/worker/wx-api/index.js

**文件定位**：wx API 兼容层，模拟微信小程序的全局 `wx` 对象。

**实现的 API**：

| API | 实现方式 |
|-----|----------|
| `wx.navigateTo(url)` | 解析 URL 中的路径和 query 参数，调用 `loadPage()` 加载新页面 |
| `wx.navigateBack(delta)` | 发送 `navigateBack` 消息，由 container.js 执行出栈动画 |
| `wx.redirectTo(url)` | 类似 navigateTo，发送 `redirectTo` 消息替换当前页面 |
| `wx.getSystemInfoSync()` | 返回硬编码的设备信息对象（brand、model、屏幕尺寸等） |
| `wx.showToast(params)` | 发送 `showToast` 消息，由渲染层显示 Toast 提示 |
| `wx.getApp()` | 返回包含 `globalData` 的 App 实例引用 |
| `getCurrentPages()` | 返回所有 Page 实例数组 |

**URL 解析逻辑**（navigateTo/redirectTo 共用）：
1. 从 URL 中分离路径和 query string（以 `?` 为界）
2. 去除前导 `/`（将绝对路径转为相对路径）
3. 去除尾部 `/index`（微信小程序允许省略 index）
4. 调用 `parseQuery()` 解析参数

---

### src/worker/module/index.js

**文件定位**：CommonJS 模块系统，实现 `require()` 语法支持。

**核心函数**：

| 函数 | 作用 |
|------|------|
| `resolvePath(fromPath, requirePath)` | 处理绝对路径（以 `/` 开头）和相对路径（`./`、`../`），自动补全 `.js` 后缀 |
| `loadModuleAsync(modulePath)` | 异步加载模块：通过 `requestFile()` 获取源码，使用 `new Function()` 构建沙箱执行环境 |
| `preloadModules(code, fromPath)` | 在执行脚本前，用正则扫描所有 `require()` 调用，提前异步加载所有依赖模块 |
| `executeScript(code, fromPath)` | 在沙箱环境中执行脚本，注入 `require`、`module`、`exports` 变量 |

**模块缓存机制**：
- 通过 `moduleCache` 实现模块缓存，避免重复加载
- 缓存 key 为模块的绝对路径

---

### src/worker/file/index.js

**文件定位**：文件读取代理，实现 Worker 与主进程之间的文件读取通信。

**核心实现 — `requestFile(relativePath)`**：

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

---

### src/worker/handlers/index.js

**文件定位**：消息处理器集合，封装各种消息类型的处理逻辑。

**处理器映射**：

| 消息类型 | 处理器函数 | 职责 |
|----------|-----------|------|
| `init` | `handleInit()` | 初始化 Worker，加载 app.js 和首页 |
| `event` | `handleEvent()` | 处理用户交互事件，调用页面实例的事件处理函数 |
| `loadPage` | `handleLoadPage()` | 加载指定页面 |
| `notifyPageHide` | `handleNotifyPageHide()` | 触发页面实例的 onHide 生命周期 |
| `notifyPageShow` | `handleNotifyPageShow()` | 触发页面实例的 onShow 生命周期 |
| `fileResponse` | `handleFileResponse()` | 处理文件读取响应 |

---

### src/worker/utils/index.js

**文件定位**：Worker 工具函数集合。

**工具函数**：

| 函数 | 作用 |
|------|------|
| `sendMessage(type, data)` | 向渲染层（container.js）发送消息的统一封装 |
| `deepClone(obj)` | 通过 `JSON.parse(JSON.stringify())` 实现深拷贝 |
| `parseQuery(queryStr)` | 将 URL query string 解析为键值对对象 |
| `isPlainObject(obj)` | 判断是否为纯对象 |

---

## 二、src/container/ — 渲染层

渲染层负责页面视图渲染、导航栏管理、路由动画和 IPC 安全桥接，采用模块化架构组织代码。

---

### src/container/index.js

**文件定位**：渲染层核心控制器，负责页面栈管理、Worker 通信、模板编译、路由动画。

**全局状态**：

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

**核心职责**：
1. **Worker 初始化与通信**：创建 Worker 实例，处理 Worker 发来的消息
2. **页面视图管理**：创建、渲染、显示、隐藏、销毁页面视图
3. **路由管理**：处理页面栈的压栈、出栈、替换操作
4. **导航栏控制**：动态更新导航栏标题和返回按钮可见性

---

### src/container/state.js

**文件定位**：容器状态管理，集中存储渲染层的共享状态。

**状态变量**：

| 变量 | 类型 | 作用 |
|------|------|------|
| `appConfig` | `Object` | 小程序全局配置（来自 app.json） |
| `appDir` | `string` | 小程序应用目录路径 |
| `worker` | `Worker` | Web Worker 实例 |
| `pageStack` | `Array` | 页面路径栈 |
| `pageViewIds` | `Object` | 页面路径到 WebContentsView ID 的映射 |
| `pageDataCache` | `Object` | 页面数据快照缓存 |
| `globalAppStyle` | `string` | 全局样式字符串 |
| `isNavigating` | `boolean` | 是否正在导航中（用于动画防重入） |

---

### src/container/template/index.js

**文件定位**：模板编译引擎，负责 WXML → HTML 的实时编译。

**核心函数**：

| 函数 | 作用 |
|------|------|
| `renderTemplate(tpl, data)` | 将 WXML 模板编译为 HTML |
| `convertWxmlTags(html)` | 将 WXML 标签映射为标准 HTML 标签 |
| `convertWxssSelectors(css)` | 将 WXSS 选择器转换为标准 CSS 选择器 |
| `processWxDirectives(tpl, data)` | 处理 WXML 指令（wx:for、wx:if 等） |

**标签转换规则**：

| WXML 标签 | HTML 标签 | 特殊处理 |
|-----------|-----------|----------|
| `<image>` | `<img>` | 添加 `display:block;max-width:100%` 样式 |
| `<view>` | `<div>` | 直接替换 |
| `<text>` | `<span>` | 直接替换 |

---

### src/container/animation/index.js

**文件定位**：路由动画引擎，实现 slideIn/slideOut 过渡动画。

**动画实现**：

**`animateSlideIn(newPage, oldPage, pageConfig)` — 前进动画**：
- 新页面从屏幕右侧（offset = screenWidth）滑入到 offset = 0
- 缓动函数：`easeOut = 1 - (1 - t)³`
- 动画时长：280ms

**`animateSlideOut(topPage, bottomPage, callback)` — 后退动画**：
- 当前页面从 offset = 0 滑出到 offset = screenWidth
- 完成后销毁视图并恢复底层页面位置

**核心技术**：
- 使用 `requestAnimationFrame` 驱动动画
- 通过 `containerBridge.send('set-page-view-bounds')` 动态修改 WebContentsView 的位置

---

### src/container/pages/index.js

**文件定位**：页面视图管理，负责 WebContentsView 的创建、渲染和销毁。

**核心函数**：

| 函数 | 作用 |
|------|------|
| `createPageView(pagePath)` | 通过 IPC 调用主进程创建 WebContentsView |
| `renderPageInView(viewId, pagePath, data)` | 读取 wxml/wxss/json 文件，编译后发送渲染指令 |
| `showPage(pagePath)` | 显示指定页面视图 |
| `hidePage(pagePath)` | 隐藏指定页面视图 |
| `destroyPage(pagePath)` | 销毁页面视图并清理缓存 |

**`renderPageInView` 详细流程**：
1. 并行读取三个文件：`index.wxml`（模板）、`index.wxss`（样式）、`index.json`（配置）
2. 解析页面配置 JSON
3. 调用 `renderTemplate()` 编译模板为 HTML
4. 调用 `convertWxssSelectors()` 转换样式选择器
5. 通过 `send-to-page-view` IPC 发送渲染指令

---

### src/container/components/index.js

**文件定位**：容器组件管理，包含导航栏等 UI 组件。

**导航栏组件**：
- `updateNavBar(pageConfig)` — 更新导航栏标题和返回按钮状态
- 标题优先级：页面配置 > 全局配置 > 空字符串
- 返回按钮：栈深度 > 1 时显示

---

### src/container/handlers/index.js

**文件定位**：IPC 消息处理器集合，处理来自主进程和页面视图的消息。

**处理器映射**：

| 消息类型 | 处理器函数 | 职责 |
|----------|-----------|------|
| `pageReady` | `handlePageReady()` | 页面数据就绪，创建视图并渲染 |
| `setData` | `handleSetData()` | 重新编译模板并发送渲染指令 |
| `navigateTo` | `handleNavigateTo()` | 处理页面跳转（压栈） |
| `navigateBack` | `handleNavigateBack()` | 处理页面返回（出栈） |
| `showToast` | `handleShowToast()` | 向当前页面视图发送 Toast 指令 |
| `readFile` | `handleReadFile()` | 文件读取代理 |

---

### src/container/worker/index.js

**文件定位**：Worker 通信管理，封装 Worker 的创建和消息处理。

**核心函数**：

| 函数 | 作用 |
|------|------|
| `initWorker(bundlePath)` | 创建 Web Worker 实例并绑定消息处理器 |
| `sendToWorker(type, data)` | 向 Worker 发送消息 |
| `handleWorkerMessage(msg)` | 处理 Worker 发来的消息 |

---

### src/container/utils/index.js

**文件定位**：容器工具函数集合。

**工具函数**：

| 函数 | 作用 |
|------|------|
| `deepClone(obj)` | 深拷贝对象 |
| `resolveExpr(expr, data)` | 解析数据绑定表达式，支持多级路径 |
| `evaluateCondition(condition, data)` | 求值条件表达式 |
| `convertWxmlTags(html)` | WXML 标签转换 |
| `convertWxssSelectors(css)` | WXSS 选择器转换 |

---

## 三、src/page-view/ — 页面视图层

页面视图层运行在每个 WebContentsView 中，负责 DOM 更新、事件绑定和 Toast 显示。

---

### src/page-view/index.js

**文件定位**：页面视图控制器，负责接收渲染指令并更新 DOM。

**核心流程**：

```javascript
window.pageBridge.onRender(function (data) {
  if (data.showToast) { 
    showToast(data.toastTitle, data.toastDuration); 
    return; 
  }
  // 更新样式和 HTML
  pageRoot.innerHTML = data.html;
  bindEvents(pageRoot);
});
```

**职责**：
1. 监听 `pageBridge.onRender` 回调
2. 区分普通渲染和 Toast 渲染
3. 更新 DOM 后重新绑定事件

---

### src/page-view/events/index.js

**文件定位**：事件绑定系统，实现小程序事件到原生事件的映射。

**事件映射**：

| 属性 | 映射 | 行为 |
|------|------|------|
| `[bindtap]` | `click` 事件 | 冒泡事件，发送事件名 + dataset |
| `[catchtap]` | `click` 事件 | 阻止冒泡事件（`stopPropagation`） |
| `[bindinput]` | `input` 事件 | 输入事件，发送事件名 + 当前输入值 |

**事件发送**：所有事件通过 `pageBridge.sendEvent()` 发送到主进程，再中转到 Worker。

---

### src/page-view/toast/index.js

**文件定位**：Toast 组件实现。

**实现逻辑**：

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

**特性**：
- 居中定位的半透明黑色提示框
- 默认 1500ms 后自动移除
- 同时只显示一个 Toast

---

### src/page-view/custom-element/index.js

**文件定位**：自定义元素封装，支持小程序组件的 DOM 渲染。

---

### src/page-view/utils/index.js

**文件定位**：页面视图工具函数集合。

---

## 四、src/preload/ — Preload 脚本

Preload 脚本通过 `contextBridge` 实现安全的 IPC 桥接，是渲染进程与主进程通信的唯一安全通道。

---

### src/preload/container-preload.js

**文件定位**：主窗口的 Preload 脚本。

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
  onInitContainer: (callback) => { ... },
  onPageViewEvent: (callback) => { ... },
});
```

**白名单机制**：
- `invoke` 白名单（双向通信）：`create-page-view`、`read-file`、`build-worker-bundle`
- `send` 白名单（单向发送）：`set-page-view-bounds`、`show-page-view`、`hide-page-view`、`destroy-page-view`、`send-to-page-view`

---

### src/preload/page-preload.js

**文件定位**：页面视图的 Preload 脚本。

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
- `renderQueue`：在 `onRender` 回调注册之前缓存渲染指令
- `flushRenderQueue()`：回调注册后，一次性清空队列中的所有缓存指令
- 解决主进程可能在 page-view.js 执行之前发送渲染指令的问题

---

## 五、文件间协作关系

### 初始化顺序

```
src/container/index.html 加载
  → src/container/index.js 执行
    → src/preload/container-preload.js 已注入 containerBridge
    → 等待 init-container IPC 消息
      → loadAppStyles() 读取 app.wxss 全局样式
      → 请求主进程构建 worker-bundle.js
      → initWorker() 创建 Worker（加载 src/worker/index.js）
      → Worker init：加载 app.js → 执行 App() → 加载首页
        → Worker pageReady → src/container/index.js 创建 WebContentsView
          → WebContentsView 加载 src/page-view/page-view.html
            → src/preload/page-preload.js 注入 pageBridge
            → src/page-view/index.js 注册 onRender 回调
          → src/container/index.js 发送渲染指令
            → src/page-view/index.js 更新 DOM → bindEvents() 重新绑定
```

### 数据更新闭环

```
用户点击 → src/page-view/events/index.js 捕获事件
  → pageBridge.sendEvent() → src/preload/page-preload.js → IPC
  → main.js 中转 → src/container/index.js → Worker postMessage
  → src/worker/index.js 查找 handler → 执行 → setData()
  → postMessage setData → src/container/index.js
  → renderTemplate() 编译 → send-to-page-view IPC
  → src/preload/page-preload.js → src/page-view/index.js onRender
  → 更新 innerHTML → bindEvents() 重新绑定
```

---

## 六、WXML 指令处理引擎

模板编译引擎位于 `src/container/template/index.js` 中，通过 `processWxDirectives(tpl, data)` 统一调度。

### 整体调用链

```
renderTemplate(tpl, data)
  ├── processWxDirectives(tpl, data)
  │     ├── processWxFor(tpl, data)         ← 展开 wx:for 循环
  │     └── processWxIf(tpl, data)          ← 解析 if/elif/else 链
  ├── 替换 {{expression}} 数据绑定
  └── convertWxmlTags(html)                 ← 标签名转换
```

### 指令处理顺序

1. **先处理 `wx:for`**：展开循环生成所有元素
2. **再处理 `wx:if/elif/else`**：对展开后的结果做条件过滤
3. **最后处理 `{{ }}` 数据绑定**：替换剩余的表达式

### 支持的指令

| 指令 | 功能 | 示例 |
|------|------|------|
| `wx:for` | 列表渲染 | `<view wx:for="{{items}}">{{item}}</view>` |
| `wx:for-item` | 自定义循环变量名 | `wx:for-item="todo"` |
| `wx:for-index` | 自定义索引变量名 | `wx:for-index="idx"` |
| `wx:if` | 条件渲染 | `<view wx:if="{{show}}">内容</view>` |
| `wx:elif` | 条件分支 | `<view wx:elif="{{type === 'a'}}">A</view>` |
| `wx:else` | 条件兜底 | `<view wx:else>其他</view>` |

---

## 七、当前实现的局限性

| 局限 | 说明 |
|------|------|
| 嵌套同名标签 | 正则非贪婪匹配遇到嵌套同名标签时会提前截断 |
| wx:for 与 wx:if 同标签 | 同一个标签同时写 `wx:for` 和 `wx:if` 时，只有 `wx:for` 生效 |
| 表达式复杂度 | 比较表达式仅支持单次二元比较，不支持 `&&`、`||`、`!`、三元运算等 |
| 属性顺序敏感 | `wx:for` 必须出现在 `wx:for-item`/`wx:for-index` 之前 |
| 组件嵌套深度 | 组件嵌套层级有限制 |