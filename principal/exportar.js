/**
 * exportar.js — Genera archivos CSV para Excel (español: separador ";" y coma decimal).
 *
 *   ventas      comprobantes emitidos del período, con IVA por tarifa
 *   compras     facturas de compra del período
 *   iva         resumen de IVA a pagar del período
 *   inventario  existencias y valor al costo (hoy)
 *   kardex      entradas y salidas de un producto
 *   ordenes     órdenes de compra con lo pedido, recibido y pendiente
 *
 * Y todoExcel(): un libro .xlsx con TODA la información, una hoja por tema,
 * para revisarla o dársela al contador. (Para copias que se vuelven a cargar
 * está "Exportar copia completa", que guarda la base entera.)
 */
const datos = require('./datos');
const { crearLibro } = require('./xlsx');

const colones = (c) => (Number(c || 0) / 100).toFixed(2).replace('.', ',');
const cant = (n) => String(Math.round(Number(n || 0) * 1000) / 1000).replace('.', ',');

function csv(filas) {
  const celda = (v) => {
    const s = String(v == null ? '' : v);
    return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return '﻿sep=;\r\n' + filas.map((f) => f.map(celda).join(';')).join('\r\n') + '\r\n';
}

const TIPO = { '01': 'Factura', '03': 'Nota de crédito', '04': 'Tiquete' };

function ventas(desde, hasta) {
  const d = datos.conexion.obtener();
  const filas = [['Tipo', 'Consecutivo', 'Clave', 'Fecha', 'Cliente', 'Identificación', 'Medio de pago',
    'Base 13%', 'IVA 13%', 'Base 4%', 'IVA 4%', 'Base 2%', 'IVA 2%', 'Base 1%', 'IVA 1%', 'Exento',
    'Total sin IVA', 'Total IVA', 'Total', 'Referencia', 'Estado Hacienda', 'Reemplazado por', 'Cuenta en reportes']];
  const comprobantes = d.prepare(`SELECT * FROM comprobantes WHERE fecha_emision BETWEEN ? AND (? || 'T99') ORDER BY id`).all(desde, hasta);
  const porTarifa = d.prepare('SELECT tarifa_iva AS t, sum(subtotal) AS b, sum(impuesto) AS i FROM comprobante_lineas WHERE comprobante_id = ? GROUP BY tarifa_iva');
  for (const c of comprobantes) {
    const signo = c.tipo === '03' ? -1 : 1;
    const t = {};
    for (const r of porTarifa.all(c.id)) t[r.t] = r;
    const g = (tar, k) => colones(signo * ((t[tar] && t[tar][k]) || 0));
    const ref = c.referencia_id ? (d.prepare('SELECT consecutivo FROM comprobantes WHERE id = ?').get(c.referencia_id) || {}).consecutivo : '';
    const reemplazo = (d.prepare('SELECT consecutivo FROM comprobantes WHERE sustituye_id = ?').get(c.id) || {}).consecutivo || '';
    filas.push([TIPO[c.tipo], c.consecutivo, c.clave, c.fecha_emision.slice(0, 19).replace('T', ' '),
      c.receptor_nombre || 'Consumidor final', c.receptor_identificacion || '', c.medio_pago,
      g(13, 'b'), g(13, 'i'), g(4, 'b'), g(4, 'i'), g(2, 'b'), g(2, 'i'), g(1, 'b'), g(1, 'i'), g(0, 'b'),
      colones(signo * c.total_venta), colones(signo * c.total_impuesto), colones(signo * c.total_comprobante), ref || '', c.estado_hacienda, reemplazo, reemplazo ? 'No (rechazado y reemplazado)' : 'Sí']);
  }
  return csv(filas);
}

function compras(desde, hasta) {
  const filas = [['Fecha', 'Proveedor', 'Identificación', 'Número de factura', 'Clave', 'Subtotal', 'IVA', 'Otros cargos', 'Total', 'Estado']];
  for (const c of datos.compras.listar({ desde, hasta, limite: 100000 })) {
    const det = datos.compras.obtenerPorId(c.id);
    filas.push([c.fecha, c.proveedor, c.proveedor_identificacion, c.numero_documento, det.clave || '',
      colones(c.subtotal), colones(c.impuesto), colones(c.otros_cargos), colones(c.total), c.estado]);
  }
  return csv(filas);
}

function iva(desde, hasta) {
  const r = datos.reportes.iva(desde, hasta);
  const filas = [['Resumen de IVA', desde + ' a ' + hasta], [],
    ['Tarifa', 'Ventas (base)', 'IVA cobrado', 'Devoluciones (base)', 'IVA devuelto', 'Compras (base)', 'IVA pagado']];
  for (const t of r.tarifas) filas.push([t.tarifa + '%', colones(t.ventas_base), colones(t.ventas_iva), colones(t.nc_base), colones(t.nc_iva), colones(t.compras_base), colones(t.compras_iva)]);
  filas.push([], ['IVA cobrado en ventas', colones(r.iva_ventas)], ['IVA devuelto (notas de crédito)', colones(r.iva_devoluciones)],
    ['Débito fiscal', colones(r.debito_fiscal)], ['IVA pagado en compras', colones(r.compras_iva)],
    ['IVA de compras sin crédito (Mensaje Receptor)', colones(r.credito_no_acreditable)], ['Crédito fiscal', colones(r.credito_fiscal)],
    [r.iva_a_pagar >= 0 ? 'IVA A PAGAR' : 'SALDO A FAVOR', colones(Math.abs(r.iva_a_pagar))]);
  return csv(filas);
}

function inventario() {
  const filas = [['Código', 'Producto', 'CABYS', 'IVA %', 'Precio (con IVA)', 'Costo (sin IVA)', 'Existencia', 'Valor al costo', 'Vence', 'Activo']];
  for (const p of datos.productos.listar({ incluirInactivos: true })) {
    filas.push([p.codigo, p.nombre, p.cabys, p.tarifa_iva, colones(p.precio), colones(p.costo), cant(p.stock),
      colones(Math.round(Math.max(0, p.stock) * p.costo)), p.vence, p.activo ? 'sí' : 'no']);
  }
  return csv(filas);
}

const TIPO_MOV = { inicial: 'Inventario inicial', compra: 'Compra', venta: 'Venta', nota_credito: 'Devolución (nota de crédito)', ajuste: 'Ajuste', anulacion_compra: 'Anulación de compra' };

function kardex(productoId) {
  const p = datos.productos.obtenerPorId(productoId);
  const filas = [['Kárdex', p ? p.codigo + ' · ' + p.nombre : ''], [], ['Fecha', 'Movimiento', 'Entrada', 'Salida', 'Saldo', 'Costo unitario', 'Documento', 'Nota']];
  for (const m of datos.productos.kardex(productoId, 100000).reverse()) {
    filas.push([m.fecha, TIPO_MOV[m.tipo] || m.tipo, m.cantidad > 0 ? cant(m.cantidad) : '', m.cantidad < 0 ? cant(-m.cantidad) : '',
      cant(m.saldo), colones(m.costo_unitario), m.comprobante || (m.compra ? 'Compra ' + m.compra + ' · ' + m.proveedor : ''), m.nota]);
  }
  return csv(filas);
}

function ordenes() {
  const filas = [['Orden', 'Estado', 'Proveedor', 'Identificación', 'Emitida', 'Fecha esperada', 'Código', 'Producto', 'Pedido', 'Recibido', 'Pendiente', 'Costo u. (sin IVA)', 'Total línea']];
  for (const o of datos.ordenes.listar({ limite: 100000 })) {
    const det = datos.ordenes.obtenerPorId(o.id);
    for (const l of det.lineas) {
      filas.push([det.numero_texto, det.estado_nombre, det.proveedor_nombre, det.proveedor_identificacion, (det.emitida_en || '').slice(0, 16),
        det.fecha_esperada, l.producto_codigo, l.descripcion, cant(l.cantidad), cant(l.recibido), cant(l.pendiente), colones(l.costo_unitario), colones(l.total_linea)]);
    }
  }
  return csv(filas);
}

/* ---------------- Todo en un Excel ---------------- */
const col = (titulo, tipo = 'texto', ancho) => ({ titulo, tipo, ancho: ancho || (tipo === 'texto' ? 18 : 14) });

/** Libro .xlsx con toda la información de la base. @returns {Buffer} */
function todoExcel() {
  const d = datos.conexion.obtener();
  const aj = datos.conexion.leerAjustes();
  const camino = datos.ordenes.enCamino();
  const hojas = [];
  const todos = (q) => d.prepare(q).all();

  const prods = datos.productos.listar({ incluirInactivos: true });
  const ventasN = d.prepare("SELECT count(*) AS n FROM comprobantes WHERE tipo IN ('01','04')").get().n;
  hojas.push({ nombre: 'Resumen', columnas: [col('Dato', 'texto', 34), col('Valor', 'texto', 30)], filas: [
    ['Negocio', aj.negocio], ['Cédula', aj.cedula], ['Exportado', new Date().toLocaleString('es-CR')],
    ['Productos (activos)', String(prods.filter((p) => p.activo).length)],
    ['Unidades en inventario', String(Math.round(prods.reduce((s, p) => s + Math.max(0, p.stock), 0) * 1000) / 1000)],
    ['Valor del inventario al costo', '₡' + (prods.reduce((s, p) => s + Math.round(Math.max(0, p.stock) * p.costo), 0) / 100).toLocaleString('es-CR', { minimumFractionDigits: 2 })],
    ['Ventas (tiquetes y facturas)', String(ventasN)],
    ['Facturas de compra', String(d.prepare('SELECT count(*) AS n FROM compras').get().n)],
    ['Órdenes de compra emitidas', String(d.prepare('SELECT count(*) AS n FROM ordenes_compra WHERE numero IS NOT NULL').get().n)],
    ['Movimientos de inventario', String(d.prepare('SELECT count(*) AS n FROM movimientos').get().n)]] });

  hojas.push({ nombre: 'Productos', columnas: [col('Código'), col('SKU', 'texto', 12), col('Producto', 'texto', 34), col('Marca', 'texto', 16), col('CABYS', 'texto', 15), col('Unidad', 'texto', 8),
    col('IVA %', 'cantidad', 7), col('Precio (con IVA)', 'dinero'), col('Costo (sin IVA)', 'dinero'), col('Existencia', 'cantidad', 11),
    col('Mínimo', 'cantidad', 9), col('En camino', 'cantidad', 10), col('Valor al costo', 'dinero'), col('Vence', 'fecha', 11), col('Activo', 'texto', 8)],
  filas: prods.map((p) => [p.codigo, p.sku, p.nombre, p.marca, p.cabys, p.unidad, p.tarifa_iva, p.precio, p.costo, p.stock, p.stock_minimo, camino[p.id] || 0,
    Math.round(Math.max(0, p.stock) * p.costo), p.vence, p.activo ? 'Sí' : 'No']) });

  hojas.push({ nombre: 'Movimientos', columnas: [col('Fecha', 'fechaHora', 17), col('Código'), col('Producto', 'texto', 30), col('Movimiento', 'texto', 22),
    col('Cantidad', 'cantidad', 10), col('Costo u.', 'dinero'), col('Comprobante', 'texto', 22), col('Factura de compra', 'texto', 22), col('Nota', 'texto', 40)],
  filas: todos(`SELECT m.fecha, p.codigo, p.nombre, m.tipo, m.cantidad, m.costo_unitario, c.consecutivo, co.numero_documento, m.nota
               FROM movimientos m JOIN productos p ON p.id = m.producto_id LEFT JOIN comprobantes c ON c.id = m.comprobante_id
               LEFT JOIN compras co ON co.id = m.compra_id ORDER BY m.id`)
    .map((m) => [m.fecha, m.codigo, m.nombre, TIPO_MOV[m.tipo] || m.tipo, m.cantidad, m.costo_unitario, m.consecutivo, m.numero_documento, m.nota]) });

  hojas.push({ nombre: 'Ventas', columnas: [col('Fecha', 'fechaHora', 17), col('Tipo', 'texto', 15), col('Consecutivo', 'texto', 22), col('Clave', 'texto', 52),
    col('Cliente', 'texto', 26), col('Identificación'), col('Medio de pago'), col('Sin IVA', 'dinero'), col('IVA', 'dinero'), col('Total', 'dinero'),
    col('Referencia', 'texto', 22), col('Estado Hacienda', 'texto', 15)],
  filas: todos(`SELECT c.*, r.consecutivo AS ref FROM comprobantes c LEFT JOIN comprobantes r ON r.id = c.referencia_id ORDER BY c.id`).map((c) => {
    const s = c.tipo === '03' ? -1 : 1;   // las notas de crédito restan
    return [c.fecha_emision, TIPO[c.tipo], c.consecutivo, c.clave, c.receptor_nombre || 'Consumidor final', c.receptor_identificacion,
      c.medio_pago, s * c.total_venta, s * c.total_impuesto, s * c.total_comprobante, c.ref, c.estado_hacienda];
  }) });

  hojas.push({ nombre: 'Líneas de venta', columnas: [col('Fecha', 'fechaHora', 17), col('Consecutivo', 'texto', 22), col('Código'), col('Producto', 'texto', 30),
    col('Cantidad', 'cantidad', 10), col('Precio u. (sin IVA)', 'dinero'), col('Sin IVA', 'dinero'), col('IVA %', 'cantidad', 7), col('IVA', 'dinero'),
    col('Total', 'dinero'), col('Costo u.', 'dinero')],
  filas: todos(`SELECT c.fecha_emision, c.consecutivo, c.tipo, l.* FROM comprobante_lineas l JOIN comprobantes c ON c.id = l.comprobante_id ORDER BY c.id, l.linea`).map((l) => {
    const s = l.tipo === '03' ? -1 : 1;
    return [l.fecha_emision, l.consecutivo, l.codigo, l.descripcion, s * l.cantidad, l.precio_unitario, s * l.subtotal, l.tarifa_iva, s * l.impuesto, s * l.total_linea, l.costo_unitario];
  }) });

  hojas.push({ nombre: 'Compras', columnas: [col('Fecha', 'fecha', 11), col('Proveedor', 'texto', 28), col('Identificación'), col('Factura', 'texto', 22),
    col('Orden de compra', 'texto', 12), col('Sin IVA', 'dinero'), col('IVA', 'dinero'), col('Otros cargos', 'dinero'), col('Total', 'dinero'), col('Estado', 'texto', 10),
    col('Clave', 'texto', 52)],
  filas: todos(`SELECT c.*, p.nombre, p.identificacion, o.numero AS oc FROM compras c JOIN proveedores p ON p.id = c.proveedor_id
               LEFT JOIN ordenes_compra o ON o.id = c.orden_id ORDER BY c.fecha, c.id`)
    .map((c) => [c.fecha, c.nombre, c.identificacion, c.numero_documento, c.oc ? datos.ordenes.numeroTexto(c.oc) : '', c.subtotal, c.impuesto,
      c.otros_cargos, c.total, c.estado === 'anulada' ? 'Anulada' : 'Vigente', c.clave]) });

  hojas.push({ nombre: 'Líneas de compra', columnas: [col('Fecha', 'fecha', 11), col('Proveedor', 'texto', 26), col('Factura', 'texto', 22), col('Código'),
    col('Descripción', 'texto', 30), col('Cantidad', 'cantidad', 10), col('Costo u. (sin IVA)', 'dinero'), col('Sin IVA', 'dinero'), col('IVA %', 'cantidad', 7),
    col('IVA', 'dinero'), col('Total', 'dinero'), col('Estado', 'texto', 10)],
  filas: todos(`SELECT c.fecha, p.nombre, c.numero_documento, c.estado, pr.codigo, l.* FROM compra_lineas l JOIN compras c ON c.id = l.compra_id
               JOIN proveedores p ON p.id = c.proveedor_id LEFT JOIN productos pr ON pr.id = l.producto_id ORDER BY c.fecha, c.id, l.linea`)
    .map((l) => [l.fecha, l.nombre, l.numero_documento, l.codigo || '(gasto)', l.descripcion, l.cantidad, l.costo_unitario, l.subtotal, l.tarifa_iva,
      l.impuesto, l.total_linea, l.estado === 'anulada' ? 'Anulada' : 'Vigente']) });

  const filasOc = [];
  for (const o of datos.ordenes.listar({ limite: 100000 })) {
    const det = datos.ordenes.obtenerPorId(o.id);
    for (const l of det.lineas) filasOc.push([det.numero_texto, det.estado_nombre, det.proveedor_nombre, det.emitida_en, det.fecha_esperada,
      l.producto_codigo, l.descripcion, l.cantidad, l.recibido, l.pendiente, l.costo_unitario, l.total_linea]);
  }
  hojas.push({ nombre: 'Órdenes de compra', columnas: [col('Orden', 'texto', 11), col('Estado', 'texto', 18), col('Proveedor', 'texto', 26),
    col('Emitida', 'fechaHora', 17), col('Fecha esperada', 'fecha', 12), col('Código'), col('Producto', 'texto', 30), col('Pedido', 'cantidad', 9),
    col('Recibido', 'cantidad', 9), col('Pendiente', 'cantidad', 10), col('Costo u. (sin IVA)', 'dinero'), col('Total línea', 'dinero')], filas: filasOc });

  hojas.push({ nombre: 'Proveedores', columnas: [col('Identificación'), col('Nombre', 'texto', 30), col('Nombre comercial', 'texto', 24), col('Correo', 'texto', 26),
    col('Teléfono'), col('Contacto', 'texto', 20), col('Días de crédito', 'entero', 10), col('Dirección', 'texto', 30), col('Notas', 'texto', 30), col('Activo', 'texto', 8)],
    filas: todos('SELECT * FROM proveedores ORDER BY nombre COLLATE NOCASE').map((p) => [p.identificacion, p.nombre, p.nombre_comercial, p.correo, p.telefono,
      p.contacto, p.dias_credito, p.direccion, p.notas, p.activo ? 'Sí' : 'No']) });
  hojas.push({ nombre: 'Productos por proveedor', columnas: [col('Proveedor', 'texto', 30), col('Código'), col('Producto', 'texto', 34),
    col('Código del proveedor', 'texto', 16), col('Costo (sin IVA)', 'dinero'), col('Última compra', 'fecha', 12)],
    filas: todos(`SELECT pr.nombre AS proveedor, p.codigo, p.nombre, pp.codigo_proveedor, pp.costo, pp.ultima_compra
                  FROM proveedor_productos pp JOIN proveedores pr ON pr.id = pp.proveedor_id JOIN productos p ON p.id = pp.producto_id
                  ORDER BY pr.nombre COLLATE NOCASE, p.nombre COLLATE NOCASE`).map((r) => [r.proveedor, r.codigo, r.nombre, r.codigo_proveedor, r.costo, r.ultima_compra]) });
  hojas.push({ nombre: 'Clientes', columnas: [col('Identificación'), col('Nombre', 'texto', 30), col('Correo', 'texto', 26), col('Teléfono')],
    filas: todos('SELECT * FROM clientes ORDER BY nombre COLLATE NOCASE').map((c) => [c.identificacion, c.nombre, c.correo, c.telefono]) });
  return crearLibro(hojas);
}

module.exports = { ventas, compras, iva, inventario, kardex, ordenes, todoExcel };
