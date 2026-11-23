/**
 * sesion.js — Quién está usando la app en este momento.
 *
 * El proceso principal la fija al ingresar (PIN) y la borra al bloquear.
 * La capa de datos la lee para dejar constancia de quién hizo cada cosa
 * (comprobantes, compras, ajustes de inventario, turnos y bitácora).
 * Las pruebas de datos no la usan: sin sesión, lo hecho queda sin usuario.
 */
let actual = null;          // { id, nombre, rol }
let autorizacion = null;    // { permiso, usuario, hasta } dada por un encargado para UNA acción
let autorizadoEnCurso = null;

function iniciar(u) { actual = u ? { id: u.id, nombre: u.nombre, rol: u.rol } : null; autorizacion = null; }
function cerrar() { actual = null; autorizacion = null; autorizadoEnCurso = null; }
const usuario = () => actual;
const usuarioId = () => (actual ? actual.id : null);

/** Un encargado o administrador autoriza UNA acción del usuario actual (vale 2 minutos). */
function autorizar(u, permiso) { autorizacion = { permiso, usuario: { id: u.id, nombre: u.nombre, rol: u.rol }, hasta: Date.now() + 120000 }; }
function tomarAutorizacion(permiso) {
  if (!autorizacion || autorizacion.permiso !== permiso || autorizacion.hasta < Date.now()) return null;
  const a = autorizacion.usuario;
  autorizacion = null;
  return a;
}
/** Mientras corre la acción autorizada, quién la autorizó (queda en el comprobante y la bitácora). */
function conAutorizado(u, fn) {
  autorizadoEnCurso = u;
  const fin = () => { autorizadoEnCurso = null; };
  try { const r = fn(); if (r && typeof r.then === 'function') return r.finally(fin); fin(); return r; } catch (e) { fin(); throw e; }
}
const autorizadoPor = () => autorizadoEnCurso;

module.exports = { iniciar, cerrar, usuario, usuarioId, autorizar, tomarAutorizacion, conAutorizado, autorizadoPor };
