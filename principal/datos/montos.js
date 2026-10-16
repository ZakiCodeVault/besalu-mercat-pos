/**
 * montos.js — Cálculos fiscales y numeración de comprobantes.
 *
 * Todos los montos son ENTEROS en céntimos (₡1 = 100). Así las sumas cuadran
 * exactamente y no hay errores de redondeo en el IVA.
 */
const crypto = require('crypto');

const TARIFAS_IVA = [0, 0.5, 1, 2, 4, 8, 13];

/** ₡ (número, puede traer decimales) -> céntimos enteros. */
function aCentimos(colones) {
  const n = Number(colones);
  if (!Number.isFinite(n)) throw new Error('Monto inválido: ' + colones);
  return Math.round(n * 100);
}

function validarTarifa(t) {
  const n = Number(t);
  if (!TARIFAS_IVA.includes(n)) throw new Error('Tarifa de IVA inválida: ' + t);
  return n;
}

function validarCantidad(c) {
  const n = Math.round(Number(c) * 1000) / 1000;
  if (!Number.isFinite(n) || n <= 0) throw new Error('Cantidad inválida: ' + c);
  return n;
}

/**
 * Línea de VENTA. El precio del producto ya incluye IVA (precio de góndola).
 * El total de la línea es exactamente lo que paga el cliente; de ahí se separa
 * la base y el impuesto.
 */
function lineaVenta(precioConIva, cantidad, tarifa) {
  const total = Math.round(precioConIva * cantidad);
  const base = Math.round(total / (1 + tarifa / 100));
  const precioUnitario = Math.round(precioConIva / (1 + tarifa / 100));
  return { precio_unitario: precioUnitario, subtotal: base, impuesto: total - base, total_linea: total };
}

/** Línea de COMPRA. El costo del proveedor viene SIN IVA. */
function lineaCompra(costoSinIva, cantidad, tarifa) {
  const base = Math.round(costoSinIva * cantidad);
  const impuesto = Math.round(base * tarifa / 100);
  return { subtotal: base, impuesto, total_linea: base + impuesto };
}

/**
 * Consecutivo de 20 dígitos (estructura de Hacienda):
 *   sucursal (3) + terminal (5) + tipo de comprobante (2) + número (10)
 */
function consecutivo(sucursal, terminal, tipo, numero) {
  const s = String(sucursal || '1').replace(/\D/g, '').padStart(3, '0').slice(-3);
  const t = String(terminal || '1').replace(/\D/g, '').padStart(5, '0').slice(-5);
  const n = String(numero).padStart(10, '0');
  if (n.length > 10) throw new Error('Se agotó la numeración del consecutivo');
  return s + t + tipo + n;
}

/**
 * Clave numérica de 50 dígitos (estructura de Hacienda):
 *   país 506 (3) + día (2) + mes (2) + año (2) + cédula del emisor (12)
 *   + consecutivo (20) + situación (1) + código de seguridad (8)
 * Situación: 1 normal, 2 contingencia, 3 sin internet.
 */
function clave(fecha, cedulaEmisor, consecutivo20, situacion = '1') {
  const cedula = String(cedulaEmisor || '').replace(/\D/g, '');
  if (cedula.length < 9 || cedula.length > 12) {
    throw new Error('Configure la cédula del negocio (Ajustes) antes de emitir comprobantes');
  }
  const dd = String(fecha.getDate()).padStart(2, '0');
  const mm = String(fecha.getMonth() + 1).padStart(2, '0');
  const aa = String(fecha.getFullYear()).slice(-2);
  const seguridad = String(crypto.randomInt(0, 100000000)).padStart(8, '0');
  const k = '506' + dd + mm + aa + cedula.padStart(12, '0') + consecutivo20 + situacion + seguridad;
  if (k.length !== 50) throw new Error('No se pudo generar la clave del comprobante');
  return k;
}

/** Fecha ISO 8601 con la zona horaria del equipo (Costa Rica: -06:00). */
function fechaIso(d = new Date()) {
  const p = (x) => String(x).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const signo = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' +
    p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) +
    signo + p(Math.floor(a / 60)) + ':' + p(a % 60);
}

/** Fecha y hora local "AAAA-MM-DD HH:MM:SS" (para bitácora y turnos). */
function fechaLocal(d = new Date()) {
  return fechaIso(d).slice(0, 19).replace('T', ' ');
}

module.exports = {
  TARIFAS_IVA, aCentimos, validarTarifa, validarCantidad,
  lineaVenta, lineaCompra, consecutivo, clave, fechaIso, fechaLocal
};
