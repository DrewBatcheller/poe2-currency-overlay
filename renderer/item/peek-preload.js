const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('peekApi', {
  onContent: (cb) => ipcRenderer.on('peek-content', (_e, payload) => cb(payload)),
  reportHeight: (h) => ipcRenderer.send('peek-height', h),
});
