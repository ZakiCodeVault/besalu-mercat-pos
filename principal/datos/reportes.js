/**
 * reportes.js — Números del negocio, calculados directo de la base de datos.
 *
 * IVA a pagar del período:
 *   IVA cobrado en ventas (facturas y tiquetes)
 * − IVA devuelto en notas de crédito
 * − IVA pagado en compras vigentes            (crédito fiscal)
 *   + menos lo que el Mensaje Receptor declaró no acreditable: factura
 *     rechazada (07), gasto sin crédito (04) o la parte no acreditada (02)
 * = IVA a pagar a Hacienda  (si es negativo, es saldo a favor)
 *
 * Fechas de los filtros: 'AAAA-MM-DD' (ambas incluidas).
 */
const { obtener, leerAjustes } = require('./conexion');
const { motivoNoAceptable } = require('../hacienda/receptor');

const fechaComp = 'substr(c.fecha_emision, 1, 10)';
// Un comprobante rechazado que ya se reemplazó no cuenta: cuenta su reemplazo
const vigente = 'NOT EXISTS (SELECT 1 FROM comprobantes s WHERE s.sustituye_id = c.id)';

/** IVA del período, desglosado por tarifa. */
function iva(desde, hasta) {
  const d = obtener();
  const porTarifa = {};
  const fila = (t) => (porTarifa[t] = porTarifa[t] || { tarifa: t, ventas_base: 0, ventas_iva: 0, nc_base: 0, nc_iva: 0, compras_base: 0, compras_iva: 0 });

  for (const r of d.prepare(`
      SELECT l.tarifa_iva AS t, c.tipo, sum(l.subtotal) AS base, sum(l.impuesto) AS imp
      FROM comprobante_lineas l JOIN comprobantes c ON c.id = l.comprobante_id
      WHERE ${fechaComp} BETWEEN ? AND ? AND ${vigente} GROUP BY l.tarifa_iva, c.tipo`).all(desde, hasta)) {
    const f = fila(r.t);
    if (r.tipo === '03') { f.nc_base += r.base; f.nc_iva += r.imp; } else { f.ventas_base += r.base; f.ventas_iva += r.imp; }
  }
  for (const r of d.prepare(`
      SELECT l.tarifa_iva AS t, sum(l.subtotal) AS base, sum(l.impuesto) AS imp
      FROM compra_lineas l JOIN compras c ON c.id = l.compra_id
      WHERE c.estado = 'vigente' AND c.fecha BETWEEN ? AND ? GROUP BY l.tarifa_iva`).all(desde, hasta)) {
    const f = fila(r.t); f.compras_base += r.base; f.compras_iva += r.imp;
  }
  const tarifas = Object.values(porTarifa).sort((a, b) => b.tarifa - a.tarifa);
  const sum = (k) => tarifas.reduce((s, x) => s + x[k], 0);
  // Según el mensaje en curso de cada compra (el que Hacienda no rechazó)
  const receptor = d.prepare(`
    SELECT coalesce(sum(CASE
             WHEN m.tipo = '07' OR m.condicion_impuesto = '04' THEN c.impuesto
             WHEN m.condicion_impuesto = '02' THEN max(0, c.impuesto - CAST(round(CAST(m.impuesto_acreditar AS REAL) * 100) AS INTEGER))
             ELSE 0 END), 0) AS no_acreditable
    FROM compras c JOIN mensajes_receptor m ON m.compra_id = c.id AND m.estado_hacienda <> 'rechazado'
    WHERE c.estado = 'vigente' AND c.fecha BETWEEN ? AND ?`).get(desde, hasta);
  // Facturas importadas a nombre del negocio que Hacienda todavía no tiene aceptadas
  const aj = leerAjustes();
  receptor.sin_aceptar = d.prepare(`
    SELECT c.xml_original FROM compras c LEFT JOIN mensajes_receptor m ON m.compra_id = c.id AND m.estado_hacienda <> 'rechazado'
    WHERE c.estado = 'vigente' AND c.fecha BETWEEN ? AND ? AND c.xml_original IS NOT NULL AND coalesce(m.estado_hacienda, '') <> 'aceptado'`)
    .all(desde, hasta).filter((c) => !motivoNoAceptable(c.xml_original, aj)).length;
  const debito = sum('ventas_iva') - sum('nc_iva');
  const credito = sum('compras_iva') - receptor.no_acreditable;
  return {
    desde, hasta, tarifas,
    ventas_base: sum('ventas_base') - sum('nc_base'),
    iva_ventas: sum('ventas_iva'), iva_devoluciones: sum('nc_iva'),
    debito_fiscal: debito, compras_iva: sum('compras_iva'), credito_no_acreditable: receptor.no_acreditable,
    credito_fiscal: credito, compras_base: sum('compras_base'),
    compras_sin_aceptar: receptor.sin_aceptar,   // facturas importadas aún sin aceptar ante Hacienda
    iva_a_pagar: debito - credito
  };
}

/** Balance de entradas y salidas del período. */
function balance(desde, hasta) {
  const d = obtener();
  const v = d.prepare(`
    SELECT
      sum(CASE WHEN c.tipo IN ('01','04') THEN l.subtotal ELSE -l.subtotal END) AS ventas_netas,
      sum(CASE WHEN c.tipo IN ('01','04') THEN round(l.cantidad * l.costo_unitario) ELSE -round(l.cantidad * l.costo_unitario) END) AS costo_ventas
    FROM comprobante_lineas l JOIN comprobantes c ON c.id = l.comprobante_id
    WHERE ${fechaComp} BETWEEN ? AND ? AND ${vigente}`).get(desde, hasta);
  const compras = d.prepare(`
    SELECT count(*) AS facturas, coalesce(sum(subtotal), 0) AS base, coalesce(sum(impuesto), 0) AS iva, coalesce(sum(total), 0) AS total
    FROM compras WHERE estado = 'vigente' AND fecha BETWEEN ? AND ?`).get(desde, hasta);
  const movs = d.prepare(`
    SELECT tipo, round(sum(cantidad), 3) AS unidades, count(*) AS registros
    FROM movimientos WHERE substr(fecha, 1, 10) BETWEEN ? AND ? GROUP BY tipo`).all(desde, hasta);
  const unidades = {};
  for (const m of movs) unidades[m.tipo] = m.unidades;
  const entradas = (unidades.compra || 0) + (unidades.nota_credito || 0) + (unidades.inicial || 0) + Math.max(0, unidades.ajuste || 0);
  const salidas = -((unidades.venta || 0) + (unidades.anulacion_compra || 0) + Math.min(0, unidades.ajuste || 0));
  const ventas = v.ventas_netas || 0, costo = v.costo_ventas || 0;
  return {
    desde, hasta,
    ventas_netas: ventas, costo_ventas: costo, utilidad_bruta: ventas - costo,
    margen: ventas ? Math.round((ventas - costo) / ventas * 1000) / 10 : 0,
    compras, unidades_por_tipo: unidades,
    unidades_entradas: Math.round(entradas * 1000) / 1000,
    unidades_salidas: Math.round(salidas * 1000) / 1000,
    inventario: valorInventario()
  };
}

/** Totales de ventas del período (netos de notas de crédito) y por medio de pago. */
function resumenVentas(desde, hasta) {
  const d = obtener();
  const r = d.prepare(`
    SELECT
      coalesce(sum(CASE WHEN c.tipo IN ('01','04') THEN c.total_comprobante ELSE -c.total_comprobante END), 0) AS total,
      coalesce(sum(CASE WHEN c.tipo IN ('01','04') THEN 1 ELSE 0 END), 0) AS cantidad,
      coalesce(sum(CASE WHEN c.tipo = '03' THEN c.total_comprobante ELSE 0 END), 0) AS devoluciones
    FROM comprobantes c WHERE ${fechaComp} BETWEEN ? AND ? AND ${vigente}`).get(desde, hasta);
  const medios = { efectivo: 0, tarjeta: 0, sinpe: 0, transferencia: 0, otro: 0 };
  for (const m of d.prepare(`
      SELECT medio_pago, sum(CASE WHEN tipo IN ('01','04') THEN total_comprobante ELSE -total_comprobante END) AS total
      FROM comprobantes c WHERE ${fechaComp} BETWEEN ? AND ? AND ${vigente} GROUP BY medio_pago`).all(desde, hasta)) medios[m.medio_pago] = m.total;
  return { desde, hasta, total: r.total, cantidad: r.cantidad, devoluciones: r.devoluciones,
           ticket_promedio: r.cantidad ? Math.round(r.total / r.cantidad) : 0, medios };
}

/** Ventas netas por día (para el gráfico). */
function ventasPorDia(desde, hasta) {
  return obtener().prepare(`
    SELECT ${fechaComp} AS dia,
           sum(CASE WHEN c.tipo IN ('01','04') THEN c.total_comprobante ELSE -c.total_comprobante END) AS total
    FROM comprobantes c WHERE ${fechaComp} BETWEEN ? AND ? AND ${vigente} GROUP BY dia ORDER BY dia`).all(desde, hasta);
}

function masVendidos(desde, hasta, limite = 8) {
  return obtener().prepare(`
    SELECT l.descripcion AS nombre,
           round(sum(CASE WHEN c.tipo = '03' THEN -l.cantidad ELSE l.cantidad END), 3) AS cantidad,
           sum(CASE WHEN c.tipo = '03' THEN -l.total_linea ELSE l.total_linea END) AS total
    FROM comprobante_lineas l JOIN comprobantes c ON c.id = l.comprobante_id
    WHERE ${fechaComp} BETWEEN ? AND ? AND ${vigente} GROUP BY l.producto_id, l.descripcion
    HAVING cantidad > 0 ORDER BY total DESC LIMIT ?`).all(desde, hasta, limite);
}

function valorInventario() {
  return obtener().prepare(`
    SELECT count(*) AS productos, round(coalesce(sum(CASE WHEN stock > 0 THEN stock ELSE 0 END), 0), 3) AS unidades,
           coalesce(sum(CASE WHEN stock > 0 THEN round(stock * costo) ELSE 0 END), 0) AS valor_costo,
           coalesce(sum(CASE WHEN stock > 0 THEN round(stock * precio) ELSE 0 END), 0) AS valor_venta
    FROM productos WHERE activo = 1`).get();
}

/** Productos con stock bajo y por vencer. */
function alertas() {
  const aj = leerAjustes();
  const d = obtener();
  const bajos = d.prepare(`
    SELECT id, nombre, stock, CASE WHEN stock_minimo > 0 THEN stock_minimo ELSE ? END AS minimo
    FROM productos WHERE activo = 1 AND stock < (CASE WHEN stock_minimo > 0 THEN stock_minimo ELSE ? END)
    ORDER BY stock`).all(aj.stockMin, aj.stockMin);
  const porVencer = d.prepare(`
    SELECT id, nombre, stock, vence, CAST(julianday(vence) - julianday(date('now','localtime')) AS INTEGER) AS dias
    FROM productos WHERE activo = 1 AND vence <> '' AND stock > 0
      AND julianday(vence) - julianday(date('now','localtime')) <= ?
    ORDER BY vence`).all(aj.venceDias);
  return { bajos, porVencer };
}

/** Comprobantes que todavía no se enviaron a Hacienda. */
function pendientesHacienda() {
  return obtener().prepare(`SELECT estado_hacienda AS estado, count(*) AS n FROM comprobantes GROUP BY estado_hacienda`).all();
}

module.exports = { iva, balance, resumenVentas, ventasPorDia, masVendidos, valorInventario, alertas, pendientesHacienda };
