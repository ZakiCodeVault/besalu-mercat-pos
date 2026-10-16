/**
 * ticket.js — Dibuja e imprime comprobantes y el reporte de cierre (Z).
 *
 * Se imprime solo lo que está en #zona-impresion (ver @media print en estilos.css).
 * En la app de escritorio va directo a la impresora predeterminada, sin diálogo.
 */
const TITULO_COMPROBANTE = { '01': 'Factura electrónica', '03': 'Nota de crédito electrónica', '04': 'Tiquete electrónico' };

function fila(izq, der, clase) { return el('div', { class: 'row' + (clase ? ' ' + clase : '') }, [el('span', { text: izq }), el('span', { text: der })]); }

function encabezadoNegocio() {
  const a = App.ajustes;
  const tipo = (TIPOS_ID.find((t) => t[0] === a.tipoCedula) || [, 'Cédula'])[1];
  return el('div', { class: 'tc' }, [
    el('div', { class: 'th', text: a.negocio }),
    a.nombreComercial && a.nombreComercial !== a.negocio ? el('div', { class: 'small', text: a.nombreComercial }) : null,
    a.cedula ? el('div', { class: 'small', text: tipo + ' ' + a.cedula }) : null,
    a.telefono ? el('div', { class: 'small', text: 'Tel. ' + a.telefono }) : null,
    a.direccion ? el('div', { class: 'small', text: a.direccion }) : null
  ]);
}

/** Comprobante completo (venta, factura o nota de crédito). */
function armarComprobante(c) {
  const ivaPorTarifa = {};
  for (const l of c.lineas) { const k = l.tarifa_iva; ivaPorTarifa[k] = ivaPorTarifa[k] || { base: 0, iva: 0 }; ivaPorTarifa[k].base += l.subtotal; ivaPorTarifa[k].iva += l.impuesto; }
  const estado = ESTADO_HACIENDA[c.estado_hacienda] || [c.estado_hacienda];
  return el('div', { class: 'ticket' }, [
    encabezadoNegocio(),
    el('hr'),
    el('div', { class: 'tc', style: 'font-weight:800;font-size:13px', text: TITULO_COMPROBANTE[c.tipo] }),
    fila('Consecutivo', c.consecutivo, 'small'),
    fila('Fecha', fechaHora(c.fecha_emision), 'small'),
    el('div', { class: 'small', style: 'margin-top:3px', text: 'Clave: ' + c.clave }),
    c.referencia ? el('div', { class: 'small', style: 'margin-top:3px', text: 'Anula/corrige: ' + c.referencia.consecutivo + ' · ' + c.referencia_razon }) : null,
    el('hr'),
    c.receptor_nombre
      ? el('div', {}, [fila('Cliente', c.receptor_nombre, 'small'), fila('Identificación', c.receptor_identificacion, 'small'), c.receptor_correo ? fila('Correo', c.receptor_correo, 'small') : null])
      : fila('Cliente', 'Consumidor final', 'small'),
    el('hr'),
    el('div', {}, c.lineas.map((l) => el('div', { class: 'it' }, [
      el('span', { class: 'nm', text: cantidad(l.cantidad) + ' × ' + l.descripcion + (l.tarifa_iva ? '' : ' (E)') }),
      el('span', { text: money(l.total_linea) })
    ]))),
    el('hr'),
    c.total_gravado ? fila('Total gravado', money(c.total_gravado)) : null,
    c.total_exento ? fila('Total exento', money(c.total_exento)) : null,
    el('div', {}, Object.keys(ivaPorTarifa).filter((t) => Number(t) > 0).sort((a, b) => b - a)
      .map((t) => fila('IVA ' + t + '% (base ' + money(ivaPorTarifa[t].base) + ')', money(ivaPorTarifa[t].iva), 'small'))),
    fila('TOTAL', money(c.total_comprobante), 'b'),
    c.tipo !== '03' ? fila('Pago', (MEDIOS[c.medio_pago] || [c.medio_pago])[0] + (c.medio_pago === 'efectivo' ? ' ' + money(c.pago) : ''), 'small') : null,
    c.tipo !== '03' && c.medio_pago === 'efectivo' ? fila('Cambio', money(c.cambio), 'small') : null,
    el('hr'),
    c.tipo !== '03' ? el('div', { class: 'tc small', text: App.ajustes.pieTicket }) : null,
    el('div', { class: 'tc small', style: 'margin-top:4px;opacity:.75', text: { aceptado: 'Aceptado por Hacienda', rechazado: 'Rechazado por Hacienda', enviado: 'Enviado a Hacienda' }[c.estado_hacienda] || 'Pendiente de envío a Hacienda' })
  ]);
}

/** Reporte de cierre de caja (Z). */
function armarCierre(r) {
  const t = r.turno;
  return el('div', { class: 'ticket' }, [
    encabezadoNegocio(), el('hr'),
    el('div', { class: 'tc', style: 'font-weight:800;font-size:13px', text: 'CIERRE DE CAJA (Z) · Turno #' + t.id }),
    fila('Apertura', fechaHora(t.abierto_en), 'small'), fila('Cierre', fechaHora(t.cerrado_en), 'small'), el('hr'),
    fila('Comprobantes', String(r.comprobantes), 'small'),
    fila('Efectivo', money(r.medios.efectivo)), fila('Tarjeta', money(r.medios.tarjeta)), fila('SINPE', money(r.medios.sinpe)),
    r.devoluciones ? fila('Devoluciones', '-' + money(r.devoluciones)) : null,
    fila('Ventas netas', money(r.ventas_netas), 'b'), el('hr'),
    fila('Fondo inicial', money(t.fondo), 'small'),
    fila('Efectivo esperado', money(t.esperado)), fila('Efectivo contado', money(t.contado)),
    fila('Diferencia', (t.diferencia > 0 ? '+' : '') + money(t.diferencia), 'b')
  ]);
}

/** Pone el nodo en la zona de impresión y lo manda a la impresora. */
async function imprimir(nodo, { automatico = false } = {}) {
  const zona = $('#zona-impresion');
  zona.innerHTML = '';
  zona.className = App.ajustes.ticket === '58 mm' ? 't58' : '';
  zona.appendChild(nodo);
  try {
    if (window.BESALU && BESALU.imprimir) {
      const r = await BESALU.imprimir();
      if (r && r.ok) { if (!automatico) toast('Enviado a la impresora'); }
      else toast('No se pudo imprimir', 'err', (r && r.motivo) || 'Revise que haya una impresora predeterminada en Windows');
    } else window.print();
  } catch (e) { toast('No se pudo imprimir', 'err', String(e.message || e)); }
}
