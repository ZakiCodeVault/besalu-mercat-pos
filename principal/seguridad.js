/**
 * seguridad.js — Protecciones de Electron para la caja.
 *
 *  - Cada pantalla corre en sandbox, sin Node, con aislamiento de contexto.
 *  - Solo la pantalla del POS (interfaz/index.html) puede pedir operaciones al
 *    sistema: cualquier otro origen que intente usar el IPC se rechaza.
 *  - Ninguna ventana puede navegar a otra página ni abrir ventanas nuevas; los
 *    enlaces https se abren en el navegador del sistema.
 *  - Se niegan todos los permisos del navegador (cámara, micrófono, ubicación,
 *    notificaciones…): la caja no los necesita.
 *  - En la app instalada no hay herramientas de desarrollador.
 *
 * Además, al compilar se apagan funciones peligrosas del ejecutable (fuses en
 * package.json): no se puede usar como "node" ni recibir código por variables
 * de entorno o depuración, y solo carga la app empaquetada y verificada.
 */
const { app, session, shell } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const PANTALLA = pathToFileURL(path.join(__dirname, '..', 'interfaz', 'index.html')).href;

const sinFragmento = (url) => String(url || '').split('#')[0].split('?')[0];

/** ¿El pedido IPC viene del marco principal de la pantalla del POS? */
function remitenteValido(evento) {
  const marco = evento && evento.senderFrame;
  if (!marco || marco.parent) return false;               // solo el marco principal, nunca un iframe
  return sinFragmento(marco.url) === PANTALLA;
}

/** Opciones de la ventana principal. */
function preferenciasVentana(precarga) {
  return {
    preload: precarga,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webSecurity: true,
    devTools: !app.isPackaged,
    spellcheck: false,
    navigateOnDragDrop: false,
    backgroundThrottling: false
  };
}

/** Se llama antes de que la app esté lista. */
function antesDeIniciar() {
  app.enableSandbox();   // sandbox para todo proceso de pantalla, aunque alguien olvide pedirlo

  // Aplica a todas las pantallas (la principal y la oculta que genera los PDF)
  app.on('web-contents-created', (_e, contenido) => {
    contenido.on('will-navigate', (evento, url) => { if (sinFragmento(url) !== PANTALLA) evento.preventDefault(); });
    contenido.on('will-redirect', (evento, url) => { if (sinFragmento(url) !== PANTALLA) evento.preventDefault(); });
    contenido.on('will-attach-webview', (evento) => evento.preventDefault());
    contenido.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//i.test(url)) shell.openExternal(url);   // solo enlaces web seguros, en el navegador
      return { action: 'deny' };
    });
  });
}

/** Se llama cuando la app está lista (antes de crear ventanas). */
function alIniciar() {
  const s = session.defaultSession;
  s.setPermissionRequestHandler((_c, _permiso, responder) => responder(false));
  s.setPermissionCheckHandler(() => false);
  s.setDevicePermissionHandler(() => false);
  // Solo archivos locales de la app: ninguna conexión desde la pantalla hacia internet
  s.webRequest.onBeforeRequest((detalle, responder) => {
    const permitido = /^(file|devtools|data|blob):/i.test(detalle.url);
    responder({ cancel: !permitido });
  });
}

/**
 * Tapa secretos antes de escribir el registro de errores (por si alguna
 * librería incluye un token o una contraseña en un mensaje).
 */
const PATRONES_SECRETOS = [
  [/(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[oculto]'],
  [/((?:access|refresh)_token["'=:\s]+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[oculto]'],
  [/(\b(?:password|contrase(?:ñ|n)a|pass|pin|secret)["'\s]*[=:]\s*["']?)[^"'\s,&}]+/gi, '$1[oculto]'],
  [/(-----BEGIN [A-Z ]*PRIVATE KEY-----)[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----)/g, '$1[oculto]$2']
];
function ocultarSecretos(texto) {
  let t = String(texto);
  for (const [patron, reemplazo] of PATRONES_SECRETOS) t = t.replace(patron, reemplazo);
  return t;
}
/** Para electron-log: aplica ocultarSecretos a cada parte del mensaje. */
function filtroRegistro(mensaje) {
  mensaje.data = mensaje.data.map((d) => {
    if (d instanceof Error) return ocultarSecretos(d.stack || d.message);
    if (typeof d === 'string') return ocultarSecretos(d);
    try { return ocultarSecretos(JSON.stringify(d)); } catch (e) { return d; }
  });
  return mensaje;
}

module.exports = { PANTALLA, remitenteValido, preferenciasVentana, antesDeIniciar, alIniciar, ocultarSecretos, filtroRegistro };
