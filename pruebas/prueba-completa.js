/**
 * prueba-completa.js — Prueba de punta a punta de la app REAL.
 *
 * Abre Electron con una base de datos temporal (no toca los datos reales),
 * usa la interfaz como lo haría un cajero y verifica que todo quede guardado
 * en SQLite, incluso después de reiniciar la ventana.
 *
 * Uso:  npm run prueba
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Base de datos temporal: la prueba nunca toca los datos reales del negocio.
const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'besalu-prueba-'));
app.setPath('userData', carpeta);
require('../principal/main.js');

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const resultados = [];
const erroresConsola = [];
function verificar(nombre, ok, detalle) {
  resultados.push({ nombre, ok: !!ok, detalle: detalle || '' });
  console.log((ok ? '  ✔ ' : '  ✘ ') + nombre + (detalle ? '  — ' + detalle : ''));
}

let ventana;
const js = (codigo) => ventana.webContents.executeJavaScript(codigo, true);

async function esperarLista() {
  for (let i = 0; i < 150; i++) {
    // DB se declara con `let`, por eso no existe como window.DB.
    try { if (await js("typeof DB!=='undefined' && !!DB && !document.getElementById('app').hidden")) return true; } catch (e) {}
    await esperar(50);
  }
  return false;
}

// Recarga la ventana (como cerrar y abrir la app) y mide cuánto tarda en estar lista.
async function recargar() {
  const cargada = new Promise((r) => ventana.webContents.once('did-finish-load', r));
  const t = Date.now();
  ventana.webContents.reload();
  await cargada;
  const ok = await esperarLista();
  await js(AYUDAS);
  return { ok, ms: Date.now() - t };
}

// Utilidades que se inyectan en la página para "tocar" la interfaz.
const AYUDAS = `
  window.__campo = (etiqueta) => [...document.querySelectorAll('.modal .campo, .modal label')]
    .map(n => n.closest('.campo') || n.parentElement)
    .find(c => c && c.querySelector('label') && c.querySelector('label').textContent.trim() === etiqueta)
    ?.querySelector('input,select');
  window.__escribir = (input, valor) => { input.value = valor; input.dispatchEvent(new Event('input', {bubbles:true})); input.dispatchEvent(new Event('change', {bubbles:true})); };
  window.__boton = (texto, raiz) => [...(raiz||document).querySelectorAll('button')].find(b => b.textContent.trim().startsWith(texto));
  true;`;

async function correr() {
  for (let i = 0; i < 100 && !(ventana = BrowserWindow.getAllWindows()[0]); i++) await esperar(100);
  ventana.webContents.on('console-message', (_e, nivel, mensaje) => { if (nivel >= 3) erroresConsola.push(mensaje); });

  console.log('\nPrueba completa de Besalú Mercat POS');
  console.log('Base temporal: ' + carpeta + '\n');

  const t0 = Date.now();
  verificar('La app abre sin login', await esperarLista(), (Date.now() - t0) + ' ms hasta estar lista');
  await js(AYUDAS);

  const vacio = await js('({p:DB.products.length, v:DB.sales.length})');
  verificar('Arranca vacía (producción)', vacio.p === 0 && vacio.v === 0, vacio.p + ' productos, ' + vacio.v + ' ventas');
  verificar('Sin logo en la interfaz', await js("!document.querySelector('.crest')"));
  // Si el CSS tiene una llave sin cerrar, las últimas reglas no se aplican: esto lo detecta.
  verificar('Estilos completos (aviso de actualización)', await js("getComputedStyle(document.getElementById('upd')).position==='fixed'"));
  verificar('Aviso de actualización oculto si no hay versión nueva',
    await js("getComputedStyle(document.getElementById('upd')).display==='none' && getComputedStyle(document.getElementById('zona-impresion')).display==='none'"));

  // ---- Inventario: agregar producto ----
  await js("DB.settings.imprimirAlCobrar=false; go('inventario'); modalProducto(); true");
  await js(`__escribir(__campo('Código de barras'),'7441001100118');
            __escribir(__campo('Nombre'),'Leche Dos Pinos 1L');
            __escribir(__campo('Costo (compra)'),'980');
            __escribir(__campo('Precio de venta (manual)'),'1250');
            __escribir(__campo('Stock'),'20');
            const iva=__campo('IVA'); iva.value='1 %'; iva.dispatchEvent(new Event('change'));
            __boton('Agregar', document.querySelector('.modal')).click(); true`);
  const prod = await js("DB.products[0] && ({cod:DB.products[0].cod, stock:DB.products[0].stock, iva:DB.products[0].iva, precio:DB.products[0].precio})");
  verificar('Agregar producto desde Inventario', prod && prod.stock === 20 && prod.iva === 1 && prod.precio === 1250, JSON.stringify(prod));

  // ---- Abrir caja ----
  await js("modalAbrir(); __escribir(document.querySelector('.modal input'),'50000'); __boton('Abrir caja', document.querySelector('.modal')).click(); true");
  verificar('Abrir caja con fondo', await js('DB.shift.open && DB.shift.fondo===50000'));

  // ---- Vender: escanear + Enter, pagar en efectivo ----
  await js("go('caja'); true");
  const tVenta = await js(`(async()=>{
    const t=performance.now();
    const cod=document.getElementById('cod');
    for(let i=0;i<3;i++){ cod.value='7441001100118'; cod.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); }
    __escribir(document.getElementById('inp-paga'),'5000');
    __boton('Cobrar').click();
    return Math.round(performance.now()-t);
  })()`);
  const venta = await js("state.done && ({folio:state.done.folio,total:state.done.total,cambio:state.done.cambio,stock:DB.products[0].stock})");
  verificar('Vender 3 unidades y cobrar en efectivo', venta && venta.total === 3750 && venta.cambio === 1250 && venta.stock === 17,
    JSON.stringify(venta) + ' · ' + tVenta + ' ms en pantalla');

  // ---- Impresión: en modo "print" solo debe verse el ticket ----
  await js("const z=document.getElementById('zona-impresion'); z.innerHTML=''; z.appendChild(armarTicket(state.done)); true");
  const dbg = ventana.webContents.debugger;
  dbg.attach('1.3');
  await dbg.sendCommand('Emulation.setEmulatedMedia', { media: 'print' });
  const impresion = await js("({app:getComputedStyle(document.getElementById('app')).display, ticket:getComputedStyle(document.getElementById('zona-impresion')).display, total:document.querySelector('#zona-impresion .row.b')?.textContent})");
  await dbg.sendCommand('Emulation.setEmulatedMedia', { media: '' });
  dbg.detach();
  verificar('Impresión muestra solo el ticket', impresion.app === 'none' && impresion.ticket === 'block' && /6.?150|3.?750/.test(impresion.total || ''), JSON.stringify(impresion));

  // ---- Anular la venta (devuelve stock) y vender otra ----
  await js("modalAnular(DB.sales[0]); __boton('Anular tiquete', document.querySelector('.modal')).click(); true");
  verificar('Anular venta devuelve el stock', await js('DB.sales[0].anulada && DB.products[0].stock===20'));
  await js(`nuevaVenta(); const c=document.getElementById('cod'); c.value='leche';
            c.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
            state.metodo='tarjeta'; paintCobro(); __boton('Cobrar').click(); true`);
  verificar('Venta con tarjeta (búsqueda por nombre)', await js("DB.sales.length===2 && DB.sales[1].metodo==='tarjeta' && DB.products[0].stock===19"));

  // ---- Cierre de caja ----
  await js(`go('cierre'); __escribir(document.querySelector('#v-cierre input'),'50000');
            __boton('Cerrar caja').click(); __boton('Confirmar cierre', document.querySelector('.modal')).click(); true`);
  verificar('Cierre de caja (Z)', await js('!DB.shift.open && DB.archivo.length===1'));

  // ---- Ajustes (guardado diferido) ----
  await js(`go('ajustes'); const i=[...document.querySelectorAll('#v-ajustes .campo')].find(c=>c.querySelector('label').textContent==='Nombre').querySelector('input');
            __escribir(i,'Besalú Mercat Centro'); true`);
  await esperar(800); // deja que terminen las escrituras en segundo plano

  // ---- Reiniciar la ventana y comprobar que TODO quedó en SQLite ----
  const r1 = await recargar();
  verificar('Reabre después de reiniciar', r1.ok, r1.ms + ' ms');
  const tras = await js(`({prods:DB.products.length, stock:DB.products[0]&&DB.products[0].stock, ventas:DB.sales.length,
     anulada:DB.sales[0]&&DB.sales[0].anulada, cierres:DB.archivo.length, turno:DB.shift.open, negocio:DB.settings.negocio, folio:DB.seq.folio})`);
  verificar('Persistencia: producto y stock', tras.prods === 1 && tras.stock === 19, 'stock ' + tras.stock);
  verificar('Persistencia: ventas y anulación', tras.ventas === 2 && tras.anulada === true);
  verificar('Persistencia: cierre y turno', tras.cierres === 1 && tras.turno === false);
  verificar('Persistencia: ajustes', tras.negocio === 'Besalú Mercat Centro', tras.negocio);
  verificar('Persistencia: consecutivo', tras.folio === 1044, 'folio ' + tras.folio);

  // ---- Velocidad con muchos datos: 3.000 ventas ----
  const tCarga = await js(`(async()=>{
    const p=DB.products[0]; const t=performance.now();
    for(let i=0;i<3000;i++){ const f=5000+i;
      await BESALU.datos.registrarVenta({folio:f,cons:'',ts:Date.now()-i*60000,metodo:i%3?'efectivo':'tarjeta',total:1250,base:1237.6,imp:12.4,pago:1250,cambio:0,
        byRate:{1:{base:1237.6,imp:12.4,total:1250}},items:[{cod:p.cod,nom:p.nom,precio:1250,iva:1,cant:1}]},[p],{folio:f}); }
    return Math.round((performance.now()-t)/3000*100)/100; })()`);
  verificar('Guardar una venta (promedio con 3.000)', tCarga < 50, tCarga + ' ms por venta');
  const r2 = await recargar();
  verificar('Abrir la app con 3.000+ ventas', r2.ok && r2.ms < 3000, r2.ms + ' ms');
  const tRep = await js("(()=>{const t=performance.now(); go('reportes'); go('ventas'); go('caja'); return Math.round(performance.now()-t);})()");
  verificar('Abrir Reportes + Ventas con 3.000+ ventas', tRep < 1000, tRep + ' ms');

  // ---- Simular que llega una actualización ----
  ventana.webContents.send('actualizacion', { state: 'downloading', percent: 40 });
  await esperar(150);
  const bajando = await js("({vis:getComputedStyle(document.getElementById('upd')).display, t:document.getElementById('upd-t').textContent, p:document.getElementById('upd-i').style.width})");
  ventana.webContents.send('actualizacion', { state: 'downloaded', version: '9.9.9' });
  await esperar(150);
  const lista = await js("({vis:getComputedStyle(document.getElementById('upd')).display, t:document.getElementById('upd-t').textContent, botones:[...document.querySelectorAll('#upd-act button')].map(b=>b.textContent)})");
  verificar('Aviso aparece al descargar una actualización', bajando.vis === 'flex' && bajando.p === '40%', bajando.t + ' ' + bajando.p);
  verificar('Aviso "Versión lista" con Reiniciar / Más tarde', lista.vis === 'flex' && /9\.9\.9/.test(lista.t) && lista.botones.join('|') === 'Reiniciar y actualizar|Más tarde', lista.t);
  await js("__boton('Más tarde', document.getElementById('upd')).click(); true");
  verificar('"Más tarde" oculta el aviso', await js("getComputedStyle(document.getElementById('upd')).display==='none'"));

  verificar('Sin errores en la consola', erroresConsola.length === 0, erroresConsola.slice(0, 3).join(' | '));

  const fallas = resultados.filter((r) => !r.ok).length;
  console.log('\n' + (fallas ? '✘ ' + fallas + ' prueba(s) fallaron' : '✔ Todas las pruebas pasaron (' + resultados.length + ')') + '\n');
  try { fs.rmSync(carpeta, { recursive: true, force: true }); } catch (e) {}
  app.exit(fallas ? 1 : 0);
}

app.whenReady().then(() => correr().catch((e) => { console.error('Error en la prueba:', e); app.exit(1); }));
