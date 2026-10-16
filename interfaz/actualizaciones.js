/**
 * actualizaciones.js — Aviso de actualización y tarjeta "Acerca de".
 *
 * Solo funciona dentro de la app de escritorio (cuando existe window.BESALU).
 * El proceso principal descarga la nueva versión en segundo plano; aquí solo
 * se muestra el progreso y el botón "Reiniciar y actualizar".
 */
(function () {
  if (!window.BESALU || !window.BESALU.actualizaciones) return;

  const aviso = document.getElementById('upd');
  const icono = document.getElementById('upd-ic');
  const titulo = document.getElementById('upd-t');
  const detalle = document.getElementById('upd-s');
  const acciones = document.getElementById('upd-act');
  const barra = document.getElementById('upd-bar');
  const progreso = document.getElementById('upd-i');

  const ICONO_DESCARGA = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v10"/><polyline points="8 11 12 15 16 11"/><path d="M5 19h14"/></svg>';
  const ICONO_LISTO = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 12.5 10 17.5 19 6.5"/></svg>';

  document.getElementById('upd-x').onclick = () => { aviso.hidden = true; };

  let busquedaManual = false;
  let resultadoManual = null; // <div> dentro de la tarjeta "Acerca de"

  function boton(texto, clase, accion) {
    const b = document.createElement('button');
    b.className = clase; b.textContent = texto; b.onclick = accion;
    return b;
  }

  BESALU.actualizaciones.alCambiar((info) => {
    if (!info) return;
    if (info.state === 'available' || info.state === 'downloading') {
      aviso.hidden = false;
      icono.innerHTML = ICONO_DESCARGA;
      titulo.textContent = 'Descargando actualización…';
      detalle.textContent = info.percent != null ? info.percent + '%' : (info.version ? 'Versión ' + info.version : '');
      acciones.innerHTML = '';
      barra.hidden = false;
      progreso.style.width = (info.percent || 0) + '%';
      if (resultadoManual) resultadoManual.textContent = 'Descargando versión nueva…';
    } else if (info.state === 'downloaded') {
      aviso.hidden = false;
      icono.innerHTML = ICONO_LISTO;
      titulo.textContent = 'Versión ' + (info.version || '') + ' lista';
      detalle.textContent = 'Se instalará sola al cerrar la app.';
      barra.hidden = true;
      acciones.innerHTML = '';
      acciones.appendChild(boton('Reiniciar y actualizar', 'btn btn--pos btn--sm', () => BESALU.actualizaciones.instalar()));
      acciones.appendChild(boton('Más tarde', 'btn btn--ghost btn--sm', () => { aviso.hidden = true; }));
      if (resultadoManual) resultadoManual.textContent = 'Versión ' + (info.version || '') + ' lista para instalar.';
    } else if (info.state === 'none') {
      if (busquedaManual) { busquedaManual = false; if (resultadoManual) resultadoManual.textContent = 'Ya tenés la última versión.'; }
    } else if (info.state === 'error') {
      if (busquedaManual) { busquedaManual = false; if (resultadoManual) resultadoManual.textContent = 'No se pudo buscar (¿hay internet?).'; }
    }
  });

  // Tarjeta "Acerca de" dentro de Ajustes (se agrega cada vez que se abre Ajustes).
  const vistaAjustes = document.getElementById('v-ajustes');
  if (vistaAjustes) new MutationObserver(agregarAcercaDe).observe(vistaAjustes, { childList: true });

  function agregarAcercaDe() {
    const grilla = vistaAjustes.querySelector('.cfg-grid');
    if (!grilla || document.getElementById('acerca-de')) return;

    const tarjeta = document.createElement('div');
    tarjeta.className = 'card glass';
    tarjeta.id = 'acerca-de';
    tarjeta.innerHTML = '<h2>Acerca de</h2>';

    const fila = document.createElement('div');
    fila.className = 'cfg-row';
    fila.innerHTML = '<div class="l">Versión instalada</div>';
    const version = document.createElement('span');
    version.className = 'pill pill--accent';
    version.textContent = '…';
    fila.appendChild(version);
    tarjeta.appendChild(fila);

    resultadoManual = document.createElement('div');
    resultadoManual.className = 'mini';
    resultadoManual.style.marginTop = '8px';

    const buscar = boton('Buscar actualizaciones', 'btn btn--ghost btn--sm', async () => {
      busquedaManual = true;
      resultadoManual.textContent = 'Buscando…';
      const r = await BESALU.actualizaciones.buscar();
      if (r && r.state === 'dev') { busquedaManual = false; resultadoManual.textContent = 'Las actualizaciones funcionan en la app instalada.'; }
      else if (r && r.state === 'error') { busquedaManual = false; resultadoManual.textContent = 'No se pudo buscar (¿hay internet?).'; }
    });
    buscar.style.marginTop = '12px';
    tarjeta.appendChild(buscar);
    tarjeta.appendChild(resultadoManual);
    grilla.appendChild(tarjeta);

    BESALU.version().then((v) => { version.textContent = 'v' + v; });
  }
})();
