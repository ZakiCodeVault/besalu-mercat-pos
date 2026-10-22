/**
 * compras.js — Facturas de compra a proveedores (entradas de inventario).
 *
 *  - Cada línea con producto suma al inventario (kárdex) y recalcula el
 *    costo promedio ponderado del producto.
 *  - Las líneas sin producto son gastos (no inventario) pero su IVA cuenta
 *    igual como IVA pagado.
 *  - La misma factura (proveedor + número, o la misma clave) no se puede
 *    registrar dos veces: evita contar doble el IVA.
 *  - Una compra no se edita: si hubo un error se ANULA (revierte inventario)
 *    y se registra de nuevo.
 *  - Una factura electrónica importada se acepta o rechaza ante Hacienda con
 *    un Mensaje Receptor (05 aceptación, 06 parcial, 07 rechazo), que lleva su
 *    propio consecutivo y no se modifica ni se borra.
 */
const { obtener, registrar, leerAjustes } = require('./conexion');
const { validarTarifa, validarCantidad, lineaCompra, consecutivo, fechaIso, fechaLocal } = require('./montos');
const productos = require('./productos');
const { motivoNoAceptable } = require('../hacienda/receptor');   // solo lee el XML del proveedor

function entero(v, campo) {
  const n = Number(v == null ? 0 : v);
  if (!Number.isInteger(n) || n < 0) throw new Error('Monto inválido en ' + campo);
  return n;
}

function guardarProveedor(d, p) {
  const identificacion = String(p.identificacion || '').replace(/[^\dA-Za-z]/g, '');
  const nombre = String(p.nombre || '').trim();
  if (!identificacion) throw new Error('Falta la identificación del proveedor');
  if (!nombre) throw new Error('Falta el nombre del proveedor');
  d.prepare(`INSERT INTO proveedores(tipo_id, identificacion, nombre, correo, telefono)
             VALUES(@tipo_id, @identificacion, @nombre, @correo, @telefono)
             ON CONFLICT(identificacion) DO UPDATE SET nombre = excluded.nombre,
               correo = CASE WHEN excluded.correo <> '' THEN excluded.correo ELSE proveedores.correo END`)
    .run({ tipo_id: p.tipo_id || '02', identificacion, nombre, correo: String(p.correo || ''), telefono: String(p.telefono || '') });
  return d.prepare('SELECT * FROM proveedores WHERE identificacion = ?').get(identificacion);
}

/**
 * Registra una factura de compra.
 * @param {object} c {
 *   proveedor: {tipo_id, identificacion, nombre, correo?},
 *   tipo_documento?, numero_documento, clave?, fecha (AAAA-MM-DD), otros_cargos?, notas?, xml_original?,
 *   lineas: [{ producto_id | nuevo_producto:{codigo,nombre,precio,tarifa_iva,cabys?},
 *              descripcion?, cantidad, costo_unitario (céntimos sin IVA), tarifa_iva,
 *              subtotal?, impuesto?  (si vienen del XML se respetan) }]
 * }
 */
function registrarCompra(c) {
  const d = obtener();
  const numero = String(c.numero_documento || '').trim();
  if (!numero) throw new Error('Falta el número de la factura del proveedor');
  const fecha = String(c.fecha || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error('Fecha de la factura inválida');
  if (fecha > fechaLocal().slice(0, 10)) throw new Error('La fecha de la factura no puede ser posterior a hoy');
  if (!Array.isArray(c.lineas) || !c.lineas.length) throw new Error('La factura no tiene líneas');
  const claveDoc = String(c.clave || '').replace(/\D/g, '');
  if (claveDoc && claveDoc.length !== 50) throw new Error('La clave de la factura debe tener 50 dígitos');

  return d.transaction(() => {
    const prov = guardarProveedor(d, c.proveedor || {});
    const repetida = d.prepare('SELECT id FROM compras WHERE (proveedor_id = ? AND numero_documento = ?) OR (? <> \'\' AND clave = ?)')
      .get(prov.id, numero, claveDoc, claveDoc);
    if (repetida) throw new Error('Esta factura de compra ya fue registrada');

    const lineas = [];
    let n = 0;
    for (const l of c.lineas) {
      let productoId = l.producto_id ? Number(l.producto_id) : null;
      if (!productoId && l.nuevo_producto) {
        const existente = productos.buscarPorCodigo(l.nuevo_producto.codigo);
        productoId = existente ? existente.id : productos.crear(l.nuevo_producto, { conBitacora: true }).id;
      }
      if (productoId && !productos.obtenerPorId(productoId)) throw new Error('Producto inexistente en la línea ' + (n + 1));
      const cantidad = validarCantidad(l.cantidad);
      const tarifa = validarTarifa(l.tarifa_iva);
      const costo = entero(l.costo_unitario, 'costo unitario');
      let m = lineaCompra(costo, cantidad, tarifa);
      if (l.subtotal != null && l.impuesto != null) {   // montos exactos del documento del proveedor
        const sub = entero(l.subtotal, 'subtotal'), imp = entero(l.impuesto, 'impuesto');
        m = { subtotal: sub, impuesto: imp, total_linea: sub + imp };
      }
      const desc = String(l.descripcion || (productoId ? productos.obtenerPorId(productoId).nombre : '')).trim();
      if (!desc) throw new Error('Falta la descripción de la línea ' + (n + 1));
      lineas.push(Object.assign({ linea: ++n, producto_id: productoId, descripcion: desc, cantidad, costo_unitario: costo, tarifa_iva: tarifa }, m));
    }

    const subtotal = lineas.reduce((s, l) => s + l.subtotal, 0);
    const impuesto = lineas.reduce((s, l) => s + l.impuesto, 0);
    const otros = entero(c.otros_cargos, 'otros cargos');
    const r = d.prepare(`INSERT INTO compras(proveedor_id, tipo_documento, numero_documento, clave, fecha, subtotal, impuesto, otros_cargos, total, notas, xml_original)
                         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(prov.id, c.tipo_documento || '01', numero, claveDoc || null, fecha, subtotal, impuesto, otros,
           subtotal + impuesto + otros, String(c.notas || ''), c.xml_original || null);
    const compraId = Number(r.lastInsertRowid);

    const insL = d.prepare(`INSERT INTO compra_lineas(compra_id, linea, producto_id, descripcion, cantidad, costo_unitario, subtotal, tarifa_iva, impuesto, total_linea)
                            VALUES(@compra_id, @linea, @producto_id, @descripcion, @cantidad, @costo_unitario, @subtotal, @tarifa_iva, @impuesto, @total_linea)`);
    const insM = d.prepare(`INSERT INTO movimientos(producto_id, fecha, tipo, cantidad, costo_unitario, compra_id, nota)
                            VALUES(?, ?, 'compra', ?, ?, ?, ?)`);
    const actCosto = d.prepare('UPDATE productos SET costo = ?, actualizado_en = ? WHERE id = ?');
    const ahora = fechaLocal();
    for (const l of lineas) {
      insL.run(Object.assign({ compra_id: compraId }, l));
      if (l.producto_id) {
        const p = productos.obtenerPorId(l.producto_id);
        // costo promedio ponderado (sin IVA); si no había stock, toma el costo nuevo
        const stockPrevio = Math.max(0, p.stock);
        const nuevoCosto = stockPrevio > 0
          ? Math.round((stockPrevio * p.costo + l.cantidad * l.costo_unitario) / (stockPrevio + l.cantidad))
          : l.costo_unitario;
        actCosto.run(nuevoCosto, ahora, p.id);
        insM.run(p.id, ahora, l.cantidad, l.costo_unitario, compraId, 'Factura ' + numero + ' · ' + prov.nombre);
      }
    }
    registrar('compra', { id: compraId, proveedor: prov.nombre, numero, total: subtotal + impuesto + otros, iva: impuesto });
    return obtenerPorId(compraId);
  })();
}

/** Anula una compra: saca del inventario lo que había entrado. */
function anular(id, razon) {
  const d = obtener();
  const motivo = String(razon || '').trim();
  if (!motivo) throw new Error('Indique el motivo de la anulación');
  return d.transaction(() => {
    const c = d.prepare('SELECT * FROM compras WHERE id = ?').get(id);
    if (!c) throw new Error('La compra no existe');
    if (c.estado === 'anulada') throw new Error('La compra ya estaba anulada');
    const ahora = fechaLocal();
    const insM = d.prepare(`INSERT INTO movimientos(producto_id, fecha, tipo, cantidad, costo_unitario, compra_id, nota)
                            VALUES(?, ?, 'anulacion_compra', ?, ?, ?, ?)`);
    for (const l of d.prepare('SELECT * FROM compra_lineas WHERE compra_id = ? AND producto_id IS NOT NULL').all(id)) {
      insM.run(l.producto_id, ahora, -l.cantidad, l.costo_unitario, id, 'Anulación factura ' + c.numero_documento + ': ' + motivo);
    }
    d.prepare("UPDATE compras SET estado = 'anulada', anulada_en = ?, anulada_razon = ? WHERE id = ?").run(ahora, motivo, id);
    registrar('compra_anulada', { id, numero: c.numero_documento, motivo });
    return obtenerPorId(id);
  })();
}

function obtenerPorId(id) {
  const d = obtener();
  const c = d.prepare(`SELECT c.*, p.nombre AS proveedor_nombre, p.identificacion AS proveedor_identificacion, p.tipo_id AS proveedor_tipo_id
                       FROM compras c JOIN proveedores p ON p.id = c.proveedor_id WHERE c.id = ?`).get(id);
  if (!c) return null;
  c.tiene_xml = !!c.xml_original;
  // Una factura a nombre de otra cédula, sin receptor o un tiquete no se acepta ante Hacienda
  c.no_aceptable = c.xml_original ? motivoNoAceptable(c.xml_original, leerAjustes()) : null;
  delete c.xml_original;
  c.lineas = d.prepare(`SELECT l.*, pr.codigo AS producto_codigo FROM compra_lineas l
                        LEFT JOIN productos pr ON pr.id = l.producto_id WHERE l.compra_id = ? ORDER BY l.linea`).all(id);
  // Mensajes de receptor, el más reciente primero; el "vigente" es el que Hacienda no rechazó
  c.mensajes = d.prepare(`SELECT ${CAMPOS_MENSAJE} FROM mensajes_receptor WHERE compra_id = ? ORDER BY id DESC`).all(id);
  c.mensaje = c.mensajes.find((m) => m.estado_hacienda !== 'rechazado') || null;
  return c;
}

/* ---------------- Mensaje Receptor ---------------- */
const NOMBRE_MENSAJE = { '05': 'Aceptación', '06': 'Aceptación parcial', '07': 'Rechazo' };
const CAMPOS_MENSAJE = `id, compra_id, tipo, numero, consecutivo, clave, fecha_emision, mensaje, detalle, condicion_impuesto,
  monto_impuesto, impuesto_acreditar, gasto_aplicable, total_factura, estado_hacienda, hacienda_mensaje, hacienda_error,
  hacienda_fecha, hacienda_ambiente, xml_firmado IS NOT NULL AS tiene_xml_firmado, hacienda_respuesta IS NOT NULL AS tiene_respuesta`;

/** XML original de la factura (para el mensaje) y su estado. */
function facturaDe(id) {
  return obtener().prepare('SELECT id, estado, clave, numero_documento, xml_original FROM compras WHERE id = ?').get(id) || null;
}

/**
 * Registra el mensaje de receptor de una compra: reserva el consecutivo (05/06/07)
 * y lo deja pendiente para que la cola lo firme y lo envíe.
 * @param {number} compraId
 * @param {object} m campos calculados con hacienda/receptor.calcular()
 */
function registrarMensaje(compraId, m) {
  const d = obtener();
  const aj = leerAjustes();
  return d.transaction(() => {
    const c = d.prepare('SELECT id, estado, clave, numero_documento FROM compras WHERE id = ?').get(compraId);
    if (!c) throw new Error('La compra no existe');
    const enCurso = d.prepare("SELECT tipo, consecutivo FROM mensajes_receptor WHERE compra_id = ? AND estado_hacienda <> 'rechazado'").get(compraId);
    if (enCurso) throw new Error('Esta factura ya tiene ' + NOMBRE_MENSAJE[enCurso.tipo].toLowerCase() + ' ante Hacienda (' + enCurso.consecutivo + ')');
    if (m.tipo !== '07' && c.estado !== 'vigente') throw new Error('Una compra anulada no se puede aceptar ante Hacienda (sí se puede rechazar)');
    if (!c.clave || c.clave !== m.clave) throw new Error('La clave registrada en la compra no coincide con la del XML de la factura');

    d.prepare('UPDATE secuencias_receptor SET ultimo = ultimo + 1 WHERE tipo = ?').run(m.tipo);
    const numero = d.prepare('SELECT ultimo FROM secuencias_receptor WHERE tipo = ?').get(m.tipo).ultimo;
    const fila = Object.assign({}, m, { compra_id: compraId, numero, consecutivo: consecutivo(aj.sucursal, aj.terminal, m.tipo, numero), fecha_emision: fechaIso() });
    const r = d.prepare(`INSERT INTO mensajes_receptor(compra_id, tipo, numero, consecutivo, clave, fecha_emision, mensaje, detalle,
        emisor_tipo_id, emisor_identificacion, receptor_tipo_id, receptor_identificacion, codigo_actividad, condicion_impuesto,
        monto_impuesto, impuesto_acreditar, gasto_aplicable, total_factura)
      VALUES(@compra_id, @tipo, @numero, @consecutivo, @clave, @fecha_emision, @mensaje, @detalle,
        @emisor_tipo_id, @emisor_identificacion, @receptor_tipo_id, @receptor_identificacion, @codigo_actividad, @condicion_impuesto,
        @monto_impuesto, @impuesto_acreditar, @gasto_aplicable, @total_factura)`).run(fila);
    registrar('mensaje_receptor', { id: Number(r.lastInsertRowid), compra: compraId, factura: c.numero_documento, tipo: NOMBRE_MENSAJE[m.tipo],
      consecutivo: fila.consecutivo, condicion: m.condicion_impuesto, acreditar: m.impuesto_acreditar });
    return Number(r.lastInsertRowid);
  })();
}

/** Mensaje completo (con XML y respuesta). */
function obtenerMensaje(id) {
  return obtener().prepare('SELECT * FROM mensajes_receptor WHERE id = ?').get(id) || null;
}

function listar({ desde, hasta, texto, limite = 300 } = {}) {
  const cond = [], par = { limite };
  if (desde) { cond.push('c.fecha >= @desde'); par.desde = desde; }
  if (hasta) { cond.push('c.fecha <= @hasta'); par.hasta = hasta; }
  if (texto) { cond.push('(c.numero_documento LIKE @t OR p.nombre LIKE @t OR p.identificacion LIKE @t)'); par.t = '%' + texto + '%'; }
  const aj = leerAjustes();
  return obtener().prepare(`
    SELECT c.id, c.fecha, c.numero_documento, c.tipo_documento, c.subtotal, c.impuesto, c.otros_cargos, c.total, c.estado,
           p.nombre AS proveedor, p.identificacion AS proveedor_identificacion,
           (SELECT count(*) FROM compra_lineas l WHERE l.compra_id = c.id) AS lineas,
           c.xml_original IS NOT NULL AS tiene_xml, m.tipo AS mensaje_tipo, m.estado_hacienda AS mensaje_estado,
           CASE WHEN m.id IS NULL THEN c.xml_original END AS xml_sin_mensaje
    FROM compras c JOIN proveedores p ON p.id = c.proveedor_id
    LEFT JOIN mensajes_receptor m ON m.compra_id = c.id AND m.estado_hacienda <> 'rechazado'
    ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
    ORDER BY c.fecha DESC, c.id DESC LIMIT @limite`).all(par).map((c) => {
    // Pendiente de aceptar ante Hacienda: factura importada, a nombre del negocio, sin mensaje en curso
    c.por_aceptar = !!c.xml_sin_mensaje && c.estado === 'vigente' && !motivoNoAceptable(c.xml_sin_mensaje, aj);
    delete c.xml_sin_mensaje;
    return c;
  });
}

function listarProveedores() {
  return obtener().prepare('SELECT * FROM proveedores ORDER BY nombre COLLATE NOCASE').all();
}

module.exports = { registrarCompra, anular, obtenerPorId, listar, listarProveedores, facturaDe, registrarMensaje, obtenerMensaje };
