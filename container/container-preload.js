const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('containerBridge', {
  invoke: (channel, ...args) => {
    const allowed = ['create-page-view', 'read-file', 'build-worker-bundle', 'show-open-dialog'];
    if (allowed.includes(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }
    return Promise.reject(new Error('IPC channel not allowed: ' + channel));
  },

  send: (channel, ...args) => {
    const allowed = [
      'set-page-view-bounds',
      'show-page-view',
      'hide-page-view',
      'destroy-page-view',
      'send-to-page-view',
    ];
    if (allowed.includes(channel)) {
      ipcRenderer.send(channel, ...args);
    }
  },

  onInitContainer: (callback) => {
    ipcRenderer.on('init-container', (event, data) => callback(data));
  },

  onPageViewEvent: (callback) => {
    ipcRenderer.on('page-view-event', (event, data) => callback(data));
  },
});
