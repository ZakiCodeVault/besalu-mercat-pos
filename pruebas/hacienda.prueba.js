/**
 * hacienda.prueba.js — Pruebas de la conexión propia con Hacienda.
 *
 * Usa una base temporal, una llave .p12 FALSA y un servidor que imita el IdP y
 * la API de Recepción de Hacienda. El servidor simulado verifica la firma
 * (xml-crypto) y valida cada XML contra los XSD oficiales v4.4 (xmllint):
 * comprobantes emitidos y mensajes de receptor (aceptar/rechazar compras).
 *
 * Uso:  npm run prueba:hacienda
 */
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const datos = require('../principal/datos');
const xml = require('../principal/hacienda/xml');
const firma = require('../principal/hacienda/firma');
const receptor = require('../principal/hacienda/receptor');
const montos = require('../principal/datos/montos');
const conector = require('../principal/hacienda/conector');
const { leerRespuesta } = require('../principal/hacienda/api');
const { generarLlavePrueba } = require('./apoyo/llave-prueba');
const { crearSimulador, validarXsd, firmaValida } = require('./apoyo/hacienda-simulada');

const { conexion, productos, ventas, compras, caja, reportes, respaldos } = datos;
let hayXmllint = true;
try { execFileSync('xmllint', ['--version'], { stdio: 'ignore' }); } catch (e) { hayXmllint = false; }

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
async function falla(fn, texto) {
  try { await fn(); } catch (e) {
    if (texto && !String(e.message).includes(texto)) throw new Error('Error distinto: ' + e.message);
    return e.message;
  }
  throw new Error('Debía fallar' + (texto ? ' con "' + texto + '"' : ''));
}
const sql = (q, ...p) => conexion.obtener().prepare(q).run(...p);
const fila = (q, ...p) => conexion.obtener().prepare(q).get(...p);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'besalu-hacienda-'));

/* ---------------- Servidor que imita a Hacienda ---------------- */
const llavePrueba = generarLlavePrueba({ pin: '4321', serie: 'CPJ-3-101-123456' });
const USUARIO = 'cpj-3-101-123456@stag.comprobanteselectronicos.go.cr';
const CONTRASENA = 'W$/JX/AS@K);1]I;u|+6';   // con caracteres especiales, como las que da Hacienda
let sim = null;   // Hacienda simulada (se crea al empezar)

/** Procesa las colas hasta que no queden pendientes ni enviados (o se agoten las vueltas). */
async function procesarTodo(vueltas = 6) {
  for (let i = 0; i < vueltas; i++) {
    sql('UPDATE comprobantes SET hacienda_siguiente = NULL');   // sin esperar los tiempos reales
    sql('UPDATE mensajes_receptor SET hacienda_siguiente = NULL');
    await conector.procesar();
    const n = fila(`SELECT (SELECT count(*) FROM comprobantes WHERE estado_hacienda IN ('pendiente','enviado'))
      + (SELECT count(*) FROM mensajes_receptor WHERE estado_hacienda IN ('pendiente','enviado')) AS n`).n;
    if (!n) return;
  }
}

/* ---------------- Facturas de proveedores (para el Mensaje Receptor) ---------------- */
const PROVEEDOR = { negocio: 'Distribuidora Central S.A.', tipoCedula: '02', cedula: '3101999999', actividadEconomica: '463001',
  correo: 'ventas@dc.cr', provincia: '4', canton: '1', distrito: '1', direccion: 'Bodega 4, zona industrial' };
let numeroProveedor = 0;
/**
 * Factura electrónica v4.4 que un proveedor le emite al negocio (o a otra cédula),
 * firmada, como la que llega por correo y se importa en Compras.
 */
function facturaProveedor(lineas, { cedulaReceptor = '3101123456', llave } = {}) {
  const cons = montos.consecutivo('001', '00001', '01', ++numeroProveedor);
  const c = { tipo: '01', consecutivo: cons, clave: montos.clave(new Date(), PROVEEDOR.cedula, cons), fecha_emision: montos.fechaIso(), medio_pago: 'transferencia',
    receptor_tipo_id: '02', receptor_identificacion: cedulaReceptor, receptor_nombre: 'Besalú Mercat S.A.', receptor_correo: 'facturas@besalu.cr',
    lineas: lineas.map((l, i) => Object.assign({ linea: i + 1, unidad: 'Unid' }, l)) };
  const { xml: crudo, montos: m } = xml.construir(c, PROVEEDOR);
  return { clave: c.clave, consecutivo: cons, xml: firma.firmar(crudo, llave), total: xml.decimal5(m.total), impuesto: xml.decimal5(m.impuesto), montos: m };
}
/** Registra la compra como lo hace el formulario al importar el XML. */
function importarCompra(f, cambios = {}) {
  return compras.registrarCompra(Object.assign({
    proveedor: { tipo_id: '02', identificacion: PROVEEDOR.cedula, nombre: PROVEEDOR.negocio },
    numero_documento: f.consecutivo, clave: f.clave, fecha: montos.fechaLocal().slice(0, 10), xml_original: f.xml,
    lineas: f.montos.lineas.map((l) => ({ descripcion: l.descripcion, cantidad: l.cantidad, costo_unitario: Math.round(l.base / 1000 / l.cantidad),
      tarifa_iva: l.tarifa_iva, subtotal: Math.round(l.base / 1000), impuesto: Math.round(l.iva / 1000) }))
  }, cambios));
}
/** Facturas que "tiene" Hacienda: el simulador compara contra ellas. */
function haciendaConoce(f, cambios = {}) {
  sim.facturas.set(f.clave, Object.assign({ emisor: PROVEEDOR.cedula, receptor: '3101123456', total: f.total, impuesto: f.impuesto }, cambios));
}

/* ---------------- Pruebas ---------------- */
async function correr() {
  sim = await crearSimulador({ usuario: USUARIO, contrasena: CONTRASENA, certPem: llavePrueba.certPem });
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'besalu-hacienda-db-'));
  conexion.abrir(carpeta);
  respaldos.configurar(carpeta);
  const cifrador = {
    disponible: () => true,
    cifrar: (t) => 'x:' + Buffer.from(String(t), 'utf8').toString('base64').split('').reverse().join(''),
    descifrar: (c) => Buffer.from(String(c).slice(2).split('').reverse().join(''), 'base64').toString('utf8')
  };
  conector.configurar({ cifrador, urls: sim.urls });

  console.log('\nConexión con Hacienda · xmllint ' + (hayXmllint ? 'disponible' : 'NO disponible (se omite la validación XSD)') + '\n');

  // Datos del negocio (emisor) y productos
  conexion.guardarAjustes({ negocio: 'Besalú Mercat S.A.', tipoCedula: '02', cedula: '3-101-123456', actividadEconomica: '471101',
    telefono: '2222-3333', correo: 'facturas@besalu.cr', provincia: '1', canton: '2', distrito: '3', direccion: 'Escazú, frente a la plaza' });
  const leche = productos.crear({ codigo: '7441001100118', nombre: 'Leche Dos Pinos 1L', cabys: '2211000000000', tarifa_iva: 1, precio: 125000, costo: 98000, stock_inicial: 100 });
  const vino = productos.crear({ codigo: '7440000000404', nombre: 'Vino tinto & "reserva"', cabys: '2421000000000', tarifa_iva: 13, precio: 890000, costo: 560000, stock_inicial: 50 });
  const queso = productos.crear({ codigo: 'Q-1', nombre: 'Queso Turrialba', cabys: '2290000000000', unidad: 'kg', tarifa_iva: 0, precio: 520000, costo: 380000, stock_inicial: 30 });
  const sinCabys = productos.crear({ codigo: '999', nombre: 'Bolsa', cabys: '', tarifa_iva: 13, precio: 10000, costo: 5000, stock_inicial: 100 });
  caja.abrir(5000000);

  console.log('Montos');
  await prueba('IVA = base × tarifa siempre, y base + IVA = lo cobrado (20 000 casos)', () => {
    let exactos = 0;
    for (let i = 0; i < 20000; i++) {
      const total = 1 + Math.floor(Math.random() * 5000000);
      const t = [0.5, 1, 2, 4, 8, 13][i % 6];
      const { base, iva } = xml.baseEIva(total, t);
      ok(iva === Math.round(base * Math.round(t * 10) / 1000), 'IVA ≠ base × tarifa: ' + total + ' ' + t);
      const diferencia = Math.abs(base + iva - total * 1000);
      ok(diferencia <= 1, 'diferencia de ' + diferencia + ' en ' + total + ' al ' + t + '%');
      if (!diferencia) exactos++;
    }
    return (exactos / 200).toFixed(1) + '% exactos, el resto a 0,00001 colones';
  });
  await prueba('Totales del XML = total cobrado (menos de un céntimo)', () => {
    const v = ventas.emitir({ lineas: [{ producto_id: leche.id, cantidad: 3 }, { producto_id: vino.id, cantidad: 2 }, { producto_id: queso.id, cantidad: 0.75 }], medio_pago: 'tarjeta' });
    const m = xml.calcularMontos(v.lineas);
    ok(Math.abs(m.total - v.total_comprobante * 1000) <= v.lineas.length, m.total + ' vs ' + v.total_comprobante);
    ok(m.desglose.get('08') && m.desglose.get('02') && !m.desglose.get('10'), 'desglose por tarifa');
    return xml.decimal5(m.total) + ' · IVA ' + xml.decimal5(m.impuesto);
  });

  console.log('\nXML y firma');
  const llave = firma.cargarLlave(llavePrueba.p12, '4321');
  await prueba('Leer la llave .p12 con su PIN', () => {
    ok(llave.info.cedula === '3101123456' && llave.info.titular.includes('BESALU'), JSON.stringify(llave.info));
    return llave.info.titular + ' · vence ' + llave.info.vence.slice(0, 10);
  });
  await prueba('PIN incorrecto → mensaje claro', () => falla(() => firma.cargarLlave(llavePrueba.p12, '0000'), 'PIN'));
  await prueba('Cédula del certificado (jurídica y física)', () => {
    ok(firma.cedulaDelCertificado('CPJ-3-101-123456') === '3101123456');
    ok(firma.cedulaDelCertificado('CPF-01-0234-0567') === '102340567');
  });
  const ultimo = ventas.listar({ limite: 1 })[0];
  const tiquete = ventas.obtenerPorId(ultimo.id);
  const firmado = firma.firmar(xml.construir(tiquete, conexion.leerAjustes()).xml, llave);
  await prueba('Tiquete firmado cumple el XSD oficial v4.4', () => validarXsd('04', firmado));
  await prueba('Firma XAdES-EPES válida (verificada con xml-crypto)', () => { ok(firmaValida(firmado, llavePrueba.certPem)); return '3 referencias + firma'; });
  await prueba('El texto firmado ya es canónico (igual a xmllint --c14n)', () => {
    if (!hayXmllint) return 'sin xmllint';
    const archivo = path.join(tmp, 'c14n.xml');
    fs.writeFileSync(archivo, firmado);
    ok(execFileSync('xmllint', ['--c14n', archivo]).toString() === firmado.replace(/^<\?xml[^>]*\?>/, ''));
  });
  await prueba('Si se altera un monto, la firma deja de ser válida', () => {
    const alterado = firmado.replace(/<TotalComprobante>(\d)/, (m, d) => '<TotalComprobante>' + ((Number(d) + 1) % 10));
    ok(alterado !== firmado);
    let valida = false;
    try { valida = firmaValida(alterado, llavePrueba.certPem); } catch (e) { valida = false; }
    ok(!valida, 'la firma no detectó el cambio');
  });
  await prueba('Política de firma y rol (XAdES-EPES)', () => {
    ok(firmado.includes('<xades:SigPolicyHash><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod><ds:DigestValue>DWxin1xWOeI8OuWQXazh4VjLWAaCLAA954em7DMh0h8='));
    ok(firmado.includes('<xades:Identifier>https://cdn.comprobanteselectronicos.go.cr/xml-schemas/Resoluci%C3%B3n_General'));
    ok(/<ds:X509SerialNumber>\d+<\/ds:X509SerialNumber>/.test(firmado) && firmado.includes('Type="http://uri.etsi.org/01903#SignedProperties"'));
  });

  console.log('\nConfiguración y validaciones');
  await prueba('Usuario de otro ambiente → rechazado', () => falla(() => conector.guardarConfiguracion({ ambiente: 'pruebas', usuario: 'cpj-3-101-123456@prod.comprobanteselectronicos.go.cr' }), 'termina en'));
  await prueba('PIN incorrecto al guardar → no se guarda nada', async () => {
    conector.elegirLlave(llavePrueba.p12, 'llave.p12');
    await falla(() => conector.guardarConfiguracion({ ambiente: 'pruebas', usuario: USUARIO, contrasena: CONTRASENA, pin: '9999' }), 'PIN');
    ok(!conector.estado().tieneLlave);
  });
  await prueba('Guardar credenciales y activar el envío', () => {
    conector.elegirLlave(llavePrueba.p12, 'llave.p12');
    const e = conector.guardarConfiguracion({ activo: true, ambiente: 'pruebas', usuario: USUARIO, contrasena: CONTRASENA, pin: '4321' });
    ok(e.activo && e.certificado.cedula === '3101123456', JSON.stringify(e.problemas));
    return e.certificado.titular;
  });
  await prueba('La contraseña, la llave y el PIN no quedan en texto plano', () => {
    const crudo = fila("SELECT valor FROM config WHERE clave = 'hacienda'").valor;
    ok(!crudo.includes(CONTRASENA) && !crudo.includes('4321') && !crudo.includes(llavePrueba.p12.toString('base64').slice(0, 40)));
    ok(!JSON.stringify(conexion.leerBitacora(50)).includes(CONTRASENA));
  });
  await prueba('Probar conexión (token del IdP)', async () => (await conector.probarConexion()).mensaje);
  await prueba('Producto sin CABYS no se puede vender (y no gasta consecutivo)', async () => {
    const antes = fila("SELECT ultimo FROM secuencias WHERE tipo = '04'").ultimo;
    await falla(() => ventas.emitir({ lineas: [{ producto_id: sinCabys.id, cantidad: 1 }], medio_pago: 'tarjeta' }), 'CABYS');
    ok(fila("SELECT ultimo FROM secuencias WHERE tipo = '04'").ultimo === antes);
  });
  await prueba('Factura con identificación mal escrita → error claro', () =>
    falla(() => ventas.emitir({ lineas: [{ producto_id: leche.id, cantidad: 1 }], medio_pago: 'tarjeta', receptor: { tipo_id: '01', identificacion: '1-234-567', nombre: 'Ana' } }), 'dígitos'));
  await prueba('Sin dirección del negocio no se puede activar ni emitir', async () => {
    const aj = conexion.leerAjustes();
    conexion.guardarAjustes({ direccion: '' });
    await falla(() => ventas.emitir({ lineas: [{ producto_id: leche.id, cantidad: 1 }], medio_pago: 'tarjeta' }), 'dirección');
    conexion.guardarAjustes({ direccion: aj.direccion });
  });

  console.log('\nEnvío y respuesta');
  const pago = (total) => ({ medio_pago: 'efectivo', pago: total });
  const v1 = ventas.emitir({ lineas: [{ producto_id: leche.id, cantidad: 2 }], medio_pago: 'sinpe' });
  const v2 = ventas.emitir({ lineas: [{ producto_id: vino.id, cantidad: 1 }, { producto_id: queso.id, cantidad: 1.25 }], ...pago(2000000) });
  const f1 = ventas.emitir({ lineas: [{ producto_id: vino.id, cantidad: 1 }], medio_pago: 'tarjeta',
    receptor: { tipo_id: '01', identificacion: '112345678', nombre: 'Ana Mora Solís', correo: 'ana@correo.cr' } });
  await prueba('Enviar en orden y recibir la aceptación', async () => {
    await procesarTodo();
    const estados = ventas.listar({}).map((c) => c.estado_hacienda);
    ok(estados.every((e) => e === 'aceptado'), estados.join(','));
    const orden = sim.recibidos.map((r) => r.clave);
    const esperado = conexion.obtener().prepare('SELECT clave FROM comprobantes ORDER BY id').all().map((r) => r.clave);
    ok(JSON.stringify(orden) === JSON.stringify(esperado), 'orden de envío');
    ok(!sim.errores.length, sim.errores.join(' | '));
    return sim.recibidos.length + ' comprobantes aceptados · ' + sim.tokens + ' token(s)';
  });
  await prueba('La factura lleva al receptor y cumple el XSD', () => {
    const r = sim.recibidos.find((x) => x.clave === f1.clave);
    ok(r && r.receptor && r.receptor.numeroIdentificacion === '112345678');
    ok(r.xml.includes('<Receptor><Nombre>Ana Mora Solís</Nombre>'));
    return validarXsd('01', r.xml);
  });
  await prueba('Se guarda la respuesta firmada de Hacienda', () => {
    const c = ventas.obtenerPorId(v1.id);
    ok(c.hacienda_respuesta && leerRespuesta(c.hacienda_respuesta).aceptado && c.hacienda_mensaje === 'Aceptado por Hacienda');
    ok(c.xml_firmado && c.hacienda_ambiente === 'pruebas');
  });
  await prueba('El XML enviado y la respuesta no se pueden cambiar', async () => {
    await falla(() => sql('UPDATE comprobantes SET xml_firmado = ? WHERE id = ?', '<x/>', v2.id), 'no se puede modificar');
    await falla(() => sql("UPDATE comprobantes SET estado_hacienda = 'pendiente' WHERE id = ?", v2.id), 'definitiva');
    await falla(() => sql("UPDATE comprobantes SET hacienda_respuesta = 'otra' WHERE id = ?", v2.id), 'definitiva');
  });
  await prueba('Nota de crédito referencia al tiquete y cumple el XSD', async () => {
    const nc = ventas.notaCredito(v2.id, 'Cliente devolvió el vino');
    await procesarTodo();
    const r = sim.recibidos.find((x) => x.clave === nc.clave);
    ok(r && r.xml.includes('<InformacionReferencia><TipoDocIR>04</TipoDocIR><Numero>' + v2.clave + '</Numero>'));
    ok(r.xml.includes('<Codigo>01</Codigo><Razon>Cliente devolvió el vino</Razon>'));
    ok(ventas.obtenerPorId(nc.id).estado_hacienda === 'aceptado');
    return validarXsd('03', r.xml);
  });
  await prueba('Si Hacienda dice "ya fue recibido", se toma como enviado', async () => {
    const v = ventas.emitir({ lineas: [{ producto_id: leche.id, cantidad: 1 }], medio_pago: 'tarjeta' });
    await conector.procesar();                                            // primer envío
    sql("UPDATE comprobantes SET estado_hacienda = 'pendiente' WHERE id = ?", v.id);   // simula que no se guardó la respuesta
    await procesarTodo();
    ok(ventas.obtenerPorId(v.id).estado_hacienda === 'aceptado');
  });

  console.log('\nRechazo y reemisión');
  const r1 = ventas.emitir({ lineas: [{ producto_id: leche.id, cantidad: 4 }], medio_pago: 'tarjeta' });
  sim.rechazar.add(r1.clave);
  const totalAntes = reportes.resumenVentas('2000-01-01', '2100-12-31').total;
  const stockAntes = productos.obtenerPorId(leche.id).stock;
  await prueba('Rechazo: se guarda el motivo que da Hacienda', async () => {
    await procesarTodo();
    const c = ventas.obtenerPorId(r1.id);
    ok(c.estado_hacienda === 'rechazado' && c.hacienda_mensaje.includes('actividad 471101 no está inscrito & otro'), c.hacienda_mensaje);
    ok(conector.estado().rechazadosSinReemplazo === 1);
    return c.hacienda_mensaje.slice(0, 60) + '…';
  });
  await prueba('No se hace nota de crédito sobre un rechazado', () => falla(() => ventas.notaCredito(r1.id, 'x'), 'reemítalo'));
  let reemplazo;
  await prueba('Reemitir: nuevo consecutivo, referencia al rechazado, sin mover inventario ni caja', async () => {
    const turno = caja.resumen(caja.actual().id);
    reemplazo = ventas.reemitir(r1.id);
    ok(reemplazo.sustituye_id === r1.id && reemplazo.total_comprobante === r1.total_comprobante && reemplazo.consecutivo !== r1.consecutivo);
    ok(productos.obtenerPorId(leche.id).stock === stockAntes, 'inventario');
    ok(caja.resumen(caja.actual().id).ventas === turno.ventas, 'caja');
    ok(reportes.resumenVentas('2000-01-01', '2100-12-31').total === totalAntes, 'reportes cuentan una sola vez');
    await procesarTodo();
    const r = sim.recibidos.find((x) => x.clave === reemplazo.clave);
    ok(r && r.xml.includes('<TipoDocIR>10</TipoDocIR><Numero>' + r1.clave + '</Numero>') && r.xml.includes('<Codigo>07</Codigo>'));
    ok(ventas.obtenerPorId(reemplazo.id).estado_hacienda === 'aceptado' && conector.estado().rechazadosSinReemplazo === 0);
    return reemplazo.consecutivo + ' · ' + validarXsd('04', r.xml);
  });
  await prueba('Un rechazado se reemite una sola vez', () => falla(() => ventas.reemitir(r1.id), 'ya fue reemplazado'));
  await prueba('Solo se reemiten rechazados', () => falla(() => ventas.reemitir(v1.id), 'rechazados'));

  console.log('\nMensaje Receptor (aceptar o rechazar compras)');
  const lineaProv = (descripcion, total, tarifa, cantidad = 1) => ({ codigo: 'P-' + descripcion.length, cabys: '2211000000000', descripcion, cantidad, total_linea: total, tarifa_iva: tarifa });
  const fA = facturaProveedor([lineaProv('Leche entera 1L', 2340000, 1, 24), lineaProv('Vino de la casa', 1130000, 13, 2), lineaProv('Queso fresco', 520000, 0)], { llave });
  const fB = facturaProveedor([lineaProv('Computadora para la caja', 45200000, 13)], { llave });
  const fC = facturaProveedor([lineaProv('Galletas surtidas', 678000, 13, 12)], { llave });
  const fD = facturaProveedor([lineaProv('Bolsas plásticas', 226000, 13, 100)], { llave });
  const fE = facturaProveedor([lineaProv('Aceite de oliva', 1695000, 13, 3)], { llave });
  const fAjena = facturaProveedor([lineaProv('Mercadería de otro negocio', 113000, 13)], { llave, cedulaReceptor: '3101555555' });
  for (const f of [fA, fB, fC, fD, fE]) haciendaConoce(f);
  const cA = importarCompra(fA), cB = importarCompra(fB), cC = importarCompra(fC), cD = importarCompra(fD);
  const cE = importarCompra(fE), cAjena = importarCompra(fAjena);
  const manual = compras.registrarCompra({ proveedor: { identificacion: '3101777777', nombre: 'Panadería La Espiga' }, numero_documento: 'M-1',
    clave: '5'.repeat(50), fecha: montos.fechaLocal().slice(0, 10), lineas: [{ descripcion: 'Pan', cantidad: 1, costo_unitario: 100000, tarifa_iva: 1 }] });
  const enviado = (id) => sim.recibidos.find((r) => r.mensajeReceptor && r.consecutivoReceptor === compras.obtenerMensaje(id).consecutivo);
  const ivaPeriodo = () => { const hoy = montos.fechaLocal().slice(0, 10); return reportes.iva(hoy, hoy); };

  await prueba('Leer la factura del proveedor (clave, cédulas y montos exactos del XML)', () => {
    const f = receptor.leerFactura(fA.xml);
    ok(f.clave === fA.clave && f.emisor.numero === PROVEEDOR.cedula && f.receptor.numero === '3101123456', JSON.stringify(f.receptor));
    ok(xml.decimal5(f.total) === fA.total && xml.decimal5(f.impuesto) === fA.impuesto, f.total + ' / ' + f.impuesto);
    return 'total ' + fA.total + ' · IVA ' + fA.impuesto;
  });
  await prueba('Compra registrada a mano: pide importar el XML', () => falla(() => conector.responderCompra(manual.id, { tipo: '05' }), 'importando el XML'));
  await prueba('Factura a nombre de otra cédula: no se puede aceptar (y no queda "por aceptar")', async () => {
    await falla(() => conector.responderCompra(cAjena.id, { tipo: '05' }), '3101555555');
    ok(/3101555555/.test(compras.obtenerPorId(cAjena.id).no_aceptable) && compras.obtenerPorId(cA.id).no_aceptable === null);
    const lista = compras.listar({});
    ok(!lista.find((c) => c.id === cAjena.id).por_aceptar && !lista.find((c) => c.id === manual.id).por_aceptar && lista.find((c) => c.id === cA.id).por_aceptar);
    return compras.obtenerPorId(cAjena.id).no_aceptable;
  });
  await prueba('Tiquete del proveedor: no se acepta (no lleva receptor)', () =>
    falla(() => receptor.leerFactura(firmado), 'tiquete'));
  let mA;
  await prueba('Aceptación total: consecutivo 05 propio, montos de la factura, XSD y firma válidos', async () => {
    const c = conector.responderCompra(cA.id, { tipo: '05' });
    mA = c.mensaje;
    ok(mA && mA.tipo === '05' && mA.consecutivo === '00100001050000000001' && mA.estado_hacienda === 'pendiente', JSON.stringify(mA));
    await procesarTodo();
    const r = enviado(mA.id);
    ok(r, 'Hacienda no recibió el mensaje');
    ok(r.claveFactura === fA.clave && r.emisor.numeroIdentificacion === PROVEEDOR.cedula && r.receptor.numeroIdentificacion === '3101123456', 'emisor/receptor del envío');
    const x = r.xml;
    ok(x.includes('<Clave>' + fA.clave + '</Clave><NumeroCedulaEmisor>3101999999</NumeroCedulaEmisor><FechaEmisionDoc>'), 'encabezado');
    ok(x.includes('<Mensaje>1</Mensaje><MontoTotalImpuesto>' + fA.impuesto + '</MontoTotalImpuesto><CodigoActividad>471101</CodigoActividad><CondicionImpuesto>01</CondicionImpuesto>'), 'condición 01');
    ok(x.includes('<MontoTotalImpuestoAcreditar>' + fA.impuesto + '</MontoTotalImpuestoAcreditar>'), 'acredita todo el IVA');
    ok(x.includes('<MontoTotalDeGastoAplicable>' + xml.decimal5(fA.montos.total - fA.montos.impuesto) + '</MontoTotalDeGastoAplicable>'), 'gasto = total − IVA');
    ok(x.includes('<TotalFactura>' + fA.total + '</TotalFactura><NumeroCedulaReceptor>3101123456</NumeroCedulaReceptor><NumeroConsecutivoReceptor>00100001050000000001</NumeroConsecutivoReceptor>'), 'cierre');
    ok(!x.includes('<DetalleMensaje>'), 'sin detalle en la aceptación total');
    ok(firmaValida(x, llavePrueba.certPem), 'firma');
    const m = compras.obtenerPorId(cA.id).mensaje;
    ok(m.estado_hacienda === 'aceptado' && m.hacienda_mensaje === 'Aceptado por Hacienda' && m.tiene_respuesta, m.estado_hacienda);
    ok(compras.listar({}).find((c) => c.id === cA.id).mensaje_estado === 'aceptado', 'estado en la lista de compras');
    return validarXsd('MR', x) + ' · ' + mA.consecutivo;
  });
  await prueba('El XSD de MensajeReceptor sí detecta un mensaje mal armado', () => {
    if (!hayXmllint) return 'sin xmllint';
    const x = enviado(mA.id).xml;
    const sinConsecutivo = x.replace(/<NumeroConsecutivoReceptor>\d+<\/NumeroConsecutivoReceptor>/, '');
    const desordenado = x.replace(/(<CondicionImpuesto>01<\/CondicionImpuesto>)(<MontoTotalImpuestoAcreditar>[^<]+<\/MontoTotalImpuestoAcreditar>)/, '$2$1');
    ok(sinConsecutivo !== x && desordenado !== x);
    return falla(() => validarXsd('MR', sinConsecutivo), 'XSD').then(() => falla(() => validarXsd('MR', desordenado), 'XSD')).then(() => 'faltante y desorden rechazados');
  });
  await prueba('La misma factura no se acepta dos veces', () => falla(() => conector.responderCompra(cA.id, { tipo: '07', detalle: 'Cambio de opinión' }), 'ya tiene aceptación'));
  await prueba('Aceptación parcial (06): pide el motivo y valida el IVA a acreditar', async () => {
    await falla(() => conector.responderCompra(cB.id, { tipo: '06', condicion: '02', acreditar: 100 }), 'motivo');
    await falla(() => conector.responderCompra(cB.id, { tipo: '06', detalle: 'Uso mixto', condicion: '02', acreditar: 5200000 }), 'menor que el IVA');
    await falla(() => conector.responderCompra(cB.id, { tipo: '06', detalle: 'x'.repeat(161) }), '160');
    ok(fila("SELECT ultimo FROM secuencias_receptor WHERE tipo = '06'").ultimo === 0, 'los intentos fallidos no gastan consecutivo');
    // Computadora al 13 % usada para una actividad al 4 %: se acredita el 4 % de la base
    const acreditar = 1600000;   // ₡16 000 en céntimos
    const c = conector.responderCompra(cB.id, { tipo: '06', detalle: 'Se acredita solo el 4% (actividad con tarifa reducida)', condicion: '02', acreditar });
    ok(c.mensaje.consecutivo === '00100001060000000001', c.mensaje.consecutivo);
    await procesarTodo();
    const x = enviado(c.mensaje.id).xml;
    ok(x.includes('<Mensaje>2</Mensaje><DetalleMensaje>Se acredita solo el 4% (actividad con tarifa reducida)</DetalleMensaje>'), 'detalle');
    ok(x.includes('<CondicionImpuesto>02</CondicionImpuesto><MontoTotalImpuestoAcreditar>16000.00000</MontoTotalImpuestoAcreditar>'), 'crédito parcial');
    ok(x.includes('<MontoTotalDeGastoAplicable>' + xml.decimal5(fB.montos.total - 16000 * xml.U) + '</MontoTotalDeGastoAplicable>'), 'el resto es gasto');
    ok(compras.obtenerPorId(cB.id).mensaje.estado_hacienda === 'aceptado');
    return validarXsd('MR', x);
  });
  await prueba('Rechazo (07): motivo obligatorio, sin condición ni montos a acreditar', async () => {
    await falla(() => conector.responderCompra(cC.id, { tipo: '07' }), 'motivo del rechazo');
    const c = conector.responderCompra(cC.id, { tipo: '07', detalle: 'La mercadería llegó dañada & incompleta' });
    ok(c.mensaje.consecutivo === '00100001070000000001', c.mensaje.consecutivo);
    await procesarTodo();
    const x = enviado(c.mensaje.id).xml;
    ok(x.includes('<Mensaje>3</Mensaje><DetalleMensaje>La mercadería llegó dañada &amp; incompleta</DetalleMensaje><MontoTotalImpuesto>' + fC.impuesto + '</MontoTotalImpuesto><TotalFactura>'), 'rechazo');
    ok(!/CondicionImpuesto|ImpuestoAcreditar|GastoAplicable|CodigoActividad/.test(x), 'sin crédito ni gasto');
    ok(compras.obtenerPorId(cC.id).mensaje.estado_hacienda === 'aceptado', 'Hacienda aceptó el rechazo');
    return validarXsd('MR', x);
  });
  await prueba('Reporte de IVA: el rechazo y el gasto sin crédito (04) no cuentan como crédito fiscal', async () => {
    const antes = ivaPeriodo();
    const c = conector.responderCompra(cD.id, { tipo: '05', condicion: '04' });
    await procesarTodo();
    const x = enviado(c.mensaje.id).xml;
    ok(x.includes('<CondicionImpuesto>04</CondicionImpuesto><MontoTotalImpuestoAcreditar>0.00000</MontoTotalImpuestoAcreditar><MontoTotalDeGastoAplicable>' + fD.total + '</MontoTotalDeGastoAplicable>'), 'condición 04');
    validarXsd('MR', x);
    const despues = ivaPeriodo();
    const ivaDe = (id) => compras.obtenerPorId(id).impuesto;
    ok(antes.credito_no_acreditable === ivaDe(cC.id) + (ivaDe(cB.id) - 1600000), 'rechazo + parte no acreditada: ' + antes.credito_no_acreditable);
    ok(despues.credito_no_acreditable - antes.credito_no_acreditable === ivaDe(cD.id), 'gasto 04');
    ok(despues.credito_fiscal === despues.compras_iva - despues.credito_no_acreditable, 'crédito = IVA de compras − no acreditable');
    ok(despues.iva_a_pagar === despues.debito_fiscal - despues.credito_fiscal);
    ok(despues.compras_sin_aceptar === 1, 'solo cE queda por aceptar (la ajena y la manual no cuentan): ' + despues.compras_sin_aceptar);
    return 'no acreditable ₡' + despues.credito_no_acreditable / 100 + ' · ' + despues.compras_sin_aceptar + ' compra(s) sin aceptar';
  });
  await prueba('Si Hacienda rechaza el mensaje: se guarda el motivo y se puede enviar otro', async () => {
    haciendaConoce(fE, { total: '1.00000' });   // Hacienda tiene otro total: el mensaje no cuadra
    const primero = conector.responderCompra(cE.id, { tipo: '05' }).mensaje;
    await procesarTodo();
    const m = compras.obtenerPorId(cE.id);
    ok(m.mensaje === null && m.mensajes[0].estado_hacienda === 'rechazado' && /total de la factura no coincide/.test(m.mensajes[0].hacienda_mensaje), JSON.stringify(m.mensajes[0]));
    ok(conector.estado().mensajesPorRevisar === 1 && conector.estado().problemas.some((p) => p.includes('Compras')));
    haciendaConoce(fE);
    const segundo = conector.responderCompra(cE.id, { tipo: '05' }).mensaje;
    ok(segundo.consecutivo === '00100001050000000004' && segundo.id !== primero.id, segundo.consecutivo);
    await procesarTodo();
    ok(compras.obtenerPorId(cE.id).mensaje.estado_hacienda === 'aceptado' && conector.estado().mensajesPorRevisar === 0);
    return primero.consecutivo + ' rechazado → ' + segundo.consecutivo + ' aceptado';
  });
  await prueba('Compra anulada: no se acepta, pero sí se puede rechazar', async () => {
    const fF = facturaProveedor([lineaProv('Producto equivocado', 113000, 13)], { llave });
    haciendaConoce(fF);
    const cF = importarCompra(fF);
    compras.anular(cF.id, 'El proveedor mandó otro producto');
    await falla(() => conector.responderCompra(cF.id, { tipo: '05' }), 'anulada');
    conector.responderCompra(cF.id, { tipo: '07', detalle: 'No corresponde a lo pedido' });
    await procesarTodo();
    ok(compras.obtenerPorId(cF.id).mensaje.estado_hacienda === 'aceptado');
  });
  await prueba('La clave de la compra debe ser la del XML', async () => {
    const fG = facturaProveedor([lineaProv('Café molido', 452000, 13)], { llave });
    const cG = importarCompra(fG, { clave: '506' + '9'.repeat(47) });
    await falla(() => conector.responderCompra(cG.id, { tipo: '05' }), 'no coincide');
  });
  await prueba('Mensajes inmutables y consecutivo sin saltos', async () => {
    await falla(() => sql('UPDATE mensajes_receptor SET total_factura = ? WHERE id = ?', '1.00000', mA.id), 'no se puede modificar');
    await falla(() => sql('UPDATE mensajes_receptor SET detalle = ? WHERE id = ?', 'otro motivo', mA.id), 'no se puede modificar');
    await falla(() => sql('DELETE FROM mensajes_receptor WHERE id = ?', mA.id), 'no se puede borrar');
    await falla(() => sql('UPDATE mensajes_receptor SET xml_firmado = ? WHERE id = ?', '<x/>', mA.id), 'no se puede modificar');
    await falla(() => sql("UPDATE mensajes_receptor SET estado_hacienda = 'pendiente' WHERE id = ?", mA.id), 'definitiva');
    await falla(() => sql("UPDATE mensajes_receptor SET hacienda_respuesta = 'otra' WHERE id = ?", mA.id), 'definitiva');
    await falla(() => sql("UPDATE secuencias_receptor SET ultimo = ultimo + 2 WHERE tipo = '05'"), '1 en 1');
    await falla(() => sql("DELETE FROM secuencias_receptor WHERE tipo = '05'"), 'no se pueden borrar');
    await falla(() => sql(`INSERT INTO mensajes_receptor(compra_id, tipo, numero, consecutivo, clave, fecha_emision, mensaje, emisor_tipo_id, emisor_identificacion,
      receptor_tipo_id, receptor_identificacion, total_factura) VALUES(?, '05', 99, '00100001050000000099', ?, '2026-01-01', 1, '02', '3101999999', '02', '3101123456', '1.00000')`,
      cD.id, fD.clave), 'no coincide con el consecutivo');
    ok(conexion.verificarIntegridad().ok, JSON.stringify(conexion.verificarIntegridad().problemas));
  });
  await prueba('Con el envío desactivado no se crean mensajes', async () => {
    const fH = facturaProveedor([lineaProv('Detergente', 339000, 13)], { llave });
    const cH = importarCompra(fH);
    conector.guardarConfiguracion({ activo: false, ambiente: 'pruebas', usuario: USUARIO });
    await falla(() => conector.responderCompra(cH.id, { tipo: '05' }), 'Active el envío');
    conector.guardarConfiguracion({ activo: true, ambiente: 'pruebas', usuario: USUARIO });
    ok(conector.activo());
  });

  console.log('\nSin internet');
  await prueba('Sin conexión la venta sigue, queda pendiente y la siguiente sale "sin internet"', async () => {
    sim.caido = true;
    const a = ventas.emitir({ lineas: [{ producto_id: leche.id, cantidad: 1 }], medio_pago: 'tarjeta' });
    await conector.procesar();
    const e = conector.estado();
    ok(e.enLinea === false && ventas.obtenerPorId(a.id).estado_hacienda === 'pendiente', JSON.stringify(e.ultimoError));
    const b = ventas.emitir({ lineas: [{ producto_id: leche.id, cantidad: 1 }], medio_pago: 'tarjeta' });
    ok(b.clave[41] === '3' && a.clave[41] === '1', 'situación en la clave: ' + a.clave[41] + ' / ' + b.clave[41]);
    const c = ventas.obtenerPorId(a.id);
    ok(c.hacienda_siguiente && c.hacienda_error, 'reintento programado');
    sim.caido = false;
    await procesarTodo();
    ok(ventas.obtenerPorId(a.id).estado_hacienda === 'aceptado' && ventas.obtenerPorId(b.id).estado_hacienda === 'aceptado');
    ok(conector.estado().enLinea === true && conector.situacion() === '1');
    return 'se enviaron solos al volver la conexión';
  });

  console.log('\nErrores');
  await prueba('Contraseña incorrecta: no se pierde nada y se avisa', async () => {
    conector.guardarConfiguracion({ activo: true, ambiente: 'pruebas', usuario: USUARIO, contrasena: 'otra-clave' });
    const v = ventas.emitir({ lineas: [{ producto_id: leche.id, cantidad: 1 }], medio_pago: 'tarjeta' });
    await conector.procesar();
    ok(ventas.obtenerPorId(v.id).estado_hacienda === 'pendiente');
    ok(/usuario o la contraseña/.test(conector.estado().ultimoError), conector.estado().ultimoError);
    conector.guardarConfiguracion({ activo: true, ambiente: 'pruebas', usuario: USUARIO, contrasena: CONTRASENA });
    await procesarTodo();
    ok(ventas.obtenerPorId(v.id).estado_hacienda === 'aceptado');
  });
  await prueba('Hacienda no recibe el XML (400) → error con la causa; "Reintentar" lo regenera', async () => {
    const v = ventas.emitir({ lineas: [{ producto_id: leche.id, cantidad: 1 }], medio_pago: 'tarjeta' });
    sim.validacion400.add(v.clave);
    await procesarTodo();
    const c = ventas.obtenerPorId(v.id);
    ok(c.estado_hacienda === 'error' && c.hacienda_mensaje.includes('no cumple el esquema'), c.hacienda_mensaje);
    sim.validacion400.delete(v.clave);
    conector.reintentar(v.id);
    await procesarTodo();
    ok(ventas.obtenerPorId(v.id).estado_hacienda === 'aceptado');
  });
  await prueba('El servidor simulado no encontró errores de firma ni de XSD', () => {
    ok(!sim.errores.length, sim.errores.join(' | '));
    return sim.recibidos.length + ' XML validados (' + sim.recibidos.filter((r) => r.mensajeReceptor).length + ' mensajes de receptor)';
  });

  console.log('\nPaso a producción');
  await prueba('No deja pasar a producción con comprobantes de pruebas en la base', () =>
    falla(() => conector.guardarConfiguracion({ ambiente: 'produccion', usuario: 'cpj-3-101-123456@prod.comprobanteselectronicos.go.cr' }), 'Empezar facturación real'));
  await prueba('"Empezar facturación real": archiva la base de pruebas y arranca limpia', async () => {
    const productosAntes = productos.listar().length;
    const stockLeche = productos.buscarPorCodigo('7441001100118').stock;
    const r = await respaldos.empezarBaseNueva('pruebas-hacienda');
    conector.reiniciar();
    ok(fs.existsSync(r.archivo) && respaldos.verificarArchivo(r.archivo).comprobantes === r.comprobantesArchivados);
    ok(fila('SELECT count(*) AS n FROM comprobantes').n === 0 && productos.listar().length === productosAntes);
    ok(productos.buscarPorCodigo('7441001100118').stock === stockLeche, 'existencia como inventario inicial');
    ok(conexion.leerAjustes().cedula === '3101123456' && !conector.estado().configurado, 'ajustes sí, credenciales de pruebas no');
    ok(conexion.verificarIntegridad().ok);
    conector.elegirLlave(llavePrueba.p12, 'llave-prod.p12');
    const e = conector.guardarConfiguracion({ ambiente: 'produccion', usuario: 'cpj-3-101-123456@prod.comprobanteselectronicos.go.cr', contrasena: 'x', pin: '4321' });
    ok(e.ambiente === 'produccion' && !e.activo);
    return path.basename(r.archivo) + ' · ' + r.comprobantesArchivados + ' comprobantes archivados';
  });

  const fallas = resultados.filter((r) => !r).length;
  console.log('\n' + (fallas ? '✘ ' + fallas + ' prueba(s) fallaron' : '✔ Todas las pruebas pasaron (' + resultados.length + ')') + '\n');
  conector.detener();
  await sim.cerrar();
  conexion.cerrar();
  fs.rmSync(carpeta, { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
  app.exit(fallas ? 1 : 0);
}

app.whenReady().then(() => correr().catch((e) => { console.error('Error en la prueba:', e); app.exit(1); }));
