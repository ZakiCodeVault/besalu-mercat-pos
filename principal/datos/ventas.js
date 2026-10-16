/**
 * ventas.js — Comprobantes emitidos: tiquetes, facturas y notas de crédito.
 *
 * Reglas:
 *  - Los totales se calculan AQUÍ con los precios de la base de datos.
 *  - Todo ocurre en una transacción: consecutivo + comprobante + líneas +
 *    salida de inventario. Si algo falla, no queda nada a medias ni se pierde
 *    ningún número de consecutivo.
 *  - Una venta no se modifica ni se borra: se corrige con nota de crédito.
 */
const { obtener, registrar, leerAjustes } = require('./conexion');
const { lineaVenta, validarCantidad, consecutivo, clave, fechaIso, fechaLocal } = require('./montos');

const MEDIOS = ['efectivo', 'tarjeta', 'sinpe', 'transferencia', 'otro'];
const TIPOS = { '01': 'Factura electrónica', '03': 'Nota de crédito', '04': 'Tiquete electrónico' };

function turnoAbierto(d) {
  return d.prepare('SELECT * FROM turnos WHERE cerrado_en IS NULL').get();
}

/** Reserva el siguiente número del consecutivo (dentro de la transacción). */
function siguienteNumero(d, tipo) {
  d.prepare('UPDATE secuencias SET ultimo = ultimo + 1 WHERE tipo = ?').run(tipo);
  return d.prepare('SELECT ultimo FROM secuencias WHERE tipo = ?').get(tipo).ultimo;
}

function insertarComprobante(d, c) {
  const r = d.prepare(`INSERT INTO comprobantes(
      tipo, numero, consecutivo, clave, fecha_emision, turno_id, medio_pago, condicion_venta,
      receptor_tipo_id, receptor_identificacion, receptor_nombre, receptor_correo,
      total_gravado, total_exento, total_venta, total_impuesto, total_comprobante,
      pago, cambio, referencia_id, referencia_razon)
    VALUES(@tipo, @numero, @consecutivo, @clave, @fecha_emision, @turno_id, @medio_pago, '01',
      @receptor_tipo_id, @receptor_identificacion, @receptor_nombre, @receptor_correo,
      @total_gravado, @total_exento, @total_venta, @total_impuesto, @total_comprobante,
      @pago, @cambio, @referencia_id, @referencia_razon)`).run(c);
  return Number(r.lastInsertRowid);
}

const insLinea = `INSERT INTO comprobante_lineas(comprobante_id, linea, producto_id, codigo, cabys, descripcion, unidad,
  cantidad, precio_unitario, subtotal, tarifa_iva, impuesto, total_linea, costo_unitario)
  VALUES(@comprobante_id, @linea, @producto_id, @codigo, @cabys, @descripcion, @unidad,
  @cantidad, @precio_unitario, @subtotal, @tarifa_iva, @impuesto, @total_linea, @costo_unitario)`;

function totalesDe(lineas) {
  let gravado = 0, exento = 0, impuesto = 0;
  for (const l of lineas) {
    if (l.tarifa_iva > 0) gravado += l.subtotal; else exento += l.subtotal;
    impuesto += l.impuesto;
  }
  return { total_gravado: gravado, total_exento: exento, total_venta: gravado + exento,
           total_impuesto: impuesto, total_comprobante: gravado + exento + impuesto };
}

function normalizarReceptor(r) {
  if (!r) return null;
  const identificacion = String(r.identificacion || '').replace(/[^\dA-Za-z]/g, '');
  const nombre = String(r.nombre || '').trim();
  if (!identificacion && !nombre) return null;
  if (!identificacion || !nombre) throw new Error('Para facturar a un cliente se necesita su identificación y su nombre');
  return { tipo_id: r.tipo_id || '01', identificacion, nombre, correo: String(r.correo || '').trim() };
}

/**
 * Emite una venta.
 * @param {object} v { lineas:[{producto_id, cantidad}], medio_pago, pago (céntimos), receptor? }
 *   Sin receptor -> tiquete (04). Con receptor -> factura (01).
 */
function emitir(v) {
  const d = obtener();
  const aj = leerAjustes();
  const medio = String(v.medio_pago || '');
  if (!MEDIOS.includes(medio)) throw new Error('Medio de pago inválido');
  if (!Array.isArray(v.lineas) || !v.lineas.length) throw new Error('La venta no tiene productos');
  const receptor = normalizarReceptor(v.receptor);
  const tipo = receptor ? '01' : '04';

  return d.transaction(() => {
    const turno = turnoAbierto(d);
    if (!turno) throw new Error('La caja está cerrada: ábrala antes de vender');

    // Agrupa por producto (si se escaneó el mismo varias veces) y calcula con precios de la base
    const porProducto = new Map();
    for (const l of v.lineas) {
      const id = Number(l.producto_id);
      porProducto.set(id, Math.round(((porProducto.get(id) || 0) + validarCantidad(l.cantidad)) * 1000) / 1000);
    }
    const lineas = [];
    let n = 0;
    for (const [id, cantidad] of porProducto) {
      const p = d.prepare('SELECT * FROM productos WHERE id = ?').get(id);
      if (!p || !p.activo) throw new Error('Producto no disponible (id ' + id + ')');
      if (!aj.permitirStockNegativo && p.stock < cantidad) throw new Error('Stock insuficiente de "' + p.nombre + '": hay ' + p.stock);
      const m = lineaVenta(p.precio, cantidad, p.tarifa_iva);
      lineas.push(Object.assign({ linea: ++n, producto_id: p.id, codigo: p.codigo, cabys: p.cabys, descripcion: p.nombre,
        unidad: p.unidad, cantidad, tarifa_iva: p.tarifa_iva, costo_unitario: p.costo }, m));
    }
    const tot = totalesDe(lineas);

    let pago = tot.total_comprobante, cambio = 0;
    if (medio === 'efectivo') {
      pago = Number(v.pago);
      if (!Number.isInteger(pago)) throw new Error('Monto recibido inválido');
      if (pago < tot.total_comprobante) throw new Error('El efectivo recibido es menor al total');
      cambio = pago - tot.total_comprobante;
    }

    const numero = siguienteNumero(d, tipo);
    const cons = consecutivo(aj.sucursal, aj.terminal, tipo, numero);
    const ahora = new Date();
    const id = insertarComprobante(d, Object.assign({
      tipo, numero, consecutivo: cons, clave: clave(ahora, aj.cedula, cons, '1'), fecha_emision: fechaIso(ahora),
      turno_id: turno.id, medio_pago: medio,
      receptor_tipo_id: receptor ? receptor.tipo_id : null,
      receptor_identificacion: receptor ? receptor.identificacion : null,
      receptor_nombre: receptor ? receptor.nombre : null,
      receptor_correo: receptor ? receptor.correo : null,
      pago, cambio, referencia_id: null, referencia_razon: null
    }, tot));

    const insL = d.prepare(insLinea);
    const insM = d.prepare(`INSERT INTO movimientos(producto_id, fecha, tipo, cantidad, costo_unitario, comprobante_id)
                            VALUES(?, ?, 'venta', ?, ?, ?)`);
    const fl = fechaLocal(ahora);
    for (const l of lineas) {
      insL.run(Object.assign({ comprobante_id: id }, l));
      insM.run(l.producto_id, fl, -l.cantidad, l.costo_unitario, id);
    }

    if (receptor) {
      d.prepare(`INSERT INTO clientes(tipo_id, identificacion, nombre, correo) VALUES(@tipo_id, @identificacion, @nombre, @correo)
                 ON CONFLICT(identificacion) DO UPDATE SET nombre = excluded.nombre,
                   correo = CASE WHEN excluded.correo <> '' THEN excluded.correo ELSE clientes.correo END`).run(receptor);
    }
    registrar('venta', { id, consecutivo: cons, total: tot.total_comprobante, medio });
    return obtenerPorId(id);
  })();
}

/**
 * Nota de crédito TOTAL sobre una venta (devolución / corrección).
 * Devuelve el inventario y, si fue en efectivo, se descuenta del arqueo de caja.
 */
function notaCredito(comprobanteId, razon) {
  const d = obtener();
  const aj = leerAjustes();
  const motivo = String(razon || '').trim();
  if (!motivo) throw new Error('Indique el motivo de la nota de crédito');

  return d.transaction(() => {
    const orig = d.prepare('SELECT * FROM comprobantes WHERE id = ?').get(comprobanteId);
    if (!orig) throw new Error('El comprobante no existe');
    if (orig.tipo === '03') throw new Error('No se puede hacer nota de crédito sobre otra nota de crédito');
    const ya = d.prepare("SELECT consecutivo FROM comprobantes WHERE tipo = '03' AND referencia_id = ?").get(orig.id);
    if (ya) throw new Error('Esta venta ya tiene la nota de crédito ' + ya.consecutivo);
    const turno = turnoAbierto(d);
    if (!turno) throw new Error('La caja está cerrada: ábrala para registrar la devolución');

    const lineasOrig = d.prepare('SELECT * FROM comprobante_lineas WHERE comprobante_id = ? ORDER BY linea').all(orig.id);
    const numero = siguienteNumero(d, '03');
    const cons = consecutivo(aj.sucursal, aj.terminal, '03', numero);
    const ahora = new Date();
    const id = insertarComprobante(d, {
      tipo: '03', numero, consecutivo: cons, clave: clave(ahora, aj.cedula, cons, '1'), fecha_emision: fechaIso(ahora),
      turno_id: turno.id, medio_pago: orig.medio_pago,
      receptor_tipo_id: orig.receptor_tipo_id, receptor_identificacion: orig.receptor_identificacion,
      receptor_nombre: orig.receptor_nombre, receptor_correo: orig.receptor_correo,
      total_gravado: orig.total_gravado, total_exento: orig.total_exento, total_venta: orig.total_venta,
      total_impuesto: orig.total_impuesto, total_comprobante: orig.total_comprobante,
      pago: 0, cambio: 0, referencia_id: orig.id, referencia_razon: motivo
    });
    const insL = d.prepare(insLinea);
    const insM = d.prepare(`INSERT INTO movimientos(producto_id, fecha, tipo, cantidad, costo_unitario, comprobante_id, nota)
                            VALUES(?, ?, 'nota_credito', ?, ?, ?, ?)`);
    const fl = fechaLocal(ahora);
    for (const l of lineasOrig) {
      const copia = Object.assign({}, l, { comprobante_id: id });
      delete copia.id;
      insL.run(copia);
      if (l.producto_id) insM.run(l.producto_id, fl, l.cantidad, l.costo_unitario, id, 'Devolución de ' + orig.consecutivo);
    }
    registrar('nota_credito', { id, consecutivo: cons, referencia: orig.consecutivo, total: orig.total_comprobante, motivo });
    return obtenerPorId(id);
  })();
}

function obtenerPorId(id) {
  const d = obtener();
  const c = d.prepare('SELECT * FROM comprobantes WHERE id = ?').get(id);
  if (!c) return null;
  c.tipo_nombre = TIPOS[c.tipo];
  c.lineas = d.prepare('SELECT * FROM comprobante_lineas WHERE comprobante_id = ? ORDER BY linea').all(id);
  c.nota_credito = d.prepare("SELECT id, consecutivo, fecha_emision, referencia_razon FROM comprobantes WHERE tipo = '03' AND referencia_id = ?").get(id) || null;
  c.referencia = c.referencia_id ? d.prepare('SELECT id, tipo, consecutivo, fecha_emision FROM comprobantes WHERE id = ?').get(c.referencia_id) : null;
  return c;
}

/** Lista de comprobantes con filtros (más recientes primero). */
function listar({ desde, hasta, texto, tipo, limite = 300 } = {}) {
  const cond = [], par = {};
  if (desde) { cond.push('substr(c.fecha_emision, 1, 10) >= @desde'); par.desde = desde; }
  if (hasta) { cond.push('substr(c.fecha_emision, 1, 10) <= @hasta'); par.hasta = hasta; }
  if (tipo) { cond.push('c.tipo = @tipo'); par.tipo = tipo; }
  if (texto) { cond.push('(c.consecutivo LIKE @t OR c.receptor_nombre LIKE @t OR c.receptor_identificacion LIKE @t)'); par.t = '%' + texto + '%'; }
  par.limite = limite;
  return obtener().prepare(`
    SELECT c.id, c.tipo, c.numero, c.consecutivo, c.fecha_emision, c.medio_pago, c.receptor_nombre,
           c.total_comprobante, c.total_impuesto, c.estado_hacienda, c.referencia_id,
           (SELECT count(*) FROM comprobante_lineas l WHERE l.comprobante_id = c.id) AS lineas,
           (SELECT nc.consecutivo FROM comprobantes nc WHERE nc.tipo = '03' AND nc.referencia_id = c.id) AS nota_credito
    FROM comprobantes c ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
    ORDER BY c.id DESC LIMIT @limite`).all(par);
}

/** Clientes ya registrados (para facturar rápido a clientes frecuentes). */
function buscarClientes(texto, limite = 8) {
  const t = '%' + String(texto || '').trim() + '%';
  return obtener().prepare('SELECT * FROM clientes WHERE identificacion LIKE ? OR nombre LIKE ? ORDER BY nombre COLLATE NOCASE LIMIT ?').all(t, t, limite);
}

module.exports = { TIPOS, MEDIOS, emitir, notaCredito, obtenerPorId, listar, buscarClientes };
