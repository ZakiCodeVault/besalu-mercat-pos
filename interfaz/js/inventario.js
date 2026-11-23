/**
 * inventario.js — Productos, existencias y kárdex (F4).
 *
 * El stock solo cambia con movimientos: compras, ventas, notas de crédito
 * y ajustes (con motivo). El kárdex muestra cada uno con su saldo.
 */
const Inventario = { texto: '', inactivos: false, camino: {} };
const TIPO_MOV = { inicial: ['Inventario inicial', 'pill--accent'], compra: ['Compra', 'pill--green'], venta: ['Venta', ''], nota_credito: ['Devolución', 'pill--green'], ajuste: ['Ajuste', 'pill--amber'], anulacion_compra: ['Anulación de compra', 'pill--red'] };

async function renderInventario() {
  const root = $('#v-inventario');
  const [productos, alertas, valor, camino] = await Promise.all([
    intentar(() => BESALU.productos.listar({ incluirInactivos: Inventario.inactivos })),
    intentar(() => BESALU.reportes.alertas()), intentar(() => BESALU.reportes.inventario()), intentar(() => BESALU.ordenes.enCamino())]);
  if (!productos) return;
  Inventario.camino = camino || {};
  root.innerHTML = '';

  if (alertas && alertas.bajos.length) root.appendChild(el('div', { class: 'alert red glass' }, [icon('warn', 16), el('div', {}, [
    el('span', { class: 't', text: alertas.bajos.length + ' con inventario bajo' }),
    el('div', { class: 'lista' }, alertas.bajos.slice(0, 12).map((p) => el('span', { class: 'it', text: p.nombre + ' · ' }, el('b', { text: cantidad(p.stock) + (Inventario.camino[p.id] ? ' (+' + cantidad(Inventario.camino[p.id]) + ' en camino)' : '') }))))]),
    el('button', { class: 'btn btn--ghost btn--sm', style: 'margin-left:auto;align-self:center', onclick: () => editarOrden(null, { sugerir: true }) }, 'Pedir lo que falta')]));
  if (alertas && alertas.porVencer.length) root.appendChild(el('div', { class: 'alert amber glass' }, [icon('clock', 16), el('div', {}, [
    el('span', { class: 't', text: alertas.porVencer.length + ' por vencer o vencidos' }),
    el('div', { class: 'lista' }, alertas.porVencer.slice(0, 12).map((p) => el('span', { class: 'it', html: p.nombre + ' · <b>' + (p.dias < 0 ? 'vencido' : p.dias + ' d') + '</b>' })))])]));

  const buscar = el('input', { placeholder: 'Buscar producto, código, SKU, marca o CABYS…', value: Inventario.texto, style: 'padding-left:40px' });
  const tb = el('tbody');
  const mas = el('div', { class: 'mas-filas' });
  // Se dibujan de a 200 (con miles de productos dibujar todos de una vez tarda): al bajar se agregan más
  const POR_TANDA = 200;
  let lista = [], dibujados = 0;
  const dibujarTanda = () => {
    const frag = document.createDocumentFragment();
    for (const p of lista.slice(dibujados, dibujados + POR_TANDA)) frag.appendChild(filaProducto(p));
    dibujados = Math.min(lista.length, dibujados + POR_TANDA);
    tb.appendChild(frag);
    mas.innerHTML = '';
    if (dibujados < lista.length) mas.appendChild(el('button', { class: 'btn btn--ghost btn--sm', onclick: dibujarTanda }, 'Mostrar más (' + (lista.length - dibujados) + ' de ' + lista.length + ')'));
  };
  const pintar = () => {
    const t = Inventario.texto.toLowerCase();
    tb.innerHTML = '';
    lista = productos.filter((p) => !t || p.nombre.toLowerCase().includes(t) || p.codigo.includes(t) || p.cabys.includes(t) ||
      (p.sku || '').toLowerCase().includes(t) || (p.marca || '').toLowerCase().includes(t));
    dibujados = 0;
    if (!lista.length) { mas.innerHTML = ''; tb.appendChild(el('tr', {}, el('td', { colspan: 8, class: 'mini', style: 'text-align:center;padding:30px', text: productos.length ? 'Sin resultados.' : 'Todavía no hay productos. Agréguelos con "Agregar producto" o registrando una compra.' }))); return; }
    dibujarTanda();
  };
  // Al acercarse al final de la lista, carga la siguiente tanda sola
  const vigia = new IntersectionObserver((e) => { if (e[0].isIntersecting && dibujados < lista.length) dibujarTanda(); }, { rootMargin: '400px' });
  vigia.observe(mas);
  buscar.addEventListener('input', () => { Inventario.texto = buscar.value; pintar(); });

  root.appendChild(el('div', { class: 'card glass' }, [
    el('div', { class: 'valor-inv' }, [
      el('span', { class: 'k', text: 'Valor del inventario al costo' }), el('span', { class: 'v', text: money(valor ? valor.valor_costo : 0) }),
      el('span', { class: 'u', text: (valor ? cantidad(valor.unidades) : 0) + ' unidades · a precio de venta ' + money(valor ? valor.valor_venta : 0) })]),
    el('div', { class: 'toolbar' }, [
      el('div', { class: 'search', style: 'max-width:320px;flex:1' }, [icon('search', 18), buscar]),
      el('label', { class: 'chk' }, [el('input', { type: 'checkbox', checked: Inventario.inactivos, onchange: (e) => { Inventario.inactivos = e.target.checked; renderInventario(); } }), 'Ver inactivos']),
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [
        el('button', { class: 'btn btn--ghost', onclick: () => editarOrden(null, { sugerir: true }), title: 'Orden de compra con los productos bajo su mínimo' }, [icon('truck', 17), 'Pedir lo que falta']),
        el('button', { class: 'btn btn--accent', onclick: () => modalProducto() }, [icon('plus', 18), 'Agregar producto']),
        el('button', { class: 'btn btn--ghost btn--sm', onclick: () => exportarCsv('inventario') }, [icon('download', 16), 'Excel'])])]),
    el('div', { class: 'tabla-wrap' }, el('table', { class: 'tabla-inv' }, [
      el('thead', {}, el('tr', {}, ['Producto', 'IVA', 'Costo', 'Precio', 'Margen', 'Existencia', 'Vence', ''].map((t, i) => el('th', { text: t, class: i > 0 && i < 7 ? 'der' : '' })))), tb])),
    mas
  ]));
  pintar();
}

function filaProducto(p) {
  const base = p.precio / (1 + p.tarifa_iva / 100);
  const margen = p.costo > 0 ? Math.round((base - p.costo) / p.costo * 100) : null;
  const d = diasHasta(p.vence);
  const bajo = p.stock < (p.stock_minimo > 0 ? p.stock_minimo : App.ajustes.stockMin);
  let vence = el('span', { class: 'mini', text: p.vence ? fechaCorta(p.vence) : '—' });
  if (d !== null && d < 0) vence = el('span', { class: 'pill pill--red', text: 'Vencido' });
  else if (d !== null && d <= App.ajustes.venceDias) vence = el('span', { class: 'pill pill--amber', text: d + ' d' });
  return el('tr', { class: p.activo ? '' : 'tachado' }, [
    el('td', { class: 'celda-producto' }, [el('div', { class: 'np', text: p.nombre }), el('div', { class: 'mini meta', title: p.codigo + (p.sku ? ' · SKU ' + p.sku : '') + (p.marca ? ' · ' + p.marca : '') + (p.cabys ? ' · CABYS ' + p.cabys : '') },
      p.codigo + (p.sku ? ' · ' + p.sku : '') + (p.marca ? ' · ' + p.marca : '') + (p.cabys ? '' : ' · sin CABYS')),
      App.hacienda && App.hacienda.activo && !/^\d{13}$/.test(p.cabys || '') ? el('span', { class: 'pill pill--red', style: 'margin-top:3px', text: 'Sin CABYS: no se puede vender' }) : null]),
    el('td', { class: 'der' }, el('span', { class: 'pill ' + (p.tarifa_iva === 13 ? '' : 'pill--accent'), text: p.tarifa_iva ? p.tarifa_iva + '%' : 'Exento' })),
    el('td', { class: 'der', text: money(p.costo) }),
    el('td', { class: 'der', text: money(p.precio) }),
    el('td', { class: 'der', style: 'font-weight:700;color:' + (margen == null ? 'var(--ink-3)' : margen > 0 ? 'var(--pos)' : 'var(--neg)'), text: margen == null ? '—' : (margen > 0 ? '+' : '') + margen + '%' }),
    el('td', { class: 'der' }, [el('span', { class: 'pill ' + (bajo ? 'pill--red' : ''), text: cantidad(p.stock) }),
      Inventario.camino[p.id] ? el('div', { class: 'mini', style: 'color:var(--accent-2)', title: 'Pedido en órdenes de compra emitidas y todavía no recibido', text: '+' + cantidad(Inventario.camino[p.id]) + ' en camino' }) : null]),
    el('td', { class: 'der' }, vence),
    el('td', { class: 'der acciones' }, [
      el('button', { class: 'icon-btn', title: 'Imprimir etiqueta', onclick: () => agregarEtiquetas([{ producto_id: p.id, copias: 1 }]) }, icon('tag', 18)),
      el('button', { class: 'icon-btn', title: 'Kárdex (entradas y salidas)', onclick: () => modalKardex(p) }, icon('list', 18)),
      el('button', { class: 'icon-btn', title: 'Ajustar existencia', onclick: () => modalAjuste(p) }, icon('boxplus', 18)),
      el('button', { class: 'icon-btn', title: 'Editar', onclick: () => modalProducto(p) }, icon('pencil', 18)),
      p.activo
        ? el('button', { class: 'icon-btn icon-btn--danger', title: 'Eliminar o desactivar', onclick: () => eliminarProducto(p) }, icon('trash', 18))
        : el('button', { class: 'icon-btn', title: 'Reactivar', onclick: async () => { if (await intentar(() => BESALU.productos.reactivar(p.id))) { await App.recargarCatalogo(); renderInventario(); } } }, icon('refresh', 18))
    ])
  ]);
}

function modalProducto(p) {
  const nuevo = !p;
  p = p || { codigo: '', nombre: '', cabys: '', unidad: 'Unid', tarifa_iva: App.ajustes.tarifaDefecto || 13, precio: 0, costo: 0, stock_minimo: 0, vence: '', sku: '', marca: '' };
  const sku = el('input', { value: p.sku || '', placeholder: 'Código interno (opcional)' });
  const marca = el('input', { value: p.marca || '', placeholder: 'Ej.: Dos Pinos', list: 'dl-marcas' });
  const listaMarcas = el('datalist', { id: 'dl-marcas' });
  const estadoLogo = el('span', { class: 'mini' });
  let marcas = [];
  const pintarLogo = () => {
    const m = marcas.find((x) => x.nombre.toLowerCase() === marca.value.trim().toLowerCase());
    estadoLogo.textContent = !marca.value.trim() ? 'Sin marca' : m && m.tiene_logo ? 'Con logo · sale en las etiquetas' : m ? 'Marca sin logo' : 'Marca nueva';
  };
  BESALU.marcas.listar().then((l) => { marcas = l || []; listaMarcas.innerHTML = ''; for (const m of marcas) listaMarcas.appendChild(el('option', { value: m.nombre })); pintarLogo(); }).catch(() => {});
  marca.addEventListener('input', pintarLogo);
  const botonLogo = el('button', { class: 'btn btn--ghost btn--sm', onclick: () => editorLogoMarca(marca.value, (r) => {
    const i = marcas.findIndex((x) => x.id === r.id);
    if (i >= 0) marcas[i] = Object.assign(marcas[i], r); else marcas.push(r);
    marca.value = r.nombre; pintarLogo();
  }) }, [icon('upload', 14), 'Logo de la marca…']);
  const codigo = el('input', { value: p.codigo, placeholder: 'Escanee el código de barras' });
  const nombre = el('input', { value: p.nombre });
  // Patrón: productos sin código de barras (a granel, de la casa) llevan un código interno en serie
  const internos = App.catalogo.map((x) => x.codigo).filter((c) => /[A-Za-z]/.test(c) && /\d$/.test(c));
  const botonInterno = el('button', { class: 'link-btn link-btn--campo', type: 'button', onclick: () => {
    codigo.value = Patrones.siguienteDeSerie(internos, Patrones.prefijoComun(internos) || 'BM-', 4); codigo.focus(); codigo.select();
  } }, '¿No tiene código de barras? Crear un código interno');
  const cabys = el('input', { value: p.cabys, placeholder: '13 dígitos', inputmode: 'numeric', maxlength: 13 });
  const unidad = selector([['Unid', 'Unidad'], ['kg', 'Kilogramo'], ['g', 'Gramo'], ['L', 'Litro'], ['mL', 'Mililitro'], ['m', 'Metro']], p.unidad);
  const tarifa = selector(TARIFAS, p.tarifa_iva);
  const costo = el('input', { inputmode: 'decimal', value: p.costo ? aColonesTexto(p.costo) : '', placeholder: '0' });
  // Patrón: el margen de lo que ya vende (de la misma marca si hay varios), en vez de un 30 % fijo
  const margenDe = (lista) => Patrones.mediana(lista.filter((x) => x.costo > 0 && x.precio > 0).map((x) => (x.precio / (1 + x.tarifa_iva / 100) - x.costo) / x.costo * 100));
  const margenSugerido = () => {
    const deMarca = App.catalogo.filter((x) => x.marca && p.marca && x.marca === p.marca);
    const m = margenDe(deMarca.length >= 3 ? deMarca : App.catalogo);
    return m == null || m < 1 || m > 300 ? 30 : Math.round(m);
  };
  const margen = el('input', { inputmode: 'decimal', value: String(margenSugerido()), style: 'text-align:right' });
  const precio = el('input', { inputmode: 'decimal', value: p.precio ? aColonesTexto(p.precio) : '', placeholder: '0', style: 'font-weight:700' });
  const stockIni = el('input', { inputmode: 'decimal', value: '0' });
  const minimo = el('input', { inputmode: 'decimal', value: String(p.stock_minimo || 0).replace('.', ',') });
  const vence = el('input', { type: 'date', value: p.vence || '' });
  const sugerido = el('div', { class: 'cv' }), detalle = el('div', { class: 'mini' }), ivaInfo = el('div', { class: 'mini', style: 'margin:-6px 0 12px' });

  const precioSug = () => Math.round(aCentimos(costo.value) * (1 + leerNumero(margen.value) / 100) * (1 + Number(tarifa.value) / 100) / 500) * 500;
  function calcular() {
    const c = aCentimos(costo.value), pr = aCentimos(precio.value), t = Number(tarifa.value);
    sugerido.textContent = money(precioSug());
    const base = pr / (1 + t / 100);
    const gan = Math.round(base - c);
    detalle.textContent = pr ? 'Con tu precio ganás ' + money(gan) + ' por unidad' + (c ? ' (' + Math.round(gan / c * 100) + '% sobre el costo)' : '') : 'Margen sobre el costo, sin IVA';
    detalle.style.color = pr && gan < 0 ? 'var(--neg)' : '';
    ivaInfo.textContent = t > 0 ? (pr ? 'El precio incluye IVA: base ' + money(Math.round(base)) + ' + IVA ' + money(pr - Math.round(base)) + ' (' + t + '%)' : 'El precio incluye ' + t + '% de IVA') : 'Producto exento de IVA';
  }
  [costo, margen, precio].forEach((x) => x.addEventListener('input', calcular));
  tarifa.addEventListener('change', calcular);

  const guardar = async () => {
    const datos = { codigo: codigo.value, nombre: nombre.value, cabys: cabys.value, unidad: unidad.value, tarifa_iva: Number(tarifa.value),
      precio: aCentimos(precio.value), costo: aCentimos(costo.value), stock_minimo: leerNumero(minimo.value), vence: vence.value,
      sku: sku.value, marca: marca.value };
    if (!datos.precio) { toast('Indique el precio de venta', 'err'); precio.focus(); return; }
    if (nuevo) datos.stock_inicial = leerNumero(stockIni.value);
    const r = await intentar(() => nuevo ? BESALU.productos.crear(datos) : BESALU.productos.actualizar(p.id, datos), 'No se pudo guardar el producto');
    if (!r) return;
    cerrarModal();
    await App.recargarCatalogo();
    toast(nuevo ? 'Producto agregado' : 'Cambios guardados', 'ok', r.nombre);
    renderInventario();
  };

  // Patrón: el SKU sigue la serie de la marca (o la más usada): LCH-001 → LCH-002
  sku.addEventListener('focus', () => {
    if (sku.value) return;
    const skus = App.catalogo.map((x) => x.sku).filter(Boolean);
    const deMarca = App.catalogo.filter((x) => x.sku && x.marca && x.marca.toLowerCase() === marca.value.trim().toLowerCase()).map((x) => x.sku);
    const pref = Patrones.prefijoComun(deMarca.length ? deMarca : skus);
    if (pref != null) { sku.value = Patrones.siguienteDeSerie(skus, pref); sku.select(); }
  });
  // Patrón: un producto parecido (misma primera palabra) ya tiene CABYS, IVA y unidad
  const parecido = el('div', { class: 'sugerencia-chip', hidden: true });
  const buscarParecido = () => {
    const palabra = nombre.value.trim().split(/\s+/)[0] || '';
    const q = palabra.length >= 4 && !cabys.value ? App.catalogo.find((x) => x.id !== p.id && /^\d{13}$/.test(x.cabys || '') && x.nombre.toLowerCase().startsWith(palabra.toLowerCase())) : null;
    parecido.hidden = !q;
    if (!q) return;
    parecido.innerHTML = '';
    parecido.append(el('span', { text: 'Igual que "' + q.nombre + '": CABYS ' + q.cabys + ' · IVA ' + q.tarifa_iva + '% · ' + q.unidad }),
      el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => { cabys.value = q.cabys; tarifa.value = String(q.tarifa_iva); unidad.value = q.unidad; parecido.hidden = true; calcular(); } }, 'Usar'));
  };
  nombre.addEventListener('input', debounce(buscarParecido, 250));
  abrirModal(el('div', { class: 'modal' }, [
    el('h2', { text: nuevo ? 'Agregar producto' : 'Editar producto' }),
    el('div', { class: 'g2' }, [el('div', {}, [campo('Código de barras', codigo), nuevo ? botonInterno : null]), campo('CABYS (Hacienda)', cabys)]),
    campo('Nombre', nombre), parecido,
    listaMarcas,
    el('div', { class: 'g2' }, [campo('SKU', sku), campo('Marca', marca)]),
    el('div', { style: 'display:flex;gap:10px;align-items:center;justify-content:flex-end;margin:-6px 0 12px' }, [estadoLogo, botonLogo]),
    el('div', { class: 'g2' }, [campo('Unidad', unidad), campo('Tarifa de IVA', tarifa)]),
    el('div', { class: 'g2' }, [campo('Costo sin IVA (₡)', costo, nuevo ? null : 'Se actualiza solo con cada compra (promedio)'), campo('Margen deseado %', margen)]),
    el('div', { class: 'calcbox' }, [el('div', { style: 'min-width:0' }, [el('div', { class: 'mini', text: 'Precio sugerido (con IVA)' }), sugerido, detalle]),
      el('button', { class: 'btn btn--ghost btn--sm', onclick: () => { precio.value = aColonesTexto(precioSug()); calcular(); } }, 'Usar')]),
    campo('Precio de venta con IVA (₡)', precio), ivaInfo,
    el('div', { class: 'g3' }, [nuevo ? campo('Existencia inicial', stockIni) : null, campo('Stock mínimo (alerta)', minimo), campo('Vence', vence)]),
    nuevo ? null : el('div', { class: 'note', html: 'La existencia no se edita aquí: cambia con <b>compras</b>, <b>ventas</b> o un <b>ajuste</b> (queda en el kárdex).' }),
    el('div', { class: 'modal-acc' }, [el('button', { class: 'btn btn--ghost', onclick: cerrarModal }, 'Cancelar'), el('button', { class: 'btn btn--accent', onclick: guardar }, nuevo ? 'Agregar' : 'Guardar')])
  ]));
  calcular();
}

function modalAjuste(p) {
  const contado = el('input', { inputmode: 'decimal', value: String(p.stock).replace('.', ','), style: 'text-align:right;font-size:18px;font-weight:700' });
  const motivo = selector(['Conteo físico', 'Producto dañado', 'Producto vencido', 'Pérdida o robo', 'Consumo interno', 'Otro']);
  const detalle = el('input', { placeholder: 'Detalle (opcional)' });
  const dif = el('div', { class: 'mini' });
  const mostrar = () => { const d = Math.round((leerNumero(contado.value) - p.stock) * 1000) / 1000; dif.textContent = d === 0 ? 'Sin cambio' : (d > 0 ? 'Entra ' : 'Sale ') + cantidad(Math.abs(d)); };
  contado.addEventListener('input', mostrar);
  const aplicar = async () => {
    const m = motivo.value + (detalle.value.trim() ? ': ' + detalle.value.trim() : '');
    const r = await intentar(() => BESALU.productos.ajustar(p.id, leerNumero(contado.value), m), 'No se pudo ajustar');
    if (!r) return;
    cerrarModal(); await App.recargarCatalogo(); toast('Existencia ajustada', 'ok', r.nombre + ': ' + cantidad(r.stock)); renderInventario();
  };
  abrirModal(el('div', { class: 'modal narrow' }, [el('h2', { text: 'Ajustar existencia' }),
    el('div', { class: 'mini', style: 'margin-bottom:12px', text: p.nombre + ' · en sistema: ' + cantidad(p.stock) }),
    campo('Cantidad real (contada)', contado, null), dif, campo('Motivo', motivo), campo('Detalle', detalle),
    el('div', { class: 'note', text: 'El ajuste queda registrado en el kárdex con su motivo; no se puede borrar.' }),
    el('div', { class: 'modal-acc' }, [el('button', { class: 'btn btn--ghost', onclick: cerrarModal }, 'Cancelar'), el('button', { class: 'btn btn--accent', onclick: aplicar }, 'Aplicar ajuste')])]));
  mostrar();
}

async function modalKardex(p) {
  const movs = await intentar(() => BESALU.productos.kardex(p.id));
  if (!movs) return;
  const tb = el('tbody', {}, movs.length ? movs.map((m) => {
    const t = TIPO_MOV[m.tipo] || [m.tipo, ''];
    const doc = m.comprobante ? NOMBRE_TIPO[m.tipo_comprobante] + ' ' + Number(m.comprobante.slice(-10)) : (m.compra ? 'Factura ' + m.compra + ' · ' + m.proveedor : '');
    return el('tr', {}, [el('td', { class: 'mini', text: fechaHora(m.fecha) }), el('td', {}, el('span', { class: 'pill ' + t[1], text: t[0] })),
      el('td', { class: 'der', style: 'color:var(--pos);font-weight:600', text: m.cantidad > 0 ? '+' + cantidad(m.cantidad) : '' }),
      el('td', { class: 'der', style: 'color:var(--neg);font-weight:600', text: m.cantidad < 0 ? '−' + cantidad(-m.cantidad) : '' }),
      el('td', { class: 'der', style: 'font-weight:700', text: cantidad(m.saldo) }), el('td', { class: 'mini', text: doc || m.nota })]);
  }) : [el('tr', {}, el('td', { colspan: 6, class: 'mini', style: 'text-align:center;padding:24px', text: 'Sin movimientos.' }))]);
  abrirModal(el('div', { class: 'modal ancho' }, [
    el('div', { class: 'card-t' }, [el('h2', { text: 'Kárdex · ' + p.nombre }), el('button', { class: 'icon-btn', onclick: cerrarModal }, icon('x', 18))]),
    el('div', { class: 'mini', style: 'margin-bottom:12px', text: 'Existencia actual: ' + cantidad(p.stock) + ' · costo promedio ' + money(p.costo) }),
    el('div', { class: 'tabla-wrap', style: 'border:1px solid var(--line);max-height:60vh' }, el('table', {}, [
      el('thead', {}, el('tr', {}, ['Fecha', 'Movimiento', 'Entrada', 'Salida', 'Saldo', 'Documento / nota'].map((t, i) => el('th', { text: t, class: i > 1 && i < 5 ? 'der' : '' })))), tb])),
    el('div', { class: 'modal-acc' }, [el('button', { class: 'btn btn--ghost', onclick: () => exportarCsv('kardex', p.id) }, [icon('download', 16), 'Excel']), el('button', { class: 'btn btn--accent', onclick: cerrarModal }, 'Cerrar')])]));
}

async function eliminarProducto(p) {
  const ok = await confirmar('Eliminar producto', '¿Eliminar "' + p.nombre + '"?\nSi ya tiene ventas, compras o movimientos, se DESACTIVA (no se puede borrar su historia).', { peligro: true, aceptar: 'Eliminar' });
  if (!ok) return;
  const r = await intentar(() => BESALU.productos.eliminar(p.id), 'No se pudo eliminar');
  if (!r) return;
  await App.recargarCatalogo();
  toast(r.eliminado ? 'Producto eliminado' : 'Producto desactivado', 'ok', r.eliminado ? p.nombre : 'Tiene historial: queda oculto pero se conserva');
  renderInventario();
}
