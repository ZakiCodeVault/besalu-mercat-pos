/**
 * conexion.js — Abre la base de datos SQLite con las protecciones activas.
 *
 *   journal_mode = WAL     -> escrituras seguras y lecturas sin bloquear
 *   synchronous  = FULL    -> cada venta queda en disco antes de confirmarse
 *                             (lo más seguro ante un apagón)
 *   foreign_keys = ON      -> no puede haber líneas o movimientos huérfanos
 */
const path = require('path');
const crypto = require('crypto');
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
  direccion: '',              // otras señas (obligatorio para Hacienda)
  provincia: '',              // 1 a 7
  canton: '',                 // 2 dígitos
  distrito: '',               // 2 dígitos
  barrio: '',
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
  try {
    configurar(db);
    migrar();
  } catch (e) {
    try { db.close(); } catch (x) {}
    db = null;
    throw e;
  }
  return ruta;
}

function configurar(conexion) {
  conexion.pragma('journal_mode = WAL');
  conexion.pragma('synchronous = FULL');
  conexion.pragma('foreign_keys = ON');
  conexion.pragma('busy_timeout = 5000');
}

/**
 * Huella de los datos: por cada tabla, cuántas filas tiene y un resumen
 * (SHA-256) de todas sus filas y columnas. Sirve para comprobar que una
 * actualización del esquema no perdió ni cambió ningún dato existente.
 * @param {object} [soloDe] huella anterior: compara solo esas tablas y columnas
 * @param {object} [o] { soloLasQueHabia: true } cuenta solo las primeras filas que tenía cada tabla
 *   (las que se agregaron después, como la anotación de la migración en la bitácora, no cuentan)
 */
function huellaDatos(conexion, soloDe, o = {}) {
  const tablas = soloDe ? Object.keys(soloDe)
    : conexion.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((t) => t.name);
  const salida = {};
  for (const t of tablas) {
    const columnas = soloDe ? soloDe[t].columnas : conexion.prepare(`SELECT name FROM pragma_table_info('${t.replace(/'/g, "''")}')`).all().map((c) => c.name);
    const lista = columnas.map((c) => '"' + c.replace(/"/g, '""') + '"').join(', ');
    const h = crypto.createHash('sha256');
    let filas = 0;
    const limite = o.soloLasQueHabia && soloDe ? ' LIMIT ' + Number(soloDe[t].filas) : '';
    for (const f of conexion.prepare(`SELECT ${lista} FROM "${t}" ORDER BY rowid${limite}`).raw().iterate()) {
      h.update(JSON.stringify(f, (k, v) => (Buffer.isBuffer(v) ? 'b:' + v.toString('base64') : typeof v === 'bigint' ? String(v) : v)));
      h.update('\n');
      filas++;
    }
    salida[t] = { columnas, filas, huella: h.digest('hex') };
  }
  return salida;
}

/** Error al actualizar el esquema: los datos quedaron como estaban (nunca se ofrece reemplazarlos por un respaldo). */
function errorDeMigracion(mensaje, copia) {
  const e = new Error(mensaje);
  e.codigo = 'MIGRACION';
  e.copia = copia || null;
  return e;
}

/**
 * Actualiza el esquema de una base con datos sin arriesgar nada:
 *  1. Copia completa al lado (antes-de-migrar-vN-…) y se verifica que la copia
 *     abre, está sana y tiene las mismas filas que la base.
 *  2. Todas las actualizaciones pendientes van en UNA sola transacción.
 *  3. Antes de confirmarla se comprueba, tabla por tabla y columna por columna,
 *     que ningún dato que ya existía se perdió o cambió, y que la base sigue
 *     sana. Si algo no cuadra, se deshace todo y la base queda como estaba.
 */
function migrar() {
  const actual = db.pragma('user_version', { simple: true });
  if (actual > MIGRACIONES.length) throw errorDeMigracion('Esta base de datos es de una versión más nueva de la app (' + actual + '). Instale la versión más reciente.');
  if (actual === MIGRACIONES.length) return;
  let copia = null, antes = null;
  if (actual > 0) {
    antes = huellaDatos(db);
    copia = path.join(path.dirname(ruta), 'antes-de-migrar-v' + actual + '-' + fechaLocal().replace(/[: ]/g, '-') + '.sqlite');
    try {
      db.prepare('VACUUM INTO ?').run(copia);
      const c = new Database(copia, { readonly: true, fileMustExist: true });
      try {
        if (c.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('la copia no quedó sana');
        const h = huellaDatos(c, antes);
        for (const t of Object.keys(antes)) if (h[t].huella !== antes[t].huella) throw new Error('la copia de la tabla ' + t + ' no es idéntica');
      } finally { c.close(); }
    } catch (e) {
      throw errorDeMigracion('No se pudo hacer la copia de seguridad antes de actualizar la base (' + e.message + '). No se cambió nada: revise el espacio en disco.', copia);
    }
  }
  try {
    db.transaction(() => {
      for (let v = actual; v < MIGRACIONES.length; v++) db.exec(MIGRACIONES[v]);
      db.pragma('user_version = ' + MIGRACIONES.length);
      if (antes) {
        const despues = huellaDatos(db, antes);
        for (const t of Object.keys(antes)) {
          if (despues[t].filas !== antes[t].filas) throw new Error('la tabla ' + t + ' tenía ' + antes[t].filas + ' filas y quedaría con ' + despues[t].filas);
          if (despues[t].huella !== antes[t].huella) throw new Error('cambiarían datos de la tabla ' + t);
        }
        if (db.pragma('foreign_key_check').length) throw new Error('quedarían registros huérfanos');
      }
    })();
  } catch (e) {
    throw errorDeMigracion('No se pudo actualizar la base de datos a esta versión: ' + e.message + '. Sus datos quedaron exactamente como estaban.', copia);
  }
  for (let v = actual; v < MIGRACIONES.length; v++) registrar('migracion', 'Esquema actualizado a la versión ' + (v + 1));
  if (copia) registrar('migracion_verificada', { desde: actual, hasta: MIGRACIONES.length, copia: path.basename(copia), tablas: Object.keys(antes).length });
}

function obtener() {
  if (!db) throw new Error('La base de datos no está abierta');
  return db;
}

function rutaArchivo() { return ruta; }

function cerrar() {
  if (db) {
    try { db.pragma('optimize'); } catch (e) {}                 // estadísticas al día para que las consultas sigan rápidas
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
  final.actividadEconomica = String(final.actividadEconomica || '').trim();
  for (const k of ['provincia', 'canton', 'distrito']) final[k] = String(final[k] || '').replace(/\D/g, '');
  final.sucursal = String(final.sucursal || '1').replace(/\D/g, '').padStart(3, '0').slice(-3);
  final.terminal = String(final.terminal || '1').replace(/\D/g, '').padStart(5, '0').slice(-5);
  escribirConfig('ajustes', final);
  registrar('ajustes', 'Ajustes actualizados');
  return final;
}

/* ---------- bitácora ---------- */
function registrar(accion, detalle) {
  // Quién lo hizo (y quién lo autorizó, si fue con el PIN de un encargado)
  const sesion = require('./sesion');
  const u = sesion.usuario(), aut = sesion.autorizadoPor();
  const quien = u ? u.nombre + (aut ? ' (autorizó ' + aut.nombre + ')' : '') : '';
  obtener().prepare('INSERT INTO bitacora(fecha, accion, detalle, usuario) VALUES(?, ?, ?, ?)')
    .run(fechaLocal(), accion, typeof detalle === 'string' ? detalle : JSON.stringify(detalle || ''), quien);
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
  return require('./revision').revisar(obtener(), fechaLocal());
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
  leerConfig, escribirConfig, leerAjustes, guardarAjustes, registrar, leerBitacora, verificarIntegridad, repararStock, huellaDatos
};
