/**
 * revision.js — Revisión completa de la base de datos (sin escribir nada).
 *
 * Se usa con la conexión de la app ("Verificar ahora") y también desde un
 * proceso aparte al abrir la app (revision-proceso.js), para que la ventana
 * aparezca de una vez y la caja no se trabe mientras se revisa.
 *
 *   - archivo sano (integrity_check) y sin registros huérfanos
 *   - existencia de cada producto = suma de su kárdex
 *   - consecutivos de comprobantes, mensajes y órdenes sin saltos
 */
function revisar(d, fecha) {
  const problemas = [];
  const integridad = d.pragma('integrity_check', { simple: true });
  if (integridad !== 'ok') problemas.push('Archivo: ' + integridad);
  const huerfanos = d.pragma('foreign_key_check');
  if (huerfanos.length) problemas.push('Registros huérfanos: ' + huerfanos.length);
  const descuadres = d.prepare(`
    SELECT p.id, p.nombre, p.stock, round(coalesce(sum(m.cantidad), 0), 3) AS kardex
    FROM productos p LEFT JOIN movimientos m ON m.producto_id = p.id
    GROUP BY p.id HAVING abs(p.stock - kardex) > 0.0005`).all();
  for (const x of descuadres) problemas.push('Stock de "' + x.nombre + '" (' + x.stock + ') no coincide con su kárdex (' + x.kardex + ')');
  for (const s of d.prepare('SELECT tipo, ultimo FROM secuencias').all()) {
    const n = d.prepare('SELECT count(*) AS n, coalesce(max(numero), 0) AS mx FROM comprobantes WHERE tipo = ?').get(s.tipo);
    if (n.n !== s.ultimo || n.mx !== s.ultimo) problemas.push('Consecutivo ' + s.tipo + ': faltan números (' + n.n + ' de ' + s.ultimo + ')');
  }
  for (const s of d.prepare('SELECT tipo, ultimo FROM secuencias_receptor').all()) {
    const n = d.prepare('SELECT count(*) AS n, coalesce(max(numero), 0) AS mx FROM mensajes_receptor WHERE tipo = ?').get(s.tipo);
    if (n.n !== s.ultimo || n.mx !== s.ultimo) problemas.push('Consecutivo de mensajes ' + s.tipo + ': faltan números (' + n.n + ' de ' + s.ultimo + ')');
  }
  const oc = d.prepare('SELECT count(*) AS n, coalesce(max(numero), 0) AS mx FROM ordenes_compra WHERE numero IS NOT NULL').get();
  if (oc.n !== oc.mx) problemas.push('Órdenes de compra: faltan números (' + oc.n + ' de ' + oc.mx + ')');
  return { ok: problemas.length === 0, problemas, revisado: fecha };
}

module.exports = { revisar };
