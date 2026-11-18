/**
 * inventario.prueba.js — Órdenes de compra, recepciones, inventario y copias.
 *
 *  - Ciclo completo de una orden de compra y todas sus protecciones.
 *  - Recepciones parciales, de más, de otro proveedor, anuladas…
 *  - Simulación al azar de cientos de operaciones mezcladas (ventas, notas de
 *    crédito, órdenes, recepciones, anulaciones, ajustes) comparando la base
 *    contra un modelo independiente.
 *  - Copias completas: exportar, cargar, archivos inválidos, versiones.
 *  - Exportar todo a Excel (verificado con openpyxl si está instalado).
 *
 * Uso:  npm run prueba:inventario
 */
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const Database = require('better-sqlite3');
const datos = require('../principal/datos');
const exportar = require('../principal/exportar');
const { MIGRACIONES } = require('../principal/datos/esquema');

const { conexion, productos, ventas, compras, ordenes, caja, respaldos } = datos;

const resultados = [];
async function prueba(nombre, fn) {
  try {
    const detalle = await fn();
    resultados.push(true);
    console.log('  ✔ ' + nombre + (detalle ? '  — ' + detalle : ''));
  } catch (e) {
    resultados.push(false);
    console.log('  ✘ ' + nombre + '\n      ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n      ') : e));
  }
}
function ok(c, m) { if (!c) throw new Error(m || 'falló'); }
function falla(fn, texto) {
  try { fn(); } catch (e) {
    if (texto && !String(e.message).includes(texto)) throw new Error('Error distinto: ' + e.message);
    return e.message;
  }
  throw new Error('Debía fallar' + (texto ? ' con "' + texto + '"' : ''));
}
const sql = (q, ...p) => conexion.obtener().prepare(q).run(...p);
const fila = (q, ...p) => conexion.obtener().prepare(q).get(...p);
const stock = (id) => productos.obtenerPorId(id).stock;
const r3 = (x) => Math.round(x * 1000) / 1000;
const hoy = () => datos.montos.fechaLocal().slice(0, 10);

const PROV_A = { tipo_id: '02', identificacion: '3101999999', nombre: 'Distribuidora Central S.A.' };
const PROV_B = { tipo_id: '02', identificacion: '3101888888', nombre: 'Lácteos del Valle S.A.' };
let factura = 0;
const nuevaFactura = () => 'F-' + (++factura);

async function correr() {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'besalu-inventario-'));
  conexion.abrir(carpeta);
  respaldos.configurar(carpeta);
  conexion.guardarAjustes({ cedula: '3101123456', negocio: 'Besalú Mercat S.A.', stockMin: 5 });
  const leche = productos.crear({ codigo: '7441001100118', nombre: 'Leche Dos Pinos 1L', tarifa_iva: 1, precio: 125000, costo: 98000, stock_minimo: 10, stock_inicial: 5 });
  const galletas = productos.crear({ codigo: '7441099900011', nombre: 'Galletas Pozuelo', tarifa_iva: 13, precio: 95500, costo: 65000, stock_minimo: 6, stock_inicial: 2 });
  const cafe = productos.crear({ codigo: '7440000000101', nombre: 'Café Britt 340g', tarifa_iva: 1, precio: 590000, costo: 420000, stock_inicial: 20 });
  const viejo = productos.crear({ codigo: 'VIEJO-1', nombre: 'Producto descontinuado', tarifa_iva: 13, precio: 1000, costo: 500 });
  productos.eliminar(viejo.id);   // nunca usado → se borra
  const descontinuado = productos.crear({ codigo: 'DESC-1', nombre: 'Descontinuado', tarifa_iva: 13, precio: 1000, costo: 500, stock_inicial: 1 });
  productos.eliminar(descontinuado.id);   // tiene movimiento → se desactiva
  caja.abrir(5000000);

  console.log('\nÓrdenes de compra · borrador');
  let oc1;
  await prueba('Crear borrador: sin número, montos calculados por el sistema', () => {
    oc1 = ordenes.guardarBorrador({ proveedor: PROV_A, fecha_esperada: hoy(), notas: 'Entregar en la mañana',
      lineas: [{ producto_id: leche.id, cantidad: 10, costo_unitario: 97500, subtotal: 1, impuesto: 1 },   // montos de la pantalla: se ignoran
               { producto_id: galletas.id, cantidad: 12, costo_unitario: 65000, tarifa_iva: 13 }] });
    ok(oc1.estado === 'borrador' && oc1.numero === null && oc1.numero_texto === 'Borrador');
    ok(oc1.subtotal === 10 * 97500 + 12 * 65000, 'subtotal ' + oc1.subtotal);
    ok(oc1.impuesto === Math.round(10 * 97500 * 0.01) + Math.round(12 * 65000 * 0.13), 'impuesto ' + oc1.impuesto);
    ok(oc1.lineas[0].tarifa_iva === 1, 'la tarifa sale del producto');
    return oc1.lineas.length + ' productos · ₡' + oc1.total / 100;
  });
  await prueba('No acepta el mismo producto dos veces, productos desactivados ni cantidades o costos inválidos', () => {
    falla(() => ordenes.guardarBorrador({ proveedor: PROV_A, lineas: [{ producto_id: leche.id, cantidad: 1, costo_unitario: 1 }, { producto_id: leche.id, cantidad: 2, costo_unitario: 1 }] }), 'dos veces');
    falla(() => ordenes.guardarBorrador({ proveedor: PROV_A, lineas: [{ producto_id: descontinuado.id, cantidad: 1, costo_unitario: 1 }] }), 'desactivado');
    falla(() => ordenes.guardarBorrador({ proveedor: PROV_A, lineas: [{ producto_id: leche.id, cantidad: 0, costo_unitario: 1 }] }), 'Cantidad inválida');
    falla(() => ordenes.guardarBorrador({ proveedor: PROV_A, lineas: [{ producto_id: leche.id, cantidad: 1, costo_unitario: 10.5 }] }), 'céntimos');
    falla(() => ordenes.guardarBorrador({ proveedor: { identificacion: '', nombre: 'X' }, lineas: [] }), 'identificación del proveedor');
  });
  await prueba('Editar y borrar un borrador', () => {
    const b = ordenes.guardarBorrador({ proveedor: PROV_B, lineas: [{ producto_id: cafe.id, cantidad: 3, costo_unitario: 420000 }] });
    const b2 = ordenes.guardarBorrador({ id: b.id, proveedor: PROV_B, lineas: [{ producto_id: cafe.id, cantidad: 5, costo_unitario: 410000 }, { producto_id: leche.id, cantidad: 1, costo_unitario: 97000 }] });
    ok(b2.id === b.id && b2.lineas.length === 2 && b2.lineas[0].cantidad === 5);
    ordenes.eliminarBorrador(b.id);
    ok(!ordenes.obtenerPorId(b.id) && !fila('SELECT count(*) AS n FROM orden_compra_lineas WHERE orden_id = ?', b.id).n);
  });
  await prueba('Emitir asigna números seguidos (los borradores no gastan números)', () => {
    const vacia = ordenes.guardarBorrador({ proveedor: PROV_B, lineas: [] });
    falla(() => ordenes.emitir(vacia.id), 'no tiene productos');
    ordenes.eliminarBorrador(vacia.id);
    oc1 = ordenes.emitir(oc1.id);
    ok(oc1.numero === 1 && oc1.numero_texto === 'OC-00001' && oc1.estado_visible === 'emitida');
    falla(() => ordenes.emitir(oc1.id), 'ya fue emitida');
    return oc1.numero_texto;
  });
  await prueba('Una orden emitida no se puede cambiar ni borrar (lo impide la base)', () => {
    falla(() => sql('UPDATE orden_compra_lineas SET cantidad = 99 WHERE orden_id = ?', oc1.id), 'no se pueden cambiar');
    falla(() => sql('DELETE FROM orden_compra_lineas WHERE orden_id = ?', oc1.id), 'no se pueden cambiar');
    falla(() => sql("INSERT INTO orden_compra_lineas(orden_id, linea, producto_id, descripcion, cantidad, costo_unitario, tarifa_iva, subtotal, impuesto, total_linea) VALUES(?, 9, ?, 'x', 1, 1, 13, 1, 0, 1)", oc1.id, cafe.id), 'no se pueden cambiar');
    falla(() => sql('UPDATE ordenes_compra SET total = 1, subtotal = 1, impuesto = 0 WHERE id = ?', oc1.id), 'no se puede modificar');
    falla(() => sql("UPDATE ordenes_compra SET estado = 'borrador' WHERE id = ?", oc1.id), 'no está permitido');
    falla(() => sql('UPDATE ordenes_compra SET numero = 7 WHERE id = ?', oc1.id), 'no se puede cambiar');
    falla(() => sql('DELETE FROM ordenes_compra WHERE id = ?', oc1.id), 'no se puede borrar');
    falla(() => ordenes.guardarBorrador({ id: oc1.id, proveedor: PROV_A, lineas: [] }), 'ya fue emitida');
  });

  console.log('\nRecepción de mercadería');
  const lineaDe = (o, productoId) => o.lineas.find((l) => l.producto_id === productoId);
  await prueba('Recepción parcial: suma al inventario, costo promedio y la orden queda en parte', () => {
    const antes = stock(leche.id);
    const l = lineaDe(oc1, leche.id);
    compras.registrarCompra({ orden_id: oc1.id, numero_documento: nuevaFactura(), fecha: hoy(), lineas: [{ orden_linea_id: l.id, cantidad: 6, costo_unitario: 97000, tarifa_iva: 1 }] });
    ok(stock(leche.id) === antes + 6, 'stock ' + stock(leche.id));
    ok(productos.obtenerPorId(leche.id).costo === Math.round((5 * 98000 + 6 * 97000) / 11), 'costo promedio');
    const o = ordenes.obtenerPorId(oc1.id);
    ok(o.estado_visible === 'parcial' && lineaDe(o, leche.id).pendiente === 4 && lineaDe(o, galletas.id).pendiente === 12);
    return o.estado_nombre + ' · ' + o.avance + '%';
  });
  await prueba('No recibe más de lo que falta sin confirmarlo; confirmado sí', () => {
    const l = lineaDe(oc1, leche.id);
    const antes = stock(leche.id);
    falla(() => compras.registrarCompra({ orden_id: oc1.id, numero_documento: nuevaFactura(), fecha: hoy(), lineas: [{ orden_linea_id: l.id, cantidad: 5, costo_unitario: 97000, tarifa_iva: 1 }] }), 'solo faltan 4');
    // Dos líneas de la misma factura que juntas se pasan también se detectan
    falla(() => compras.registrarCompra({ orden_id: oc1.id, numero_documento: nuevaFactura(), fecha: hoy(),
      lineas: [{ orden_linea_id: l.id, cantidad: 3, costo_unitario: 97000, tarifa_iva: 1 }, { orden_linea_id: l.id, cantidad: 3, costo_unitario: 97000, tarifa_iva: 1 }] }), 'se reciben 6');
    ok(stock(leche.id) === antes, 'nada cambió');
    const g = lineaDe(oc1, galletas.id);
    compras.registrarCompra({ orden_id: oc1.id, numero_documento: nuevaFactura(), fecha: hoy(), permitir_exceso: true,
      lineas: [{ orden_linea_id: g.id, cantidad: 14, costo_unitario: 65000, tarifa_iva: 13 }] });
    ok(lineaDe(ordenes.obtenerPorId(oc1.id), galletas.id).recibido === 14);
  });
  await prueba('Rechaza otro proveedor, líneas de otra orden, producto cambiado y órdenes sin emitir', () => {
    const l = lineaDe(oc1, leche.id);
    falla(() => compras.registrarCompra({ orden_id: oc1.id, proveedor: PROV_B, numero_documento: nuevaFactura(), fecha: hoy(), lineas: [{ orden_linea_id: l.id, cantidad: 1, costo_unitario: 1, tarifa_iva: 1 }] }), 'es de Lácteos');
    falla(() => compras.registrarCompra({ orden_id: oc1.id, numero_documento: nuevaFactura(), fecha: hoy(), lineas: [{ orden_linea_id: l.id, producto_id: cafe.id, cantidad: 1, costo_unitario: 1, tarifa_iva: 1 }] }), 'no es el de la orden');
    const otra = ordenes.emitir(ordenes.guardarBorrador({ proveedor: PROV_A, lineas: [{ producto_id: cafe.id, cantidad: 2, costo_unitario: 1000 }] }).id);
    falla(() => compras.registrarCompra({ orden_id: oc1.id, numero_documento: nuevaFactura(), fecha: hoy(), lineas: [{ orden_linea_id: otra.lineas[0].id, cantidad: 1, costo_unitario: 1, tarifa_iva: 1 }] }), 'no pertenece');
    falla(() => compras.registrarCompra({ numero_documento: nuevaFactura(), proveedor: PROV_A, fecha: hoy(), lineas: [{ orden_linea_id: l.id, cantidad: 1, costo_unitario: 1, tarifa_iva: 1 }] }), 'no está ligada');
    const borrador = ordenes.guardarBorrador({ proveedor: PROV_A, lineas: [{ producto_id: cafe.id, cantidad: 1, costo_unitario: 1000 }] });
    falla(() => compras.registrarCompra({ orden_id: borrador.id, numero_documento: nuevaFactura(), fecha: hoy(), lineas: [{ orden_linea_id: borrador.lineas[0].id, cantidad: 1, costo_unitario: 1, tarifa_iva: 1 }] }), 'no está abierta');
    ordenes.eliminarBorrador(borrador.id);
    ordenes.cancelar(otra.id, 'Prueba');
    // La base también lo impide aunque alguien se salte la app
    falla(() => sql("INSERT INTO compras(proveedor_id, numero_documento, fecha, subtotal, impuesto, total, orden_id) VALUES((SELECT id FROM proveedores WHERE identificacion = '3101888888'), 'X-1', ?, 0, 0, 0, ?)", hoy(), oc1.id), 'otro proveedor');
  });
  await prueba('Productos de más que no estaban en la orden entran como líneas extra', () => {
    const antes = stock(cafe.id);
    const l = lineaDe(oc1, leche.id);
    compras.registrarCompra({ orden_id: oc1.id, numero_documento: nuevaFactura(), fecha: hoy(),
      lineas: [{ orden_linea_id: l.id, cantidad: 4, costo_unitario: 97000, tarifa_iva: 1 }, { producto_id: cafe.id, cantidad: 2, costo_unitario: 415000, tarifa_iva: 1 }] });
    ok(stock(cafe.id) === antes + 2);
    const o = ordenes.obtenerPorId(oc1.id);
    ok(o.estado_visible === 'recibida' && o.avance === 100, o.estado_visible);
    ok(!ordenes.enCamino()[leche.id], 'ya no está en camino');
    return o.estado_nombre;
  });
  await prueba('La misma factura no se registra dos veces', () => {
    const o = ordenes.emitir(ordenes.guardarBorrador({ proveedor: PROV_A, lineas: [{ producto_id: leche.id, cantidad: 5, costo_unitario: 97000 }] }).id);
    compras.registrarCompra({ orden_id: o.id, numero_documento: 'DUP-1', fecha: hoy(), lineas: [{ orden_linea_id: o.lineas[0].id, cantidad: 2, costo_unitario: 97000, tarifa_iva: 1 }] });
    falla(() => compras.registrarCompra({ orden_id: o.id, numero_documento: 'DUP-1', fecha: hoy(), lineas: [{ orden_linea_id: o.lineas[0].id, cantidad: 2, costo_unitario: 97000, tarifa_iva: 1 }] }), 'ya fue registrada');
  });
  await prueba('Anular una recepción saca la mercadería y la orden vuelve a quedar pendiente', () => {
    const recep = ordenes.obtenerPorId(oc1.id).recepciones.find((r) => r.estado === 'vigente');
    const antes = stock(leche.id);
    compras.anular(recep.id, 'Factura equivocada');
    ok(stock(leche.id) === antes - 6, 'stock');
    const o = ordenes.obtenerPorId(oc1.id);
    ok(o.estado_visible === 'parcial' && lineaDe(o, leche.id).pendiente === 6, o.estado_visible);
    ok(ordenes.enCamino()[leche.id] >= 6, 'vuelve a estar en camino');
    falla(() => compras.anular(recep.id, 'otra vez'), 'ya estaba anulada');
  });
  await prueba('Anular una compra ya vendida avisa que la existencia quedaría negativa', () => {
    const p = productos.crear({ codigo: 'NEG-1', nombre: 'Vino', tarifa_iva: 13, precio: 890000, costo: 500000 });
    const c = compras.registrarCompra({ proveedor: PROV_A, numero_documento: nuevaFactura(), fecha: hoy(), lineas: [{ producto_id: p.id, cantidad: 3, costo_unitario: 500000, tarifa_iva: 13 }] });
    ventas.emitir({ lineas: [{ producto_id: p.id, cantidad: 2 }], medio_pago: 'tarjeta' });
    const revision = compras.revisarAnulacion(c.id);
    ok(revision.length === 1 && revision[0].quedaria === -2, JSON.stringify(revision));
    falla(() => compras.anular(c.id, 'Error'), 'quedarían existencias negativas');
    ok(stock(p.id) === 1, 'no se anuló');
    compras.anular(c.id, 'Error confirmado', { permitirNegativo: true });
    ok(stock(p.id) === -2);
    productos.ajustarStock(p.id, 0, 'Conteo físico');
  });
  await prueba('Cerrar con faltante y cancelar: reglas y protecciones', () => {
    falla(() => ordenes.cerrar(oc1.id, ''), 'Indique');
    const sinNada = ordenes.emitir(ordenes.guardarBorrador({ proveedor: PROV_B, lineas: [{ producto_id: cafe.id, cantidad: 4, costo_unitario: 400000 }] }).id);
    falla(() => ordenes.cerrar(sinNada.id, 'Ya no viene'), 'cancélela');
    ordenes.cancelar(sinNada.id, 'Proveedor sin existencias');
    falla(() => ordenes.cancelar(oc1.id, 'x'), 'ciérrela');
    ordenes.cerrar(oc1.id, 'El proveedor no tiene más leche');
    const o = ordenes.obtenerPorId(oc1.id);
    ok(o.estado === 'cerrada' && o.lineas.every((l) => l.pendiente === 0) && !ordenes.enCamino()[leche.id] === !ordenes.enCamino()[leche.id]);
    falla(() => compras.registrarCompra({ orden_id: oc1.id, numero_documento: nuevaFactura(), fecha: hoy(), lineas: [{ orden_linea_id: o.lineas[0].id, cantidad: 1, costo_unitario: 1, tarifa_iva: 1 }] }), 'no está abierta');
    falla(() => sql("UPDATE ordenes_compra SET estado = 'emitida' WHERE id = ?", oc1.id), 'no está permitido');
    return o.estado_nombre;
  });
  await prueba('Sugerencias de pedido: bajo el mínimo, descontando lo que ya viene en camino', () => {
    const s0 = ordenes.sugerencias();
    const g0 = s0.find((x) => x.producto_id === galletas.id);
    ok(!g0, 'galletas tiene existencia suficiente');
    const papel = productos.crear({ codigo: 'PAP-1', nombre: 'Papel higiénico', tarifa_iva: 13, precio: 300000, costo: 200000, stock_minimo: 8, stock_inicial: 3 });
    const s1 = ordenes.sugerencias().find((x) => x.producto_id === papel.id);
    ok(s1 && s1.sugerido === 16 - 3 && s1.en_camino === 0, JSON.stringify(s1));
    const o = ordenes.emitir(ordenes.guardarBorrador({ proveedor: PROV_B, lineas: [{ producto_id: papel.id, cantidad: 4, costo_unitario: 200000 }] }).id);
    const s2 = ordenes.sugerencias().find((x) => x.producto_id === papel.id);
    ok(s2 && s2.en_camino === 4 && s2.sugerido === 16 - 7, JSON.stringify(s2));
    compras.registrarCompra({ orden_id: o.id, numero_documento: nuevaFactura(), fecha: hoy(), lineas: [{ orden_linea_id: o.lineas[0].id, cantidad: 4, costo_unitario: 200000, tarifa_iva: 13 }] });
    ok(ordenes.sugerencias({ proveedor_id: fila("SELECT id FROM proveedores WHERE identificacion = '3101999999'").id }).every((x) => x.producto_id !== papel.id),
      'filtra por el último proveedor');
    return 'pedir ' + s1.sugerido + ' → ' + s2.sugerido + ' con 4 en camino';
  });

  console.log('\nInventario');
  await prueba('Un producto en una orden no se borra (se desactiva)', () => {
    const p = productos.crear({ codigo: 'ORD-1', nombre: 'Solo pedido', tarifa_iva: 13, precio: 1000, costo: 500 });
    ordenes.guardarBorrador({ proveedor: PROV_A, lineas: [{ producto_id: p.id, cantidad: 1, costo_unitario: 500 }] });
    ok(productos.eliminar(p.id).desactivado === true);
  });
  await prueba('La existencia solo cambia con el kárdex (lo impide la base)', () => {
    falla(() => sql('UPDATE productos SET stock = stock + 1 WHERE id = ?', cafe.id), 'solo cambia con movimientos');
    ok(conexion.verificarIntegridad().ok, JSON.stringify(conexion.verificarIntegridad().problemas));
  });

  console.log('\nSimulación al azar (base contra un modelo independiente)');
  await prueba('1 500 operaciones mezcladas: existencias, recibido y en camino siempre cuadran', () => {
    let semilla = 20261117;
    const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648);
    const entre = (a, b) => a + Math.floor(azar() * (b - a + 1));
    const elegir = (lista) => lista[Math.floor(azar() * lista.length)];
    const prods = [];
    for (let i = 0; i < 12; i++) prods.push(productos.crear({ codigo: 'SIM-' + i, nombre: 'Simulado ' + i, tarifa_iva: [1, 13][i % 2], precio: 10000 + i * 100, costo: 5000 + i * 50, stock_minimo: 5, stock_inicial: entre(0, 20) }));
    const modelo = new Map(prods.map((p) => [p.id, p.stock]));
    const ventasHechas = [];
    const comprasVig = [];          // { id, lineas:[{producto_id, cantidad, orden_linea_id}] }
    const recibidoModelo = new Map();
    const abiertas = [];
    const cuenta = {};
    const sumar = (k) => (cuenta[k] = (cuenta[k] || 0) + 1);
    for (let i = 0; i < 1500; i++) {
      const op = entre(1, 100);
      try {
        if (op <= 35) {                                   // venta
          const conStock = prods.filter((p) => modelo.get(p.id) >= 1);
          if (!conStock.length) continue;
          const p = elegir(conStock);
          const cant = entre(1, Math.min(3, Math.floor(modelo.get(p.id))));
          const v = ventas.emitir({ lineas: [{ producto_id: p.id, cantidad: cant }], medio_pago: 'tarjeta' });
          modelo.set(p.id, r3(modelo.get(p.id) - cant));
          ventasHechas.push({ id: v.id, producto_id: p.id, cantidad: cant });
          sumar('ventas');
        } else if (op <= 42) {                            // nota de crédito
          const v = ventasHechas.filter((x) => !x.nc);
          if (!v.length) continue;
          const x = elegir(v);
          ventas.notaCredito(x.id, 'Devolución');
          x.nc = true;
          modelo.set(x.producto_id, r3(modelo.get(x.producto_id) + x.cantidad));
          sumar('notas de crédito');
        } else if (op <= 55) {                            // orden nueva emitida
          const lineas = [...new Set(Array.from({ length: entre(1, 4) }, () => elegir(prods).id))]
            .map((id) => ({ producto_id: id, cantidad: entre(1, 30), costo_unitario: entre(1000, 9000) }));
          const o = ordenes.emitir(ordenes.guardarBorrador({ proveedor: elegir([PROV_A, PROV_B]), lineas }).id);
          for (const l of o.lineas) recibidoModelo.set(l.id, 0);
          abiertas.push(o.id);
          sumar('órdenes');
        } else if (op <= 80) {                            // recepción (a veces de más)
          if (!abiertas.length) continue;
          const o = ordenes.obtenerPorId(elegir(abiertas));
          const pend = o.lineas.filter((l) => l.pendiente > 0);
          if (!pend.length) continue;
          const exceso = azar() < 0.1;
          const lineas = pend.filter(() => azar() < 0.7).map((l) => ({ orden_linea_id: l.id, cantidad: exceso ? r3(l.pendiente + entre(1, 3)) : entre(1, Math.ceil(l.pendiente)), costo_unitario: l.costo_unitario, tarifa_iva: l.tarifa_iva }))
            .map((x) => (exceso ? x : Object.assign(x, { cantidad: Math.min(x.cantidad, o.lineas.find((l) => l.id === x.orden_linea_id).pendiente) })));
          if (!lineas.length) continue;
          const c = compras.registrarCompra({ orden_id: o.id, numero_documento: nuevaFactura(), fecha: hoy(), permitir_exceso: exceso, lineas });
          const ls = lineas.map((l) => ({ producto_id: o.lineas.find((x) => x.id === l.orden_linea_id).producto_id, cantidad: l.cantidad, orden_linea_id: l.orden_linea_id }));
          for (const l of ls) { modelo.set(l.producto_id, r3(modelo.get(l.producto_id) + l.cantidad)); recibidoModelo.set(l.orden_linea_id, r3(recibidoModelo.get(l.orden_linea_id) + l.cantidad)); }
          comprasVig.push({ id: c.id, lineas: ls });
          sumar('recepciones');
        } else if (op <= 85) {                            // anular una recepción (aunque deje negativo)
          if (!comprasVig.length) continue;
          const idx = Math.floor(azar() * comprasVig.length);
          const c = comprasVig.splice(idx, 1)[0];
          compras.anular(c.id, 'Simulación', { permitirNegativo: true });
          for (const l of c.lineas) { modelo.set(l.producto_id, r3(modelo.get(l.producto_id) - l.cantidad)); recibidoModelo.set(l.orden_linea_id, r3(recibidoModelo.get(l.orden_linea_id) - l.cantidad)); }
          sumar('anulaciones');
        } else if (op <= 93) {                            // conteo físico
          const p = elegir(prods);
          const contado = entre(0, 25);
          productos.ajustarStock(p.id, contado, 'Conteo');
          modelo.set(p.id, contado);
          sumar('ajustes');
        } else {                                          // cerrar o cancelar una orden
          if (!abiertas.length) continue;
          const idx = Math.floor(azar() * abiertas.length);
          const o = ordenes.obtenerPorId(abiertas[idx]);
          const algo = o.lineas.some((l) => l.recibido > 0);
          if (algo) ordenes.cerrar(o.id, 'Simulación'); else ordenes.cancelar(o.id, 'Simulación');
          abiertas.splice(idx, 1);
          sumar(algo ? 'cierres' : 'cancelaciones');
        }
      } catch (e) {
        throw new Error('Operación ' + i + ' (' + op + '): ' + e.message);
      }
    }
    for (const p of prods) {
      const db = stock(p.id);
      const kardex = r3(fila('SELECT coalesce(sum(cantidad), 0) AS s FROM movimientos WHERE producto_id = ?', p.id).s);
      ok(db === modelo.get(p.id) && kardex === db, p.nombre + ': base ' + db + ', modelo ' + modelo.get(p.id) + ', kárdex ' + kardex);
    }
    for (const [lineaId, esperado] of recibidoModelo) {
      const a = fila('SELECT recibido FROM orden_compra_avance WHERE orden_linea_id = ?', lineaId);
      ok(r3(a.recibido) === esperado, 'línea ' + lineaId + ': recibido ' + a.recibido + ' vs ' + esperado);
    }
    const camino = ordenes.enCamino();
    for (const p of prods) {
      const esperado = r3(conexion.obtener().prepare(`SELECT coalesce(sum(max(a.pedido - a.recibido, 0)), 0) AS s FROM orden_compra_avance a JOIN ordenes_compra o ON o.id = a.orden_id
        WHERE o.estado = 'emitida' AND a.producto_id = ?`).get(p.id).s);
      ok((camino[p.id] || 0) === esperado, 'en camino de ' + p.nombre);
    }
    ok(conexion.verificarIntegridad().ok, JSON.stringify(conexion.verificarIntegridad().problemas));
    return Object.entries(cuenta).map(([k, v]) => v + ' ' + k).join(', ');
  });

  console.log('\nCopias completas');
  const destino = path.join(carpeta, 'copia-usb.sqlite');
  let copia;
  await prueba('Exportar copia completa (verificada)', async () => {
    copia = await respaldos.exportarCopia(destino);
    ok(copia.ok && fs.existsSync(destino) && !fs.existsSync(destino + '.parcial'));
    ok(copia.ordenes === fila('SELECT count(*) AS n FROM ordenes_compra').n && copia.productos === fila('SELECT count(*) AS n FROM productos').n);
    return Math.round(copia.bytes / 1024) + ' KB · ' + copia.productos + ' productos · ' + copia.ordenes + ' órdenes';
  });
  await prueba('Cargar la copia devuelve todo como estaba (y guarda antes el estado actual)', async () => {
    const ventasAntes = fila('SELECT count(*) AS n FROM comprobantes').n;
    ventas.emitir({ lineas: [{ producto_id: cafe.id, cantidad: 1 }], medio_pago: 'tarjeta' });
    const r = await respaldos.restaurar(destino);
    ok(r.ok && fila('SELECT count(*) AS n FROM comprobantes').n === ventasAntes, 'la venta posterior ya no está');
    ok(respaldos.listar().some((x) => /antes-de-restaurar/.test(x.archivo)), 'copia del estado anterior');
    ok(conexion.verificarIntegridad().ok);
  });
  await prueba('Un archivo que no es copia de Besalú se rechaza sin tocar nada', async () => {
    const malo = path.join(carpeta, 'foto.sqlite');
    fs.writeFileSync(malo, 'esto no es una base de datos');
    const productosAntes = fila('SELECT count(*) AS n FROM productos').n;
    let e = null;
    try { await respaldos.restaurar(malo); } catch (x) { e = x; }
    ok(e && /no es una base de datos/.test(e.message), e && e.message);
    const otra = path.join(carpeta, 'otra-app.sqlite');
    const db = new Database(otra); db.exec('CREATE TABLE notas(x)'); db.close();
    e = null;
    try { await respaldos.restaurar(otra); } catch (x) { e = x; }
    ok(e && /no es una copia de Besalú/.test(e.message), e && e.message);
    ok(fila('SELECT count(*) AS n FROM productos').n === productosAntes);
  });
  await prueba('Una copia de una versión más nueva de la app no se carga', async () => {
    const nueva = path.join(carpeta, 'nueva.sqlite');
    fs.copyFileSync(destino, nueva);
    const db = new Database(nueva); db.pragma('user_version = 99'); db.close();
    let e = null;
    try { await respaldos.restaurar(nueva); } catch (x) { e = x; }
    ok(e && /versión más nueva/.test(e.message), e && e.message);
  });
  await prueba('Una copia de una versión anterior se carga y se actualiza sola', async () => {
    const vieja = path.join(carpeta, 'version-2.sqlite');
    const db = new Database(vieja);
    db.exec(MIGRACIONES[0]); db.exec(MIGRACIONES[1]); db.pragma('user_version = 2');
    db.prepare("INSERT INTO productos(codigo, nombre, precio) VALUES('V2', 'De la versión 2', 1000)").run();
    db.close();
    const r = await respaldos.restaurar(vieja);
    ok(r.ok && conexion.obtener().pragma('user_version', { simple: true }) === MIGRACIONES.length);
    ok(productos.buscarPorCodigo('V2') && fila('SELECT count(*) AS n FROM ordenes_compra').n === 0);
    return 'versión 2 → ' + MIGRACIONES.length;
  });
  await prueba('Si la copia falla al abrirse, se deja todo como estaba', async () => {
    await respaldos.restaurar(destino);   // vuelve a la copia completa
    const productosAntes = fila('SELECT count(*) AS n FROM productos').n;
    const rota = path.join(carpeta, 'rota.sqlite');
    const db = new Database(rota);
    db.exec(MIGRACIONES[0]); db.exec(MIGRACIONES[1]); db.exec(MIGRACIONES[2]); db.exec(MIGRACIONES[3]);
    db.exec('DROP TABLE compra_lineas');   // la versión 5 no podrá actualizarla
    db.pragma('user_version = 4'); db.close();
    let e = null;
    try { await respaldos.restaurar(rota); } catch (x) { e = x; }
    ok(e && /se dejó todo como estaba/.test(e.message), e && e.message);
    ok(fila('SELECT count(*) AS n FROM productos').n === productosAntes && conexion.verificarIntegridad().ok);
  });

  console.log('\nExportar todo a Excel');
  await prueba('Libro .xlsx con todas las hojas y sus datos', () => {
    const archivo = path.join(carpeta, 'todo.xlsx');
    fs.writeFileSync(archivo, exportar.todoExcel());
    let python = null;
    try { python = execFileSync('python3', ['-c', 'import openpyxl'], { stdio: 'pipe' }) !== null; } catch (e) { python = false; }
    if (!python) { execFileSync('unzip', ['-t', archivo], { stdio: 'pipe' }); return 'sin openpyxl: solo se verificó el ZIP'; }
    const salida = execFileSync('python3', ['-c', `
import openpyxl, json, sys
wb = openpyxl.load_workbook(sys.argv[1])
print(json.dumps({ws.title: ws.max_row - 1 for ws in wb.worksheets}))`, archivo]).toString();
    const hojas = JSON.parse(salida);
    const esperado = { 'Productos': fila('SELECT count(*) AS n FROM productos').n, 'Movimientos': fila('SELECT count(*) AS n FROM movimientos').n,
      'Ventas': fila('SELECT count(*) AS n FROM comprobantes').n, 'Compras': fila('SELECT count(*) AS n FROM compras').n,
      'Órdenes de compra': fila('SELECT count(*) AS n FROM orden_compra_lineas').n };
    for (const [h, n] of Object.entries(esperado)) ok(hojas[h] === n, h + ': ' + hojas[h] + ' filas, se esperaban ' + n);
    ok(Object.keys(hojas).length === 10, Object.keys(hojas).join(', '));
    return Object.keys(hojas).length + ' hojas · ' + esperado.Movimientos + ' movimientos';
  });

  const fallas = resultados.filter((r) => !r).length;
  console.log('\n' + (fallas ? '✘ ' + fallas + ' prueba(s) fallaron' : '✔ Todas las pruebas pasaron (' + resultados.length + ')') + '\n');
  conexion.cerrar();
  fs.rmSync(carpeta, { recursive: true, force: true });
  app.exit(fallas ? 1 : 0);
}

app.whenReady().then(() => correr().catch((e) => { console.error('Error en la prueba:', e); app.exit(1); }));
