/**
 * exportar.js — Genera archivos CSV para Excel (español: separador ";" y coma decimal).
 *
 *   ventas      comprobantes emitidos del período, con IVA por tarifa
 *   compras     facturas de compra del período
 *   iva         resumen de IVA a pagar del período
 *   inventario  existencias y valor al costo (hoy)
 *   kardex      entradas y salidas de un producto
 */
const datos = require('./datos');

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
    'Total sin IVA', 'Total IVA', 'Total', 'Referencia', 'Estado Hacienda']];
  const comprobantes = d.prepare(`SELECT * FROM comprobantes WHERE substr(fecha_emision,1,10) BETWEEN ? AND ? ORDER BY id`).all(desde, hasta);
  const porTarifa = d.prepare('SELECT tarifa_iva AS t, sum(subtotal) AS b, sum(impuesto) AS i FROM comprobante_lineas WHERE comprobante_id = ? GROUP BY tarifa_iva');
  for (const c of comprobantes) {
    const signo = c.tipo === '03' ? -1 : 1;
    const t = {};
    for (const r of porTarifa.all(c.id)) t[r.t] = r;
    const g = (tar, k) => colones(signo * ((t[tar] && t[tar][k]) || 0));
    const ref = c.referencia_id ? (d.prepare('SELECT consecutivo FROM comprobantes WHERE id = ?').get(c.referencia_id) || {}).consecutivo : '';
    filas.push([TIPO[c.tipo], c.consecutivo, c.clave, c.fecha_emision.slice(0, 19).replace('T', ' '),
      c.receptor_nombre || 'Consumidor final', c.receptor_identificacion || '', c.medio_pago,
      g(13, 'b'), g(13, 'i'), g(4, 'b'), g(4, 'i'), g(2, 'b'), g(2, 'i'), g(1, 'b'), g(1, 'i'), g(0, 'b'),
      colones(signo * c.total_venta), colones(signo * c.total_impuesto), colones(signo * c.total_comprobante), ref || '', c.estado_hacienda]);
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
    ['Débito fiscal', colones(r.debito_fiscal)], ['Crédito fiscal (IVA de compras)', colones(r.credito_fiscal)],
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

module.exports = { ventas, compras, iva, inventario, kardex };
