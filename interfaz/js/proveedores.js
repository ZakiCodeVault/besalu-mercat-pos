/**
 * proveedores.js — Ficha de proveedores y sus productos (en Compras, F3).
 *
 *  - Cada proveedor guarda sus datos y la lista de productos que se le
 *    compran con su costo (sin IVA) y, si lo usa, su propio código.
 *  - La lista crece sola con cada compra; aquí se arma o se corrige a mano.
 *  - En la factura de compra y en la orden se elige el proveedor y sus datos
 *    se completan solos (enlazarProveedor); al escanear un producto suyo ya
 *    trae el costo.
 */
const Proveedores = { texto: '', inactivos: false };

async function renderProveedores(root) {
  const lista = await intentar(() => BESALU.proveedores.listar({ texto: Proveedores.texto, incluirInactivos: Proveedores.inactivos }));
  if (!lista) return;
  root.appendChild(el('div', { class: 'toolbar' }, [
    el('div', { class: 'search', style: 'max-width:320px;min-width:200px;flex:1' }, [icon('search', 18),
      el('input', { placeholder: 'Nombre o cédula…', value: Proveedores.texto, style: 'padding-left:40px', oninput: debounce((e) => { Proveedores.texto = e.target.value; renderCompras(); }, 300) })]),
    el('label', { class: 'chk' }, [el('input', { type: 'checkbox', checked: Proveedores.inactivos, onchange: (e) => { Proveedores.inactivos = e.target.checked; renderCompras(); } }), 'Ver inactivos']),
    el('button', { class: 'btn btn--accent', onclick: () => fichaProveedor(null) }, [icon('plus', 17), 'Nuevo proveedor'])
  ]));
  const tb = el('tbody');
  if (!lista.length) {
    tb.appendChild(el('tr', {}, el('td', { colspan: 6, class: 'mini', style: 'text-align:center;padding:30px',
      text: Proveedores.texto ? 'Ningún proveedor coincide con la búsqueda.' : 'Todavía no hay proveedores. Se guardan solos al registrar una compra, o agréguelos con "Nuevo proveedor".' })));
  }
  for (const p of lista) {
    tb.appendChild(el('tr', { class: 'clic' + (p.activo ? '' : ' tachado'), onclick: () => fichaProveedor(p.id) }, [
      el('td', {}, [el('div', { style: 'font-weight:600', text: p.nombre }), el('div', { class: 'mini', text: p.nombre_comercial || p.contacto || '' })]),
      el('td', { class: 'mini', text: p.identificacion }),
      el('td', { class: 'mini' }, [el('div', { text: p.telefono || '—' }), p.correo ? el('div', { text: p.correo }) : null]),
      el('td', { class: 'der', text: String(p.productos) }),
      el('td', { class: 'mini', text: p.ultima_compra ? fechaCorta(p.ultima_compra) : '—' }),
      el('td', {}, el('span', { class: 'pill ' + (p.activo ? 'pill--green' : ''), text: p.activo ? 'Activo' : 'Inactivo' }))
    ]));
  }
  root.appendChild(el('div', { class: 'card pad0 glass' }, el('div', { class: 'tabla-wrap' }, el('table', {}, [
    el('thead', {}, el('tr', {}, ['Proveedor', 'Identificación', 'Contacto', 'Productos', 'Última compra', 'Estado'].map((t, i) => el('th', { text: t, class: i === 3 ? 'der' : '' })))), tb]))));
}

/* ---------------- Ficha del proveedor ---------------- */
async function fichaProveedor(id) {
  const p = id ? await intentar(() => BESALU.proveedores.obtener(id)) : null;
  if (id && !p) return;
  const f = p || { tipo_id: '02', identificacion: '', nombre: '', nombre_comercial: '', telefono: '', correo: '', contacto: '', direccion: '', notas: '', dias_credito: 0, productos: [], usos: 0 };
  const lineas = f.productos.map((x) => ({ producto_id: x.producto_id, costo: x.costo, codigo_proveedor: x.codigo_proveedor, ultima_compra: x.ultima_compra, activo: x.activo }));
  let ocupado = false;

  const tipo = selector(TIPOS_ID, f.tipo_id);
  const ident = el('input', { value: f.identificacion, placeholder: 'Sin guiones' });
  if (f.usos) { tipo.disabled = true; ident.disabled = true; }
  const nombre = el('input', { value: f.nombre, placeholder: 'Como sale en la factura' });
  const comercial = el('input', { value: f.nombre_comercial, placeholder: 'Opcional' });
  const telefono = el('input', { value: f.telefono, inputmode: 'tel' });
  const correo = el('input', { value: f.correo, type: 'email' });
  const contacto = el('input', { value: f.contacto, placeholder: 'Agente o vendedor' });
  const credito = el('input', { value: String(f.dias_credito || 0), inputmode: 'numeric', style: 'max-width:120px' });
  const direccion = el('input', { value: f.direccion });
  const notas = el('input', { value: f.notas, placeholder: 'Días de visita, condiciones…' });

  const buscar = el('input', { list: 'dl-productos-prov', placeholder: 'Escanee o escriba el código o nombre del producto…', style: 'padding-left:40px' });
  const listaProd = el('datalist', { id: 'dl-productos-prov' }, App.catalogo.map((x) => el('option', { value: x.codigo + ' — ' + x.nombre })));
  const cuerpo = el('tbody');
  const productoDe = (pid) => App.catalogo.find((x) => x.id === pid) || f.productos.find((x) => x.producto_id === pid);

  function agregar() {
    const t = buscar.value.trim();
    if (!t) return;
    const cod = t.split(' — ')[0].trim();
    const x = App.catalogo.find((q) => q.codigo === cod) || App.catalogo.find((q) => q.nombre.toLowerCase() === t.toLowerCase());
    buscar.value = '';
    if (!x) { toast('Producto no encontrado', 'err', 'Si es nuevo, créelo en Inventario o regístrelo con una compra'); return; }
    if (lineas.some((l) => l.producto_id === x.id)) { toast('"' + x.nombre + '" ya está en la lista', 'ok'); return; }
    lineas.unshift({ producto_id: x.id, costo: x.costo, codigo_proveedor: '', ultima_compra: '', activo: 1 });
    pintar();
    buscar.focus();
  }
  buscar.addEventListener('change', agregar);
  buscar.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); agregar(); } });

  function pintar() {
    cuerpo.innerHTML = '';
    if (!lineas.length) cuerpo.appendChild(el('tr', {}, el('td', { colspan: 6, class: 'mini', style: 'text-align:center;padding:20px', text: 'Sin productos todavía: agréguelos aquí o se agregan solos al registrar una compra de este proveedor.' })));
    lineas.forEach((l, i) => {
      const x = productoDe(l.producto_id) || { nombre: '(producto)', codigo: '', tarifa_iva: 0, precio: 0 };
      const costo = el('input', { inputmode: 'decimal', value: aColonesTexto(l.costo || 0), style: 'width:110px;text-align:right' });
      const codigo = el('input', { value: l.codigo_proveedor || '', placeholder: 'Opcional', style: 'width:120px' });
      const margen = el('td', { class: 'der mini' });
      const pintarMargen = () => { const m = margenDe(x.precio, x.tarifa_iva, l.costo); margen.textContent = m == null ? '—' : (m > 0 ? '+' : '') + m + '%'; margen.style.color = m == null ? '' : m > 0 ? 'var(--pos)' : 'var(--neg)'; };
      costo.addEventListener('input', () => { l.costo = aCentimos(costo.value); pintarMargen(); });
      codigo.addEventListener('input', () => { l.codigo_proveedor = codigo.value.trim(); });
      pintarMargen();
      cuerpo.appendChild(el('tr', { class: x.activo === 0 || l.activo === 0 ? 'tachado' : '' }, [
        el('td', {}, [el('div', { style: 'font-weight:600', text: x.nombre }), el('div', { class: 'mini', text: x.codigo + (l.ultima_compra ? ' · última compra ' + fechaCorta(l.ultima_compra) : '') })]),
        el('td', {}, codigo), el('td', {}, costo),
        el('td', { class: 'der mini', text: money(x.precio) + ' · IVA ' + x.tarifa_iva + '%' }), margen,
        el('td', {}, el('button', { class: 'icon-btn icon-btn--danger', title: 'Quitar de la lista', onclick: () => { lineas.splice(i, 1); pintar(); } }, icon('trash', 16)))
      ]));
    });
  }

  const datos = () => ({
    id: p ? p.id : undefined, tipo_id: tipo.value, identificacion: ident.value, nombre: nombre.value, nombre_comercial: comercial.value,
    telefono: telefono.value, correo: correo.value, contacto: contacto.value, direccion: direccion.value, notas: notas.value,
    dias_credito: parseInt(credito.value || '0', 10) || 0,
    productos: lineas.map((l) => ({ producto_id: l.producto_id, costo: l.costo, codigo_proveedor: l.codigo_proveedor }))
  });
  async function guardar(despues) {
    if (ocupado) return null;
    ocupado = true;
    const r = await intentar(() => BESALU.proveedores.guardar(datos()), 'No se pudo guardar el proveedor');
    ocupado = false;
    if (!r) return null;
    cerrarModal();
    toast('Proveedor guardado', 'ok', r.nombre + ' · ' + plural(r.productos.length, 'producto', 'productos'));
    if (App.vista === 'compras') renderCompras();
    if (despues) despues(r);
    return r;
  }
  async function eliminar() {
    const usado = p.usos > 0;
    const ok = await confirmar(usado ? 'Desactivar proveedor' : 'Borrar proveedor', usado
      ? p.nombre + ' tiene compras u órdenes registradas: se desactiva (deja de aparecer al elegir proveedor) y su historia queda igual. Vuelve a activarse solo si se registra otra compra suya.'
      : 'Se borrará ' + p.nombre + ' y su lista de productos. No afecta el inventario.', { peligro: true, aceptar: usado ? 'Desactivar' : 'Borrar' });
    if (!ok) return;
    const r = await intentar(() => BESALU.proveedores.eliminar(p.id), 'No se pudo');
    if (!r) return;
    cerrarModal();
    toast(r.desactivado ? 'Proveedor desactivado' : 'Proveedor borrado', 'ok', p.nombre);
    if (App.vista === 'compras') renderCompras();
  }
  const aProveedorDeFormulario = (r) => ({ tipo_id: r.tipo_id, identificacion: r.identificacion, nombre: r.nombre, correo: r.correo });

  abrirModal(el('div', { class: 'modal ancho', 'data-proveedor': p ? String(p.id) : 'nuevo' }, [
    el('div', { class: 'card-t' }, [el('h2', { text: p ? p.nombre : 'Nuevo proveedor' }), el('button', { class: 'icon-btn', onclick: cerrarModal }, icon('x', 18))]),
    listaProd,
    el('div', { class: 'g3' }, [campo('Tipo', tipo), campo('Identificación', ident, f.usos ? 'No se cambia: ya tiene compras u órdenes' : null), campo('Nombre', nombre)]),
    el('div', { class: 'g3' }, [campo('Nombre comercial', comercial), campo('Teléfono', telefono), campo('Correo', correo)]),
    el('div', { class: 'g3' }, [campo('Contacto', contacto), campo('Días de crédito', credito), campo('Dirección', direccion)]),
    campo('Notas', notas),
    el('div', { class: 'hseccion', style: 'margin-top:14px' }, [
      el('b', { text: 'Productos que se le compran' }),
      el('div', { class: 'mini', text: 'Con su costo sin IVA. Al registrar una compra de este proveedor, al escanear el producto ya trae este costo (y se actualiza solo con cada compra).' }),
      el('div', { style: 'display:flex;gap:8px;margin:8px 0' }, [
        el('div', { class: 'search', style: 'flex:1' }, [icon('search', 18), buscar]),
        el('button', { class: 'btn btn--ghost', onclick: agregar }, [icon('plus', 16), 'Agregar'])]),
      el('div', { class: 'tabla-wrap lineas-compra', style: 'max-height:320px' }, el('table', {}, [
        el('thead', {}, el('tr', {}, ['Producto', 'Código del proveedor', 'Costo sin IVA', 'Precio de venta', 'Margen', ''].map((t, i) => el('th', { text: t, class: i === 3 || i === 4 ? 'der' : '' })))), cuerpo]))]),
    el('div', { class: 'modal-acc' }, [
      p ? el('button', { class: 'btn btn--danger-ghost', style: 'margin-right:auto', onclick: eliminar }, [icon('trash', 16), p.usos ? 'Desactivar' : 'Borrar']) : null,
      p ? el('button', { class: 'btn btn--ghost', onclick: () => guardar((r) => editarOrden(null, { proveedor: aProveedorDeFormulario(r) })) }, 'Nueva orden') : null,
      p ? el('button', { class: 'btn btn--ghost', onclick: () => guardar((r) => formularioCompra({ proveedor: aProveedorDeFormulario(r), fecha: isoDia(new Date()), lineas: [] })) }, [icon('truck', 16), 'Registrar compra']) : null,
      el('button', { class: 'btn btn--pos', onclick: () => guardar() }, [icon('check', 17), 'Guardar'])])
  ]));
  pintar();
  if (!p) ident.focus();
}

/** Margen sobre el costo: precio con IVA → base sin IVA, comparada con el costo sin IVA. */
function margenDe(precio, tarifa, costo) {
  if (!(costo > 0) || !(precio > 0)) return null;
  return Math.round((precio / (1 + (tarifa || 0) / 100) - costo) / costo * 100);
}

/**
 * Liga los campos de proveedor de un formulario (tipo, identificación, nombre)
 * con los proveedores guardados: al escribir o elegir el nombre o la cédula se
 * completan los demás y se cargan sus productos.
 * @returns {{ listas: HTMLElement[], actual: () => object|null, cargar: (ident) => Promise }}
 */
function enlazarProveedor({ tipo, ident, nombre, proveedores, alCargar }) {
  const sufijo = Math.random().toString(36).slice(2, 8);
  const listaIds = el('datalist', { id: 'dl-prov-id-' + sufijo }, proveedores.map((p) => el('option', { value: p.identificacion, text: p.nombre })));
  const listaNombres = el('datalist', { id: 'dl-prov-nom-' + sufijo }, proveedores.map((p) => el('option', { value: p.nombre, text: p.identificacion })));
  ident.setAttribute('list', listaIds.id);
  nombre.setAttribute('list', listaNombres.id);
  let actual = null;
  const limpio = (v) => String(v || '').replace(/[^\dA-Za-z]/g, '').toUpperCase();
  async function cargar(identificacion) {
    const p = proveedores.find((x) => x.identificacion === limpio(identificacion));
    if (!p) { if (actual) { actual = null; if (alCargar) alCargar(null); } return null; }
    if (actual && actual.id === p.id) return actual;
    const ficha = await intentar(() => BESALU.proveedores.obtener(p.id));
    if (!ficha) return null;
    actual = ficha;
    ident.value = ficha.identificacion; nombre.value = ficha.nombre; tipo.value = ficha.tipo_id;
    if (alCargar) alCargar(ficha);
    return ficha;
  }
  ident.addEventListener('change', () => cargar(ident.value));
  nombre.addEventListener('change', () => {
    const t = nombre.value.trim().toLowerCase();
    const p = proveedores.find((x) => x.nombre.toLowerCase() === t);   // solo el nombre exacto (el de la lista)
    if (p) cargar(p.identificacion);
  });
  return { listas: [listaIds, listaNombres], actual: () => actual, cargar };
}
