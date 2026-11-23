/**
 * ordenes.js — Órdenes de compra a proveedores (en Compras, F3).
 *
 *  - Borrador: se arma y se corrige libremente (o se borra).
 *  - Emitida: tiene número (OC-00001), se manda al proveedor en PDF y ya no cambia.
 *  - Recepción: lo que llega se registra como factura de compra ligada a la
 *    orden (ver formularioCompra en compras.js): suma al inventario y la orden
 *    muestra cuánto falta. Se puede recibir en varias entregas.
 *  - Si no va a llegar el resto: "Cerrar con faltante". Si no llegó nada: "Cancelar".
 */
const Ordenes = { filtro: 'abiertas', texto: '' };
const ESTADO_OC = {
  borrador: ['Borrador', ''], emitida: ['Emitida', 'pill--accent'], parcial: ['Recibida en parte', 'pill--amber'],
  recibida: ['Recibida', 'pill--green'], cerrada: ['Cerrada con faltante', ''], cancelada: ['Cancelada', 'pill--red']
};
const FILTROS_OC = [['abiertas', 'Abiertas'], ['borrador', 'Borradores'], ['recibida', 'Recibidas'], ['terminadas', 'Cerradas'], ['todas', 'Todas']];

function pasaFiltro(o) {
  switch (Ordenes.filtro) {
    case 'abiertas': return o.estado_visible === 'emitida' || o.estado_visible === 'parcial';
    case 'borrador': return o.estado_visible === 'borrador';
    case 'recibida': return o.estado_visible === 'recibida';
    case 'terminadas': return o.estado_visible === 'cerrada' || o.estado_visible === 'cancelada';   // "Cerradas": con faltante o canceladas
    default: return true;
  }
}

function pillOrden(estado) {
  const [t, c] = ESTADO_OC[estado] || [estado, ''];
  return el('span', { class: 'pill ' + c, text: t });
}

/** Lista de órdenes (se dibuja dentro de la pantalla de Compras). */
async function renderOrdenes(root) {
  const lista = await intentar(() => BESALU.ordenes.listar({ texto: Ordenes.texto, limite: 500 }));
  if (!lista) return;
  const hoy = isoDia(new Date());
  const abiertas = lista.filter((o) => o.estado_visible === 'emitida' || o.estado_visible === 'parcial');
  const atrasadas = abiertas.filter((o) => o.fecha_esperada && o.fecha_esperada <= hoy);

  root.appendChild(el('div', { class: 'toolbar' }, [
    el('div', { class: 'segmento' }, FILTROS_OC.map(([k, t]) => el('button', { class: Ordenes.filtro === k ? 'sel' : '', onclick: () => { Ordenes.filtro = k; renderCompras(); } }, t))),
    el('div', { class: 'search', style: 'max-width:260px;min-width:180px;flex:1' }, [icon('search', 18),
      el('input', { placeholder: 'Proveedor o número…', value: Ordenes.texto, style: 'padding-left:40px', oninput: debounce((e) => { Ordenes.texto = e.target.value; renderCompras(); }, 300) })]),
    el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [
      el('button', { class: 'btn btn--ghost', onclick: () => editarOrden(null, { sugerir: true }) }, [icon('warn', 16), 'Pedir lo que falta']),
      el('button', { class: 'btn btn--accent', onclick: () => editarOrden(null) }, [icon('plus', 17), 'Nueva orden']),
      el('button', { class: 'btn btn--ghost btn--sm', onclick: () => exportarCsv('ordenes') }, [icon('download', 16), 'Excel'])])
  ]));
  root.appendChild(el('div', { class: 'stats' }, [
    stat([icon('truck', 15), 'Órdenes abiertas'], String(abiertas.length), el('span', { class: 'mini', text: plural(abiertas.filter((o) => o.estado_visible === 'parcial').length, 'recibida en parte', 'recibidas en parte') })),
    stat([icon('clock', 15), 'Entrega vencida o para hoy'], String(atrasadas.length), el('span', { class: 'mini', text: atrasadas.length ? atrasadas.slice(0, 3).map((o) => o.numero_texto).join(' · ') : 'Al día' })),
    stat([icon('doc', 15), 'Borradores'], String(lista.filter((o) => o.estado === 'borrador').length), el('span', { class: 'mini', text: 'Sin emitir: no cuentan como pedido' }))
  ]));

  const tb = el('tbody');
  const filtradas = lista.filter(pasaFiltro);
  if (!filtradas.length) {
    tb.appendChild(el('tr', {}, el('td', { colspan: 7, class: 'mini', style: 'text-align:center;padding:30px',
      text: lista.length ? 'No hay órdenes en este filtro.' : 'Todavía no hay órdenes de compra. Cree una con "Nueva orden" o "Pedir lo que falta".' })));
  }
  for (const o of filtradas) {
    const fecha = o.emitida_en || o.creado_en;
    const vencida = (o.estado_visible === 'emitida' || o.estado_visible === 'parcial') && o.fecha_esperada && o.fecha_esperada <= hoy;
    tb.appendChild(el('tr', { class: 'clic' + (o.estado === 'cancelada' ? ' tachado' : ''), onclick: () => verOrden(o.id) }, [
      el('td', { style: 'font-weight:700', text: o.numero_texto }),
      el('td', {}, [el('div', { style: 'font-weight:600', text: o.proveedor }), el('div', { class: 'mini', text: plural(o.lineas, 'producto', 'productos') })]),
      el('td', { class: 'mini', text: fechaCorta(String(fecha).slice(0, 10)) }),
      el('td', { class: 'mini', style: vencida ? 'color:var(--neg);font-weight:700' : '', text: o.fecha_esperada ? fechaCorta(o.fecha_esperada) : '—' }),
      el('td', { style: 'min-width:120px' }, o.estado === 'borrador' ? el('span', { class: 'mini', text: '—' })
        : el('div', {}, [el('div', { class: 'barra' }, el('i', { style: 'width:' + o.avance + '%' })), el('div', { class: 'mini', text: o.avance + ' % recibido' })])),
      el('td', { class: 'der', style: 'font-weight:700', text: money(o.total) }),
      el('td', {}, pillOrden(o.estado_visible))
    ]));
  }
  root.appendChild(el('div', { class: 'card pad0 glass' }, el('div', { class: 'tabla-wrap' }, el('table', {}, [
    el('thead', {}, el('tr', {}, ['Orden', 'Proveedor', 'Fecha', 'Entrega', 'Avance', 'Total', 'Estado'].map((t, i) => el('th', { text: t, class: i === 5 ? 'der' : '' })))), tb]))));
}

/* ---------------- Editor de borradores ---------------- */
/**
 * @param {number|null} id borrador existente o null para uno nuevo
 * @param {object} [opciones] { sugerir: true } empieza con los productos bajo el mínimo;
 *   { proveedor: {tipo_id, identificacion, nombre} } empieza con ese proveedor elegido
 */
async function editarOrden(id, opciones = {}) {
  const [orden, proveedores, camino] = await Promise.all([
    id ? intentar(() => BESALU.ordenes.obtener(id)) : null,
    intentar(() => BESALU.proveedores.listar()), intentar(() => BESALU.ordenes.enCamino())]);
  if (id && !orden) return;
  if (orden && orden.estado !== 'borrador') { verOrden(id); return; }
  const enCamino = camino || {};
  const productoDe = (pid) => App.catalogo.find((p) => p.id === pid);
  const estado = { lineas: orden ? orden.lineas.map((l) => ({ producto_id: l.producto_id, cantidad: l.cantidad, costo: l.costo_unitario })) : [] };
  let ocupado = false;

  const inicial = orden ? { tipo_id: orden.proveedor_tipo_id, identificacion: orden.proveedor_identificacion, nombre: orden.proveedor_nombre } : (opciones.proveedor || {});
  const provTipo = selector(TIPOS_ID, inicial.tipo_id || '02');
  const provId = el('input', { value: inicial.identificacion || '', placeholder: 'Cédula del proveedor' });
  const provNombre = el('input', { value: inicial.nombre || '', placeholder: 'Escriba o elija el proveedor' });
  let delProveedor = new Map();   // producto_id → costo de la lista del proveedor elegido
  const enlace = enlazarProveedor({ tipo: provTipo, ident: provId, nombre: provNombre, proveedores: proveedores || [], alCargar: (f) => {
    delProveedor = new Map(f ? f.productos.map((x) => [x.producto_id, x]) : []);
  } });
  const proveedorElegido = () => enlace.actual();
  const esperada = el('input', { type: 'date', value: orden ? orden.fecha_esperada : '' });
  const notas = el('input', { value: orden ? orden.notas : '', placeholder: 'Opcional: condiciones, horario de entrega…' });

  const buscar = el('input', { list: 'dl-productos-oc', placeholder: 'Escanee o escriba el código o nombre del producto…', style: 'padding-left:40px' });
  const listaProd = el('datalist', { id: 'dl-productos-oc' }, App.catalogo.map((p) => el('option', { value: p.codigo + ' — ' + p.nombre })));
  const cuerpo = el('tbody');
  const totales = el('div', { class: 'totales-compra' });

  function agregarProducto(p, cantidadSugerida, costo) {
    const ya = estado.lineas.find((l) => l.producto_id === p.id);
    if (ya) { toast('"' + p.nombre + '" ya está en la orden', 'ok', 'Cambie su cantidad en la tabla'); return false; }
    const deProv = delProveedor.get(p.id);
    estado.lineas.push({ producto_id: p.id, cantidad: cantidadSugerida || (deProv && deProv.ultima_cantidad > 0 ? deProv.ultima_cantidad : 1), costo: costo != null ? costo : deProv ? deProv.costo : p.costo });
    return true;
  }
  function agregarDesdeBuscador() {
    const texto = buscar.value.trim();
    if (!texto) return;
    const cod = texto.split(' — ')[0].trim();
    const p = App.catalogo.find((x) => x.codigo === cod) || App.catalogo.find((x) => x.nombre.toLowerCase() === texto.toLowerCase());
    if (!p) { toast('Producto no encontrado', 'err', 'Elíjalo de la lista; si es nuevo, créelo primero en Inventario'); return; }
    buscar.value = '';
    if (agregarProducto(p)) {
      pintar();
      const c = estado.lineas[estado.lineas.length - 1]._cant;   // a la cantidad del recién agregado (Enter vuelve al buscador)
      if (c) { c.focus(); c.select(); return; }
    }
    buscar.focus();
  }
  buscar.addEventListener('change', agregarDesdeBuscador);
  buscar.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); agregarDesdeBuscador(); } });

  async function sugerir() {
    const prov = proveedorElegido() || await enlace.cargar(provId.value);
    const s = await intentar(() => BESALU.ordenes.sugerencias(prov ? { proveedor_id: prov.id } : {}));
    if (!s) return;
    let n = 0;
    for (const x of s) { const p = productoDe(x.producto_id); if (p && !estado.lineas.some((l) => l.producto_id === p.id)) { agregarProducto(p, x.sugerido, x.costo); n++; } }
    toast(n ? plural(n, 'producto agregado', 'productos agregados') : 'No hay productos por pedir', 'ok',
      n ? 'Los que están bajo su mínimo, contando lo que ya viene en camino' + (prov ? ' (de la lista de este proveedor)' : '') : '');
    pintar();
  }

  function pintar() {
    cuerpo.innerHTML = '';
    let sub = 0, iva = 0;
    if (!estado.lineas.length) cuerpo.appendChild(el('tr', {}, el('td', { colspan: 6, class: 'mini', style: 'text-align:center;padding:22px', text: 'Agregue productos con el buscador o con "Agregar los que faltan".' })));
    estado.lineas.forEach((l, i) => {
      const p = productoDe(l.producto_id) || { nombre: '(producto desactivado)', codigo: '', stock: 0, stock_minimo: 0, tarifa_iva: 13 };
      const s = Math.round((l.costo || 0) * (l.cantidad || 0));
      const imp = Math.round(s * (p.tarifa_iva || 0) / 100);
      sub += s; iva += imp;
      const cant = el('input', { inputmode: 'decimal', value: String(l.cantidad).replace('.', ','), style: 'width:90px;text-align:right' });
      l._cant = cant;
      cant.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); cant.dispatchEvent(new Event('change')); buscar.focus(); } });
      const costo = el('input', { inputmode: 'decimal', value: aColonesTexto(l.costo || 0), style: 'width:120px;text-align:right' });
      const total = el('td', { class: 'der', text: money(s + imp) });
      cant.addEventListener('change', () => { l.cantidad = leerNumero(cant.value); pintar(); });
      costo.addEventListener('change', () => { l.costo = aCentimos(costo.value); pintar(); });
      const camino = enCamino[p.id] ? ' · ' + cantidad(enCamino[p.id]) + ' en camino' : '';
      cuerpo.appendChild(el('tr', { class: !(l.cantidad > 0) ? 'fila-revisar' : '' }, [
        el('td', {}, [el('div', { style: 'font-weight:600', text: p.nombre }),
          el('div', { class: 'mini', text: p.codigo + ' · hay ' + cantidad(p.stock) + (p.stock_minimo ? ' (mín. ' + cantidad(p.stock_minimo) + ')' : '') + camino })]),
        el('td', {}, cant), el('td', {}, costo), el('td', { class: 'der mini', text: (p.tarifa_iva || 0) + '%' }), total,
        el('td', {}, el('button', { class: 'icon-btn icon-btn--danger', title: 'Quitar', onclick: () => { estado.lineas.splice(i, 1); pintar(); } }, icon('trash', 16)))
      ]));
    });
    totales.innerHTML = '';
    totales.append(el('div', {}, ['Subtotal ', el('b', { text: money(sub) })]), el('div', {}, ['IVA ', el('b', { text: money(iva) })]),
      el('div', { class: 'grande' }, ['Total estimado ', el('b', { text: money(sub + iva) })]));
  }

  function datosOrden() {
    return {
      id: orden ? orden.id : undefined, fecha_esperada: esperada.value, notas: notas.value,
      proveedor: { tipo_id: provTipo.value, identificacion: provId.value, nombre: provNombre.value },
      lineas: estado.lineas.map((l) => ({ producto_id: l.producto_id, cantidad: l.cantidad, costo_unitario: l.costo }))
    };
  }
  async function guardar(emitirla, boton) {
    if (ocupado) return;
    if (!provId.value.trim() || !provNombre.value.trim()) { toast('Indique el proveedor (identificación y nombre)', 'err'); provId.focus(); return; }
    if (emitirla && !estado.lineas.length) { toast('Agregue al menos un producto', 'err'); return; }
    const mala = estado.lineas.findIndex((l) => !(l.cantidad > 0));
    if (mala >= 0) { toast('Revise la cantidad del producto ' + (mala + 1), 'err'); return; }
    if (emitirla) {
      const total = estado.lineas.reduce((s, l) => { const p = productoDe(l.producto_id) || {}; const x = Math.round(l.costo * l.cantidad); return s + x + Math.round(x * (p.tarifa_iva || 0) / 100); }, 0);
      const ok = await confirmar('Emitir orden de compra', 'Se emitirá la orden a ' + provNombre.value.trim() + ' con ' + plural(estado.lineas.length, 'producto', 'productos') +
        ' por ' + money(total) + ' (estimado).\n\nRecibe su número y ya no se puede modificar. Después puede guardarla en PDF para enviarla.', { aceptar: 'Emitir orden' });
      if (!ok) return;
    }
    ocupado = true; if (boton) boton.disabled = true;
    let o = await intentar(() => BESALU.ordenes.guardar(datosOrden()), 'No se pudo guardar la orden');
    if (o && emitirla) o = await intentar(() => BESALU.ordenes.emitir(o.id), 'No se pudo emitir la orden');
    ocupado = false; if (boton) boton.disabled = false;
    if (!o) return;
    cerrarModal();
    toast(emitirla ? 'Orden ' + o.numero_texto + ' emitida' : 'Borrador guardado', 'ok', o.proveedor_nombre + ' · ' + money(o.total));
    refrescarTrasOrden();
    if (emitirla) verOrden(o.id);
  }
  async function eliminar() {
    if (!(await confirmar('Borrar borrador', 'Se borrará este borrador de orden de compra. No afecta el inventario.', { peligro: true, aceptar: 'Borrar' }))) return;
    if (!(await intentar(() => BESALU.ordenes.eliminar(orden.id), 'No se pudo borrar'))) return;
    cerrarModal();
    toast('Borrador borrado');
    refrescarTrasOrden();
  }

  const botonEmitir = el('button', { class: 'btn btn--pos', onclick: (e) => guardar(true, e.currentTarget) }, [icon('check', 17), 'Emitir orden']);
  abrirModal(el('div', { class: 'modal ancho' }, [
    el('div', { class: 'card-t' }, [el('h2', { text: orden ? 'Borrador de orden de compra' : 'Nueva orden de compra' }), el('button', { class: 'icon-btn', onclick: cerrarModal }, icon('x', 18))]),
    ...enlace.listas, listaProd,
    el('div', { class: 'g3' }, [campo('Nombre del proveedor', provNombre), campo('Identificación del proveedor', provId), campo('Tipo', provTipo)]),
    el('div', { class: 'g2' }, [campo('Entrega esperada', esperada), campo('Notas para el proveedor', notas)]),
    el('div', { style: 'display:flex;gap:8px;margin:6px 0 10px' }, [
      el('div', { class: 'search', style: 'flex:1' }, [icon('search', 18), buscar]),
      el('button', { class: 'btn btn--ghost', onclick: agregarDesdeBuscador }, [icon('plus', 16), 'Agregar']),
      el('button', { class: 'btn btn--ghost', onclick: sugerir, title: 'Productos bajo su mínimo, contando lo que ya viene en camino' }, [icon('warn', 16), 'Agregar los que faltan'])]),
    el('div', { class: 'tabla-wrap lineas-compra' }, el('table', {}, [
      el('thead', {}, el('tr', {}, ['Producto', 'Cantidad', 'Costo u. sin IVA', 'IVA', 'Total', ''].map((t, i) => el('th', { text: t, class: i === 3 || i === 4 ? 'der' : '' })))), cuerpo])),
    totales,
    el('div', { class: 'note', text: 'El borrador se puede cambiar cuando quiera. Al emitirla, la orden recibe su número y queda fija; la mercadería entra al inventario cuando se registra su recepción.' }),
    el('div', { class: 'modal-acc' }, [
      orden ? el('button', { class: 'btn btn--danger-ghost', style: 'margin-right:auto', onclick: eliminar }, [icon('trash', 16), 'Borrar borrador']) : null,
      el('button', { class: 'btn btn--ghost', onclick: (e) => guardar(false, e.currentTarget) }, 'Guardar borrador'), botonEmitir])
  ]));
  if (inicial.identificacion) await enlace.cargar(inicial.identificacion);
  if (opciones.sugerir) await sugerir(); else pintar();
}

/* ---------------- Detalle de una orden emitida ---------------- */
async function verOrden(id) {
  const o = await intentar(() => BESALU.ordenes.obtener(id));
  if (!o) return;
  if (o.estado === 'borrador') { editarOrden(id); return; }
  const abierta = o.estado === 'emitida';
  const hayPendiente = o.lineas.some((l) => l.pendiente > 0);
  const algoRecibido = o.lineas.some((l) => l.recibido > 0);
  const tb = el('tbody', {}, o.lineas.map((l) => el('tr', {}, [
    el('td', {}, [el('div', { style: 'font-weight:600', text: l.descripcion }), el('div', { class: 'mini', text: l.producto_codigo })]),
    el('td', { class: 'der', text: cantidad(l.cantidad) }),
    el('td', { class: 'der', style: l.recibido > l.cantidad ? 'color:var(--warn);font-weight:700' : '', text: cantidad(l.recibido) }),
    el('td', { class: 'der', style: l.pendiente > 0 ? 'font-weight:700' : 'color:var(--ink-3)', text: cantidad(l.pendiente) }),
    el('td', { class: 'der', text: money(l.costo_unitario) }), el('td', { class: 'der', text: money(l.total_linea) })])));
  const recepciones = o.recepciones.length ? el('div', { class: 'hseccion' }, [el('b', { text: 'Recepciones' }),
    ...o.recepciones.map((r) => el('div', { class: 'mini clic', style: 'cursor:pointer' + (r.estado === 'anulada' ? ';text-decoration:line-through' : ''),
      onclick: () => { cerrarModal(); verCompra(r.id); },
      text: fechaCorta(r.fecha) + ' · Factura ' + r.numero_documento + ' · ' + money(r.total) + (r.estado === 'anulada' ? ' · anulada: ' + r.anulada_razon : '') }))]) : null;

  const acciones = [];
  if (abierta && algoRecibido && hayPendiente) acciones.push(el('button', { class: 'btn btn--ghost', style: 'margin-right:auto', onclick: () => cerrarOrden(o) }, 'Cerrar con faltante'));
  if (abierta && !algoRecibido) acciones.push(el('button', { class: 'btn btn--danger-ghost', style: 'margin-right:auto', onclick: () => cancelarOrden(o) }, 'Cancelar orden'));
  acciones.push(el('button', { class: 'btn btn--ghost', onclick: () => pdfOrden(o) }, [icon('download', 16), 'PDF para el proveedor']));
  if (abierta && hayPendiente) acciones.push(el('button', { class: 'btn btn--pos', onclick: () => { cerrarModal(); recibirOrden(o); } }, [icon('truck', 17), 'Recibir mercadería']));
  else acciones.push(el('button', { class: 'btn btn--accent', onclick: cerrarModal }, 'Cerrar'));

  abrirModal(el('div', { class: 'modal ancho', 'data-orden': String(o.id) }, [
    el('div', { class: 'card-t' }, [el('h2', { text: 'Orden de compra ' + o.numero_texto }),
      el('div', { style: 'display:flex;gap:8px;align-items:center' }, [pillOrden(o.estado_visible), el('button', { class: 'icon-btn', onclick: cerrarModal }, icon('x', 18))])]),
    el('div', { class: 'mini', style: 'margin-bottom:10px', text: o.proveedor_nombre + ' · ' + o.proveedor_identificacion + ' · emitida ' + fechaHora(o.emitida_en) +
      (o.fecha_esperada ? ' · entrega esperada ' + fechaCorta(o.fecha_esperada) : '') }),
    o.motivo ? el('div', { class: 'note', style: 'margin:0 0 12px', html: '<b>' + (o.estado === 'cancelada' ? 'Cancelada' : 'Cerrada') + '</b> el ' + fechaHora(o.terminada_en) + ': ' + o.motivo }) : null,
    o.notas ? el('div', { class: 'mini', style: 'margin-bottom:10px', text: 'Notas: ' + o.notas }) : null,
    el('div', { style: 'margin-bottom:12px' }, [el('div', { class: 'barra' }, el('i', { style: 'width:' + o.avance + '%' })), el('div', { class: 'mini', style: 'margin-top:4px', text: o.avance + ' % recibido' })]),
    el('div', { class: 'tabla-wrap', style: 'border:1px solid var(--line)' }, el('table', {}, [
      el('thead', {}, el('tr', {}, ['Producto', 'Pedido', 'Recibido', 'Falta', 'Costo u.', 'Total'].map((t, i) => el('th', { text: t, class: i ? 'der' : '' })))), tb])),
    el('div', { class: 'totales-compra' }, [el('div', {}, ['Subtotal ', el('b', { text: money(o.subtotal) })]), el('div', {}, ['IVA ', el('b', { text: money(o.impuesto) })]),
      el('div', { class: 'grande' }, ['Total estimado ', el('b', { text: money(o.total) })])]),
    recepciones,
    el('div', { class: 'modal-acc' }, acciones)
  ]));
}

/** Lo pedido cambia lo que se ve en Compras y lo "en camino" de Inventario. */
function refrescarTrasOrden() {
  if (App.vista === 'compras') renderCompras();
  else if (App.vista === 'inventario') renderInventario();
}

async function pdfOrden(o) {
  const r = await intentar(() => BESALU.ordenes.pdf(o.id), 'No se pudo generar el PDF');
  if (r) toast('PDF guardado', 'ok', r.ruta);
}

async function cerrarOrden(o) {
  const falta = o.lineas.filter((l) => l.pendiente > 0).map((l) => l.descripcion + ': ' + cantidad(l.pendiente)).join('\n');
  const motivo = await confirmar('Cerrar con faltante', 'Lo que falta ya no se va a esperar:\n' + falta + '\n\nLo recibido queda como está.', { pedirTexto: 'Motivo (p. ej. el proveedor no tiene más)', aceptar: 'Cerrar orden' });
  if (!motivo) return;
  if (!(await intentar(() => BESALU.ordenes.cerrar(o.id, motivo), 'No se pudo cerrar'))) return;
  cerrarModal();
  toast('Orden ' + o.numero_texto + ' cerrada');
  refrescarTrasOrden();
}

async function cancelarOrden(o) {
  const motivo = await confirmar('Cancelar orden', 'La orden ' + o.numero_texto + ' quedará cancelada (no se recibió nada). Queda registrada, pero ya no cuenta como pedido.',
    { peligro: true, pedirTexto: 'Motivo de la cancelación', aceptar: 'Cancelar orden' });
  if (!motivo) return;
  if (!(await intentar(() => BESALU.ordenes.cancelar(o.id, motivo), 'No se pudo cancelar'))) return;
  cerrarModal();
  toast('Orden ' + o.numero_texto + ' cancelada');
  refrescarTrasOrden();
}

/** Abre el formulario de compra precargado con lo que falta de la orden. */
function recibirOrden(o) {
  formularioCompra({
    proveedor: { tipo_id: o.proveedor_tipo_id, identificacion: o.proveedor_identificacion, nombre: o.proveedor_nombre },
    fecha: isoDia(new Date()), lineas: lineasDeOrden(o)
  }, o);
}
