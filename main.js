const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const path = require('path');
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');
const { Database } = require('node-sqlite3-wasm');

log.transports.file.level = 'info';
autoUpdater.logger = log;
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

let win = null;
let db = null;
const FOUR_HOURS = 4 * 60 * 60 * 1000;

function send(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

/* ---------------- SQLite (datos locales, en la carpeta del usuario) ---------------- */
function initDb() {
  const file = path.join(app.getPath('userData'), 'besalu.db');
  db = new Database(file);
  db.run("CREATE TABLE IF NOT EXISTS products(id INTEGER, cod TEXT, nom TEXT, iva INTEGER, precio REAL, costo REAL, base REAL, imp REAL, envio REAL, margen REAL, stock REAL, vence TEXT, cabys TEXT)");
  db.run("CREATE TABLE IF NOT EXISTS sales(folio INTEGER, cons TEXT, ts INTEGER, metodo TEXT, total REAL, base REAL, imp REAL, pago REAL, cambio REAL, anulada INTEGER, cli_nombre TEXT, cli_cedula TEXT, byrate TEXT, items TEXT)");
  db.run("CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT)");
  log.info('[db] abierta en', file);
}

function kvGet(k, def) {
  try { const r = db.get("SELECT v FROM kv WHERE k=?", [k]); return r ? JSON.parse(r.v) : def; }
  catch (e) { return def; }
}
function kvSet(k, val) { db.run("INSERT OR REPLACE INTO kv(k,v) VALUES(?,?)", [k, JSON.stringify(val)]); }

function loadAll() {
  const products = db.all("SELECT * FROM products").map(p => ({
    id: p.id, cod: p.cod, nom: p.nom, iva: p.iva, precio: p.precio, costo: p.costo,
    base: p.base, imp: p.imp, envio: p.envio, margen: p.margen, stock: p.stock,
    vence: p.vence || '', cabys: p.cabys || ''
  }));
  const sales = db.all("SELECT * FROM sales ORDER BY ts").map(s => ({
    folio: s.folio, cons: s.cons, ts: s.ts, metodo: s.metodo,
    total: s.total, base: s.base, imp: s.imp, pago: s.pago, cambio: s.cambio,
    anulada: !!s.anulada,
    cliente: s.cli_nombre ? { nombre: s.cli_nombre, cedula: s.cli_cedula || '' } : null,
    byRate: s.byrate ? JSON.parse(s.byrate) : {},
    items: s.items ? JSON.parse(s.items) : []
  }));
  return {
    products, sales,
    settings: kvGet('settings', null),
    shift: kvGet('shift', { open: false }),
    archivo: kvGet('archivo', []),
    seq: kvGet('seq', { folio: 1042 })
  };
}

function saveAll(d) {
  if (!d || !db) return;
  db.run("BEGIN");
  try {
    if (Array.isArray(d.products)) {
      db.run("DELETE FROM products");
      for (const p of d.products) db.run(
        "INSERT INTO products(id,cod,nom,iva,precio,costo,base,imp,envio,margen,stock,vence,cabys) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [p.id || 0, p.cod || '', p.nom || '', p.iva || 0, p.precio || 0, p.costo || 0,
         (p.base == null ? null : p.base), (p.imp == null ? null : p.imp),
         (p.envio == null ? null : p.envio), (p.margen == null ? null : p.margen),
         p.stock || 0, p.vence || '', p.cabys || '']);
    }
    if (Array.isArray(d.sales)) {
      db.run("DELETE FROM sales");
      for (const s of d.sales) db.run(
        "INSERT INTO sales(folio,cons,ts,metodo,total,base,imp,pago,cambio,anulada,cli_nombre,cli_cedula,byrate,items) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [s.folio || 0, s.cons || '', s.ts || 0, s.metodo || '', s.total || 0, s.base || 0, s.imp || 0,
         s.pago || 0, s.cambio || 0, s.anulada ? 1 : 0,
         s.cliente ? s.cliente.nombre : null, s.cliente ? (s.cliente.cedula || '') : null,
         JSON.stringify(s.byRate || {}), JSON.stringify(s.items || [])]);
    }
    if (d.settings) kvSet('settings', d.settings);
    if (d.shift) kvSet('shift', d.shift);
    if (d.archivo) kvSet('archivo', d.archivo);
    if (d.seq) kvSet('seq', d.seq);
    db.run("COMMIT");
  } catch (e) {
    try { db.run("ROLLBACK"); } catch (_) {}
    log.error('[db] saveAll', e);
  }
}

/* ---------------- Ventana ---------------- */
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
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.maximize());
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

/* ---------------- IPC ---------------- */
function setupIpc() {
  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.handle('db:load', () => { try { return loadAll(); } catch (e) { log.error('[db] load', e); return null; } });
  ipcMain.handle('db:save', (_e, data) => { try { saveAll(data); return true; } catch (e) { log.error('[db] save', e); return false; } });
  ipcMain.handle('updates:check', async () => {
    if (!app.isPackaged) return { state: 'dev' };
    try { await autoUpdater.checkForUpdates(); return { state: 'checked' }; }
    catch (e) { log.error('[updater] check', e); return { state: 'error', message: String((e && e.message) || e) }; }
  });
  ipcMain.on('updates:install', () => { try { autoUpdater.quitAndInstall(); } catch (e) { log.error('[updater] install', e); } });
}

/* ---------------- Actualizaciones ---------------- */
function setupUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.on('checking-for-update', () => send('update-status', { state: 'checking' }));
  autoUpdater.on('update-available', (info) => send('update-status', { state: 'available', version: info && info.version }));
  autoUpdater.on('update-not-available', () => send('update-status', { state: 'none' }));
  autoUpdater.on('download-progress', (p) => send('update-status', { state: 'downloading', percent: Math.round((p && p.percent) || 0) }));
  autoUpdater.on('update-downloaded', (info) => send('update-status', { state: 'downloaded', version: info && info.version }));
  autoUpdater.on('error', (err) => { log.error('[updater]', err); send('update-status', { state: 'error', message: String((err && err.message) || err) }); });
  const check = () => autoUpdater.checkForUpdates().catch((e) => log.error('[updater] auto', e));
  check();
  setInterval(check, FOUR_HOURS);
}

app.whenReady().then(() => {
  initDb();
  setupIpc();
  createWindow();
  setupUpdates();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  try { if (db) db.close(); } catch (e) {}
  if (process.platform !== 'darwin') app.quit();
});
