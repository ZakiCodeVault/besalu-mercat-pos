const { contextBridge, ipcRenderer } = require('electron');

// API minima y segura para el renderer (contextIsolation activado).
contextBridge.exposeInMainWorld('BESALU', {
  platform: 'windows',
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  updates: {
    // Suscribirse a los eventos del updater. Devuelve una funcion para desuscribir.
    onStatus: (cb) => {
      const handler = (_e, data) => { try { cb(data); } catch (e) {} };
      ipcRenderer.on('update-status', handler);
      return () => ipcRenderer.removeListener('update-status', handler);
    },
    // Buscar actualizaciones ahora.
    check: () => ipcRenderer.invoke('updates:check'),
    // Reiniciar e instalar la actualizacion ya descargada.
    install: () => ipcRenderer.send('updates:install')
  }
});
