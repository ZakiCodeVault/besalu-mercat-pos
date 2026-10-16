/**
 * actualizaciones.js — Aviso de actualización (abajo al centro).
 *
 * El proceso principal descarga la versión nueva en segundo plano; aquí solo se
 * muestra el progreso y el botón "Reiniciar y actualizar". El aviso está oculto
 * mientras no haya una versión nueva.
 */
let _busquedaManual = null;   // botón de Ajustes que pidió buscar (para mostrar el resultado)

function iniciarAvisoActualizaciones() {
  if (!window.BESALU || !BESALU.actualizaciones) return;
  const aviso = $('#upd'), icono = $('#upd-ic'), titulo = $('#upd-t'), detalle = $('#upd-s'), acciones = $('#upd-act'), barra = $('#upd-bar'), progreso = $('#upd-i');
  $('#upd-x').onclick = () => { aviso.hidden = true; };

  BESALU.actualizaciones.alCambiar((info) => {
    if (!info) return;
    if (info.state === 'available' || info.state === 'downloading') {
      aviso.hidden = false;
      icono.innerHTML = svg('download', 20);
      titulo.textContent = 'Descargando actualización…';
      detalle.textContent = info.percent != null ? info.percent + '%' : (info.version ? 'Versión ' + info.version : '');
      acciones.innerHTML = '';
      barra.hidden = false;
      progreso.style.width = (info.percent || 0) + '%';
    } else if (info.state === 'downloaded') {
      aviso.hidden = false;
      icono.innerHTML = svg('check', 20);
      titulo.textContent = 'Versión ' + (info.version || '') + ' lista';
      detalle.textContent = 'Se instalará sola al cerrar la app.';
      barra.hidden = true;
      acciones.innerHTML = '';
      acciones.append(
        el('button', { class: 'btn btn--pos btn--sm', onclick: () => BESALU.actualizaciones.instalar() }, 'Reiniciar y actualizar'),
        el('button', { class: 'btn btn--ghost btn--sm', onclick: () => { aviso.hidden = true; } }, 'Más tarde'));
    } else if (info.state === 'none' && _busquedaManual) {
      toast('Ya tenés la última versión'); _busquedaManual = null;
    } else if (info.state === 'error' && _busquedaManual) {
      toast('No se pudo buscar actualizaciones', 'err', '¿Hay internet?'); _busquedaManual = null;
    }
  });
}

async function buscarActualizaciones(boton) {
  _busquedaManual = boton;
  const r = await BESALU.actualizaciones.buscar();
  if (r && r.state === 'dev') { _busquedaManual = null; toast('Las actualizaciones funcionan en la app instalada'); }
  else if (r && r.state === 'error') { _busquedaManual = null; toast('No se pudo buscar actualizaciones', 'err', '¿Hay internet?'); }
}
