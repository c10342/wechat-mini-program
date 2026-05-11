# Mini Program

基于 Electron 的微信小程序双线程架构模拟器，在桌面端还原小程序核心运行机制——逻辑层与渲染层分离、页面路由栈、数据驱动视图、WXML/WXSS 模板编译、事件系统。

---

## 目录结构

```
mini-program/
├── main.js                      # Electron 主进程入口
├── package.json                 # 项目配置 (Electron v42)
├── .npmrc                       # npm 镜像（加速 Electron 下载）
├── vite.config.js               # Vite 构建配置
│
├── src/
│   ├── container/               # 渲染层（主窗口容器）
│   │   ├── index.html           #   主窗口：导航栏 + 页面挂载区
│   │   ├── index.js             #   容器控制：页面栈、路由动画、Worker 通信
│   │   ├── state.js             #   容器状态管理
│   │   ├── animation/           #   路由动画引擎
│   │   │   └── index.js
│   │   ├── components/          #   容器组件（导航栏等）
│   │   │   └── index.js
│   │   ├── handlers/            #   IPC 消息处理器
│   │   │   └── index.js
│   │   ├── pages/               #   页面视图管理
│   │   │   └── index.js
│   │   ├── template/            #   WXML/WXSS 模板编译引擎
│   │   │   └── index.js
│   │   ├── utils/               #   容器工具函数
│   │   │   └── index.js
│   │   └── worker/              #   Worker 通信管理
│   │       └── index.js
│   │
│   ├── page-view/               # 页面视图层（WebContentsView）
│   │   ├── page-view.html       #   页面视图 HTML 模板
│   │   ├── index.js             #   页面视图控制器
│   │   ├── custom-element/      #   自定义元素封装
│   │   │   └── index.js
│   │   ├── events/              #   事件绑定系统
│   │   │   └── index.js
│   │   ├── toast/               #   Toast 组件
│   │   │   └── index.js
│   │   └── utils/               #   视图工具函数
│   │       └── index.js
│   │
│   ├── preload/                 # Preload 脚本（contextBridge 安全桥接）
│   │   ├── container-preload.js #   主窗口 Preload
│   │   └── page-preload.js      #   页面视图 Preload
│   │
│   └── worker/                  # 逻辑层（Web Worker）
│       ├── index.js             #   Worker 入口
│       ├── state.js             #   Worker 状态管理
│       ├── app/                 #   App 注册与生命周期
│       │   └── index.js
│       ├── component/           #   组件系统
│       │   └── index.js
│       ├── component-loader/    #   组件加载器
│       │   └── index.js
│       ├── file/                #   文件读取代理
│       │   └── index.js
│       ├── handlers/            #   Worker 消息处理器
│       │   └── index.js
│       ├── module/              #   CommonJS 模块系统
│       │   └── index.js
│       ├── page/                #   Page 注册与生命周期
│       │   └── index.js
│       ├── page-loader/         #   页面加载器
│       │   └── index.js
│       ├── utils/               #   Worker 工具函数
│       │   └── index.js
│       └── wx-api/              #   wx API 兼容层
│           └── index.js
│
└── miniapp/                     # 小程序应用（用户代码）
    ├── app.js                   #   App() 入口注册
    ├── app.json                 #   全局配置（页面路由表、窗口样式）
    ├── app.wxss                 #   全局样式
    ├── components/              #   自定义组件
    │   ├── counter/
    │   │   ├── index.js
    │   │   ├── index.json
    │   │   ├── index.wxml
    │   │   └── index.wxss
    │   └── page-header/
    │       ├── index.js
    │       ├── index.json
    │       ├── index.wxml
    │       └── index.wxss
    └── pages/
        ├── index/               #   首页
        │   ├── index.js         #     Page({ data, onLoad, increment... })
        │   ├── index.json       #     { navigationBarTitleText: "Home" }
        │   ├── index.wxml       #     WXML 模板
        │   └── index.wxss       #     页面样式
        └── detail/              #   详情页
            ├── index.js         #     Page({ data, onLoad, goBack... })
            ├── index.json       #     { navigationBarTitleText: "Detail" }
            ├── index.wxml       #     WXML 模板
            └── index.wxss       #     页面样式
```

---

## 架构设计

### 整体架构图

```
 ┌───────────────────────────────────────────────────────────────┐
 │                     Electron 主进程 (main.js)                  │
 │                                                               │
 │   BrowserWindow (sandbox: true, contextIsolation: true)       │
 │   ├── 加载 src/container/index.html（主窗口）                  │
 │   ├── 管理 WebContentsView 池（每页一个独立渲染进程）            │
 │   ├── IPC: create-page-view / destroy-page-view               │
 │   ├── IPC: set-page-view-bounds / show / hide                 │
 │   ├── IPC: send-to-page-view / page-view-event                │
 │   ├── IPC: read-file（文件读取代理）                            │
 │   └── IPC: build-worker-bundle（Worker 脚本构建）               │
 └──────────┬────────────────────────────┬───────────────────────┘
            │                            │
      init-container              page-view-event
    (via containerBridge)          (IPC 双向中转)
            │                            │
            ▼                            │
 ┌──────────────────────────────────────┐ │
 │        主窗口 (src/container/)       │ │
 │   container/index.js 通过 containerBridge│ │
 │   访问 IPC，无 Node.js 直接访问权限    │ │
 │                                      │ │
 │  ┌──────────────┐  ┌──────────────┐  │ │
 │  │   导航栏      │  │  Web Worker   │  │ │
 │  │   nav-bar     │  │ src/worker/   │  │ │
 │  │              │  │              │  │ │
 │  │  ← 返回      │  │  App() 注册   │  │ │
 │  │   标题       │  │  Page() 注册  │  │ │
 │  └──────────────┘  │  setData 处理 │  │ │
 │                    │  wx API 模拟  │  │ │
 │  ┌──────────────────────────────┐  │ │
 │  │       页面挂载区               │  │ │
 │  │  ┌────────────────────────┐  │  │ │
 │  │  │   WebContentsView #1   │◄─┼──┘
 │  │  │   (page-view.html)     │  │
 │  │  │   首页渲染进程           │  │
 │  │  └────────────────────────┘  │
 │  │  ┌────────────────────────┐  │
 │  │  │   WebContentsView #2   │  │
 │  │  │   (page-view.html)     │  │
 │  │  │   详情页渲染进程         │  │
 │  │  └────────────────────────┘  │
 │  └──────────────────────────────┘
 └──────────────────────────────────────┘
```

### 三层职责划分

| 层级 | 位置 | 职责 |
|------|------|------|
| **主进程层** | [main.js](main.js) | 窗口管理，WebContentsView 生命周期，IPC 通道，文件读取代理，Worker 脚本构建 |
| **渲染层** | [src/container/](src/container) | 导航栏 UI，页面栈管理，路由动画（slideIn/slideOut），WXML→HTML 编译，Worker 消息调度 |
| **逻辑层** | [src/worker/](src/worker) | 执行 `App()`/`Page()` 注册，管理 Page 实例与 data，处理 `setData`，模拟 `wx` API，模块系统 |

### 与微信小程序真实架构的对照

| | 微信小程序 | 本项目 |
|------|-----------|--------|
| 逻辑层 | JSCore / V8 独立进程 | Web Worker |
| 渲染层 | WebView（iOS）/ chromium 内核（Android） | Electron WebContentsView |
| 通信方式 | JSBridge | postMessage + Electron IPC |
| 页面容器 | 多 WebView 实例 | 多 WebContentsView 实例 |
| 安全隔离 | 逻辑层无 DOM 访问 | Worker 无 DOM + 双层 contextBridge |

---

## 核心设计思路

### 1. 双线程模型

逻辑线程与渲染线程完全隔离，是本项目的核心设计：

- **逻辑层（Web Worker）**：`src/container/index.js` 创建 Worker 并加载 `src/worker/index.js`。所有 `App()`、`Page()`、`setData()` 在 Worker 中执行，天然无法操作 DOM。
- **渲染层（WebContentsView）**：每个页面对应一个独立渲染进程，通过 `contextIsolation: true` + `nodeIntegration: false` 实现安全隔离，仅暴露 `pageBridge` API。
- **通信桥接**：逻辑层 → `postMessage` → container.js → `IPC send-to-page-view` → 渲染视图；反向则通过 `page-view-event` IPC 回传。

### 2. 双层 contextBridge 安全隔离

主窗口和页面视图均使用独立的 Preload 脚本 + contextBridge，实现**双层安全隔离**：

**主窗口层 — [src/preload/container-preload.js](src/preload/container-preload.js)**

暴露 `containerBridge` 对象，仅允许白名单 IPC 通道：
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

**页面视图层 — [src/preload/page-preload.js](src/preload/page-preload.js)**

暴露 `pageBridge` 对象，仅允许渲染指令接收和事件发送：
```javascript
contextBridge.exposeInMainWorld('pageBridge', {
  onRender: (callback) => { ... },
  sendEvent: (eventName, eventPayload) => { ... },
});
```

[src/container/index.js](src/container/index.js) 通过 `window.containerBridge` 访问 IPC，**不直接使用 Node.js API**。

### 3. 页面栈与路由管理

模拟微信小程序的页面栈导航模型：

```
pageStack = ["pages/index", "pages/detail"]
                                      ↑ 栈顶 = 当前可见页面

wx.navigateTo  → 压栈 + slideIn 动画
wx.navigateBack → 出栈 + slideOut 动画 + 销毁视图
wx.redirectTo  → 替换栈顶
```

- 页面栈存储在 `src/container/index.js` 的 `pageStack[]` 数组中
- 每次路由变更同步更新导航栏标题和返回按钮可见性
- 栈深度 > 1 时显示返回按钮

### 4. 模板编译引擎

轻量级 WXML → HTML 实时编译，由 [src/container/template/index.js](src/container/template/index.js) 实现：

**数据绑定** — 正则解析 `{{expression}}`，支持多级路径访问：
```
renderTemplate("{{user.name}}", { user: { name: "test" } })
→ "test"
```

**标签转换** — WXML 标签映射为标准 HTML：
| WXML | HTML |
|------|------|
| `<view>` | `<div>` |
| `<text>` | `<span>` |
| `<image src="...">` | `<img src="...">` |

**WXSS 转换** — `convertWxssSelectors()` 将样式选择器中的小程序标签名同步替换。

### 5. 事件系统

完整的事件捕获 → 分发 → 处理链路：

```
用户点击 (WebContentsView 中)
  → src/page-view/events/index.js: bindEvents() 扫描 [bindtap] 属性绑定 click 监听
  → src/preload/page-preload.js: pageBridge.sendEvent(name, payload)
  → IPC page-view-event → main.js 中转 → src/container/index.js 接收
  → postMessage({ type: 'event' }) → src/worker/index.js
  → pageInstances[path][handlerName].call(instance, payload)
  → handler 执行 this.setData(...)
  → postMessage({ type: 'setData' }) → src/container/index.js
  → renderTemplate() + send-to-page-view → DOM 更新
```

支持三种事件绑定方式：
- `bindtap` — 冒泡事件（等同于 addEventListener）
- `catchtap` — 阻止冒泡事件（调用 stopPropagation）
- `bindinput` — 输入事件（监听 input 变化）

### 6. 数据驱动视图 (setData)

模拟微信小程序最核心的视图更新机制：

```javascript
// src/worker/page/index.js 中 createPageInstance() 定义 setData
setData: function (newData, callback) {
    Object.assign(instance.data, newData);
    sendMessage('setData', {
        path: pagePath,
        data: newData,
        fullData: deepClone(instance.data),
    });
}
```

数据流：`Worker setData` → `postMessage` → `src/container/index.js` 接收 fullData → `renderTemplate(wxml, fullData)` 重新编译 → `send-to-page-view` 渲染指令 → `src/page-view/index.js` 更新 `innerHTML`。

### 7. wx API 兼容层

在 Worker 中通过 `self.wx` 对象模拟小程序全局 API：

| API | 实现 |
|-----|------|
| `wx.navigateTo(url)` | 解析 URL 路径 + query 参数，触发 `loadPage()` + 页面栈压栈 |
| `wx.navigateBack(delta)` | 页面栈出栈，触发 slideOut 动画 |
| `wx.redirectTo(url)` | 替换当前页面 |
| `wx.showToast(title, duration)` | 通过渲染层显示自定义 Toast |
| `wx.getSystemInfoSync()` | 返回模拟设备信息 |
| `wx.getApp()` | 返回 App 实例（含 globalData） |
| `getCurrentPages()` | 返回所有 Page 实例数组 |

### 8. 页面切换动画

通过 `requestAnimationFrame` 驱动，动态修改 `WebContentsView.setBounds()` 实现位移：

- **slideIn（前进）**：新页面从屏幕右侧（offset = screenWidth）滑入到 offset = 0
- **slideOut（后退）**：当前页面从 offset = 0 滑出到 offset = screenWidth，完成后销毁
- **缓动函数**：`easeOut = 1 - (1 - t)³`
- **动画时长**：280ms

---

## 数据流全景

### 用户交互 → 视图更新（完整闭环）

```
 ┌──────────────────┐
 │  用户点击按钮      │
 └────────┬─────────┘
          │
          ▼
 ┌──────────────────┐     ┌─────────────────────────────────┐
 │  page-view/index.js │     │  page-preload.js              │
 │  bindEvents()    │────▶│  pageBridge.sendEvent()         │
 │  click listener  │     │  → ipcRenderer.send()           │
 └──────────────────┘     └───────────────┬─────────────────┘
                                          │
                                    IPC: page-view-event
                                          │
                          ┌───────────────▼─────────────────┐
                          │  main.js                         │
                          │  ipcMain.on('page-view-event')   │
                          │  → mainWindow.send() 转发        │
                          └───────────────┬─────────────────┘
                                          │
                          ┌───────────────▼─────────────────┐
                          │  container/index.js              │
                          │  containerBridge.onPageViewEvent │
                          │  → worker.postMessage(event)     │
                          └───────────────┬─────────────────┘
                                          │
                          ┌───────────────▼─────────────────┐
                          │  worker/index.js (Worker)        │
                          │  onmessage → 查找 handler        │
                          │  instance[eventName](payload)    │
                          │  → this.setData({ ... })         │
                          │  → postMessage({ type:'setData'})│
                          └───────────────┬─────────────────┘
                                          │
                          ┌───────────────▼─────────────────┐
                          │  container/index.js              │
                          │  handleWorkerMessage('setData')  │
                          │  → renderTemplate(wxml, data)    │
                          │  → convertWxmlTags()             │
                          │  → convertWxssSelectors()        │
                          │  → containerBridge.send(render)  │
                          └───────────────┬─────────────────┘
                                          │
                                    IPC: send-to-page-view
                                          │
                          ┌───────────────▼─────────────────┐
                          │  page-preload.js → page-view/index.js │
                          │  pageRoot.innerHTML = html       │
                          │  bindEvents() 重新绑定            │
                          │  ✅ 视图更新完成                   │
                          └─────────────────────────────────┘
```

### 文件读取链路

Worker 无法直接访问文件系统，需通过多级 IPC 代理：

```
Worker: requestFile('pages/index/index.js')
  → postMessage({ type: 'readFile', id, path })
  → src/container/index.js: handleWorkerMessage('readFile')
  → containerBridge.invoke('read-file', path)
  → main.js: ipcMain.handle('read-file')
  → fs.readFileSync(fullPath)
  → 返回 { success, content }
  → src/container/index.js: worker.postMessage({ type: 'fileResponse' })
  → Worker: pendingFileRequests[id](result)
```

### Worker 脚本构建链路

Worker bundle 的构建职责由主进程承担（渲染层无文件系统访问权限）：

```
src/container/index.js: containerBridge.invoke('build-worker-bundle')
  → main.js: ipcMain.handle('build-worker-bundle')
  → fs.readFileSync('src/worker/index.js')
  → fs.writeFileSync('dist/worker-bundle.js')
  → 返回 bundlePath
  → src/container/index.js: new Worker(bundlePath)
```

---

## 关键技术要点

### 双层安全隔离模型

```
 ┌─────────────────────────────────────────────┐
 │        主窗口 (BrowserWindow)                │
 │  sandbox: true                               │
 │  nodeIntegration: false                      │
 │  contextIsolation: true                      │
 │                                             │
 │  ┌──────────────┐   contextBridge  ┌──────────────────┐ │
 │  │ container/index.js │◄───────────────▶ │container-preload │ │
 │  │ (隔离世界)    │  containerBridge │   (preload)      │ │
 │  └──────────────┘  invoke() 白名单  └──────────────────┘ │
 │                     send() 白名单                         │
 └─────────────────────────────────────────────┘

 ┌─────────────────────────────────────────────┐
 │        页面视图 (WebContentsView)             │
 │  contextIsolation: true                      │
 │  nodeIntegration: false                      │
 │                                             │
 │  ┌─────────┐    contextBridge     ┌───────┐ │
 │  │ 页面 DOM │◄──────────────────▶ │pageBridge│ │
 │  │ (隔离世界)│   仅暴露安全 API     │(preload)│ │
 │  └─────────┘    sendEvent()       └───────┘ │
 │                 onRender()                   │
 └─────────────────────────────────────────────┘

 ┌─────────────────────────────────────────────┐
 │              Web Worker                      │
 │  无 DOM 访问                                  │
 │  无 window / document                        │
 │  仅通过 postMessage 通信                      │
 └─────────────────────────────────────────────┘
```

三层隔离确保：
- **主窗口**：`src/container/index.js` 通过白名单 `containerBridge` 访问 IPC，无法直接调用 `require('electron')`
- **页面视图**：通过 `pageBridge` 仅能接收渲染指令和发送事件
- **Worker**：天然无 DOM、无文件系统访问，仅通过 `postMessage` 通信

### 模块系统

Worker 内实现了简易 CommonJS 模块加载器：

- `createRequire(fromPath)` — 创建基于当前路径的 require 函数，支持相对路径 (`./`, `../`) 和绝对路径 (`/`) 解析
- `resolvePath()` — 路径解析，自动补全 `.js` 扩展名
- `loadModuleAsync(path)` — 异步加载模块，通过 `requestFile` 读取文件内容，使用 `new Function()` 在沙箱中执行
- `preloadModules(code)` — 在执行页面脚本前，正则扫描所有 `require()` 调用并预加载依赖
- `moduleCache` — 模块缓存，避免重复加载

### 页面生命周期

```
              Page({ ... }) 注册
                    │
        ┌───────────▼───────────┐
        │   onLoad(options)     │  接收路由参数（query string 解析）
        └───────────┬───────────┘
        ┌───────────▼───────────┐
        │   onShow()            │  页面进入前台
        └───────────┬───────────┘
                    │
          ┌─────────▼─────────┐
          │  页面可见          │  用户交互、setData 更新
          └─────────┬─────────┘
                    │
         ┌──────────┼──────────┐
         ▼                     ▼
   被新页面覆盖            页面销毁
   onHide()              onUnload()
   (实例保留)            (实例删除)
         │                     │
         ▼                     ▼
   从后台恢复               页面结束
   onShow()
   (重新显示)
```

### App 生命周期

源码：[src/worker/app/index.js](src/worker/app/index.js)

```javascript
App({
  onLaunch: function () { },
  onShow: function () { },
  onHide: function () { },
  globalData: { }
});
```

| 生命周期 | 触发时机 | 源码调用位置 |
|---------|---------|------------|
| `onLaunch` | Worker 初始化时，App 注册完成后调用一次 | [src/worker/index.js](src/worker/index.js) |
| `onShow` | 预留接口，当前未主动触发 | [src/worker/app/index.js](src/worker/app/index.js) |
| `onHide` | 预留接口，当前未主动触发 | [src/worker/app/index.js](src/worker/app/index.js) |
| `globalData` | 全局共享数据对象，通过 `wx.getApp().globalData` 访问 | [src/worker/app/index.js](src/worker/app/index.js) |

### Page 生命周期

源码：[src/worker/page/index.js](src/worker/page/index.js)

```javascript
Page({
  data: { },
  onLoad: function (options) { },
  onShow: function () { },
  onHide: function () { },
  onUnload: function () { },
  // 自定义事件处理函数
  handleTap: function () { },
  methods: {
    customMethod: function () { }
  }
});
```

| 生命周期 | 触发时机 | 源码调用位置 |
|---------|---------|------------|
| `onLoad(query)` | Page 注册后立即调用，接收路由参数对象（query string 解析结果） | [src/worker/page/index.js](src/worker/page/index.js) |
| `onShow()` | 页面脚本加载完成后调用 | [src/worker/page-loader/index.js](src/worker/page-loader/index.js) |
| `onHide()` | 被新页面覆盖时调用（`wx.navigateTo`） | [src/worker/page-loader/index.js](src/worker/page-loader/index.js) |
| `onUnload()` | 页面出栈销毁时调用（`wx.navigateBack`） | [src/worker/page-loader/index.js](src/worker/page-loader/index.js) |

Page 实例属性：

| 属性 | 说明 | 源码位置 |
|------|------|---------|
| `data` | 页面初始数据对象 | [src/worker/page/index.js](src/worker/page/index.js) |
| `setData(data, callback)` | 合并数据并发送完整快照到渲染层，触发视图更新 | [src/worker/page/index.js](src/worker/page/index.js) |
| 自定义函数 | 直接定义在 Page 选项中的函数，自动绑定 `this` 到实例 | [src/worker/page/index.js](src/worker/page/index.js) |
| `methods` | 可选的方法命名空间，其中所有函数也会绑定到实例 | [src/worker/page/index.js](src/worker/page/index.js) |

### app.json 配置

源码消费位置：[main.js:15-30](main.js#L15-L30)、[src/container/index.js](src/container/index.js)

```json
{
  "pages": [
    "pages/index",
    "pages/detail"
  ],
  "window": {
    "navigationBarTitleText": "MiniApp Demo",
    "navigationBarBackgroundColor": "#ffffff",
    "navigationBarTextStyle": "black",
    "backgroundColor": "#f7f7f7",
    "width": 375,
    "height": 667
  }
}
```

| 字段 | 类型 | 默认值 | 作用 | 消费位置 |
|------|------|--------|------|---------|
| `pages` | `string[]` | — | 页面路由表，第一个元素为启动首页 | [src/worker/page-loader/index.js](src/worker/page-loader/index.js) |
| `window.width` | `number` | `375` | 主窗口宽度 | [main.js](main.js) |
| `window.height` | `number` | `667` | 主窗口高度 | [main.js](main.js) |
| `window.navigationBarTitleText` | `string` | `'Mini Program'` | 默认导航栏标题，也用作窗口 title | [main.js](main.js)、[src/container/index.js](src/container/index.js) |
| `window.navigationBarBackgroundColor` | `string` | — | 预留：导航栏背景色 | 配置已声明，待实现 |
| `window.navigationBarTextStyle` | `string` | — | 预留：导航栏文字颜色（black/white） | 配置已声明，待实现 |
| `window.backgroundColor` | `string` | — | 预留：窗口背景色 | 配置已声明，待实现 |

### 页面 index.json 配置

源码消费位置：[src/container/index.js](src/container/index.js)

```json
{
  "navigationBarTitleText": "Home"
}
```

| 字段 | 类型 | 作用 | 消费位置 |
|------|------|------|---------|
| `navigationBarTitleText` | `string` | 当前页面导航栏标题，覆盖 app.json 中的默认值 | [src/container/index.js](src/container/index.js) |

**配置优先级**：`页面 index.json.navigationBarTitleText` > `app.json.window.navigationBarTitleText` > `''`

源码逻辑：
```javascript
navTitle.textContent = pageConfig.navigationBarTitleText ||
  (appConfig.window && appConfig.window.navigationBarTitleText) || '';
```

### setData 的深拷贝策略

```javascript
// Worker 侧：合并数据后发送完整快照
setData: function (newData, callback) {
    Object.assign(instance.data, newData);        // 合并到实例 data
    sendMessage('setData', {
        path: pagePath,
        fullData: deepClone(instance.data),        // 发送完整深拷贝
    });
}

// container.js 侧：缓存完整数据快照
pageDataCache[pagePath] = deepClone(fullData);     // 用于后续局部更新
```

使用 `JSON.parse(JSON.stringify())` 实现深拷贝，确保 Worker 与渲染层的数据互不引用。

---

## 启动流程

```
npm run dev
    │
    ▼
[1] electron . → main.js
    │
    ▼
[2] loadMiniAppConfig() → 读取 miniapp/app.json
    │  { pages: ["pages/index", "pages/detail"], window: { ... } }
    │
    ▼
[3] createMainWindow(config)
    │  new BrowserWindow({
    │    sandbox: true, nodeIntegration: false, contextIsolation: true,
    │    preload: 'src/preload/container-preload.js'
    │  })
    │  mainWindow.loadFile('src/container/index.html')
    │
    ▼
[4] did-finish-load → mainWindow.send('init-container', { config, appDir })
    │  (通过 container-preload.js 的 contextBridge 传递)
    │
    ▼
[5] src/container/index.js 接收 'init-container'
    ├── loadAppStyles()                    → containerBridge.invoke('read-file') → 读取 app.wxss
    ├── containerBridge.invoke('build-worker-bundle')  → 主进程构建 Worker 脚本
    └── initWorker(bundlePath)             → new Worker(bundleUrl)
         │
         ▼
[6] Worker 接收 { type: 'init', config }
    ├── loadAppScript()          → requestFile('app.js') → executeScript() → App() 注册
    ├── appMethods.onLaunch()    → 执行 App 生命周期
    └── loadPage('pages/index')  → requestFile('pages/index/index.js') → executeScript() → Page() 注册
         │
         ▼
[7] Worker → postMessage({ type: 'pageReady', path, data })
    │
    ▼
[8] src/container/index.js 接收 'pageReady'
    ├── createPageView()         → containerBridge.invoke('create-page-view') → IPC 创建 WebContentsView
    ├── renderPageInView()       → 读取 .wxml + .wxss + .json → renderTemplate → 发送渲染指令
    ├── pageStack.push(path)     → 压入页面栈
    └── showPage() + updateNavBar()
         │
         ▼
[9] ✅ 首页渲染完成，用户可交互
```

---

## 快速开始

```bash
# 安装依赖
npm install

# 启动
npm run dev
```

启动后会打开一个 375×667 的窗口模拟手机屏幕，自动加载 `miniapp/pages/index` 首页。点击 "Go to Detail Page" 可体验页面跳转动画。

---

## 技术栈

| 技术 | 用途 |
|------|------|
| Electron v42 | 桌面应用容器，提供多进程架构 |
| Web Worker | 逻辑层隔离，运行 App/Page 代码 |
| WebContentsView | 多页面独立渲染，每个页面独立进程 |
| contextBridge + Preload | 双层安全通信桥接（主窗口 + 页面视图） |
| requestAnimationFrame | 页面切换动画驱动 |
| CSS transition | 交互反馈动画 |
| Vite | 构建工具 |

---

## 项目特色

1. **双线程架构精确还原** — Worker（逻辑层）+ WebContentsView（渲染层），与微信小程序真实架构一一对应
2. **双层安全隔离** — 主窗口和页面视图均使用 contextBridge + 白名单 IPC，渲染层零 Node.js 访问
3. **完整路由系统** — 页面栈管理 + slideIn/slideOut 过渡动画 + 路由参数传递
4. **数据驱动视图** — `setData` 触发模板重编译和 DOM 更新
5. **WXML/WXSS 编译** — 小程序模板语法自动转换为 Web 标准标签和样式
6. **事件系统** — 支持 `bindtap`（冒泡）/ `catchtap`（阻止冒泡）/ `bindinput`（输入）
7. **Worker 脚本由主进程构建** — 渲染层无文件系统权限，Worker bundle 构建移至主进程 IPC
8. **生命周期管理** — `onLoad` / `onShow` / `onHide` / `onUnload` 完整回调链
9. **模块系统** — Worker 内 CommonJS require 支持，含路径解析和模块缓存
10. **组件系统** — 支持自定义组件注册和使用 |