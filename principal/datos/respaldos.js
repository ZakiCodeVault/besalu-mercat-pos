/**
 * respaldos.js — Copias de seguridad de la base de datos.
 *
 *  - Se hacen "en caliente" (sin cerrar la app) con la API de respaldo de SQLite.
 *  - Cada copia se VERIFICA abriéndola (integrity_check). Si sale dañada, se descarta.
 *  - Automático: una vez al día y al cerrar caja. Manual: Ajustes → Respaldar ahora.
 *  - Se guardan las últimas 60 en %APPDATA%\Besalu Mercat POS\respaldos
 *    y, si se configura, también se copian a otra carpeta (USB, OneDrive...).
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const conexion = require('./conexion');
const { fechaLocal } = require('./montos');

const MAXIMO = 60;
let carpeta = null;

function configurar(carpetaDatos) {
  carpeta = path.join(carpetaDatos, 'respaldos');
  fs.mkdirSync(carpeta, { recursive: true });
  return carpeta;
}

function carpetaRespaldos() { return carpeta; }

/** Abre una copia en modo lectura y revisa que esté sana. */
function verificarArchivo(ruta) {
  const db = new Database(ruta, { readonly: true, fileMustExist: true });
  try {
    const integridad = db.pragma('integrity_check', { simple: true });
    return {
      ok: integridad === 'ok', detalle: integridad,
      version: db.pragma('user_version', { simple: true }),
      comprobantes: db.prepare('SELECT count(*) AS n FROM comprobantes').get().n,
      productos: db.prepare('SELECT count(*) AS n FROM productos').get().n
    };
  } finally { db.close(); }
}

async function crear(motivo = 'manual') {
  if (!carpeta) throw new Error('Respaldos sin configurar');
  const etiqueta = String(motivo).replace(/[^a-z0-9-]/gi, '').slice(0, 30) || 'manual';
  const nombre = 'besalu-' + fechaLocal().replace(/[: ]/g, '-') + '-' + etiqueta + '.sqlite';
  const destino = path.join(carpeta, nombre);
  await conexion.obtener().backup(destino);
  const v = verificarArchivo(destino);
  if (!v.ok) { fs.rmSync(destino, { force: true }); throw new Error('El respaldo salió dañado: ' + v.detalle); }

  let extra = null;
  const carpetaExtra = conexion.leerAjustes().carpetaRespaldoExtra;
  if (carpetaExtra) {
    try { fs.mkdirSync(carpetaExtra, { recursive: true }); extra = path.join(carpetaExtra, nombre); fs.copyFileSync(destino, extra); }
    catch (e) { extra = null; conexion.registrar('respaldo_extra_fallo', { carpeta: carpetaExtra, error: e.message }); }
  }
  podar();
  conexion.escribirConfig('ultimo_respaldo', { fecha: fechaLocal(), archivo: nombre });
  conexion.registrar('respaldo', { archivo: nombre, motivo: etiqueta, extra });
  return { archivo: nombre, ruta: destino, bytes: fs.statSync(destino).size, extra, comprobantes: v.comprobantes };
}

/** Respaldo diario: solo si el último tiene más de 20 horas. */
async function siCorresponde() {
  const ultimo = conexion.leerConfig('ultimo_respaldo', null);
  if (ultimo && Date.now() - new Date(ultimo.fecha.replace(' ', 'T')).getTime() < 20 * 3600 * 1000) return null;
  return crear('diario');
}

function listar() {
  if (!carpeta) return [];
  return fs.readdirSync(carpeta)
    .filter((f) => /^besalu-.*\.sqlite$/.test(f))
    .map((f) => { const s = fs.statSync(path.join(carpeta, f)); return { archivo: f, bytes: s.size, fecha: s.mtime.toISOString() }; })
    .sort((a, b) => b.archivo.localeCompare(a.archivo));
}

function podar() {
  const todos = listar();
  for (const f of todos.slice(MAXIMO)) fs.rmSync(path.join(carpeta, f.archivo), { force: true });
}

/**
 * Restaura un respaldo. Antes guarda una copia del estado actual
 * ("antes-de-restaurar") por si hay que volver atrás.
 */
async function restaurar(nombreOruta) {
  let origen = path.isAbsolute(nombreOruta) ? nombreOruta : path.join(carpeta, path.basename(nombreOruta));
  if (!fs.existsSync(origen)) throw new Error('No se encontró el respaldo');
  const v = verificarArchivo(origen);
  if (!v.ok) throw new Error('Ese respaldo está dañado y no se puede restaurar');
  if (path.dirname(origen) !== carpeta) {   // viene de afuera (USB): se copia primero
    const copia = path.join(carpeta, 'besalu-' + fechaLocal().replace(/[: ]/g, '-') + '-importado.sqlite');
    fs.copyFileSync(origen, copia);
    origen = copia;
  }
  await crear('antes-de-restaurar');
  const actual = conexion.rutaArchivo();
  const carpetaDatos = path.dirname(actual);
  conexion.cerrar();
  for (const sufijo of ['-wal', '-shm']) fs.rmSync(actual + sufijo, { force: true });
  fs.copyFileSync(origen, actual);
  conexion.abrir(carpetaDatos);
  conexion.registrar('restauracion', { desde: path.basename(origen), comprobantes: v.comprobantes });
  return { ok: true, comprobantes: v.comprobantes, productos: v.productos };
}

/**
 * Empieza una base nueva (p. ej. al pasar de las pruebas con Hacienda a la
 * facturación real). La base actual se guarda completa en la carpeta de
 * respaldos como "archivo-<motivo>-<fecha>.sqlite" (no se borra nunca) y la
 * nueva arranca sin comprobantes ni compras, con los mismos ajustes, productos
 * (su existencia actual pasa a ser el inventario inicial), clientes y proveedores.
 */
async function empezarBaseNueva(motivo = 'pruebas') {
  if (!carpeta) throw new Error('Respaldos sin configurar');
  const d = conexion.obtener();
  const ajustes = conexion.leerAjustes();
  const productos = d.prepare('SELECT * FROM productos WHERE activo = 1 ORDER BY id').all();
  const clientes = d.prepare('SELECT tipo_id, identificacion, nombre, correo, telefono FROM clientes').all();
  const proveedores = d.prepare('SELECT tipo_id, identificacion, nombre, correo, telefono FROM proveedores').all();
  const comprobantes = d.prepare('SELECT count(*) AS n FROM comprobantes').get().n;

  const archivo = path.join(carpeta, 'archivo-' + String(motivo).replace(/[^a-z0-9-]/gi, '') + '-' + fechaLocal().replace(/[: ]/g, '-') + '.sqlite');
  await d.backup(archivo);
  const v = verificarArchivo(archivo);
  if (!v.ok) { fs.rmSync(archivo, { force: true }); throw new Error('No se pudo archivar la base actual: ' + v.detalle); }

  const actual = conexion.rutaArchivo();
  conexion.cerrar();
  for (const sufijo of ['', '-wal', '-shm']) fs.rmSync(actual + sufijo, { force: true });
  conexion.abrir(path.dirname(actual));

  const nueva = conexion.obtener();
  const productosMod = require('./productos');
  nueva.transaction(() => {
    conexion.guardarAjustes(ajustes);
    for (const p of productos) {
      productosMod.crear({ codigo: p.codigo, nombre: p.nombre, cabys: p.cabys, unidad: p.unidad, tarifa_iva: p.tarifa_iva,
        precio: p.precio, costo: p.costo, stock_minimo: p.stock_minimo, vence: p.vence, stock_inicial: Math.max(0, p.stock) }, { conBitacora: false });
    }
    const insC = nueva.prepare('INSERT INTO clientes(tipo_id, identificacion, nombre, correo, telefono) VALUES(@tipo_id, @identificacion, @nombre, @correo, @telefono)');
    for (const c of clientes) insC.run(c);
    const insP = nueva.prepare('INSERT INTO proveedores(tipo_id, identificacion, nombre, correo, telefono) VALUES(@tipo_id, @identificacion, @nombre, @correo, @telefono)');
    for (const p of proveedores) insP.run(p);
    conexion.registrar('base_nueva', { motivo, archivo: path.basename(archivo), comprobantes_archivados: comprobantes, productos: productos.length });
  })();
  return { archivo, productos: productos.length, comprobantesArchivados: comprobantes };
}

module.exports = { configurar, carpetaRespaldos, verificarArchivo, crear, siCorresponde, listar, restaurar, empezarBaseNueva };
