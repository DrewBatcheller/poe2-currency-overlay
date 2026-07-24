const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('loginShell', {
  nav: (dir) => ipcRenderer.send('login-nav', dir),
  onState: (cb) => ipcRenderer.on('login-state', (_e, s) => cb(s)),
});
