/**
 * correo.prueba.js — Pruebas del envío de facturas al correo del cliente.
 *
 * Usa una base temporal, la Hacienda simulada (firma + XSD) y servidores SMTP
 * simulados (texto plano, SSL/TLS y STARTTLS). Revisa que cada factura aceptada
 * llegue sola al cliente con el PDF, el XML firmado y la respuesta de Hacienda,
 * que sin internet se reintente sola y que nada fiscal cambie.
 *
 * Uso:  npm run prueba:correo
 */
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const datos = require('../principal/datos');
const conector = require('../principal/hacienda/conector');
const correo = require('../principal/hacienda/correo');
const pdf = require('../principal/hacienda/pdf');
const { generarLlavePrueba } = require('./llave-prueba');
const { crearSimulador, firmaValida } = require('./hacienda-simulada');
const { crearSmtp, certificadoLocal } = require('./smtp-simulado');

const { conexion, productos, ventas, caja, respaldos } = datos;

// La ventana oculta del PDF no debe cerrar la prueba al destruirse
app.on('window-all-closed', () => {});

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

const llavePrueba = generarLlavePrueba({ pin: '4321', serie: 'CPJ-3-101-123456' });
const USUARIO = 'cpj-3-101-123456@stag.comprobanteselectronicos.go.cr';
const CONTRASENA = 'W$/JX/AS@K);1]I;u|+6';
const SMTP_USUARIO = 'facturas@besalu.cr';
const SMTP_CONTRASENA = 'Clave del buzón #2026 ñ';
let sim = null, smtp = null;

/** Procesa la cola de Hacienda hasta que no queden pendientes ni enviados. */
async function procesarHacienda(vueltas = 6) {
  for (let i = 0; i < vueltas; i++) {
    sql('UPDATE comprobantes SET hacienda_siguiente = NULL');   // sin esperar los tiempos reales
    await conector.procesar();
    if (!fila("SELECT count(*) AS n FROM comprobantes WHERE estado_hacienda IN ('pendiente','enviado')").n) return;
  }
}
/** Procesa la cola de correo hasta vaciarla (sin esperar los tiempos de reintento). */
async function procesarCorreo(vueltas = 4) {
  for (let i = 0; i < vueltas; i++) {
    await correo.procesar();   // termina el lote en curso, si lo hay
    sql("UPDATE comprobantes SET correo_siguiente = NULL WHERE correo_estado = 'pendiente'");
    await correo.procesar();
    if (!fila("SELECT count(*) AS n FROM comprobantes WHERE correo_estado = 'pendiente'").n) return;
  }
}
const configSmtp = (extra = {}) => Object.assign({ activo: true, servidor: '127.0.0.1', puerto: smtp.puerto, seguridad: 'ninguna',
  usuario: SMTP_USUARIO, contrasena: SMTP_CONTRASENA, remitente: '', nombreRemitente: 'Besalú Mercat', copiaNegocio: true }, extra);
const adjunto = (m, nombre) => m.partes.find((p) => p.archivo === nombre);
const paginas = (b) => (b.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

async function correr() {
  sim = await crearSimulador({ usuario: USUARIO, contrasena: CONTRASENA, certPem: llavePrueba.certPem });
  const certificado = certificadoLocal();
  smtp = await crearSmtp({ usuario: SMTP_USUARIO, contrasena: SMTP_CONTRASENA, modo: 'plano' });

  console.log('\nEnvío de facturas por correo\n\nBase de datos');
  await prueba('Una base v2 con facturas se actualiza a la versión actual sin perder nada (copia antes de migrar)', () => {
    const Database = require('better-sqlite3');
    const { MIGRACIONES } = require('../principal/datos/esquema');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'besalu-correo-v2-'));
    const v2 = new Database(path.join(dir, conexion.NOMBRE_ARCHIVO));
    v2.exec(MIGRACIONES[0]); v2.exec(MIGRACIONES[1]); v2.pragma('user_version = 2');
    v2.prepare("UPDATE secuencias SET ultimo = 1 WHERE tipo = '01'").run();
    v2.prepare(`INSERT INTO comprobantes(tipo, numero, consecutivo, clave, fecha_emision, medio_pago, receptor_tipo_id, receptor_identificacion,
      receptor_nombre, receptor_correo, total_gravado, total_exento, total_venta, total_impuesto, total_comprobante, estado_hacienda)
      VALUES ('01', 1, '00100001010000000001', ?, '2026-10-01T10:00:00-06:00', 'tarjeta', '01', '112345678', 'Ana Mora', 'ana@correo.cr', 100000, 0, 100000, 13000, 113000, 'pendiente')`)
      .run('506011026003101123456001000010100000000011' + '12345678');
    v2.close();
    conexion.abrir(dir);
    try {
      const c = fila('SELECT * FROM comprobantes WHERE numero = 1');
      ok(conexion.obtener().pragma('user_version', { simple: true }) === MIGRACIONES.length, 'versión');
      ok(c.total_comprobante === 113000 && c.receptor_correo === 'ana@correo.cr' && c.correo_estado === null && c.correo_intentos === 0, JSON.stringify(c));
      ok(fs.readdirSync(dir).some((f) => f.startsWith('antes-de-migrar-v2')), 'copia antes de migrar');
      ok(conexion.verificarIntegridad().ok);
    } finally { conexion.cerrar(); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'besalu-correo-db-'));
  conexion.abrir(carpeta);
  respaldos.configurar(carpeta);
  const cifrador = {
    disponible: () => true,
    cifrar: (t) => 'x:' + Buffer.from(String(t), 'utf8').toString('base64').split('').reverse().join(''),
    descifrar: (c) => Buffer.from(String(c).slice(2).split('').reverse().join(''), 'base64').toString('utf8')
  };
  // Tiempos cortos y confianza en el certificado propio del SMTP simulado (solo pruebas)
  conector.configurar({ cifrador, urls: sim.urls, smtp: { connectionTimeout: 3000, greetingTimeout: 3000, socketTimeout: 8000, tls: { ca: certificado.cert } } });

  conexion.guardarAjustes({ negocio: 'Besalú Mercat S.A.', nombreComercial: 'Besalú Mercat · Minimarket Gourmet', tipoCedula: '02', cedula: '3-101-123456',
    actividadEconomica: '471101', telefono: '2222-3333', correo: 'facturas@besalu.cr', provincia: '1', canton: '2', distrito: '3', direccion: 'Escazú, frente a la plaza' });
  const leche = productos.crear({ codigo: '7441001100118', nombre: 'Leche Dos Pinos 1L', cabys: '2211000000000', tarifa_iva: 1, precio: 125000, costo: 98000, stock_inicial: 500 });
  const vino = productos.crear({ codigo: '7440000000404', nombre: 'Vino tinto & "reserva" <2019>', cabys: '2421000000000', tarifa_iva: 13, precio: 890000, costo: 560000, stock_inicial: 200 });
  const queso = productos.crear({ codigo: 'Q-1', nombre: 'Queso Turrialba', cabys: '2290000000000', unidad: 'kg', tarifa_iva: 0, precio: 520000, costo: 380000, stock_inicial: 100 });
  caja.abrir(5000000);
  conector.elegirLlave(llavePrueba.p12, 'llave.p12');
  conector.guardarConfiguracion({ activo: true, ambiente: 'pruebas', usuario: USUARIO, contrasena: CONTRASENA, pin: '4321' });
  const factura = (correoCliente, extra = {}) => ventas.emitir(Object.assign({ lineas: [{ producto_id: vino.id, cantidad: 1 }, { producto_id: queso.id, cantidad: 0.75 }],
    medio_pago: 'sinpe', receptor: { tipo_id: '01', identificacion: '112345678', nombre: 'Ana Mora Solís', correo: correoCliente } }, extra));

  await prueba('Migración 3: columnas del correo aparte; las fiscales siguen inmutables', async () => {
    ok(conexion.obtener().pragma('user_version', { simple: true }) === require('../principal/datos/esquema').MIGRACIONES.length, 'versión del esquema');
    const columnas = conexion.obtener().prepare('PRAGMA table_info(comprobantes)').all().map((c) => c.name);
    for (const c of ['correo_estado', 'correo_destino', 'correo_intentos', 'correo_error', 'correo_siguiente', 'correo_enviado_en']) ok(columnas.includes(c), c);
    const t = ventas.emitir({ lineas: [{ producto_id: leche.id, cantidad: 1 }], medio_pago: 'tarjeta' });
    await falla(() => sql("UPDATE comprobantes SET receptor_correo = 'otro@x.cr' WHERE id = ?", t.id), 'no se puede modificar');
    await falla(() => sql("UPDATE comprobantes SET correo_estado = 'inventado' WHERE id = ?", t.id), 'CHECK');
    sql('UPDATE comprobantes SET correo_error = NULL WHERE id = ?', t.id);   // el estado del correo sí se puede actualizar
    ok(conexion.verificarIntegridad().ok);
  });

  console.log('\nSin correo configurado');
  const f0 = factura('ana@correo.cr');
  await prueba('Factura aceptada sin correo configurado: espera en cola y se avisa', async () => {
    await procesarHacienda();
    await procesarCorreo();
    const c = ventas.obtenerPorId(f0.id);
    ok(c.estado_hacienda === 'aceptado' && c.correo_estado === 'pendiente' && c.correo_destino === 'ana@correo.cr', c.estado_hacienda + ' / ' + c.correo_estado);
    ok(!smtp.mensajes.length);
    const e = conector.estado().correo;
    ok(!e.configurado && e.conteo.pendiente === 1 && e.problemas.some((p) => p.includes('configure el correo')), JSON.stringify(e.problemas));
    return e.problemas[0];
  });

  console.log('\nConfiguración');
  await prueba('Validaciones: servidor, puerto, seguridad y remitente', async () => {
    await falla(() => correo.guardarConfiguracion(configSmtp({ servidor: 'mail sudominio.com' })), 'servidor SMTP no es válido');
    await falla(() => correo.guardarConfiguracion(configSmtp({ puerto: 'abc' })), 'puerto');
    await falla(() => correo.guardarConfiguracion(configSmtp({ puerto: 465, seguridad: 'starttls' })), '465 usa seguridad SSL/TLS');
    await falla(() => correo.guardarConfiguracion(configSmtp({ puerto: 587, seguridad: 'ssl' })), '587 usa STARTTLS');
    await falla(() => correo.guardarConfiguracion(configSmtp({ remitente: 'facturas@' })), 'remitente no es válido');
    await falla(() => correo.guardarConfiguracion(configSmtp({ contrasena: '' })), 'complete servidor, usuario, contraseña');
    ok(!correo.configurado(), 'no quedó nada guardado');
  });
  await prueba('Guardar la configuración: contraseña cifrada y fuera de la bitácora', () => {
    const e = correo.guardarConfiguracion(configSmtp({ activo: false, servidor: 'SMTP://127.0.0.1/' }));
    ok(e.configurado && !e.activo && e.servidor === '127.0.0.1' && e.remitente === SMTP_USUARIO && e.tieneContrasena, JSON.stringify(e));
    const crudo = fila("SELECT valor FROM config WHERE clave = 'correo'").valor;
    ok(!crudo.includes(SMTP_CONTRASENA) && !crudo.includes('#2026'), 'contraseña en texto plano');
    ok(!JSON.stringify(conexion.leerBitacora(50)).includes(SMTP_CONTRASENA), 'contraseña en la bitácora');
    ok(e.problemas.some((p) => p.includes('active el envío')), 'aviso de envío desactivado');
  });
  await prueba('Correo de prueba al correo del negocio', async () => {
    const r = await correo.probar();
    const m = smtp.mensajes[smtp.mensajes.length - 1];
    ok(r.destino === 'facturas@besalu.cr' && m && m.para.join() === 'facturas@besalu.cr' && m.asunto.includes('Prueba de correo'), m && m.asunto);
    return r.mensaje;
  });

  console.log('\nEnvío automático al ser aceptada');
  await prueba('Al activar el envío sale la factura que esperaba', async () => {
    correo.guardarConfiguracion(configSmtp());
    await procesarCorreo();
    const c = ventas.obtenerPorId(f0.id);
    ok(c.correo_estado === 'enviado' && c.correo_enviado_en && c.correo_intentos === 1, c.correo_estado + ' ' + c.correo_error);
    ok(smtp.mensajes.some((m) => m.asunto.includes(f0.consecutivo)));
  });
  const f1 = factura('ana.mora@correo.cr');
  let m1 = null;
  await prueba('Factura aceptada → correo al cliente, solo, con copia oculta al negocio', async () => {
    const antes = smtp.mensajes.length;
    await procesarHacienda();
    await procesarCorreo();
    const c = ventas.obtenerPorId(f1.id);
    ok(c.estado_hacienda === 'aceptado' && c.correo_estado === 'enviado', c.correo_estado + ' ' + c.correo_error);
    ok(smtp.mensajes.length === antes + 1, 'mensajes: ' + (smtp.mensajes.length - antes));
    m1 = smtp.mensajes[smtp.mensajes.length - 1];
    ok(m1.para.includes('ana.mora@correo.cr') && m1.para.includes('facturas@besalu.cr'), 'destinatarios ' + m1.para.join(', '));
    ok(!/bcc/i.test(Object.keys(m1.encabezados).join(',')) && !String(m1.encabezados.to).includes('facturas@'), 'la copia es oculta');
    ok(m1.de === SMTP_USUARIO && /Besal/.test(m1.encabezados.from), 'remitente ' + m1.encabezados.from);
    ok(m1.asunto === 'Factura electrónica ' + c.consecutivo + ' · Besalú Mercat S.A.', m1.asunto);
    const r = conexion.leerBitacora(20).find((b) => b.accion === 'correo_enviado' && b.detalle.includes(c.consecutivo));
    ok(r && r.detalle.includes('ana.mora@correo.cr'), 'bitácora');
    return m1.para.join(' + ');
  });
  await prueba('Adjuntos: clave.pdf, clave.xml (firmado) y clave_respuesta.xml, idénticos a los guardados', () => {
    const c = ventas.obtenerPorId(f1.id);
    const nombres = m1.partes.filter((p) => p.archivo).map((p) => p.archivo);
    ok(JSON.stringify(nombres) === JSON.stringify([c.clave + '.pdf', c.clave + '.xml', c.clave + '_respuesta.xml']), nombres.join(', '));
    const xml = adjunto(m1, c.clave + '.xml').contenido, resp = adjunto(m1, c.clave + '_respuesta.xml').contenido;
    ok(xml.equals(Buffer.from(c.xml_firmado, 'utf8')), 'XML firmado distinto');
    ok(resp.equals(Buffer.from(c.hacienda_respuesta, 'utf8')), 'respuesta distinta');
    ok(firmaValida(xml.toString('utf8'), llavePrueba.certPem), 'la firma del XML adjunto no es válida');
    const archivoPdf = adjunto(m1, c.clave + '.pdf').contenido;
    ok(archivoPdf.slice(0, 5).toString() === '%PDF-' && archivoPdf.length > 5000, 'PDF');
    return 'firma válida · PDF ' + Math.round(archivoPdf.length / 1024) + ' KB';
  });
  await prueba('Texto del correo con consecutivo, total y clave', () => {
    const c = ventas.obtenerPorId(f1.id);
    const texto = m1.partes.find((p) => p.tipo === 'text/plain').contenido.toString('utf8');
    const html = m1.partes.find((p) => p.tipo === 'text/html').contenido.toString('utf8');
    ok(texto.includes('Estimado(a) Ana Mora Solís') && texto.includes(c.consecutivo) && texto.includes(c.clave), texto.slice(0, 120));
    ok(texto.includes(pdf.colones(c.total_comprobante)) && html.includes(c.consecutivo), 'total');
    return pdf.colones(c.total_comprobante);
  });
  await prueba('Tiquetes, facturas sin correo, rechazadas y notas de crédito no se envían', async () => {
    const antes = smtp.mensajes.length;
    const t = ventas.emitir({ lineas: [{ producto_id: leche.id, cantidad: 2 }], medio_pago: 'tarjeta' });
    const sinCorreo = factura('');
    const rechazada = factura('ana@correo.cr');
    sim.rechazar.add(rechazada.clave);
    const nc = ventas.notaCredito(f1.id, 'Devolución del vino');
    await procesarHacienda();
    await procesarCorreo();
    ok(ventas.obtenerPorId(rechazada.id).estado_hacienda === 'rechazado' && ventas.obtenerPorId(nc.id).estado_hacienda === 'aceptado');
    for (const x of [t, sinCorreo, rechazada, nc]) ok(ventas.obtenerPorId(x.id).correo_estado === null, x.consecutivo + ': ' + ventas.obtenerPorId(x.id).correo_estado);
    ok(smtp.mensajes.length === antes, 'se envió algo de más');
  });

  console.log('\nRepresentación gráfica (PDF)');
  await prueba('PDF en hoja carta con emisor, receptor, líneas, IVA y clave', async () => {
    const c = ventas.obtenerPorId(f1.id);
    const h = pdf.html(c, conexion.leerAjustes());
    for (const t of ['Factura electrónica', 'N.° ' + c.consecutivo, 'Besalú Mercat S.A.', 'Cédula jurídica 3101123456', 'Ana Mora Solís', 'Cédula física 112345678',
      'CABYS 2421000000000', 'Vino tinto &amp; &quot;reserva&quot; &lt;2019&gt;', 'IVA 13 %', 'Exento', pdf.colones(c.total_comprobante),
      'Aceptado por Hacienda', 'MH-DGT-RES-0027-2024', c.clave.slice(21, 41)]) ok(h.includes(t), 'falta "' + t + '"');
    ok(!h.includes('<2019>'), 'texto sin escapar');
    const b = await pdf.generar(c, conexion.leerAjustes());
    ok(b.slice(0, 5).toString() === '%PDF-', 'no es PDF');
    ok(/\/MediaBox\s*\[\s*0 0 612 792\s*\]/.test(b.toString('latin1')), 'tamaño carta (612 × 792 pt)');
    return paginas(b) + ' página · ' + Math.round(b.length / 1024) + ' KB';
  });
  await prueba('Factura larga: el PDF sigue en varias páginas', async () => {
    const c = ventas.obtenerPorId(f1.id);
    const base = c.lineas[0];
    c.lineas = Array.from({ length: 70 }, (_x, i) => Object.assign({}, base, { linea: i + 1 }));
    const b = await pdf.generar(c, conexion.leerAjustes());
    ok(paginas(b) >= 2, paginas(b) + ' páginas');
    return paginas(b) + ' páginas';
  });

  console.log('\nReintentos');
  await prueba('Sin internet: queda en cola, se reintenta solo y sale al volver la conexión', async () => {
    smtp.caido = true;
    const f = factura('ana@correo.cr');
    await procesarHacienda();
    ok(ventas.obtenerPorId(f.id).estado_hacienda === 'aceptado', 'Hacienda sigue aceptando aunque el correo no salga');
    await correo.procesar();
    let c = ventas.obtenerPorId(f.id);
    ok(c.correo_estado === 'pendiente' && /Sin conexión/.test(c.correo_error) && c.correo_siguiente, c.correo_estado + ' ' + c.correo_error);
    ok(conector.estado().correo.enLinea === false, 'aviso sin conexión');
    const espera1 = new Date(c.correo_siguiente.replace(' ', 'T')) - Date.now();
    sql('UPDATE comprobantes SET correo_siguiente = NULL WHERE id = ?', f.id);
    await correo.procesar();
    c = ventas.obtenerPorId(f.id);
    const espera2 = new Date(c.correo_siguiente.replace(' ', 'T')) - Date.now();
    ok(c.correo_intentos === 2 && espera2 > espera1, 'espera creciente: ' + Math.round(espera1 / 1000) + ' s → ' + Math.round(espera2 / 1000) + ' s');
    smtp.caido = false;
    await procesarCorreo();
    c = ventas.obtenerPorId(f.id);
    ok(c.correo_estado === 'enviado' && !c.correo_error && conector.estado().correo.enLinea === true, c.correo_estado);
    return 'reintentos a ' + Math.round(espera1 / 1000) + ' s y ' + Math.round(espera2 / 1000) + ' s; salió al volver';
  });
  await prueba('Servidor ocupado (451): se reintenta', async () => {
    smtp.ocupado = true;
    const f = factura('ana@correo.cr');
    await procesarHacienda();
    await correo.procesar();
    const c = ventas.obtenerPorId(f.id);
    ok(c.correo_estado === 'pendiente' && c.correo_error.includes('reintentar más tarde'), c.correo_error);
    smtp.ocupado = false;
    await procesarCorreo();
    ok(ventas.obtenerPorId(f.id).correo_estado === 'enviado');
  });
  await prueba('Contraseña incorrecta: espera, avisa y sale al corregirla', async () => {
    correo.guardarConfiguracion(configSmtp({ contrasena: 'otra' }));
    const f = factura('ana@correo.cr');
    await procesarHacienda();
    await correo.procesar();
    let c = ventas.obtenerPorId(f.id);
    ok(c.correo_estado === 'pendiente' && /usuario o la contraseña/.test(c.correo_error), c.correo_error);
    ok((new Date(c.correo_siguiente.replace(' ', 'T')) - Date.now()) > 20 * 60000, 'espera larga por configuración');
    ok(/usuario o la contraseña/.test(conector.estado().correo.ultimoError));
    correo.guardarConfiguracion(configSmtp());
    await correo.procesar();   // al guardar, lo que esperaba sale sin esperar el reintento
    c = ventas.obtenerPorId(f.id);
    ok(c.correo_estado === 'enviado', c.correo_estado + ' ' + c.correo_error);
  });
  await prueba('Dirección inexistente (550): "no enviado", sin reintentos; Reenviar a la correcta', async () => {
    smtp.rechazar.add('ana@corre.cr');
    const f = factura('ana@corre.cr');
    await procesarHacienda();
    await procesarCorreo();
    let c = ventas.obtenerPorId(f.id);
    ok(c.correo_estado === 'error' && c.correo_error.includes('rechazó la dirección') && !c.correo_siguiente, c.correo_estado + ' ' + c.correo_error);
    ok(conector.estado().correo.problemas.some((p) => p.includes('Reenviar por correo')), 'aviso en Ajustes');
    ok(conexion.leerBitacora(20).some((b) => b.accion === 'correo_error' && b.detalle.includes(c.consecutivo)), 'bitácora');
    c = await correo.reenviar(f.id, 'ana@correo.cr');
    ok(c.correo_estado === 'enviado' && c.correo_destino === 'ana@correo.cr' && c.receptor_correo === 'ana@corre.cr', c.correo_estado + ' ' + c.correo_destino);
    const m = smtp.mensajes[smtp.mensajes.length - 1];
    ok(m.para.includes('ana@correo.cr') && !m.para.includes('ana@corre.cr'));
    return 'el correo del comprobante (fiscal) no cambia: ' + c.receptor_correo;
  });
  await prueba('Reenviar una factura ya enviada: le llega otra vez', async () => {
    const antes = smtp.mensajes.length;
    const c = await correo.reenviar(f1.id);
    ok(c.correo_estado === 'enviado' && smtp.mensajes.length === antes + 1 && smtp.mensajes[antes].para.includes('ana.mora@correo.cr'));
    ok(conexion.leerBitacora(20).some((b) => b.accion === 'correo_reenvio' && b.detalle.includes(c.consecutivo)), 'bitácora');
  });
  await prueba('Reenviar: solo facturas aceptadas y correos válidos', async () => {
    const t = ventas.listar({ tipo: '04', limite: 1 })[0];
    await falla(() => correo.reenviar(t.id, 'ana@correo.cr'), 'Solo las facturas');
    await falla(() => correo.reenviar(f1.id, 'ana@'), 'no es un correo válido');
    sim.caido = true;
    const f = factura('ana@correo.cr');
    await conector.procesar();
    await falla(() => correo.reenviar(f.id), 'cuando Hacienda la acepta');
    sim.caido = false;
    await procesarHacienda();
    await procesarCorreo();
    ok(ventas.obtenerPorId(f.id).correo_estado === 'enviado', 'al aceptarse sale sola');
  });

  console.log('\nSeguridad del servidor');
  const ssl = await crearSmtp({ usuario: SMTP_USUARIO, contrasena: SMTP_CONTRASENA, modo: 'ssl', certificado });
  const starttls = await crearSmtp({ usuario: SMTP_USUARIO, contrasena: SMTP_CONTRASENA, modo: 'starttls', certificado });
  await prueba('SSL/TLS (como el puerto 465): llega cifrado', async () => {
    correo.guardarConfiguracion(configSmtp({ servidor: 'localhost', puerto: ssl.puerto, seguridad: 'ssl' }));
    const f = factura('ana@correo.cr');
    await procesarHacienda();
    await procesarCorreo();
    ok(ventas.obtenerPorId(f.id).correo_estado === 'enviado' && ssl.mensajes.length === 1 && ssl.mensajes[0].cifrado, ventas.obtenerPorId(f.id).correo_error);
  });
  await prueba('STARTTLS (como el puerto 587): llega cifrado', async () => {
    correo.guardarConfiguracion(configSmtp({ servidor: 'localhost', puerto: starttls.puerto, seguridad: 'starttls' }));
    await correo.probar();
    ok(starttls.mensajes.length === 1 && starttls.mensajes[0].cifrado);
  });
  await prueba('STARTTLS obligatorio: si el servidor no cifra, la contraseña no se envía', async () => {
    const antes = smtp.autenticaciones;
    correo.guardarConfiguracion(configSmtp({ seguridad: 'starttls' }));
    const msg = await falla(() => correo.probar(), 'no permitió una conexión cifrada');
    ok(smtp.autenticaciones === antes, 'se autenticó sin cifrado');
    return msg.slice(0, 70);
  });
  await prueba('Certificado que no corresponde al servidor → mensaje claro', async () => {
    correo.guardarConfiguracion(configSmtp({ servidor: '127.0.0.1', puerto: ssl.puerto, seguridad: 'ssl' }));
    return (await falla(() => correo.probar(), 'certificado de seguridad no corresponde')).slice(0, 80) + '…';
  });
  await prueba('Errores de red reconocidos (rechazada, DNS, tiempo agotado)', () => {
    for (const e of [{ code: 'ESOCKET', errno: 'ECONNREFUSED', message: 'connect ECONNREFUSED' }, { code: 'EDNS', message: 'getaddrinfo ENOTFOUND mail.x.cr' },
      { code: 'ETIMEDOUT', message: 'Greeting never received' }, { code: 'ECONNECTION', message: 'Connection closed unexpectedly' }]) {
      ok(correo.clasificar(Object.assign(new Error(e.message), e)).tipo === 'red', e.code);
    }
    ok(correo.clasificar(Object.assign(new Error('x'), { code: 'EENVELOPE', command: 'MAIL FROM', responseCode: 553, response: '553 no permitido' })).tipo === 'configuracion');
  });

  console.log('\nBase nueva');
  await prueba('"Empezar facturación real" conserva la configuración del correo', async () => {
    correo.guardarConfiguracion(configSmtp());
    await respaldos.empezarBaseNueva('pruebas-hacienda');
    conector.reiniciar();
    const e = correo.estado();
    ok(e.configurado && e.activo && e.servidor === '127.0.0.1' && e.conteo.enviado === 0, JSON.stringify(e));
    await correo.probar();
    return 'la contraseña cifrada sigue sirviendo';
  });

  const fallas = resultados.filter((r) => !r).length;
  console.log('\n' + (fallas ? '✘ ' + fallas + ' prueba(s) fallaron' : '✔ Todas las pruebas pasaron (' + resultados.length + ')') + '\n');
  conector.detener();
  await Promise.all([sim.cerrar(), smtp.cerrar(), ssl.cerrar(), starttls.cerrar()]);
  conexion.cerrar();
  fs.rmSync(carpeta, { recursive: true, force: true });
  app.exit(fallas ? 1 : 0);
}

app.whenReady().then(() => correr().catch((e) => { console.error('Error en la prueba:', e); app.exit(1); }));
