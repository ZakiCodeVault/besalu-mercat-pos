/**
 * marcas.js — Marcas de los productos y su logo para las etiquetas.
 *
 *  - El logo se carga una vez por marca y lo usan todas las etiquetas de sus
 *    productos. La pantalla lo manda ya reducido y en escala de grises (PNG);
 *    `umbral` dice desde qué gris se imprime negro (la impresora solo imprime
 *    puntos negros).
 *  - Se guarda dentro de la base de datos: viaja en la copia completa.
 */
const { obtener, registrar } = require('./conexion');
const { fechaLocal } = require('./montos');

const MAX_LOGO = 400000;   // bytes
const esPng = (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

function listar() {
  return obtener().prepare(`
    SELECT m.id, m.nombre, m.umbral, (m.logo IS NOT NULL) AS tiene_logo, coalesce(length(m.logo), 0) AS bytes, m.actualizado_en,
           (SELECT count(*) FROM productos p WHERE p.marca_id = m.id AND p.activo = 1) AS productos
    FROM marcas m ORDER BY m.nombre COLLATE NOCASE`).all();
}

function nombreValido(nombre) {
  const n = String(nombre == null ? '' : nombre).trim().replace(/\s+/g, ' ');
  if (n.length > 60) throw new Error('El nombre de la marca tiene máximo 60 caracteres');
  return n;
}

/** La marca con ese nombre (sin importar mayúsculas), o la crea. Vacío = sin marca. */
function obtenerOCrear(nombre) {
  const n = nombreValido(nombre);
  if (!n) return null;
  const d = obtener();
  const m = d.prepare('SELECT id FROM marcas WHERE nombre = ?').get(n);
  if (m) return m.id;
  const id = Number(d.prepare('INSERT INTO marcas(nombre) VALUES(?)').run(n).lastInsertRowid);
  registrar('marca_creada', { id, nombre: n });
  return id;
}

/**
 * @param {object} f { id?, nombre, logo?: Uint8Array (PNG) | null para quitarlo, umbral? }
 *   Sin `id`, si ya existe una marca con ese nombre se actualiza esa.
 */
function guardar(f) {
  const d = obtener();
  const nombre = nombreValido(f.nombre);
  if (!nombre) throw new Error('Escriba el nombre de la marca');
  let logo;
  if (f.logo === null) logo = null;
  else if (f.logo !== undefined) {
    logo = Buffer.from(f.logo.buffer ? new Uint8Array(f.logo.buffer, f.logo.byteOffset, f.logo.byteLength) : f.logo);
    if (!esPng(logo)) throw new Error('El logo no es una imagen válida');
    if (logo.length > MAX_LOGO) throw new Error('El logo es demasiado grande');
  }
  const umbral = f.umbral == null ? undefined : Number(f.umbral);
  if (umbral !== undefined && (!Number.isInteger(umbral) || umbral < 20 || umbral > 235)) throw new Error('Intensidad del logo inválida');
  return d.transaction(() => {
    let id = f.id ? Number(f.id) : (d.prepare('SELECT id FROM marcas WHERE nombre = ?').get(nombre) || {}).id;
    const otra = d.prepare('SELECT id FROM marcas WHERE nombre = ?').get(nombre);
    if (id && otra && otra.id !== id) throw new Error('Ya existe otra marca llamada ' + nombre);
    if (!id) id = Number(d.prepare('INSERT INTO marcas(nombre) VALUES(?)').run(nombre).lastInsertRowid);
    else if (!d.prepare('SELECT id FROM marcas WHERE id = ?').get(id)) throw new Error('La marca no existe');
    d.prepare('UPDATE marcas SET nombre = ?, actualizado_en = ? WHERE id = ?').run(nombre, fechaLocal(), id);
    if (logo !== undefined) d.prepare('UPDATE marcas SET logo = ? WHERE id = ?').run(logo, id);
    if (umbral !== undefined) d.prepare('UPDATE marcas SET umbral = ? WHERE id = ?').run(umbral, id);
    registrar('marca_guardada', { id, nombre, logo: logo === undefined ? undefined : logo ? logo.length + ' bytes' : 'quitado' });
    return d.prepare('SELECT id, nombre, umbral, (logo IS NOT NULL) AS tiene_logo FROM marcas WHERE id = ?').get(id);
  })();
}

/** El logo para dibujar la etiqueta. */
function logo(id) {
  const m = obtener().prepare('SELECT id, nombre, umbral, logo FROM marcas WHERE id = ?').get(id);
  return m ? { id: m.id, nombre: m.nombre, umbral: m.umbral, png: m.logo || null } : null;
}

function eliminar(id) {
  const d = obtener();
  const m = d.prepare('SELECT id, nombre FROM marcas WHERE id = ?').get(id);
  if (!m) throw new Error('La marca no existe');
  const n = d.prepare('SELECT count(*) AS n FROM productos WHERE marca_id = ?').get(id).n;
  if (n) throw new Error('La marca ' + m.nombre + ' está en ' + n + (n === 1 ? ' producto' : ' productos') + ': cámbieles la marca primero');
  d.prepare('DELETE FROM marcas WHERE id = ?').run(id);
  registrar('marca_eliminada', { id, nombre: m.nombre });
  return { eliminada: true };
}

module.exports = { listar, obtenerOCrear, guardar, logo, eliminar, MAX_LOGO };
