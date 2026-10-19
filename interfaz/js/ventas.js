/**
 * ventas.js — Historial de comprobantes emitidos (F2).
 *
 * Una venta no se edita ni se borra: si hay que corregirla o hay devolución,
 * se emite una NOTA DE CRÉDITO que la referencia (y devuelve el inventario).
 */
const Ventas = { periodo: 'hoy', texto: '' };

async function renderVentas() {
  const root = $('#v-ventas');
  const p = periodo(Ventas.periodo);
  const [lista, rep] = await Promise.all([
    intentar(() => BESALU.ventas.listar({ desde: p.desde, hasta: p.hasta, texto: Ventas.texto, limite: 500 })),
    intentar(() => BESALU.reportes.ventas(p.desde, p.hasta))
  ]);
  if (!lista || !rep) return;
  root.innerHTML = '';

  root.appendChild(el('div', { class: 'toolbar' }, [
    el('div', { class: 'segmento' }, [['hoy', 'Hoy'], ['mes', 'Este mes'], ['mes_anterior', 'Mes anterior'], ['anio', 'Este año']].map(([k, t]) =>
      el('button', { class: Ventas.periodo === k ? 'sel' : '', onclick: () => { Ventas.periodo = k; renderVentas(); } }, t))),
    el('div', { class: 'search', style: 'max-width:320px;flex:1' }, [icon('search', 18),
      el('input', { placeholder: 'Buscar consecutivo, cliente o cédula…', value: Ventas.texto, style: 'padding-left:40px',
        oninput: debounce((e) => { Ventas.texto = e.target.value; renderVentas(); }, 300) })]),
    el('button', { class: 'btn btn--ghost btn--sm', onclick: () => exportarCsv('ventas', p.desde, p.hasta) }, [icon('download', 16), 'Excel'])
  ]));

  const r = rep.resumen;
  root.appendChild(el('div', { class: 'stats' }, [
    stat([icon('receipt', 15), 'Ventas netas · ' + p.etiqueta], money(r.total), el('span', { class: 'mini', text: plural(r.cantidad, 'comprobante', 'comprobantes') })),
    stat([icon('cash', 15), 'Efectivo'], money(r.medios.efectivo), el('span', { class: 'mini', text: 'Tarjeta ' + money(r.medios.tarjeta) + ' · SINPE ' + money(r.medios.sinpe) })),
    stat([icon('undo', 15), 'Devoluciones (notas de crédito)'], money(r.devoluciones), el('span', { class: 'mini', text: 'Ticket promedio ' + money(r.ticket_promedio) }))
  ]));

  const tb = el('tbody');
  if (!lista.length) tb.appendChild(el('tr', {}, el('td', { colspan: 7, class: 'mini', style: 'text-align:center;padding:30px', text: 'No hay comprobantes en este período.' })));
  for (const c of lista) {
    const est = ESTADO_HACIENDA[c.estado_hacienda] || [c.estado_hacienda, ''];
    const nota = c.nota_credito ? 'Con nota de crédito' : c.sustituido_por ? 'Reemplazado por ' + Number(c.sustituido_por.slice(-10)) : c.sustituye_id ? 'Reemplazo' : '';
    tb.appendChild(el('tr', { class: 'clic' + (c.nota_credito || c.sustituido_por ? ' tachado' : ''), onclick: () => verComprobante(c.id) }, [
      el('td', {}, [el('div', { style: 'font-weight:600', text: NOMBRE_TIPO[c.tipo] + ' ' + Number(c.consecutivo.slice(-10)) }), el('div', { class: 'mini', text: fechaHora(c.fecha_emision) })]),
      el('td', { class: 'mini', text: c.receptor_nombre || 'Consumidor final' }),
      el('td', {}, el('span', { class: 'pill', text: (MEDIOS[c.medio_pago] || [c.medio_pago])[0] })),
      el('td', { class: 'der mini', text: money(c.total_impuesto) }),
      el('td', { class: 'der', style: 'font-weight:700' + (c.tipo === '03' ? ';color:var(--neg)' : ''), text: (c.tipo === '03' ? '-' : '') + money(c.total_comprobante) }),
      el('td', {}, el('span', { class: 'pill ' + est[1], text: est[0] })),
      el('td', { class: 'mini', text: nota })
    ]));
  }
  root.appendChild(el('div', { class: 'card pad0 glass' }, el('div', { class: 'tabla-wrap' }, el('table', {}, [
    el('thead', {}, el('tr', {}, ['Comprobante', 'Cliente', 'Pago', 'IVA', 'Total', 'Hacienda', ''].map((t, i) => el('th', { text: t, class: i === 3 || i === 4 ? 'der' : '' })))), tb]))));
}

async function verComprobante(id) {
  const c = await intentar(() => BESALU.ventas.obtener(id));
  if (!c) return;
  const acciones = [el('button', { class: 'btn btn--ghost', onclick: () => imprimir(armarComprobante(c)) }, [icon('printer', 17), 'Reimprimir']),
    el('button', { class: 'btn btn--accent', onclick: cerrarModal }, 'Cerrar')];
  if (c.tipo !== '03' && !c.nota_credito && c.estado_hacienda !== 'rechazado') acciones.unshift(el('button', { class: 'btn btn--danger-ghost', style: 'margin-right:auto', onclick: () => emitirNotaCredito(c) }, [icon('undo', 16), 'Nota de crédito']));
  abrirModal(el('div', { class: 'modal' }, [
    el('div', { class: 'card-t' }, [el('h2', { text: NOMBRE_TIPO[c.tipo] + ' ' + Number(c.consecutivo.slice(-10)) }), el('button', { class: 'icon-btn', onclick: cerrarModal }, icon('x', 18))]),
    c.nota_credito ? el('div', { class: 'note', style: 'margin:0 0 12px', html: 'Anulada con la nota de crédito <b>' + c.nota_credito.consecutivo + '</b> · ' + c.nota_credito.referencia_razon }) : null,
    el('div', { style: 'display:grid;place-items:center' }, armarComprobante(c)),
    seccionHacienda(c, (otro) => { cerrarModal(); renderVentas(); if (otro) verComprobante(otro); else verComprobante(c.id); }),
    el('div', { class: 'modal-acc' }, acciones)]));
}

async function emitirNotaCredito(c) {
  if (!App.turno) { toast('Abrí la caja para registrar la devolución', 'err'); return; }
  const motivo = await confirmar('Nota de crédito',
    'Se emitirá una nota de crédito por ' + money(c.total_comprobante) + ' que anula ' + NOMBRE_TIPO[c.tipo].toLowerCase() + ' ' + c.consecutivo +
    '.\nLos productos vuelven al inventario.' + (c.medio_pago === 'efectivo' ? '\nEl dinero se descuenta del efectivo de la caja.' : ''),
    { peligro: true, pedirTexto: 'Motivo (p. ej. devolución del cliente)', aceptar: 'Emitir nota de crédito' });
  if (!motivo) return;
  const nc = await intentar(() => BESALU.ventas.notaCredito(c.id, motivo), 'No se pudo emitir la nota de crédito');
  if (!nc) return;
  cerrarModal();
  await App.recargarCatalogo();
  toast('Nota de crédito emitida', 'ok', nc.consecutivo);
  if (App.ajustes.imprimirAlCobrar) imprimir(armarComprobante(nc), { automatico: true });
  renderVentas();
}

async function exportarCsv(tipo, a, b) {
  const r = await intentar(() => BESALU.exportar(tipo, a, b), 'No se pudo exportar');
  if (r) toast('Archivo guardado', 'ok', r.ruta);
}
