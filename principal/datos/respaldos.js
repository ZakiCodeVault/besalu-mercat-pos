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

module.exports = { configurar, carpetaRespaldos, verificarArchivo, crear, siCorresponde, listar, restaurar };
