/**
 * app.prueba.js — Prueba de punta a punta con la app REAL (interfaz + base).
 *
 * Usa una carpeta de datos temporal (no toca los datos del negocio) y recorre el
 * día de trabajo: configurar negocio → conectar Hacienda → producto → compra desde
 * XML → aceptarla ante Hacienda → abrir caja → vender → facturar → nota de crédito →
 * Hacienda acepta → la factura llega sola al correo del cliente → IVA → cierre Z →
 * respaldo → reiniciar.
 *
 * Hacienda y el servidor de correo son servidores locales simulados (Hacienda
 * verifica firma y XSD) y la llave .p12 es falsa: nada sale de esta computadora.
 *
 * Uso:  npm run prueba:app
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const net = require('net');

const { generarLlavePrueba } = require('./apoyo/llave-prueba');
const { crearSimulador } = require('./apoyo/hacienda-simulada');
const { crearSmtp } = require('./apoyo/smtp-simulado');

const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'besalu-app-'));
app.setPath('userData', carpeta);

// Hacienda simulada y llave de prueba (la app apunta a ellas solo en desarrollo)
const PUERTO = 30000 + Math.floor(Math.random() * 20000);
const USUARIO = 'cpj-3-101-123456@stag.comprobanteselectronicos.go.cr';
const CONTRASENA = 'W$/JX/AS@K);1]I;u|+6';
const llavePrueba = generarLlavePrueba({ pin: '4321', serie: 'CPJ-3-101-123456' });
const archivoLlave = path.join(carpeta, 'llave-prueba.p12');
fs.writeFileSync(archivoLlave, llavePrueba.p12);
const base = 'http://127.0.0.1:' + PUERTO;
process.env.BESALU_HACIENDA_URLS = JSON.stringify({ token: base + '/token', cerrarSesion: base + '/logout', recepcion: base + '/recepcion' });
process.env.BESALU_CIFRADO_PRUEBA = '1';
require('electron').dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [archivoLlave] });   // "Elegir archivo .p12…"
require('../principal/main.js');
let sim = null, smtp = null;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const resultados = [];
const erroresConsola = [];
function verificar(nombre, ok, detalle) {
  resultados.push({ nombre, ok: !!ok });
  console.log((ok ? '  ✔ ' : '  ✘ ') + nombre + (detalle ? '  — ' + detalle : ''));
}
let ventana;
// Cada fragmento va en su propio bloque para que sus const/let no choquen entre pasos
const js = (codigo) => ventana.webContents.executeJavaScript('{' + codigo + '\n}', true);

// Factura electrónica de proveedor (estructura v4.4 de Hacienda, datos de prueba)
const XML_PROVEEDOR = `<?xml version="1.0" encoding="utf-8"?>
<FacturaElectronica xmlns="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica">
  <Clave>50614102600310199999900100001010000004521112345678</Clave>
  <NumeroConsecutivo>00100001010000004521</NumeroConsecutivo>
  <FechaEmision>${require('../principal/datos/montos').fechaIso()}</FechaEmision>
  <Emisor><Nombre>Distribuidora Central S.A.</Nombre><Identificacion><Tipo>02</Tipo><Numero>3101999999</Numero></Identificacion><CorreoElectronico>ventas@dc.cr</CorreoElectronico></Emisor>
  <Receptor><Nombre>Besalú Mercat S.A.</Nombre><Identificacion><Tipo>02</Tipo><Numero>3101123456</Numero></Identificacion></Receptor>
  <DetalleServicio>
    <LineaDetalle><NumeroLinea>1</NumeroLinea><CodigoCABYS>2211000000000</CodigoCABYS><CodigoComercial><Tipo>04</Tipo><Codigo>7441001100118</Codigo></CodigoComercial>
      <Cantidad>24</Cantidad><UnidadMedida>Unid</UnidadMedida><Detalle>Leche Dos Pinos 1L</Detalle><PrecioUnitario>975.00</PrecioUnitario><MontoTotal>23400.00</MontoTotal><SubTotal>23400.00</SubTotal>
      <Impuesto><Codigo>01</Codigo><Tarifa>1.00</Tarifa><Monto>234.00</Monto></Impuesto><MontoTotalLinea>23634.00</MontoTotalLinea></LineaDetalle>
    <LineaDetalle><NumeroLinea>2</NumeroLinea><CodigoCABYS>2399999000000</CodigoCABYS><CodigoComercial><Tipo>04</Tipo><Codigo>7441099900011</Codigo></CodigoComercial>
      <Cantidad>12</Cantidad><UnidadMedida>Unid</UnidadMedida><Detalle>Galletas Pozuelo Chiky</Detalle><PrecioUnitario>650.00</PrecioUnitario><MontoTotal>7800.00</MontoTotal><SubTotal>7800.00</SubTotal>
      <Impuesto><Codigo>01</Codigo><Tarifa>13.00</Tarifa><Monto>1014.00</Monto></Impuesto><MontoTotalLinea>8814.00</MontoTotalLinea></LineaDetalle>
  </DetalleServicio>
  <ResumenFactura><TotalImpuesto>1248.00</TotalImpuesto><TotalComprobante>32448.00</TotalComprobante></ResumenFactura>
</FacturaElectronica>`;

// Utilidades inyectadas en la página para "tocar" la interfaz como un cajero
const AYUDAS = `
  window.__modal = () => { const m = document.querySelectorAll('#modalRoot .modal'); return m[m.length - 1]; };
  window.__campo = (etiqueta, raiz) => { const c = [...(raiz || window.__modal() || document).querySelectorAll('.campo, .cfg-row')]
      .find(n => { const l = n.querySelector('label, .l'); return l && l.textContent.trim() === etiqueta; });
    return c && c.querySelector('input, select'); };
  window.__escribir = (input, valor) => { input.value = valor; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); };
  window.__boton = (texto, raiz) => [...(raiz || document).querySelectorAll('button')].find(b => b.textContent.trim().startsWith(texto));
  window.__enter = (input) => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  window.__impresiones = 0;
  imprimir = async function () { window.__impresiones++; };   // en la prueba no se imprime de verdad
  true;`;

async function esperarLista() {
  for (let i = 0; i < 200; i++) {
    try { if (await js("typeof App!=='undefined' && !document.getElementById('app').hidden && App.catalogo !== undefined")) return true; } catch (e) {}
    await esperar(50);
  }
  return false;
}
/** Con BESALU_CAPTURAS=<carpeta> guarda imágenes de la pantalla para revisarla a ojo. */
async function captura(nombre) {
  const dir = process.env.BESALU_CAPTURAS;
  if (!dir) return;
  await js(`document.querySelectorAll('.toast').forEach((t) => t.remove()); true`);   // los avisos taparían la pantalla
  await esperar(350);
  fs.writeFileSync(path.join(dir, nombre + '.png'), (await ventana.webContents.capturePage()).toPNG());
}
/** Espera a que una condición de la pantalla se cumpla (o se rinde y sigue: la verificación dirá qué falló). */
async function hasta(codigo, intentos = 80) {
  // La condición se evalúa dentro de la página y sus errores se atrapan ahí mismo: mientras la
  // pantalla se dibuja, un elemento todavía no existe y eso no es un error de la app
  const seguro = `(async () => { try { return !!(await (${codigo})); } catch (e) { return false; } })()`;
  for (let i = 0; i < intentos; i++) { try { if (await js(seguro)) return true; } catch (e) {} await esperar(100); }
  return false;
}
async function recargar() {
  const cargada = new Promise((r) => ventana.webContents.once('did-finish-load', r));
  const t = Date.now();
  ventana.webContents.reload();
  await cargada;
  const ok = await esperarLista();
  await js(AYUDAS);
  return { ok, ms: Date.now() - t };
}
const hoy = () => js("periodo('mes')");

async function correr() {
  for (let i = 0; i < 100 && !(ventana = BrowserWindow.getAllWindows()[0]); i++) await esperar(100);
  // Electron 35+: los datos vienen en el evento (level: 'error'); antes, como argumentos
  ventana.webContents.on('console-message', (e, nivel, mensaje) => {
    const esError = e && e.level !== undefined ? e.level === 'error' : nivel >= 3;
    // Con el archivo y la línea: si falla en otra máquina se sabe de dónde vino
    const donde = (e && e.sourceId) ? ' @ ' + String(e.sourceId).split('/').pop() + ':' + e.lineNumber : '';
    if (esError) erroresConsola.push(((e && e.message) || mensaje) + donde);
  });
  await ventana.webContents.executeJavaScript("console.error('__control__'); true");   // la escucha sí detecta errores
  await esperar(100);
  verificar('La escucha de errores de consola funciona', erroresConsola.some((m) => m.startsWith('__control__')));
  erroresConsola.length = 0;
  console.log('\nPrueba completa (app real) · datos temporales en ' + carpeta + '\n');

  const t0 = Date.now();
  verificar('La app abre', await esperarLista(), (Date.now() - t0) + ' ms');
  await js(AYUDAS);
  verificar('Sin cédula, abre en Ajustes para configurar', await js("App.vista === 'ajustes' && !App.ajustes.cedula"));
  verificar('Aviso de actualización oculto', await js("getComputedStyle(document.getElementById('upd')).display === 'none'"));

  // ---- Configurar negocio ----
  await js(`const v = document.getElementById('v-ajustes');
    __escribir(__campo('Número de cédula', v), '3-101-123456');
    __escribir(__campo('Teléfono', v), '2222-3333');
    __escribir(__campo('Actividad económica', v), '471101');
    __escribir(__campo('Correo (aquí llegan las respuestas de los clientes)', v), 'facturas@besalu.cr');
    __escribir(__campo('Provincia', v), '1'); __escribir(__campo('Cantón', v), '02'); __escribir(__campo('Distrito', v), '03');
    __escribir(__campo('Dirección (otras señas)', v), 'Escazú, frente a la plaza');
    __campo('Imprimir al cobrar', v).checked = false;
    __boton('Guardar cambios', v).click(); true`);
  await esperar(500);
  verificar('Guardar datos del negocio (emisor completo)', await js("App.ajustes.cedula === '3101123456' && App.ajustes.imprimirAlCobrar === false && App.ajustes.canton === '02'"));

  // ---- Conectar Hacienda desde Ajustes ----
  sim = await crearSimulador({ usuario: USUARIO, contrasena: CONTRASENA, certPem: llavePrueba.certPem, puerto: PUERTO });
  await js(`__boton('Elegir archivo .p12', document.querySelector('.hacienda-card')).click(); true`); await esperar(300);
  await js(`const t = document.querySelector('.hacienda-card');
    __escribir(__campo('Usuario de la API', t), '${USUARIO}');
    __escribir(__campo('Contraseña de la API', t), ${JSON.stringify(CONTRASENA)});
    __escribir(__campo('PIN de la llave', t), '4321');
    __campo('Enviar comprobantes a Hacienda', t).checked = true;
    __boton('Guardar conexión', t).click(); true`);
  await esperar(700);
  const hc = await js("({ activo: App.hacienda && App.hacienda.activo, titular: App.hacienda && App.hacienda.certificado && App.hacienda.certificado.titular, pill: document.getElementById('hpill').hidden ? '' : document.getElementById('hpill').textContent })");
  verificar('Conectar Hacienda (llave .p12, PIN, usuario y contraseña)', hc.activo && /BESALU/.test(hc.titular) && hc.pill.includes('Hacienda'), hc.titular + ' · ' + hc.pill);
  await js(`__boton('Probar conexión', document.querySelector('.hacienda-card')).click(); true`); await esperar(600);
  verificar('Probar conexión con Hacienda', await js("App.hacienda.enLinea === true"));

  // ---- Correo del negocio para enviar las facturas (SMTP simulado) ----
  smtp = await crearSmtp({ usuario: 'facturas@besalu.cr', contrasena: 'clave-del-buzon', modo: 'plano' });
  await js(`const t = document.querySelector('.correo-card');
    __escribir(__campo('Servidor SMTP', t), '127.0.0.1');
    __escribir(__campo('Seguridad', t), 'ninguna');
    __escribir(__campo('Puerto', t), '${smtp.puerto}');
    __escribir(__campo('Usuario (correo completo)', t), 'facturas@besalu.cr');
    __escribir(__campo('Contraseña', t), 'clave-del-buzon');
    __campo('Enviar cada factura aceptada al cliente', t).checked = true;
    __boton('Guardar correo', t).click(); true`);
  await esperar(600);
  const ce = await js("({ activo: App.hacienda.correo.activo, remitente: App.hacienda.correo.remitente, pill: document.querySelector('.correo-card .card-t .pill').textContent })");
  verificar('Configurar el correo SMTP del negocio (Ajustes)', ce.activo && ce.remitente === 'facturas@besalu.cr' && ce.pill === 'Activo', ce.pill + ' · ' + ce.remitente);
  await js(`__boton('Enviar correo de prueba', document.querySelector('.correo-card')).click(); true`); await esperar(800);
  verificar('Correo de prueba al negocio', smtp.mensajes.length === 1 && smtp.mensajes[0].para.includes('facturas@besalu.cr'), smtp.mensajes[0] && smtp.mensajes[0].asunto);

  // ---- Producto nuevo ----
  await js(`go('inventario'); true`); await esperar(300);
  await js(`modalProducto(); const m = __modal();
    __escribir(__campo('Código de barras', m), '7441001100118');
    __escribir(__campo('Nombre', m), 'Leche Dos Pinos 1L');
    __escribir(__campo('CABYS (Hacienda)', m), '2211000000000');
    __escribir(__campo('Tarifa de IVA', m), '1');
    __escribir(__campo('Costo sin IVA (₡)', m), '980');
    __escribir(__campo('Precio de venta con IVA (₡)', m), '1250');
    __escribir(__campo('Existencia inicial', m), '10');
    __boton('Agregar', m).click(); true`);
  await esperar(500);
  const leche = await js("App.catalogo.find(p => p.codigo === '7441001100118')");
  verificar('Agregar producto con CABYS, IVA 1% y existencia inicial', leche && leche.stock === 10 && leche.precio === 125000 && leche.tarifa_iva === 1, leche && (leche.nombre + ' · stock ' + leche.stock));

  // ---- Compra importando el XML del proveedor ----
  await js(`go('compras'); true`); await esperar(300);
  await js(`formularioCompra(leerXmlCompra(${JSON.stringify(XML_PROVEEDOR)})); true`); await esperar(500);
  const borrador = await js(`({ titulo: __modal().querySelector('h2').textContent, cuadra: !!__modal().querySelector('.totales-compra .pill--green'), filas: __modal().querySelectorAll('.lineas-compra tbody tr').length })`);
  verificar('Leer XML de factura electrónica (2 líneas, total cuadra)', borrador.filas === 2 && borrador.cuadra, borrador.titulo);
  await js(`__boton('Registrar compra', __modal()).click(); true`); await esperar(700);
  const tras = await js(`(async () => { const c = await BESALU.compras.listar({}); const ps = await BESALU.productos.listar();
    return { compras: c.length, iva: c[0] && c[0].impuesto, total: c[0] && c[0].total,
      leche: ps.find(p => p.codigo === '7441001100118').stock, galletas: ps.find(p => p.codigo === '7441099900011') }; })()`);
  verificar('Registrar compra: suma inventario y crea producto nuevo', tras.compras === 1 && tras.leche === 34 && tras.galletas && tras.galletas.stock === 12,
    'leche ' + tras.leche + ' · galletas ' + (tras.galletas && tras.galletas.stock) + ' a ' + (tras.galletas && tras.galletas.precio / 100));
  verificar('IVA de la compra exacto según la factura', tras.iva === 124800 && tras.total === 3244800, '₡' + tras.iva / 100 + ' de IVA');
  await js(`formularioCompra(leerXmlCompra(${JSON.stringify(XML_PROVEEDOR)})); true`); await esperar(400);
  await js(`__boton('Registrar compra', __modal()).click(); true`); await esperar(500);
  verificar('No permite registrar la misma factura dos veces', await js('(async () => (await BESALU.compras.listar({})).length === 1)()'));
  await js('while (hayModal()) cerrarModal(); true');

  // ---- Aceptar la factura de compra ante Hacienda (Mensaje Receptor) ----
  await js(`(async () => { const l = await BESALU.compras.listar({}); await verCompra(l[0].id); })(); true`); await esperar(400);
  const antesMr = await js(`({ pill: __modal().querySelector('.hseccion .pill').textContent, botones: [...__modal().querySelectorAll('.hseccion button')].map(b => b.textContent) })`);
  await js(`__boton('Aceptar ante Hacienda', __modal()).click(); true`); await esperar(500);
  const formMr = await js(`({ titulo: __modal().querySelector('h2').textContent, resumen: __modal().querySelector('.totales-compra').textContent })`);
  await js(`__boton('Enviar a Hacienda', __modal()).click(); true`); await esperar(700);
  const mr = await js(`(async () => { const c = await BESALU.compras.obtener((await BESALU.compras.listar({}))[0].id);
    return { cons: c.mensaje && c.mensaje.consecutivo, condicion: c.mensaje && c.mensaje.condicion_impuesto, abierta: !!document.querySelector('#modalRoot [data-compra]') }; })()`);
  verificar('Aceptar la factura de compra ante Hacienda (Mensaje Receptor 05, desde el detalle)',
    antesMr.pill === 'Sin aceptar' && antesMr.botones.includes('Rechazar') && formMr.resumen.includes('IVA a acreditar') && mr.cons === '00100001050000000001' && mr.condicion === '01' && mr.abierta,
    formMr.titulo + ' · ' + mr.cons);
  await js('while (hayModal()) cerrarModal(); true');

  // ---- Abrir caja y vender ----
  await js(`go('caja'); modalAbrirCaja(); __boton('Abrir caja', __modal()).click(); true`); await esperar(500);
  verificar('Abrir caja con fondo', await js('!!App.turno && App.turno.fondo === 5000000'));
  await js(`const c = document.getElementById('cod'); for (let i = 0; i < 3; i++) { c.value = '7441001100118'; __enter(c); } true`);
  await js(`__escribir(document.getElementById('inp-paga'), '5000'); __boton('Cobrar').click(); true`); await esperar(500);
  const v1 = await js('Caja.hecho && { tipo: Caja.hecho.tipo, total: Caja.hecho.total_comprobante, cambio: Caja.hecho.cambio, cons: Caja.hecho.consecutivo, clave: Caja.hecho.clave }');
  verificar('Tiquete en efectivo con cambio, consecutivo y clave', v1 && v1.tipo === '04' && v1.total === 375000 && v1.cambio === 125000 && v1.cons === '00100001040000000001' && v1.clave.length === 50,
    v1 && (v1.cons + ' · cambio ₡' + v1.cambio / 100));

  // ---- Impresión: solo el comprobante ----
  await js(`const z = document.getElementById('zona-impresion'); z.innerHTML = ''; z.appendChild(armarComprobante(Caja.hecho)); true`);
  const dbg = ventana.webContents.debugger;
  dbg.attach('1.3');
  await dbg.sendCommand('Emulation.setEmulatedMedia', { media: 'print' });
  const imp = await js("({ app: getComputedStyle(document.getElementById('app')).display, ticket: getComputedStyle(document.getElementById('zona-impresion')).display, texto: document.getElementById('zona-impresion').textContent })");
  await dbg.sendCommand('Emulation.setEmulatedMedia', { media: '' });
  dbg.detach();
  verificar('Al imprimir solo sale el comprobante (con clave y desglose de IVA)', imp.app === 'none' && imp.ticket === 'block' && imp.texto.includes('Clave') && imp.texto.includes('IVA 1%'));

  // ---- Factura a cliente (SINPE) ----
  await js(`nuevaVenta(); modalCliente(); const m = __modal();
    __escribir(__campo('Identificación', m), '1-1234-5678'); __escribir(__campo('Nombre o razón social', m), 'Ana Mora');
    __escribir(__campo('Correo (opcional)', m), 'ana@correo.cr');
    __boton('Usar para la factura', m).click(); true`);
  await js(`const c = document.getElementById('cod'); c.value = 'galletas'; __enter(c); c.value = '7441099900011'; __enter(c);
    __boton('SINPE', document.querySelector('.metodos')).click(); true`);
  await js(`__boton('Cobrar').click(); true`); await esperar(500);
  const f1 = await js('Caja.hecho && { tipo: Caja.hecho.tipo, cliente: Caja.hecho.receptor_nombre, total: Caja.hecho.total_comprobante }');
  verificar('Factura a cliente por SINPE (búsqueda por nombre + escaneo)', f1 && f1.tipo === '01' && f1.cliente === 'Ana Mora' && f1.total === 191000, f1 && ('₡' + f1.total / 100));

  // ---- Nota de crédito sobre el primer tiquete ----
  await js(`go('ventas'); true`); await esperar(400);
  await js(`(async () => { const l = await BESALU.ventas.listar({}); await verComprobante(l.find(c => c.tipo === '04').id); })(); true`); await esperar(400);
  await js(`__boton('Nota de crédito', __modal()).click(); true`); await esperar(200);
  await js(`const m = __modal(); __escribir(m.querySelector('input'), 'Cliente devolvió la leche'); __boton('Emitir nota de crédito', m).click(); true`); await esperar(600);
  const nc = await js(`(async () => { const l = await BESALU.ventas.listar({}); const ps = await BESALU.productos.listar();
    return { tipos: l.map(c => c.tipo).sort().join(','), leche: ps.find(p => p.codigo === '7441001100118').stock }; })()`);
  verificar('Nota de crédito: anula el tiquete y devuelve inventario', nc.tipos === '01,03,04' && nc.leche === 34, 'comprobantes ' + nc.tipos + ' · leche ' + nc.leche);

  // ---- IVA en Reportes ----
  await js(`go('reportes'); true`); await esperar(600);
  const p = await hoy();
  const rIva = await js(`BESALU.reportes.iva('${p.desde}', '${p.hasta}')`);
  const ui = await js("({ k: document.querySelector('.iva-total .k').textContent, v: document.querySelector('.iva-total .v').textContent })");
  const cuadra = rIva.debito_fiscal === 21973 && rIva.credito_fiscal === 124800 && rIva.iva_a_pagar === 21973 - 124800;
  verificar('IVA: débito − crédito correcto y visible en Reportes', cuadra && ui.k.startsWith('Saldo a favor'),
    'débito ₡' + rIva.debito_fiscal / 100 + ' − crédito ₡' + rIva.credito_fiscal / 100 + ' → ' + ui.k.split('·')[0].trim() + ' ' + ui.v);
  const bal = await js(`BESALU.reportes.balance('${p.desde}', '${p.hasta}')`);
  verificar('Balance: entradas y salidas', bal.unidades_entradas === 10 + 36 + 3 && bal.unidades_salidas === 3 + 2, 'entradas ' + bal.unidades_entradas + ' · salidas ' + bal.unidades_salidas);

  // ---- Cierre de caja ----
  await js(`go('cierre'); true`); await esperar(500);
  const esperado = await js("(async () => (await BESALU.caja.resumen()).efectivo_esperado)()");
  verificar('Arqueo: fondo + efectivo − devoluciones', esperado === 5000000, '₡' + esperado / 100);
  await js(`__escribir(document.querySelector('#v-cierre input'), '50000'); __boton('Cerrar caja y generar Z').click(); true`); await esperar(200);
  await js(`__boton('Cerrar caja', __modal()).click(); true`); await esperar(700);
  verificar('Cerrar caja e imprimir Z', await js('App.turno === null && window.__impresiones >= 1'));

  // ---- Hacienda acepta todo lo emitido ----
  let pendientes = 99;
  for (let i = 0; i < 40 && pendientes; i++) {
    await esperar(500);
    pendientes = await js(`(async () => (await BESALU.ventas.listar({})).filter(c => c.estado_hacienda !== 'aceptado').length
      + (await BESALU.compras.listar({})).filter(c => c.mensaje_estado !== 'aceptado').length)()`);
  }
  const hz = await js("(async () => { const l = await BESALU.ventas.listar({}); return { n: l.length, estados: [...new Set(l.map(c => c.estado_hacienda))].join(',') }; })()");
  const comprobantesRecibidos = sim.recibidos.filter((r) => !r.mensajeReceptor).length;
  verificar('Hacienda aceptó los ' + hz.n + ' comprobantes (enviados solos, en segundo plano)', pendientes === 0 && comprobantesRecibidos === hz.n && !sim.errores.length,
    hz.estados + (sim.errores.length ? ' · ' + sim.errores[0] : ''));
  let enviada = null;
  for (let i = 0; i < 40 && !(enviada && enviada.correo_estado === 'enviado'); i++) {
    await esperar(250);
    enviada = await js("(async () => { const l = await BESALU.ventas.listar({}); const c = await BESALU.ventas.obtener(l.find(c => c.tipo === '01').id); return { correo_estado: c.correo_estado, clave: c.clave }; })()");
  }
  const alCliente = () => smtp.mensajes.filter((m) => m.para.includes('ana@correo.cr'));
  const adjuntos = alCliente()[0] ? alCliente()[0].partes.filter((p) => p.archivo).map((p) => p.archivo) : [];
  verificar('La factura aceptada llegó sola al correo del cliente (PDF, XML firmado y respuesta)', enviada.correo_estado === 'enviado' && alCliente().length === 1 &&
    adjuntos.join() === [enviada.clave + '.pdf', enviada.clave + '.xml', enviada.clave + '_respuesta.xml'].join(), adjuntos.map((a) => a.slice(41)).join(', '));
  await js(`go('compras'); true`); await esperar(400);
  await js(`(async () => { const l = await BESALU.compras.listar({}); await verCompra(l[0].id); })(); true`); await esperar(400);
  const secMr = await js("({ pill: __modal().querySelector('.hseccion .pill').textContent, botones: [...__modal().querySelectorAll('.hseccion button')].map(b => b.textContent), lista: document.querySelector('#v-compras tbody tr td:last-child').textContent })");
  const recibidoMr = sim.recibidos.find((r) => r.mensajeReceptor);
  verificar('Hacienda aceptó el Mensaje Receptor: la compra muestra "Factura aceptada" y su XML',
    recibidoMr && recibidoMr.claveFactura === '50614102600310199999900100001010000004521112345678' && secMr.pill === 'Factura aceptada' && secMr.lista === 'Factura aceptada' &&
    secMr.botones.includes('XML del mensaje') && secMr.botones.includes('Respuesta de Hacienda'), secMr.botones.join(' · '));
  await js('while (hayModal()) cerrarModal(); true');
  await js(`go('ventas'); true`); await esperar(500);
  await js(`(async () => { const l = await BESALU.ventas.listar({}); await verComprobante(l.find(c => c.tipo === '01').id); })(); true`); await esperar(500);
  const sec = await js("({ texto: __modal().querySelector('.hseccion').textContent, botones: [...__modal().querySelectorAll('.hseccion button')].map(b => b.textContent) })");
  verificar('El comprobante muestra "Aceptado" y permite guardar el XML firmado y la respuesta', sec.texto.includes('Aceptado (pruebas)') && sec.botones.includes('XML firmado') && sec.botones.includes('Respuesta de Hacienda'), sec.botones.join(' · '));
  verificar('Ventas muestra el correo enviado y el botón "Reenviar por correo"', sec.texto.includes('Enviada a ana@correo.cr') && sec.botones.includes('Reenviar por correo'));
  await js(`__boton('Reenviar por correo', __modal()).click(); true`); await esperar(200);
  const destino = await js("__modal().querySelector('input').value");
  await js(`__boton('Enviar', __modal()).click(); true`);
  for (let i = 0; i < 20 && alCliente().length < 2; i++) await esperar(200);
  await esperar(300);
  verificar('"Reenviar por correo" la envía otra vez', destino === 'ana@correo.cr' && alCliente().length === 2 && await js("!!__modal() && __modal().textContent.includes('Enviada a ana@correo.cr')"), 'a ' + destino);
  await js('while (hayModal()) cerrarModal(); true');
  verificar('Indicador "Hacienda al día"', await js("document.getElementById('hpill').textContent.includes('al día')"));

  // ---- Respaldo ----
  await js(`go('ajustes'); true`); await esperar(500);
  await js(`__boton('Respaldar ahora').click(); true`); await esperar(800);
  const resp = await js('BESALU.respaldos.listar()');
  verificar('Respaldos (automático al cerrar caja + manual)', resp.length >= 2, resp.map((r) => r.archivo.split('-').pop()).join(', '));

  // ---- Reiniciar y comprobar que todo quedó guardado ----
  const r1 = await recargar();
  const persist = await js(`(async () => ({ comp: (await BESALU.ventas.listar({})).length, compras: (await BESALU.compras.listar({})).length,
    prods: App.catalogo.length, turno: App.turno, cedula: App.ajustes.cedula, integ: (await BESALU.sistema.verificar()).ok }))()`);
  verificar('Reabre y todo persiste (3 comprobantes, 1 compra, 2 productos)', r1.ok && persist.comp === 3 && persist.compras === 1 && persist.prods === 2 && !persist.turno && persist.cedula === '3101123456', r1.ms + ' ms');
  verificar('Integridad verificada (archivo, kárdex, consecutivos)', persist.integ);
  verificar('La interfaz no tiene acceso directo a la base (solo operaciones permitidas)', await js("typeof BESALU.sql === 'undefined' && typeof require === 'undefined' && !('exec' in BESALU)"));

  // ---- Órdenes de compra: pedir, recibir en partes, anular una recepción, cerrar con faltante ----
  const dialogo = require('electron').dialog;
  const dialogoGuardar = dialogo.showSaveDialog, dialogoAbrir = dialogo.showOpenDialog;
  const existencias = () => js(`(async () => { const ps = await BESALU.productos.listar(); return { leche: ps.find(p => p.codigo === '7441001100118').stock, galletas: ps.find(p => p.codigo === '7441099900011').stock }; })()`);
  const tituloModal = (t) => hasta(`!!__modal() && __modal().querySelector('h2').textContent === ${JSON.stringify(t)}`);
  await js(`go('compras'); true`); await esperar(400);
  await js(`document.querySelector('#v-compras [data-vista="ordenes"]').click(); true`);
  verificar('Compras tiene la pestaña "Órdenes de compra"', await hasta(`document.querySelector('#v-compras tbody').textContent.includes('Todavía no hay órdenes')`));
  await js(`__boton('Nueva orden').click(); true`); await tituloModal('Nueva orden de compra');
  await js(`const m = __modal(); __escribir(__campo('Identificación del proveedor', m), '3101999999');
    const b = m.querySelector('input[list="dl-productos-oc"]');
    for (const c of ['7441001100118', '7441099900011', '7441001100118']) { b.value = c; __enter(b); } true`); await esperar(200);
  await captura('2-orden-nueva');
  const oc0 = await js(`({ nombre: __campo('Nombre del proveedor').value, filas: __modal().querySelectorAll('.lineas-compra tbody tr').length })`);
  await js(`__escribir(__modal().querySelectorAll('.lineas-compra tbody tr')[0].querySelector('td:nth-child(2) input'), '24'); true`); await esperar(100);
  await js(`__escribir(__modal().querySelectorAll('.lineas-compra tbody tr')[1].querySelector('td:nth-child(2) input'), '10'); true`); await esperar(100);
  verificar('Nueva orden: el proveedor se completa solo y no repite productos', oc0.nombre === 'Distribuidora Central S.A.' && oc0.filas === 2, oc0.nombre);
  await js(`__boton('Guardar borrador', __modal()).click(); true`); await esperar(500);
  const bor = await js(`(async () => ({ o: (await BESALU.ordenes.listar({}))[0], camino: await BESALU.ordenes.enCamino() }))()`);
  verificar('Guardar borrador (sin número y sin contar como pedido)', bor.o && bor.o.estado === 'borrador' && bor.o.numero === null && bor.o.lineas === 2 && Object.keys(bor.camino).length === 0);
  const idOc = bor.o.id;
  await js(`editarOrden(${idOc}); true`); await tituloModal('Borrador de orden de compra');
  await js(`__boton('Emitir orden', __modal()).click(); true`); await tituloModal('Emitir orden de compra');
  await js(`__boton('Emitir orden', __modal()).click(); true`); await tituloModal('Orden de compra OC-00001');
  await captura('3-orden-emitida');
  const det = await js(`({ pill: __modal().querySelector('.card-t .pill').textContent, botones: [...__modal().querySelectorAll('.modal-acc button')].map(b => b.textContent) })`);
  verificar('Emitir: recibe el número OC-00001 y queda lista para recibir', det.pill === 'Emitida' && det.botones.includes('Recibir mercadería') && det.botones.includes('Cancelar orden'), det.botones.join(' · '));
  const rutaPdf = path.join(carpeta, 'orden.pdf');
  dialogo.showSaveDialog = async () => ({ canceled: false, filePath: rutaPdf });
  await js(`__boton('PDF para el proveedor', __modal()).click(); true`);
  for (let i = 0; i < 80 && !fs.existsSync(rutaPdf); i++) await esperar(100);
  verificar('PDF de la orden para el proveedor', fs.existsSync(rutaPdf) && fs.readFileSync(rutaPdf).subarray(0, 5).toString() === '%PDF-', fs.existsSync(rutaPdf) ? Math.round(fs.statSync(rutaPdf).size / 1024) + ' KB' : '');
  await js(`while (hayModal()) cerrarModal(); go('inventario'); true`);
  await hasta(`document.querySelector('#v-inventario tbody').textContent.includes('en camino')`);
  await captura('4-inventario-en-camino');
  const camino = await js(`[...document.querySelectorAll('#v-inventario tbody tr')].map(t => t.textContent).filter(t => t.includes('en camino'))`);
  verificar('Inventario muestra lo que viene en camino', camino.length === 2 && camino.some((t) => t.includes('+24 en camino')) && camino.some((t) => t.includes('+10 en camino')));

  const stock0 = await existencias();
  await js(`go('compras'); verOrden(${idOc}); true`); await tituloModal('Orden de compra OC-00001');
  await js(`__boton('Recibir mercadería', __modal()).click(); true`); await hasta(`!!document.querySelector('#modalRoot [data-recepcion]')`);
  await captura('5-recepcion');
  const rec0 = await js(`({ titulo: __modal().querySelector('h2').textContent, fijo: __campo('Identificación del proveedor').disabled, filas: __modal().querySelectorAll('.lineas-compra tbody tr').length })`);
  await js(`__escribir(__campo('Número de factura'), 'F-100'); __escribir(__modal().querySelectorAll('.lineas-compra tbody tr')[1].querySelector('td:nth-child(3) input'), '0'); true`); await esperar(150);
  await js(`__boton('Registrar recepción', __modal()).click(); true`); await tituloModal('Orden de compra OC-00001');
  const stock1 = await existencias();
  const det1 = await js(`__modal().querySelector('.card-t .pill').textContent`);
  await captura('6-orden-parcial');
  verificar('Recibir en partes: entra solo lo que llegó y la orden queda "Recibida en parte"', rec0.titulo === 'Recibir mercadería · OC-00001' && rec0.fijo && rec0.filas === 2 &&
    stock1.leche === stock0.leche + 24 && stock1.galletas === stock0.galletas && det1 === 'Recibida en parte', 'leche ' + stock0.leche + ' → ' + stock1.leche + ' · ' + det1);
  await js(`__boton('Recibir mercadería', __modal()).click(); true`); await hasta(`!!document.querySelector('#modalRoot [data-recepcion]')`);
  const filas2 = await js(`__modal().querySelectorAll('.lineas-compra tbody tr').length`);
  await js(`__escribir(__campo('Número de factura'), 'F-101'); __escribir(__modal().querySelector('.lineas-compra tbody tr td:nth-child(3) input'), '12'); true`); await esperar(150);
  const avisoExceso = await js(`__modal().querySelector('.lineas-compra tbody').textContent.includes('llegó de más')`);
  await js(`__boton('Registrar recepción', __modal()).click(); true`); await tituloModal('Llegó más de lo pedido');
  await js(`__boton('Registrar de todos modos', __modal()).click(); true`); await tituloModal('Orden de compra OC-00001');
  const stock2 = await existencias();
  const det2 = await js(`__modal().querySelector('.card-t .pill').textContent`);
  verificar('Si llega de más, pide confirmación y la orden queda "Recibida"', filas2 === 1 && avisoExceso && det2 === 'Recibida' && stock2.galletas === stock0.galletas + 12, 'galletas ' + stock0.galletas + ' → ' + stock2.galletas);

  await js(`[...__modal().querySelectorAll('.hseccion .clic')].find(d => d.textContent.includes('F-101')).click(); true`); await hasta(`!!document.querySelector('#modalRoot [data-compra]')`);
  const ligada = await js(`!!__boton('Recepción de la orden OC-00001', __modal())`);
  await captura('7-compra-de-orden');
  await js(`__boton('Anular compra', __modal()).click(); true`); await tituloModal('Anular compra');
  await js(`__escribir(__modal().querySelector('input'), 'Mercadería devuelta'); __boton('Anular compra', __modal()).click(); true`); await hasta(`!document.querySelector('#modalRoot .modal')`);
  const stock3 = await existencias();
  const det3 = await js(`(async () => { const o = await BESALU.ordenes.obtener(${idOc}); return { estado: o.estado_visible, falta: o.lineas.map(l => l.pendiente) }; })()`);
  verificar('Anular una recepción la saca del inventario y la vuelve a dejar pendiente', ligada && det3.estado === 'parcial' && det3.falta[1] === 10 && stock3.galletas === stock0.galletas, det3.estado + ' · faltan ' + det3.falta.join('/'));

  await js(`verOrden(${idOc}); true`); await tituloModal('Orden de compra OC-00001');
  await js(`__boton('Cerrar con faltante', __modal()).click(); true`); await tituloModal('Cerrar con faltante');
  const textoCierre = await js(`__modal().textContent`);
  await js(`__escribir(__modal().querySelector('input'), 'El proveedor no tiene galletas'); __boton('Cerrar orden', __modal()).click(); true`); await hasta(`!document.querySelector('#modalRoot .modal')`);
  const det4 = await js(`(async () => ({ o: await BESALU.ordenes.obtener(${idOc}), camino: await BESALU.ordenes.enCamino() }))()`);
  if (process.env.BESALU_CAPTURAS) { await js(`Ordenes.filtro = 'todas'; renderCompras(); true`); await captura('1-lista-ordenes'); await js(`Ordenes.filtro = 'abiertas'; true`); }
  verificar('Cerrar con faltante: queda registrada y deja de contar como pedido', det4.o.estado === 'cerrada' && det4.o.motivo === 'El proveedor no tiene galletas' &&
    textoCierre.includes('Galletas') && Object.keys(det4.camino).length === 0);

  // Anular una recepción cuando parte ya se vendió: avisa que quedaría negativo
  await js(`(async () => { const p = App.catalogo.find(x => x.codigo === '7441001100118'); await BESALU.productos.ajustar(p.id, 5, 'Conteo físico'); await App.recargarCatalogo(); })(); true`); await esperar(300);
  await js(`(async () => { const l = await BESALU.compras.listar({}); await verCompra(l.find(c => c.numero_documento === 'F-100').id); })(); true`); await hasta(`!!document.querySelector('#modalRoot [data-compra]')`);
  await js(`__boton('Anular compra', __modal()).click(); true`); await tituloModal('Anular compra');
  await js(`__escribir(__modal().querySelector('input'), 'Factura equivocada'); __boton('Anular compra', __modal()).click(); true`);
  await tituloModal('Quedarían existencias negativas');
  const avisoNeg = await js(`__modal().textContent`);
  await captura('8-aviso-negativo');
  await js(`__boton('Anular de todos modos', __modal()).click(); true`); await hasta(`!document.querySelector('#modalRoot .modal')`);
  const stock5 = await existencias();
  verificar('Anular lo que ya se vendió pide confirmación (quedaría negativo)', avisoNeg.includes('-19') && stock5.leche === -19, 'leche ' + stock5.leche);

  await js(`go('inventario'); true`); await hasta(`!!__boton('Pedir lo que falta')`);
  await js(`__boton('Pedir lo que falta').click(); true`);
  await hasta(`!!__modal() && __modal().querySelector('h2').textContent === 'Nueva orden de compra' && __modal().querySelectorAll('.lineas-compra tbody tr td input').length > 0`);
  const sug = await js(`(async () => ({ filas: __modal().querySelectorAll('.lineas-compra tbody tr').length, sug: (await BESALU.ordenes.sugerencias()).length, texto: __modal().querySelector('.lineas-compra tbody').textContent }))()`);
  verificar('"Pedir lo que falta" arma la orden con lo que está bajo el mínimo', sug.sug >= 1 && sug.filas === sug.sug && sug.texto.includes('Leche'), sug.filas + ' producto(s)');
  await js('while (hayModal()) cerrarModal(); true');

  // ---- Copia completa, Excel y cargar una copia ----
  await js(`go('ajustes'); true`); await hasta(`!!__boton('Exportar copia completa')`);
  if (process.env.BESALU_CAPTURAS) await js(`__boton('Exportar copia completa').scrollIntoView({ block: 'center' }); true`);
  await captura('9-ajustes-copias');
  const rutaCopia = path.join(carpeta, 'copia completa.sqlite'), rutaExcel = path.join(carpeta, 'todo.xlsx');
  dialogo.showSaveDialog = async () => ({ canceled: false, filePath: rutaCopia });
  await js(`__boton('Exportar copia completa').click(); true`);
  for (let i = 0; i < 80 && !fs.existsSync(rutaCopia); i++) await esperar(100);
  const vCopia = require('../principal/datos/respaldos').verificarArchivo(rutaCopia);
  verificar('Exportar copia completa (un archivo verificado con todo)', vCopia.ok && vCopia.ordenes === 1 && vCopia.compras === 3, vCopia.ok ? vCopia.compras + ' compras · ' + vCopia.ordenes + ' orden · ' + vCopia.movimientos + ' movimientos' : vCopia.detalle);
  dialogo.showSaveDialog = async () => ({ canceled: false, filePath: rutaExcel });
  await js(`__boton('Exportar todo a Excel').click(); true`);
  for (let i = 0; i < 80 && !fs.existsSync(rutaExcel); i++) await esperar(100);
  verificar('Exportar todo a Excel', fs.existsSync(rutaExcel) && fs.readFileSync(rutaExcel).subarray(0, 2).toString() === 'PK', fs.existsSync(rutaExcel) ? Math.round(fs.statSync(rutaExcel).size / 1024) + ' KB' : '');
  await js(`(async () => { await BESALU.ordenes.guardar({ proveedor: { tipo_id: '02', identificacion: '3101999999', nombre: 'Distribuidora Central S.A.' }, lineas: [{ producto_id: App.catalogo[0].id, cantidad: 1 }] }); })(); true`); await esperar(300);
  const antesDeCargar = await js(`(async () => (await BESALU.ordenes.listar({})).length)()`);
  dialogo.showOpenDialog = async () => ({ canceled: false, filePaths: [rutaCopia] });
  await js(`__boton('Cargar una copia').click(); true`); await tituloModal('Cargar una copia');
  await js(`__escribir(__modal().querySelector('input'), 'RESTAURAR'); __boton('Elegir archivo', __modal()).click(); true`);
  await hasta(`document.body.textContent.includes('Copia cargada')`);
  const cargada = await js(`(async () => ({ ordenes: (await BESALU.ordenes.listar({})).length, compras: (await BESALU.compras.listar({})).length, integ: (await BESALU.sistema.verificar()).ok }))()`);
  verificar('Cargar una copia: todo vuelve a como estaba en la copia', antesDeCargar === 2 && cargada.ordenes === 1 && cargada.compras === 3 && cargada.integ, antesDeCargar + ' → ' + cargada.ordenes + ' órdenes');
  dialogo.showSaveDialog = dialogoGuardar; dialogo.showOpenDialog = dialogoAbrir;
  await js('while (hayModal()) cerrarModal(); true');

  // ---- Proveedores con sus productos y compra rápida escaneando ----
  await js(`go('compras'); true`); await esperar(300);
  await js(`document.querySelector('#v-compras [data-vista="proveedores"]').click(); true`);
  verificar('Compras tiene la pestaña "Proveedores" (los de las compras ya están)', await hasta(`document.querySelector('#v-compras tbody').textContent.includes('Distribuidora Central')`));
  await js(`__boton('Nuevo proveedor').click(); true`); await tituloModal('Nuevo proveedor');
  await js(`const m = __modal(); __escribir(__campo('Identificación', m), '3101444444'); __escribir(__campo('Nombre', m), 'Lácteos del Valle S.A.');
    __escribir(__campo('Teléfono', m), '2222-3333'); __escribir(__campo('Días de crédito', m), '15');
    const b = m.querySelector('input[list="dl-productos-prov"]'); b.value = '7441001100118'; __enter(b); true`); await esperar(150);
  await js(`__escribir(__modal().querySelector('.lineas-compra tbody tr td:nth-child(3) input'), '990'); true`);
  await captura('11-ficha-proveedor');
  await js(`__boton('Guardar', __modal()).click(); true`); await hasta(`!document.querySelector('#modalRoot .modal')`);
  const ficha = await js(`(async () => { const p = (await BESALU.proveedores.listar()).find(x => x.identificacion === '3101444444'); return p && await BESALU.proveedores.obtener(p.id); })()`);
  verificar('Nuevo proveedor con su lista de productos y costo', ficha && ficha.dias_credito === 15 && ficha.telefono === '2222-3333' && ficha.productos.length === 1 && ficha.productos[0].costo === 99000,
    ficha && ficha.nombre + ' · ' + ficha.productos.length + ' producto');

  const antesCompra = await js(`(async () => (await BESALU.productos.listar()).find(x => x.codigo === '7441001100118'))()`);
  await js(`formularioCompra(); true`); await tituloModal('Registrar factura de compra');
  await js(`__escribir(__campo('Nombre del proveedor'), 'Lácteos del Valle S.A.'); true`);
  await hasta(`__modal().textContent.includes('Proveedor guardado')`);
  const identCompra = await js(`__campo('Identificación del proveedor').value`);
  await js(`__escribir(__campo('Número de factura'), 'LV-1'); const e = __modal().querySelector('input[list="dl-productos"]');
    for (let i = 0; i < 2; i++) { e.value = '7441001100118'; __enter(e); } true`); await esperar(200);
  const filaCompra = await js(`[...__modal().querySelectorAll('.lineas-compra tbody tr')[0].querySelectorAll('input')].map(i => i.value)`);
  await js(`__escribir(__modal().querySelectorAll('.lineas-compra tbody tr')[0].querySelectorAll('input')[3], '1295'); true`); await esperar(100);
  await captura('12-compra-escaneando');
  await js(`__boton('Registrar compra', __modal()).click(); true`); await hasta(`!document.querySelector('#modalRoot .modal')`);
  const trasCompra = await js(`(async () => { const p = (await BESALU.productos.listar()).find(x => x.codigo === '7441001100118');
    const c = (await BESALU.compras.listar({})).find(x => x.numero_documento === 'LV-1'); const d = c && await BESALU.compras.obtener(c.id);
    return { precio: p.precio, stock: p.stock, cant: d && d.lineas[0].cantidad, costo: d && d.lineas[0].costo_unitario, lineas: d && d.lineas.length }; })()`);
  verificar('Compra rápida: elegir el proveedor, escanear (dos veces = 2) con su costo y cambiar el precio de venta',
    identCompra === '3101444444' && filaCompra[1] === '2' && trasCompra.lineas === 1 && trasCompra.cant === 2 && trasCompra.costo === 99000 &&
    trasCompra.stock === antesCompra.stock + 2 && trasCompra.precio === 129500, JSON.stringify(trasCompra));

  // ---- Marca con logo y SKU del producto ----
  await js(`modalProducto(App.catalogo.find(x => x.codigo === '7441001100118')); true`); await tituloModal('Editar producto');
  await js(`__escribir(__campo('SKU'), 'LCH-001'); __escribir(__campo('Marca'), 'Lechera del Valle'); __boton('Guardar', __modal()).click(); true`);
  await hasta(`!document.querySelector('#modalRoot .modal')`);
  const logoOk = await js(`(async () => {
    const c = document.createElement('canvas'); c.width = 300; c.height = 120; const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 300, 120); x.fillStyle = '#1a3d8f'; x.beginPath(); x.arc(60, 60, 50, 0, 7); x.fill(); x.font = '800 44px Inter'; x.fillText('Valle', 120, 76);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const png = await prepararLogo(new File([blob], 'logo.png', { type: 'image/png' }));
    const m = (await BESALU.marcas.listar()).find(z => z.nombre === 'Lechera del Valle');
    await BESALU.marcas.guardar({ id: m.id, nombre: m.nombre, logo: png, umbral: 150 });
    await App.recargarCatalogo();
    const p = App.catalogo.find(z => z.codigo === '7441001100118');
    return { sku: p.sku, marca: p.marca, logo: p.marca_logo, bytes: png.length };
  })()`);
  verificar('Producto con SKU y marca; el logo de la marca se guarda en escala de grises', logoOk.sku === 'LCH-001' && logoOk.marca === 'Lechera del Valle' && logoOk.logo === 1 && logoOk.bytes > 100,
    logoOk.marca + ' · logo ' + logoOk.bytes + ' bytes');

  // ---- Etiquetas: desde Inventario a una impresora de red simulada ----
  const recibido = [];
  const impresora = net.createServer((sk) => sk.on('data', (d) => recibido.push(d)));
  await new Promise((r) => impresora.listen(0, '127.0.0.1', r));
  await js(`(async () => { await BESALU.etiquetas.guardarConfig({ conexion: 'red', ip: '127.0.0.1', puerto: ${impresora.address().port}, ancho: 50, alto: 25, lenguaje: 'tspl' }); Etiquetas.config = null; Etiquetas.ancho = null; })(); true`);
  await esperar(200);
  await js(`go('inventario'); true`); await hasta(`[...document.querySelectorAll('#v-inventario tbody tr')].some(t => t.textContent.includes('7441001100118'))`);
  await js(`[...document.querySelectorAll('#v-inventario tbody tr')].find(t => t.textContent.includes('7441001100118')).querySelector('button[title="Imprimir etiqueta"]').click(); true`);
  await hasta(`App.vista === 'etiquetas' && !!document.querySelector('#v-etiquetas canvas.etiqueta') && document.querySelector('#v-etiquetas .grid-etq tbody').textContent.includes('7441001100118')`);
  const vistaEtq = await js(`({ plantilla: document.querySelector('.plantilla-etq.sel').dataset.plantilla, pill: [...document.querySelectorAll('#v-etiquetas .pill')].map(p => p.textContent).join(' '),
    filas: document.querySelectorAll('#v-etiquetas .grid-etq tbody tr').length })`);
  await js(`__escribir(document.querySelector('#v-etiquetas .grid-etq tbody tr td:nth-child(3) input'), '3'); true`);
  await captura('10-etiquetas');
  await js(`__boton('Imprimir', document.querySelector('#v-etiquetas .grid-etq')).click(); true`);
  for (let i = 0; i < 50 && !Buffer.concat(recibido).toString('latin1').includes('PRINT'); i++) await esperar(100);
  await esperar(200);
  impresora.close();
  const enviado = Buffer.concat(recibido);
  const txt = enviado.toString('latin1');
  const marcaBmp = 'BITMAP 0,0,50,200,0,';
  const iBmp = txt.indexOf(marcaBmp);
  let negros = 0;
  if (iBmp > 0) for (const b of enviado.subarray(iBmp + marcaBmp.length, iBmp + marcaBmp.length + 50 * 200)) for (let k = 0; k < 8; k++) if (!((b >> k) & 1)) negros++;
  verificar('Etiqueta "Producto con marca" desde Inventario: llega a la impresora en TSPL (50 × 25 mm, 3 copias)', vistaEtq.plantilla === 'marca' && vistaEtq.filas === 1 &&
    txt.startsWith('SIZE 50 mm,25 mm\r\n') && iBmp > 0 && txt.includes('PRINT 1,3') && negros > 3000 && negros < 50000, enviado.length + ' bytes · ' + negros + ' puntos negros');
  await js('while (hayModal()) cerrarModal(); true');

  // ---- Seguridad de la pantalla ----
  const aislada = await js("({ process: typeof process, buffer: typeof Buffer, global: typeof global, abrir: window.open('https://example.com') === null })");
  verificar('Pantalla en sandbox: sin Node (process, Buffer) y sin ventanas nuevas', aislada.process === 'undefined' && aislada.buffer === 'undefined' && aislada.global === 'undefined' && aislada.abrir);
  const red = await js("(async () => { try { await fetch('https://example.com'); return 'llegó'; } catch (e) { return 'bloqueado'; } })()");
  verificar('La pantalla no puede conectarse a internet (todo pasa por el sistema)', red === 'bloqueado', red);
  await esperar(200);
  // El bloqueo deja su aviso en la consola: es el resultado esperado, no un error de la app
  for (let i = erroresConsola.length - 1; i >= 0; i--) if (/example\.com/.test(erroresConsola[i])) erroresConsola.splice(i, 1);
  const antes = ventana.webContents.getURL();
  await js("location.href = 'https://example.com'; true").catch(() => {});
  await esperar(400);
  verificar('La pantalla no puede navegar a otra página', ventana.webContents.getURL() === antes);
  const seguridad = require('../principal/seguridad');
  const falso = (url, parent = null) => ({ senderFrame: { url, parent } });
  verificar('El sistema solo atiende pedidos de la pantalla del POS', seguridad.remitenteValido(falso(seguridad.PANTALLA + '#x')) &&
    !seguridad.remitenteValido(falso('https://example.com/')) && !seguridad.remitenteValido(falso(seguridad.PANTALLA, {})) && !seguridad.remitenteValido({}));

  // ---- Velocidad con muchas ventas (sin envío a Hacienda) ----
  await js(`(async () => { const h = App.hacienda; await BESALU.hacienda.guardar({ activo: false, ambiente: h.ambiente, usuario: h.usuario }); })(); true`); await esperar(300);
  await js(`(async () => { await BESALU.caja.abrir(0); const p = App.catalogo.find(x => x.codigo === '7441001100118'); await BESALU.productos.ajustar(p.id, 100000, 'Carga para prueba'); })(); true`); await esperar(300);
  const msVenta = await js(`(async () => { const id = App.catalogo.find(x => x.codigo === '7441001100118').id; const t = performance.now();
    for (let i = 0; i < 1000; i++) await BESALU.ventas.emitir({ lineas: [{ producto_id: id, cantidad: 1 }], medio_pago: 'tarjeta' });
    return Math.round((performance.now() - t) / 1000 * 100) / 100; })()`);
  verificar('Emitir 1.000 ventas (desde la interfaz)', msVenta < 20, msVenta + ' ms por venta');
  const r2 = await recargar();
  verificar('Abrir la app con 1.000+ ventas', r2.ok && r2.ms < 3000, r2.ms + ' ms');
  const tVistas = await js("(async () => { const t = performance.now(); for (const v of ['ventas','reportes','inventario','etiquetas','cierre','caja']) { go(v); await new Promise(r => setTimeout(r, 0)); } return Math.round(performance.now() - t); })()");
  verificar('Recorrer todas las pantallas', tVistas < 1500, tVistas + ' ms');

  // ---- Aviso de actualización ----
  ventana.webContents.send('actualizacion', { state: 'downloaded', version: '9.9.9' }); await esperar(150);
  verificar('Aviso "Versión lista" con Reiniciar / Más tarde', await js("getComputedStyle(document.getElementById('upd')).display === 'flex' && document.getElementById('upd-act').children.length === 2"));

  await esperar(300);
  verificar('Sin errores en la consola', erroresConsola.length === 0, erroresConsola.slice(0, 3).join(' | '));

  const fallas = resultados.filter((r) => !r.ok).length;
  console.log('\n' + (fallas ? '✘ ' + fallas + ' prueba(s) fallaron' : '✔ Todas las pruebas pasaron (' + resultados.length + ')') + '\n');
  try { await sim.cerrar(); await smtp.cerrar(); require('../principal/hacienda/conector').detener(); require('../principal/datos').conexion.cerrar(); fs.rmSync(carpeta, { recursive: true, force: true }); } catch (e) {}
  app.exit(fallas ? 1 : 0);
}

app.whenReady().then(() => setTimeout(() => correr().catch((e) => { console.error('Error en la prueba:', e.message, '\nConsola:', erroresConsola.join(' | ')); app.exit(1); }), 200));
