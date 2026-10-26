'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Única superfície exposta ao HTML (contextIsolation + sandbox ligados).
contextBridge.exposeInMainWorld('mvclip', {
  // histórico
  list: () => ipcRenderer.invoke('history:list'),
  paste: (id) => ipcRenderer.invoke('history:paste', id),
  pin: (id) => ipcRenderer.invoke('history:pin', id),
  remove: (id) => ipcRenderer.invoke('history:remove', id),
  clear: () => ipcRenderer.invoke('history:clear'),         // mantém os fixados
  clearAll: () => ipcRenderer.invoke('history:clear-all'),  // apaga tudo, inclusive fixados
  hide: () => ipcRenderer.send('ui:hide'),
  onChanged: (cb) => ipcRenderer.on('history:changed', (_e, items) => cb(items)),
  onShown: (cb) => ipcRenderer.on('ui:shown', () => cb()),
  // configurações
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  onSettingsChanged: (cb) => ipcRenderer.on('settings:changed', (_e, settings) => cb(settings)),
  quit: () => ipcRenderer.send('app:quit'),
});
