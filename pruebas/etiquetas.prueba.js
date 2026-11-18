/**
 * etiquetas.prueba.js — Proveedores con sus productos, marcas con logo, SKU,
 * códigos de barras y la impresión de etiquetas (SAT TT448-2: TSPL / ZPL).
 *
 *  - Ficha de proveedor: validaciones, lista de productos, lo que se aprende
 *    con cada compra (costo, código del proveedor), precios cambiados al recibir.
 *  - Marcas y SKU: marca por nombre, logo PNG (y sus límites), SKU sin repetir.
 *  - Códigos de barras: dígito verificador, estructura EAN-13 / EAN-8 / UPC-A
 *    y Code 128 (los códigos generados además se leyeron con el lector de
 *    macOS al hacer este módulo).
 *  - Impresión: comandos TSPL y ZPL exactos, validaciones, envío por la red a
 *    una impresora simulada y, en Windows, el envío por USB (cola RAW).
 *
 * Uso:  npm run prueba:etiquetas
 */
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const net = require('net');
const vm = require('vm');
const zlib = require('zlib');
const path = require('path');
const datos = require('../principal/datos');
const etiquetas = require('../principal/etiquetas');
const { MIGRACIONES } = require('../principal/datos/esquema');

const { conexion, productos, compras, proveedores, marcas, ordenes, respaldos } = datos;

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
async function fallaAsync(fn, texto) {
  try { await fn(); } catch (e) {
    if (texto && !String(e.message).includes(texto)) throw new Error('Error distinto: ' + e.message);
    return e.message;
  }
  throw new Error('Debía fallar' + (texto ? ' con "' + texto + '"' : ''));
}
const fila = (q, ...p) => conexion.obtener().prepare(q).get(...p);
const hoy = () => datos.montos.fechaLocal().slice(0, 10);
let factura = 0;
const nuevaFactura = () => 'P-' + (++factura);

/** PNG mínimo válido (escala de grises) para probar los logos. */
function pngGris(ancho, alto, valor = 0) {
  const chunk = (tipo, d) => { const t = Buffer.from(tipo); const l = Buffer.alloc(4); l.writeUInt32BE(d.length);
    const c = Buffer.alloc(4); c.writeUInt32BE(zlib.crc32(Buffer.concat([t, d])) >>> 0); return Buffer.concat([l, t, d, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(ancho, 0); ihdr.writeUInt32BE(alto, 4); ihdr[8] = 8; ihdr[9] = 0;
  const filas = Buffer.alloc((ancho + 1) * alto, valor); for (let y = 0; y < alto; y++) filas[y * (ancho + 1)] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(filas)), chunk('IEND', Buffer.alloc(0))]);
}

/** Imagen de 1 bit (1 = negro) con un marco y una diagonal, para revisar lo que llega a la impresora. */
function imagenPrueba(anchoPx, altoPx) {
  const bpf = Math.ceil(anchoPx / 8);
  const d = new Uint8Array(bpf * altoPx);
  const poner = (x, y) => { d[y * bpf + (x >> 3)] |= 0x80 >> (x & 7); };
  for (let x = 0; x < anchoPx; x++) { poner(x, 0); poner(x, altoPx - 1); }
  for (let y = 0; y < altoPx; y++) { poner(0, y); poner(anchoPx - 1, y); poner(Math.floor(y * (anchoPx - 1) / (altoPx - 1)), y); }
  return d;
}

async function correr() {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'besalu-etiquetas-'));
  conexion.abrir(carpeta);
  respaldos.configurar(carpeta);
  conexion.guardarAjustes({ cedula: '3101123456', negocio: 'Besalú Mercat S.A.', stockMin: 5 });
  const leche = productos.crear({ codigo: '7441001100116', nombre: 'Leche semidescremada 1 L', tarifa_iva: 1, precio: 125000, costo: 98000, stock_minimo: 10, stock_inicial: 4 });
  const queso = productos.crear({ codigo: 'QSO-250', nombre: 'Queso turrialba 250 g', tarifa_iva: 1, precio: 325000, costo: 240000, stock_minimo: 3 });
  const pan = productos.crear({ codigo: '7440000000019', nombre: 'Pan cuadrado', tarifa_iva: 1, precio: 160000, costo: 110000, stock_minimo: 5 });

  console.log('\nProveedores · ficha');
  let lacteos;
  await prueba('Valida la identificación según su tipo, el correo y que no se repita', () => {
    falla(() => proveedores.guardar({ tipo_id: '01', identificacion: '1-234-567', nombre: 'Juan' }), 'La cédula física tiene 9');
    falla(() => proveedores.guardar({ tipo_id: '02', identificacion: '310112345', nombre: 'X' }), 'La cédula jurídica tiene 10');
    falla(() => proveedores.guardar({ tipo_id: '03', identificacion: '1234567890', nombre: 'X' }), 'El DIMEX tiene 11 u 12');
    falla(() => proveedores.guardar({ tipo_id: '02', identificacion: '3101777777', nombre: '' }), 'Falta el nombre');
    falla(() => proveedores.guardar({ tipo_id: '02', identificacion: '3101777777', nombre: 'X', correo: 'ventas@' }), 'correo');
    falla(() => proveedores.guardar({ tipo_id: '02', identificacion: '3101777777', nombre: 'X', dias_credito: 400 }), 'días de crédito');
    lacteos = proveedores.guardar({ tipo_id: '02', identificacion: '3-101-777777', nombre: 'Lácteos del Valle S.A.', nombre_comercial: 'Lácteos del Valle',
      telefono: '2222-3333', correo: 'Ventas@LacteosValle.cr', contacto: 'Ana Mora', dias_credito: 15, direccion: 'Cartago', notas: 'Visita los martes' });
    ok(lacteos.identificacion === '3101777777' && lacteos.correo === 'ventas@lacteosvalle.cr' && lacteos.dias_credito === 15, JSON.stringify(lacteos));
    falla(() => proveedores.guardar({ tipo_id: '02', identificacion: '3101777777', nombre: 'Otro' }), 'Ya existe un proveedor con esa identificación');
    return lacteos.nombre + ' · ' + lacteos.identificacion;
  });

  await prueba('Lista de productos del proveedor: sin repetidos y con su código propio', () => {
    falla(() => proveedores.guardar(Object.assign({}, lacteos, { productos: [{ producto_id: leche.id, costo: 97000 }, { producto_id: leche.id, costo: 1 }] })), 'está dos veces');
    falla(() => proveedores.guardar(Object.assign({}, lacteos, { productos: [{ producto_id: leche.id, costo: 97000, codigo_proveedor: 'L1' }, { producto_id: queso.id, costo: 1, codigo_proveedor: 'L1' }] })), 'El código del proveedor L1');
    falla(() => proveedores.guardar(Object.assign({}, lacteos, { productos: [{ producto_id: leche.id, costo: 970.5 }] })), 'Monto inválido');
    let f = proveedores.guardar(Object.assign({}, lacteos, { productos: [{ producto_id: leche.id, costo: 97000, codigo_proveedor: 'L1' }, { producto_id: queso.id, costo: 235000, codigo_proveedor: 'Q9' }] }));
    ok(f.productos.length === 2 && f.productos.find((x) => x.producto_id === queso.id).costo === 235000);
    // Intercambiar los códigos entre dos productos no choca con la regla de no repetir
    f = proveedores.guardar(Object.assign({}, f, { productos: [{ producto_id: leche.id, costo: 97000, codigo_proveedor: 'Q9' }, { producto_id: queso.id, costo: 235000, codigo_proveedor: 'L1' }] }));
    ok(f.productos.find((x) => x.producto_id === leche.id).codigo_proveedor === 'Q9');
    // Quitar uno de la lista
    f = proveedores.guardar(Object.assign({}, f, { productos: [{ producto_id: leche.id, costo: 97000, codigo_proveedor: 'Q9' }] }));
    ok(f.productos.length === 1 && proveedores.listar().find((p) => p.id === lacteos.id).productos === 1);
    return f.productos.length + ' producto';
  });

  console.log('\nProveedores · compras');
  await prueba('Cada compra deja los productos en la lista del proveedor con su último costo', () => {
    compras.registrarCompra({ proveedor: lacteos, numero_documento: nuevaFactura(), fecha: hoy(),
      lineas: [{ producto_id: leche.id, cantidad: 24, costo_unitario: 99000, tarifa_iva: 1 }, { producto_id: queso.id, cantidad: 6, costo_unitario: 238000, tarifa_iva: 1 }] });
    const f = proveedores.obtenerPorId(lacteos.id);
    const l = f.productos.find((x) => x.producto_id === leche.id), q = f.productos.find((x) => x.producto_id === queso.id);
    ok(l && l.costo === 99000 && l.ultima_compra === hoy() && l.codigo_proveedor === 'Q9', JSON.stringify(l));
    ok(q && q.costo === 238000, 'el queso entró a la lista');
    // Una factura más vieja que la última no pisa el costo más reciente
    const ayer = new Date(Date.now() - 86400000 * 3).toISOString().slice(0, 10);
    compras.registrarCompra({ proveedor: lacteos, numero_documento: nuevaFactura(), fecha: ayer, lineas: [{ producto_id: leche.id, cantidad: 1, costo_unitario: 90000, tarifa_iva: 1 }] });
    ok(proveedores.obtenerPorId(lacteos.id).productos.find((x) => x.producto_id === leche.id).costo === 99000, 'la factura vieja no cambió el costo');
    return 'leche ₡990 · queso ₡2 380';
  });

  await prueba('El código del proveedor de su XML se guarda una vez (sin pisar ni repetir)', () => {
    const otro = proveedores.guardar({ tipo_id: '02', identificacion: '3101555000', nombre: 'Panificadora Central' });
    compras.registrarCompra({ proveedor: otro, numero_documento: nuevaFactura(), fecha: hoy(), lineas: [{ producto_id: pan.id, cantidad: 10, costo_unitario: 105000, tarifa_iva: 1, codigo_proveedor: 'PAN-CUAD' }] });
    ok(proveedores.obtenerPorId(otro.id).productos[0].codigo_proveedor === 'PAN-CUAD');
    compras.registrarCompra({ proveedor: otro, numero_documento: nuevaFactura(), fecha: hoy(), lineas: [{ producto_id: pan.id, cantidad: 1, costo_unitario: 105000, tarifa_iva: 1, codigo_proveedor: 'OTRO' }] });
    ok(proveedores.obtenerPorId(otro.id).productos[0].codigo_proveedor === 'PAN-CUAD', 'no se pisa el que ya tenía');
    // Si otro producto suyo ya usa ese código, no se duplica (ni falla la compra)
    compras.registrarCompra({ proveedor: otro, numero_documento: nuevaFactura(), fecha: hoy(), lineas: [{ producto_id: queso.id, cantidad: 1, costo_unitario: 200000, tarifa_iva: 1, codigo_proveedor: 'PAN-CUAD' }] });
    ok(proveedores.obtenerPorId(otro.id).productos.find((x) => x.producto_id === queso.id).codigo_proveedor === '');
    return 'PAN-CUAD';
  });

  await prueba('Cambiar el precio de venta al recibir: queda en el producto y en la bitácora', () => {
    const antes = productos.obtenerPorId(leche.id).stock;
    falla(() => compras.registrarCompra({ proveedor: lacteos, numero_documento: nuevaFactura(), fecha: hoy(),
      lineas: [{ producto_id: leche.id, cantidad: 12, costo_unitario: 99500, tarifa_iva: 1, precio_venta: 0 }] }), 'precio de venta no es válido');
    ok(productos.obtenerPorId(leche.id).stock === antes, 'la compra fallida no movió el inventario');
    compras.registrarCompra({ proveedor: lacteos, numero_documento: nuevaFactura(), fecha: hoy(),
      lineas: [{ producto_id: leche.id, cantidad: 12, costo_unitario: 99500, tarifa_iva: 1, precio_venta: 129500 }] });
    const p = productos.obtenerPorId(leche.id);
    const b = fila("SELECT detalle FROM bitacora WHERE accion = 'precio_cambiado' ORDER BY id DESC LIMIT 1");
    ok(p.precio === 129500 && p.stock === antes + 12 && b && JSON.parse(b.detalle).antes === 125000, JSON.stringify(b));
    return '₡1 250 → ₡1 295';
  });

  await prueba('Con compras: no se cambia la identificación y al borrarlo se desactiva; una compra lo reactiva', () => {
    falla(() => proveedores.guardar(Object.assign({}, lacteos, { identificacion: '3101777778' })), 'No se puede cambiar la identificación');
    const sinUso = proveedores.guardar({ tipo_id: '01', identificacion: '102340567', nombre: 'Proveedor de prueba' });
    ok(proveedores.eliminar(sinUso.id).eliminado && !proveedores.obtenerPorId(sinUso.id));
    ok(proveedores.eliminar(lacteos.id).desactivado && !proveedores.listar().some((p) => p.id === lacteos.id));
    ok(proveedores.listar({ incluirInactivos: true }).some((p) => p.id === lacteos.id && !p.activo));
    compras.registrarCompra({ proveedor: lacteos, numero_documento: nuevaFactura(), fecha: hoy(), lineas: [{ producto_id: queso.id, cantidad: 1, costo_unitario: 238000, tarifa_iva: 1 }] });
    ok(proveedores.obtenerPorId(lacteos.id).activo === 1, 'reactivado');
    return 'desactivado y reactivado';
  });

  await prueba('"Pedir lo que falta" de un proveedor: los de su lista con su costo', () => {
    productos.actualizar(pan.id, { stock_minimo: 50 });
    productos.actualizar(queso.id, { stock_minimo: 50 });
    const panaderia = proveedores.porIdentificacion('3101555000');
    const sugLacteos = ordenes.sugerencias({ proveedor_id: lacteos.id });
    const sugPan = ordenes.sugerencias({ proveedor_id: panaderia.id });
    const delPan = sugPan.find((x) => x.producto_id === pan.id);
    ok(delPan && delPan.costo === 105000, 'el pan sale para la panificadora con su costo: ' + JSON.stringify(delPan));
    ok(!sugLacteos.some((x) => x.producto_id === pan.id), 'el pan no es de Lácteos del Valle');
    ok(sugLacteos.find((x) => x.producto_id === queso.id).costo === 238000, 'el queso con el costo de Lácteos');
    productos.actualizar(pan.id, { stock_minimo: 5 }); productos.actualizar(queso.id, { stock_minimo: 3 });
    return 'panificadora: pan a ₡1 050 · lácteos: queso a ₡2 380';
  });

  await prueba('La migración 6 arma la lista de cada proveedor con lo ya comprado', () => {
    const d = conexion.obtener();
    const antes = d.prepare('SELECT proveedor_id, producto_id, costo, ultima_compra FROM proveedor_productos ORDER BY 1, 2').all();
    d.prepare('DELETE FROM proveedor_productos').run();
    const insert = MIGRACIONES[5].slice(MIGRACIONES[5].indexOf('INSERT INTO proveedor_productos'));
    d.exec(insert);
    const despues = d.prepare('SELECT proveedor_id, producto_id, costo, ultima_compra FROM proveedor_productos ORDER BY 1, 2').all();
    // Lo calculado desde las compras coincide con lo que aprendió cada compra (el costo de la última factura)
    for (const a of despues) {
      const b = antes.find((x) => x.proveedor_id === a.proveedor_id && x.producto_id === a.producto_id);
      ok(b && b.costo === a.costo && b.ultima_compra === a.ultima_compra, JSON.stringify([a, b]));
    }
    return despues.length + ' productos-proveedor recalculados';
  });

  console.log('\nMarcas, logo y SKU');
  let marcaId;
  await prueba('La marca se pone por nombre (sin importar mayúsculas) y el SKU no se repite', () => {
    const p1 = productos.actualizar(leche.id, { marca: 'Lechera del Valle', sku: 'LCH-001' });
    const p2 = productos.actualizar(queso.id, { marca: '  lechera   DEL valle ' });
    ok(p1.marca === 'Lechera del Valle' && p2.marca_id === p1.marca_id && p1.sku === 'LCH-001', JSON.stringify(p2));
    marcaId = p1.marca_id;
    falla(() => productos.actualizar(queso.id, { sku: 'LCH-001' }), 'UNIQUE constraint failed: productos.sku');
    productos.actualizar(queso.id, { sku: '' }); productos.actualizar(pan.id, { sku: '' });   // vacío sí se repite
    ok(productos.actualizar(pan.id, { marca: '' }).marca_id === null, 'sin marca');
    return p1.marca + ' · SKU ' + p1.sku;
  });

  await prueba('Logo de la marca: solo PNG, con tamaño máximo; se quita con null', () => {
    falla(() => marcas.guardar({ id: marcaId, nombre: 'Lechera del Valle', logo: Buffer.from('GIF89a...') }), 'no es una imagen válida');
    const grande = Buffer.concat([pngGris(1, 1), Buffer.alloc(marcas.MAX_LOGO)]);
    falla(() => marcas.guardar({ id: marcaId, nombre: 'Lechera del Valle', logo: grande }), 'demasiado grande');
    falla(() => marcas.guardar({ id: marcaId, nombre: 'Lechera del Valle', umbral: 300 }), 'Intensidad');
    const png = pngGris(64, 32, 20);
    const m = marcas.guardar({ id: marcaId, nombre: 'Lechera del Valle', logo: new Uint8Array(png), umbral: 150 });
    ok(m.tiene_logo === 1 && m.umbral === 150);
    const l = marcas.logo(marcaId);
    ok(Buffer.compare(l.png, png) === 0, 'el logo vuelve idéntico');
    ok(productos.obtenerPorId(leche.id).marca_logo === 1, 'el producto sabe que su marca tiene logo');
    falla(() => marcas.eliminar(marcaId), 'cámbieles la marca primero');
    marcas.guardar({ id: marcaId, nombre: 'Lechera del Valle', logo: null });
    ok(marcas.logo(marcaId).png === null);
    marcas.guardar({ id: marcaId, nombre: 'Lechera del Valle', logo: png });
    return png.length + ' bytes';
  });

  await prueba('La copia completa lleva las marcas con su logo, el SKU y los proveedores con sus productos', async () => {
    compras.registrarCompra({ proveedor: lacteos, numero_documento: nuevaFactura(), fecha: hoy(), lineas: [{ producto_id: leche.id, cantidad: 2, costo_unitario: 99000, tarifa_iva: 1 }] });
    const destino = path.join(carpeta, 'copia.sqlite');
    await respaldos.exportarCopia(destino);
    const Database = require('better-sqlite3');
    const c = new Database(destino, { readonly: true });
    const m = c.prepare('SELECT length(logo) AS n FROM marcas WHERE id = ?').get(marcaId);
    const p = c.prepare('SELECT sku FROM productos WHERE id = ?').get(leche.id);
    const pp = c.prepare('SELECT count(*) AS n FROM proveedor_productos').get().n;
    c.close();
    ok(m.n > 0 && p.sku === 'LCH-001' && pp > 0, JSON.stringify([m, p, pp]));
    return 'logo ' + m.n + ' bytes · ' + pp + ' productos de proveedores';
  });

  console.log('\nCódigos de barras');
  const CB = vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'interfaz', 'js', 'codigo-barras.js'), 'utf8') + '\nCodigoBarras;', {});
  const suma = (a) => a.reduce((x, y) => x + y, 0);
  await prueba('Elige el tipo según el código y codifica exactamente ese código', () => {
    ok(CB.verificador('744100110011') === '6' && CB.verificador('400638133393') === '1' && CB.verificador('03600029145') === '2' && CB.verificador('1234567') === '0');
    const casos = { '7441001100116': ['EAN-13', 95], '036000291452': ['UPC-A', 95], '96385074': ['EAN-8', 67], '7441001100118': ['Code 128', null], 'QSO-250': ['Code 128', null], '1001': ['Code 128', null] };
    for (const [c, [tipo, modulos]] of Object.entries(casos)) {
      const r = CB.codificar(c);
      ok(r.tipo === tipo && r.texto === c, c + ' → ' + r.tipo);
      if (modulos) ok(suma(r.modulos) === modulos, c + ': ' + suma(r.modulos) + ' módulos');
      ok(r.modulos.length % 2 === 1, c + ': empieza y termina en barra');
    }
    falla(() => CB.codificar('Café'), 'tilde');
    falla(() => CB.codificar(''), 'no tiene código');
    return Object.keys(casos).length + ' códigos';
  });
  await prueba('Code 128: tabla completa (cada símbolo suma 11 módulos, sin repetidos) y verificador', () => {
    ok(CB.C128.length === 107 && CB.C128.slice(0, 106).every((p) => suma(p.split('').map(Number)) === 11) && suma(CB.C128[106].split('').map(Number)) === 13);
    ok(new Set(CB.C128).size === 107, 'símbolos repetidos');
    // "1001" en C: inicio C (105) + 10 + 01, verificador (105 + 10·1 + 1·2) mod 103 = 14, parada
    const esperado = [105, 10, 1, 14, 106].map((v) => CB.C128[v]).join('').split('').map(Number);
    ok(JSON.stringify(CB.code128('1001')) === JSON.stringify(esperado), 'Code 128 C de 1001');
    // Impar: el primero en B y después C
    const impar = CB.code128('12345');
    const inicio = [104, 17, 99].map((v) => CB.C128[v]).join('').split('').map(Number);
    ok(impar.length === 6 * 6 + 7 && suma(impar) === 6 * 11 + 13 && JSON.stringify(impar.slice(0, 18)) === JSON.stringify(inicio), 'Code 128 de 12345');
    return '107 símbolos';
  });

  console.log('\nImpresión (SAT TT448-2)');
  await prueba('Configuración: valida tamaños, IP de la red local y lenguaje', () => {
    falla(() => etiquetas.guardar({ ancho: 110 }), 'Ancho de la etiqueta');
    falla(() => etiquetas.guardar({ conexion: 'red', ip: '8.8.8.8' }), 'red del negocio');
    falla(() => etiquetas.guardar({ conexion: 'red', ip: '192.168.1.300' }), 'red del negocio');
    falla(() => etiquetas.guardar({ lenguaje: 'epl' }), 'Lenguaje inválido');
    falla(() => etiquetas.guardar({ oscuridad: 16 }), 'Oscuridad');
    const c = etiquetas.guardar({ conexion: 'red', ip: '192.168.1.50', ancho: 50, alto: 25, separacion: 2, oscuridad: 10, velocidad: 4 });
    ok(c.modelo === 'SAT TT448-2 USE' && c.ip === '192.168.1.50' && etiquetas.leer().oscuridad === 10);
    ok(etiquetas.ipLocal('10.0.0.8') && etiquetas.ipLocal('172.20.1.1') && !etiquetas.ipLocal('172.32.0.1') && etiquetas.ipLocal('127.0.0.1'));
    return c.ancho + ' × ' + c.alto + ' mm · ' + c.ip;
  });

  const W = 400, H = 200;   // 50 × 25 mm a 8 puntos por mm
  const img = imagenPrueba(W, H);
  await prueba('Revisa lo que manda la pantalla antes de imprimir', () => {
    falla(() => etiquetas.validarTrabajo({ ancho: 50, alto: 25, etiquetas: [] }), 'No hay etiquetas');
    falla(() => etiquetas.validarTrabajo({ ancho: 50, alto: 25, etiquetas: [{ anchoPx: W, altoPx: H, datos: img.slice(1), copias: 1 }] }), 'incompleta');
    falla(() => etiquetas.validarTrabajo({ ancho: 50, alto: 25, etiquetas: [{ anchoPx: 480, altoPx: H, datos: new Uint8Array(60 * H), copias: 1 }] }), 'más grande que la etiqueta');
    falla(() => etiquetas.validarTrabajo({ ancho: 50, alto: 25, etiquetas: [{ anchoPx: W, altoPx: H, datos: img, copias: 0 }] }), 'copias');
    falla(() => etiquetas.validarTrabajo({ ancho: 50, alto: 25, etiquetas: Array.from({ length: 5 }, () => ({ anchoPx: W, altoPx: H, datos: img, copias: 500 })) }), 'Máximo 2 000');
    return 'ok';
  });

  await prueba('TSPL: tamaño, separación, oscuridad, imagen invertida (0 = negro) y copias', () => {
    const c = etiquetas.leer();
    const b = etiquetas.comandosTspl(c, etiquetas.validarTrabajo({ ancho: 50, alto: 25, etiquetas: [{ anchoPx: W, altoPx: H, datos: img, copias: 3 }, { anchoPx: W, altoPx: H, datos: img, copias: 1 }] }));
    const txt = b.toString('latin1');
    ok(txt.startsWith('SIZE 50 mm,25 mm\r\nGAP 2 mm,0 mm\r\nDIRECTION 1,0\r\n') && txt.includes('DENSITY 10\r\nSPEED 4\r\n'), txt.slice(0, 120));
    const marca = 'BITMAP 0,0,50,200,0,';
    const i = txt.indexOf(marca);
    ok(i > 0 && txt.split('CLS\r\n').length === 3, 'dos etiquetas');
    const datosImg = b.subarray(i + marca.length, i + marca.length + 50 * H);
    ok(datosImg.every((v, k) => v === (~img[k] & 0xff)), 'los bits van invertidos');
    ok(txt.includes('\r\nPRINT 1,3\r\n') && txt.trimEnd().endsWith('PRINT 1,1'), 'copias');
    return b.length + ' bytes';
  });

  await prueba('ZPL: ^GFA con la imagen en hexadecimal (1 = negro) y ^PQ con las copias', () => {
    const c = Object.assign(etiquetas.leer(), { lenguaje: 'zpl' });
    const txt = etiquetas.comandosZpl(c, etiquetas.validarTrabajo({ ancho: 50, alto: 25, etiquetas: [{ anchoPx: W, altoPx: H, datos: img, copias: 2 }] })).toString('latin1');
    const m = /\^XA\^PW400\^LL200\^LH0,0\^MNY~SD20\^PR4\^FO0,0\^GFA,10000,10000,50,([0-9A-F]+)\^FS\^PQ2\^XZ/.exec(txt);
    ok(m && Buffer.from(m[1], 'hex').equals(Buffer.from(img)), txt.slice(0, 80));
    return txt.length + ' caracteres';
  });

  await prueba('Por la red: llegan exactamente los comandos; impresora apagada → aviso claro', async () => {
    const recibido = [];
    const servidor = net.createServer((s) => { s.on('data', (d) => recibido.push(d)); });
    await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
    const puerto = servidor.address().port;
    etiquetas.guardar({ conexion: 'red', ip: '127.0.0.1', puerto, lenguaje: 'tspl' });
    const r = await etiquetas.imprimir({ ancho: 50, alto: 25, etiquetas: [{ anchoPx: W, altoPx: H, datos: img, copias: 4 }] }, async () => []);
    await new Promise((x) => setTimeout(x, 100));
    servidor.close();
    const esperado = etiquetas.comandos(etiquetas.leer(), { ancho: 50, alto: 25, etiquetas: [{ anchoPx: W, altoPx: H, datos: img, copias: 4 }] }).datos;
    ok(r.copias === 4 && Buffer.concat(recibido).equals(esperado), Buffer.concat(recibido).length + ' de ' + esperado.length);
    const b = fila("SELECT detalle FROM bitacora WHERE accion = 'etiquetas_impresas' ORDER BY id DESC LIMIT 1");
    ok(b && JSON.parse(b.detalle).etiquetas === 4);
    // Puerto cerrado: la impresora no está
    etiquetas.guardar({ puerto: puerto });
    const msg = await fallaAsync(() => etiquetas.imprimir({ ancho: 50, alto: 25, etiquetas: [{ anchoPx: W, altoPx: H, datos: img, copias: 1 }] }, async () => []), 'No se pudo imprimir en 127.0.0.1');
    return esperado.length + ' bytes · ' + msg.slice(0, 60) + '…';
  });

  await prueba('Por USB: la impresora tiene que estar instalada en Windows', async () => {
    etiquetas.guardar({ conexion: 'usb', impresora: '' });
    await fallaAsync(() => etiquetas.imprimir({ ancho: 50, alto: 25, etiquetas: [{ anchoPx: W, altoPx: H, datos: img, copias: 1 }] }, async () => ['SAT TT448']), 'Elija la impresora');
    etiquetas.guardar({ impresora: 'SAT TT448-2 (no instalada)' });
    await fallaAsync(() => etiquetas.imprimir({ ancho: 50, alto: 25, etiquetas: [{ anchoPx: W, altoPx: H, datos: img, copias: 1 }] }, async () => ['Microsoft Print to PDF']), 'no está instalada');
    if (process.platform !== 'win32') {
      await fallaAsync(() => etiquetas.enviarWindows('SAT', Buffer.from('x')), 'Windows');
      return 'en esta computadora no hay Windows: el envío RAW se prueba en la compilación de Windows';
    }
    // Windows: el script de la cola RAW compila y avisa si la impresora no existe
    const msg = await fallaAsync(() => etiquetas.enviarWindows('Impresora que no existe ' + Date.now(), Buffer.from('SIZE 50 mm,25 mm\r\n')), 'Windows no encontró la impresora');
    return msg;
  });

  const fallas = resultados.filter((r) => !r).length;
  console.log('\n' + (fallas ? '✘ ' + fallas + ' prueba(s) fallaron' : '✔ Todas las pruebas pasaron (' + resultados.length + ')') + '\n');
  try { conexion.cerrar(); fs.rmSync(carpeta, { recursive: true, force: true }); } catch (e) {}
  app.exit(fallas ? 1 : 0);
}

app.whenReady().then(() => correr().catch((e) => { console.error('Error en la prueba:', e); app.exit(1); }));
