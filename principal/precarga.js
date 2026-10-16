/**
 * precarga.js — Puente seguro entre la interfaz y el proceso principal.
 *
 * La interfaz NO tiene acceso a Node (contextIsolation activado). Solo puede
 * usar lo que se expone aquí en `window.BESALU`.
 */
const { contextBridge, ipcRenderer } = require('electron');

// Llama al proceso principal y devuelve el valor o lanza el error.
async function llamar(canal, ...args) {
  const r = await ipcRenderer.invoke(canal, ...args);
  if (!r || !r.ok) throw new Error((r && r.error) || 'Error de base de datos');
  return r.valor;
}

contextBridge.exposeInMainWorld('BESALU', {
  version: () => ipcRenderer.invoke('app:version'),

  // Imprime el ticket que está en #zona-impresion (impresora predeterminada).
  imprimir: () => ipcRenderer.invoke('imprimir'),

  // Base de datos local (SQLite).
  datos: {
    cargar: () => llamar('datos:cargar'),
    guardarProducto: (p) => llamar('datos:guardarProducto', p),
    borrarProducto: (cod) => llamar('datos:borrarProducto', cod),
    registrarVenta: (venta, productos, consecutivo) => llamar('datos:registrarVenta', venta, productos, consecutivo),
    registrarAnulacion: (folio, productos) => llamar('datos:registrarAnulacion', folio, productos),
    guardarConfig: (clave, valor) => llamar('datos:guardarConfig', clave, valor),
    reiniciar: () => llamar('datos:reiniciar')
  },

  // Actualizaciones automáticas.
  actualizaciones: {
    alCambiar: (cb) => {
      const h = (_e, info) => { try { cb(info); } catch (e) {} };
      ipcRenderer.on('actualizacion', h);
      return () => ipcRenderer.removeListener('actualizacion', h);
    },
    buscar: () => ipcRenderer.invoke('actualizaciones:buscar'),
    instalar: () => ipcRenderer.send('actualizaciones:instalar')
  }
});
