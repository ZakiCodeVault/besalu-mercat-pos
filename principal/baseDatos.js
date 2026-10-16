/**
 * baseDatos.js — Capa de datos local (SQLite).
 *
 * El archivo vive en la carpeta de datos del usuario de Windows:
 *   %APPDATA%\Besalu Mercat POS\besalu.sqlite
 * (nunca en la carpeta de instalación, así sobrevive a reinstalaciones y updates).
 *
 * Rendimiento: cada operación escribe SOLO lo que cambió (una venta, un
 * producto, una clave de configuración). Nunca se reescribe toda la base.
 */
const path = require('path');
const { Database } = require('node-sqlite3-wasm');

let db = null;

function abrir(carpetaDatos) {
  db = new Database(path.join(carpetaDatos, 'besalu.sqlite'));
  // Modo de diario por defecto (DELETE) + synchronous FULL: lo más seguro ante apagones.
  db.run(`CREATE TABLE IF NOT EXISTS productos(
    cod TEXT PRIMARY KEY, id INTEGER, nom TEXT, iva INTEGER, precio REAL, costo REAL,
    base REAL, imp REAL, envio REAL, margen REAL, stock REAL, vence TEXT, cabys TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS ventas(
    folio INTEGER PRIMARY KEY, cons TEXT, ts INTEGER, metodo TEXT, total REAL, base REAL,
    imp REAL, pago REAL, cambio REAL, anulada INTEGER, cli_nombre TEXT, cli_cedula TEXT,
    por_tarifa TEXT, items TEXT)`);
  db.run('CREATE INDEX IF NOT EXISTS ventas_ts ON ventas(ts)');
  db.run('CREATE TABLE IF NOT EXISTS config(clave TEXT PRIMARY KEY, valor TEXT)');
  return path.join(carpetaDatos, 'besalu.sqlite');
}

/* ---------- configuración (clave -> JSON) ---------- */
function leerConfig(clave, porDefecto) {
  const fila = db.get('SELECT valor FROM config WHERE clave = ?', [clave]);
  if (!fila) return porDefecto;
  try { return JSON.parse(fila.valor); } catch (e) { return porDefecto; }
}
function escribirConfig(clave, valor) {
  db.run('INSERT OR REPLACE INTO config(clave, valor) VALUES(?, ?)', [clave, JSON.stringify(valor)]);
}

/* ---------- conversión fila <-> objeto ---------- */
function filaAProducto(p) {
  return {
    id: p.id, cod: p.cod, nom: p.nom, iva: p.iva, precio: p.precio, costo: p.costo,
    base: p.base, imp: p.imp, envio: p.envio, margen: p.margen, stock: p.stock,
    vence: p.vence || '', cabys: p.cabys || ''
  };
}
function filaAVenta(v) {
  return {
    folio: v.folio, cons: v.cons, ts: v.ts, metodo: v.metodo, total: v.total, base: v.base,
    imp: v.imp, pago: v.pago, cambio: v.cambio, anulada: !!v.anulada,
    cliente: v.cli_nombre ? { nombre: v.cli_nombre, cedula: v.cli_cedula || '' } : null,
    byRate: v.por_tarifa ? JSON.parse(v.por_tarifa) : {},
    items: v.items ? JSON.parse(v.items) : []
  };
}
const nulo = (x) => (x === undefined || x === null ? null : x);

/* ---------- lectura completa (solo al abrir la app) ---------- */
function cargar() {
  return {
    products: db.all('SELECT * FROM productos ORDER BY nom').map(filaAProducto),
    sales: db.all('SELECT * FROM ventas ORDER BY ts').map(filaAVenta),
    settings: leerConfig('ajustes', null),
    shift: leerConfig('turno', { open: false }),
    archivo: leerConfig('cierres', []),
    seq: leerConfig('consecutivo', { folio: 1042 })
  };
}

/* ---------- escrituras puntuales ---------- */
function guardarProducto(p) {
  db.run(`INSERT OR REPLACE INTO productos(cod,id,nom,iva,precio,costo,base,imp,envio,margen,stock,vence,cabys)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [p.cod, p.id || 0, p.nom || '', p.iva || 0, p.precio || 0, p.costo || 0,
     nulo(p.base), nulo(p.imp), nulo(p.envio), nulo(p.margen), p.stock || 0, p.vence || '', p.cabys || '']);
}
function borrarProducto(cod) {
  db.run('DELETE FROM productos WHERE cod = ?', [cod]);
}
function agregarVenta(v) {
  db.run(`INSERT OR REPLACE INTO ventas(folio,cons,ts,metodo,total,base,imp,pago,cambio,anulada,cli_nombre,cli_cedula,por_tarifa,items)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [v.folio, v.cons || '', v.ts || 0, v.metodo || '', v.total || 0, v.base || 0, v.imp || 0,
     v.pago || 0, v.cambio || 0, v.anulada ? 1 : 0,
     v.cliente ? v.cliente.nombre : null, v.cliente ? (v.cliente.cedula || '') : null,
     JSON.stringify(v.byRate || {}), JSON.stringify(v.items || [])]);
}
function anularVenta(folio) {
  db.run('UPDATE ventas SET anulada = 1 WHERE folio = ?', [folio]);
}

/**
 * Guarda una venta completa de forma atómica: la venta, el stock de los
 * productos vendidos y el consecutivo. Si algo falla, no queda nada a medias.
 */
function registrarVenta(venta, productos, consecutivo) {
  db.run('BEGIN');
  try {
    agregarVenta(venta);
    for (const p of productos) guardarProducto(p);
    escribirConfig('consecutivo', consecutivo);
    db.run('COMMIT');
  } catch (e) { db.run('ROLLBACK'); throw e; }
}

/** Anula una venta y devuelve el stock, todo junto. */
function registrarAnulacion(folio, productos) {
  db.run('BEGIN');
  try {
    anularVenta(folio);
    for (const p of productos) guardarProducto(p);
    db.run('COMMIT');
  } catch (e) { db.run('ROLLBACK'); throw e; }
}

/** Borra todo (botón "Reiniciar datos" en Ajustes). */
function reiniciar() {
  db.run('BEGIN');
  try {
    db.run('DELETE FROM productos');
    db.run('DELETE FROM ventas');
    db.run('DELETE FROM config');
    db.run('COMMIT');
  } catch (e) { db.run('ROLLBACK'); throw e; }
}

function cerrar() { try { if (db) db.close(); } catch (e) {} db = null; }

module.exports = {
  abrir, cerrar, cargar, leerConfig, escribirConfig,
  guardarProducto, borrarProducto, registrarVenta, registrarAnulacion, reiniciar
};
