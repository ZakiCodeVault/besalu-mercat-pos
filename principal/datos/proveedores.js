/**
 * proveedores.js — Ficha de cada proveedor y los productos que se le compran.
 *
 *  - Cada proveedor tiene su lista de productos con el último costo (sin IVA)
 *    y, si lo usa, su propio código para cada producto.
 *  - La lista se llena sola con cada compra registrada (ver aprender) y se
 *    puede armar o corregir a mano en la ficha. Al registrar una compra o una
 *    orden se elige el proveedor y sus productos ya vienen con su costo.
 *  - Un proveedor con compras u órdenes no se borra (es parte de la historia
 *    fiscal): se desactiva, y vuelve a activarse solo si llega otra compra suya.
 */
const { obtener, registrar } = require('./conexion');
const { fechaLocal } = require('./montos');

// Largo de la identificación según su tipo (Hacienda). 05 = extranjero: libre.
const LARGOS = { '01': [9], '02': [10], '03': [11, 12], '04': [10] };
const NOMBRE_TIPO = { '01': 'La cédula física', '02': 'La cédula jurídica', '03': 'El DIMEX', '04': 'El NITE' };

const limpiarId = (v) => String(v == null ? '' : v).replace(/[^\dA-Za-z]/g, '').toUpperCase();
const texto = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

function validarIdentificacion(tipo, id) {
  if (!['01', '02', '03', '04', '05'].includes(tipo)) throw new Error('Tipo de identificación inválido');
  if (!id) throw new Error('Falta la identificación del proveedor');
  const largos = LARGOS[tipo];
  if (largos) {
    const soloNumeros = tipo !== '02';   // la cédula jurídica puede traer letras (anexo de Hacienda 2026)
    if ((soloNumeros && !/^\d+$/.test(id)) || !largos.includes(id.length)) {
      throw new Error(NOMBRE_TIPO[tipo] + ' tiene ' + largos.join(' u ') + ' ' + (soloNumeros ? 'dígitos' : 'caracteres') + ', sin guiones ni espacios');
    }
  } else if (id.length > 20) throw new Error('La identificación del extranjero tiene máximo 20 caracteres');
}

function centimos(v, campo) {
  const n = Number(v == null || v === '' ? 0 : v);
  if (!Number.isInteger(n) || n < 0) throw new Error('Monto inválido en ' + campo + ' (se esperan céntimos enteros)');
  return n;
}

/** Cuántas compras y órdenes tiene (si tiene, no se borra ni se le cambia la identificación). */
function usos(d, id) {
  return d.prepare(`SELECT (SELECT count(*) FROM compras WHERE proveedor_id = @id) + (SELECT count(*) FROM ordenes_compra WHERE proveedor_id = @id) AS n`).get({ id }).n;
}

function listar({ texto: buscar = '', incluirInactivos = false } = {}) {
  const cond = [], par = {};
  if (!incluirInactivos) cond.push('p.activo = 1');
  if (buscar) { cond.push('(p.nombre LIKE @t OR p.nombre_comercial LIKE @t OR p.identificacion LIKE @t)'); par.t = '%' + String(buscar).trim() + '%'; }
  return obtener().prepare(`
    SELECT p.*,
      (SELECT count(*) FROM proveedor_productos pp JOIN productos x ON x.id = pp.producto_id WHERE pp.proveedor_id = p.id AND x.activo = 1) AS productos,
      (SELECT max(fecha) FROM compras c WHERE c.proveedor_id = p.id AND c.estado = 'vigente') AS ultima_compra,
      (SELECT count(*) FROM compras c WHERE c.proveedor_id = p.id AND c.estado = 'vigente') AS compras
    FROM proveedores p ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
    ORDER BY p.activo DESC, p.nombre COLLATE NOCASE`).all(par);
}

/** La ficha completa con sus productos (los activos primero). */
function obtenerPorId(id) {
  const d = obtener();
  const p = d.prepare('SELECT * FROM proveedores WHERE id = ?').get(id);
  if (!p) return null;
  p.usos = usos(d, p.id);
  // Para adelantar números: sus últimas facturas (de la más nueva a la más vieja)
  p.facturas_recientes = d.prepare('SELECT numero_documento FROM compras WHERE proveedor_id = ? ORDER BY id DESC LIMIT 3').all(p.id).map((f) => f.numero_documento);
  p.productos = d.prepare(`
    SELECT pp.producto_id, pp.codigo_proveedor, pp.costo, pp.ultima_compra,
           (SELECT cl.cantidad FROM compra_lineas cl JOIN compras c ON c.id = cl.compra_id
            WHERE c.proveedor_id = pp.proveedor_id AND cl.producto_id = pp.producto_id AND c.estado = 'vigente' ORDER BY c.id DESC LIMIT 1) AS ultima_cantidad,
           x.codigo, x.nombre, x.unidad, x.tarifa_iva, x.precio, x.costo AS costo_promedio, x.stock, x.stock_minimo, x.activo
    FROM proveedor_productos pp JOIN productos x ON x.id = pp.producto_id
    WHERE pp.proveedor_id = ? ORDER BY x.activo DESC, x.nombre COLLATE NOCASE`).all(p.id);
  return p;
}

function porIdentificacion(identificacion) {
  const p = obtener().prepare('SELECT id FROM proveedores WHERE identificacion = ?').get(limpiarId(identificacion));
  return p ? obtenerPorId(p.id) : null;
}

/**
 * Crea o actualiza la ficha. Si trae `productos`, esa pasa a ser su lista
 * (los que no vienen se quitan de la lista; no se toca nada más del producto).
 * @param {object} f { id?, tipo_id, identificacion, nombre, nombre_comercial?, telefono?, correo?, contacto?,
 *                     direccion?, notas?, dias_credito?, productos?: [{ producto_id, costo, codigo_proveedor? }] }
 */
function guardar(f) {
  const d = obtener();
  const datos = {
    tipo_id: String(f.tipo_id || '02'), identificacion: limpiarId(f.identificacion),
    nombre: texto(f.nombre, 160), nombre_comercial: texto(f.nombre_comercial, 160),
    telefono: texto(f.telefono, 40), correo: texto(f.correo, 160).toLowerCase(), contacto: texto(f.contacto, 120),
    direccion: texto(f.direccion, 300), notas: texto(f.notas, 500), dias_credito: Number(f.dias_credito || 0)
  };
  validarIdentificacion(datos.tipo_id, datos.identificacion);
  if (!datos.nombre) throw new Error('Falta el nombre del proveedor');
  if (datos.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.correo)) throw new Error('El correo del proveedor no es válido');
  if (!Number.isInteger(datos.dias_credito) || datos.dias_credito < 0 || datos.dias_credito > 365) throw new Error('Los días de crédito van de 0 a 365');

  return d.transaction(() => {
    const ahora = fechaLocal();
    const otro = d.prepare('SELECT id, nombre FROM proveedores WHERE identificacion = ?').get(datos.identificacion);
    let id = f.id ? Number(f.id) : null;
    if (id) {
      const actual = d.prepare('SELECT * FROM proveedores WHERE id = ?').get(id);
      if (!actual) throw new Error('El proveedor no existe');
      if (otro && otro.id !== id) throw new Error('Ya existe otro proveedor con esa identificación: ' + otro.nombre);
      if (actual.identificacion !== datos.identificacion && usos(d, id)) {
        throw new Error('No se puede cambiar la identificación: el proveedor ya tiene compras u órdenes registradas');
      }
      d.prepare(`UPDATE proveedores SET tipo_id=@tipo_id, identificacion=@identificacion, nombre=@nombre, nombre_comercial=@nombre_comercial,
                 telefono=@telefono, correo=@correo, contacto=@contacto, direccion=@direccion, notas=@notas, dias_credito=@dias_credito,
                 activo=1, actualizado_en=@ahora WHERE id=@id`).run(Object.assign({ id, ahora }, datos));
    } else {
      if (otro) throw new Error('Ya existe un proveedor con esa identificación: ' + otro.nombre);
      id = Number(d.prepare(`INSERT INTO proveedores(tipo_id, identificacion, nombre, nombre_comercial, telefono, correo, contacto, direccion, notas, dias_credito, actualizado_en)
                             VALUES(@tipo_id, @identificacion, @nombre, @nombre_comercial, @telefono, @correo, @contacto, @direccion, @notas, @dias_credito, @ahora)`)
        .run(Object.assign({ ahora }, datos)).lastInsertRowid);
    }

    let nProductos;
    if (Array.isArray(f.productos)) {
      const vistos = new Set(), codigos = new Map();
      const lista = f.productos.map((x, i) => {
        const producto = d.prepare('SELECT id, nombre FROM productos WHERE id = ?').get(Number(x.producto_id));
        if (!producto) throw new Error('Producto ' + (i + 1) + ' de la lista: no existe');
        if (vistos.has(producto.id)) throw new Error('"' + producto.nombre + '" está dos veces en la lista del proveedor');
        vistos.add(producto.id);
        const codigo = texto(x.codigo_proveedor, 40);
        if (codigo && codigos.has(codigo)) throw new Error('El código del proveedor ' + codigo + ' está en "' + codigos.get(codigo) + '" y en "' + producto.nombre + '"');
        if (codigo) codigos.set(codigo, producto.nombre);
        return { producto_id: producto.id, costo: centimos(x.costo, 'el costo de "' + producto.nombre + '"'), codigo_proveedor: codigo };
      });
      const actuales = d.prepare('SELECT producto_id FROM proveedor_productos WHERE proveedor_id = ?').all(id).map((r) => r.producto_id);
      const quitar = d.prepare('DELETE FROM proveedor_productos WHERE proveedor_id = ? AND producto_id = ?');
      for (const pid of actuales) if (!vistos.has(pid)) quitar.run(id, pid);
      // Primero se limpian los códigos para que un intercambio entre dos productos no choque con el índice único
      d.prepare("UPDATE proveedor_productos SET codigo_proveedor = '' WHERE proveedor_id = ?").run(id);
      const poner = d.prepare(`INSERT INTO proveedor_productos(proveedor_id, producto_id, codigo_proveedor, costo, actualizado_en)
                               VALUES(@proveedor_id, @producto_id, @codigo_proveedor, @costo, @ahora)
                               ON CONFLICT(proveedor_id, producto_id) DO UPDATE SET codigo_proveedor = excluded.codigo_proveedor,
                                 costo = excluded.costo, actualizado_en = excluded.actualizado_en`);
      for (const x of lista) poner.run(Object.assign({ proveedor_id: id, ahora }, x));
      nProductos = lista.length;
    }
    registrar('proveedor_guardado', { id, nombre: datos.nombre, identificacion: datos.identificacion, productos: nProductos });
    return obtenerPorId(id);
  })();
}

/** Borra un proveedor que nunca se usó; si tiene compras u órdenes, lo desactiva. */
function eliminar(id) {
  const d = obtener();
  const p = d.prepare('SELECT * FROM proveedores WHERE id = ?').get(id);
  if (!p) throw new Error('El proveedor no existe');
  return d.transaction(() => {
    if (usos(d, p.id)) {
      d.prepare('UPDATE proveedores SET activo = 0, actualizado_en = ? WHERE id = ?').run(fechaLocal(), p.id);
      registrar('proveedor_desactivado', { id: p.id, nombre: p.nombre });
      return { desactivado: true };
    }
    d.prepare('DELETE FROM proveedor_productos WHERE proveedor_id = ?').run(p.id);
    d.prepare('DELETE FROM proveedores WHERE id = ?').run(p.id);
    registrar('proveedor_eliminado', { id: p.id, nombre: p.nombre });
    return { eliminado: true };
  })();
}

/**
 * Lo que entra con una compra queda en la lista del proveedor con su costo.
 * Si se registra una factura más vieja que la última, no pisa el costo más reciente.
 * (Se llama dentro de la transacción de la compra.)
 */
function aprender(d, proveedorId, productoId, costo, fecha, codigoProveedor) {
  d.prepare(`INSERT INTO proveedor_productos(proveedor_id, producto_id, costo, ultima_compra, actualizado_en) VALUES(?, ?, ?, ?, ?)
             ON CONFLICT(proveedor_id, producto_id) DO UPDATE SET
               costo = CASE WHEN excluded.ultima_compra >= proveedor_productos.ultima_compra THEN excluded.costo ELSE proveedor_productos.costo END,
               ultima_compra = max(proveedor_productos.ultima_compra, excluded.ultima_compra),
               actualizado_en = excluded.actualizado_en`).run(proveedorId, productoId, costo, fecha, fechaLocal());
  // El código propio del proveedor (de su XML) se guarda si el producto no tenía uno y ningún otro producto suyo lo usa
  if (codigoProveedor) {
    d.prepare(`UPDATE proveedor_productos SET codigo_proveedor = @c WHERE proveedor_id = @p AND producto_id = @x AND codigo_proveedor = ''
               AND NOT EXISTS (SELECT 1 FROM proveedor_productos WHERE proveedor_id = @p AND codigo_proveedor = @c)`)
      .run({ c: codigoProveedor, p: proveedorId, x: productoId });
  }
}

module.exports = { listar, obtenerPorId, porIdentificacion, guardar, eliminar, aprender, validarIdentificacion };
