/**
 * productos.js — Catálogo de productos e inventario.
 *
 * El stock NUNCA se escribe directamente: siempre entra o sale con un
 * movimiento (kárdex). Así cada unidad tiene su historia.
 */
const { obtener, registrar } = require('./conexion');
const { validarTarifa, fechaLocal } = require('./montos');

/** Los montos llegan SIEMPRE en céntimos enteros (la interfaz convierte ₡ -> céntimos). */
function centimos(v, campo) {
  const n = Number(v == null ? 0 : v);
  if (!Number.isInteger(n) || n < 0) throw new Error('Monto inválido en ' + campo + ' (se esperan céntimos enteros)');
  return n;
}

const CAMPOS = 'id, codigo, nombre, cabys, unidad, tarifa_iva, precio, costo, stock, stock_minimo, vence, activo';

function listar({ incluirInactivos = false } = {}) {
  return obtener().prepare(`SELECT ${CAMPOS} FROM productos ${incluirInactivos ? '' : 'WHERE activo = 1'} ORDER BY nombre COLLATE NOCASE`).all();
}

function obtenerPorId(id) {
  return obtener().prepare(`SELECT ${CAMPOS} FROM productos WHERE id = ?`).get(id);
}

function buscarPorCodigo(codigo) {
  return obtener().prepare(`SELECT ${CAMPOS} FROM productos WHERE codigo = ?`).get(String(codigo).trim());
}

function normalizar(p) {
  const codigo = String(p.codigo || '').trim();
  const nombre = String(p.nombre || '').trim();
  if (!codigo) throw new Error('El código del producto es obligatorio');
  if (!nombre) throw new Error('El nombre del producto es obligatorio');
  const cabys = String(p.cabys || '').replace(/\D/g, '');
  if (cabys && cabys.length !== 13) throw new Error('El código CABYS debe tener 13 dígitos');
  return {
    codigo, nombre, cabys,
    unidad: String(p.unidad || 'Unid').trim() || 'Unid',
    tarifa_iva: validarTarifa(p.tarifa_iva == null ? 13 : p.tarifa_iva),
    precio: centimos(p.precio, 'precio'),
    costo: centimos(p.costo, 'costo'),
    stock_minimo: Math.max(0, Number(p.stock_minimo) || 0),
    vence: String(p.vence || '')
  };
}

/** Crea un producto nuevo. Si trae stock inicial, se registra como movimiento. */
function crear(datos, { conBitacora = true } = {}) {
  const d = obtener();
  const p = normalizar(datos);
  return d.transaction(() => {
    const r = d.prepare(`INSERT INTO productos(codigo, nombre, cabys, unidad, tarifa_iva, precio, costo, stock_minimo, vence)
                         VALUES(@codigo, @nombre, @cabys, @unidad, @tarifa_iva, @precio, @costo, @stock_minimo, @vence)`).run(p);
    const id = Number(r.lastInsertRowid);
    const inicial = Math.round(Number(datos.stock_inicial || 0) * 1000) / 1000;
    if (inicial > 0) {
      d.prepare(`INSERT INTO movimientos(producto_id, fecha, tipo, cantidad, costo_unitario, nota)
                 VALUES(?, ?, 'inicial', ?, ?, 'Inventario inicial')`).run(id, fechaLocal(), inicial, p.costo);
    }
    if (conBitacora) registrar('producto_creado', { id, codigo: p.codigo, nombre: p.nombre, stock_inicial: inicial });
    return obtenerPorId(id);
  })();
}

/** Actualiza datos del producto (no el stock). */
function actualizar(id, datos) {
  const d = obtener();
  const actual = obtenerPorId(id);
  if (!actual) throw new Error('El producto no existe');
  const p = normalizar(Object.assign({}, actual, datos));
  d.prepare(`UPDATE productos SET codigo=@codigo, nombre=@nombre, cabys=@cabys, unidad=@unidad, tarifa_iva=@tarifa_iva,
             precio=@precio, costo=@costo, stock_minimo=@stock_minimo, vence=@vence, actualizado_en=@ahora WHERE id=@id`)
    .run(Object.assign(p, { id, ahora: fechaLocal() }));
  const cambios = {};
  for (const k of ['codigo', 'nombre', 'precio', 'tarifa_iva', 'costo']) if (actual[k] !== p[k]) cambios[k] = [actual[k], p[k]];
  if (Object.keys(cambios).length) registrar('producto_editado', { id, cambios });
  return obtenerPorId(id);
}

/**
 * Elimina un producto que nunca se usó. Si ya tiene ventas, compras o
 * movimientos, se DESACTIVA (no se puede borrar su historia).
 */
function eliminar(id) {
  const d = obtener();
  const p = obtenerPorId(id);
  if (!p) throw new Error('El producto no existe');
  const usado = d.prepare(`SELECT
      (SELECT count(*) FROM movimientos WHERE producto_id = ?) +
      (SELECT count(*) FROM comprobante_lineas WHERE producto_id = ?) +
      (SELECT count(*) FROM compra_lineas WHERE producto_id = ?) AS n`).get(id, id, id).n;
  if (usado === 0) {
    d.prepare('DELETE FROM productos WHERE id = ?').run(id);
    registrar('producto_eliminado', { id, codigo: p.codigo, nombre: p.nombre });
    return { eliminado: true };
  }
  d.prepare('UPDATE productos SET activo = 0, actualizado_en = ? WHERE id = ?').run(fechaLocal(), id);
  registrar('producto_desactivado', { id, codigo: p.codigo, nombre: p.nombre });
  return { eliminado: false, desactivado: true };
}

function reactivar(id) {
  obtener().prepare('UPDATE productos SET activo = 1, actualizado_en = ? WHERE id = ?').run(fechaLocal(), id);
  registrar('producto_reactivado', { id });
  return obtenerPorId(id);
}

/** Ajuste de inventario (conteo físico, merma, vencido...). Queda en el kárdex. */
function ajustarStock(id, stockContado, motivo) {
  const d = obtener();
  const razon = String(motivo || '').trim();
  if (!razon) throw new Error('Indique el motivo del ajuste');
  return d.transaction(() => {
    const p = obtenerPorId(id);
    if (!p) throw new Error('El producto no existe');
    const nuevo = Math.round(Number(stockContado) * 1000) / 1000;
    if (!Number.isFinite(nuevo)) throw new Error('Cantidad inválida');
    const diferencia = Math.round((nuevo - p.stock) * 1000) / 1000;
    if (diferencia === 0) return obtenerPorId(id);
    d.prepare(`INSERT INTO movimientos(producto_id, fecha, tipo, cantidad, costo_unitario, nota)
               VALUES(?, ?, 'ajuste', ?, ?, ?)`).run(id, fechaLocal(), diferencia, p.costo, razon);
    registrar('ajuste_inventario', { id, nombre: p.nombre, antes: p.stock, despues: nuevo, motivo: razon });
    return obtenerPorId(id);
  })();
}

/** Kárdex: cada entrada y salida con el saldo acumulado. */
function kardex(id, limite = 500) {
  return obtener().prepare(`
    SELECT * FROM (
      SELECT m.id, m.fecha, m.tipo, m.cantidad, m.costo_unitario, m.nota,
             round(sum(m.cantidad) OVER (ORDER BY m.id), 3) AS saldo,
             c.consecutivo AS comprobante, c.tipo AS tipo_comprobante,
             co.numero_documento AS compra, pr.nombre AS proveedor
      FROM movimientos m
      LEFT JOIN comprobantes c ON c.id = m.comprobante_id
      LEFT JOIN compras co ON co.id = m.compra_id
      LEFT JOIN proveedores pr ON pr.id = co.proveedor_id
      WHERE m.producto_id = ?
    ) ORDER BY id DESC LIMIT ?`).all(id, limite);
}

module.exports = { listar, obtenerPorId, buscarPorCodigo, crear, actualizar, eliminar, reactivar, ajustarStock, kardex };
