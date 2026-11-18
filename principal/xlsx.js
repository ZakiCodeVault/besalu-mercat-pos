/**
 * xlsx.js — Genera libros de Excel (.xlsx) reales, sin librerías externas.
 *
 * Un .xlsx es un ZIP con archivos XML. Aquí se arma lo mínimo que Excel
 * necesita: varias hojas, encabezado fijo con filtros, anchos de columna y
 * formatos (colones, cantidades, fechas reales de Excel).
 *
 *   crearLibro([{ nombre, columnas: [{ titulo, tipo, ancho }], filas: [[...]] }]) → Buffer
 *   tipos de columna: texto · dinero (céntimos) · cantidad · entero · fecha ('AAAA-MM-DD') ·
 *                     fechaHora ('AAAA-MM-DD HH:MM:SS' o ISO) · porcentaje (0–100)
 */
const zlib = require('zlib');

/* ---------------- ZIP (método deflate) ---------------- */
const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABLA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(archivos) {
  const locales = [], central = [];
  let desplazamiento = 0;
  const ahora = new Date();
  const hora = ((ahora.getHours() << 11) | (ahora.getMinutes() << 5) | (ahora.getSeconds() >> 1)) & 0xffff;
  const dia = (((ahora.getFullYear() - 1980) << 9) | ((ahora.getMonth() + 1) << 5) | ahora.getDate()) & 0xffff;
  for (const { nombre, contenido } of archivos) {
    const datos = Buffer.from(contenido, 'utf8');
    const comprimido = zlib.deflateRawSync(datos, { level: 9 });
    const nombreB = Buffer.from(nombre, 'utf8');
    const crc = crc32(datos);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(hora, 10); local.writeUInt16LE(dia, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprimido.length, 18); local.writeUInt32LE(datos.length, 22); local.writeUInt16LE(nombreB.length, 26);
    locales.push(local, nombreB, comprimido);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt16LE(hora, 12); c.writeUInt16LE(dia, 14); c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(comprimido.length, 20); c.writeUInt32LE(datos.length, 24); c.writeUInt16LE(nombreB.length, 28);
    c.writeUInt32LE(desplazamiento, 42);
    central.push(c, nombreB);
    desplazamiento += 30 + nombreB.length + comprimido.length;
  }
  const tamCentral = central.reduce((s, b) => s + b.length, 0);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(archivos.length, 8); fin.writeUInt16LE(archivos.length, 10);
  fin.writeUInt32LE(tamCentral, 12); fin.writeUInt32LE(desplazamiento, 16);
  return Buffer.concat([...locales, ...central, fin]);
}

/* ---------------- XML ---------------- */
const esc = (v) => String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function columna(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** 'AAAA-MM-DD[ T]HH:MM:SS' → número de serie de Excel (días desde 1899-12-30), en hora local. */
function serieExcel(texto) {
  const m = String(texto || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  return ms / 86400000 + 25569;
}

// Estilos (índices de cellXfs)
const ESTILO = { texto: 0, encabezado: 1, dinero: 2, cantidad: 3, fechaHora: 4, fecha: 5, entero: 6, porcentaje: 7 };

const ESTILOS_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="4"><numFmt numFmtId="164" formatCode="&quot;₡&quot;#,##0.00"/><numFmt numFmtId="165" formatCode="#,##0.###"/>' +
  '<numFmt numFmtId="166" formatCode="dd/mm/yyyy hh:mm"/><numFmt numFmtId="167" formatCode="dd/mm/yyyy"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FF1F2430"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="8">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

function celda(ref, valor, tipo) {
  if (valor === null || valor === undefined || valor === '') return '';
  let numero = null;
  if (tipo === 'dinero') numero = Number(valor) / 100;
  else if (tipo === 'cantidad' || tipo === 'entero') numero = Number(valor);
  else if (tipo === 'porcentaje') numero = Number(valor) / 100;
  else if (tipo === 'fecha' || tipo === 'fechaHora') numero = serieExcel(valor);
  if (numero !== null && Number.isFinite(numero)) {
    return '<c r="' + ref + '" s="' + ESTILO[tipo] + '"><v>' + numero + '</v></c>';
  }
  const t = String(valor);
  return '<c r="' + ref + '" t="inlineStr"><is><t' + (/^\s|\s$/.test(t) ? ' xml:space="preserve"' : '') + '>' + esc(t) + '</t></is></c>';
}

function hojaXml(h) {
  const ultima = columna(Math.max(0, h.columnas.length - 1));
  const filasXml = ['<row r="1">' + h.columnas.map((c, i) => {
    const ref = columna(i) + '1';
    return '<c r="' + ref + '" t="inlineStr" s="1"><is><t>' + esc(c.titulo) + '</t></is></c>';
  }).join('') + '</row>'];
  h.filas.forEach((f, n) => {
    const r = n + 2;
    filasXml.push('<row r="' + r + '">' + h.columnas.map((c, i) => celda(columna(i) + r, f[i], c.tipo || 'texto')).join('') + '</row>');
  });
  const anchos = h.columnas.map((c, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (c.ancho || 14) + '" customWidth="1"/>').join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<dimension ref="A1:' + ultima + (h.filas.length + 1) + '"/>' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/><cols>' + anchos + '</cols>' +
    '<sheetData>' + filasXml.join('') + '</sheetData>' +
    (h.filas.length ? '<autoFilter ref="A1:' + ultima + (h.filas.length + 1) + '"/>' : '') +
    '</worksheet>';
}

function nombreHoja(n, usados) {
  let base = String(n).replace(/[\[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Hoja';
  let nombre = base, i = 2;
  while (usados.has(nombre.toLowerCase())) nombre = base.slice(0, 28) + ' ' + i++;
  usados.add(nombre.toLowerCase());
  return nombre;
}

/** @returns {Buffer} el archivo .xlsx */
function crearLibro(hojas) {
  if (!hojas.length) throw new Error('El libro no tiene hojas');
  const usados = new Set();
  const nombres = hojas.map((h) => nombreHoja(h.nombre, usados));
  const archivos = [
    { nombre: '[Content_Types].xml', contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      hojas.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') +
      '</Types>' },
    { nombre: '_rels/.rels', contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { nombre: 'xl/workbook.xml', contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets>' + nombres.map((n, i) => '<sheet name="' + esc(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets>' +
      '<definedNames>' + hojas.map((h, i) => (h.filas.length
        ? '<definedName name="_xlnm._FilterDatabase" localSheetId="' + i + '" hidden="1">\'' + esc(nombres[i].replace(/'/g, "''")) + '\'!$A$1:$' +
          columna(Math.max(0, h.columnas.length - 1)) + '$' + (h.filas.length + 1) + '</definedName>' : '')).join('') + '</definedNames>' +
      '</workbook>' },
    { nombre: 'xl/_rels/workbook.xml.rels', contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      hojas.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') +
      '<Relationship Id="rId' + (hojas.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>' },
    { nombre: 'xl/styles.xml', contenido: ESTILOS_XML },
    ...hojas.map((h, i) => ({ nombre: 'xl/worksheets/sheet' + (i + 1) + '.xml', contenido: hojaXml(h) }))
  ];
  // Excel no admite un definedNames vacío
  archivos[2].contenido = archivos[2].contenido.replace('<definedNames></definedNames>', '');
  return zip(archivos);
}

module.exports = { crearLibro, serieExcel, columna };
