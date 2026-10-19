/**
 * app.js — Arranque, navegación y atajos de teclado.
 *
 * Estado compartido (App): ajustes del negocio, turno de caja y catálogo de
 * productos (en memoria para que escanear sea instantáneo).
 */
const App = { vista: 'caja', ajustes: {}, turno: null, catalogo: [], hacienda: null };

const PANTALLAS = [
  { v: 'caja', ic: 'receipt', t: 'Caja', tecla: 'F1', titulo: 'Caja', render: () => renderCaja() },
  { v: 'ventas', ic: 'history', t: 'Ventas', tecla: 'F2', titulo: 'Ventas emitidas', render: () => renderVentas() },
  { v: 'compras', ic: 'truck', t: 'Compras', tecla: 'F3', titulo: 'Compras (entradas)', render: () => renderCompras() },
  { v: 'inventario', ic: 'box', t: 'Inventario', tecla: 'F4', titulo: 'Inventario', render: () => renderInventario() },
  { v: 'reportes', ic: 'chart', t: 'Reportes', tecla: 'F5', titulo: 'Reportes e IVA', render: () => renderReportes() },
  { v: 'cierre', ic: 'wallet', t: 'Cierre', tecla: 'F6', titulo: 'Cierre de caja', render: () => renderCierre() },
  { v: 'ajustes', ic: 'sliders', t: 'Ajustes', tecla: 'F7', titulo: 'Ajustes', render: () => renderAjustes() }
];

App.recargarCatalogo = async function () {
  const lista = await intentar(() => BESALU.productos.listar());
  if (lista) App.catalogo = lista;
  pintarNavegacion();
};

/** Después de restaurar un respaldo: recarga todo desde la base. */
App.reiniciarEstado = async function () {
  const e = await intentar(() => BESALU.sistema.estado());
  if (e) { App.ajustes = e.ajustes; App.turno = e.turno; App.hacienda = e.hacienda; pintarIndicadorHacienda(); }
  Caja.carrito = []; Caja.hecho = null; Caja.cliente = null;
  await App.recargarCatalogo();
  actualizarIndicadorCaja();
  go(App.vista);
};

function pintarNavegacion() {
  const nav = $('#nav');
  nav.innerHTML = '';
  const alertas = App.catalogo.filter((p) => p.stock < (p.stock_minimo > 0 ? p.stock_minimo : App.ajustes.stockMin)).length;
  for (const p of PANTALLAS) {
    const b = el('button', { class: 'nav-btn' + (App.vista === p.v ? ' active' : ''), onclick: () => go(p.v), title: p.t + ' (' + p.tecla + ')' }, [icon(p.ic, 19), el('span', { class: 't', text: p.t })]);
    b.dataset.v = p.v;
    if (p.v === 'inventario' && alertas) b.appendChild(el('span', { class: 'badge', text: String(alertas) }));
    nav.appendChild(b);
  }
}

function go(v) {
  const p = PANTALLAS.find((x) => x.v === v) || PANTALLAS[0];
  App.vista = p.v;
  $('#titulo').textContent = p.titulo;
  $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.v === p.v));
  $$('.vista').forEach((s) => s.classList.toggle('activa', s.id === 'v-' + p.v));
  p.render();
}

function actualizarIndicadorCaja() {
  const b = $('#shiftpill');
  if (App.turno) { b.className = 'shiftpill open'; b.innerHTML = '<span class="dot"></span>Caja abierta'; }
  else { b.className = 'shiftpill closed'; b.innerHTML = '<span class="dot"></span>Caja cerrada'; }
}

function reloj() {
  const d = new Date();
  $('#reloj').innerHTML = svg('clock', 15) + '<b>' + d.toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' }) +
    '</b><span class="fecha"> · ' + d.toLocaleDateString('es-CR', { weekday: 'short', day: 'numeric', month: 'short' }) + '</span>';
}

/* ---------------- Atajos de teclado ---------------- */
document.addEventListener('keydown', (e) => {
  if ($('#app').hidden) return;
  if (hayModal()) { if (e.key === 'Escape') cerrarModal(); return; }
  const p = PANTALLAS.find((x) => x.tecla === e.key);
  if (p) { e.preventDefault(); go(p.v); return; }
  if (App.vista !== 'caja') return;
  if (Caja.hecho) { if (e.key === 'F12' || e.key === 'Escape' || (e.key === 'Enter' && e.target.tagName !== 'BUTTON')) { e.preventDefault(); nuevaVenta(); } return; }
  if (e.key === 'F12') { e.preventDefault(); cobrar(); }
  else if (e.key === 'Escape') { e.preventDefault(); const s = $('#sugerencias'); if (s && !s.hidden) s.hidden = true; else cancelarVenta(); }
});

/* ---------------- Arranque ---------------- */
async function iniciar() {
  if (!window.BESALU) {
    document.body.innerHTML = '<p style="padding:40px;font-family:sans-serif">Esta aplicación debe abrirse desde el programa Besalú Mercat POS.</p>';
    return;
  }
  const estado = await intentar(() => BESALU.sistema.estado(), 'No se pudo abrir la base de datos');
  if (!estado) return;
  App.ajustes = estado.ajustes;
  App.turno = estado.turno;
  App.hacienda = estado.hacienda;
  await App.recargarCatalogo();
  $('#app').hidden = false;
  $('#shiftpill').onclick = () => (App.turno ? go('cierre') : modalAbrirCaja());
  actualizarIndicadorCaja();
  reloj(); setInterval(reloj, 15000);
  iniciarAvisoActualizaciones();
  iniciarAvisoHacienda();
  go(estado.ajustes.cedula ? 'caja' : 'ajustes');
  if (!estado.ajustes.cedula) toast('Bienvenido: complete los datos del negocio', 'ok', 'La cédula es necesaria para emitir comprobantes');
  if (estado.integridad && !estado.integridad.ok) toast('Revise la integridad de los datos', 'err', estado.integridad.problemas[0]);
}

iniciar();
