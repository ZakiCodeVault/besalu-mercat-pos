/**
 * app.js — Arranque, navegación y atajos de teclado.
 *
 * Estado compartido (App): ajustes del negocio, turno de caja y catálogo de
 * productos (en memoria para que escanear sea instantáneo).
 */
const App = { vista: 'caja', ajustes: {}, turno: null, catalogo: [], hacienda: null };

// `permiso`: la pantalla solo aparece para quien lo tiene (el sistema igual lo vuelve a revisar en cada operación)
const PANTALLAS = [
  { v: 'caja', ic: 'receipt', t: 'Caja', tecla: 'F1', titulo: 'Caja', permiso: 'vender', render: () => renderCaja() },
  { v: 'ventas', ic: 'history', t: 'Ventas', tecla: 'F2', titulo: 'Ventas emitidas', render: () => renderVentas() },
  { v: 'compras', ic: 'truck', t: 'Compras', tecla: 'F3', titulo: 'Compras (entradas)', permiso: 'compras', render: () => renderCompras() },
  { v: 'inventario', ic: 'box', t: 'Inventario', tecla: 'F4', titulo: 'Inventario', render: () => renderInventario() },
  { v: 'etiquetas', ic: 'tag', t: 'Etiquetas', tecla: 'F8', titulo: 'Etiquetas', permiso: 'etiquetas', render: () => renderEtiquetas() },
  { v: 'reportes', ic: 'chart', t: 'Reportes', tecla: 'F5', titulo: 'Reportes e IVA', permiso: 'reportes', render: () => renderReportes() },
  { v: 'cierre', ic: 'wallet', t: 'Cierre', tecla: 'F6', titulo: 'Cierre de caja', render: () => renderCierre() },
  { v: 'ajustes', ic: 'sliders', t: 'Ajustes', tecla: 'F7', titulo: 'Ajustes', permiso: 'ajustes', render: () => renderAjustes() }
];
const pantallaPermitida = (p) => !p.permiso || puedo(p.permiso);

App.recargarCatalogo = async function () {
  const lista = await intentar(() => BESALU.productos.listar());
  if (lista) App.catalogo = lista;
  pintarNavegacion();
};

/** Después de restaurar un respaldo: recarga todo desde la base. */
App.reiniciarEstado = async function () {
  const e = await intentar(() => BESALU.sistema.estado());
  if (e) {
    App.ajustes = e.ajustes; App.turno = e.turno; App.hacienda = e.hacienda; pintarIndicadorHacienda();
    if (e.integridad) App.integridad = e.integridad;
  }
  Caja.carrito = []; Caja.hecho = null; Caja.cliente = null;
  await App.recargarCatalogo();
  actualizarIndicadorCaja();
  go(App.vista);
};

function pintarNavegacion() {
  const nav = $('#nav');
  nav.innerHTML = '';
  const alertas = App.catalogo.filter((p) => p.stock < (p.stock_minimo > 0 ? p.stock_minimo : App.ajustes.stockMin)).length;
  for (const p of PANTALLAS.filter(pantallaPermitida)) {
    const b = el('button', { class: 'nav-btn' + (App.vista === p.v ? ' active' : ''), onclick: () => go(p.v), title: p.t + ' (' + p.tecla + ')' }, [icon(p.ic, 19), el('span', { class: 't', text: p.t })]);
    b.dataset.v = p.v;
    if (p.v === 'inventario' && alertas) b.appendChild(el('span', { class: 'badge', text: String(alertas) }));
    nav.appendChild(b);
  }
}

function go(v) {
  const p = PANTALLAS.find((x) => x.v === v && pantallaPermitida(x)) || PANTALLAS.find(pantallaPermitida) || PANTALLAS[0];
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
  if (p) { e.preventDefault(); if (pantallaPermitida(p)) go(p.v); return; }
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
  $('#shiftpill').onclick = () => (App.turno ? go('cierre') : modalAbrirCaja());
  reloj(); setInterval(reloj, 15000);
  iniciarAvisoActualizaciones();
  iniciarAvisoHacienda();
  // La revisión completa de la base corre aparte al abrir: avisa cuando termina si encontró algo
  if (BESALU.alRevisarBase) BESALU.alRevisarBase((v) => { App.integridad = v; if (v && !v.ok && Sesion.usuario) toast('Revise la integridad de los datos', 'err', v.problemas[0]); });
  // Cada persona entra con su usuario y su PIN; los datos se cargan ya adentro (ver entrar)
  await mostrarIngreso();
  requestAnimationFrame(() => BESALU.lista && BESALU.lista());   // para medir cuánto tarda en abrir
}

iniciar();
