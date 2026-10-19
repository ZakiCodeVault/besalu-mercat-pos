/**
 * credenciales.js — Usuario y contraseña de la API, llave criptográfica (.p12)
 * y su PIN.
 *
 * Los secretos se guardan cifrados con el cifrado del sistema operativo
 * (en Windows, DPAPI de la cuenta del usuario, mediante safeStorage de
 * Electron). En la base solo queda texto cifrado: si alguien copia el archivo
 * a otra computadora, no puede leerlos. Nunca se escriben en la bitácora ni en
 * el registro de errores.
 */
const { leerConfig, escribirConfig, registrar } = require('../datos/conexion');

const CLAVE = 'hacienda';
let cifrador = null;   // { disponible(), cifrar(texto) → base64, descifrar(base64) → texto }

function configurar(c) { cifrador = c; }

function guardado() { return leerConfig(CLAVE, null) || {}; }

/** Datos visibles (sin secretos). */
function leer() {
  const g = guardado();
  return {
    activo: !!g.activo,
    ambiente: g.ambiente || 'pruebas',
    usuario: g.usuario || '',
    tieneContrasena: !!g.contrasena,
    tieneLlave: !!(g.llave && g.pin),
    certificado: g.certificado || null,
    actualizado: g.actualizado || null
  };
}

function exigirCifrador() {
  if (!cifrador || !cifrador.disponible()) throw new Error('Esta computadora no permite guardar credenciales cifradas');
}

/** Secretos descifrados (solo en memoria del proceso principal). */
function secretos() {
  const g = guardado();
  if (!g.contrasena || !g.llave || !g.pin) return null;
  exigirCifrador();
  try {
    return {
      contrasena: cifrador.descifrar(g.contrasena),
      p12: Buffer.from(cifrador.descifrar(g.llave), 'base64'),
      pin: cifrador.descifrar(g.pin)
    };
  } catch (e) {
    throw new Error('No se pudieron leer las credenciales de Hacienda en esta computadora: vuelva a ingresarlas en Ajustes');
  }
}

/**
 * Guarda cambios. Los secretos que vengan vacíos se conservan.
 * @param {object} c { activo, ambiente, usuario, contrasena?, p12? (Buffer), pin?, certificado? }
 */
function guardar(c) {
  const g = guardado();
  if (c.contrasena || c.p12 || c.pin) exigirCifrador();
  const nuevo = Object.assign({}, g, {
    activo: c.activo !== undefined ? !!c.activo : !!g.activo,
    ambiente: c.ambiente || g.ambiente || 'pruebas',
    usuario: c.usuario !== undefined ? String(c.usuario).trim() : (g.usuario || ''),
    actualizado: new Date().toISOString()
  });
  if (c.contrasena) nuevo.contrasena = cifrador.cifrar(String(c.contrasena));
  if (c.p12) nuevo.llave = cifrador.cifrar(Buffer.from(c.p12).toString('base64'));
  if (c.pin) nuevo.pin = cifrador.cifrar(String(c.pin));
  if (c.certificado) nuevo.certificado = c.certificado;
  escribirConfig(CLAVE, nuevo);
  registrar('hacienda_configuracion', { activo: nuevo.activo, ambiente: nuevo.ambiente, usuario: nuevo.usuario,
    contrasena: c.contrasena ? 'cambiada' : 'sin cambios', llave: c.p12 ? 'cambiada' : 'sin cambios' });
  return leer();
}

module.exports = { configurar, leer, secretos, guardar };
