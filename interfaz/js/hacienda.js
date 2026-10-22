/**
 * hacienda.js — Conexión propia con Hacienda: configuración (Ajustes),
 * indicador en la barra superior y estado de cada comprobante (Ventas).
 *
 * El envío ocurre solo, en segundo plano, en el proceso principal. Aquí solo
 * se muestra el estado y se piden las acciones (guardar, probar, reintentar…).
 */
const PROVINCIAS = [['1', 'San José'], ['2', 'Alajuela'], ['3', 'Cartago'], ['4', 'Heredia'], ['5', 'Guanacaste'], ['6', 'Puntarenas'], ['7', 'Limón']];

/* ---------------- Indicador en la barra superior ---------------- */
function pintarIndicadorHacienda() {
  const b = $('#hpill');
  const h = App.hacienda;
  if (!b) return;
  if (!h || !h.activo) { b.hidden = true; return; }
  b.hidden = false;
  const mensajes = h.mensajes || { pendiente: 0, enviado: 0 };
  const enCola = h.conteo.pendiente + h.conteo.enviado + mensajes.pendiente + mensajes.enviado;
  const problemas = h.conteo.error + h.rechazadosSinReemplazo + (h.mensajesPorRevisar || 0);
  const pruebas = h.ambiente === 'pruebas' ? ' (pruebas)' : '';
  let clase = 'ok', texto = 'Hacienda al día' + pruebas;
  if (h.enLinea === false) { clase = 'mal'; texto = 'Hacienda sin conexión' + (enCola ? ' · ' + enCola + ' en cola' : ''); }
  else if (problemas) { clase = 'mal'; texto = 'Hacienda: ' + plural(problemas, 'comprobante', 'comprobantes') + ' por revisar'; }
  else if (enCola) { clase = 'cola'; texto = 'Hacienda: enviando ' + enCola + pruebas; }
  b.className = 'hpill ' + clase;
  b.innerHTML = '<span class="dot"></span>' + texto;
  b.title = h.ultimoError || (h.ultimoContacto ? 'Último contacto: ' + new Date(h.ultimoContacto).toLocaleTimeString('es-CR') : '');
}

function iniciarAvisoHacienda() {
  $('#hpill').onclick = () => go('ajustes');
  pintarIndicadorHacienda();
  BESALU.hacienda.alCambiar((h) => {
    const antes = App.hacienda;
    App.hacienda = h;
    pintarIndicadorHacienda();
    // Refresca la lista de ventas o de compras si cambió algún estado mientras se mira
    const cambio = !antes || JSON.stringify(antes.conteo) !== JSON.stringify(h.conteo);
    if (cambio && App.vista === 'ventas' && !hayModal()) renderVentas();
    const cambioMensajes = !antes || JSON.stringify(antes.mensajes) !== JSON.stringify(h.mensajes);
    if (cambioMensajes && App.vista === 'compras') { renderCompras(); refrescarCompraAbierta(); }
  });
}

/* ---------------- Tarjeta de configuración (Ajustes) ---------------- */
function tarjetaHacienda(h, alGuardar) {
  const estadoPill = !h.activo ? el('span', { class: 'pill', text: 'Desactivado' })
    : el('span', { class: 'pill ' + (h.ambiente === 'produccion' ? 'pill--green' : 'pill--amber'), text: 'Activo · ' + h.ambienteNombre });
  const conexion = h.enLinea === null ? '—' : h.enLinea ? 'En línea' : 'Sin conexión';

  // Formulario
  let ambiente = h.ambiente || 'pruebas';
  const segmento = el('div', { class: 'segmento' });
  const pintarSegmento = () => {
    segmento.innerHTML = '';
    for (const [k, t] of [['pruebas', 'Pruebas (sandbox)'], ['produccion', 'Producción']]) {
      segmento.appendChild(el('button', { class: ambiente === k ? 'sel' : '', onclick: () => { ambiente = k; pintarSegmento(); usuario.placeholder = ejemploUsuario(); } }, t));
    }
  };
  const ejemploUsuario = () => 'cpj-3-101-123456@' + (ambiente === 'produccion' ? 'prod' : 'stag') + '.comprobanteselectronicos.go.cr';
  const usuario = el('input', { value: h.usuario || '', placeholder: ejemploUsuario(), autocomplete: 'off', spellcheck: false });
  const contrasena = el('input', { type: 'password', autocomplete: 'new-password', placeholder: h.tieneContrasena ? '•••••••• (guardada; escriba para cambiarla)' : 'La que generó TRIBU-CR' });
  const pin = el('input', { type: 'password', inputmode: 'numeric', autocomplete: 'off', placeholder: h.tieneLlave ? '•••• (guardado)' : 'PIN de la llave' });
  const activo = el('input', { type: 'checkbox' }); activo.checked = h.activo;
  const llaveTexto = el('div', { class: 'mini', style: 'margin:6px 0 2px' });
  const pintarLlave = (nombre) => {
    const c = h.certificado;
    llaveTexto.innerHTML = '';
    if (nombre) { llaveTexto.appendChild(el('span', { html: 'Archivo elegido: <b>' + nombre + '</b> — escriba su PIN y guarde' })); return; }
    if (!c) { llaveTexto.textContent = 'Sin llave criptográfica'; return; }
    llaveTexto.appendChild(el('span', { html: '<b>' + c.titular + '</b> · cédula ' + c.cedula + ' · vence ' + fechaCorta(c.vence.slice(0, 10)) +
      (c.dias != null && c.dias <= 30 ? ' <span class="pill pill--red">' + (c.dias < 0 ? 'vencida' : c.dias + ' días') + '</span>' : '') }));
  };
  pintarSegmento();
  pintarLlave(h.llaveElegida);

  const elegir = async () => {
    const r = await intentar(() => BESALU.hacienda.elegirLlave(), 'No se pudo leer el archivo');
    if (r) { pintarLlave(r.nombre); pin.focus(); }
  };
  const guardar = async () => {
    const r = await intentar(() => BESALU.hacienda.guardar({ activo: activo.checked, ambiente, usuario: usuario.value, contrasena: contrasena.value, pin: pin.value }),
      'No se guardó la conexión con Hacienda');
    if (!r) return;
    App.hacienda = r; pintarIndicadorHacienda();
    toast('Conexión con Hacienda guardada', 'ok', r.activo ? 'Los comprobantes se envían solos' : 'El envío está desactivado');
    alGuardar();
  };
  const probar = async (e) => {
    const b = e.currentTarget; b.disabled = true;
    const r = await intentar(() => BESALU.hacienda.probar(), 'No se pudo conectar con Hacienda');
    b.disabled = false;
    if (r) toast(r.mensaje, 'ok', r.certificado ? 'Llave de ' + r.certificado.titular : '');
    App.hacienda = await intentar(() => BESALU.hacienda.estado()); pintarIndicadorHacienda();
  };
  const enviarAhora = async (e) => {
    const b = e.currentTarget; b.disabled = true;
    const r = await intentar(() => BESALU.hacienda.procesar());
    b.disabled = false;
    if (r) { App.hacienda = r; pintarIndicadorHacienda(); toast('Cola procesada', 'ok', r.conteo.pendiente + ' pendientes · ' + r.conteo.enviado + ' en validación'); alGuardar(); }
  };

  const contador = (n, t, clase) => el('div', { class: 'hcont ' + (n && clase ? clase : '') }, [el('b', { text: String(n) }), el('span', { text: t })]);
  return el('div', { class: 'card glass hacienda-card' }, [
    el('div', { class: 'card-t' }, [el('h2', { text: 'Facturación electrónica · Hacienda' }), el('div', { style: 'display:flex;gap:8px;align-items:center' }, [
      el('span', { class: 'mini', text: conexion }), estadoPill])]),
    el('div', { class: 'hconteos' }, [
      contador(h.conteo.pendiente, 'pendientes', 'amb'), contador(h.conteo.enviado, 'en validación', ''),
      contador(h.conteo.aceptado, 'aceptados', 'ok'), contador(h.conteo.rechazado, 'rechazados', 'mal'), contador(h.conteo.error, 'con error', 'mal')]),
    h.mensajes && (h.mensajes.pendiente + h.mensajes.enviado + h.mensajes.aceptado + h.mensajes.rechazado + h.mensajes.error)
      ? el('div', { class: 'mini', style: 'margin-top:6px', text: 'Facturas de compra (Mensaje Receptor): ' + h.mensajes.aceptado + ' aceptados por Hacienda · ' +
        (h.mensajes.pendiente + h.mensajes.enviado) + ' en cola · ' + (h.mensajes.rechazado + h.mensajes.error) + ' con problema' }) : null,
    h.problemas.length ? el('div', { class: 'note', style: 'background:var(--amber-soft, #fdf3e1)' }, el('ul', { style: 'margin:0;padding-left:18px' }, h.problemas.map((p) => el('li', { text: p })))) : null,
    h.ultimoError ? el('div', { class: 'note', style: 'background:var(--neg-soft)', text: 'Último error: ' + h.ultimoError }) : null,
    el('div', { class: 'g2', style: 'margin-top:12px;align-items:start' }, [
      el('div', {}, [
        campo('Ambiente', segmento),
        campo('Usuario de la API', usuario),
        campo('Contraseña de la API', contrasena)]),
      el('div', {}, [
        el('div', { class: 'campo' }, [el('label', { text: 'Llave criptográfica (.p12)' }), llaveTexto,
          el('button', { class: 'btn btn--ghost btn--sm', onclick: elegir }, [icon('upload', 15), 'Elegir archivo .p12…'])]),
        campo('PIN de la llave', pin),
        el('div', { class: 'cfg-row' }, [el('div', { class: 'l', text: 'Enviar comprobantes a Hacienda' }), el('label', { class: 'sw' }, [activo, el('span', { class: 'tr' })])])])]),
    el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:12px' }, [
      el('button', { class: 'btn btn--accent btn--sm', onclick: guardar }, [icon('check', 15), 'Guardar conexión']),
      el('button', { class: 'btn btn--ghost btn--sm', onclick: probar }, [icon('shield', 15), 'Probar conexión']),
      el('button', { class: 'btn btn--ghost btn--sm', onclick: enviarAhora }, [icon('refresh', 15), 'Enviar pendientes ahora']),
      h.enviadosPruebas ? el('button', { class: 'btn btn--danger-ghost btn--sm', onclick: empezarFacturacionReal }, 'Empezar facturación real…') : null]),
    el('div', { class: 'note', html: 'Todo se obtiene en <b>TRIBU-CR</b> (Oficina Virtual de Hacienda): la <b>llave criptográfica .p12</b> con su <b>PIN</b> y el <b>usuario y contraseña de la API</b>. ' +
      'Hay credenciales distintas para <b>pruebas</b> y para <b>producción</b>: pruebe primero en el ambiente de pruebas. ' +
      'Los secretos se guardan cifrados con la cuenta de Windows de esta computadora.' })
  ]);
}

async function empezarFacturacionReal() {
  const ok = await confirmar('Empezar facturación real',
    'Los comprobantes enviados al ambiente de PRUEBAS no tienen validez ante Hacienda.\n\n' +
    'Esto guarda la base actual completa en la carpeta de respaldos (no se borra) y arranca una base nueva con los mismos ' +
    'ajustes, productos (la existencia actual queda como inventario inicial), clientes y proveedores, sin ventas ni compras.\n\n' +
    'Después ingrese las credenciales de PRODUCCIÓN.', { peligro: true, escribir: 'EMPEZAR', aceptar: 'Empezar base nueva' });
  if (!ok) return;
  const r = await intentar(() => BESALU.hacienda.empezarProduccion(), 'No se pudo empezar la base nueva');
  if (!r) return;
  toast('Base nueva lista', 'ok', r.comprobantesArchivados + ' comprobantes de prueba archivados');
  await App.reiniciarEstado();
}

/* ---------------- Estado de un comprobante (Ventas) ---------------- */
const SITUACION = { 1: 'Normal', 2: 'Contingencia', 3: 'Sin internet' };

function seccionHacienda(c, alCambiar) {
  const est = ESTADO_HACIENDA[c.estado_hacienda] || [c.estado_hacienda, ''];
  const acciones = [];
  if (c.xml_firmado) acciones.push(el('button', { class: 'btn btn--ghost btn--sm', onclick: () => guardarXml(c.id, 'firmado') }, [icon('download', 14), 'XML firmado']));
  if (c.hacienda_respuesta) acciones.push(el('button', { class: 'btn btn--ghost btn--sm', onclick: () => guardarXml(c.id, 'respuesta') }, [icon('download', 14), 'Respuesta de Hacienda']));
  if (c.estado_hacienda === 'error') {
    acciones.push(el('button', { class: 'btn btn--accent btn--sm', onclick: async () => {
      const r = await intentar(() => BESALU.hacienda.reintentar(c.id), 'No se pudo reintentar');
      if (r) { toast('Comprobante en cola de nuevo'); alCambiar(); }
    } }, [icon('refresh', 14), 'Reintentar envío']));
  }
  if (c.estado_hacienda === 'rechazado' && !c.sustituido_por) {
    acciones.push(el('button', { class: 'btn btn--accent btn--sm', onclick: () => reemitirComprobante(c, alCambiar) }, [icon('refresh', 14), 'Reemitir comprobante']));
  }
  const mensaje = c.hacienda_mensaje || c.hacienda_error;
  return el('div', { class: 'hseccion' }, [
    el('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:8px' }, [
      el('b', { text: 'Hacienda' }), el('span', { class: 'pill ' + est[1], text: est[0] + (c.hacienda_ambiente === 'pruebas' ? ' (pruebas)' : '') })]),
    el('div', { class: 'mini', text: 'Situación: ' + (SITUACION[c.clave[41]] || '—') + (c.hacienda_fecha ? ' · ' + fechaHora(c.hacienda_fecha) : '') }),
    mensaje ? el('div', { class: 'mini hmensaje', text: mensaje }) : null,
    c.sustituye ? el('div', { class: 'mini', html: 'Reemplaza al comprobante rechazado <b>' + c.sustituye.consecutivo + '</b>' }) : null,
    c.sustituido_por ? el('div', { class: 'mini', html: 'Reemplazado por <b>' + c.sustituido_por.consecutivo + '</b>' }) : null,
    acciones.length ? el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:8px' }, acciones) : null
  ]);
}

async function guardarXml(id, cual) {
  const r = await intentar(() => BESALU.hacienda.guardarXml(id, cual), 'No se pudo guardar el XML');
  if (r) toast('XML guardado', 'ok', r.ruta);
}

async function reemitirComprobante(c, alCambiar) {
  const ok = await confirmar('Reemitir comprobante',
    'Hacienda rechazó ' + NOMBRE_TIPO[c.tipo].toLowerCase() + ' ' + c.consecutivo + '.\n\n' +
    'Se emitirá uno nuevo con las mismas líneas y montos, con un consecutivo nuevo y la referencia al rechazado. ' +
    'No se mueve el inventario ni la caja (eso ya se registró con el original).\n\n' +
    'Antes corrija lo que indicó Hacienda (por ejemplo el CABYS en Inventario o los datos del negocio en Ajustes).', { aceptar: 'Reemitir' });
  if (!ok) return;
  const nuevo = await intentar(() => BESALU.ventas.reemitir(c.id), 'No se pudo reemitir');
  if (!nuevo) return;
  toast('Comprobante reemitido', 'ok', nuevo.consecutivo);
  if (App.ajustes.imprimirAlCobrar) imprimir(armarComprobante(nuevo), { automatico: true });
  alCambiar(nuevo.id);
}
