/**
 * main.js — Proceso principal de Electron.
 *
 * Al arrancar:
 *   1. Abre la base de datos (si no abre, ofrece recuperar el último respaldo).
 *   2. Verifica la integridad (y repara el stock desde el kárdex si hace falta).
 *   3. Abre la ventana del POS.
 *   4. Hace el respaldo diario y busca actualizaciones.
 */
const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');
const datos = require('./datos');
const ipc = require('./ipc');

log.transports.file.level = 'info';
autoUpdater.logger = log;
autoUpdater.autoDownload = true;          // descarga en segundo plano
autoUpdater.autoInstallOnAppQuit = true;  // instala al cerrar si no reinician antes

let ventana = null;
const estadoInicio = { integridad: null };
const CUATRO_HORAS = 4 * 60 * 60 * 1000;

function enviar(canal, info) {
  if (ventana && !ventana.isDestroyed()) ventana.webContents.send(canal, info);
}

/* ---------------- Base de datos ---------------- */
function abrirBase(carpeta) {
  try {
    datos.conexion.abrir(carpeta);
  } catch (e) {
    log.error('[datos] no abre', e);
    if (!recuperarDesdeRespaldo(carpeta, e)) throw e;
    datos.conexion.abrir(carpeta);
  }
  datos.respaldos.configurar(carpeta);
  const v = datos.conexion.verificarIntegridad();
  if (!v.ok && v.problemas.every((p) => p.startsWith('Stock de'))) {
    datos.conexion.repararStock();            // el kárdex manda
    estadoInicio.integridad = datos.conexion.verificarIntegridad();
  } else {
    estadoInicio.integridad = v;
  }
  if (!estadoInicio.integridad.ok) log.error('[integridad]', estadoInicio.integridad.problemas);
  log.info('[datos] base en', datos.conexion.rutaArchivo());
}

/** Si la base está dañada, ofrece reemplazarla por el respaldo más reciente. */
function recuperarDesdeRespaldo(carpeta, error) {
  const dir = path.join(carpeta, 'respaldos');
  const lista = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^besalu-.*\.sqlite$/.test(f)).sort().reverse() : [];
  if (!lista.length) {
    dialog.showErrorBox('Besalú Mercat POS', 'No se pudo abrir la base de datos y no hay respaldos.\n\n' + error.message);
    return false;
  }
  const r = dialog.showMessageBoxSync({
    type: 'error', title: 'Besalú Mercat POS', buttons: ['Restaurar el último respaldo', 'Salir'], defaultId: 0,
    message: 'No se pudo abrir la base de datos.',
    detail: error.message + '\n\nÚltimo respaldo: ' + lista[0] + '\nLa base dañada se guardará aparte.'
  });
  if (r !== 0) return false;
  const actual = path.join(carpeta, datos.conexion.NOMBRE_ARCHIVO);
  if (fs.existsSync(actual)) fs.renameSync(actual, actual + '.danada-' + Date.now());
  for (const s of ['-wal', '-shm']) fs.rmSync(actual + s, { force: true });
  fs.copyFileSync(path.join(dir, lista[0]), actual);
  return true;
}

/* ---------------- Ventana ---------------- */
function crearVentana() {
  ventana = new BrowserWindow({
    width: 1280, height: 820, minWidth: 1024, minHeight: 680,
    backgroundColor: '#eef1f6', title: 'Besalu Mercat POS', show: false, autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'precarga.js'),
      contextIsolation: true, nodeIntegration: false, spellcheck: false, backgroundThrottling: false
    }
  });
  Menu.setApplicationMenu(null);   // sin menú: las teclas F llegan a la caja
  ventana.loadFile(path.join(__dirname, '..', 'interfaz', 'index.html'));
  ventana.once('ready-to-show', () => { ventana.maximize(); ventana.show(); });
  ventana.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

/* ---------------- Impresión y actualizaciones ---------------- */
function configurarSistema() {
  ipcMain.handle('app:version', () => require('../package.json').version);

  // Imprime el ticket (#zona-impresion) en la impresora predeterminada, sin diálogo.
  ipcMain.handle('imprimir', () => new Promise((resolver) => {
    if (!ventana) return resolver({ ok: false, motivo: 'Sin ventana' });
    ventana.webContents.print({ silent: true, printBackground: true, margins: { marginType: 'none' } },
      (ok, motivo) => { if (!ok) log.warn('[impresion]', motivo); resolver({ ok, motivo: motivo || '' }); });
  }));

  ipcMain.handle('actualizaciones:buscar', async () => {
    if (!app.isPackaged) return { state: 'dev' };
    try { await autoUpdater.checkForUpdates(); return { state: 'checked' }; }
    catch (e) { log.error('[updater] buscar', e); return { state: 'error', message: String((e && e.message) || e) }; }
  });
  ipcMain.on('actualizaciones:instalar', () => { try { autoUpdater.quitAndInstall(); } catch (e) { log.error('[updater]', e); } });

  if (!app.isPackaged) return;
  autoUpdater.on('update-available', (i) => enviar('actualizacion', { state: 'available', version: i && i.version }));
  autoUpdater.on('update-not-available', () => enviar('actualizacion', { state: 'none' }));
  autoUpdater.on('download-progress', (p) => enviar('actualizacion', { state: 'downloading', percent: Math.round((p && p.percent) || 0) }));
  autoUpdater.on('update-downloaded', (i) => enviar('actualizacion', { state: 'downloaded', version: i && i.version }));
  autoUpdater.on('error', (err) => { log.error('[updater]', err); enviar('actualizacion', { state: 'error', message: String((err && err.message) || err) }); });
  const buscar = () => autoUpdater.checkForUpdates().catch((e) => log.error('[updater] auto', e));
  setTimeout(buscar, 8000);
  setInterval(buscar, CUATRO_HORAS);
}

/* ---------------- Ciclo de vida ---------------- */
if (!app.requestSingleInstanceLock()) {
  app.quit();   // ya hay una caja abierta: no abrir dos copias sobre la misma base
} else {
  app.on('second-instance', () => { if (ventana) { if (ventana.isMinimized()) ventana.restore(); ventana.focus(); } });

  app.whenReady().then(() => {
    const carpeta = app.getPath('userData');
    try { abrirBase(carpeta); } catch (e) { app.exit(1); return; }
    ipc.registrar({ ventana: () => ventana, estadoInicio, carpetaDatos: carpeta });
    configurarSistema();
    crearVentana();
    // Respaldo diario (y revisa cada hora por si la caja queda abierta varios días)
    const diario = () => datos.respaldos.siCorresponde().catch((e) => log.error('[respaldo diario]', e));
    setTimeout(diario, 15000);
    setInterval(diario, 60 * 60 * 1000);
  });

  app.on('window-all-closed', () => {
    datos.conexion.cerrar();   // cierra limpio (vuelca el WAL al archivo)
    app.quit();
  });
}
