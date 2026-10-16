/**
 * caja.js — Pantalla de venta (F1).
 *
 * Flujo: escanear/buscar → carrito → (cliente opcional para factura) →
 * medio de pago → Cobrar. La venta la calcula y guarda el sistema en una sola
 * transacción (precios de la base, consecutivo, inventario).
 */
const Caja = { carrito: [], metodo: 'efectivo', cliente: null, hecho: null, cobrando: false };

function productoDe(id) { return App.catalogo.find((p) => p.id === id); }
function totalCarrito() {
  return Caja.carrito.reduce((s, l) => { const p = productoDe(l.producto_id); return s + (p ? Math.round(p.precio * l.cantidad) : 0); }, 0);
}

function renderCaja() {
  const root = $('#v-caja');
  root.innerHTML = '';
  if (!App.ajustes.cedula) {
    root.appendChild(el('div', { class: 'alert amber glass' }, [icon('warn', 16), el('div', {}, [
      el('span', { class: 't', text: 'Falta la cédula del negocio: sin ella no se pueden emitir comprobantes.' }),
      el('button', { class: 'btn btn--sm btn--accent', onclick: () => go('ajustes') }, 'Configurar en Ajustes')])]));
  }
  if (!App.turno) {
    root.appendChild(el('div', { class: 'cerrada-aviso glass' }, [
      icon('lock', 30), el('h2', { text: 'La caja está cerrada', style: 'margin:6px 0 4px' }),
      el('div', { class: 'mini', style: 'margin-bottom:14px', text: 'Abrí la caja con el fondo inicial para empezar a vender.' }),
      el('button', { class: 'btn btn--pos btn--lg', onclick: modalAbrirCaja }, [icon('unlock', 18), 'Abrir caja'])]));
    return;
  }

  const buscador = el('input', { id: 'cod', placeholder: 'Escaneá el código de barras o escribí el nombre…', autocomplete: 'off' });
  const sugerencias = el('div', { class: 'sugerencias', id: 'sugerencias', hidden: true });
  const tbody = el('tbody', { id: 'carrito' });
  root.appendChild(el('div', { class: 'caja' }, [
    el('div', { style: 'min-width:0' }, [
      el('div', { class: 'escaner' }, [
        el('div', { class: 'search' }, [icon('search', 19), buscador, sugerencias]),
        el('button', { class: 'btn btn--accent', onclick: () => agregarPorTexto(buscador.value) }, [icon('plus', 18), 'Agregar'])]),
      el('div', { class: 'card pad0 glass cart' }, [el('table', {}, [
        el('thead', {}, el('tr', {}, [el('th', { text: 'Producto' }), el('th', { text: 'Precio', class: 'der' }), el('th', { text: 'Cantidad' }), el('th', { text: 'Subtotal', class: 'der' }), el('th', {})])),
        tbody])]),
      el('div', { class: 'atajos' }, [
        el('span', { html: '<kbd>Enter</kbd> agregar' }), el('span', { html: '<kbd>Enter</kbd> vacío · ir a cobrar' }),
        el('span', { html: '<kbd>F12</kbd> cobrar' }), el('span', { html: '<kbd>Esc</kbd> cancelar venta' })])
    ]),
    el('div', { class: 'cobro', id: 'cobro' })
  ]));

  buscador.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { const b = $('#sugerencias button'); if (b) { e.preventDefault(); b.focus(); } return; }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (buscador.value.trim()) agregarPorTexto(buscador.value);
    else if (Caja.carrito.length) { const p = $('#inp-paga'); if (p) p.focus(); else cobrar(); }
  });
  buscador.addEventListener('input', debounce(() => mostrarSugerencias(buscador.value), 120));
  setTimeout(() => buscador.focus(), 30);
  pintarCarrito();
}

function mostrarSugerencias(texto) {
  const caja = $('#sugerencias');
  if (!caja) return;
  const t = texto.trim().toLowerCase();
  if (t.length < 2 || /^\d{6,}$/.test(t)) { caja.hidden = true; return; }
  const encontrados = App.catalogo.filter((p) => p.nombre.toLowerCase().includes(t) || p.codigo.includes(t)).slice(0, 8);
  caja.innerHTML = '';
  for (const p of encontrados) {
    caja.appendChild(el('button', { class: 'sug', onclick: () => { agregar(p); $('#cod').value = ''; caja.hidden = true; $('#cod').focus(); } }, [
      el('span', { text: p.nombre }), el('span', { class: 'mini', text: money(p.precio) + ' · ' + cantidad(p.stock) + ' disp.' })]));
  }
  caja.hidden = !encontrados.length;
}

function agregarPorTexto(texto) {
  const t = String(texto || '').trim();
  if (!t) return;
  const exacto = App.catalogo.find((p) => p.codigo === t);
  const candidatos = exacto ? [exacto] : App.catalogo.filter((p) => p.nombre.toLowerCase().includes(t.toLowerCase()));
  if (candidatos.length === 1) { agregar(candidatos[0]); $('#cod').value = ''; $('#sugerencias').hidden = true; return; }
  if (!candidatos.length) toast('No se encontró "' + t + '"', 'err', 'Revisá el código o agregalo en Inventario');
  else mostrarSugerencias(t);
}

function agregar(p, cant = 1) {
  const linea = Caja.carrito.find((l) => l.producto_id === p.id);
  const nueva = Math.round(((linea ? linea.cantidad : 0) + cant) * 1000) / 1000;
  if (!App.ajustes.permitirStockNegativo && nueva > p.stock) { toast('Stock insuficiente: ' + p.nombre, 'err', 'Disponible: ' + cantidad(p.stock)); return; }
  if (linea) linea.cantidad = nueva; else Caja.carrito.push({ producto_id: p.id, cantidad: cant });
  Caja.hecho = null;
  pintarCarrito();
}

function cambiarCantidad(i, nueva) {
  const l = Caja.carrito[i], p = productoDe(l.producto_id);
  nueva = Math.round(nueva * 1000) / 1000;
  if (nueva <= 0) { Caja.carrito.splice(i, 1); pintarCarrito(); return; }
  if (!App.ajustes.permitirStockNegativo && p && nueva > p.stock) { toast('Stock insuficiente', 'err', 'Disponible: ' + cantidad(p.stock)); return; }
  l.cantidad = nueva;
  pintarCarrito();
}

function editarCantidad(i) {
  const l = Caja.carrito[i], p = productoDe(l.producto_id);
  const inp = el('input', { inputmode: 'decimal', value: String(l.cantidad).replace('.', ','), style: 'text-align:right;font-size:20px;font-weight:700' });
  const listo = () => { const n = leerNumero(inp.value); cerrarModal(); cambiarCantidad(i, n); };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') listo(); });
  abrirModal(el('div', { class: 'modal narrow' }, [el('h2', { text: 'Cantidad' }), el('div', { class: 'mini', style: 'margin-bottom:10px', text: p ? p.nombre + ' (' + p.unidad + ')' : '' }),
    campo('Cantidad (puede tener decimales, p. ej. 0,750 kg)', inp),
    el('div', { class: 'modal-acc' }, [el('button', { class: 'btn btn--ghost', onclick: cerrarModal }, 'Cancelar'), el('button', { class: 'btn btn--accent', onclick: listo }, 'Aplicar')])]));
  setTimeout(() => inp.select(), 50);
}

function pintarCarrito() {
  const tb = $('#carrito');
  if (!tb) return;
  tb.innerHTML = '';
  if (!Caja.carrito.length) {
    tb.appendChild(el('tr', {}, el('td', { colspan: 5 }, el('div', { class: 'cart-empty' }, [icon('bag', 40), el('div', { text: 'Escaneá el primer producto' })]))));
  } else {
    Caja.carrito.forEach((l, i) => {
      const p = productoDe(l.producto_id);
      if (!p) return;
      tb.appendChild(el('tr', {}, [
        el('td', {}, [el('div', { style: 'font-weight:600', text: p.nombre }), el('div', { class: 'mini', text: p.codigo + (p.tarifa_iva ? ' · IVA ' + p.tarifa_iva + '%' : ' · exento') })]),
        el('td', { class: 'der', text: money(p.precio) }),
        el('td', {}, el('div', { class: 'cant' }, [
          el('button', { title: 'Quitar uno', onclick: () => cambiarCantidad(i, l.cantidad - 1) }, icon('minus', 15)),
          el('button', { class: 'n', title: 'Escribir cantidad', onclick: () => editarCantidad(i), text: cantidad(l.cantidad) }),
          el('button', { title: 'Agregar uno', onclick: () => cambiarCantidad(i, l.cantidad + 1) }, icon('plus', 15))])),
        el('td', { class: 'der', text: money(Math.round(p.precio * l.cantidad)) }),
        el('td', { class: 'der' }, el('button', { class: 'icon-btn icon-btn--danger', title: 'Quitar', onclick: () => { Caja.carrito.splice(i, 1); pintarCarrito(); } }, icon('trash', 17)))
      ]));
    });
  }
  pintarCobro();
}

function pintarCobro() {
  const panel = $('#cobro');
  if (!panel) return;
  panel.innerHTML = '';
  if (Caja.hecho) { panel.appendChild(panelVentaHecha(Caja.hecho)); return; }

  const total = totalCarrito();
  const articulos = Caja.carrito.reduce((s, l) => s + l.cantidad, 0);
  const cliente = el('button', { class: 'cli-bar', onclick: modalCliente }, [
    el('span', { style: 'display:flex;align-items:center;gap:8px;min-width:0' }, [icon('user', 16), el('span', { class: 'cli-nm', text: Caja.cliente ? Caja.cliente.nombre : 'Consumidor final' })]),
    el('span', { class: 'mini', text: Caja.cliente ? 'Factura · cambiar' : 'Facturar a cliente' })]);
  const medios = el('div', { class: 'metodos' }, Object.entries(MEDIOS).map(([k, [nombre, ic]]) =>
    el('button', { class: Caja.metodo === k ? 'sel' : '', onclick: () => { Caja.metodo = k; pintarCobro(); } }, [icon(ic, 19), nombre])));
  const caja = el('div', { class: 'card glass', style: 'display:flex;flex-direction:column;gap:13px' }, [
    el('div', { class: 'total-box' }, [el('div', { class: 'k', text: 'Total a pagar' }), el('div', { class: 'v', text: money(total) }), el('div', { class: 'n', text: cantidad(articulos) + ' artículo(s)' })]),
    cliente, medios]);

  if (Caja.metodo === 'efectivo') {
    const paga = el('input', { id: 'inp-paga', inputmode: 'decimal', placeholder: 'Monto recibido', style: 'text-align:right;font-size:20px;font-weight:800;padding:12px 14px' });
    const aviso = el('div', { class: 'paga-hint' });
    paga.addEventListener('input', () => {
      const x = aCentimos(paga.value);
      if (!paga.value) aviso.textContent = '';
      else if (x < total) { aviso.textContent = 'Faltan ' + money(total - x); aviso.className = 'paga-hint falta'; }
      else { aviso.textContent = 'Cambio ' + money(x - total); aviso.className = 'paga-hint'; }
    });
    paga.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); cobrar(); } });
    caja.appendChild(el('div', {}, [el('label', { for: 'inp-paga', text: 'Efectivo recibido (vacío = monto exacto)' }), paga, aviso]));
  }
  const btn = el('button', { class: 'btn btn--pos btn--lg btn--block', onclick: cobrar }, 'Cobrar · F12');
  btn.disabled = !Caja.carrito.length || Caja.cobrando || !App.ajustes.cedula;
  caja.appendChild(btn);
  caja.appendChild(el('button', { class: 'btn btn--danger-ghost btn--block', onclick: cancelarVenta }, 'Cancelar · Esc'));
  panel.appendChild(caja);
}

function panelVentaHecha(c) {
  const titulo = c.medio_pago === 'efectivo' ? (c.cambio > 0 ? 'Cambio a entregar' : 'Pago exacto') : 'Cobrado con ' + MEDIOS[c.medio_pago][0];
  return el('div', { class: 'card glass', style: 'text-align:center' }, [
    el('div', { class: 'done-ok' }, icon('check', 26)),
    el('div', { class: 'mini', text: NOMBRE_TIPO[c.tipo] + ' ' + c.consecutivo.slice(-10).replace(/^0+/, '') + ' registrado' }),
    el('div', { style: 'font-size:12px;color:var(--ink-2);margin-top:8px', text: titulo }),
    el('div', { class: 'cambio-grande', text: c.medio_pago === 'efectivo' ? (c.cambio > 0 ? money(c.cambio) : '—') : money(c.total_comprobante) }),
    el('div', { style: 'display:flex;gap:8px;margin-top:6px' }, [
      el('button', { class: 'btn btn--ghost btn--block', onclick: () => imprimir(armarComprobante(c)) }, [icon('printer', 17), 'Imprimir']),
      el('button', { class: 'btn btn--accent btn--block', onclick: nuevaVenta }, 'Nueva venta')])
  ]);
}

function cancelarVenta() {
  if (!Caja.carrito.length) return;
  Caja.carrito = []; Caja.cliente = null;
  pintarCarrito();
  toast('Venta cancelada');
}

function nuevaVenta() {
  Caja.hecho = null; Caja.metodo = 'efectivo'; Caja.cliente = null;
  pintarCarrito();
  const c = $('#cod'); if (c) c.focus();
}

async function cobrar() {
  if (!Caja.carrito.length || Caja.hecho || Caja.cobrando) return;
  const total = totalCarrito();
  let pago = total;
  if (Caja.metodo === 'efectivo') {
    const inp = $('#inp-paga');
    pago = inp && inp.value.trim() ? aCentimos(inp.value) : total;
    if (pago < total) { const a = $('.paga-hint'); if (a) { a.textContent = 'El efectivo recibido es menor al total'; a.className = 'paga-hint falta'; } return; }
  }
  Caja.cobrando = true;
  pintarCobro();
  const c = await intentar(() => BESALU.ventas.emitir({
    lineas: Caja.carrito.map((l) => ({ producto_id: l.producto_id, cantidad: l.cantidad })),
    medio_pago: Caja.metodo, pago, receptor: Caja.cliente
  }), 'No se pudo registrar la venta');
  Caja.cobrando = false;
  if (!c) { pintarCobro(); return; }
  Caja.hecho = c; Caja.carrito = []; Caja.cliente = null;
  await App.recargarCatalogo();
  pintarCarrito();
  toast(NOMBRE_TIPO[c.tipo] + ' registrado', 'ok', c.consecutivo + ' · ' + money(c.total_comprobante));
  if (App.ajustes.imprimirAlCobrar) imprimir(armarComprobante(c), { automatico: true });
}

function modalAbrirCaja() {
  const fondo = el('input', { inputmode: 'decimal', value: '50000', style: 'text-align:right;font-size:18px;font-weight:700' });
  const abrir = async () => {
    const t = await intentar(() => BESALU.caja.abrir(aCentimos(fondo.value)), 'No se pudo abrir la caja');
    if (!t) return;
    App.turno = t;
    cerrarModal(); actualizarIndicadorCaja(); toast('Caja abierta', 'ok', 'Fondo ' + money(t.fondo));
    go('caja');
  };
  fondo.addEventListener('keydown', (e) => { if (e.key === 'Enter') abrir(); });
  abrirModal(el('div', { class: 'modal narrow' }, [el('h2', { text: 'Abrir caja' }),
    el('div', { class: 'mini', style: 'margin-bottom:14px', text: 'Efectivo con el que arranca el turno (fondo de caja).' }),
    campo('Fondo inicial (₡)', fondo),
    el('div', { class: 'modal-acc' }, [el('button', { class: 'btn btn--ghost', onclick: cerrarModal }, 'Cancelar'), el('button', { class: 'btn btn--pos', onclick: abrir }, 'Abrir caja')])]));
}

/** Datos del cliente para emitir FACTURA (sin cliente = tiquete). */
function modalCliente() {
  const c = Caja.cliente || {};
  const tipo = selector(TIPOS_ID, c.tipo_id || '01');
  const id = el('input', { value: c.identificacion || '', placeholder: 'Número sin guiones' });
  const nombre = el('input', { value: c.nombre || '' });
  const correo = el('input', { value: c.correo || '', placeholder: 'Para enviarle la factura' });
  const lista = el('div', { class: 'sugerencias-fijas' });
  const buscar = debounce(async () => {
    const t = id.value.trim() || nombre.value.trim();
    lista.innerHTML = '';
    if (t.length < 3) return;
    const encontrados = await intentar(() => BESALU.ventas.buscarClientes(t));
    for (const x of encontrados || []) lista.appendChild(el('button', { class: 'sug', onclick: () => { tipo.value = x.tipo_id; id.value = x.identificacion; nombre.value = x.nombre; correo.value = x.correo; lista.innerHTML = ''; } },
      [el('span', { text: x.nombre }), el('span', { class: 'mini', text: x.identificacion })]));
  }, 200);
  id.addEventListener('input', buscar); nombre.addEventListener('input', buscar);
  const guardar = () => {
    if (!id.value.trim() || !nombre.value.trim()) { toast('Para facturar se necesita identificación y nombre', 'err'); return; }
    Caja.cliente = { tipo_id: tipo.value, identificacion: id.value.trim(), nombre: nombre.value.trim(), correo: correo.value.trim() };
    cerrarModal(); pintarCobro();
  };
  abrirModal(el('div', { class: 'modal narrow' }, [el('h2', { text: 'Facturar a cliente' }),
    el('div', { class: 'mini', style: 'margin-bottom:12px', text: 'Sin cliente se emite un tiquete a consumidor final.' }),
    el('div', { class: 'g2' }, [campo('Tipo', tipo), campo('Identificación', id)]),
    campo('Nombre o razón social', nombre), lista, campo('Correo (opcional)', correo),
    el('div', { class: 'modal-acc' }, [
      el('button', { class: 'btn btn--ghost', onclick: () => { Caja.cliente = null; cerrarModal(); pintarCobro(); } }, 'Consumidor final'),
      el('button', { class: 'btn btn--accent', onclick: guardar }, 'Usar para la factura')])]));
}
