/**
 * datos.prueba.js — Pruebas de la capa de datos (integridad fiscal).
 *
 * Usa una base temporal. Incluye intentos deliberados de romper las reglas
 * (editar una venta emitida, borrar movimientos, saltar consecutivos...)
 * para comprobar que la base de datos los rechaza.
 *
 * Uso:  npm run prueba:datos
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const D = require('../principal/datos');
const { conexion, productos, ventas, compras, caja, reportes, respaldos } = D;

let ok = 0, fallas = 0;
function prueba(nombre, fn) {
  try { const det = fn(); ok++; console.log('  ✔ ' + nombre + (det ? '  — ' + det : '')); }
  catch (e) { fallas++; console.log('  ✘ ' + nombre + '  — ' + e.message); }
}
async function pruebaAsync(nombre, fn) {
  try { const det = await fn(); ok++; console.log('  ✔ ' + nombre + (det ? '  — ' + det : '')); }
  catch (e) { fallas++; console.log('  ✘ ' + nombre + '  — ' + e.message); }
}
function igual(a, b, msg) { if (a !== b) throw new Error((msg || 'valor') + ': esperado ' + JSON.stringify(b) + ', obtenido ' + JSON.stringify(a)); }
function falla(fn, texto) {
  try { fn(); } catch (e) { if (texto && !String(e.message).includes(texto)) throw new Error('Error inesperado: ' + e.message); return e.message; }
  throw new Error('Debía fallar y no falló');
}
const sql = (q, ...p) => conexion.obtener().prepare(q).run(...p);
const uno = (q, ...p) => conexion.obtener().prepare(q).get(...p);

(async () => {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'besalu-datos-'));
  conexion.abrir(carpeta);
  respaldos.configurar(carpeta);
  console.log('\nPruebas de la capa de datos  (' + carpeta + ')\n');

  console.log('Base y configuración');
  prueba('Protecciones activas (WAL, FULL, claves foráneas)', () => {
    const d = conexion.obtener();
    igual(d.pragma('journal_mode', { simple: true }), 'wal', 'journal_mode');
    igual(d.pragma('synchronous', { simple: true }), 2, 'synchronous FULL');
    igual(d.pragma('foreign_keys', { simple: true }), 1, 'foreign_keys');
    return 'esquema v' + d.pragma('user_version', { simple: true });
  });
  prueba('Sin cédula no se puede emitir', () => {
    caja.abrir(0);
    const p = productos.crear({ codigo: 'X1', nombre: 'Prueba', precio: 10000, tarifa_iva: 13, stock_inicial: 5 });
    falla(() => ventas.emitir({ lineas: [{ producto_id: p.id, cantidad: 1 }], medio_pago: 'tarjeta' }), 'cédula');
    igual(uno("SELECT ultimo FROM secuencias WHERE tipo='04'").ultimo, 0, 'el consecutivo no debe avanzar');
    caja.cerrar(0);
  });
  prueba('Guardar ajustes del negocio', () => {
    const a = conexion.guardarAjustes({ cedula: '3-101-123456', sucursal: '1', terminal: '1' });
    igual(a.cedula, '3101123456'); igual(a.sucursal, '001'); igual(a.terminal, '00001');
  });

  console.log('\nProductos');
  let leche, cafe;
  prueba('Crear productos con stock inicial (kárdex)', () => {
    leche = productos.crear({ codigo: '7441001100118', nombre: 'Leche Dos Pinos 1L', cabys: '2211000000000', tarifa_iva: 1, precio: 125000, costo: 98000, stock_inicial: 20 });
    cafe = productos.crear({ codigo: '7441008800187', nombre: 'Café Rey 500g', tarifa_iva: 13, precio: 365000, costo: 265000, stock_inicial: 10 });
    igual(leche.stock, 20); igual(cafe.stock, 10);
    igual(productos.kardex(leche.id)[0].tipo, 'inicial');
  });
  prueba('Rechaza CABYS inválido, tarifa inválida, montos no enteros y código repetido', () => {
    falla(() => productos.crear({ codigo: 'A', nombre: 'A', cabys: '123', precio: 100 }), 'CABYS');
    falla(() => productos.crear({ codigo: 'B', nombre: 'B', tarifa_iva: 5, precio: 100 }), 'Tarifa');
    falla(() => productos.crear({ codigo: 'C', nombre: 'C', precio: 12.5 }), 'céntimos');
    falla(() => productos.crear({ codigo: '7441001100118', nombre: 'Otra', precio: 100 }), 'UNIQUE');
  });

  console.log('\nVentas');
  prueba('No se vende con la caja cerrada', () => {
    falla(() => ventas.emitir({ lineas: [{ producto_id: leche.id, cantidad: 1 }], medio_pago: 'tarjeta' }), 'caja está cerrada');
  });
  prueba('Solo un turno abierto a la vez', () => {
    caja.abrir(5000000);
    falla(() => caja.abrir(0), 'Ya hay una caja abierta');
    falla(() => sql('INSERT INTO turnos(abierto_en, fondo) VALUES(?, 0)', 'x'), 'UNIQUE');
  });
  let t1;
  prueba('Tiquete: IVA por tarifa, consecutivo y clave', () => {
    t1 = ventas.emitir({ lineas: [{ producto_id: leche.id, cantidad: 3 }, { producto_id: cafe.id, cantidad: 1 }], medio_pago: 'efectivo', pago: 1000000 });
    igual(t1.tipo, '04');
    igual(t1.total_comprobante, 375000 + 365000, 'total');
    // Leche: 3750 con 1% -> base 3713, IVA 37 · Café: 3650 con 13% -> base 3230, IVA 420
    igual(t1.lineas[0].subtotal + t1.lineas[0].impuesto, 375000);
    igual(t1.lineas[0].impuesto, 3713, 'IVA leche (céntimos)');
    igual(t1.lineas[1].impuesto, 41991, 'IVA café (céntimos)');
    igual(t1.cambio, 1000000 - 740000, 'cambio');
    igual(t1.consecutivo, '00100001040000000001', 'consecutivo');
    igual(t1.clave.length, 50); igual(t1.clave.slice(0, 3), '506'); igual(t1.clave.slice(9, 21), '003101123456', 'cédula en clave');
    igual(t1.clave.slice(21, 41), t1.consecutivo, 'consecutivo en clave');
    return t1.consecutivo + ' · total ₡' + t1.total_comprobante / 100;
  });
  prueba('La venta descuenta inventario (kárdex)', () => {
    igual(productos.obtenerPorId(leche.id).stock, 17); igual(productos.obtenerPorId(cafe.id).stock, 9);
    igual(productos.kardex(leche.id)[0].tipo, 'venta');
  });
  prueba('Precios: los toma de la base, no de la pantalla', () => {
    const v = ventas.emitir({ lineas: [{ producto_id: leche.id, cantidad: 1, precio: 1 }], medio_pago: 'tarjeta' });
    igual(v.total_comprobante, 125000);
  });
  prueba('Errores no consumen consecutivo (stock insuficiente / pago menor)', () => {
    const antes = uno("SELECT ultimo FROM secuencias WHERE tipo='04'").ultimo;
    falla(() => ventas.emitir({ lineas: [{ producto_id: cafe.id, cantidad: 999 }], medio_pago: 'tarjeta' }), 'Stock insuficiente');
    falla(() => ventas.emitir({ lineas: [{ producto_id: cafe.id, cantidad: 1 }], medio_pago: 'efectivo', pago: 100 }), 'menor al total');
    igual(uno("SELECT ultimo FROM secuencias WHERE tipo='04'").ultimo, antes, 'consecutivo');
  });
  let f1;
  prueba('Factura con cliente (01) y cliente guardado', () => {
    falla(() => ventas.emitir({ lineas: [{ producto_id: leche.id, cantidad: 1 }], medio_pago: 'sinpe', receptor: { identificacion: '112345678' } }), 'nombre');
    f1 = ventas.emitir({ lineas: [{ producto_id: cafe.id, cantidad: 2 }], medio_pago: 'sinpe', receptor: { tipo_id: '01', identificacion: '1-1234-5678', nombre: 'Ana Mora', correo: 'ana@correo.cr' } });
    igual(f1.tipo, '01'); igual(f1.consecutivo.slice(8, 10), '01'); igual(f1.receptor_identificacion, '112345678');
    igual(uno("SELECT nombre FROM clientes WHERE identificacion='112345678'").nombre, 'Ana Mora');
  });

  console.log('\nIntegridad: intentos de alterar registros (deben fallar)');
  prueba('Editar una venta emitida', () => falla(() => sql('UPDATE comprobantes SET total_comprobante = 1 WHERE id = ?', t1.id), 'no se puede modificar'));
  prueba('Borrar una venta emitida', () => falla(() => sql('DELETE FROM comprobantes WHERE id = ?', t1.id), 'no se puede borrar'));
  prueba('Editar / borrar líneas de comprobante', () => {
    falla(() => sql('UPDATE comprobante_lineas SET cantidad = 99 WHERE comprobante_id = ?', t1.id), 'no se puede modificar');
    falla(() => sql('DELETE FROM comprobante_lineas WHERE comprobante_id = ?', t1.id), 'no se puede borrar');
  });
  prueba('Editar / borrar movimientos del kárdex', () => {
    falla(() => sql('UPDATE movimientos SET cantidad = 1000'), 'no se puede modificar');
    falla(() => sql('DELETE FROM movimientos'), 'no se puede borrar');
  });
  prueba('Saltar o repetir consecutivos', () => {
    falla(() => sql("UPDATE secuencias SET ultimo = ultimo + 5 WHERE tipo = '04'"), 'de 1 en 1');
    falla(() => sql("UPDATE secuencias SET ultimo = 0 WHERE tipo = '04'"), 'de 1 en 1');
  });
  prueba('Insertar un comprobante con número fuera de secuencia', () =>
    falla(() => sql(`INSERT INTO comprobantes(tipo, numero, consecutivo, clave, fecha_emision, medio_pago, total_gravado, total_exento, total_venta, total_impuesto, total_comprobante)
                     VALUES('04', 999, '00100001040000000999', ?, '2026-01-01', 'efectivo', 0, 0, 0, 0, 0)`, '5'.repeat(50)), 'no coincide'));
  prueba('Totales que no cuadran', () =>
    falla(() => sql(`INSERT INTO comprobante_lineas(comprobante_id, linea, codigo, descripcion, cantidad, precio_unitario, subtotal, tarifa_iva, impuesto, total_linea)
                     VALUES(?, 50, 'x', 'x', 1, 100, 100, 13, 13, 999)`, t1.id), 'CHECK'));
  prueba('Sí se puede actualizar el estado del envío a Hacienda', () => {
    sql("UPDATE comprobantes SET estado_hacienda = 'enviado', hacienda_intentos = 1 WHERE id = ?", t1.id);
    igual(uno('SELECT estado_hacienda FROM comprobantes WHERE id = ?', t1.id).estado_hacienda, 'enviado');
  });

  console.log('\nNotas de crédito');
  let nc;
  prueba('Requiere motivo', () => falla(() => ventas.notaCredito(t1.id, '  '), 'motivo'));
  prueba('Nota de crédito total: referencia, devuelve inventario', () => {
    const lecheAntes = productos.obtenerPorId(leche.id).stock;
    nc = ventas.notaCredito(t1.id, 'Cliente devolvió la compra');
    igual(nc.tipo, '03'); igual(nc.referencia_id, t1.id); igual(nc.total_comprobante, t1.total_comprobante);
    igual(nc.consecutivo.slice(8, 10), '03');
    igual(productos.obtenerPorId(leche.id).stock, lecheAntes + 3);
    igual(ventas.obtenerPorId(t1.id).nota_credito.id, nc.id);
    return nc.consecutivo;
  });
  prueba('No se puede acreditar dos veces ni acreditar una nota de crédito', () => {
    falla(() => ventas.notaCredito(t1.id, 'otra vez'), 'ya tiene');
    falla(() => ventas.notaCredito(nc.id, 'x'), 'otra nota de crédito');
  });

  console.log('\nCompras (entradas)');
  let compra;
  prueba('Factura de compra: producto existente + producto nuevo + gasto', () => {
    const cafeAntes = productos.obtenerPorId(cafe.id);
    compra = compras.registrarCompra({
      proveedor: { tipo_id: '02', identificacion: '3-101-999999', nombre: 'Distribuidora Central S.A.' },
      numero_documento: '00100001010000004521', clave: '5'.repeat(50), fecha: '2026-10-10',
      lineas: [
        { producto_id: cafe.id, cantidad: 10, costo_unitario: 285000, tarifa_iva: 13 },
        { nuevo_producto: { codigo: '7441010100101', nombre: 'Coca-Cola 2L', precio: 169000, tarifa_iva: 13 }, cantidad: 24, costo_unitario: 120000, tarifa_iva: 13 },
        { descripcion: 'Bolsas plásticas (gasto)', cantidad: 1, costo_unitario: 500000, tarifa_iva: 13 }
      ]
    });
    igual(compra.lineas.length, 3);
    igual(compra.impuesto, Math.round(2850000 * 0.13) + Math.round(2880000 * 0.13) + Math.round(500000 * 0.13), 'IVA de la compra');
    const cafeDespues = productos.obtenerPorId(cafe.id);
    igual(cafeDespues.stock, cafeAntes.stock + 10, 'stock café');
    const esperado = Math.round((cafeAntes.stock * cafeAntes.costo + 10 * 285000) / (cafeAntes.stock + 10));
    igual(cafeDespues.costo, esperado, 'costo promedio ponderado');
    igual(productos.buscarPorCodigo('7441010100101').stock, 24, 'producto nuevo con su stock');
    return 'IVA pagado ₡' + compra.impuesto / 100;
  });
  prueba('No se registra la misma factura dos veces', () => {
    falla(() => compras.registrarCompra({ proveedor: { identificacion: '3101999999', nombre: 'Distribuidora Central S.A.' }, numero_documento: '00100001010000004521', fecha: '2026-10-10',
      lineas: [{ producto_id: cafe.id, cantidad: 1, costo_unitario: 1, tarifa_iva: 13 }] }), 'ya fue registrada');
    falla(() => compras.registrarCompra({ proveedor: { identificacion: '999', nombre: 'Otro' }, numero_documento: 'X-1', clave: '5'.repeat(50), fecha: '2026-10-10',
      lineas: [{ producto_id: cafe.id, cantidad: 1, costo_unitario: 1, tarifa_iva: 13 }] }), 'ya fue registrada');
  });
  prueba('No acepta facturas de compra con fecha futura', () => {
    falla(() => compras.registrarCompra({ proveedor: { identificacion: '3101777777', nombre: 'Futuro S.A.' }, numero_documento: 'F-1', fecha: '2999-01-01',
      lineas: [{ producto_id: cafe.id, cantidad: 1, costo_unitario: 1, tarifa_iva: 13 }] }), 'posterior a hoy');
  });
  prueba('Montos exactos del XML del proveedor se respetan', () => {
    const c = compras.registrarCompra({ proveedor: { identificacion: '3101888888', nombre: 'Lácteos S.A.' }, numero_documento: 'FE-77', fecha: '2026-10-11',
      lineas: [{ producto_id: leche.id, cantidad: 12, costo_unitario: 97500, tarifa_iva: 1, subtotal: 1170000, impuesto: 11700 }] });
    igual(c.subtotal, 1170000); igual(c.impuesto, 11700); igual(c.total, 1181700);
  });
  prueba('Una compra no se edita ni se borra', () => {
    falla(() => sql('UPDATE compras SET total = 1 WHERE id = ?', compra.id), 'no se puede modificar');
    falla(() => sql('DELETE FROM compras WHERE id = ?', compra.id), 'no se puede borrar');
  });
  prueba('Anular compra revierte inventario y no se reactiva', () => {
    const coca = productos.buscarPorCodigo('7441010100101');
    const a = compras.anular(compra.id, 'Factura mal digitada');
    igual(a.estado, 'anulada'); igual(productos.obtenerPorId(coca.id).stock, 0);
    falla(() => compras.anular(compra.id, 'x'), 'ya estaba anulada');
    falla(() => sql("UPDATE compras SET estado = 'vigente' WHERE id = ?", compra.id), 'no se puede reactivar');
  });

  console.log('\nReportes');
  prueba('IVA a pagar = ventas − devoluciones − compras vigentes', () => {
    const r = reportes.iva('2000-01-01', '2100-12-31');
    const ventasIva = uno("SELECT sum(l.impuesto) s FROM comprobante_lineas l JOIN comprobantes c ON c.id=l.comprobante_id WHERE c.tipo IN ('01','04')").s;
    const ncIva = uno("SELECT sum(l.impuesto) s FROM comprobante_lineas l JOIN comprobantes c ON c.id=l.comprobante_id WHERE c.tipo='03'").s;
    const comprasIva = uno("SELECT sum(impuesto) s FROM compras WHERE estado='vigente'").s;
    igual(r.debito_fiscal, ventasIva - ncIva, 'débito'); igual(r.credito_fiscal, comprasIva, 'crédito (excluye la anulada)');
    igual(r.iva_a_pagar, ventasIva - ncIva - comprasIva, 'a pagar');
    return 'débito ₡' + r.debito_fiscal / 100 + ' − crédito ₡' + r.credito_fiscal / 100 + ' = ₡' + r.iva_a_pagar / 100;
  });
  prueba('Balance: ventas netas, costo, utilidad, entradas y salidas', () => {
    const b = reportes.balance('2000-01-01', '2100-12-31');
    if (b.utilidad_bruta !== b.ventas_netas - b.costo_ventas) throw new Error('utilidad');
    if (!(b.unidades_entradas > 0 && b.unidades_salidas > 0)) throw new Error('entradas/salidas');
    return 'ventas ₡' + b.ventas_netas / 100 + ' · costo ₡' + b.costo_ventas / 100 + ' · margen ' + b.margen + '%';
  });

  console.log('\nCaja');
  prueba('Arqueo: fondo + efectivo − devoluciones en efectivo', () => {
    const r = caja.resumen(caja.actual().id);
    igual(r.efectivo_esperado, 5000000 + t1.total_comprobante - nc.total_comprobante);
    const z = caja.cerrar(r.efectivo_esperado - 50000);
    igual(z.turno.diferencia, -50000, 'faltante');
  });
  prueba('Un turno cerrado no se modifica', () => {
    const t = caja.historial(1)[0];
    falla(() => sql('UPDATE turnos SET contado = 0 WHERE id = ?', t.id), 'no se puede modificar');
  });

  console.log('\nVerificación, respaldo y restauración');
  prueba('Verificación de integridad sin problemas', () => {
    const v = conexion.verificarIntegridad();
    if (!v.ok) throw new Error(v.problemas.join(' | '));
  });
  prueba('Detecta y repara un stock alterado a mano', () => {
    sql('UPDATE productos SET stock = 999 WHERE id = ?', leche.id);
    const v = conexion.verificarIntegridad();
    if (v.ok) throw new Error('no detectó el descuadre');
    igual(conexion.repararStock(), 1);
    if (!conexion.verificarIntegridad().ok) throw new Error('no reparó');
  });
  let respaldo;
  await pruebaAsync('Respaldo verificado', async () => {
    respaldo = await respaldos.crear('prueba');
    const v = respaldos.verificarArchivo(respaldo.ruta);
    if (!v.ok) throw new Error(v.detalle);
    return respaldo.archivo + ' · ' + v.comprobantes + ' comprobantes';
  });
  await pruebaAsync('Restaurar vuelve al estado del respaldo', async () => {
    caja.abrir(0);
    ventas.emitir({ lineas: [{ producto_id: leche.id, cantidad: 1 }], medio_pago: 'tarjeta' });
    const conVenta = uno('SELECT count(*) n FROM comprobantes').n;
    const r = await respaldos.restaurar(respaldo.archivo);
    igual(uno('SELECT count(*) n FROM comprobantes').n, conVenta - 1);
    if (!respaldos.listar().some((f) => f.archivo.includes('antes-de-restaurar'))) throw new Error('falta copia previa');
    return r.comprobantes + ' comprobantes restaurados';
  });

  console.log('\nVelocidad');
  prueba('2.000 ventas seguidas', () => {
    caja.abrir(0);
    productos.ajustarStock(leche.id, 100000, 'Carga para prueba de velocidad');
    productos.ajustarStock(cafe.id, 100000, 'Carga para prueba de velocidad');
    const t0 = Date.now();
    for (let i = 0; i < 2000; i++) ventas.emitir({ lineas: [{ producto_id: leche.id, cantidad: 1 }, { producto_id: cafe.id, cantidad: 1 }], medio_pago: 'tarjeta' });
    const ms = Date.now() - t0;
    if (!conexion.verificarIntegridad().ok) throw new Error('integridad');
    return (ms / 2000).toFixed(2) + ' ms por venta';
  });
  prueba('Reportes sobre 2.000+ ventas', () => {
    const t0 = Date.now();
    reportes.iva('2000-01-01', '2100-12-31'); reportes.balance('2000-01-01', '2100-12-31');
    reportes.ventasPorDia('2000-01-01', '2100-12-31'); reportes.masVendidos('2000-01-01', '2100-12-31'); ventas.listar({ limite: 300 });
    return (Date.now() - t0) + ' ms todos juntos';
  });

  conexion.cerrar();
  fs.rmSync(carpeta, { recursive: true, force: true });
  console.log('\n' + (fallas ? '✘ ' + fallas + ' fallaron, ' + ok + ' pasaron' : '✔ Todas las pruebas pasaron (' + ok + ')') + '\n');
  process.exit(fallas ? 1 : 0);
})();
