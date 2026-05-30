# 逻辑层支持清单

本文档记录当前小程序容器在逻辑层已经支持的 `App`、`Page` 生命周期、属性和实例方法。内容以 `src/worker/index.ts` 的实际实现为准。

## 运行模型

小程序逻辑运行在独立 Worker 中，业务脚本不会在页面 WebContents 中执行。

执行流程：

1. Worker 收到主进程发送的 bundle。
2. 执行 `app.js`，通过 `App()` 注册应用定义。
3. 依次执行所有页面 `.js`，通过 `Page()` 注册页面定义。
4. 调用 `App.onLaunch()`。
5. 调用 `App.onShow()`。
6. 页面创建时调用对应页面的 `onLoad(query)`。
7. 页面 WebContents ready 后调用页面 `onShow()` 和首次 `onReady()`。
8. 页面隐藏、返回或销毁时触发对应页面生命周期。

## 脚本执行环境

当前 VM 上下文中暴露：

| 全局对象 | 支持情况 | 说明 |
| --- | --- | --- |
| `App` | 支持 | 注册应用定义。 |
| `Page` | 支持 | 注册页面定义。 |
| `wx` | 支持部分 API | 路由、UI、存储、网络、系统信息等宿主 API。 |
| `console` | 支持 | 输出日志。 |
| `setTimeout` | 支持 | 定时器。 |
| `clearTimeout` | 支持 | 清理定时器。 |
| `require` | 支持受控子集 | 仅支持小程序根目录内的相对 `.js` 模块。 |

当前不暴露：

- DOM
- `window`
- `document`
- `process`
- Node 文件系统能力

## App 支持

### App 生命周期

| 生命周期 | 支持情况 | 触发时机 | 参数 |
| --- | --- | --- | --- |
| `onLaunch` | 支持 | Worker 初始化并执行完所有脚本后触发一次。 | 无 |
| `onShow` | 支持 | `onLaunch` 后立即触发一次。 | 无 |

说明：

- 当前没有实现应用级 `onHide`。
- 当前没有实现 `onError`、`onPageNotFound`、`onUnhandledRejection` 等应用生命周期。
- `onLaunch` 和 `onShow` 的 `this` 指向传入 `App()` 的定义对象。

### App 定义对象

`App()` 接收一个普通对象。

```js
App({
  globalData: {
    version: "1.0.0"
  },

  onLaunch() {
    console.log("App.onLaunch");
  },

  onShow() {
    console.log("App.onShow");
  }
});
```

当前行为：

| 属性/方法 | 支持情况 | 说明 |
| --- | --- | --- |
| 自定义属性 | 支持保存 | 会保留在 App 定义对象上。 |
| `globalData` | 支持保存 | 只是普通自定义属性；当前没有实现 `getApp()`。 |
| 自定义方法 | 支持保存 | 可作为 App 对象上的普通方法保存。 |

限制：

- 当前没有实现 `getApp()`，页面脚本不能通过官方方式读取 App 实例。
- App 定义对象不会自动注入到 Page 实例。

## Page 支持

### Page 生命周期

| 生命周期 | 支持情况 | 触发时机 | 参数 |
| --- | --- | --- | --- |
| `onLoad` | 支持 | 页面实例创建后立即触发。 | `query` |
| `onShow` | 支持 | 页面显示时触发；页面保活后再次回到前台也会触发。 | 无 |
| `onReady` | 支持 | 页面第一次显示时触发一次。 | 无 |
| `onHide` | 支持 | 页面被新页面覆盖、替换或重启清栈时触发。 | 无 |
| `onUnload` | 支持 | 页面被销毁时触发。 | 无 |

说明：

- `onReady` 对每个页面实例只执行一次。
- `navigateTo` 创建新页面时，旧页面会触发 `onHide` 并保活。
- `navigateBack` 销毁栈顶页面时，栈顶页面触发 `onUnload`，恢复后的页面触发 `onShow`。
- `redirectTo` 会销毁当前页并创建目标页。
- `reLaunch` 会清空页面栈，被清理页面会触发 `onUnload`。

### Page 定义对象

`Page()` 接收一个普通对象。

```js
Page({
  data: {
    count: 0,
    user: {
      name: "Mini"
    }
  },

  onLoad(query) {
    console.log(query);
  },

  add() {
    this.setData({
      count: this.data.count + 1
    });
  }
});
```

当前支持的 Page 字段：

| 字段 | 支持情况 | 说明 |
| --- | --- | --- |
| `data` | 支持 | 页面初始数据，会被深拷贝到页面实例上。 |
| 生命周期函数 | 支持 | 见上方生命周期表。 |
| 自定义方法 | 支持 | 可作为事件处理函数或普通实例方法。 |
| 自定义属性 | 支持 | 会浅拷贝到页面实例上。 |

### Page 实例属性

页面生命周期和自定义方法中的 `this` 指向页面实例。

当前可用实例属性：

| 属性 | 支持情况 | 说明 |
| --- | --- | --- |
| `this.data` | 支持 | 当前页面完整数据。 |
| `this.setData` | 支持 | 更新页面数据并通知视图层。 |

内部字段：

| 字段 | 说明 |
| --- | --- |
| `__pageId` | 页面实例唯一 ID，内部使用。 |
| `__route` | 页面路由，内部使用。 |
| `__ready` | 标记 `onReady` 是否已执行，内部使用。 |

不建议业务代码依赖内部字段。

## setData 支持

### 基本写法

```js
this.setData({
  count: 1,
  title: "Hello"
});
```

### 路径写法

当前支持小程序常见路径写法：

```js
this.setData({
  "user.name": "Ada",
  "items[0].done": true
});
```

路径规则：

- `a.b` 会写入嵌套对象。
- `items[0].done` 会被转换为 `items.0.done` 形式写入。
- 中间对象不存在时会自动创建普通对象。

### 回调

支持 `setData(patch, callback)`：

```js
this.setData({ count: 2 }, function () {
  console.log("setData done");
});
```

说明：

- 当前 callback 在 Worker 内发送视图更新消息后立即执行。
- 当前视图层每次收到数据后会整体重渲染，不做节点级 diff。

## 页面事件处理函数

WXML 事件会调用 Page 实例上的同名方法。

```xml
<view data-id="{{item.id}}" bindtap="openTask">
  <text>{{item.title}}</text>
</view>
```

```js
Page({
  openTask(event) {
    const id = event.currentTarget.dataset.id;
    wx.navigateTo({ url: "/pages/detail/detail?id=" + id });
  }
});
```

当前事件对象：

| 字段 | 说明 |
| --- | --- |
| `event.type` | 事件类型，例如 `tap`、`input`、`change`。 |
| `event.currentTarget.dataset` | 当前元素上的 `data-*` 数据。 |
| `event.target.dataset` | 当前实现中与 `currentTarget.dataset` 相同。 |
| `event.detail` | 事件附加数据；`bindinput` 包含 `{ value }`。 |

## query 参数

页面通过路由创建时会解析 URL query，并传给 `onLoad(query)`。

```js
wx.navigateTo({
  url: "/pages/detail/detail?id=42&name=demo"
});
```

```js
Page({
  onLoad(query) {
    console.log(query.id);
    console.log(query.name);
  }
});
```

当前 query 值均为字符串。

## 当前支持的 wx API

逻辑层当前暴露以下 `wx` API：

| API | 支持情况 | 说明 |
| --- | --- | --- |
| `wx.navigateTo` | 支持 | 创建新页面并压栈。 |
| `wx.redirectTo` | 支持 | 替换当前页面。 |
| `wx.navigateBack` | 支持 | 返回上一页，可传 `delta`。 |
| `wx.switchTab` | 支持为路由动作 | 当前主进程按重新启动目标页处理。 |
| `wx.reLaunch` | 支持 | 清空页面栈并打开目标页。 |
| `wx.showToast` | 支持 | 通过宿主 UI 显示 toast。 |
| `wx.hideToast` | 支持 | 隐藏 toast。 |
| `wx.showLoading` | 支持 | 显示 loading。 |
| `wx.hideLoading` | 支持 | 隐藏 loading。 |
| `wx.showModal` | 支持 | 使用 Electron dialog 实现。 |
| `wx.setStorage` | 支持 | 主进程内存存储。 |
| `wx.getStorage` | 支持 | 读取主进程内存存储。 |
| `wx.removeStorage` | 支持 | 删除主进程内存存储。 |
| `wx.clearStorage` | 支持 | 清空主进程内存存储。 |
| `wx.request` | 支持 | 由主进程发起网络请求。 |
| `wx.getSystemInfo` | 支持 | 获取宿主系统信息。 |
| `wx.setStorageSync` | 部分支持 | 内部仍走异步宿主 API，不返回结果。 |
| `wx.getStorageSync` | 占位 | 固定返回 `undefined`。 |
| `wx.getSystemInfoSync` | 占位 | 固定返回 `{ platform: "electron" }`。 |

异步 API 回调：

| 回调 | 支持情况 | 说明 |
| --- | --- | --- |
| `success` | 支持 | API 成功时调用。 |
| `fail` | 支持 | API 失败时调用，参数包含 `errMsg`。 |
| `complete` | 支持 | 成功或失败都会调用。 |

## 当前未实现能力

以下能力当前不要按已支持使用：

- `getApp()`
- `getCurrentPages()`
- App `onHide`
- App `onError`
- App `onPageNotFound`
- Page `onPullDownRefresh`
- Page `onReachBottom`
- Page `onShareAppMessage`
- Page `onPageScroll`
- Component 构造器
- Behavior
- observers
- computed/watch
- 官方同步 storage API 的真实同步返回
- 小程序插件、分包、WXS、云开发
