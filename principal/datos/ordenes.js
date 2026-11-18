/**
 * ordenes.js — Órdenes de compra a proveedores.
 *
 * Ciclo:
 *   borrador ──emitir──▶ emitida ──recepciones──▶ (parcial) ──▶ recibida
 *       │                   │
 *    eliminar          cerrar (con faltante) · cancelar (si no se recibió nada)
 *
 *  - Un borrador se edita y se borra libremente; al emitirlo recibe su número
 *    (OC-00001, sin saltos) y ya no cambia.
 *  - La mercadería entra al inventario SOLO con una recepción, que es una
 *    factura de compra ligada a la orden (ver compras.registrarCompra). Lo
 *    recibido se calcula de las compras vigentes: si una recepción se anula,
 *    la orden vuelve a quedar pendiente sola.
 *  - Los montos los calcula el sistema; nunca se confía en los de la pantalla.
 */
const { obtener, registrar, leerAjustes } = require('./conexion');
const { validarTarifa, validarCantidad, lineaCompra, fechaLocal } = require('./montos');
const productos = require('./productos');
const { guardarProveedor } = require('./compras');

const ESTADOS = {
  borrador: 'Borrador', emitida: 'Emitida', parcial: 'Recibida en parte', recibida: 'Recibida',
  cerrada: 'Cerrada con faltante', cancelada: 'Cancelada'
};

const numeroTexto = (n) => (n ? 'OC-' + String(n).padStart(5, '0') : 'Borrador');
const redondear3 = (x) => Math.round(x * 1000) / 1000;

function centimos(v, campo) {
  const n = Number(v == null ? 0 : v);
  if (!Number.isInteger(n) || n < 0) throw new Error('Monto inválido en ' + campo + ' (se esperan céntimos enteros)');
  return n;
}

/** Estado que ve la persona: una orden emitida puede estar recibida en parte o completa. */
function estadoVisible(estado, pedido, recibido, completas, lineas) {
  if (estado !== 'emitida') return estado;
  if (lineas > 0 && completas === lineas) return 'recibida';
  return recibido > 0 ? 'parcial' : 'emitida';
}

/** Valida y calcula las líneas. Cada producto va una sola vez y debe estar activo. */
function prepararLineas(lineas) {
  if (!Array.isArray(lineas)) throw new Error('Líneas inválidas');
  const vistos = new Set();
  return lineas.map((l, i) => {
    const p = productos.obtenerPorId(Number(l.producto_id));
    if (!p) throw new Error('Línea ' + (i + 1) + ': el producto no existe');
    if (!p.activo) throw new Error('"' + p.nombre + '" está desactivado: reactívelo en Inventario para pedirlo');
    if (vistos.has(p.id)) throw new Error('"' + p.nombre + '" está dos veces en la orden: sume las cantidades en una sola línea');
    vistos.add(p.id);
    const cantidad = validarCantidad(l.cantidad);
    const costo = centimos(l.costo_unitario, 'el costo de "' + p.nombre + '"');
    const tarifa = validarTarifa(l.tarifa_iva == null ? p.tarifa_iva : l.tarifa_iva);
    return Object.assign({ linea: i + 1, producto_id: p.id, descripcion: p.nombre, cantidad, costo_unitario: costo, tarifa_iva: tarifa },
      lineaCompra(costo, cantidad, tarifa));
  });
}

function borradorDe(d, id) {
  const o = d.prepare('SELECT * FROM ordenes_compra WHERE id = ?').get(id);
  if (!o) throw new Error('La orden de compra no existe');
  if (o.estado !== 'borrador') throw new Error('La orden ' + numeroTexto(o.numero) + ' ya fue emitida: no se puede modificar');
  return o;
}

/**
 * Crea o actualiza un borrador.
 * @param {object} o { id?, proveedor: {tipo_id, identificacion, nombre, correo?} | proveedor_id,
 *                     fecha_esperada?, notas?, lineas: [{producto_id, cantidad, costo_unitario, tarifa_iva?}] }
 */
function guardarBorrador(o) {
  const d = obtener();
  const fechaEsperada = String(o.fecha_esperada || '').slice(0, 10);
  if (fechaEsperada && !/^\d{4}-\d{2}-\d{2}$/.test(fechaEsperada)) throw new Error('Fecha esperada inválida');
  const lineas = prepararLineas(o.lineas || []);
  return d.transaction(() => {
    let proveedorId;
    if (o.proveedor_id) {
      const p = d.prepare('SELECT id FROM proveedores WHERE id = ?').get(o.proveedor_id);
      if (!p) throw new Error('El proveedor no existe');
      proveedorId = p.id;
    } else {
      proveedorId = guardarProveedor(d, o.proveedor || {}).id;
    }
    const subtotal = lineas.reduce((s, l) => s + l.subtotal, 0);
    const impuesto = lineas.reduce((s, l) => s + l.impuesto, 0);
    const ahora = fechaLocal();
    let id = o.id ? Number(o.id) : null;
    if (id) {
      borradorDe(d, id);
      d.prepare(`UPDATE ordenes_compra SET proveedor_id = ?, fecha_esperada = ?, notas = ?, subtotal = ?, impuesto = ?, total = ?, actualizado_en = ?
                 WHERE id = ?`).run(proveedorId, fechaEsperada, String(o.notas || '').trim(), subtotal, impuesto, subtotal + impuesto, ahora, id);
      d.prepare('DELETE FROM orden_compra_lineas WHERE orden_id = ?').run(id);
    } else {
      id = Number(d.prepare(`INSERT INTO ordenes_compra(proveedor_id, fecha_esperada, notas, subtotal, impuesto, total, creado_en, actualizado_en)
                             VALUES(?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(proveedorId, fechaEsperada, String(o.notas || '').trim(), subtotal, impuesto, subtotal + impuesto, ahora, ahora).lastInsertRowid);
    }
    const ins = d.prepare(`INSERT INTO orden_compra_lineas(orden_id, linea, producto_id, descripcion, cantidad, costo_unitario, tarifa_iva, subtotal, impuesto, total_linea)
                           VALUES(@orden_id, @linea, @producto_id, @descripcion, @cantidad, @costo_unitario, @tarifa_iva, @subtotal, @impuesto, @total_linea)`);
    for (const l of lineas) ins.run(Object.assign({ orden_id: id }, l));
    registrar('orden_borrador', { id, productos: lineas.length, total: subtotal + impuesto });
    return obtenerPorId(id);
  })();
}

function eliminarBorrador(id) {
  const d = obtener();
  return d.transaction(() => {
    borradorDe(d, id);
    d.prepare('DELETE FROM orden_compra_lineas WHERE orden_id = ?').run(id);
    d.prepare('DELETE FROM ordenes_compra WHERE id = ?').run(id);
    registrar('orden_borrador_eliminado', { id });
    return { eliminado: true };
  })();
}

/** Emite el borrador: le asigna el número siguiente y lo deja listo para recibir. */
function emitir(id) {
  const d = obtener();
  return d.transaction(() => {
    const o = borradorDe(d, id);
    const n = d.prepare('SELECT count(*) AS n FROM orden_compra_lineas WHERE orden_id = ?').get(id).n;
    if (!n) throw new Error('La orden no tiene productos');
    const numero = d.prepare('SELECT coalesce(max(numero), 0) + 1 AS n FROM ordenes_compra').get().n;
    d.prepare("UPDATE ordenes_compra SET estado = 'emitida', numero = ?, emitida_en = ?, actualizado_en = ? WHERE id = ?")
      .run(numero, fechaLocal(), fechaLocal(), id);
    const prov = d.prepare('SELECT nombre FROM proveedores WHERE id = ?').get(o.proveedor_id);
    registrar('orden_emitida', { id, numero: numeroTexto(numero), proveedor: prov.nombre, total: o.total });
    return obtenerPorId(id);
  })();
}

function abiertaDe(d, id) {
  const o = d.prepare('SELECT * FROM ordenes_compra WHERE id = ?').get(id);
  if (!o) throw new Error('La orden de compra no existe');
  if (o.estado !== 'emitida') throw new Error('La orden ' + numeroTexto(o.numero) + ' no está abierta (' + ESTADOS[o.estado].toLowerCase() + ')');
  return o;
}

/** Cierra una orden recibida en parte: lo que falta ya no se espera. */
function cerrar(id, motivo) {
  const d = obtener();
  const razon = String(motivo || '').trim();
  if (!razon) throw new Error('Indique por qué se cierra la orden con faltante');
  return d.transaction(() => {
    const o = abiertaDe(d, id);
    const recibido = d.prepare('SELECT coalesce(sum(recibido), 0) AS r FROM orden_compra_avance WHERE orden_id = ?').get(id).r;
    if (!(recibido > 0)) throw new Error('No se ha recibido nada de esta orden: cancélela en vez de cerrarla');
    d.prepare("UPDATE ordenes_compra SET estado = 'cerrada', terminada_en = ?, motivo = ?, actualizado_en = ? WHERE id = ?")
      .run(fechaLocal(), razon, fechaLocal(), id);
    registrar('orden_cerrada', { id, numero: numeroTexto(o.numero), motivo: razon });
    return obtenerPorId(id);
  })();
}

/** Cancela una orden de la que no se recibió nada. */
function cancelar(id, motivo) {
  const d = obtener();
  const razon = String(motivo || '').trim();
  if (!razon) throw new Error('Indique el motivo de la cancelación');
  return d.transaction(() => {
    const o = abiertaDe(d, id);
    d.prepare("UPDATE ordenes_compra SET estado = 'cancelada', terminada_en = ?, motivo = ?, actualizado_en = ? WHERE id = ?")
      .run(fechaLocal(), razon, fechaLocal(), id);
    registrar('orden_cancelada', { id, numero: numeroTexto(o.numero), motivo: razon });
    return obtenerPorId(id);
  })();
}

/** Orden completa: líneas con pedido, recibido y pendiente, y sus recepciones. */
function obtenerPorId(id) {
  const d = obtener();
  const o = d.prepare(`SELECT o.*, p.nombre AS proveedor_nombre, p.identificacion AS proveedor_identificacion, p.tipo_id AS proveedor_tipo_id,
                              p.correo AS proveedor_correo, p.telefono AS proveedor_telefono
                       FROM ordenes_compra o JOIN proveedores p ON p.id = o.proveedor_id WHERE o.id = ?`).get(id);
  if (!o) return null;
  o.lineas = d.prepare(`SELECT l.*, a.recibido, pr.codigo AS producto_codigo, pr.unidad, pr.stock, pr.activo
                        FROM orden_compra_lineas l JOIN orden_compra_avance a ON a.orden_linea_id = l.id
                        JOIN productos pr ON pr.id = l.producto_id WHERE l.orden_id = ? ORDER BY l.linea`).all(id)
    .map((l) => Object.assign(l, { pendiente: o.estado === 'emitida' ? Math.max(0, redondear3(l.cantidad - l.recibido)) : 0 }));
  o.recepciones = d.prepare(`SELECT id, fecha, numero_documento, total, estado, anulada_razon FROM compras WHERE orden_id = ? ORDER BY id`).all(id);
  const pedido = o.lineas.reduce((s, l) => s + l.cantidad, 0);
  const recibido = o.lineas.reduce((s, l) => s + Math.min(l.recibido, l.cantidad), 0);
  const completas = o.lineas.filter((l) => l.recibido >= l.cantidad - 0.0005).length;
  o.numero_texto = numeroTexto(o.numero);
  o.estado_visible = estadoVisible(o.estado, pedido, recibido, completas, o.lineas.length);
  o.estado_nombre = ESTADOS[o.estado_visible];
  o.avance = pedido ? Math.round(recibido / pedido * 100) : 0;
  return o;
}

/** Lista de órdenes (más recientes primero) con su avance. */
function listar({ estado, texto, limite = 300 } = {}) {
  const cond = [], par = { limite };
  if (texto) { cond.push('(p.nombre LIKE @t OR p.identificacion LIKE @t OR printf(\'OC-%05d\', o.numero) LIKE @t)'); par.t = '%' + texto + '%'; }
  const filas = obtener().prepare(`
    SELECT o.id, o.numero, o.estado, o.total, o.fecha_esperada, o.emitida_en, o.creado_en, o.terminada_en,
           p.nombre AS proveedor, p.identificacion AS proveedor_identificacion,
           count(a.orden_linea_id) AS lineas,
           coalesce(sum(a.pedido), 0) AS pedido,
           coalesce(sum(min(a.recibido, a.pedido)), 0) AS recibido,
           coalesce(sum(CASE WHEN a.recibido >= a.pedido - 0.0005 THEN 1 ELSE 0 END), 0) AS completas
    FROM ordenes_compra o JOIN proveedores p ON p.id = o.proveedor_id
    LEFT JOIN orden_compra_avance a ON a.orden_id = o.id
    ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
    GROUP BY o.id ORDER BY (o.estado = 'borrador') DESC, coalesce(o.numero, 0) DESC, o.id DESC LIMIT @limite`).all(par);
  return filas.map((f) => {
    f.numero_texto = numeroTexto(f.numero);
    f.estado_visible = estadoVisible(f.estado, f.pedido, f.recibido, f.completas, f.lineas);
    f.estado_nombre = ESTADOS[f.estado_visible];
    f.avance = f.pedido ? Math.round(f.recibido / f.pedido * 100) : 0;
    return f;
  }).filter((f) => !estado || f.estado_visible === estado);
}

/** Cantidad pedida y todavía no recibida, por producto (órdenes emitidas). */
function enCamino() {
  const r = {};
  for (const f of obtener().prepare(`
      SELECT a.producto_id, round(sum(max(a.pedido - a.recibido, 0)), 3) AS cantidad
      FROM orden_compra_avance a JOIN ordenes_compra o ON o.id = a.orden_id
      WHERE o.estado = 'emitida' GROUP BY a.producto_id HAVING cantidad > 0`).all()) r[f.producto_id] = f.cantidad;
  return r;
}

/**
 * Productos por pedir: los que, contando lo que ya viene en camino, quedan
 * bajo su mínimo. Sugiere pedir hasta el doble del mínimo.
 * @param {object} [f] { proveedor_id } solo los que se le compraron por última vez a ese proveedor (o nunca se compraron)
 */
function sugerencias({ proveedor_id } = {}) {
  const minimoDefecto = Number(leerAjustes().stockMin) || 0;
  const camino = enCamino();
  const d = obtener();
  const ultimo = d.prepare(`
    SELECT c.proveedor_id, cl.costo_unitario, c.fecha FROM compra_lineas cl JOIN compras c ON c.id = cl.compra_id
    WHERE cl.producto_id = ? AND c.estado = 'vigente' ORDER BY c.fecha DESC, c.id DESC LIMIT 1`);
  const nombreProv = d.prepare('SELECT nombre FROM proveedores WHERE id = ?');
  const salida = [];
  for (const p of productos.listar()) {
    const minimo = p.stock_minimo > 0 ? p.stock_minimo : minimoDefecto;
    if (!(minimo > 0)) continue;
    const enCam = camino[p.id] || 0;
    const disponible = redondear3(p.stock + enCam);
    if (disponible >= minimo) continue;
    const u = ultimo.get(p.id);
    if (proveedor_id && u && u.proveedor_id !== Number(proveedor_id)) continue;
    salida.push({
      producto_id: p.id, codigo: p.codigo, nombre: p.nombre, stock: p.stock, minimo, en_camino: enCam,
      sugerido: Math.max(1, Math.ceil(minimo * 2 - disponible)),
      costo: u ? u.costo_unitario : p.costo, tarifa_iva: p.tarifa_iva,
      ultimo_proveedor: u ? (nombreProv.get(u.proveedor_id) || {}).nombre : null
    });
  }
  return salida.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

module.exports = { ESTADOS, numeroTexto, guardarBorrador, eliminarBorrador, emitir, cerrar, cancelar, obtenerPorId, listar, enCamino, sugerencias };
