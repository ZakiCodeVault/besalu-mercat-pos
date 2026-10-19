/**
 * prueba-completa.js — Prueba de punta a punta con la app REAL (interfaz + base).
 *
 * Usa una carpeta de datos temporal (no toca los datos del negocio) y recorre el
 * día de trabajo: configurar negocio → conectar Hacienda → producto → compra desde
 * XML → abrir caja → vender → facturar → nota de crédito → Hacienda acepta → IVA →
 * cierre Z → respaldo → reiniciar.
 *
 * Hacienda es un servidor local simulado (verifica firma y XSD) y la llave .p12
 * es falsa: nada sale de esta computadora.
 *
 * Uso:  npm run prueba:app
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

const { generarLlavePrueba } = require('./llave-prueba');
const { crearSimulador } = require('./hacienda-simulada');

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
let sim = null;

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
  ventana.webContents.on('console-message', (_e, nivel, mensaje) => { if (nivel >= 3) erroresConsola.push(mensaje); });
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
    pendientes = await js("(async () => (await BESALU.ventas.listar({})).filter(c => c.estado_hacienda !== 'aceptado').length)()");
  }
  const hz = await js("(async () => { const l = await BESALU.ventas.listar({}); return { n: l.length, estados: [...new Set(l.map(c => c.estado_hacienda))].join(',') }; })()");
  verificar('Hacienda aceptó los ' + hz.n + ' comprobantes (enviados solos, en segundo plano)', pendientes === 0 && sim.recibidos.length === hz.n && !sim.errores.length,
    hz.estados + (sim.errores.length ? ' · ' + sim.errores[0] : ''));
  await js(`go('ventas'); true`); await esperar(500);
  await js(`(async () => { const l = await BESALU.ventas.listar({}); await verComprobante(l.find(c => c.tipo === '01').id); })(); true`); await esperar(500);
  const sec = await js("({ texto: __modal().querySelector('.hseccion').textContent, botones: [...__modal().querySelectorAll('.hseccion button')].map(b => b.textContent) })");
  verificar('El comprobante muestra "Aceptado" y permite guardar el XML firmado y la respuesta', sec.texto.includes('Aceptado (pruebas)') && sec.botones.includes('XML firmado') && sec.botones.includes('Respuesta de Hacienda'), sec.botones.join(' · '));
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

  // ---- Velocidad con muchas ventas (sin envío a Hacienda) ----
  await js(`(async () => { const h = App.hacienda; await BESALU.hacienda.guardar({ activo: false, ambiente: h.ambiente, usuario: h.usuario }); })(); true`); await esperar(300);
  await js(`(async () => { await BESALU.caja.abrir(0); const p = App.catalogo.find(x => x.codigo === '7441001100118'); await BESALU.productos.ajustar(p.id, 100000, 'Carga para prueba'); })(); true`); await esperar(300);
  const msVenta = await js(`(async () => { const id = App.catalogo.find(x => x.codigo === '7441001100118').id; const t = performance.now();
    for (let i = 0; i < 1000; i++) await BESALU.ventas.emitir({ lineas: [{ producto_id: id, cantidad: 1 }], medio_pago: 'tarjeta' });
    return Math.round((performance.now() - t) / 1000 * 100) / 100; })()`);
  verificar('Emitir 1.000 ventas (desde la interfaz)', msVenta < 20, msVenta + ' ms por venta');
  const r2 = await recargar();
  verificar('Abrir la app con 1.000+ ventas', r2.ok && r2.ms < 3000, r2.ms + ' ms');
  const tVistas = await js("(async () => { const t = performance.now(); for (const v of ['ventas','reportes','inventario','cierre','caja']) { go(v); await new Promise(r => setTimeout(r, 0)); } return Math.round(performance.now() - t); })()");
  verificar('Recorrer todas las pantallas', tVistas < 1500, tVistas + ' ms');

  // ---- Aviso de actualización ----
  ventana.webContents.send('actualizacion', { state: 'downloaded', version: '9.9.9' }); await esperar(150);
  verificar('Aviso "Versión lista" con Reiniciar / Más tarde', await js("getComputedStyle(document.getElementById('upd')).display === 'flex' && document.getElementById('upd-act').children.length === 2"));

  await esperar(300);
  verificar('Sin errores en la consola', erroresConsola.length === 0, erroresConsola.slice(0, 3).join(' | '));

  const fallas = resultados.filter((r) => !r.ok).length;
  console.log('\n' + (fallas ? '✘ ' + fallas + ' prueba(s) fallaron' : '✔ Todas las pruebas pasaron (' + resultados.length + ')') + '\n');
  try { await sim.cerrar(); require('../principal/hacienda/conector').detener(); require('../principal/datos').conexion.cerrar(); fs.rmSync(carpeta, { recursive: true, force: true }); } catch (e) {}
  app.exit(fallas ? 1 : 0);
}

app.whenReady().then(() => setTimeout(() => correr().catch((e) => { console.error('Error en la prueba:', e.message, '\nConsola:', erroresConsola.join(' | ')); app.exit(1); }), 200));
