/**
 * pdf.js — Representación gráfica del comprobante (hoja carta) para enviarla
 * por correo junto con el XML.
 *
 * Se arma un HTML con los datos ya guardados del comprobante (los mismos del
 * XML firmado) y Chromium lo convierte a PDF en una ventana oculta
 * (webContents.printToPDF): no hace falta ninguna librería de PDF. Las fuentes
 * van incrustadas, así que el PDF se ve igual sin internet.
 *
 * Lo que vale ante Hacienda es el XML aceptado; el PDF es la versión legible.
 */
const fs = require('fs');
const path = require('path');
const { PROVINCIAS } = require('./catalogos');

const HOJA = 'Letter';   // tamaño carta (8,5 × 11 pulgadas)
const RESOLUCION = 'MH-DGT-RES-0027-2024';
const TITULO = { '01': 'Factura electrónica', '03': 'Nota de crédito electrónica', '04': 'Tiquete electrónico' };
const TIPO_ID = { '01': 'Cédula física', '02': 'Cédula jurídica', '03': 'DIMEX', '04': 'NITE', '05': 'Extranjero' };
const MEDIO = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', sinpe: 'SINPE Móvil', transferencia: 'Transferencia', otro: 'Otro' };
const CONDICION = { '01': 'Contado', '02': 'Crédito' };
const SITUACION = { 1: 'Normal', 2: 'Contingencia', 3: 'Sin internet' };

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** céntimos → "₡1 250,00" */
function colones(c) {
  const v = Number(c || 0);
  return (v < 0 ? '-₡' : '₡') + (Math.abs(v) / 100).toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const cantidad = (n) => (Math.round(Number(n || 0) * 1000) / 1000).toLocaleString('es-CR', { maximumFractionDigits: 3 });
const tarifa = (t) => String(t).replace('.', ',') + ' %';

/** "2026-10-21T15:04:05-06:00" o "2026-10-21 15:04:05" → "21/10/2026 15:04" */
function fechaHora(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  return m ? m[3] + '/' + m[2] + '/' + m[1] + ' ' + m[4] + ':' + m[5] : '';
}

/** Clave de 50 dígitos en grupos legibles (país, fecha, cédula, consecutivo, situación, seguridad). */
const claveLegible = (k) => [k.slice(0, 3), k.slice(3, 9), k.slice(9, 21), k.slice(21, 41), k.slice(41, 42), k.slice(42)].join(' ');

let fuentes = null;
function fuentesIncrustadas() {
  if (fuentes) return fuentes;
  const dir = path.join(__dirname, '..', '..', 'interfaz', 'fuentes');
  const url = (f) => 'data:font/woff2;base64,' + fs.readFileSync(path.join(dir, f)).toString('base64');
  fuentes = `
  @font-face{font-family:'Inter';font-weight:400 800;src:url(${url('inter-latin.woff2')}) format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2212;}
  @font-face{font-family:'Inter';font-weight:400 800;src:url(${url('inter-latin-ext.woff2')}) format('woff2');unicode-range:U+0100-02BA,U+20A0-20AB,U+20AD-20C4,U+2113;}
  @font-face{font-family:'Playfair Display';font-weight:700 900;src:url(${url('playfair-display-latin.woff2')}) format('woff2');unicode-range:U+0000-00FF,U+2000-206F;}`;
  return fuentes;
}

const ESTILOS = `
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Inter',Arial,sans-serif;font-size:9.5pt;color:#1d2330;line-height:1.4;-webkit-print-color-adjust:exact}
  .fila{display:flex;justify-content:space-between;gap:24px}
  .emisor h1{font-family:'Playfair Display',Georgia,serif;font-size:20pt;font-weight:800;letter-spacing:-.01em;line-height:1.15}
  .gris{color:#5b6475}
  .peq{font-size:8.5pt}
  .doc{text-align:right;min-width:230px}
  .doc .tipo{font-size:8pt;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#5b6475}
  .doc .num{font-size:15pt;font-weight:800;letter-spacing:-.01em;font-variant-numeric:tabular-nums;margin:2px 0 6px}
  .doc table{margin-left:auto;border-collapse:collapse}
  .doc td{padding:1px 0 1px 12px;font-size:8.5pt}
  .doc td:first-child{color:#5b6475}
  .caja{border:1px solid #dde1e8;border-radius:10px;padding:10px 14px;margin-top:14px}
  .etq{font-size:7.5pt;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#5b6475;margin-bottom:3px}
  .clave{font-family:'Inter',monospace;font-size:10pt;font-weight:600;letter-spacing:.04em;font-variant-numeric:tabular-nums}
  .lineas{width:100%;border-collapse:collapse;margin-top:16px}
  .lineas th{font-size:7.5pt;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#5b6475;text-align:left;padding:6px 6px;border-bottom:1.5px solid #1d2330}
  .lineas th.der{text-align:right}
  .lineas td{padding:7px 6px;border-bottom:1px solid #e6e9ef;vertical-align:top}
  .lineas tr{page-break-inside:avoid}
  .der{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .totales{margin-left:auto;width:290px;border-collapse:collapse;margin-top:12px;page-break-inside:avoid}
  .totales td{padding:3px 0}
  .totales .total td{border-top:1.5px solid #1d2330;padding-top:7px;font-size:12pt;font-weight:800}
  .pie{margin-top:22px;padding-top:10px;border-top:1px solid #dde1e8;page-break-inside:avoid}
  .estado{display:inline-block;font-size:8pt;font-weight:700;padding:2px 9px;border-radius:99px;background:#e7f6ec;color:#17733a}
  .estado.no{background:#f1f2f5;color:#5b6475}`;

/**
 * HTML completo de la representación gráfica.
 * @param {object} c comprobante (ventas.obtenerPorId, con sus líneas)
 * @param {object} a ajustes del negocio (emisor)
 */
function html(c, a) {
  const provincia = PROVINCIAS[a.provincia] || '';
  const direccion = [a.direccion, a.barrio, provincia].filter((x) => String(x || '').trim()).join(', ');
  const correoNegocio = String(a.correo || '').split(/[;,\s]+/).filter(Boolean)[0] || '';
  const contacto = [a.telefono ? 'Tel. ' + a.telefono : '', correoNegocio].filter(Boolean).join(' · ');

  const desglose = {};
  for (const l of c.lineas) {
    if (!(l.tarifa_iva > 0)) continue;
    const d = desglose[l.tarifa_iva] || (desglose[l.tarifa_iva] = { base: 0, iva: 0 });
    d.base += l.subtotal; d.iva += l.impuesto;
  }
  const filaTotal = (t, v, clase) => '<tr' + (clase ? ' class="' + clase + '"' : '') + '><td>' + t + '</td><td class="der">' + v + '</td></tr>';
  const totales = [
    c.total_gravado ? filaTotal('Total gravado', colones(c.total_gravado)) : '',
    c.total_exento ? filaTotal('Total exento', colones(c.total_exento)) : '',
    filaTotal('Total venta neta', colones(c.total_venta)),
    ...Object.keys(desglose).sort((x, y) => y - x).map((t) => filaTotal('IVA ' + tarifa(t) + ' <span class="gris peq">sobre ' + colones(desglose[t].base) + '</span>', colones(desglose[t].iva))),
    filaTotal('Total impuesto', colones(c.total_impuesto)),
    filaTotal('Total', colones(c.total_comprobante), 'total')
  ].join('');

  const lineas = c.lineas.map((l) => '<tr>' +
    '<td class="der gris">' + l.linea + '</td>' +
    '<td><div>' + esc(l.descripcion) + '</div><div class="gris peq">' + (l.cabys ? 'CABYS ' + esc(l.cabys) : '') + (l.codigo ? (l.cabys ? ' · ' : '') + 'Cód. ' + esc(l.codigo) : '') + '</div></td>' +
    '<td class="der">' + cantidad(l.cantidad) + ' <span class="gris peq">' + esc(l.unidad) + '</span></td>' +
    '<td class="der">' + colones(l.precio_unitario) + '</td>' +
    '<td class="der">' + colones(l.subtotal) + '</td>' +
    '<td class="der">' + (l.tarifa_iva > 0 ? colones(l.impuesto) + '<div class="gris peq">' + tarifa(l.tarifa_iva) + '</div>' : '<span class="gris">Exento</span>') + '</td>' +
    '<td class="der"><b>' + colones(l.total_linea) + '</b></td></tr>').join('');

  const receptor = c.receptor_nombre
    ? '<div style="font-size:11pt;font-weight:700">' + esc(c.receptor_nombre) + '</div><div class="gris">' +
      esc(TIPO_ID[c.receptor_tipo_id] || 'Identificación') + ' ' + esc(c.receptor_identificacion) + (c.receptor_correo ? ' · ' + esc(c.receptor_correo) : '') + '</div>'
    : '<div>Consumidor final</div>';
  const referencia = c.referencia
    ? '<div class="caja"><div class="etq">Documento de referencia</div>' + esc(c.referencia.consecutivo) + ' · ' + esc(c.referencia_razon) + '</div>' : '';
  const aceptado = c.estado_hacienda === 'aceptado';

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(TITULO[c.tipo])} ${esc(c.consecutivo)}</title>
<style>${fuentesIncrustadas()}${ESTILOS}</style></head><body>
  <div class="fila">
    <div class="emisor">
      <h1>${esc(a.negocio)}</h1>
      ${a.nombreComercial && a.nombreComercial !== a.negocio ? '<div class="gris">' + esc(a.nombreComercial) + '</div>' : ''}
      <div style="margin-top:6px">${esc(TIPO_ID[a.tipoCedula] || 'Cédula')} ${esc(a.cedula)}</div>
      ${direccion ? '<div class="gris">' + esc(direccion) + '</div>' : ''}
      ${contacto ? '<div class="gris">' + esc(contacto) + '</div>' : ''}
      ${a.actividadEconomica ? '<div class="gris peq">Actividad económica ' + esc(a.actividadEconomica) + '</div>' : ''}
    </div>
    <div class="doc">
      <div class="tipo">${esc(TITULO[c.tipo])}</div>
      <div class="num">N.° ${esc(c.consecutivo)}</div>
      <table>
        <tr><td>Fecha de emisión</td><td>${fechaHora(c.fecha_emision)}</td></tr>
        <tr><td>Condición de venta</td><td>${esc(CONDICION[c.condicion_venta] || c.condicion_venta)}</td></tr>
        ${c.tipo !== '03' ? '<tr><td>Medio de pago</td><td>' + esc(MEDIO[c.medio_pago] || c.medio_pago) + '</td></tr>' : ''}
        ${c.clave[41] !== '1' ? '<tr><td>Situación</td><td>' + esc(SITUACION[c.clave[41]] || c.clave[41]) + '</td></tr>' : ''}
      </table>
    </div>
  </div>
  <div class="caja"><div class="etq">Clave numérica</div><div class="clave">${claveLegible(c.clave)}</div></div>
  <div class="caja"><div class="etq">${c.tipo === '03' ? 'Cliente' : 'Facturado a'}</div>${receptor}</div>
  ${referencia}
  <table class="lineas">
    <thead><tr><th class="der">#</th><th>Descripción</th><th class="der">Cantidad</th><th class="der">Precio unit.</th><th class="der">Subtotal</th><th class="der">IVA</th><th class="der">Total</th></tr></thead>
    <tbody>${lineas}</tbody>
  </table>
  <div class="gris peq" style="margin-top:4px">Precios unitarios y subtotales sin IVA.</div>
  <table class="totales">${totales}</table>
  <div class="pie">
    <div class="fila" style="align-items:center">
      <span class="estado${aceptado ? '' : ' no'}">${aceptado ? 'Aceptado por Hacienda' + (c.hacienda_fecha ? ' · ' + fechaHora(c.hacienda_fecha) : '') : 'Pendiente de aceptación de Hacienda'}</span>
      <span class="gris peq">Comprobante electrónico versión 4.4 · Resolución ${RESOLUCION}</span>
    </div>
    <div class="gris peq" style="margin-top:8px">Representación gráfica del comprobante electrónico. El documento con validez es el XML firmado aceptado por Hacienda${aceptado ? ', que se adjunta junto con la respuesta de Hacienda' : ''}.</div>
    ${a.pieTicket && c.tipo !== '03' ? '<div style="margin-top:8px">' + esc(a.pieTicket) + '</div>' : ''}
  </div>
</body></html>`;
}

/** Pie de cada página (clave y número de página). */
const pieDePagina = (c) => '<div style="font-family:Arial,sans-serif;font-size:7px;color:#8a92a3;width:100%;padding:0 0.5in;display:flex;justify-content:space-between">' +
  '<span>' + esc(TITULO[c.tipo]) + ' ' + esc(c.consecutivo) + '</span><span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>';

/**
 * Genera el PDF en una ventana oculta (sin JavaScript ni acceso a nada).
 * @returns {Promise<Buffer>}
 */
async function generar(c, a) {
  const { BrowserWindow } = require('electron');
  const ventana = new BrowserWindow({
    show: false, width: 816, height: 1056, focusable: false, skipTaskbar: true,
    webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false }
  });
  try {
    await ventana.loadURL('data:text/html;charset=utf-8;base64,' + Buffer.from(html(c, a), 'utf8').toString('base64'));
    return await ventana.webContents.printToPDF({
      pageSize: HOJA, printBackground: true, preferCSSPageSize: false,
      margins: { top: 0.5, bottom: 0.6, left: 0.5, right: 0.5 },
      displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: pieDePagina(c)
    });
  } finally {
    if (!ventana.isDestroyed()) ventana.destroy();
  }
}

module.exports = { html, generar, colones, fechaHora };
