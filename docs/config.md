# 配置支持清单

本文档记录当前小程序容器支持的 `app.json` 和页面级 `.json` 配置。内容以 `src/shared/types.ts`、`src/main/mini-app-loader.ts`、`src/main/container.ts` 和 `src/renderer/host.ts` 的实际实现为准。

## 配置文件位置

每个小程序根目录必须包含：

```text
app.json
```

每个页面可以包含页面级配置文件：

```text
pages/index/index.json
pages/detail/detail.json
```

说明：

- `app.json` 必须存在。
- 页面级 `.json` 可以不存在；不存在时按空配置 `{}` 处理。
- 当前小程序脚本必须是 `.js`，配置文件仍然是 `.json`。

## app.json 示例

```json
{
  "appId": "com.electron-mini-program.demo1",
  "pages": ["pages/index/index", "pages/detail/detail", "pages/logs/logs"],
  "window": {
    "navigationBarTitleText": "demo1",
    "navigationBarBackgroundColor": "#f6f3ea",
    "navigationBarTextStyle": "black",
    "backgroundColor": "#fffaf0"
  },
  "networkTimeout": {
    "request": 10000
  }
}
```

## app.json 顶层配置

| 字段 | 类型 | 必填 | 当前状态 | 说明 |
| --- | --- | --- | --- | --- |
| `appId` | `string` | 是 | 已生效 | 小程序唯一 ID，用于容器单例判断和生成 IPC namespace。 |
| `pages` | `string[]` | 是 | 已生效 | 页面路径列表；首项作为默认启动页。 |
| `window` | `object` | 否 | 已生效 | 全局窗口和导航栏配置。 |
| `tabBar` | `object` | 否 | 已定义类型但未渲染 | 当前不会生成底部 tabBar UI。 |
| `networkTimeout` | `Record<string, number>` | 否 | 已读取但未使用 | 当前 `wx.request` 没有按该配置设置超时。 |

## appId

`appId` 用来标识一个小程序。

```json
{
  "appId": "com.electron-mini-program.demo1"
}
```

当前行为：

- 同一个 `appId` 在当前主进程内只能运行一个容器实例。
- 重复打开同一个 `appId` 时，会唤起已有窗口并关闭新窗口。
- IPC namespace 根据 `appId` 生成，格式为 `mini-program:${encodeURIComponent(appId)}`。
- `appId` 缺失时，容器会关闭新建窗口并抛出错误。

建议：

- 使用类似反向域名的稳定 ID，例如 `com.company.product.demo`。
- 不要在同一个项目内复用 `appId`。

## pages

`pages` 声明小程序包含的页面路径。

```json
{
  "pages": ["pages/index/index", "pages/detail/detail"]
}
```

当前行为：

- `pages[0]` 是小程序默认启动页。
- 页面路径不带文件扩展名。
- 每个页面路径会对应读取：

```text
pages/index/index.js
pages/index/index.wxml
pages/index/index.wxss
pages/index/index.json
```

文件要求：

- 页面 `.js` 必须存在。
- 页面 `.wxml` 不存在时，会使用默认模板 `<view></view>`。
- 页面 `.wxss` 不存在时按空样式处理。
- 页面 `.json` 不存在时按空配置处理。

## window

`window` 是全局窗口和导航栏配置。

```json
{
  "window": {
    "navigationBarTitleText": "Mission Desk",
    "navigationBarBackgroundColor": "#f6f3ea",
    "navigationBarTextStyle": "black",
    "backgroundColor": "#fffaf0"
  }
}
```

### window 支持字段

| 字段 | 类型 | 默认值 | 当前状态 | 说明 |
| --- | --- | --- | --- | --- |
| `navigationBarTitleText` | `string` | `"Mini Program"` | 已生效 | 全局导航栏标题；页面未配置标题时作为 fallback。 |
| `navigationBarBackgroundColor` | `string` | `"#f6f3ea"` | 已生效 | 宿主导航栏背景色。 |
| `navigationBarTextStyle` | `"black" \| "white"` | `"black"` | 已生效 | 控制导航栏文字和窗口按钮颜色风格。 |
| `backgroundColor` | `string` | `"#fffaf0"` | 已生效 | 全局页面背景色和窗口背景色。 |

### navigationBarTitleText

当前标题优先级：

1. 页面级 `navigationBarTitleText`
2. 全局 `window.navigationBarTitleText`
3. 路由最后一段
4. `"Mini Program"`

标题会同步到：

- 自定义导航栏标题
- `BrowserWindow` 标题
- 页面 `document.title`

### navigationBarBackgroundColor

用于设置宿主导航栏背景色。

当前宿主导航栏是自定义无边框窗口控制栏，不使用系统标题栏。

### navigationBarTextStyle

当前支持：

```json
{
  "navigationBarTextStyle": "black"
}
```

```json
{
  "navigationBarTextStyle": "white"
}
```

说明：

- 只支持 `"black"` 和 `"white"`。
- 该配置会影响宿主导航栏文字和窗口控制按钮的颜色风格。

### backgroundColor

用于设置全局背景色。

当前影响范围：

- `BrowserWindow` 背景色
- 宿主导航栏相关 CSS 变量
- 页面默认背景色

页面级 `backgroundColor` 会覆盖全局页面背景色。

## tabBar

类型中已经声明 `tabBar`：

```json
{
  "tabBar": {
    "color": "#333333",
    "selectedColor": "#007aff",
    "backgroundColor": "#ffffff",
    "list": [
      {
        "pagePath": "pages/index/index",
        "text": "首页"
      }
    ]
  }
}
```

当前状态：

- 类型已存在。
- `app.json` 可以写入该字段。
- 运行时不会渲染 tabBar。
- `switchTab` 当前只是作为路由动作处理，主进程会按 `reLaunch` 方式打开目标页。

当前不要依赖：

- tabBar UI
- tabBar 选中态
- tabBar 页面缓存规则
- tabBar 图标配置

## networkTimeout

类型中已经声明 `networkTimeout`：

```json
{
  "networkTimeout": {
    "request": 10000
  }
}
```

当前状态：

- 配置会随 `app.json` 被读取。
- 当前 `wx.request` 没有使用该配置设置超时。
- 当前没有支持 `connectSocket`、`uploadFile`、`downloadFile` 等超时配置。

## 页面级 json 示例

```json
{
  "navigationBarTitleText": "Task Detail",
  "backgroundColor": "#fffaf0"
}
```

## 页面级配置

| 字段 | 类型 | 默认值 | 当前状态 | 说明 |
| --- | --- | --- | --- | --- |
| `navigationBarTitleText` | `string` | 见标题优先级 | 已生效 | 当前页面标题。 |
| `backgroundColor` | `string` | 全局 `window.backgroundColor` 或 `"#fffaf0"` | 已生效 | 当前页面背景色。 |

## 页面 navigationBarTitleText

页面级标题优先级高于全局标题。

```json
{
  "navigationBarTitleText": "API Panel"
}
```

当前行为：

- 页面创建路由记录时读取该配置。
- 页面显示时同步到宿主导航栏。
- 页面显示时同步到 `BrowserWindow` 标题。

## 页面 backgroundColor

页面级背景色优先级高于全局背景色。

```json
{
  "backgroundColor": "#ffffff"
}
```

当前行为：

- 页面 WebContents 初始化时应用到 `document.documentElement`、`body` 和 `#app`。
- 未配置时使用 `app.json.window.backgroundColor`。
- 全局也未配置时使用默认值 `#fffaf0`。

## 当前未支持的常见配置

以下配置当前不要按已支持使用：

- `usingComponents`
- `component`
- `disableScroll`
- `enablePullDownRefresh`
- `onReachBottomDistance`
- `pageOrientation`
- `backgroundTextStyle`
- `backgroundColorTop`
- `backgroundColorBottom`
- `navigationStyle`
- `navigationBarTextStyle` 的页面级覆盖
- `navigationBarBackgroundColor` 的页面级覆盖
- tabBar 图标配置
- 分包配置 `subPackages`
- 预加载配置 `preloadRule`
- workers 配置
- plugins 配置
- permission 配置
- sitemap 配置

## 配置读取限制

当前配置读取比较轻量：

- JSON 解析失败会直接抛出错误。
- `app.json.pages` 中声明的页面会被逐个读取。
- 页面路径不存在或页面 `.js` 缺失会抛出错误。
- 页面 `.json` 缺失不会报错。
- 当前没有对未知字段做校验，也不会阻止未知字段存在。
