/**
 * utilidades.js — Herramientas compartidas por todas las pantallas.
 *
 *  - íconos SVG, creación de elementos (el), avisos (toast) y ventanas (modal)
 *  - montos: la base guarda CÉNTIMOS; aquí se convierten desde/hacia ₡
 *  - fechas y períodos (hoy, este mes, mes anterior)
 */

/* ---------------- Íconos ---------------- */
const SVG = {
  receipt: '<path d="M6 3H18V19L15.8 20.6 13.9 19 12 20.6 10.1 19 8.2 20.6 6 19Z"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="9" y1="11.5" x2="15" y2="11.5"/><line x1="9" y1="15" x2="13" y2="15"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><polyline points="3 4 3 9 8 9"/><polyline points="12 7.5 12 12 15.5 14"/>',
  box: '<path d="M12 3L20.5 7.5V16.5L12 21 3.5 16.5V7.5L12 3Z"/><path d="M3.5 7.5L12 12 20.5 7.5"/><line x1="12" y1="12" x2="12" y2="21"/>',
  truck: '<path d="M3 6h11v10H3Z"/><path d="M14 9h4l3 3.5V16h-7"/><circle cx="7" cy="17.5" r="1.7"/><circle cx="17" cy="17.5" r="1.7"/>',
  chart: '<line x1="4" y1="20" x2="20.5" y2="20"/><rect x="5.6" y="11" width="3.2" height="9"/><rect x="10.4" y="7" width="3.2" height="13"/><rect x="15.2" y="14" width="3.2" height="6"/>',
  wallet: '<rect x="3" y="6" width="18" height="13" rx="2.4"/><path d="M3 9.5h18"/><circle cx="16.5" cy="13.5" r="1.3" fill="currentColor" stroke="none"/>',
  sliders: '<line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/><circle cx="15" cy="7" r="2.4" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="2.4" fill="currentColor" stroke="none"/><circle cx="13" cy="17" r="2.4" fill="currentColor" stroke="none"/>',
  cash: '<rect x="3" y="7" width="18" height="10" rx="1.5"/><circle cx="12" cy="12" r="2.6"/><line x1="6" y1="10.5" x2="6" y2="13.5"/><line x1="18" y1="10.5" x2="18" y2="13.5"/>',
  card: '<rect x="3" y="6" width="18" height="12" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="6.5" y1="14" x2="11" y2="14"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><line x1="10.5" y1="18.5" x2="13.5" y2="18.5"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  minus: '<line x1="5" y1="12" x2="19" y2="12"/>',
  trash: '<line x1="4" y1="7" x2="20" y2="7"/><path d="M6.6 7L7.5 19.2A1.8 1.8 0 0 0 9.3 21H14.7A1.8 1.8 0 0 0 16.5 19.2L17.4 7"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
  pencil: '<path d="M4 20L4.9 16.2 15.5 5.6A1.9 1.9 0 0 1 18.4 8.5L7.8 19.1 4 20Z"/><line x1="13.6" y1="7.5" x2="16.5" y2="10.4"/>',
  boxplus: '<rect x="4" y="4" width="16" height="16" rx="2.2"/><line x1="12" y1="9" x2="12" y2="15"/><line x1="9" y1="12" x2="15" y2="12"/>',
  search: '<circle cx="11" cy="11" r="7"/><line x1="16" y1="16" x2="21" y2="21"/>',
  printer: '<path d="M7 8V3.5H17V8"/><path d="M7 17.5H5.2A2.2 2.2 0 0 1 3 15.3V11.7A2.2 2.2 0 0 1 5.2 9.5H18.8A2.2 2.2 0 0 1 21 11.7V15.3A2.2 2.2 0 0 1 18.8 17.5H17"/><path d="M7 15H17V21H7Z"/>',
  check: '<polyline points="5 12.5 10 17.5 19 6.5"/>',
  warn: '<path d="M12 4L21 19H3L12 4Z"/><line x1="12" y1="10.5" x2="12" y2="14"/><circle cx="12" cy="16.6" r="0.7" fill="currentColor" stroke="none"/>',
  bag: '<path d="M6.5 8H17.5L16.6 20A1.2 1.2 0 0 1 15.4 21H8.6A1.2 1.2 0 0 1 7.4 20L6.5 8Z"/><path d="M9 8V6.5A3 3 0 0 1 15 6.5V8"/>',
  doc: '<path d="M7 3h7l4 4v14H7Z"/><path d="M14 3v4h4"/><line x1="9.5" y1="12" x2="15" y2="12"/><line x1="9.5" y1="15.5" x2="15" y2="15.5"/>',
  upload: '<path d="M12 15V5"/><polyline points="8 8.5 12 4.5 16 8.5"/><path d="M5 19h14"/>',
  download: '<path d="M12 4v10"/><polyline points="8 11 12 15 16 11"/><path d="M5 19h14"/>',
  clock: '<circle cx="12" cy="12" r="8"/><polyline points="12 8 12 12 15 14"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  unlock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 7.7-1.5"/>',
  x: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
  user: '<circle cx="12" cy="8" r="3.4"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/>',
  shield: '<path d="M12 3l7 3v5.5c0 4.5-3 7.8-7 9.5-4-1.7-7-5-7-9.5V6Z"/><polyline points="8.8 12 11 14.2 15.4 9.8"/>',
  database: '<ellipse cx="12" cy="6" rx="7" ry="2.8"/><path d="M5 6v12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6"/><path d="M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><polyline points="19.5 4.5 19.5 9 15 9"/>',
  list: '<line x1="9" y1="7" x2="20" y2="7"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="17" x2="20" y2="17"/><circle cx="5" cy="7" r="1" fill="currentColor"/><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="5" cy="17" r="1" fill="currentColor"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'
};
function icon(n, s = 20) { const sp = document.createElement('span'); sp.className = 'ic'; sp.innerHTML = svg(n, s); return sp; }
function svg(n, s = 18) { return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">' + (SVG[n] || '') + '</svg>'; }

/* ---------------- DOM ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/** Crea un elemento: el('div', {class, text, html, onclick, ...atributos}, hijos) */
function el(t, p = {}, h = []) {
  const n = document.createElement(t);
  for (const [k, v] of Object.entries(p)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'value') n.value = v;
    else if (v != null && v !== false) n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(h)) { if (c == null || c === false) continue; n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); }
  return n;
}

/* ---------------- Montos (céntimos) ---------------- */
/** céntimos -> "₡1 250" (muestra decimales solo si hay céntimos) */
function money(c) {
  const v = Number(c || 0);
  const dec = Math.round(Math.abs(v)) % 100 !== 0;
  return (v < 0 ? '-₡' : '₡') + (Math.abs(v) / 100).toLocaleString('es-CR', { minimumFractionDigits: dec ? 2 : 0, maximumFractionDigits: 2 });
}

/**
 * Texto escrito por el cajero -> céntimos.
 * Acepta "1250", "1 250", "1.250", "1250,50", "1.250,50", "₡1250".
 */
function aCentimos(texto) {
  let s = String(texto == null ? '' : texto).replace(/[₡\s]/g, '').replace(/[^\d.,-]/g, '');
  if (!s) return 0;
  const coma = s.lastIndexOf(','), punto = s.lastIndexOf('.');
  if (coma >= 0 && punto >= 0) {            // ambos: el último es el decimal
    const dec = coma > punto ? ',' : '.';
    s = s.split(dec === ',' ? '.' : ',').join('').replace(dec, '.');
  } else if (coma >= 0) {
    s = s.replace(/,/g, '.');
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');               // "1.250" o "12.500.000": puntos de miles
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
const aColonesTexto = (c) => (Number(c || 0) / 100).toString().replace('.', ',');
const cantidad = (n) => (Math.round(Number(n || 0) * 1000) / 1000).toLocaleString('es-CR', { maximumFractionDigits: 3 });
const leerNumero = (t) => { const n = parseFloat(String(t).replace(',', '.').replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : 0; };

/* ---------------- Fechas ---------------- */
const pad = (n) => String(n).padStart(2, '0');
const isoDia = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
function periodo(nombre) {
  const h = new Date();
  if (nombre === 'hoy') return { desde: isoDia(h), hasta: isoDia(h), etiqueta: 'Hoy' };
  if (nombre === 'mes_anterior') {
    const i = new Date(h.getFullYear(), h.getMonth() - 1, 1), f = new Date(h.getFullYear(), h.getMonth(), 0);
    return { desde: isoDia(i), hasta: isoDia(f), etiqueta: i.toLocaleDateString('es-CR', { month: 'long', year: 'numeric' }) };
  }
  if (nombre === 'anio') return { desde: h.getFullYear() + '-01-01', hasta: isoDia(h), etiqueta: 'Año ' + h.getFullYear() };
  const i = new Date(h.getFullYear(), h.getMonth(), 1);
  return { desde: isoDia(i), hasta: isoDia(h), etiqueta: i.toLocaleDateString('es-CR', { month: 'long', year: 'numeric' }) };
}
/** "1 factura" / "3 facturas" */
function plural(n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); }
function fechaCorta(s) { if (!s) return '—'; const d = String(s); return d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(2, 4); }
function fechaHora(s) { if (!s) return '—'; const d = String(s).replace('T', ' '); return fechaCorta(d) + ' ' + d.slice(11, 16); }
function diasHasta(iso) { if (!iso) return null; const h = new Date(); h.setHours(0, 0, 0, 0); return Math.round((new Date(iso + 'T00:00:00') - h) / 86400000); }

/* ---------------- Avisos ---------------- */
function toast(m, k, sub) {
  k = k || 'ok';
  const t = el('div', { class: 'toast ' + k }, [
    el('span', { class: 'ti' }, icon(k === 'err' ? 'warn' : 'check', 20)),
    el('div', { style: 'min-width:0' }, [el('div', { class: 'tt2', text: m }), sub ? el('div', { class: 'ts', text: sub }) : null])
  ]);
  $('#toasts').appendChild(t);
  const cerrar = () => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 320); };
  t.addEventListener('click', cerrar);
  setTimeout(cerrar, k === 'err' ? 5000 : 2800);
  return t;
}

/** Ejecuta una llamada al sistema y muestra el error de forma clara si falla. */
async function intentar(fn, titulo) {
  try { return await fn(); }
  catch (e) { toast(titulo || 'No se pudo completar', 'err', String((e && e.message) || e).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')); return undefined; }
}

/* ---------------- Ventanas (modales) ---------------- */
function abrirModal(nodo) {
  const fondo = el('div', { class: 'modal-bg', onclick: (e) => { if (e.target === fondo) cerrarModal(); } }, [nodo]);
  $('#modalRoot').appendChild(fondo);
  const primero = nodo.querySelector('input:not([type=hidden]),select,textarea');
  if (primero) setTimeout(() => primero.focus(), 40);
  return fondo;
}
function cerrarModal() { const r = $('#modalRoot'); if (r.lastChild) r.removeChild(r.lastChild); }
const hayModal = () => !!$('#modalRoot').lastChild;

/**
 * Confirmación dentro de la app (sin cuadros del sistema).
 * opciones: { peligro, aceptar, pedirTexto: 'Motivo', escribir: 'RESTAURAR' }
 * Devuelve el texto escrito (o true) si acepta; null si cancela.
 */
function confirmar(titulo, mensaje, opciones = {}) {
  return new Promise((resolver) => {
    const campo = opciones.pedirTexto || opciones.escribir ? el('input', { placeholder: opciones.escribir ? 'Escriba ' + opciones.escribir : opciones.pedirTexto }) : null;
    const listo = (v) => { cerrarModal(); resolver(v); };
    const aceptar = () => {
      if (opciones.escribir && campo.value.trim().toUpperCase() !== opciones.escribir) { campo.focus(); toast('Escriba ' + opciones.escribir + ' para confirmar', 'err'); return; }
      if (opciones.pedirTexto && !campo.value.trim()) { campo.focus(); toast('Complete: ' + opciones.pedirTexto, 'err'); return; }
      listo(campo ? campo.value.trim() : true);
    };
    const m = el('div', { class: 'modal narrow' }, [
      el('h2', { text: titulo }),
      el('div', { style: 'color:var(--ink-2);white-space:pre-line', text: mensaje }),
      campo ? el('div', { class: 'campo', style: 'margin-top:14px' }, [el('label', { text: opciones.pedirTexto || 'Confirmación' }), campo]) : null,
      el('div', { class: 'modal-acc' }, [
        el('button', { class: 'btn btn--ghost', onclick: () => listo(null) }, 'Cancelar'),
        el('button', { class: 'btn ' + (opciones.peligro ? 'btn--danger-ghost' : 'btn--accent'), onclick: aceptar }, opciones.aceptar || 'Aceptar')
      ])
    ]);
    if (campo) campo.addEventListener('keydown', (e) => { if (e.key === 'Enter') aceptar(); });
    abrirModal(m);
  });
}

/* ---------------- Formularios ---------------- */
function campo(etiqueta, control, ayuda) {
  return el('div', { class: 'campo' }, [el('label', { text: etiqueta }), control, ayuda ? el('div', { class: 'mini', style: 'margin-top:4px', text: ayuda }) : null]);
}
function selector(opciones, valor) {
  const s = el('select');
  for (const o of opciones) { const [v, t] = Array.isArray(o) ? o : [o, o]; s.appendChild(el('option', { value: String(v), text: t })); }
  if (valor != null) s.value = String(valor);
  return s;
}
const TARIFAS = [[13, '13 % (general)'], [4, '4 %'], [2, '2 %'], [1, '1 % (canasta básica)'], [0, 'Exento']];
const TIPOS_ID = [['01', 'Cédula física'], ['02', 'Cédula jurídica'], ['03', 'DIMEX'], ['04', 'NITE'], ['05', 'Extranjero']];
const MEDIOS = { efectivo: ['Efectivo', 'cash'], tarjeta: ['Tarjeta', 'card'], sinpe: ['SINPE', 'phone'] };
const NOMBRE_TIPO = { '01': 'Factura', '03': 'Nota de crédito', '04': 'Tiquete' };
const ESTADO_HACIENDA = { pendiente: ['Pendiente de envío', ''], enviado: ['Enviado', 'pill--accent'], aceptado: ['Aceptado', 'pill--green'], rechazado: ['Rechazado', 'pill--red'], error: ['Error de envío', 'pill--amber'] };

function stat(etiqueta, valor, pie, opciones = {}) {
  return el('div', { class: 'stat glass' + (opciones.destacado ? ' stat--destacado' : '') }, [
    el('div', { class: 'k' }, etiqueta), el('div', { class: 'v', text: valor }), pie ? el('div', { class: 'foot' }, pie) : null
  ]);
}
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
