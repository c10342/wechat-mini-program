Component({
  properties: {
    count: {
      type: Number,
      value: 0,
    },
    label: {
      type: String,
      value: 'current count',
    },
  },

  data: {
    internalLabel: '',
  },

  observers: {
    label: function (val) {
      this.setData({
        internalLabel: val || 'current count',
      });
    },
  },

  lifetimes: {
    attached: function () {
      this.setData({
        internalLabel: this.properties.label || 'current count',
      });
      console.log('[Counter Component] attached, count =', this.properties.count);
    },
  },

  methods: {
    onIncrement: function () {
      this.triggerEvent('increment', { count: this.properties.count + 1 });
    },
    onDecrement: function () {
      this.triggerEvent('decrement', { count: this.properties.count - 1 });
    },
    onReset: function () {
      this.triggerEvent('reset');
    },
  },
});
