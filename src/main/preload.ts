import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { TranceApi } from '../shared/api';

const api: TranceApi = {
  platform: process.platform,
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  openFiles: (kind, multiple = true) => ipcRenderer.invoke('dialog:openFiles', kind, multiple),
  saveSessionDialog: (name) => ipcRenderer.invoke('dialog:saveSession', name),
  saveVideoDialog: (name) => ipcRenderer.invoke('dialog:saveVideo', name),
  scanFolder: (root, classic) => ipcRenderer.invoke('media:scanFolder', root, classic),
  readTextFile: (path, classic) => ipcRenderer.invoke('media:readText', path, classic),
  loadSession: (path) => ipcRenderer.invoke('session:load', path),
  saveSession: (path, session) => ipcRenderer.invoke('session:save', path, session),
  prepareAnimations: (paths) => ipcRenderer.invoke('media:prepareAnimations', paths),
  listDir: (dir) => ipcRenderer.invoke('media:listDir', dir),
  listDirRecursive: (dir) => ipcRenderer.invoke('media:listDirRecursive', dir),
  exportBegin: (job) => ipcRenderer.invoke('export:begin', job),
  hardwareEncoder: () => ipcRenderer.invoke('export:hardwareEncoder'),
  exportFrame: (data) => ipcRenderer.invoke('export:frame', data),
  exportFinish: () => ipcRenderer.invoke('export:finish'),
  exportCancel: () => ipcRenderer.invoke('export:cancel'),
  showItem: (path) => ipcRenderer.send('shell:showItem', path),
  log: (message) => ipcRenderer.send('log:write', message),
  logPath: () => ipcRenderer.invoke('log:path'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  initialFile: () => ipcRenderer.invoke('app:initialFile'),
  renderRequest: () => ipcRenderer.invoke('render:request'),
  renderProgress: (line) => ipcRenderer.send('render:progress', line),
  renderDone: (error) => ipcRenderer.send('render:done', error),
};

contextBridge.exposeInMainWorld('trance', api);
