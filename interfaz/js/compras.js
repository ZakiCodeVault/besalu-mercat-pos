/**
 * compras.js — Facturas de compra a proveedores (F3): las ENTRADAS.
 *
 *  - Registro manual o importando el XML de la factura electrónica del proveedor.
 *  - Cada línea puede ser: producto existente, producto nuevo, o gasto (no inventario).
 *  - Al registrarla: suma al inventario, actualiza el costo promedio y su IVA
 *    cuenta como IVA pagado (crédito fiscal) en Reportes.
 *  - Una compra no se edita: si hubo error se anula y se registra de nuevo.
 */
const Compras = { periodo: 'mes', texto: '' };

async function renderCompras() {
  const root = $('#v-compras');
  const p = periodo(Compras.periodo);
  const lista = await intentar(() => BESALU.compras.listar({ desde: p.desde, hasta: p.hasta, texto: Compras.texto, limite: 500 }));
  if (!lista) return;
  root.innerHTML = '';
  const vigentes = lista.filter((c) => c.estado === 'vigente');
  const suma = (k) => vigentes.reduce((s, c) => s + c[k], 0);

  root.appendChild(el('div', { class: 'toolbar' }, [
    el('div', { class: 'segmento' }, [['mes', 'Este mes'], ['mes_anterior', 'Mes anterior'], ['anio', 'Este año']].map(([k, t]) =>
      el('button', { class: Compras.periodo === k ? 'sel' : '', onclick: () => { Compras.periodo = k; renderCompras(); } }, t))),
    el('div', { class: 'search', style: 'max-width:300px;flex:1' }, [icon('search', 18),
      el('input', { placeholder: 'Proveedor o número…', value: Compras.texto, style: 'padding-left:40px', oninput: debounce((e) => { Compras.texto = e.target.value; renderCompras(); }, 300) })]),
    el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [
      el('button', { class: 'btn btn--ghost', onclick: importarXml }, [icon('upload', 17), 'Importar XML']),
      el('button', { class: 'btn btn--accent', onclick: () => formularioCompra() }, [icon('plus', 17), 'Registrar compra']),
      el('button', { class: 'btn btn--ghost btn--sm', onclick: () => exportarCsv('compras', p.desde, p.hasta) }, [icon('download', 16), 'Excel'])])
  ]));
  root.appendChild(el('div', { class: 'stats' }, [
    stat([icon('truck', 15), 'Compras · ' + p.etiqueta], money(suma('total')), el('span', { class: 'mini', text: plural(vigentes.length, 'factura', 'facturas') })),
    stat([icon('doc', 15), 'Base (sin IVA)'], money(suma('subtotal')), null),
    stat([icon('shield', 15), 'IVA pagado (crédito fiscal)'], money(suma('impuesto')), el('span', { class: 'mini', text: 'Se resta del IVA a pagar' }))
  ]));

  const tb = el('tbody');
  if (!lista.length) tb.appendChild(el('tr', {}, el('td', { colspan: 6, class: 'mini', style: 'text-align:center;padding:30px', text: 'No hay compras registradas en este período.' })));
  for (const c of lista) {
    tb.appendChild(el('tr', { class: 'clic' + (c.estado === 'anulada' ? ' tachado' : ''), onclick: () => verCompra(c.id) }, [
      el('td', { text: fechaCorta(c.fecha) }),
      el('td', {}, [el('div', { style: 'font-weight:600', text: c.proveedor }), el('div', { class: 'mini', text: c.proveedor_identificacion })]),
      el('td', { class: 'mini', text: c.numero_documento }),
      el('td', { class: 'der mini', text: money(c.impuesto) }),
      el('td', { class: 'der', style: 'font-weight:700', text: money(c.total) }),
      el('td', {}, el('span', { class: 'pill ' + (c.estado === 'anulada' ? 'pill--red' : 'pill--green'), text: c.estado === 'anulada' ? 'Anulada' : 'Vigente' }))
    ]));
  }
  root.appendChild(el('div', { class: 'card pad0 glass' }, el('div', { class: 'tabla-wrap' }, el('table', {}, [
    el('thead', {}, el('tr', {}, ['Fecha', 'Proveedor', 'Factura', 'IVA', 'Total', 'Estado'].map((t, i) => el('th', { text: t, class: i === 3 || i === 4 ? 'der' : '' })))), tb]))));
}

async function verCompra(id) {
  const c = await intentar(() => BESALU.compras.obtener(id));
  if (!c) return;
  const tb = el('tbody', {}, c.lineas.map((l) => el('tr', {}, [
    el('td', {}, [el('div', { text: l.descripcion }), el('div', { class: 'mini', text: l.producto_id ? 'Inventario · ' + (l.producto_codigo || '') : 'Gasto' })]),
    el('td', { class: 'der', text: cantidad(l.cantidad) }), el('td', { class: 'der', text: money(l.costo_unitario) }),
    el('td', { class: 'der', text: l.tarifa_iva + '%' }), el('td', { class: 'der', text: money(l.impuesto) }), el('td', { class: 'der', text: money(l.total_linea) })])));
  const acciones = [el('button', { class: 'btn btn--ghost', onclick: cerrarModal }, 'Cerrar')];
  if (c.estado === 'vigente') acciones.unshift(el('button', { class: 'btn btn--danger-ghost', onclick: () => anularCompra(c) }, [icon('undo', 16), 'Anular compra']));
  abrirModal(el('div', { class: 'modal ancho' }, [
    el('div', { class: 'card-t' }, [el('h2', { text: 'Factura ' + c.numero_documento }), el('button', { class: 'icon-btn', onclick: cerrarModal }, icon('x', 18))]),
    el('div', { class: 'mini', style: 'margin-bottom:12px', text: c.proveedor_nombre + ' · ' + c.proveedor_identificacion + ' · ' + fechaCorta(c.fecha) + (c.clave ? ' · Clave ' + c.clave : '') }),
    c.estado === 'anulada' ? el('div', { class: 'note', style: 'margin:0 0 12px', html: '<b>Anulada</b> el ' + fechaHora(c.anulada_en) + ': ' + c.anulada_razon }) : null,
    el('div', { class: 'tabla-wrap', style: 'border:1px solid var(--line)' }, el('table', {}, [
      el('thead', {}, el('tr', {}, ['Descripción', 'Cant.', 'Costo u.', 'IVA', 'Monto IVA', 'Total'].map((t, i) => el('th', { text: t, class: i ? 'der' : '' })))), tb])),
    el('div', { class: 'totales-compra' }, [
      el('div', {}, ['Subtotal ', el('b', { text: money(c.subtotal) })]), el('div', {}, ['IVA ', el('b', { text: money(c.impuesto) })]),
      c.otros_cargos ? el('div', {}, ['Otros cargos ', el('b', { text: money(c.otros_cargos) })]) : null,
      el('div', { class: 'grande' }, ['Total ', el('b', { text: money(c.total) })])]),
    el('div', { class: 'modal-acc' }, acciones)]));
}

async function anularCompra(c) {
  const motivo = await confirmar('Anular compra', 'Se sacará del inventario lo que entró con la factura ' + c.numero_documento +
    ' y su IVA dejará de contar como crédito fiscal. Esta acción no se puede deshacer.', { peligro: true, pedirTexto: 'Motivo de la anulación', aceptar: 'Anular compra' });
  if (!motivo) return;
  const r = await intentar(() => BESALU.compras.anular(c.id, motivo), 'No se pudo anular');
  if (!r) return;
  cerrarModal();
  await App.recargarCatalogo();
  toast('Compra anulada', 'ok', c.numero_documento);
  renderCompras();
}

/* ---------------- Formulario de compra ---------------- */
/**
 * @param {object} borrador datos precargados (desde un XML) o null
 */
async function formularioCompra(borrador) {
  const proveedores = (await intentar(() => BESALU.compras.proveedores())) || [];
  const b = borrador || { proveedor: { tipo_id: '02' }, fecha: isoDia(new Date()), lineas: [] };
  const estado = { lineas: b.lineas.length ? b.lineas : [lineaVacia()] };

  const provTipo = selector(TIPOS_ID, b.proveedor.tipo_id || '02');
  const provId = el('input', { value: b.proveedor.identificacion || '', placeholder: 'Cédula del proveedor', list: 'dl-proveedores' });
  const provNombre = el('input', { value: b.proveedor.nombre || '' });
  const listaProv = el('datalist', { id: 'dl-proveedores' }, proveedores.map((p) => el('option', { value: p.identificacion, text: p.nombre })));
  provId.addEventListener('change', () => { const p = proveedores.find((x) => x.identificacion === provId.value.replace(/\D/g, '')); if (p) { provNombre.value = p.nombre; provTipo.value = p.tipo_id; } });
  const numero = el('input', { value: b.numero_documento || '', placeholder: 'Consecutivo de la factura' });
  const fecha = el('input', { type: 'date', value: b.fecha || isoDia(new Date()) });
  const claveDoc = el('input', { value: b.clave || '', placeholder: '50 dígitos (opcional)' });
  const otros = el('input', { inputmode: 'decimal', value: b.otros_cargos ? aColonesTexto(b.otros_cargos) : '', placeholder: '0' });
  const notas = el('input', { value: b.notas || '', placeholder: 'Opcional' });
  const listaProd = el('datalist', { id: 'dl-productos' }, App.catalogo.map((p) => el('option', { value: p.codigo + ' — ' + p.nombre })));
  const cuerpo = el('tbody');
  const totales = el('div', { class: 'totales-compra' });

  function recalcular() {
    let sub = 0, iva = 0;
    for (const l of estado.lineas) { const m = montosLinea(l); sub += m.subtotal; iva += m.impuesto; }
    const ot = aCentimos(otros.value);
    const total = sub + iva + ot;
    totales.innerHTML = '';
    totales.append(el('div', {}, ['Subtotal ', el('b', { text: money(sub) })]), el('div', {}, ['IVA ', el('b', { text: money(iva) })]),
      el('div', {}, ['Otros cargos ', el('b', { text: money(ot) })]), el('div', { class: 'grande' }, ['Total ', el('b', { text: money(total) })]));
    if (b.total_xml != null) {
      const cuadra = Math.abs(b.total_xml - total) <= 100;
      totales.appendChild(el('div', { class: 'pill ' + (cuadra ? 'pill--green' : 'pill--amber') }, cuadra ? 'Cuadra con la factura (' + money(b.total_xml) + ')' : 'La factura dice ' + money(b.total_xml) + ': revise las líneas'));
    }
  }

  function pintarLineas() {
    cuerpo.innerHTML = '';
    estado.lineas.forEach((l, i) => cuerpo.appendChild(filaLinea(l, i)));
    recalcular();
  }

  function filaLinea(l, i) {
    const modo = selector([['existente', 'Producto'], ['nuevo', 'Producto nuevo'], ['gasto', 'Gasto']], l.modo);
    modo.addEventListener('change', () => { l.modo = modo.value; pintarLineas(); });
    let detalle;
    if (l.modo === 'existente') {
      const inp = el('input', { list: 'dl-productos', value: l.texto || '', placeholder: 'Código o nombre' });
      inp.addEventListener('change', () => {
        const cod = inp.value.split(' — ')[0].trim();
        const p = App.catalogo.find((x) => x.codigo === cod) || App.catalogo.find((x) => x.nombre.toLowerCase() === inp.value.toLowerCase());
        l.producto_id = p ? p.id : null; l.texto = inp.value;
        if (p) { l.tarifa = p.tarifa_iva; inp.value = p.codigo + ' — ' + p.nombre; pintarLineas(); }
        else toast('Producto no encontrado', 'err', 'Elija de la lista o cambie a "Producto nuevo"');
      });
      detalle = el('div', {}, [inp, l.producto_id ? null : el('div', { class: 'mini', style: 'color:var(--neg)', text: 'Elija un producto' })]);
    } else if (l.modo === 'nuevo') {
      const n = l.nuevo;
      const cod = el('input', { value: n.codigo || '', placeholder: 'Código de barras' });
      const nom = el('input', { value: n.nombre || '', placeholder: 'Nombre del producto' });
      const pre = el('input', { inputmode: 'decimal', value: n.precio ? aColonesTexto(n.precio) : '', placeholder: 'Precio venta ₡ (con IVA)' });
      cod.oninput = () => (n.codigo = cod.value.trim()); nom.oninput = () => (n.nombre = nom.value.trim()); pre.oninput = () => (n.precio = aCentimos(pre.value));
      detalle = el('div', { class: 'nuevo-prod' }, [el('div', { class: 'g2' }, [cod, pre]), nom, n.cabys ? el('div', { class: 'mini', text: 'CABYS ' + n.cabys }) : null]);
    } else {
      const d = el('input', { value: l.descripcion || '', placeholder: 'Descripción del gasto' });
      d.oninput = () => (l.descripcion = d.value);
      detalle = d;
    }
    const cant = el('input', { inputmode: 'decimal', value: String(l.cantidad).replace('.', ','), style: 'width:80px;text-align:right' });
    const costo = el('input', { inputmode: 'decimal', value: l.costo ? aColonesTexto(l.costo) : '', placeholder: '0', style: 'width:110px;text-align:right' });
    const opcionesTarifa = TARIFAS.map(([v]) => [v, v + '%']);
    if (!opcionesTarifa.some(([v]) => v === Number(l.tarifa))) opcionesTarifa.unshift([l.tarifa, l.tarifa + '%']);   // nunca cambiar la tarifa del documento sin avisar
    const tarifa = selector(opcionesTarifa, l.tarifa);
    const montos = el('td', { class: 'der mini' });
    const pintarMontos = () => { const m = montosLinea(l); montos.innerHTML = ''; montos.append(el('div', { text: money(m.subtotal + m.impuesto) }), el('div', { text: 'IVA ' + money(m.impuesto) })); };
    cant.oninput = () => { l.cantidad = leerNumero(cant.value); l.exacto = false; pintarMontos(); recalcular(); };
    costo.oninput = () => { l.costo = aCentimos(costo.value); l.exacto = false; pintarMontos(); recalcular(); };
    tarifa.onchange = () => { l.tarifa = Number(tarifa.value); l.exacto = false; pintarMontos(); recalcular(); };
    pintarMontos();
    return el('tr', { class: l.revisar ? 'fila-revisar' : '' }, [
      el('td', {}, modo), el('td', { style: 'min-width:240px' }, detalle), el('td', {}, cant), el('td', {}, costo), el('td', {}, tarifa), montos,
      el('td', {}, el('button', { class: 'icon-btn icon-btn--danger', title: 'Quitar línea', onclick: () => { estado.lineas.splice(i, 1); if (!estado.lineas.length) estado.lineas.push(lineaVacia()); pintarLineas(); } }, icon('trash', 16)))
    ]);
  }

  async function registrar() {
    const lineas = [];
    for (const [i, l] of estado.lineas.entries()) {
      if (!(l.cantidad > 0)) { toast('Línea ' + (i + 1) + ': cantidad inválida', 'err'); return; }
      const base = { cantidad: l.cantidad, costo_unitario: l.costo, tarifa_iva: l.tarifa };
      if (l.exacto) Object.assign(base, { subtotal: l.subtotal, impuesto: l.impuesto });
      if (l.modo === 'existente') {
        if (!l.producto_id) { toast('Línea ' + (i + 1) + ': elija el producto', 'err'); return; }
        lineas.push(Object.assign(base, { producto_id: l.producto_id }));
      } else if (l.modo === 'nuevo') {
        const n = l.nuevo;
        if (!n.codigo || !n.nombre) { toast('Línea ' + (i + 1) + ': el producto nuevo necesita código y nombre', 'err'); return; }
        if (!n.precio) { toast('Línea ' + (i + 1) + ': indique el precio de venta del producto nuevo', 'err'); return; }
        lineas.push(Object.assign(base, { descripcion: n.nombre, nuevo_producto: { codigo: n.codigo, nombre: n.nombre, precio: n.precio, costo: l.costo, tarifa_iva: l.tarifa, cabys: n.cabys || '', unidad: n.unidad || 'Unid' } }));
      } else {
        if (!String(l.descripcion || '').trim()) { toast('Línea ' + (i + 1) + ': escriba la descripción del gasto', 'err'); return; }
        lineas.push(Object.assign(base, { descripcion: l.descripcion }));
      }
    }
    const datos = {
      proveedor: { tipo_id: provTipo.value, identificacion: provId.value, nombre: provNombre.value, correo: (b.proveedor || {}).correo || '' },
      numero_documento: numero.value, fecha: fecha.value, clave: claveDoc.value, otros_cargos: aCentimos(otros.value),
      notas: notas.value, xml_original: b.xml_original || null, lineas
    };
    const r = await intentar(() => BESALU.compras.registrar(datos), 'No se pudo registrar la compra');
    if (!r) return;
    cerrarModal();
    await App.recargarCatalogo();
    toast('Compra registrada', 'ok', r.proveedor_nombre + ' · ' + money(r.total) + ' · IVA ' + money(r.impuesto));
    if (App.vista === 'compras') renderCompras();
  }

  abrirModal(el('div', { class: 'modal ancho' }, [
    el('div', { class: 'card-t' }, [el('h2', { text: b.xml_original ? 'Revisar factura importada' : 'Registrar factura de compra' }), el('button', { class: 'icon-btn', onclick: cerrarModal }, icon('x', 18))]),
    listaProv, listaProd,
    el('div', { class: 'g3' }, [campo('Tipo', provTipo), campo('Identificación del proveedor', provId), campo('Nombre del proveedor', provNombre)]),
    el('div', { class: 'g3' }, [campo('Número de factura', numero), campo('Fecha de la factura', fecha), campo('Clave (si es electrónica)', claveDoc)]),
    el('div', { class: 'tabla-wrap lineas-compra' }, el('table', {}, [
      el('thead', {}, el('tr', {}, ['Tipo', 'Producto / descripción', 'Cantidad', 'Costo u. sin IVA', 'IVA', 'Total', ''].map((t) => el('th', { text: t })))), cuerpo])),
    el('button', { class: 'btn btn--ghost btn--sm', style: 'margin-top:10px', onclick: () => { estado.lineas.push(lineaVacia()); pintarLineas(); } }, [icon('plus', 15), 'Agregar línea']),
    el('div', { class: 'g2', style: 'margin-top:14px' }, [campo('Otros cargos ₡ (flete, servicio…)', otros), campo('Notas', notas)]),
    totales,
    el('div', { class: 'modal-acc' }, [el('button', { class: 'btn btn--ghost', onclick: cerrarModal }, 'Cancelar'), el('button', { class: 'btn btn--pos', onclick: registrar }, [icon('check', 17), 'Registrar compra'])])
  ]));
  otros.addEventListener('input', recalcular);
  pintarLineas();
}

function lineaVacia() { return { modo: 'existente', producto_id: null, texto: '', nuevo: {}, descripcion: '', cantidad: 1, costo: 0, tarifa: 13, exacto: false }; }

function montosLinea(l) {
  if (l.exacto) return { subtotal: l.subtotal, impuesto: l.impuesto };
  const sub = Math.round((l.costo || 0) * (l.cantidad || 0));
  return { subtotal: sub, impuesto: Math.round(sub * (l.tarifa || 0) / 100) };
}

/* ---------------- Importar XML de factura electrónica ---------------- */
function importarXml() {
  const archivo = el('input', { type: 'file', accept: '.xml,text/xml', style: 'display:none' });
  archivo.addEventListener('change', () => {
    const f = archivo.files[0];
    if (!f) return;
    const lector = new FileReader();
    lector.onload = () => {
      try { formularioCompra(leerXmlCompra(String(lector.result))); }
      catch (e) { toast('No se pudo leer el XML', 'err', e.message); }
    };
    lector.readAsText(f, 'utf-8');
  });
  document.body.appendChild(archivo);
  archivo.click();
  setTimeout(() => archivo.remove(), 60000);
}

/** Lee una factura electrónica de Costa Rica (v4.3 / v4.4) y arma el borrador de compra. */
function leerXmlCompra(texto) {
  const doc = new DOMParser().parseFromString(texto, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('El archivo no es un XML válido');
  const raiz = doc.documentElement;
  if (raiz.localName === 'MensajeHacienda') throw new Error('Ese es el XML de respuesta de Hacienda; elija el XML de la factura');
  if (!/^(FacturaElectronica|TiqueteElectronico|FacturaElectronicaCompra)$/.test(raiz.localName)) throw new Error('No es una factura electrónica (' + raiz.localName + ')');
  const hijos = (n, nombre) => [...(n ? n.children : [])].filter((x) => x.localName === nombre);
  const hijo = (n, nombre) => hijos(n, nombre)[0];
  const txt = (n, nombre) => { const h = hijo(n, nombre); return h ? h.textContent.trim() : ''; };
  const montoXml = (v) => Math.round(parseFloat(v || '0') * 100) || 0;

  const emisor = hijo(raiz, 'Emisor');
  const ident = hijo(emisor, 'Identificacion');
  const resumen = hijo(raiz, 'ResumenFactura');
  const lineas = hijos(hijo(raiz, 'DetalleServicio'), 'LineaDetalle').map((ld) => {
    const cant = Math.round(parseFloat(txt(ld, 'Cantidad') || '1') * 1000) / 1000;
    const sub = montoXml(txt(ld, 'SubTotal') || txt(ld, 'MontoTotal'));
    const impuestos = hijos(ld, 'Impuesto');
    const iva = impuestos.reduce((s, i) => s + montoXml(txt(i, 'Monto')), 0);
    const tarifa = impuestos.length ? parseFloat(txt(impuestos[0], 'Tarifa') || '0') : 0;
    let cabys = txt(ld, 'CodigoCABYS') || txt(ld, 'Codigo');
    if (!/^\d{13}$/.test(cabys)) cabys = '';
    const codCom = hijos(ld, 'CodigoComercial').map((c) => txt(c, 'Codigo')).find(Boolean) || '';
    const detalle = txt(ld, 'Detalle');
    const costo = cant ? Math.round(sub / cant) : sub;
    const existente = codCom && App.catalogo.find((p) => p.codigo === codCom);
    const precioSugerido = Math.round(costo * (1 + tarifa / 100) * 1.30 / 500) * 500;   // margen 30 %, redondeado a ₡5
    return {
      modo: existente ? 'existente' : 'nuevo', producto_id: existente ? existente.id : null,
      texto: existente ? existente.codigo + ' — ' + existente.nombre : '',
      nuevo: existente ? {} : { codigo: codCom || cabys, nombre: detalle, precio: precioSugerido, cabys, unidad: txt(ld, 'UnidadMedida') || 'Unid' },
      revisar: !existente, descripcion: detalle, cantidad: cant, costo, tarifa, subtotal: sub, impuesto: iva, exacto: true
    };
  });
  if (!lineas.length) throw new Error('La factura no tiene líneas de detalle');
  const otros = hijos(raiz, 'OtrosCargos').reduce((s, o) => s + montoXml(txt(o, 'MontoCargo')), 0);
  return {
    proveedor: { tipo_id: txt(ident, 'Tipo') || '02', identificacion: txt(ident, 'Numero'), nombre: txt(emisor, 'Nombre'), correo: txt(emisor, 'CorreoElectronico') },
    numero_documento: txt(raiz, 'NumeroConsecutivo'), clave: txt(raiz, 'Clave'), fecha: txt(raiz, 'FechaEmision').slice(0, 10),
    otros_cargos: otros, total_xml: montoXml(txt(resumen, 'TotalComprobante')), xml_original: texto, lineas
  };
}
