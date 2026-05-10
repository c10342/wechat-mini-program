const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('containerBridge', {
  onInitContainer: (callback) => {
    ipcRenderer.on('init-container', (event, data) => callback(data));
  },
  onPageViewEvent: (callback) => {
    ipcRenderer.on('page-view-event', (event, msg) => callback(msg));
  },
  send: (channel, data) => {
    ipcRenderer.send(channel, data);
  },
  invoke: (channel, ...args) => {
    return ipcRenderer.invoke(channel, ...args);
  },
});