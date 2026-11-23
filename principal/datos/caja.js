/**
 * caja.js — Turnos de caja: apertura con fondo, relevos de cajero, arqueo y
 * cierre (reporte Z).
 *
 * El efectivo esperado se calcula con los comprobantes reales:
 *   turno:  fondo + ventas en efectivo − notas de crédito en efectivo
 *   tramo:  lo que recibió el cajero + sus ventas en efectivo − sus devoluciones en efectivo
 *
 * Un turno puede tener varios tramos (relevos): el cajero que sale cuenta el
 * efectivo (sin ver lo esperado) y el que entra lo recibe con su PIN; la caja
 * no se cierra. La suma de las diferencias de los tramos es la del turno.
 * Turnos y tramos cerrados no se pueden modificar (lo impide la base de datos).
 */
const { obtener, registrar } = require('./conexion');
const { fechaLocal } = require('./montos');
const sesion = require('./sesion');

function actual() {
  return obtener().prepare('SELECT * FROM turnos WHERE cerrado_en IS NULL').get() || null;
}

function tramoAbierto(turnoId) {
  return obtener().prepare(`SELECT t.*, u.nombre AS usuario_nombre FROM caja_tramos t JOIN usuarios u ON u.id = t.usuario_id
                            WHERE t.turno_id = ? AND t.fin IS NULL`).get(turnoId) || null;
}

function abrir(fondo) {
  const f = Number(fondo);
  if (!Number.isInteger(f) || f < 0) throw new Error('Fondo inválido');
  const d = obtener();
  return d.transaction(() => {
    if (actual()) throw new Error('Ya hay una caja abierta');
    const ahora = fechaLocal();
    const u = sesion.usuarioId();
    const id = Number(d.prepare('INSERT INTO turnos(abierto_en, fondo, abierto_por) VALUES(?, ?, ?)').run(ahora, f, u).lastInsertRowid);
    if (u) d.prepare("INSERT INTO caja_tramos(turno_id, usuario_id, inicio, recibido, origen) VALUES(?, ?, ?, ?, 'apertura')").run(id, u, ahora, f);
    registrar('caja_abierta', { turno: id, fondo: f });
    return actual();
  })();
}

/** Efectivo y ventas de un conjunto de comprobantes (de un turno o de un tramo). */
function totales(where, param) {
  const filas = obtener().prepare(`
    SELECT medio_pago,
           sum(CASE WHEN tipo IN ('01','04') THEN total_comprobante ELSE 0 END) AS ventas,
           sum(CASE WHEN tipo = '03' THEN total_comprobante ELSE 0 END) AS devoluciones,
           sum(CASE WHEN tipo IN ('01','04') THEN 1 ELSE 0 END) AS cantidad
    FROM comprobantes WHERE ${where} GROUP BY medio_pago`).all(param);
  const medios = { efectivo: 0, tarjeta: 0, sinpe: 0, transferencia: 0, otro: 0 };
  const devol = { efectivo: 0, tarjeta: 0, sinpe: 0, transferencia: 0, otro: 0 };
  let comprobantes = 0;
  for (const f of filas) { medios[f.medio_pago] = f.ventas; devol[f.medio_pago] = f.devoluciones; comprobantes += f.cantidad; }
  const ventas = Object.values(medios).reduce((s, x) => s + x, 0);
  const devoluciones = Object.values(devol).reduce((s, x) => s + x, 0);
  return { comprobantes, medios, devoluciones_por_medio: devol, ventas, devoluciones, ventas_netas: ventas - devoluciones, efectivo_neto: medios.efectivo - devol.efectivo };
}

/** Resumen de un tramo: lo que recibió el cajero, lo que vendió y el efectivo que debería tener. */
function resumenTramo(tramoId) {
  const t = obtener().prepare(`SELECT t.*, u.nombre AS usuario_nombre, e.nombre AS entrega_a_nombre FROM caja_tramos t
                               JOIN usuarios u ON u.id = t.usuario_id LEFT JOIN usuarios e ON e.id = t.entrega_a WHERE t.id = ?`).get(tramoId);
  if (!t) throw new Error('El tramo no existe');
  const r = totales('tramo_id = ?', t.id);
  return Object.assign({ tramo: t }, r, { efectivo_esperado: t.recibido + r.efectivo_neto });
}

/** Resumen de un turno: ventas por medio de pago, devoluciones, efectivo esperado y sus tramos. */
function resumen(turnoId) {
  const d = obtener();
  const t = d.prepare(`SELECT t.*, a.nombre AS abierto_por_nombre, c.nombre AS cerrado_por_nombre FROM turnos t
                       LEFT JOIN usuarios a ON a.id = t.abierto_por LEFT JOIN usuarios c ON c.id = t.cerrado_por WHERE t.id = ?`).get(turnoId);
  if (!t) throw new Error('El turno no existe');
  const r = totales('turno_id = ?', turnoId);
  const tramos = d.prepare('SELECT id FROM caja_tramos WHERE turno_id = ? ORDER BY id').all(turnoId).map((x) => resumenTramo(x.id));
  return Object.assign({ turno: t }, r, { efectivo_esperado: t.fondo + r.efectivo_neto, tramos });
}

/**
 * Si la caja quedó abierta sin tramo (abierta antes de existir los usuarios),
 * el primero que ingresa queda a cargo del efectivo que el sistema espera en ese momento.
 */
function asegurarTramo(usuarioId) {
  const d = obtener();
  return d.transaction(() => {
    const t = actual();
    if (!t || !usuarioId || tramoAbierto(t.id)) return t ? tramoAbierto(t.id) : null;
    const esperado = resumen(t.id).efectivo_esperado;
    const id = Number(d.prepare("INSERT INTO caja_tramos(turno_id, usuario_id, inicio, recibido, origen) VALUES(?, ?, ?, ?, 'continuacion')")
      .run(t.id, usuarioId, fechaLocal(), Math.max(0, esperado)).lastInsertRowid);
    registrar('caja_tramo_continuacion', { turno: t.id, tramo: id, recibido: esperado });
    return tramoAbierto(t.id);
  })();
}

/**
 * Relevo de cajero sin cerrar la caja: el que sale entrega lo contado y el que
 * entra empieza con eso.
 * @returns {{ saliente: object, entrante: object }} resumen del tramo cerrado y el tramo nuevo
 */
function relevo(contado, entranteId) {
  const c = Number(contado);
  if (!Number.isInteger(c) || c < 0) throw new Error('Monto contado inválido');
  const d = obtener();
  return d.transaction(() => {
    const t = actual();
    if (!t) throw new Error('No hay una caja abierta');
    const tramo = tramoAbierto(t.id);
    if (!tramo) throw new Error('La caja no tiene un cajero a cargo');
    const entrante = d.prepare('SELECT id, nombre FROM usuarios WHERE id = ? AND activo = 1').get(entranteId);
    if (!entrante) throw new Error('Elija quién recibe la caja');
    if (entrante.id === tramo.usuario_id) throw new Error(entrante.nombre + ' ya tiene la caja');
    const r = resumenTramo(tramo.id);
    const ahora = fechaLocal();
    d.prepare('UPDATE caja_tramos SET fin = ?, esperado = ?, contado = ?, diferencia = ?, entrega_a = ? WHERE id = ?')
      .run(ahora, r.efectivo_esperado, c, c - r.efectivo_esperado, entrante.id, tramo.id);
    const nuevo = Number(d.prepare("INSERT INTO caja_tramos(turno_id, usuario_id, inicio, recibido, origen) VALUES(?, ?, ?, ?, 'relevo')")
      .run(t.id, entrante.id, ahora, c).lastInsertRowid);
    registrar('relevo_caja', { turno: t.id, entrega: tramo.usuario_nombre, recibe: entrante.nombre, esperado: r.efectivo_esperado, contado: c, diferencia: c - r.efectivo_esperado });
    return { saliente: resumenTramo(tramo.id), entrante: tramoAbierto(t.id), turno: t.id, tramo_nuevo: nuevo };
  })();
}

function cerrar(contado) {
  const c = Number(contado);
  if (!Number.isInteger(c) || c < 0) throw new Error('Monto contado inválido');
  const d = obtener();
  return d.transaction(() => {
    const t = actual();
    if (!t) throw new Error('No hay una caja abierta');
    const r = resumen(t.id);
    const ahora = fechaLocal();
    // El último tramo se cierra con el mismo conteo del cierre
    const tramo = tramoAbierto(t.id);
    if (tramo) {
      const rt = resumenTramo(tramo.id);
      d.prepare('UPDATE caja_tramos SET fin = ?, esperado = ?, contado = ?, diferencia = ? WHERE id = ?').run(ahora, rt.efectivo_esperado, c, c - rt.efectivo_esperado, tramo.id);
    }
    d.prepare('UPDATE turnos SET cerrado_en = ?, contado = ?, esperado = ?, diferencia = ?, cerrado_por = ? WHERE id = ?')
      .run(ahora, c, r.efectivo_esperado, c - r.efectivo_esperado, sesion.usuarioId(), t.id);
    registrar('caja_cerrada', { turno: t.id, esperado: r.efectivo_esperado, contado: c, diferencia: c - r.efectivo_esperado, ventas_netas: r.ventas_netas });
    return resumen(t.id);
  })();
}

function historial(limite = 60) {
  return obtener().prepare(`SELECT t.*, c.nombre AS cerrado_por_nombre FROM turnos t LEFT JOIN usuarios c ON c.id = t.cerrado_por
                            WHERE t.cerrado_en IS NOT NULL ORDER BY t.id DESC LIMIT ?`).all(limite);
}

module.exports = { actual, abrir, resumen, resumenTramo, tramoAbierto, asegurarTramo, relevo, cerrar, historial };
