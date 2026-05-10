Component({
  properties: {
    title: {
      type: String,
      value: '',
    },
    subtitle: {
      type: String,
      value: '',
    },
  },

  data: {},

  lifetimes: {
    attached: function () {
      console.log('[PageHeader Component] attached, title =', this.properties.title);
    },
  },

  methods: {},
});
