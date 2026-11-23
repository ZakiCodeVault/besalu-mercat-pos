/**
 * usuarios.js — Usuarios de la app, su rol y su PIN.
 *
 *  - Roles: admin (todo), encargado (operación completa, sin ajustes ni
 *    usuarios) y cajero/vendedor (vender, relevo de caja y etiquetas).
 *  - El administrador crea el perfil (nombre, correo, rol). La PRIMERA vez
 *    que esa persona ingresa, crea su propio PIN: nadie más lo conoce.
 *    Si lo olvida, un administrador lo reinicia y la persona crea otro.
 *  - El PIN (4 a 8 números) se guarda solo como hash scrypt con sal propia;
 *    dos usuarios activos no pueden tener el mismo PIN (el PIN también sirve
 *    para autorizar una acción de un vendedor).
 *  - 5 intentos fallidos bloquean ese usuario 60 segundos.
 *  - Siempre queda al menos un administrador activo.
 *  - Al crear el primer administrador se genera un código de recuperación
 *    (solo se guarda su hash) para poner un PIN nuevo si se olvida.
 */
const crypto = require('crypto');
const { obtener, registrar, leerConfig, escribirConfig } = require('./conexion');
const { fechaLocal } = require('./montos');

const ROLES = { admin: 'Administrador', encargado: 'Encargado', cajero: 'Vendedor' };
const PERMISOS = {
  admin: ['vender', 'devolver', 'relevo', 'cerrar_caja', 'compras', 'inventario', 'etiquetas', 'reportes', 'ajustes', 'usuarios'],
  encargado: ['vender', 'devolver', 'relevo', 'cerrar_caja', 'compras', 'inventario', 'etiquetas', 'reportes'],
  cajero: ['vender', 'relevo', 'etiquetas']
};
const NOMBRE_PERMISO = {
  vender: 'vender', devolver: 'hacer devoluciones y reemitir comprobantes', relevo: 'hacer el relevo de caja', cerrar_caja: 'cerrar la caja',
  compras: 'registrar compras, órdenes y proveedores', inventario: 'cambiar productos e inventario', etiquetas: 'imprimir etiquetas',
  reportes: 'ver reportes y exportar', ajustes: 'cambiar los ajustes', usuarios: 'administrar usuarios'
};
const puede = (rol, permiso) => (PERMISOS[rol] || []).includes(permiso);

const INTENTOS = 5, BLOQUEO_MS = 60000;
const fallos = new Map();   // usuario → { n, hasta }

function hashPin(pin, sal) {
  return crypto.scryptSync(String(pin), Buffer.from(sal, 'hex'), 32, { N: 8192, r: 8, p: 1 }).toString('hex');
}
function iguales(a, b) {
  const x = Buffer.from(String(a || ''), 'hex'), y = Buffer.from(String(b || ''), 'hex');
  return x.length === 32 && x.length === y.length && crypto.timingSafeEqual(x, y);
}
function validarPin(pin) {
  const p = String(pin == null ? '' : pin);
  if (!/^\d{4,8}$/.test(p)) throw new Error('El PIN es de 4 a 8 números');
  if (/^(\d)\1+$/.test(p)) throw new Error('El PIN no puede ser el mismo número repetido');
  if ('0123456789'.includes(p) || '9876543210'.includes(p)) throw new Error('El PIN no puede ser una serie (1234…)');
  return p;
}
function validarNombre(nombre) {
  const n = String(nombre == null ? '' : nombre).trim().replace(/\s+/g, ' ');
  if (!n) throw new Error('Escriba el nombre del usuario');
  if (n.length > 60) throw new Error('El nombre tiene máximo 60 caracteres');
  return n;
}
function validarCorreo(correo) {
  const c = String(correo == null ? '' : correo).trim().toLowerCase();
  if (c && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c)) throw new Error('El correo no es válido');
  if (c.length > 120) throw new Error('El correo es demasiado largo');
  return c;
}
function validarRol(rol) {
  if (!ROLES[rol]) throw new Error('Rol inválido');
  return rol;
}
const publico = (u) => u && { id: u.id, nombre: u.nombre, rol: u.rol, rol_nombre: ROLES[u.rol], correo: u.correo, tiene_pin: u.pin_hash ? 1 : 0,
  activo: u.activo, ultimo_ingreso: u.ultimo_ingreso, creado_en: u.creado_en };

function hayUsuarios() { return obtener().prepare('SELECT count(*) AS n FROM usuarios').get().n > 0; }

function listar({ incluirInactivos = true } = {}) {
  return obtener().prepare(`SELECT * FROM usuarios ${incluirInactivos ? '' : 'WHERE activo = 1'} ORDER BY activo DESC, nombre COLLATE NOCASE`).all().map(publico);
}
function obtenerPorId(id) { return publico(obtener().prepare('SELECT * FROM usuarios WHERE id = ?').get(id)); }

/** ¿Algún otro usuario activo ya tiene ese PIN? */
function pinOcupado(pin, exceptoId) {
  for (const u of obtener().prepare('SELECT id, pin_hash, pin_sal FROM usuarios WHERE activo = 1 AND pin_hash IS NOT NULL AND id IS NOT ?').all(exceptoId || null)) {
    if (iguales(hashPin(pin, u.pin_sal), u.pin_hash)) return true;
  }
  return false;
}

function guardarPin(id, pin) {
  const p = validarPin(pin);
  if (pinOcupado(p, id)) throw new Error('Ese PIN ya lo usa otra persona: elija otro');
  const sal = crypto.randomBytes(16).toString('hex');
  obtener().prepare('UPDATE usuarios SET pin_hash = ?, pin_sal = ?, actualizado_en = ? WHERE id = ?').run(hashPin(p, sal), sal, fechaLocal(), id);
  fallos.delete(id);
}

/** Crea el perfil. Sin PIN: la persona lo crea la primera vez que ingresa. */
function crear({ nombre, rol, correo, pin }) {
  const d = obtener();
  const n = validarNombre(nombre), r = validarRol(rol), c = validarCorreo(correo);
  if (d.prepare('SELECT id FROM usuarios WHERE nombre = ? COLLATE NOCASE').get(n)) throw new Error('Ya hay un usuario llamado ' + n);
  return d.transaction(() => {
    const id = Number(d.prepare('INSERT INTO usuarios(nombre, rol, correo, actualizado_en) VALUES(?, ?, ?, ?)').run(n, r, c, fechaLocal()).lastInsertRowid);
    if (pin != null) guardarPin(id, pin);
    registrar('usuario_creado', { id, nombre: n, rol: r });
    return obtenerPorId(id);
  })();
}

/** Código de recuperación: 12 letras y números fáciles de leer (sin O/0, I/1). */
function nuevoCodigoRecuperacion() {
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const c = Array.from(crypto.randomBytes(12), (x) => letras[x % letras.length]).join('');
  const sal = crypto.randomBytes(16).toString('hex');
  escribirConfig('recuperacion', { sal, hash: hashPin(c, sal), creado: fechaLocal() });
  return c.slice(0, 4) + '-' + c.slice(4, 8) + '-' + c.slice(8);
}

/** El primer usuario de la app: administrador con su PIN y su código de recuperación. */
function crearPrimerAdmin({ nombre, pin, correo }) {
  if (hayUsuarios()) throw new Error('Ya hay usuarios: ingrese con uno de ellos');
  validarPin(pin);
  return obtener().transaction(() => {
    const usuario = crear({ nombre, rol: 'admin', pin, correo });
    return { usuario, codigoRecuperacion: nuevoCodigoRecuperacion() };
  })();
}

function adminsActivos(exceptoId) {
  return obtener().prepare("SELECT count(*) AS n FROM usuarios WHERE rol = 'admin' AND activo = 1 AND id IS NOT ?").get(exceptoId || null).n;
}

function actualizar(id, cambios) {
  const d = obtener();
  const u = d.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
  if (!u) throw new Error('El usuario no existe');
  const nombre = cambios.nombre != null ? validarNombre(cambios.nombre) : u.nombre;
  const rol = cambios.rol != null ? validarRol(cambios.rol) : u.rol;
  const activo = cambios.activo != null ? (cambios.activo ? 1 : 0) : u.activo;
  const correo = cambios.correo != null ? validarCorreo(cambios.correo) : u.correo;
  if (u.rol === 'admin' && u.activo && (rol !== 'admin' || !activo) && !adminsActivos(u.id)) throw new Error('Tiene que quedar al menos un administrador activo');
  const otro = d.prepare('SELECT id FROM usuarios WHERE nombre = ? COLLATE NOCASE AND id <> ?').get(nombre, u.id);
  if (otro) throw new Error('Ya hay un usuario llamado ' + nombre);
  d.prepare('UPDATE usuarios SET nombre = ?, rol = ?, activo = ?, correo = ?, actualizado_en = ? WHERE id = ?').run(nombre, rol, activo, correo, fechaLocal(), u.id);
  registrar('usuario_editado', { id: u.id, nombre, rol, activo: !!activo });
  return obtenerPorId(u.id);
}

/** Un administrador borra el PIN de alguien que lo olvidó: esa persona crea uno nuevo al ingresar. */
function reiniciarPin(id) {
  const u = obtener().prepare('SELECT id, nombre FROM usuarios WHERE id = ?').get(id);
  if (!u) throw new Error('El usuario no existe');
  obtener().prepare('UPDATE usuarios SET pin_hash = NULL, pin_sal = NULL, actualizado_en = ? WHERE id = ?').run(fechaLocal(), u.id);
  fallos.delete(u.id);
  registrar('usuario_pin_reiniciado', { id: u.id, nombre: u.nombre });
  return obtenerPorId(u.id);
}

/** La persona crea su PIN la primera vez (o después de que se lo reiniciaron). */
function crearMiPin(id, pin) {
  const u = obtener().prepare('SELECT * FROM usuarios WHERE id = ? AND activo = 1').get(id);
  if (!u) throw new Error('Usuario no disponible');
  if (u.pin_hash) throw new Error('Este usuario ya tiene PIN: ingrese con él');
  guardarPin(u.id, pin);
  obtener().prepare('UPDATE usuarios SET ultimo_ingreso = ? WHERE id = ?').run(fechaLocal(), u.id);
  registrar('usuario_pin_creado', { id: u.id, nombre: u.nombre });
  return obtenerPorId(u.id);
}

/** Cambiar el propio PIN (pidiendo el actual). */
function cambiarMiPin(id, pinActual, pinNuevo) {
  verificar(id, pinActual);
  guardarPin(id, pinNuevo);
  registrar('usuario_pin_cambiado', { id });
  return true;
}

/** Ingreso: comprueba el PIN de ese usuario (con bloqueo por intentos fallidos). */
function verificar(id, pin) {
  const d = obtener();
  const u = d.prepare('SELECT * FROM usuarios WHERE id = ? AND activo = 1').get(id);
  if (!u) throw new Error('Usuario no disponible');
  if (!u.pin_hash) throw new Error(u.nombre + ' todavía no tiene PIN: créelo primero');
  const f = fallos.get(u.id);
  if (f && f.hasta > Date.now()) throw new Error('Demasiados intentos: espere ' + Math.ceil((f.hasta - Date.now()) / 1000) + ' segundos');
  if (!iguales(hashPin(String(pin || ''), u.pin_sal), u.pin_hash)) {
    const anterior = f && f.hasta && f.hasta <= Date.now() ? 0 : (f ? f.n : 0);
    const n = anterior + 1;
    fallos.set(u.id, { n, hasta: n >= INTENTOS ? Date.now() + BLOQUEO_MS : 0 });
    registrar('ingreso_fallido', { usuario: u.nombre, intento: n });
    throw new Error(n >= INTENTOS ? 'PIN incorrecto. Usuario bloqueado 60 segundos' : 'PIN incorrecto');
  }
  fallos.delete(u.id);
  d.prepare('UPDATE usuarios SET ultimo_ingreso = ? WHERE id = ?').run(fechaLocal(), u.id);
  return publico(u);
}

/** Autorización: el usuario activo con ese PIN, si tiene el permiso pedido. */
function autorizador(pin, permiso) {
  const p = String(pin || '');
  for (const u of obtener().prepare('SELECT * FROM usuarios WHERE activo = 1 AND pin_hash IS NOT NULL').all()) {
    if (puede(u.rol, permiso) && iguales(hashPin(p, u.pin_sal), u.pin_hash)) return publico(u);
  }
  registrar('autorizacion_fallida', { permiso });
  throw new Error('PIN incorrecto o sin permiso para ' + (NOMBRE_PERMISO[permiso] || permiso));
}

/** Con el código de recuperación se pone un PIN nuevo a un administrador (y se genera otro código). */
function recuperar(codigo, adminId, pinNuevo) {
  const r = leerConfig('recuperacion', null);
  const c = String(codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!r || c.length !== 12 || !iguales(hashPin(c, r.sal), r.hash)) { registrar('recuperacion_fallida', ''); throw new Error('Código de recuperación incorrecto'); }
  const u = obtener().prepare("SELECT id FROM usuarios WHERE id = ? AND rol = 'admin'").get(adminId);
  if (!u) throw new Error('Elija un administrador');
  return obtener().transaction(() => {
    obtener().prepare('UPDATE usuarios SET activo = 1 WHERE id = ?').run(u.id);
    guardarPin(u.id, pinNuevo);
    registrar('pin_recuperado', { id: u.id });
    return { codigoRecuperacion: nuevoCodigoRecuperacion() };
  })();
}

module.exports = { ROLES, PERMISOS, NOMBRE_PERMISO, puede, hayUsuarios, listar, obtenerPorId, crear, crearPrimerAdmin, actualizar,
  reiniciarPin, crearMiPin, cambiarMiPin, verificar, autorizador, recuperar, validarPin };
