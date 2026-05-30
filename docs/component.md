# WXML 组件支持清单

本文档记录当前小程序容器已经实现的 WXML 标签、事件、属性和指令。内容以 `src/renderer/page.ts` 的实际渲染逻辑为准。

## 渲染模型

当前页面 WebContents 只负责视图渲染与事件派发，不执行业务 JS。

渲染流程：

1. 主进程读取页面 `.wxml`、`.wxss`、`.json` 和 `.js`。
2. Worker 执行页面逻辑并生成页面 data。
3. 页面 WebContents 接收 data 后渲染 WXML。
4. 用户事件从页面 WebContents 上报给 Worker。
5. Worker 调用页面方法，`setData()` 后再把新 data 发回页面。

## 支持的标签

| WXML 标签 | 实际 DOM | 说明 |
| --- | --- | --- |
| `view` | `div` | 块级容器，默认添加 `mini-view` 类名。 |
| `text` | `span` | 文本容器，默认添加 `mini-text` 类名。 |
| `button` | `button` | 按钮，默认添加 `mini-button` 类名。 |
| `image` | `img` | 图片，默认添加 `mini-image` 类名。 |
| `input` | `input` | 输入框，默认添加 `mini-input` 类名。 |

说明：

- 未在上表中的标签目前会被降级渲染为 `div`。
- 降级标签仍会添加 `mini-${tagName}` 类名，例如 `scroll-view` 会得到 `mini-scroll-view`。
- 当前没有实现 `navigator` 的自动跳转行为。
- 当前没有实现 `swiper` 的轮播行为。
- `scroll-view` 没有独立组件逻辑，只能通过 `scroll-y` 获得纵向滚动样式。

## 支持的事件

| WXML 事件属性 | 上报事件类型 | DOM 事件 | 冒泡行为 | 说明 |
| --- | --- | --- | --- | --- |
| `bindtap` | `tap` | `click` | 冒泡 | 点击事件。 |
| `catchtap` | `tap` | `click` | 阻止冒泡 | 点击事件，调用 `stopPropagation()`。 |
| `bindinput` | `input` | `input` | 冒泡 | 输入事件，`detail.value` 为当前输入值。 |
| `bindchange` | `change` | `change` | 冒泡 | change 事件；当前没有补充 `detail.value`。 |

事件对象传给 Worker 后，页面方法中可读取：

```js
Page({
  onTap(event) {
    console.log(event.type);
    console.log(event.currentTarget.dataset);
    console.log(event.target.dataset);
    console.log(event.detail);
  }
});
```

当前事件对象字段：

| 字段 | 说明 |
| --- | --- |
| `type` | 小程序事件类型，例如 `tap`、`input`、`change`。 |
| `currentTarget.dataset` | 当前触发元素上的 `data-*` 集合。 |
| `target.dataset` | 与 `currentTarget.dataset` 相同。 |
| `detail` | 事件附加数据；`bindinput` 会包含 `{ value }`。 |

## 支持的属性

### 通用属性

| 属性 | 支持情况 | 说明 |
| --- | --- | --- |
| `class` | 支持 | 会追加到元素类名中，可配合 WXSS 使用。 |
| `style` | 支持 | 直接设置为 DOM `style` 属性。 |
| `data-*` | 支持 | 会保留到 DOM 属性中，并进入事件 `dataset`。 |
| `scroll-y` | 支持 | 为元素添加 `is-scroll-y` 类名，使其具备 `overflow-y: auto`。 |

### `image` 属性

| 属性 | 支持情况 | 说明 |
| --- | --- | --- |
| `src` | 支持 | 设置为 `HTMLImageElement.src`。 |

### `input` 属性

| 属性 | 支持情况 | 说明 |
| --- | --- | --- |
| `value` | 支持 | 设置为输入框当前值。 |

说明：

- `input` 用户输入时会同步更新 DOM 上的 `value` 属性，便于页面保活时保持临时输入状态。
- 当前没有专门处理 `placeholder`、`disabled`、`type`、`maxlength` 等原生 input 属性。
- 当前没有专门处理 `id`、`hidden`、`name`、`aria-*` 等通用属性。

## 支持的数据绑定

### 文本插值

文本节点支持 `{{}}`：

```xml
<text>{{title}}</text>
<text>数量：{{count}}</text>
```

### 属性插值

已支持属性可以使用 `{{}}`：

```xml
<view class="task {{done ? 'is-done' : ''}}" data-id="{{id}}">
  <text>{{title}}</text>
</view>
```

### 表达式求值

`{{}}` 内部支持 JavaScript 表达式，作用域包含页面 data，以及 `wx:for` 注入的局部变量。

示例：

```xml
<text>{{count + 1}}</text>
<text>{{item.done ? '完成' : '进行中'}}</text>
```

## 支持的条件渲染

| 指令 | 支持情况 | 说明 |
| --- | --- | --- |
| `wx:if` | 支持 | 表达式为真时渲染。 |
| `wx:elif` | 支持 | 必须跟在同一组 `wx:if` 后。 |
| `wx:else` | 支持 | 当前面条件都不命中时渲染。 |

示例：

```xml
<view wx:if="{{status === 'done'}}">已完成</view>
<view wx:elif="{{status === 'pending'}}">等待中</view>
<view wx:else>进行中</view>
```

## 支持的列表渲染

| 指令 | 支持情况 | 说明 |
| --- | --- | --- |
| `wx:for` | 支持 | 表达式结果必须是数组。 |
| `wx:for-item` | 支持 | 自定义当前项变量名，默认 `item`。 |
| `wx:for-index` | 支持 | 自定义索引变量名，默认 `index`。 |
| `wx:key` | 解析但未使用 | 当前渲染器每次整体重渲染，不使用 key 做 diff。 |

示例：

```xml
<view wx:for="{{tasks}}" wx:for-item="task" wx:for-index="idx" data-id="{{task.id}}" bindtap="openTask">
  <text>{{idx + 1}}. {{task.title}}</text>
</view>
```

## WXSS 支持

当前 WXSS 直接注入页面 WebContents 中。

已支持能力：

- 页面 `.wxss`
- 全局 `app.wxss`
- 普通 CSS 选择器和属性
- `rpx` 转换为 `calc(number * var(--rpx))`

说明：

- `--rpx` 根据当前页面 WebContents 宽度计算，基准为 `750rpx`。
- 页面 resize 时会重新计算 `--rpx` 并重新渲染。

## 当前未实现能力

以下能力当前不要按已支持使用：

- 自定义组件
- slot
- WXS
- template/import/include
- `navigator` 自动路由
- `swiper` 轮播行为
- `scroll-view` 的完整滚动事件和横向滚动能力
- 事件捕获阶段
- `capture-bind:*`
- `mut-bind:*`
- `bind:tap` 这种冒号事件语法
- 表单组件完整能力
- 双向绑定
- 节点局部 diff
