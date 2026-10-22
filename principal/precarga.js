/**
 * precarga.js — Puente seguro entre la interfaz y el proceso principal.
 *
 * La interfaz NO tiene acceso a Node ni a archivos (contextIsolation activado).
 * Solo puede usar lo que se expone aquí en `window.BESALU`. Todos los montos
 * viajan en CÉNTIMOS enteros.
 */
const { contextBridge, ipcRenderer } = require('electron');

async function llamar(canal, ...args) {
  const r = await ipcRenderer.invoke(canal, ...args);
  if (!r || !r.ok) throw new Error((r && r.error) || 'Error inesperado');
  return r.valor;
}
const c = (canal) => (...args) => llamar(canal, ...args);

contextBridge.exposeInMainWorld('BESALU', {
  version: () => ipcRenderer.invoke('app:version'),
  imprimir: () => ipcRenderer.invoke('imprimir'),

  sistema: {
    estado: c('sistema:estado'),
    guardarAjustes: c('ajustes:guardar'),
    verificar: c('integridad:verificar'),
    repararStock: c('integridad:repararStock'),
    bitacora: c('bitacora:leer'),
    importarV1: c('migracion:importarV1')
  },
  productos: {
    listar: c('productos:listar'), crear: c('productos:crear'), actualizar: c('productos:actualizar'),
    eliminar: c('productos:eliminar'), reactivar: c('productos:reactivar'),
    ajustar: c('productos:ajustar'), kardex: c('productos:kardex')
  },
  ventas: {
    emitir: c('ventas:emitir'), listar: c('ventas:listar'), obtener: c('ventas:obtener'),
    notaCredito: c('ventas:notaCredito'), reemitir: c('ventas:reemitir'), buscarClientes: c('clientes:buscar')
  },
  compras: {
    registrar: c('compras:registrar'), listar: c('compras:listar'), obtener: c('compras:obtener'),
    anular: c('compras:anular'), proveedores: c('proveedores:listar'),
    datosMensaje: c('compras:datosMensaje'), responder: c('compras:responder'),
    reintentarMensaje: c('compras:reintentarMensaje'), guardarXmlMensaje: c('compras:guardarXmlMensaje')
  },
  caja: {
    actual: c('caja:actual'), abrir: c('caja:abrir'), resumen: c('caja:resumen'),
    cerrar: c('caja:cerrar'), historial: c('caja:historial')
  },
  reportes: {
    iva: c('reportes:iva'), balance: c('reportes:balance'), ventas: c('reportes:ventas'),
    alertas: c('reportes:alertas'), inventario: c('reportes:inventario')
  },
  respaldos: {
    crear: c('respaldos:crear'), listar: c('respaldos:listar'), restaurar: c('respaldos:restaurar'),
    restaurarArchivo: c('respaldos:restaurarArchivo'), elegirCarpeta: c('respaldos:elegirCarpeta'),
    abrirCarpeta: c('respaldos:abrirCarpeta')
  },
  exportar: (tipo, a, b) => llamar('exportar:csv', tipo, a, b),
  hacienda: {
    estado: c('hacienda:estado'), elegirLlave: c('hacienda:elegirLlave'), guardar: c('hacienda:guardar'),
    probar: c('hacienda:probar'), procesar: c('hacienda:procesar'), reintentar: c('hacienda:reintentar'),
    guardarXml: c('hacienda:guardarXml'), empezarProduccion: c('hacienda:empezarProduccion'),
    alCambiar: (cb) => {
      const h = (_e, info) => { try { cb(info); } catch (e) {} };
      ipcRenderer.on('hacienda', h);
      return () => ipcRenderer.removeListener('hacienda', h);
    }
  },

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
