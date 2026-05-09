const { contextBridge, ipcRenderer } = require('electron');

const renderQueue = [];
let renderCallback = null;

function flushRenderQueue() {
  if (renderCallback && renderQueue.length > 0) {
    const queue = renderQueue.slice();
    renderQueue.length = 0;
    queue.forEach((data) => renderCallback(data));
  }
}

ipcRenderer.on('render', (event, data) => {
  renderQueue.push(data);
  flushRenderQueue();
});

contextBridge.exposeInMainWorld('pageBridge', {
  onRender: (callback) => {
    renderCallback = callback;
    flushRenderQueue();
  },
  sendEvent: (eventName, eventPayload) => {
    ipcRenderer.send('page-view-event', { eventName, eventPayload });
  },
});
