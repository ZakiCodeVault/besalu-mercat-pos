/**
 * caja.js — Turnos de caja: apertura con fondo, arqueo y cierre (reporte Z).
 *
 * El efectivo esperado se calcula con los comprobantes reales del turno:
 *   fondo + ventas en efectivo − notas de crédito en efectivo
 * Un turno cerrado ya no se puede modificar (lo impide la base de datos).
 */
const { obtener, registrar } = require('./conexion');
const { fechaLocal } = require('./montos');

function actual() {
  return obtener().prepare('SELECT * FROM turnos WHERE cerrado_en IS NULL').get() || null;
}

function abrir(fondo) {
  const f = Number(fondo);
  if (!Number.isInteger(f) || f < 0) throw new Error('Fondo inválido');
  if (actual()) throw new Error('Ya hay una caja abierta');
  const r = obtener().prepare('INSERT INTO turnos(abierto_en, fondo) VALUES(?, ?)').run(fechaLocal(), f);
  registrar('caja_abierta', { turno: Number(r.lastInsertRowid), fondo: f });
  return actual();
}

/** Resumen de un turno: ventas por medio de pago, devoluciones y efectivo esperado. */
function resumen(turnoId) {
  const d = obtener();
  const t = d.prepare('SELECT * FROM turnos WHERE id = ?').get(turnoId);
  if (!t) throw new Error('El turno no existe');
  const filas = d.prepare(`
    SELECT medio_pago,
           sum(CASE WHEN tipo IN ('01','04') THEN total_comprobante ELSE 0 END) AS ventas,
           sum(CASE WHEN tipo = '03' THEN total_comprobante ELSE 0 END) AS devoluciones,
           sum(CASE WHEN tipo IN ('01','04') THEN 1 ELSE 0 END) AS cantidad
    FROM comprobantes WHERE turno_id = ? GROUP BY medio_pago`).all(turnoId);
  const medios = { efectivo: 0, tarjeta: 0, sinpe: 0, transferencia: 0, otro: 0 };
  const devol = { efectivo: 0, tarjeta: 0, sinpe: 0, transferencia: 0, otro: 0 };
  let comprobantes = 0;
  for (const f of filas) { medios[f.medio_pago] = f.ventas; devol[f.medio_pago] = f.devoluciones; comprobantes += f.cantidad; }
  const ventasBrutas = Object.values(medios).reduce((s, x) => s + x, 0);
  const devoluciones = Object.values(devol).reduce((s, x) => s + x, 0);
  return {
    turno: t, comprobantes, medios, devoluciones_por_medio: devol,
    ventas: ventasBrutas, devoluciones, ventas_netas: ventasBrutas - devoluciones,
    efectivo_esperado: t.fondo + medios.efectivo - devol.efectivo
  };
}

function cerrar(contado) {
  const c = Number(contado);
  if (!Number.isInteger(c) || c < 0) throw new Error('Monto contado inválido');
  const d = obtener();
  return d.transaction(() => {
    const t = actual();
    if (!t) throw new Error('No hay una caja abierta');
    const r = resumen(t.id);
    d.prepare('UPDATE turnos SET cerrado_en = ?, contado = ?, esperado = ?, diferencia = ? WHERE id = ?')
      .run(fechaLocal(), c, r.efectivo_esperado, c - r.efectivo_esperado, t.id);
    registrar('caja_cerrada', { turno: t.id, esperado: r.efectivo_esperado, contado: c, diferencia: c - r.efectivo_esperado, ventas_netas: r.ventas_netas });
    return resumen(t.id);
  })();
}

function historial(limite = 60) {
  return obtener().prepare('SELECT * FROM turnos WHERE cerrado_en IS NOT NULL ORDER BY id DESC LIMIT ?').all(limite);
}

module.exports = { actual, abrir, resumen, cerrar, historial };
