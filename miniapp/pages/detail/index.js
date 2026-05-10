

Page({
  data: {
    from: 'unknown',
    homeCount: 0,
    visitCount: 0,
    features: [
      { name: 'Data Binding', desc: '{{expr}} syntax' },
      { name: 'Conditional', desc: 'wx:if directive' },
      { name: 'List Rendering', desc: 'wx:for directive' },
      { name: 'Events', desc: 'bindtap / bind:event' },
    ],
    todos: [],
    todoCounter: 0,
  },

  onLoad: function (options) {
    console.log('[Detail Page] onLoad', options);
    this.setData({
      from: options.from || 'direct',
      homeCount: options.count || 0,
    });
  },

  onShow: function () {
    console.log('[Detail Page] onShow');
  },

  addVisit: function () {
    var count = this.data.visitCount + 1;
    this.setData({ visitCount: count });
    wx.showToast({
      title: 'Visit #' + count,
      duration: 800,
    });
  },

  addTodo: function () {
    var todos = this.data.todos.slice();
    this.data.todoCounter++;
    todos.push('Todo item #' + this.data.todoCounter);
    this.setData({ todos: todos });
  },

  deleteTodo: function (e) {
    var idx = e.target.dataset.idx;
    if (idx == null) return;
    var todos = this.data.todos.slice();
    todos.splice(Number(idx), 1);
    this.setData({ todos: todos });
  },

  goBack: function () {
    wx.navigateBack({ delta: 1 });
  },
});
