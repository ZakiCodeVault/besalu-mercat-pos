/**
 * orden-pdf.js — Orden de compra en PDF (hoja carta) para enviarla al proveedor.
 *
 * Se arma en HTML y se convierte con la impresión a PDF de Chromium, en una
 * ventana oculta sin JavaScript ni acceso a nada.
 */
const { leerAjustes } = require('./datos/conexion');

const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colones = (c) => '₡' + (Number(c || 0) / 100).toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cantidad = (n) => String(Math.round(Number(n || 0) * 1000) / 1000).replace('.', ',');
const fechaCorta = (s) => (s ? String(s).slice(8, 10) + '/' + String(s).slice(5, 7) + '/' + String(s).slice(0, 4) : '');

function html(o) {
  const a = leerAjustes();
  const filas = o.lineas.map((l) => '<tr><td>' + esc(l.producto_codigo) + '</td><td>' + esc(l.descripcion) + '</td>' +
    '<td class="n">' + cantidad(l.cantidad) + ' ' + esc(l.unidad || '') + '</td><td class="n">' + colones(l.costo_unitario) + '</td>' +
    '<td class="n">' + esc(l.tarifa_iva) + '%</td><td class="n">' + colones(l.total_linea) + '</td></tr>').join('');
  return '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>' + esc(o.numero_texto) + '</title><style>' +
    '*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#1d2230;font-size:11px;margin:0}' +
    '.cab{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1d2230;padding-bottom:12px;margin-bottom:16px}' +
    '.neg b{font-size:17px;display:block;margin-bottom:3px}.neg div{color:#566074;line-height:1.5}' +
    '.doc{text-align:right}.doc .t{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#566074}.doc .n{font-size:22px;font-weight:700;margin:2px 0 6px}' +
    '.doc div{color:#566074;line-height:1.5}.prov{background:#f3f5f9;border-radius:6px;padding:10px 12px;margin-bottom:16px;line-height:1.55}' +
    '.prov .t{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#566074}' +
    'table{width:100%;border-collapse:collapse}th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#566074;border-bottom:1px solid #cfd5e1;padding:6px 6px}' +
    'td{padding:7px 6px;border-bottom:1px solid #e6e9f0;vertical-align:top}.n{text-align:right;white-space:nowrap}' +
    '.tot{margin:14px 0 0 auto;width:260px}.tot div{display:flex;justify-content:space-between;padding:3px 0}.tot .g{font-size:14px;font-weight:700;border-top:1px solid #1d2230;padding-top:6px;margin-top:4px}' +
    '.notas{margin-top:18px;color:#3c4456;line-height:1.5}.firma{margin-top:56px;display:flex;gap:40px}.firma div{flex:1;border-top:1px solid #8a92a3;padding-top:5px;color:#566074;text-align:center}' +
    '</style></head><body>' +
    '<div class="cab"><div class="neg"><b>' + esc(a.negocio) + '</b><div>' + (a.cedula ? 'Cédula ' + esc(a.cedula) + '<br>' : '') +
    (a.telefono ? 'Tel. ' + esc(a.telefono) + '<br>' : '') + (a.correo ? esc(a.correo) + '<br>' : '') + esc(a.direccion || '') + '</div></div>' +
    '<div class="doc"><div class="t">Orden de compra</div><div class="n">' + esc(o.numero_texto) + '</div><div>Emitida ' + fechaCorta(o.emitida_en) + '</div>' +
    (o.fecha_esperada ? '<div>Entrega esperada ' + fechaCorta(o.fecha_esperada) + '</div>' : '') + '</div></div>' +
    '<div class="prov"><div class="t">Proveedor</div><b>' + esc(o.proveedor_nombre) + '</b> · ' + esc(o.proveedor_identificacion) +
    (o.proveedor_telefono ? ' · Tel. ' + esc(o.proveedor_telefono) : '') + (o.proveedor_correo ? ' · ' + esc(o.proveedor_correo) : '') + '</div>' +
    '<table><thead><tr><th>Código</th><th>Producto</th><th class="n">Cantidad</th><th class="n">Costo u. sin IVA</th><th class="n">IVA</th><th class="n">Total</th></tr></thead>' +
    '<tbody>' + filas + '</tbody></table>' +
    '<div class="tot"><div><span>Subtotal</span><span>' + colones(o.subtotal) + '</span></div><div><span>IVA</span><span>' + colones(o.impuesto) + '</span></div>' +
    '<div class="g"><span>Total estimado</span><span>' + colones(o.total) + '</span></div></div>' +
    (o.notas ? '<div class="notas"><b>Notas:</b> ' + esc(o.notas) + '</div>' : '') +
    '<div class="notas">Por favor indicar el número ' + esc(o.numero_texto) + ' en la factura.</div>' +
    '<div class="firma"><div>Autoriza</div><div>Recibe (proveedor)</div></div>' +
    '</body></html>';
}

/** @returns {Promise<Buffer>} */
async function generar(o) {
  const { BrowserWindow } = require('electron');
  const ventana = new BrowserWindow({
    show: false, width: 816, height: 1056, focusable: false, skipTaskbar: true,
    webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false }
  });
  try {
    await ventana.loadURL('data:text/html;charset=utf-8;base64,' + Buffer.from(html(o), 'utf8').toString('base64'));
    return await ventana.webContents.printToPDF({
      pageSize: 'Letter', printBackground: true, margins: { top: 0.5, bottom: 0.6, left: 0.55, right: 0.55 },
      displayHeaderFooter: true, headerTemplate: '<span></span>',
      footerTemplate: '<div style="font-family:Arial,sans-serif;font-size:7px;color:#8a92a3;width:100%;padding:0 0.55in;display:flex;justify-content:space-between">' +
        '<span>' + esc(o.numero_texto) + '</span><span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>'
    });
  } finally {
    if (!ventana.isDestroyed()) ventana.destroy();
  }
}

module.exports = { html, generar };
