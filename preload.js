const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('env', {
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node
});
