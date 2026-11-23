/**
 * cierre.js — Turno de caja: arqueo y cierre con reporte Z (F6).
 * Al cerrar la caja se hace un respaldo automático de la base de datos.
 */
async function renderCierre() {
  const root = $('#v-cierre');
  const [resumen, historial] = await Promise.all([intentar(() => BESALU.caja.resumen()), intentar(() => BESALU.caja.historial())]);
  root.innerHTML = '';

  if (!resumen) {
    root.appendChild(el('div', { class: 'cerrada-aviso glass' }, [icon('wallet', 30), el('h2', { text: 'No hay un turno abierto', style: 'margin:6px 0 4px' }),
      el('div', { class: 'mini', style: 'margin-bottom:14px', text: 'Abrí la caja para iniciar un turno.' }),
      el('button', { class: 'btn btn--pos btn--lg', onclick: modalAbrirCaja }, [icon('unlock', 18), 'Abrir caja'])]));
  } else {
    const t = resumen.turno;
    const fila = (izq, der, estilo) => el('div', { class: 'arqueo' }, [typeof izq === 'string' ? el('span', { class: 'mini', text: izq }) : izq, el('span', { class: 'v', style: estilo || '', text: der })]);
    const contado = el('input', { inputmode: 'decimal', placeholder: '0', style: 'text-align:right;font-size:18px;font-weight:700' });
    const dif = el('span', { class: 'v', text: '—' });
    contado.addEventListener('input', () => {
      const d = aCentimos(contado.value) - resumen.efectivo_esperado;
      dif.textContent = (d > 0 ? '+' : '') + money(d);
      dif.className = 'v ' + (d === 0 ? 'diff-ok' : 'diff-bad');
    });
    root.appendChild(el('div', { class: 'grid2' }, [
      el('div', { class: 'card glass' }, [el('h2', { text: 'Turno #' + t.id + ' abierto' }),
        fila('Apertura', fechaHora(t.abierto_en)), fila('Fondo inicial', money(t.fondo)), fila('Comprobantes', String(resumen.comprobantes)),
        fila('Ventas', money(resumen.ventas)), resumen.devoluciones ? fila('Devoluciones', '−' + money(resumen.devoluciones), 'color:var(--neg)') : null,
        fila(el('span', { style: 'font-weight:700', text: 'Ventas netas' }), money(resumen.ventas_netas))]),
      el('div', { class: 'card glass' }, [el('h2', { text: 'Por medio de pago' }),
        ...Object.entries(MEDIOS).map(([k, [n, ic]]) => fila(el('span', { style: 'display:flex;gap:8px;align-items:center' }, [icon(ic, 16), n]),
          money(resumen.medios[k] - resumen.devoluciones_por_medio[k]))),
        el('div', { class: 'note', text: 'Tarjeta: compará con el cierre del datáfono. SINPE: con los depósitos del banco.' })])
    ]));
    // Quién tiene la caja ahora y los relevos del turno
    const abierto = (resumen.tramos || []).find((x) => !x.tramo.fin);
    root.appendChild(el('div', { class: 'card glass', style: 'margin-top:16px' }, [
      el('div', { class: 'card-t' }, [el('h2', { text: 'Cajeros del turno' }),
        puedo('relevo') ? el('button', { class: 'btn btn--accent btn--sm', onclick: relevoDeCaja }, [icon('user', 15), 'Relevo de caja']) : null]),
      abierto ? el('div', { class: 'note', style: 'margin:0 0 12px' }, [el('b', { text: abierto.tramo.usuario_nombre }),
        ' tiene la caja desde las ' + horaDe(abierto.tramo.inicio) + ' · recibió ' + money(abierto.tramo.recibido)]) : null,
      (resumen.tramos || []).length ? el('div', { class: 'tabla-wrap', style: 'border:1px solid var(--line)' }, el('table', {}, [
        el('thead', {}, el('tr', {}, ['Cajero', 'Horario', 'Recibió', 'Ventas', 'Esperado', 'Contado', 'Diferencia'].map((t, i) => el('th', { text: t, class: i > 1 ? 'der' : '' })))),
        el('tbody', {}, resumen.tramos.map((x) => el('tr', {}, [
          el('td', { style: 'font-weight:600', text: x.tramo.usuario_nombre }),
          el('td', { class: 'mini', text: horaDe(x.tramo.inicio) + ' – ' + (x.tramo.fin ? horaDe(x.tramo.fin) : 'ahora') + (x.tramo.entrega_a_nombre ? ' → ' + x.tramo.entrega_a_nombre : '') }),
          el('td', { class: 'der', text: money(x.tramo.recibido) }), el('td', { class: 'der', text: money(x.ventas_netas) }),
          el('td', { class: 'der', text: x.tramo.fin ? money(x.tramo.esperado) : '—' }), el('td', { class: 'der', text: x.tramo.fin ? money(x.tramo.contado) : '—' }),
          el('td', { class: 'der', style: 'font-weight:700;color:' + (!x.tramo.fin ? 'var(--ink-3)' : x.tramo.diferencia === 0 ? 'var(--pos)' : 'var(--neg)'),
            text: x.tramo.fin ? (x.tramo.diferencia > 0 ? '+' : '') + money(x.tramo.diferencia) : 'en curso' })])))])) : el('div', { class: 'mini', text: 'Esta caja se abrió antes de los usuarios.' })]));

    root.appendChild(el('div', { class: 'card glass', style: 'margin-top:16px' }, [el('h2', { text: 'Arqueo de efectivo' }),
      fila('Efectivo esperado (fondo + ventas en efectivo − devoluciones en efectivo)', money(resumen.efectivo_esperado)),
      el('div', { class: 'campo', style: 'margin:12px 0 4px' }, [el('label', { text: 'Efectivo contado en caja (₡)' }), contado]),
      el('div', { class: 'arqueo' }, [el('span', { class: 'mini', text: 'Diferencia' }), dif]),
      el('button', { class: 'btn btn--accent btn--lg btn--block', style: 'margin-top:14px', onclick: () => cerrarCaja(resumen, contado.value) }, [icon('lock', 18), 'Cerrar caja y generar Z']),
      puedo('cerrar_caja') ? null : el('div', { class: 'mini', style: 'text-align:center;margin-top:8px', text: 'Para cerrar la caja se pide el PIN de un encargado.' })]));
  }

  if (historial && historial.length) {
    const tb = el('tbody', {}, historial.map((h) => el('tr', {}, [
      el('td', { text: '#' + h.id }), el('td', { class: 'mini', text: fechaHora(h.abierto_en) + ' → ' + fechaHora(h.cerrado_en) + (h.cerrado_por_nombre ? ' · cerró ' + h.cerrado_por_nombre : '') }),
      el('td', { class: 'der', text: money(h.esperado) }), el('td', { class: 'der', text: money(h.contado) }),
      el('td', { class: 'der', style: 'font-weight:700;color:' + (h.diferencia === 0 ? 'var(--pos)' : 'var(--neg)'), text: (h.diferencia > 0 ? '+' : '') + money(h.diferencia) }),
      el('td', { class: 'der' }, el('button', { class: 'icon-btn', title: 'Reimprimir Z', onclick: async () => { const r = await intentar(() => BESALU.caja.resumen(h.id)); if (r) imprimir(armarCierre(r)); } }, icon('printer', 17)))])));
    root.appendChild(el('div', { class: 'card pad0 glass', style: 'margin-top:16px' }, [el('div', { style: 'padding:18px 20px 4px' }, el('h2', { text: 'Cierres anteriores' })),
      el('div', { class: 'tabla-wrap' }, el('table', {}, [el('thead', {}, el('tr', {}, ['Turno', 'Horario', 'Esperado', 'Contado', 'Diferencia', ''].map((t, i) => el('th', { text: t, class: i > 1 ? 'der' : '' })))), tb]))]));
  }
}

async function cerrarCaja(resumen, textoContado) {
  if (!String(textoContado).trim()) { toast('Escriba el efectivo contado', 'err'); return; }
  const contado = aCentimos(textoContado);
  const d = contado - resumen.efectivo_esperado;
  const ok = await confirmar('Cerrar caja', 'Esperado ' + money(resumen.efectivo_esperado) + '\nContado ' + money(contado) + '\nDiferencia ' + (d > 0 ? '+' : '') + money(d) +
    '\n\nEl cierre no se puede modificar después.', { aceptar: 'Cerrar caja' });
  if (!ok) return;
  const z = await intentar(() => BESALU.caja.cerrar(contado), 'No se pudo cerrar la caja');
  if (!z) return;
  App.turno = null;
  actualizarIndicadorCaja();
  toast('Caja cerrada', 'ok', 'Se generó el reporte Z y un respaldo de la base de datos');
  imprimir(armarCierre(z));
  renderCierre();
}
