/**
 * ajustes.js — Configuración, respaldos, integridad y Hacienda (F7).
 */
async function renderAjustes() {
  const root = $('#v-ajustes');
  const [estado, respaldos] = await Promise.all([intentar(() => BESALU.sistema.estado()), intentar(() => BESALU.respaldos.listar())]);
  if (!estado) return;
  App.ajustes = estado.ajustes;
  const a = estado.ajustes;
  root.innerHTML = '';

  /* ---- campos editables ---- */
  const f = {};
  const txt = (k, extra = {}) => (f[k] = el('input', Object.assign({ value: a[k] == null ? '' : a[k] }, extra)));
  const fila = (etiqueta, control) => el('div', { class: 'cfg-row' }, [el('div', { class: 'l', text: etiqueta }), control]);
  const interruptor = (k) => { const i = el('input', { type: 'checkbox' }); i.checked = !!a[k]; f[k] = i; return el('label', { class: 'sw' }, [i, el('span', { class: 'tr' })]); };
  f.tipoCedula = selector(TIPOS_ID.slice(0, 4), a.tipoCedula);
  f.ticket = selector(['80 mm', '58 mm'], a.ticket);

  const g = el('div', { class: 'cfg-grid' });
  g.appendChild(el('div', { class: 'card glass' }, [el('h2', { text: 'Datos del negocio (emisor)' }),
    campo('Nombre o razón social', txt('negocio')), campo('Nombre comercial (opcional)', txt('nombreComercial')),
    el('div', { class: 'g2' }, [campo('Tipo de identificación', f.tipoCedula), campo('Número de cédula', txt('cedula', { placeholder: 'Obligatorio para emitir' }))]),
    el('div', { class: 'g2' }, [campo('Actividad económica', txt('actividadEconomica', { placeholder: 'Código de Hacienda' })), campo('Teléfono', txt('telefono'))]),
    campo('Correo', txt('correo')), campo('Dirección', txt('direccion')),
    el('div', { class: 'g2' }, [campo('Sucursal', txt('sucursal')), campo('Terminal (caja)', txt('terminal'))]),
    el('div', { class: 'note', html: 'La cédula, sucursal y terminal forman el <b>consecutivo</b> y la <b>clave</b> de cada comprobante. No los cambie después de empezar a facturar.' })]));

  g.appendChild(el('div', { class: 'card glass' }, [el('h2', { text: 'Inventario e impresión' }),
    fila('Alerta de stock bajo (por defecto)', txt('stockMin', { inputmode: 'numeric', style: 'min-width:90px' })),
    fila('Avisar vencimiento (días antes)', txt('venceDias', { inputmode: 'numeric', style: 'min-width:90px' })),
    fila('Permitir vender sin existencia', interruptor('permitirStockNegativo')),
    fila('Tamaño del ticket', f.ticket), fila('Imprimir al cobrar', interruptor('imprimirAlCobrar')),
    campo('Mensaje al pie del ticket', txt('pieTicket')),
    el('div', { class: 'note', text: 'Se imprime en la impresora PREDETERMINADA de Windows: deje la impresora térmica como predeterminada.' }),
    el('button', { class: 'btn btn--ghost btn--sm', style: 'margin-top:10px', onclick: imprimirPrueba }, [icon('printer', 15), 'Imprimir ticket de prueba'])]));

  /* ---- respaldos ---- */
  const ultimo = estado.ultimoRespaldo;
  const tbResp = el('tbody', {}, (respaldos || []).slice(0, 8).map((r) => el('tr', {}, [
    el('td', { class: 'mini', text: r.archivo.replace('besalu-', '').replace('.sqlite', '') }), el('td', { class: 'der mini', text: Math.round(r.bytes / 1024) + ' KB' }),
    el('td', { class: 'der' }, el('button', { class: 'btn btn--ghost btn--sm', onclick: () => restaurarRespaldo(r.archivo) }, 'Restaurar'))])));
  g.appendChild(el('div', { class: 'card glass' }, [el('h2', { text: 'Respaldos' }),
    fila('Último respaldo', el('span', { class: 'pill ' + (ultimo ? 'pill--green' : 'pill--amber'), text: ultimo ? fechaHora(ultimo.fecha) : 'Ninguno todavía' })),
    fila('Copia extra (USB / OneDrive)', el('span', { class: 'mini', style: 'max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', text: a.carpetaRespaldoExtra || 'Sin configurar' })),
    el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin:10px 0' }, [
      el('button', { class: 'btn btn--accent btn--sm', onclick: respaldarAhora }, [icon('database', 15), 'Respaldar ahora']),
      el('button', { class: 'btn btn--ghost btn--sm', onclick: elegirCarpetaExtra }, 'Carpeta extra…'),
      el('button', { class: 'btn btn--ghost btn--sm', onclick: () => BESALU.respaldos.abrirCarpeta() }, 'Abrir carpeta'),
      el('button', { class: 'btn btn--ghost btn--sm', onclick: restaurarDesdeArchivo }, 'Restaurar desde archivo…')]),
    respaldos && respaldos.length ? el('div', { class: 'tabla-wrap', style: 'border:1px solid var(--line);max-height:220px' }, el('table', {}, tbResp)) : null,
    el('div', { class: 'note', text: 'Automático: una vez al día y al cerrar caja. Se guardan los últimos 60. Cada respaldo se verifica al crearlo.' })]));

  /* ---- integridad, Hacienda, otros ---- */
  const integ = estado.integridad;
  const h = estado.hacienda;
  g.appendChild(el('div', { class: 'card glass' }, [el('h2', { text: 'Integridad y auditoría' }),
    fila('Verificación al abrir', el('span', { class: 'pill ' + (integ && integ.ok ? 'pill--green' : 'pill--red'), text: integ && integ.ok ? 'Todo en orden' : 'Revisar' })),
    integ && !integ.ok ? el('div', { class: 'note', style: 'background:var(--neg-soft)', text: integ.problemas.join(' · ') }) : null,
    el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px' }, [
      el('button', { class: 'btn btn--ghost btn--sm', onclick: verificarAhora }, [icon('shield', 15), 'Verificar ahora']),
      el('button', { class: 'btn btn--ghost btn--sm', onclick: verBitacora }, [icon('list', 15), 'Ver bitácora'])]),
    el('div', { class: 'note', text: 'Las ventas, compras y movimientos de inventario no se pueden modificar ni borrar: la base de datos lo impide. Toda acción queda en la bitácora.' }),
    el('h2', { text: 'Hacienda', style: 'margin-top:18px' }),
    fila('Proveedor de facturación', el('span', { class: 'pill ' + (h.configurado ? 'pill--green' : 'pill--amber'), text: h.configurado ? h.proveedor : 'Sin configurar' })),
    fila('Comprobantes pendientes de envío', el('span', { class: 'pill', text: String(h.conteo.pendiente + h.conteo.error) })),
    el('div', { class: 'note', html: h.configurado ? '' : 'Los comprobantes se emiten con su <b>consecutivo y clave</b> y quedan pendientes: <b>todavía no tienen validez ante Hacienda</b>. Al activar el proveedor (p. ej. Alanube) se enviarán todos en orden.' }),
    estado.versionAnterior && estado.versionAnterior.productos ? el('div', { style: 'margin-top:14px' }, [
      el('h2', { text: 'Versión anterior' }),
      el('div', { class: 'mini', style: 'margin-bottom:8px', text: 'Se encontraron ' + estado.versionAnterior.productos + ' productos de la versión 1.0.' }),
      el('button', { class: 'btn btn--ghost btn--sm', onclick: importarV1 }, [icon('upload', 15), 'Importar esos productos'])]) : null,
    el('h2', { text: 'Acerca de', style: 'margin-top:18px' }),
    fila('Versión instalada', el('span', { class: 'pill pill--accent', text: 'v' + estado.version })),
    el('button', { class: 'btn btn--ghost btn--sm', style: 'margin-top:8px', onclick: (e) => buscarActualizaciones(e.currentTarget) }, [icon('refresh', 15), 'Buscar actualizaciones'])]));

  root.appendChild(g);
  root.appendChild(el('div', { style: 'margin-top:18px;display:flex;gap:10px;align-items:center' }, [
    el('button', { class: 'btn btn--accent btn--lg', onclick: guardar }, [icon('check', 18), 'Guardar cambios']),
    el('span', { class: 'mini', text: 'Base de datos: ' + estado.archivo })]));

  async function guardar() {
    const datos = {};
    for (const [k, c] of Object.entries(f)) datos[k] = c.type === 'checkbox' ? c.checked : c.value;
    datos.stockMin = leerNumero(datos.stockMin); datos.venceDias = Math.round(leerNumero(datos.venceDias));
    const cambiaNumeracion = a.cedula && (datos.cedula.replace(/\D/g, '') !== a.cedula || datos.sucursal.padStart(3, '0') !== a.sucursal || datos.terminal.padStart(5, '0') !== a.terminal);
    if (cambiaNumeracion && !(await confirmar('Cambio de numeración', 'Va a cambiar la cédula, sucursal o terminal. Esto cambia el consecutivo y la clave de los próximos comprobantes.', { peligro: true, aceptar: 'Cambiar igual' }))) return;
    const r = await intentar(() => BESALU.sistema.guardarAjustes(datos), 'No se pudieron guardar los ajustes');
    if (!r) return;
    App.ajustes = r;
    toast('Ajustes guardados');
    renderAjustes();
  }
}

async function respaldarAhora() {
  const r = await intentar(() => BESALU.respaldos.crear(), 'No se pudo respaldar');
  if (r) { toast('Respaldo creado y verificado', 'ok', r.archivo + (r.extra ? ' · copia extra OK' : '')); renderAjustes(); }
}
async function elegirCarpetaExtra() {
  const r = await intentar(() => BESALU.respaldos.elegirCarpeta());
  if (r) { App.ajustes = r; toast('Carpeta extra configurada', 'ok', r.carpetaRespaldoExtra); renderAjustes(); }
}
const AVISO_RESTAURAR = 'La base de datos actual se reemplazará por la del respaldo (antes se guarda una copia del estado actual).\n\n' +
  'Las ventas, compras y movimientos hechos DESPUÉS de ese respaldo dejarán de verse, y los consecutivos volverán atrás: ' +
  'si ya se emitieron comprobantes con esos números, se repetirían. Úselo solo para recuperarse de una falla.';
async function restaurarRespaldo(nombre) {
  if (!(await confirmar('Restaurar respaldo', AVISO_RESTAURAR, { peligro: true, escribir: 'RESTAURAR', aceptar: 'Restaurar' }))) return;
  const r = await intentar(() => BESALU.respaldos.restaurar(nombre), 'No se pudo restaurar');
  if (r) { toast('Respaldo restaurado', 'ok', r.comprobantes + ' comprobantes · ' + r.productos + ' productos'); await App.reiniciarEstado(); }
}
async function restaurarDesdeArchivo() {
  if (!(await confirmar('Restaurar desde archivo', AVISO_RESTAURAR, { peligro: true, escribir: 'RESTAURAR', aceptar: 'Elegir archivo' }))) return;
  const r = await intentar(() => BESALU.respaldos.restaurarArchivo(), 'No se pudo restaurar');
  if (r) { toast('Respaldo restaurado', 'ok', r.comprobantes + ' comprobantes'); await App.reiniciarEstado(); }
}
async function verificarAhora() {
  const v = await intentar(() => BESALU.sistema.verificar());
  if (!v) return;
  if (v.ok) { toast('Integridad verificada', 'ok', 'Archivo, kárdex y consecutivos en orden'); return; }
  const soloStock = v.problemas.every((p) => p.startsWith('Stock de'));
  const reparar = soloStock && await confirmar('Se encontraron diferencias', v.problemas.join('\n') + '\n\n¿Recalcular las existencias desde el kárdex?', { aceptar: 'Recalcular' });
  if (reparar) { const n = await intentar(() => BESALU.sistema.repararStock()); toast('Existencias recalculadas', 'ok', n + ' productos'); }
  else if (!soloStock) confirmar('Problemas de integridad', v.problemas.join('\n') + '\n\nRecomendación: restaurar el último respaldo.', { aceptar: 'Entendido' });
}
async function verBitacora() {
  const filas = await intentar(() => BESALU.sistema.bitacora(300));
  if (!filas) return;
  const tb = el('tbody', {}, filas.map((b) => el('tr', {}, [el('td', { class: 'mini', text: fechaHora(b.fecha) }), el('td', { text: b.accion.replace(/_/g, ' ') }), el('td', { class: 'mini', style: 'word-break:break-all', text: b.detalle })])));
  abrirModal(el('div', { class: 'modal ancho' }, [el('div', { class: 'card-t' }, [el('h2', { text: 'Bitácora (últimas 300 acciones)' }), el('button', { class: 'icon-btn', onclick: cerrarModal }, icon('x', 18))]),
    el('div', { class: 'tabla-wrap', style: 'border:1px solid var(--line);max-height:65vh' }, el('table', {}, [el('thead', {}, el('tr', {}, ['Fecha', 'Acción', 'Detalle'].map((t) => el('th', { text: t })))), tb]))]));
}
async function importarV1() {
  if (!(await confirmar('Importar productos', 'Se agregarán los productos de la versión anterior (código, nombre, precio, costo, IVA y existencia como inventario inicial). Los que ya existan se omiten.\nLas ventas viejas NO se importan.', { aceptar: 'Importar' }))) return;
  const r = await intentar(() => BESALU.sistema.importarV1(), 'No se pudo importar');
  if (r) { await App.recargarCatalogo(); toast('Productos importados', 'ok', r.creados + ' nuevos · ' + r.omitidos + ' ya existían'); renderAjustes(); }
}
function imprimirPrueba() {
  imprimir(el('div', { class: 'ticket' }, [encabezadoNegocio(), el('hr'), el('div', { class: 'tc', style: 'font-weight:800', text: 'TICKET DE PRUEBA' }),
    el('div', { class: 'tc small', text: new Date().toLocaleString('es-CR') }), el('hr'), el('div', { class: 'tc small', text: 'Si lee esto, la impresora funciona.' })]));
}
