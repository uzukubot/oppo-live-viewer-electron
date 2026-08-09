'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  startScan: (folder) => ipcRenderer.invoke('start-scan', folder),
  openPath: (p) => ipcRenderer.invoke('open-path', p),
  loadPhoto: (id) => ipcRenderer.invoke('load-photo', id),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  onScanBatch: (cb) => {
    const l = (_e, payload) => cb(payload);
    ipcRenderer.on('scan-batch', l);
    return () => ipcRenderer.removeListener('scan-batch', l);
  },
  onScanDone: (cb) => {
    const l = (_e, payload) => cb(payload);
    ipcRenderer.on('scan-done', l);
    return () => ipcRenderer.removeListener('scan-done', l);
  },
  getPathForFile: (file) => webUtils.getPathForFile(file),
});

contextBridge.exposeInMainWorld('env', {
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
});
