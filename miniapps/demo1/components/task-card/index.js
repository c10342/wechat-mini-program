Component({
  properties: {
    id: String,
    title: String,
    owner: String,
    status: String,
    points: Number,
    done: Boolean
  },
  data: {
    tapCount: 0
  },
  attached() {
    console.log("task-card.attached", this.properties.id);
  },
  ready() {
    console.log("task-card.ready", this.properties.id);
  },
  detached() {
    console.log("task-card.detached", this.properties.id);
  },
  methods: {
    handleTap() {
      this.setData({ tapCount: this.data.tapCount + 1 });
      this.triggerEvent("select", { id: this.properties.id });
    }
  }
});
