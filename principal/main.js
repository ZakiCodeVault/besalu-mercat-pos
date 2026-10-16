/**
 * main.js — Proceso principal de Electron.
 *
 * - Abre la ventana del POS (interfaz/index.html).
 * - Abre la base de datos SQLite (baseDatos.js) y la expone por IPC.
 * - Busca e instala actualizaciones desde GitHub Releases.
 */
const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const path = require('path');
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');
const datos = require('./baseDatos');

// Log en %APPDATA%\Besalu Mercat POS\logs\main.log
log.transports.file.level = 'info';
autoUpdater.logger = log;
autoUpdater.autoDownload = true;          // descarga en segundo plano
autoUpdater.autoInstallOnAppQuit = true;  // instala al cerrar si no reinician antes

let ventana = null;
const CUATRO_HORAS = 4 * 60 * 60 * 1000;

function enviar(canal, info) {
  if (ventana && !ventana.isDestroyed()) ventana.webContents.send(canal, info);
}

/* ---------------- Ventana ---------------- */
function crearVentana() {
  ventana = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#eef1f6',
    title: 'Besalu Mercat POS',
    show: false,                       // se muestra cuando ya pintó (sin parpadeo)
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'precarga.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false      // la caja no se "duerme" en segundo plano
    }
  });

  Menu.setApplicationMenu(null);       // sin menú: F1-F6 y F12 llegan a la caja
  ventana.loadFile(path.join(__dirname, '..', 'interfaz', 'index.html'));
  ventana.once('ready-to-show', () => { ventana.maximize(); ventana.show(); });

  // Enlaces externos se abren en el navegador del sistema.
  ventana.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

/* ---------------- IPC: datos ---------------- */
// Envuelve cada operación: registra el error en el log y avisa a la interfaz.
function manejar(canal, fn) {
  ipcMain.handle(canal, async (_e, ...args) => {
    try { return { ok: true, valor: fn(...args) }; }
    catch (e) { log.error('[datos] ' + canal, e); return { ok: false, error: String((e && e.message) || e) }; }
  });
}

function configurarIpc() {
  manejar('datos:cargar', () => datos.cargar());
  manejar('datos:guardarProducto', (p) => datos.guardarProducto(p));
  manejar('datos:borrarProducto', (cod) => datos.borrarProducto(cod));
  manejar('datos:registrarVenta', (v, prods, seq) => datos.registrarVenta(v, prods, seq));
  manejar('datos:registrarAnulacion', (folio, prods) => datos.registrarAnulacion(folio, prods));
  manejar('datos:guardarConfig', (clave, valor) => datos.escribirConfig(clave, valor));
  manejar('datos:reiniciar', () => datos.reiniciar());

  ipcMain.handle('app:version', () => app.getVersion());

  // Imprime el ticket en la impresora predeterminada de Windows, sin diálogo.
  // La hoja de estilos (@media print) deja visible solo el ticket.
  ipcMain.handle('imprimir', () => new Promise((resolver) => {
    if (!ventana) return resolver({ ok: false, motivo: 'Sin ventana' });
    ventana.webContents.print(
      { silent: true, printBackground: true, margins: { marginType: 'none' } },
      (ok, motivo) => {
        if (!ok) log.warn('[impresion]', motivo);
        resolver({ ok, motivo: motivo || '' });
      });
  }));
  ipcMain.handle('actualizaciones:buscar', async () => {
    if (!app.isPackaged) return { state: 'dev' };
    try { await autoUpdater.checkForUpdates(); return { state: 'checked' }; }
    catch (e) { log.error('[updater] buscar', e); return { state: 'error', message: String((e && e.message) || e) }; }
  });
  ipcMain.on('actualizaciones:instalar', () => {
    try { autoUpdater.quitAndInstall(); } catch (e) { log.error('[updater] instalar', e); }
  });
}

/* ---------------- Actualizaciones ---------------- */
function configurarActualizaciones() {
  if (!app.isPackaged) return;  // en desarrollo no se busca nada
  autoUpdater.on('update-available', (i) => enviar('actualizacion', { state: 'available', version: i && i.version }));
  autoUpdater.on('update-not-available', () => enviar('actualizacion', { state: 'none' }));
  autoUpdater.on('download-progress', (p) => enviar('actualizacion', { state: 'downloading', percent: Math.round((p && p.percent) || 0) }));
  autoUpdater.on('update-downloaded', (i) => enviar('actualizacion', { state: 'downloaded', version: i && i.version }));
  autoUpdater.on('error', (err) => {
    log.error('[updater]', err);
    enviar('actualizacion', { state: 'error', message: String((err && err.message) || err) });
  });
  const buscar = () => autoUpdater.checkForUpdates().catch((e) => log.error('[updater] auto', e));
  setTimeout(buscar, 8000);           // espera a que la caja arranque antes de buscar
  setInterval(buscar, CUATRO_HORAS);
}

/* ---------------- Ciclo de vida ---------------- */
// Una sola instancia: si abren el acceso directo otra vez, se enfoca la ventana existente.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (ventana) { if (ventana.isMinimized()) ventana.restore(); ventana.focus(); }
  });

  app.whenReady().then(() => {
    const archivo = datos.abrir(app.getPath('userData'));
    log.info('[datos] base en', archivo);
    configurarIpc();
    crearVentana();
    configurarActualizaciones();
  });

  app.on('window-all-closed', () => {
    datos.cerrar();
    app.quit();
  });
}
