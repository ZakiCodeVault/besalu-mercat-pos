/**
 * conexion.js — Abre la base de datos SQLite con las protecciones activas.
 *
 *   journal_mode = WAL     -> escrituras seguras y lecturas sin bloquear
 *   synchronous  = FULL    -> cada venta queda en disco antes de confirmarse
 *                             (lo más seguro ante un apagón)
 *   foreign_keys = ON      -> no puede haber líneas o movimientos huérfanos
 */
const path = require('path');
const Database = require('better-sqlite3');
const { MIGRACIONES } = require('./esquema');
const { fechaLocal } = require('./montos');

const NOMBRE_ARCHIVO = 'besalu-facturacion.sqlite';

const AJUSTES_BASE = {
  negocio: 'Besalú Mercat',
  nombreComercial: 'Besalú Mercat · Minimarket Gourmet',
  tipoCedula: '02',          // 01 física, 02 jurídica, 03 DIMEX, 04 NITE
  cedula: '',                 // obligatoria para emitir comprobantes
  actividadEconomica: '',     // código de actividad (lo pide Hacienda)
  telefono: '',
  correo: '',
  direccion: '',
  sucursal: '001',
  terminal: '00001',
  stockMin: 5,
  venceDias: 15,
  permitirStockNegativo: false,
  ticket: '80 mm',
  imprimirAlCobrar: true,
  pieTicket: '¡Gracias por su compra!',
  correoDuena: '',
  carpetaRespaldoExtra: ''
};

let db = null;
let ruta = null;

function abrir(carpeta) {
  ruta = path.join(carpeta, NOMBRE_ARCHIVO);
  db = new Database(ruta);
  configurar(db);
  migrar();
  return ruta;
}

function configurar(conexion) {
  conexion.pragma('journal_mode = WAL');
  conexion.pragma('synchronous = FULL');
  conexion.pragma('foreign_keys = ON');
  conexion.pragma('busy_timeout = 5000');
}

function migrar() {
  const actual = db.pragma('user_version', { simple: true });
  if (actual > 0 && actual < MIGRACIONES.length) {
    // Base con datos que cambia de esquema: primero una copia completa al lado
    const copia = path.join(path.dirname(ruta), 'antes-de-migrar-v' + actual + '-' + fechaLocal().replace(/[: ]/g, '-') + '.sqlite');
    db.prepare('VACUUM INTO ?').run(copia);
  }
  for (let v = actual; v < MIGRACIONES.length; v++) {
    db.transaction(() => {
      db.exec(MIGRACIONES[v]);
      db.pragma('user_version = ' + (v + 1));
    })();
    registrar('migracion', 'Esquema actualizado a la versión ' + (v + 1));
  }
}

function obtener() {
  if (!db) throw new Error('La base de datos no está abierta');
  return db;
}

function rutaArchivo() { return ruta; }

function cerrar() {
  if (db) {
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (e) {}
    db.close();
  }
  db = null;
}

/* ---------- configuración ---------- */
function leerConfig(clave, porDefecto) {
  const fila = obtener().prepare('SELECT valor FROM config WHERE clave = ?').get(clave);
  if (!fila) return porDefecto;
  try { return JSON.parse(fila.valor); } catch (e) { return porDefecto; }
}

function escribirConfig(clave, valor) {
  obtener().prepare('INSERT INTO config(clave, valor) VALUES(?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor')
    .run(clave, JSON.stringify(valor));
}

function leerAjustes() {
  return Object.assign({}, AJUSTES_BASE, leerConfig('ajustes', {}));
}

function guardarAjustes(nuevos) {
  const actuales = leerAjustes();
  const permitidos = {};
  for (const k of Object.keys(AJUSTES_BASE)) if (k in nuevos) permitidos[k] = nuevos[k];
  const final = Object.assign(actuales, permitidos);
  final.cedula = String(final.cedula || '').replace(/\D/g, '');
  final.sucursal = String(final.sucursal || '1').replace(/\D/g, '').padStart(3, '0').slice(-3);
  final.terminal = String(final.terminal || '1').replace(/\D/g, '').padStart(5, '0').slice(-5);
  escribirConfig('ajustes', final);
  registrar('ajustes', 'Ajustes actualizados');
  return final;
}

/* ---------- bitácora ---------- */
function registrar(accion, detalle) {
  obtener().prepare('INSERT INTO bitacora(fecha, accion, detalle) VALUES(?, ?, ?)')
    .run(fechaLocal(), accion, typeof detalle === 'string' ? detalle : JSON.stringify(detalle || ''));
}

function leerBitacora(limite = 200) {
  return obtener().prepare('SELECT * FROM bitacora ORDER BY id DESC LIMIT ?').all(limite);
}

/* ---------- integridad ---------- */
/**
 * Revisa la base completa:
 *  - integrity_check: el archivo no está dañado
 *  - foreign_key_check: no hay registros huérfanos
 *  - stock: el stock de cada producto coincide con la suma de su kárdex
 *  - consecutivos: no faltan números
 */
function verificarIntegridad() {
  const d = obtener();
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
  return { ok: problemas.length === 0, problemas, revisado: fechaLocal() };
}

/** Si el stock guardado no coincide con el kárdex, lo corrige (el kárdex manda). */
function repararStock() {
  const suma = '(SELECT coalesce(sum(m.cantidad), 0) FROM movimientos m WHERE m.producto_id = productos.id)';
  const r = obtener().prepare(`UPDATE productos SET stock = round(${suma}, 3) WHERE abs(stock - ${suma}) > 0.0005`).run();
  if (r.changes) registrar('stock_reparado', { productos: r.changes });
  return r.changes;
}

module.exports = {
  NOMBRE_ARCHIVO, AJUSTES_BASE, abrir, configurar, obtener, rutaArchivo, cerrar,
  leerConfig, escribirConfig, leerAjustes, guardarAjustes, registrar, leerBitacora, verificarIntegridad, repararStock
};
