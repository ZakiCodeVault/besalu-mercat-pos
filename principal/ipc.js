/**
 * ipc.js — Todo lo que la interfaz puede pedirle al sistema.
 *
 * Cada canal devuelve { ok: true, valor } o { ok: false, error }.
 * Los errores de la base de datos se traducen a mensajes claros.
 */
const { ipcMain, dialog, app, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const log = require('electron-log');
const datos = require('./datos');
const exportar = require('./exportar');
const hacienda = require('./hacienda/conector');
const seguridad = require('./seguridad');
const correo = require('./hacienda/correo');

function amigable(e) {
  const m = String((e && e.message) || e);
  if (m.includes('UNIQUE constraint failed: productos.codigo')) return 'Ya existe un producto con ese código';
  if (m.includes('UNIQUE constraint failed: proveedores')) return 'Ya existe un proveedor con esa identificación';
  if (m.includes('UNIQUE constraint failed: compras')) return 'Esta factura de compra ya fue registrada';
  if (m.includes('FOREIGN KEY constraint failed')) return 'No se puede: hay registros que dependen de este';
  if (m.startsWith('CHECK constraint failed')) return 'Dato inválido: ' + m.replace('CHECK constraint failed: ', '');
  if (m.includes('UNIQUE constraint failed: comprobantes.sustituye_id')) return 'Este comprobante ya fue reemplazado';
  if (m.includes('UNIQUE constraint failed: mensajes_receptor.compra_id')) return 'Esta factura ya tiene un mensaje en curso ante Hacienda';
  return m;
}

function manejar(canal, fn) {
  ipcMain.handle(canal, async (e, ...args) => {
    if (!seguridad.remitenteValido(e)) { log.warn('[ipc] pedido rechazado de ' + ((e.senderFrame && e.senderFrame.url) || 'origen desconocido')); return { ok: false, error: 'Origen no autorizado' }; }
    try { return { ok: true, valor: await fn(...args) }; }
    catch (e) { log.error('[' + canal + ']', e); return { ok: false, error: amigable(e) }; }
  });
}

/**
 * @param {object} ctx { ventana(), estadoInicio, carpetaDatos }
 */
function registrar(ctx) {
  const { conexion, productos, ventas, compras, caja, reportes, respaldos, migracionV1 } = datos;

  /* ---- sistema ---- */
  manejar('sistema:estado', () => ({
    version: require('../package.json').version,
    archivo: conexion.rutaArchivo(),
    carpetaRespaldos: respaldos.carpetaRespaldos(),
    ajustes: conexion.leerAjustes(),
    turno: caja.actual(),
    integridad: ctx.estadoInicio.integridad,
    ultimoRespaldo: conexion.leerConfig('ultimo_respaldo', null),
    hacienda: hacienda.estado(),
    versionAnterior: migracionV1.detectar(ctx.carpetaDatos)
  }));
  manejar('ajustes:guardar', (a) => conexion.guardarAjustes(a || {}));
  manejar('integridad:verificar', () => conexion.verificarIntegridad());
  manejar('integridad:repararStock', () => conexion.repararStock());
  manejar('bitacora:leer', (n) => conexion.leerBitacora(n || 200));
  manejar('migracion:importarV1', () => migracionV1.importar(ctx.carpetaDatos));

  /* ---- productos ---- */
  manejar('productos:listar', (o) => productos.listar(o || {}));
  manejar('productos:crear', (p) => productos.crear(p));
  manejar('productos:actualizar', (id, p) => productos.actualizar(id, p));
  manejar('productos:eliminar', (id) => productos.eliminar(id));
  manejar('productos:reactivar', (id) => productos.reactivar(id));
  manejar('productos:ajustar', (id, stock, motivo) => productos.ajustarStock(id, stock, motivo));
  manejar('productos:kardex', (id) => productos.kardex(id));

  /* ---- ventas ---- */
  // Después de emitir, el comprobante se envía a Hacienda en segundo plano (no frena la caja)
  const yEnviar = (c) => { hacienda.procesarPronto(); return c; };
  manejar('ventas:emitir', (v) => yEnviar(ventas.emitir(v)));
  manejar('ventas:listar', (f) => ventas.listar(f || {}));
  manejar('ventas:obtener', (id) => ventas.obtenerPorId(id));
  manejar('ventas:notaCredito', (id, razon) => yEnviar(ventas.notaCredito(id, razon)));
  manejar('ventas:reemitir', (id, cambios) => yEnviar(ventas.reemitir(id, cambios || {})));
  manejar('clientes:buscar', (t) => ventas.buscarClientes(t));

  /* ---- compras ---- */
  manejar('compras:registrar', (c) => compras.registrarCompra(c));
  manejar('compras:listar', (f) => compras.listar(f || {}));
  manejar('compras:obtener', (id) => compras.obtenerPorId(id));
  manejar('compras:anular', (id, razon) => compras.anular(id, razon));
  // Mensaje Receptor: aceptar o rechazar la factura ante Hacienda (se envía en segundo plano)
  manejar('compras:datosMensaje', (id) => hacienda.datosMensaje(id));
  manejar('compras:responder', (id, o) => hacienda.responderCompra(id, o || {}));
  manejar('compras:reintentarMensaje', (id) => hacienda.reintentarMensaje(id));
  manejar('compras:guardarXmlMensaje', async (id, cual) => {
    const m = compras.obtenerMensaje(id);
    if (!m) throw new Error('El mensaje no existe');
    const contenido = cual === 'respuesta' ? m.hacienda_respuesta : m.xml_firmado;
    if (!contenido) throw new Error(cual === 'respuesta' ? 'Todavía no hay respuesta de Hacienda' : 'El XML todavía no se ha generado');
    const nombre = m.clave + '-' + m.consecutivo + (cual === 'respuesta' ? '_respuesta' : '') + '.xml';
    const r = await dialog.showSaveDialog(ctx.ventana(), {
      title: 'Guardar XML', defaultPath: path.join(app.getPath('documents'), nombre), filters: [{ name: 'XML', extensions: ['xml'] }]
    });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, contenido, 'utf8');
    return { ruta: r.filePath };
  });
  manejar('proveedores:listar', () => compras.listarProveedores());

  /* ---- caja ---- */
  manejar('caja:actual', () => caja.actual());
  manejar('caja:abrir', (fondo) => caja.abrir(fondo));
  manejar('caja:resumen', (id) => { const t = id || (caja.actual() || {}).id; return t ? caja.resumen(t) : null; });
  manejar('caja:cerrar', (contado) => {
    const z = caja.cerrar(contado);
    respaldos.crear('cierre').catch((e) => log.error('[respaldo cierre]', e));   // respaldo automático
    return z;
  });
  manejar('caja:historial', () => caja.historial());

  /* ---- reportes ---- */
  manejar('reportes:iva', (d, h) => reportes.iva(d, h));
  manejar('reportes:balance', (d, h) => reportes.balance(d, h));
  manejar('reportes:ventas', (d, h) => ({
    resumen: reportes.resumenVentas(d, h), porDia: reportes.ventasPorDia(d, h), masVendidos: reportes.masVendidos(d, h)
  }));
  manejar('reportes:alertas', () => reportes.alertas());
  manejar('reportes:inventario', () => reportes.valorInventario());

  /* ---- respaldos ---- */
  manejar('respaldos:crear', () => respaldos.crear('manual'));
  manejar('respaldos:listar', () => respaldos.listar());
  manejar('respaldos:restaurar', async (nombre) => { const r = await respaldos.restaurar(nombre); hacienda.reiniciar(); return r; });
  manejar('respaldos:restaurarArchivo', async () => {
    const r = await dialog.showOpenDialog(ctx.ventana(), {
      title: 'Elegir respaldo para restaurar', properties: ['openFile'],
      filters: [{ name: 'Respaldo de Besalú (.sqlite)', extensions: ['sqlite'] }]
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const restaurado = await respaldos.restaurar(r.filePaths[0]);
    hacienda.reiniciar();
    return restaurado;
  });
  manejar('respaldos:elegirCarpeta', async () => {
    const r = await dialog.showOpenDialog(ctx.ventana(), { title: 'Carpeta extra para respaldos (USB, OneDrive...)', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    return conexion.guardarAjustes({ carpetaRespaldoExtra: r.filePaths[0] });
  });
  manejar('respaldos:abrirCarpeta', () => shell.openPath(respaldos.carpetaRespaldos()));

  /* ---- exportar a Excel (CSV) ---- */
  manejar('exportar:csv', async (tipo, a, b) => {
    const generadores = {
      ventas: () => exportar.ventas(a, b), compras: () => exportar.compras(a, b), iva: () => exportar.iva(a, b),
      inventario: () => exportar.inventario(), kardex: () => exportar.kardex(a)
    };
    if (!generadores[tipo]) throw new Error('Tipo de exportación desconocido');
    const sufijo = tipo === 'inventario' ? new Date().toISOString().slice(0, 10) : (tipo === 'kardex' ? 'producto-' + a : a + '_a_' + b);
    const r = await dialog.showSaveDialog(ctx.ventana(), {
      title: 'Guardar para Excel', defaultPath: path.join(app.getPath('documents'), 'besalu-' + tipo + '-' + sufijo + '.csv'),
      filters: [{ name: 'Excel (CSV)', extensions: ['csv'] }]
    });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, generadores[tipo](), 'utf8');
    datos.conexion.registrar('exportacion', { tipo, archivo: r.filePath });
    return { ruta: r.filePath };
  });

  /* ---- Hacienda ---- */
  manejar('hacienda:estado', () => hacienda.estado());
  manejar('hacienda:elegirLlave', async () => {
    const r = await dialog.showOpenDialog(ctx.ventana(), {
      title: 'Elegir la llave criptográfica de Hacienda', properties: ['openFile'],
      filters: [{ name: 'Llave criptográfica (.p12)', extensions: ['p12', 'pfx'] }]
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const archivo = r.filePaths[0];
    if (fs.statSync(archivo).size > 64 * 1024) throw new Error('Ese archivo no parece una llave criptográfica (.p12)');
    return hacienda.elegirLlave(fs.readFileSync(archivo), path.basename(archivo));
  });
  manejar('hacienda:guardar', (c) => hacienda.guardarConfiguracion(c || {}));
  manejar('hacienda:probar', () => hacienda.probarConexion());
  manejar('hacienda:procesar', async () => { await hacienda.procesar(); return hacienda.estado(); });
  manejar('hacienda:reintentar', (id) => hacienda.reintentar(id));
  manejar('hacienda:guardarXml', async (id, cual) => {
    const c = ventas.obtenerPorId(id);
    if (!c) throw new Error('El comprobante no existe');
    const contenido = cual === 'respuesta' ? c.hacienda_respuesta : c.xml_firmado;
    if (!contenido) throw new Error(cual === 'respuesta' ? 'Todavía no hay respuesta de Hacienda' : 'El XML todavía no se ha generado');
    const nombre = c.clave + (cual === 'respuesta' ? '_respuesta' : '') + '.xml';   // nombres que pide Hacienda
    const r = await dialog.showSaveDialog(ctx.ventana(), {
      title: 'Guardar XML', defaultPath: path.join(app.getPath('documents'), nombre), filters: [{ name: 'XML', extensions: ['xml'] }]
    });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, contenido, 'utf8');
    return { ruta: r.filePath };
  });
  manejar('hacienda:empezarProduccion', async () => {
    const r = await respaldos.empezarBaseNueva('pruebas-hacienda');
    hacienda.reiniciar();
    return r;
  });

  /* ---- Correo: factura aceptada → cliente ---- */
  manejar('correo:estado', () => correo.estado());
  manejar('correo:guardar', (c) => correo.guardarConfiguracion(c || {}));
  manejar('correo:probar', () => correo.probar());
  manejar('correo:reenviar', (id, destino) => correo.reenviar(id, destino));
}

module.exports = { registrar };
