const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  init: () => ipcRenderer.invoke('app:init'),
  saveConfig: (payload) => ipcRenderer.invoke('config:save', payload),
  logoutConfig: (payload) => ipcRenderer.invoke('config:logout', payload),
  setupVault: (password) => ipcRenderer.invoke('vault:setup', password),
  unlockVault: (password) => ipcRenderer.invoke('vault:unlock', password),
  rotateVaultPassword: (payload) => ipcRenderer.invoke('vault:rotate', payload),
  openRepo: () => ipcRenderer.invoke('config:openRepo'),
  selectStorageDir: () => ipcRenderer.invoke('storage:select'),
  saveStorageDir: (dir) => ipcRenderer.invoke('storage:save', dir),
  resetStorageDir: () => ipcRenderer.invoke('storage:reset'),
  setStorageMode: (payload) => ipcRenderer.invoke('storage:mode:set', payload),
  readLogs: () => ipcRenderer.invoke('logs:read'),
  pullSync: () => ipcRenderer.invoke('sync:pull'),
  forceSync: () => ipcRenderer.invoke('sync:force'),
  createItem: (text) => ipcRenderer.invoke('items:create', text),
  updateItem: (payload) => ipcRenderer.invoke('items:update', payload),
  deleteItem: (id) => ipcRenderer.invoke('items:delete', id),
  copyItem: (id) => ipcRenderer.invoke('items:copy', id),
  onWindowShown: (handler) => ipcRenderer.on('window:shown', handler)
});
