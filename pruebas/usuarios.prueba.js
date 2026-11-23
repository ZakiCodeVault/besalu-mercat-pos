/**
 * usuarios.prueba.js — Usuarios con rol y PIN, y relevos de cajero sin cerrar la caja.
 *
 *  - Perfiles sin PIN que la persona crea la primera vez; reglas del PIN,
 *    PIN único, bloqueo por intentos, siempre un administrador activo,
 *    reiniciar el PIN y el código de recuperación.
 *  - Quién hizo cada cosa (comprobantes, compras, ajustes, bitácora) y que
 *    eso no se puede cambiar después.
 *  - Relevos: lo que recibe cada cajero, lo esperado, lo contado y la
 *    diferencia de cada tramo; la suma de los tramos es la del turno; una caja
 *    abierta antes de existir los usuarios queda a cargo de quien ingresa.
 *
 * Uso:  npm run prueba:usuarios
 */
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const datos = require('../principal/datos');

const { conexion, productos, ventas, caja, usuarios, sesion, compras } = datos;

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
const fila = (q, ...p) => conexion.obtener().prepare(q).get(...p);

async function correr() {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'besalu-usuarios-'));
  conexion.abrir(carpeta);
  conexion.guardarAjustes({ cedula: '3101123456', negocio: 'Besalú Mercat S.A.' });
  const leche = productos.crear({ codigo: '7441001100116', nombre: 'Leche 1 L', tarifa_iva: 1, precio: 125000, costo: 98000, stock_inicial: 100 });

  console.log('\nUsuarios y PIN');
  let admin, v1, v2, codigo;
  await prueba('El primer usuario es administrador, con su PIN y un código de recuperación', () => {
    falla(() => usuarios.crearPrimerAdmin({ nombre: 'Administración', pin: '1234' }), 'serie');
    falla(() => usuarios.crearPrimerAdmin({ nombre: 'Administración', pin: '7777' }), 'repetido');
    falla(() => usuarios.crearPrimerAdmin({ nombre: 'Administración', pin: '12a4' }), '4 a 8 números');
    const r = usuarios.crearPrimerAdmin({ nombre: 'Administración', pin: '2580', correo: 'Admin@Besalu.cr' });
    admin = r.usuario; codigo = r.codigoRecuperacion;
    ok(admin.rol === 'admin' && admin.tiene_pin === 1 && admin.correo === 'admin@besalu.cr' && /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(codigo), codigo);
    falla(() => usuarios.crearPrimerAdmin({ nombre: 'Otro', pin: '1357' }), 'Ya hay usuarios');
    const guardado = fila('SELECT pin_hash, pin_sal FROM usuarios WHERE id = ?', admin.id);
    ok(guardado.pin_hash.length === 64 && !JSON.stringify(guardado).includes('2580'), 'el PIN no se guarda tal cual');
    return admin.nombre + ' · código ' + codigo.slice(0, 4) + '-…';
  });

  await prueba('El administrador crea los vendedores sin PIN; cada uno crea el suyo la primera vez', () => {
    v1 = usuarios.crear({ nombre: 'Vendedor 1', rol: 'cajero', correo: 'v1@correo.cr' });
    v2 = usuarios.crear({ nombre: 'Vendedor 2', rol: 'cajero', correo: 'v2@correo.cr' });
    ok(v1.tiene_pin === 0 && v1.rol_nombre === 'Vendedor');
    falla(() => usuarios.crear({ nombre: 'vendedor 1', rol: 'cajero' }), 'Ya hay un usuario llamado');
    falla(() => usuarios.crear({ nombre: 'X', rol: 'jefe' }), 'Rol inválido');
    falla(() => usuarios.crear({ nombre: 'X', rol: 'cajero', correo: 'mal@' }), 'correo');
    falla(() => usuarios.verificar(v1.id, '1111'), 'todavía no tiene PIN');
    usuarios.crearMiPin(v1.id, '4826');
    falla(() => usuarios.crearMiPin(v1.id, '9999'), 'ya tiene PIN');
    falla(() => usuarios.crearMiPin(v2.id, '4826'), 'ya lo usa otra persona');   // PIN único: también sirve para autorizar
    falla(() => usuarios.crearMiPin(v2.id, '2580'), 'ya lo usa otra persona');
    usuarios.crearMiPin(v2.id, '3917');
    ok(usuarios.verificar(v1.id, '4826').nombre === 'Vendedor 1' && usuarios.verificar(v2.id, '3917').nombre === 'Vendedor 2');
    return '2 vendedores con su propio PIN';
  });

  await prueba('5 PIN incorrectos bloquean ese usuario 60 segundos (los demás siguen entrando)', () => {
    for (let i = 1; i <= 4; i++) falla(() => usuarios.verificar(v2.id, '0000'), 'PIN incorrecto');
    falla(() => usuarios.verificar(v2.id, '0000'), 'bloqueado 60 segundos');
    falla(() => usuarios.verificar(v2.id, '3917'), 'Demasiados intentos');
    ok(usuarios.verificar(v1.id, '4826'), 'otro usuario no queda bloqueado');
    const n = fila("SELECT count(*) AS n FROM bitacora WHERE accion = 'ingreso_fallido'").n;
    ok(n === 5, 'quedan en la bitácora: ' + n);
    return 'bloqueado';
  });

  await prueba('Siempre queda un administrador activo; reiniciar el PIN; código de recuperación', () => {
    falla(() => usuarios.actualizar(admin.id, { rol: 'cajero' }), 'al menos un administrador');
    falla(() => usuarios.actualizar(admin.id, { activo: false }), 'al menos un administrador');
    usuarios.reiniciarPin(v2.id);
    ok(usuarios.obtenerPorId(v2.id).tiene_pin === 0);
    usuarios.crearMiPin(v2.id, '6142');   // la persona crea uno nuevo (y se le quita el bloqueo)
    ok(usuarios.verificar(v2.id, '6142'));
    falla(() => usuarios.recuperar('AAAA-BBBB-CCCC', admin.id, '8642'), 'incorrecto');
    const r = usuarios.recuperar(codigo.toLowerCase(), admin.id, '8642');
    ok(usuarios.verificar(admin.id, '8642') && r.codigoRecuperacion !== codigo, 'PIN nuevo y otro código');
    falla(() => usuarios.recuperar(codigo, admin.id, '1470'), 'incorrecto');   // el código viejo ya no sirve
    falla(() => conexion.obtener().prepare('DELETE FROM usuarios WHERE id = ?').run(v1.id), 'se desactiva');
    return 'recuperado';
  });

  await prueba('Permisos por rol y autorización con el PIN de un administrador', () => {
    ok(usuarios.puede('cajero', 'vender') && usuarios.puede('cajero', 'relevo') && !usuarios.puede('cajero', 'devolver') && !usuarios.puede('cajero', 'ajustes'));
    ok(usuarios.puede('encargado', 'compras') && !usuarios.puede('encargado', 'usuarios') && usuarios.puede('admin', 'usuarios'));
    falla(() => usuarios.autorizador('6142', 'devolver'), 'sin permiso');   // un vendedor no autoriza
    ok(usuarios.autorizador('8642', 'devolver').id === admin.id);
    return 'cajero: vender, relevo y etiquetas';
  });

  console.log('\nQuién hizo cada cosa');
  let turno;
  await prueba('Apertura, venta, devolución autorizada, compra y ajuste quedan con su usuario', () => {
    sesion.iniciar(v1);
    turno = caja.abrir(2000000);
    const tramo = caja.tramoAbierto(turno.id);
    ok(turno.abierto_por === v1.id && tramo && tramo.usuario_id === v1.id && tramo.recibido === 2000000 && tramo.origen === 'apertura');
    const v = ventas.emitir({ lineas: [{ producto_id: leche.id, cantidad: 2 }], medio_pago: 'efectivo', pago: 300000 });
    const c = fila('SELECT usuario_id, tramo_id, autorizado_por FROM comprobantes WHERE id = ?', v.id);
    ok(c.usuario_id === v1.id && c.tramo_id === tramo.id && c.autorizado_por === null);
    // Devolución: la hace el vendedor con la autorización del administrador
    const nc = sesion.conAutorizado(admin, () => ventas.notaCredito(v.id, 'Cliente devolvió'));
    const cn = fila('SELECT usuario_id, autorizado_por FROM comprobantes WHERE id = ?', nc.id);
    ok(cn.usuario_id === v1.id && cn.autorizado_por === admin.id, JSON.stringify(cn));
    const b = fila("SELECT usuario FROM bitacora WHERE accion = 'nota_credito' OR accion LIKE 'nota%' ORDER BY id DESC LIMIT 1");
    ok(b && b.usuario === 'Vendedor 1 (autorizó Administración)', b && b.usuario);
    sesion.iniciar(admin);
    const comp = compras.registrarCompra({ proveedor: { tipo_id: '02', identificacion: '3101777777', nombre: 'Lácteos' }, numero_documento: 'U-1',
      fecha: datos.montos.fechaLocal().slice(0, 10), lineas: [{ producto_id: leche.id, cantidad: 6, costo_unitario: 98000, tarifa_iva: 1 }] });
    ok(fila('SELECT usuario_id FROM compras WHERE id = ?', comp.id).usuario_id === admin.id);
    productos.ajustarStock(leche.id, 100, 'Conteo');
    ok(fila("SELECT usuario_id FROM movimientos WHERE tipo = 'ajuste' ORDER BY id DESC LIMIT 1").usuario_id === admin.id);
    // Lo emitido no cambia de dueño
    falla(() => conexion.obtener().prepare('UPDATE comprobantes SET usuario_id = ? WHERE id = ?').run(admin.id, v.id), 'quién lo hizo');
    falla(() => conexion.obtener().prepare('UPDATE compras SET usuario_id = ? WHERE id = ?').run(v1.id, comp.id), 'quién la hizo');
    sesion.iniciar(v1);
    return 'venta, devolución (autorizó Administración), compra y ajuste';
  });

  console.log('\nRelevo de cajero sin cerrar la caja');
  await prueba('Relevo: el que sale entrega lo contado, el que entra empieza con eso', () => {
    // Vendedor 1: recibió ₡20 000, vendió 1 leche en efectivo (₡1 250) → esperado ₡21 250 (la venta devuelta se compensó)
    ventas.emitir({ lineas: [{ producto_id: leche.id, cantidad: 1 }], medio_pago: 'efectivo', pago: 125000 });
    ventas.emitir({ lineas: [{ producto_id: leche.id, cantidad: 1 }], medio_pago: 'tarjeta' });
    const antes = caja.resumenTramo(caja.tramoAbierto(turno.id).id);
    ok(antes.efectivo_esperado === 2000000 + 125000, 'esperado ' + antes.efectivo_esperado);
    falla(() => caja.relevo(2120000, v1.id), 'ya tiene la caja');
    const r = caja.relevo(2120000, v2.id);   // faltan ₡50
    ok(r.saliente.tramo.contado === 2120000 && r.saliente.tramo.diferencia === -5000 && r.saliente.tramo.entrega_a === v2.id, JSON.stringify(r.saliente.tramo));
    ok(r.entrante.usuario_id === v2.id && r.entrante.recibido === 2120000 && r.entrante.origen === 'relevo');
    ok(caja.actual() && caja.actual().id === turno.id, 'la caja sigue abierta (mismo turno)');
    falla(() => conexion.obtener().prepare('UPDATE caja_tramos SET contado = 0 WHERE id = ?').run(r.saliente.tramo.id), 'Tramo de caja cerrado');
    return 'faltaron ₡50 al entregar · Vendedor 2 recibe ₡21 200';
  });

  await prueba('Cierre Z con dos tramos: la suma de las diferencias es la del turno', () => {
    sesion.iniciar(v2);
    ventas.emitir({ lineas: [{ producto_id: leche.id, cantidad: 4 }], medio_pago: 'efectivo', pago: 500000 });
    const t2 = caja.resumenTramo(caja.tramoAbierto(turno.id).id);
    ok(t2.efectivo_esperado === 2120000 + 500000 && t2.comprobantes === 1, 'esperado tramo 2 ' + t2.efectivo_esperado);
    sesion.iniciar(admin);
    const z = caja.cerrar(2620000);   // Vendedor 2 entrega exacto
    ok(z.tramos.length === 2 && z.tramos[1].tramo.diferencia === 0 && z.tramos[0].tramo.diferencia === -5000);
    ok(z.turno.diferencia === z.tramos.reduce((s, t) => s + t.tramo.diferencia, 0), 'turno ' + z.turno.diferencia);
    ok(z.turno.cerrado_por === admin.id && z.turno.cerrado_por_nombre === 'Administración');
    ok(!caja.actual(), 'cerrada');
    return 'turno −₡50 = tramo 1 (−₡50) + tramo 2 (₡0)';
  });

  await prueba('Una caja abierta antes de existir los usuarios queda a cargo de quien ingresa', () => {
    sesion.cerrar();
    const t = caja.abrir(1000000);   // sin sesión (como en una versión anterior)
    ok(!caja.tramoAbierto(t.id));
    ventas.emitir({ lineas: [{ producto_id: leche.id, cantidad: 2 }], medio_pago: 'efectivo', pago: 250000 });
    const tramo = caja.asegurarTramo(v1.id);
    ok(tramo.origen === 'continuacion' && tramo.recibido === 1000000 + 250000 && tramo.usuario_id === v1.id, JSON.stringify(tramo));
    ok(caja.asegurarTramo(v2.id).usuario_id === v1.id, 'ingresar otro usuario no cambia quién tiene la caja');
    sesion.iniciar(v1);
    const z = caja.cerrar(1250000);
    ok(z.turno.diferencia === 0 && z.tramos[0].tramo.diferencia === 0);
    ok(conexion.verificarIntegridad().ok, 'integridad');
    return 'continuación con ₡12 500';
  });

  const fallas = resultados.filter((r) => !r).length;
  console.log('\n' + (fallas ? '✘ ' + fallas + ' prueba(s) fallaron' : '✔ Todas las pruebas pasaron (' + resultados.length + ')') + '\n');
  try { conexion.cerrar(); fs.rmSync(carpeta, { recursive: true, force: true }); } catch (e) {}
  app.exit(fallas ? 1 : 0);
}

app.whenReady().then(() => correr().catch((e) => { console.error('Error en la prueba:', e); app.exit(1); }));
