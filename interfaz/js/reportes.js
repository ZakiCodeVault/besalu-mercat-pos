/**
 * reportes.js — IVA a pagar, balance de entradas/salidas y ventas (F5).
 */
const Reportes = { periodo: 'mes', desde: null, hasta: null };

function rangoReportes() {
  if (Reportes.periodo === 'rango' && Reportes.desde && Reportes.hasta) return { desde: Reportes.desde, hasta: Reportes.hasta, etiqueta: fechaCorta(Reportes.desde) + ' – ' + fechaCorta(Reportes.hasta) };
  return periodo(Reportes.periodo);
}

async function renderReportes() {
  const root = $('#v-reportes');
  const p = rangoReportes();
  const [iva, bal, ven] = await Promise.all([
    intentar(() => BESALU.reportes.iva(p.desde, p.hasta)), intentar(() => BESALU.reportes.balance(p.desde, p.hasta)), intentar(() => BESALU.reportes.ventas(p.desde, p.hasta))]);
  if (!iva || !bal || !ven) return;
  root.innerHTML = '';

  const desde = el('input', { type: 'date', value: p.desde }), hasta = el('input', { type: 'date', value: p.hasta });
  const aplicarRango = () => { if (desde.value && hasta.value) { Reportes.periodo = 'rango'; Reportes.desde = desde.value; Reportes.hasta = hasta.value; renderReportes(); } };
  desde.onchange = aplicarRango; hasta.onchange = aplicarRango;
  root.appendChild(el('div', { class: 'toolbar' }, [
    el('div', { class: 'segmento' }, [['hoy', 'Hoy'], ['mes', 'Este mes'], ['mes_anterior', 'Mes anterior'], ['anio', 'Este año']].map(([k, t]) =>
      el('button', { class: Reportes.periodo === k ? 'sel' : '', onclick: () => { Reportes.periodo = k; renderReportes(); } }, t))),
    el('div', { class: 'rango' }, [desde, el('span', { class: 'mini', text: 'a' }), hasta]),
    el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [
      el('button', { class: 'btn btn--ghost btn--sm', onclick: () => exportarCsv('iva', p.desde, p.hasta) }, [icon('download', 16), 'IVA']),
      el('button', { class: 'btn btn--ghost btn--sm', onclick: () => exportarCsv('ventas', p.desde, p.hasta) }, [icon('download', 16), 'Ventas']),
      el('button', { class: 'btn btn--ghost btn--sm', onclick: () => exportarCsv('compras', p.desde, p.hasta) }, [icon('download', 16), 'Compras'])])
  ]));

  /* ---- IVA ---- */
  const aPagar = iva.iva_a_pagar >= 0;
  root.appendChild(el('div', { class: 'iva-card glass' + (aPagar ? '' : ' a-favor') }, [
    el('div', { class: 'iva-total' }, [
      el('div', { class: 'k', text: (aPagar ? 'IVA a pagar a Hacienda' : 'Saldo a favor (IVA)') + ' · ' + p.etiqueta }),
      el('div', { class: 'v', text: money(Math.abs(iva.iva_a_pagar)) }),
      el('div', { class: 'mini', text: 'Base para la declaración mensual. Validalo con tu contador.' })]),
    el('div', { class: 'iva-ecuacion' }, [
      filaIva('IVA cobrado en ventas', iva.iva_ventas, ''), filaIva('− IVA devuelto (notas de crédito)', iva.iva_devoluciones, ''),
      filaIva('= Débito fiscal', iva.debito_fiscal, 'b'), filaIva('− IVA pagado en compras (crédito)', iva.credito_fiscal, ''),
      filaIva(aPagar ? '= IVA a pagar' : '= Saldo a favor', Math.abs(iva.iva_a_pagar), 'b grande')])
  ]));
  const tbIva = el('tbody', {}, iva.tarifas.length ? iva.tarifas.map((t) => el('tr', {}, [
    el('td', { text: t.tarifa ? 'IVA ' + t.tarifa + '%' : 'Exento' }), el('td', { class: 'der', text: money(t.ventas_base - t.nc_base) }),
    el('td', { class: 'der', text: money(t.ventas_iva - t.nc_iva) }), el('td', { class: 'der', text: money(t.compras_base) }),
    el('td', { class: 'der', text: money(t.compras_iva) }), el('td', { class: 'der', style: 'font-weight:700', text: money(t.ventas_iva - t.nc_iva - t.compras_iva) })]))
    : [el('tr', {}, el('td', { colspan: 6, class: 'mini', style: 'text-align:center;padding:20px', text: 'Sin movimientos en el período.' }))]);
  root.appendChild(el('div', { class: 'card pad0 glass', style: 'margin-bottom:16px' }, [el('div', { style: 'padding:18px 20px 4px' }, el('h2', { text: 'IVA por tarifa' })),
    el('div', { class: 'tabla-wrap' }, el('table', {}, [el('thead', {}, el('tr', {}, ['Tarifa', 'Ventas netas (base)', 'IVA ventas', 'Compras (base)', 'IVA compras', 'Neto'].map((t, i) => el('th', { text: t, class: i ? 'der' : '' })))), tbIva]))]));

  /* ---- Balance de entradas y salidas ---- */
  root.appendChild(el('div', { class: 'stats' }, [
    stat([icon('chart', 15), 'Ventas netas (sin IVA)'], money(bal.ventas_netas), el('span', { class: 'mini', text: 'Costo de lo vendido ' + money(bal.costo_ventas) })),
    stat([icon('wallet', 15), 'Utilidad bruta'], money(bal.utilidad_bruta), el('span', { class: 'delta ' + (bal.utilidad_bruta >= 0 ? 'up' : 'down'), text: 'Margen ' + bal.margen + '%' })),
    stat([icon('truck', 15), 'Compras (sin IVA)'], money(bal.compras.base), el('span', { class: 'mini', text: plural(bal.compras.facturas, 'factura', 'facturas') + ' · IVA ' + money(bal.compras.iva) }))
  ]));
  const u = bal.unidades_por_tipo;
  const fu = (k, t) => el('div', { class: 'arqueo' }, [el('span', { class: 'mini', text: t }), el('span', { class: 'v', text: cantidad(Math.abs(u[k] || 0)) })]);
  root.appendChild(el('div', { class: 'grid2', style: 'margin-bottom:16px' }, [
    el('div', { class: 'card glass' }, [el('h2', { text: 'Entradas de inventario' }),
      fu('compra', 'Compras'), fu('nota_credito', 'Devoluciones de clientes'), fu('inicial', 'Inventario inicial'),
      el('div', { class: 'arqueo' }, [el('span', { style: 'font-weight:700', text: 'Total entradas' }), el('span', { class: 'v', style: 'color:var(--pos)', text: '+' + cantidad(bal.unidades_entradas) })])]),
    el('div', { class: 'card glass' }, [el('h2', { text: 'Salidas de inventario' }),
      fu('venta', 'Ventas'), fu('anulacion_compra', 'Compras anuladas'), fu('ajuste', 'Ajustes (neto)'),
      el('div', { class: 'arqueo' }, [el('span', { style: 'font-weight:700', text: 'Total salidas' }), el('span', { class: 'v', style: 'color:var(--neg)', text: '−' + cantidad(bal.unidades_salidas) })])])
  ]));

  /* ---- Ventas ---- */
  const serie = serieDiaria(ven.porDia, p.desde, p.hasta);
  const r = ven.resumen;
  const tbTop = el('tbody', {}, ven.masVendidos.length ? ven.masVendidos.map((x, i) => el('tr', {}, [
    el('td', { class: 'mini', text: String(i + 1) }), el('td', { text: x.nombre }), el('td', { class: 'der mini', text: cantidad(x.cantidad) }), el('td', { class: 'der', style: 'font-weight:600', text: money(x.total) })]))
    : [el('tr', {}, el('td', { colspan: 4, class: 'mini', style: 'text-align:center;padding:20px', text: 'Sin ventas.' }))]);
  root.appendChild(el('div', { class: 'grid2' }, [
    el('div', { class: 'card glass' }, [el('div', { class: 'card-t' }, [el('h2', { text: 'Ventas por día' }), el('span', { class: 'mini', text: money(r.total) + ' · ' + plural(r.cantidad, 'comprobante', 'comprobantes') + ' · ticket ' + money(r.ticket_promedio) })]),
      el('div', { html: graficoArea(serie.valores, serie.etiquetas) }),
      el('div', { class: 'medios' }, Object.entries(MEDIOS).map(([k, [n, ic]]) => {
        const pct = r.total ? Math.round(r.medios[k] / r.total * 100) : 0;
        return el('div', {}, [el('div', { class: 'medio-fila' }, [el('span', {}, [icon(ic, 15), ' ' + n]), el('b', { text: money(r.medios[k]) + ' · ' + pct + '%' })]),
          el('div', { class: 'barra' }, el('i', { style: 'width:' + Math.max(0, pct) + '%' }))]);
      }))]),
    el('div', { class: 'card pad0 glass' }, [el('div', { style: 'padding:18px 20px 4px' }, el('h2', { text: 'Más vendidos' })),
      el('div', { class: 'tabla-wrap' }, el('table', {}, [el('thead', {}, el('tr', {}, ['#', 'Producto', 'Cant.', 'Total'].map((t, i) => el('th', { text: t, class: i > 1 ? 'der' : '' })))), tbTop]))])
  ]));
}

function filaIva(texto, monto, clase) {
  return el('div', { class: 'iva-fila ' + clase }, [el('span', { text: texto }), el('span', { text: money(monto) })]);
}
