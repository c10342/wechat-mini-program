const { contextBridge, ipcRenderer } = require('electron');

let currentViewId = null;

contextBridge.exposeInMainWorld('pageBridge', {
  onRender: (callback) => {
    ipcRenderer.on('render', (event, data) => {
      const webContents = event.sender;
      currentViewId = webContents.id;
      callback(data);
    });
  },
  sendEvent: (eventName, eventPayload) => {
    ipcRenderer.send('page-view-event', {
      viewId: currentViewId,
      eventName,
      eventPayload,
    });
  },
});