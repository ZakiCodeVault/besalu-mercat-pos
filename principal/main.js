/**
 * main.js — Proceso principal de Electron.
 *
 * Al arrancar:
 *   1. Abre la base de datos (si no abre, ofrece recuperar el último respaldo).
 *   2. Verifica la integridad (y repara el stock desde el kárdex si hace falta).
 *   3. Abre la ventana del POS.
 *   4. Hace el respaldo diario y busca actualizaciones.
 */
const T0 = Date.now();
const { app, BrowserWindow, Menu, ipcMain, dialog, safeStorage, Notification, utilityProcess } = require('electron');
const fs = require('fs');
const path = require('path');
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');
const datos = require('./datos');
const ipc = require('./ipc');
const seguridad = require('./seguridad');
const hacienda = require('./hacienda/conector');

/** Tiempos del arranque (quedan en el registro; con BESALU_MEDIR=1 también en la consola). */
const tiempos = [['módulos cargados', Date.now() - T0]];
function marcar(etapa) {
  tiempos.push([etapa, Date.now() - T0]);
  if (process.env.BESALU_MEDIR === '1') console.log('[arranque] ' + etapa + ': ' + (Date.now() - T0) + ' ms');
}

log.transports.file.level = 'info';
log.hooks.push(seguridad.filtroRegistro);   // nunca escribir tokens ni contraseñas en el registro
autoUpdater.logger = log;
autoUpdater.autoDownload = true;          // descarga en segundo plano
autoUpdater.autoInstallOnAppQuit = true;  // instala al cerrar si no reinician antes

let ventana = null;
const estadoInicio = { integridad: null };
const UNA_HORA = 60 * 60 * 1000;
if (process.platform === 'win32') app.setAppUserModelId('com.besalu.mercatpos');   // las notificaciones de Windows salen con el nombre de la app

function enviar(canal, info) {
  if (ventana && !ventana.isDestroyed()) ventana.webContents.send(canal, info);
}

/* ---------------- Base de datos ---------------- */
function abrirBase(carpeta) {
  try {
    datos.conexion.abrir(carpeta);
  } catch (e) {
    log.error('[datos] no abre', e);
    if (e.codigo === 'MIGRACION') {
      // La actualización del esquema no se aplicó y la base quedó como estaba:
      // NUNCA se reemplaza por un respaldo (se perdería lo ingresado después).
      dialog.showErrorBox('Besalú Mercat POS', e.message + (e.copia ? '\n\nCopia de seguridad hecha antes de intentarlo:\n' + e.copia : '') +
        '\n\nLa app se va a cerrar. Sus datos están a salvo: no se borró ni se cambió nada.');
      throw e;
    }
    // Solo un archivo realmente dañado se puede reemplazar por el último respaldo
    const danada = /SQLITE_(CORRUPT|NOTADB)/.test(String(e.code || '')) || /malformed|not a database/i.test(String(e.message));
    if (!danada) { dialog.showErrorBox('Besalú Mercat POS', 'No se pudo abrir la base de datos:\n' + e.message + '\n\nSus datos no se tocaron.'); throw e; }
    if (!recuperarDesdeRespaldo(carpeta, e)) throw e;
    datos.conexion.abrir(carpeta);
  }
  datos.respaldos.configurar(carpeta);
  log.info('[datos] base en', datos.conexion.rutaArchivo());
}

/**
 * Revisión completa de la base, en un proceso aparte y con conexión de solo
 * lectura: la ventana abre de una vez y la caja no se traba mientras revisa.
 * Si solo hay existencias descuadradas, se corrigen desde el kárdex (el kárdex manda).
 */
function revisarBaseEnSegundoPlano() {
  const terminar = (v) => {
    if (!v.ok && v.problemas.every((p) => p.startsWith('Stock de'))) {
      datos.conexion.repararStock();
      v = datos.conexion.verificarIntegridad();
    }
    estadoInicio.integridad = v;
    if (!v.ok) log.error('[integridad]', v.problemas);
    marcar('base revisada');
    enviar('integridad', v);
  };
  const enEsteProceso = () => { try { terminar(datos.conexion.verificarIntegridad()); } catch (e) { log.error('[integridad]', e); } };
  try {
    const hijo = utilityProcess.fork(path.join(__dirname, 'revision-proceso.js'), [], { serviceName: 'Revisión de la base de datos' });
    let listo = false;
    hijo.on('message', (m) => {
      listo = true;
      if (m && m.ok) terminar(m.resultado);
      else { log.warn('[integridad] proceso aparte:', m && m.error); enEsteProceso(); }
    });
    hijo.on('exit', () => { if (!listo) { log.warn('[integridad] el proceso aparte terminó sin responder'); enEsteProceso(); } });
    hijo.postMessage({ ruta: datos.conexion.rutaArchivo(), fecha: datos.montos.fechaLocal() });
  } catch (e) {
    log.warn('[integridad] sin proceso aparte', e);
    enEsteProceso();
  }
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

/* ---------------- Hacienda ---------------- */
/** Cifrado de las credenciales con el sistema operativo (DPAPI en Windows). */
function cifradorDelSistema() {
  // Solo para las pruebas automáticas de desarrollo (nunca en la app instalada)
  if (!app.isPackaged && process.env.BESALU_CIFRADO_PRUEBA === '1') {
    return { disponible: () => true, cifrar: (t) => 'prueba:' + Buffer.from(t, 'utf8').toString('base64'),
      descifrar: (c) => Buffer.from(String(c).replace(/^prueba:/, ''), 'base64').toString('utf8') };
  }
  return {
    disponible: () => safeStorage.isEncryptionAvailable(),
    cifrar: (t) => safeStorage.encryptString(String(t)).toString('base64'),
    descifrar: (c) => safeStorage.decryptString(Buffer.from(c, 'base64'))
  };
}

function iniciarHacienda() {
  // Las pruebas automáticas apuntan a servidores simulados (nunca en la app instalada)
  const urls = !app.isPackaged && process.env.BESALU_HACIENDA_URLS ? JSON.parse(process.env.BESALU_HACIENDA_URLS) : null;
  const smtp = !app.isPackaged && process.env.BESALU_SMTP_PRUEBA ? JSON.parse(process.env.BESALU_SMTP_PRUEBA) : null;
  hacienda.configurar({ cifrador: cifradorDelSistema(), urls, smtp, alCambiar: (e) => enviar('hacienda', e) });
  hacienda.iniciar(urls ? 2000 : 30000);
}

/* ---------------- Ventana ---------------- */
function crearVentana() {
  ventana = new BrowserWindow({
    width: 1280, height: 820, minWidth: 1024, minHeight: 680,
    backgroundColor: '#eef1f6', title: 'Besalu Mercat POS', show: false, autoHideMenuBar: true,
    webPreferences: seguridad.preferenciasVentana(path.join(__dirname, 'precarga.js'))
  });
  Menu.setApplicationMenu(null);   // sin menú: las teclas F llegan a la caja
  ventana.loadFile(path.join(__dirname, '..', 'interfaz', 'index.html'));
  ventana.once('ready-to-show', () => {
    marcar('ventana lista'); ventana.maximize(); ventana.show();
    setTimeout(revisarBaseEnSegundoPlano, 1500);   // con la caja ya a la vista
  });
}

/* ---------------- Impresión y actualizaciones ---------------- */
function configurarSistema() {
  // Solo la pantalla del POS puede usar estos canales
  const manejar = (canal, fn) => ipcMain.handle(canal, (e, ...a) => (seguridad.remitenteValido(e) ? fn(...a) : null));
  manejar('app:version', () => require('../package.json').version);
  ipcMain.on('app:lista', (e) => {
    if (!seguridad.remitenteValido(e)) return;
    marcar('pantalla lista');
    log.info('[arranque] ' + tiempos.map(([n, ms]) => n + ' ' + ms + ' ms').join(' · '));
  });

  // Imprime el ticket (#zona-impresion) en la impresora predeterminada, sin diálogo.
  manejar('imprimir', () => new Promise((resolver) => {
    if (!ventana) return resolver({ ok: false, motivo: 'Sin ventana' });
    ventana.webContents.print({ silent: true, printBackground: true, margins: { marginType: 'none' } },
      (ok, motivo) => { if (!ok) log.warn('[impresion]', motivo); resolver({ ok, motivo: motivo || '' }); });
  }));

  manejar('actualizaciones:buscar', async () => {
    if (!app.isPackaged) return { state: 'dev' };
    try { await autoUpdater.checkForUpdates(); return { state: 'checked' }; }
    catch (e) { log.error('[updater] buscar', e); return { state: 'error', message: String((e && e.message) || e) }; }
  });
  ipcMain.on('actualizaciones:instalar', (e) => {
    if (!seguridad.remitenteValido(e)) return;
    try { autoUpdater.quitAndInstall(); } catch (err) { log.error('[updater]', err); }
  });

  if (!app.isPackaged) return;
  autoUpdater.on('update-available', (i) => enviar('actualizacion', { state: 'available', version: i && i.version }));
  autoUpdater.on('update-not-available', () => enviar('actualizacion', { state: 'none' }));
  autoUpdater.on('download-progress', (p) => enviar('actualizacion', { state: 'downloading', percent: Math.round((p && p.percent) || 0) }));
  let avisada = null;
  autoUpdater.on('update-downloaded', (i) => {
    const version = i && i.version;
    enviar('actualizacion', { state: 'downloaded', version });
    // También una notificación de Windows: se ve aunque la app esté minimizada o detrás de otra ventana
    if (version && avisada !== version && Notification.isSupported()) {
      avisada = version;
      const n = new Notification({ title: 'Besalú Mercat POS ' + version + ' está lista',
        body: 'Toque "Reiniciar y actualizar" en la app cuando no esté cobrando. Si no, se instala sola al cerrarla.', silent: false });
      n.on('click', () => { if (ventana) { if (ventana.isMinimized()) ventana.restore(); ventana.show(); ventana.focus(); } });
      n.show();
    }
  });
  autoUpdater.on('error', (err) => { log.error('[updater]', err); enviar('actualizacion', { state: 'error', message: String((err && err.message) || err) }); });
  const buscar = () => autoUpdater.checkForUpdates().catch((e) => log.error('[updater] auto', e));
  setTimeout(buscar, 8000);
  setInterval(buscar, UNA_HORA);   // una versión publicada llega en menos de una hora
}

/* ---------------- Ciclo de vida ---------------- */
seguridad.antesDeIniciar();
if (!app.requestSingleInstanceLock()) {
  app.quit();   // ya hay una caja abierta: no abrir dos copias sobre la misma base
} else {
  app.on('second-instance', () => { if (ventana) { if (ventana.isMinimized()) ventana.restore(); ventana.focus(); } });

  app.whenReady().then(() => {
    seguridad.alIniciar();
    const carpeta = app.getPath('userData');
    marcar('electron listo');
    try { abrirBase(carpeta); } catch (e) { app.exit(1); return; }
    marcar('base abierta');
    ipc.registrar({ ventana: () => ventana, estadoInicio, carpetaDatos: carpeta });
    iniciarHacienda();
    configurarSistema();
    crearVentana();
    // Respaldo diario (y revisa cada hora por si la caja queda abierta varios días)
    const diario = () => datos.respaldos.siCorresponde().catch((e) => log.error('[respaldo diario]', e));
    setTimeout(diario, 15000);
    setInterval(diario, 60 * 60 * 1000);
  });

  app.on('window-all-closed', () => {
    hacienda.detener();
    datos.conexion.cerrar();   // cierra limpio (vuelca el WAL al archivo)
    app.quit();
  });
}
