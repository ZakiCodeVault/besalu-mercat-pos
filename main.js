const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const path = require('path');
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');

// --- Log de errores del updater en la carpeta de datos del usuario ---
// electron-log guarda en %APPDATA%\Besalu Mercat POS\logs\main.log
log.transports.file.level = 'info';
autoUpdater.logger = log;
autoUpdater.autoDownload = true;          // descarga en segundo plano
autoUpdater.autoInstallOnAppQuit = true;  // instala al cerrar si no reinician antes

let win = null;
const FOUR_HOURS = 4 * 60 * 60 * 1000;

function send(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#eaeef4',
    title: 'Besalu Mercat POS',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  // Sin menu: asi las teclas F1-F6 y F12 llegan directo a la caja.
  Menu.setApplicationMenu(null);

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.maximize());

  // Enlaces externos abren en el navegador del sistema, no dentro de la app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function wireUpdaterEvents() {
  autoUpdater.on('checking-for-update', () => send('update-status', { state: 'checking' }));
  autoUpdater.on('update-available', (info) => send('update-status', { state: 'available', version: info && info.version }));
  autoUpdater.on('update-not-available', () => send('update-status', { state: 'none' }));
  autoUpdater.on('download-progress', (p) => send('update-status', { state: 'downloading', percent: Math.round(p && p.percent || 0) }));
  autoUpdater.on('update-downloaded', (info) => send('update-status', { state: 'downloaded', version: info && info.version }));
  autoUpdater.on('error', (err) => {
    log.error('[updater]', err);
    send('update-status', { state: 'error', message: String((err && err.message) || err) });
  });
}

function setupUpdates() {
  // IPC siempre disponible (en desarrollo responde 'dev').
  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.handle('updates:check', async () => {
    if (!app.isPackaged) return { state: 'dev' };
    try { await autoUpdater.checkForUpdates(); return { state: 'checked' }; }
    catch (e) { log.error('[updater] check', e); return { state: 'error', message: String((e && e.message) || e) }; }
  });
  ipcMain.on('updates:install', () => {
    try { autoUpdater.quitAndInstall(); } catch (e) { log.error('[updater] install', e); }
  });

  // Chequeos automaticos solo en la app instalada.
  if (!app.isPackaged) return;
  wireUpdaterEvents();
  const check = () => autoUpdater.checkForUpdates().catch((e) => log.error('[updater] auto', e));
  check();
  setInterval(check, FOUR_HOURS);
}

app.whenReady().then(() => {
  createWindow();
  setupUpdates();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
