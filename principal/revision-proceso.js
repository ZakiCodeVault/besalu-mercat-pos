/**
 * revision-proceso.js — Revisa la base en un proceso aparte (utilityProcess).
 *
 * Abre su propia conexión de SOLO LECTURA (no puede cambiar nada), hace la
 * revisión completa y devuelve el resultado al proceso principal.
 */
const Database = require('better-sqlite3');
const { revisar } = require('./datos/revision');

process.parentPort.once('message', (e) => {
  const { ruta, fecha } = e.data || {};
  let d = null;
  try {
    d = new Database(ruta, { readonly: true, fileMustExist: true });
    d.pragma('busy_timeout = 5000');
    process.parentPort.postMessage({ ok: true, resultado: revisar(d, fecha) });
  } catch (err) {
    process.parentPort.postMessage({ ok: false, error: String((err && err.message) || err) });
  } finally {
    try { if (d) d.close(); } catch (x) {}
    process.exit(0);
  }
});
