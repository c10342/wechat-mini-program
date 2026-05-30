# AGENTS.md

## 项目概览

这是一个基于 Electron + TypeScript 的小程序运行容器项目。目标是实现类微信小程序的运行环境，其中 UI 层采用多 `WebContentsView`：一个小程序页面对应一个独立的 `WebContentsView.webContents`；逻辑层运行在独立 Worker 中。

项目既可以作为 Electron 应用启动，也可以作为库使用：通过实例化 `MiniProgramContainer` 创建一个小程序容器。

## 技术栈

- Electron 42
- TypeScript
- Vite
- Worker Threads
- `WebContentsView`
- `htmlparser2`
- `postcss`
- `acorn`
- `lucide`

## 常用命令

```bash
npm run typecheck
npm run build
npm run start
npm run dev
```

说明：

- `npm run typecheck`：执行 TypeScript 类型检查。
- `npm run build`：清理并构建主进程、preload、worker 和 renderer。
- `npm run start` / `npm run dev`：先构建，再启动 Electron。

## 目录结构

```text
src/
  main/
    container.ts          # 小程序容器库核心，管理窗口、页面栈、WebContentsView、IPC、Worker
    index.ts              # Electron 应用入口，用于本项目 demo 启动
    mini-app-loader.ts    # 读取 app.json/app.js/page 文件，校验并转换资源
    route.ts              # 小程序路由解析与标题解析
  preload/
    index.ts              # 隔离桥，只暴露受控 miniHost API
  renderer/
    host.*                # 宿主导航栏/窗口控制栏 UI
    page.*                # 小程序页面视图运行时
  shared/
    types.ts              # 主进程、preload、renderer、worker 共用类型
  worker/
    index.ts              # 小程序逻辑层，执行 App/Page/wx/setData/lifecycle

miniapps/
  demo1/
  demo2/
```

## 小程序文件约定

每个小程序目录必须包含：

```text
app.json
app.js
app.wxss              # 可选
pages/**/**.json
pages/**/**.wxml
pages/**/**.wxss      # 可选
pages/**/**.js
```

重要约定：

- 小程序脚本要求必须是 `.js`。
- 找不到 `.js` 时不要兼容 `.ts`，这是刻意约定。
- `app.json` 必须声明唯一 `appId`。
- `app.json.pages` 中的页面路径不带扩展名，例如 `pages/index/index`。
- 当前示例小程序位于 `miniapps/demo1` 和 `miniapps/demo2`。

示例：

```json
{
  "appId": "com.electron-mini-program.demo1",
  "pages": ["pages/index/index"],
  "window": {
    "navigationBarTitleText": "demo1",
    "navigationBarBackgroundColor": "#f6f3ea",
    "backgroundColor": "#fffaf0"
  }
}
```

## 容器单例规则

每个小程序通过 `app.json` 中的 `appId` 标识身份。

规则：

- 同一个 `appId` 在当前主进程中只能运行一个 `MiniProgramContainer` 实例。
- `src/main/container.ts` 中使用 `activeContainers` 作为进程内单例表。
- 如果重复打开同一个 `appId`，会唤起已有窗口并关闭新建窗口。
- IPC namespace 根据 `appId` 稳定生成，不使用随机 UUID。
- namespace 格式为：`mini-program:${encodeURIComponent(appId)}`。

## 运行时架构

主进程负责：

- 创建并管理 `BrowserWindow`。
- 创建宿主 `WebContentsView`。
- 为每个小程序页面创建一个独立 `WebContentsView`。
- 管理页面栈和页面保活。
- 作为消息总线转发 `Worker <-> Main <-> Page WebContents`。
- 处理白名单宿主 API，例如路由、弹窗、存储、网络请求和系统信息。

Worker 负责：

- 执行 `App()`。
- 执行 `Page()`。
- 管理生命周期。
- 执行页面事件处理函数。
- 执行 `setData()` 并向页面发送数据 patch。
- 实现受控 `wx` API。

页面 WebContents 负责：

- 渲染 WXML/WXSS。
- 接收数据 patch。
- 上报 DOM 事件。
- 不执行业务 JS。

preload 负责：

- 从启动参数读取 `--page-id` 和 `--mini-ipc`。
- 暴露受控 `window.miniHost`。
- 禁止页面直接访问 Node 能力。

## 页面栈策略

页面栈采用保活策略：

- `navigateTo`：创建新的页面 `WebContentsView` 并压栈。
- `navigateBack`：销毁栈顶页面，恢复前一页。
- `redirectTo`：替换当前页面。
- `reLaunch`：清空页面栈后重新打开目标页面。
- 非当前页面隐藏但保留 DOM、滚动位置和输入状态。

## 自定义窗口控制栏

窗口使用无边框模式：

- `BrowserWindow.frame = false`
- 宿主 UI 位于 `src/renderer/host.*`
- 当前导航栏为沉浸式风格。
- 仅保留标题、最小化、最大化/还原、关闭按钮。
- 窗口控制按钮使用图标库，不使用系统自带标题栏。

## 构建输出约定

库内部固定解析构建目录，不需要外部传入 renderer/electron 根目录。

固定输出结构：

```text
dist/electron/main/index.js
dist/electron/main/container.js
dist/electron/preload/index.js
dist/electron/worker/index.js
dist/renderer/host.html
dist/renderer/page.html
```

## 开发注意事项

- 修改代码后优先运行 `npm run typecheck`。
- 涉及打包路径、renderer、preload 或 worker 时运行 `npm run build`。
- 不要把小程序 `.js` 脚本改成 `.ts`，也不要添加 `.ts` fallback。
- 新增小程序示例时必须提供唯一 `appId`。
- 新增 IPC 时优先在 `src/shared/types.ts` 中定义 discriminated union 类型。
- 页面 WebContents 不应暴露 Node、`require`、`process` 或 remote。
- 主进程新增文件访问、网络、存储能力时应走白名单 API。
- 中文注释保持简洁，解释“为什么”或关键边界，不写重复代码含义的注释。

## 当前验证状态

最近一次验证：

```bash
npm run typecheck
npm run build
```

均已通过。
