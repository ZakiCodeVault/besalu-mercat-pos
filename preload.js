const { contextBridge, ipcRenderer } = require('electron');

// API minima y segura para el renderer (contextIsolation activado).
contextBridge.exposeInMainWorld('BESALU', {
  platform: 'windows',
  getVersion: () => ipcRenderer.invoke('app:getVersion'),

  // Base de datos local (SQLite en el proceso principal).
  db: {
    load: () => ipcRenderer.invoke('db:load'),
    save: (data) => ipcRenderer.invoke('db:save', data)
  },

  // Actualizaciones automaticas.
  updates: {
    onStatus: (cb) => {
      const handler = (_e, data) => { try { cb(data); } catch (e) {} };
      ipcRenderer.on('update-status', handler);
      return () => ipcRenderer.removeListener('update-status', handler);
    },
    check: () => ipcRenderer.invoke('updates:check'),
    install: () => ipcRenderer.send('updates:install')
  }
});
