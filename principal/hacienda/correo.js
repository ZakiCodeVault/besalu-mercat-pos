/**
 * correo.js — Envío de cada factura aceptada por Hacienda al correo del receptor.
 *
 * Hacienda exige que el emisor le haga llegar al receptor el comprobante: el
 * XML firmado, la respuesta de Hacienda y la representación gráfica (PDF).
 * Cuando una FACTURA (01) pasa a "aceptado" y el cliente dio su correo, el
 * conector la deja en esta cola:
 *
 *   aceptada ──▶ pendiente ──SMTP──▶ enviado
 *                   │   └─ sin internet / servidor ocupado: se reintenta solo
 *                   └─ el servidor rechaza la dirección ──▶ error ("Reenviar" a otra)
 *
 *  - Se envía con el servidor SMTP del negocio (Ajustes → Correo). La contraseña
 *    se guarda cifrada con el sistema operativo, igual que las de Hacienda, y
 *    nunca se escribe en la bitácora.
 *  - Copia oculta al correo del negocio, si se activa.
 *  - El estado vive en columnas propias (correo_*): las columnas fiscales del
 *    comprobante no se tocan.
 *  - Tiene su propio turno: un servidor de correo lento no frena el envío a Hacienda.
 */
const nodemailer = require('nodemailer');
const { obtener, leerConfig, escribirConfig, leerAjustes, registrar } = require('../datos/conexion');
const ventas = require('../datos/ventas');
const { fechaLocal } = require('../datos/montos');
const pdf = require('./pdf');

const CLAVE = 'correo';
const SEGURIDAD = { ssl: 'SSL/TLS', starttls: 'STARTTLS', ninguna: 'Ninguna' };
const ESPERAS = [30, 60, 120, 300, 600, 900, 1800];   // segundos entre reintentos
const ESPERA_CONFIGURACION = 1800;                     // credenciales o servidor mal configurados
const LOTE = 10;
const RE_CORREO = /^[^@\s,;<>"]+@[^@\s,;<>"]+\.[^@\s,;<>".]{2,}$/;
const RED = new Set(['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN',
  'EHOSTUNREACH', 'ENETUNREACH', 'ENETDOWN', 'EPIPE']);

let cifrador = null;   // { disponible(), cifrar(texto), descifrar(texto) } — el mismo de Hacienda
let opcionesPrueba = null;   // solo pruebas automáticas (p. ej. confiar en un certificado propio)
let avisar = () => {};
let turno = Promise.resolve(), procesando = null, pronto = null;
let transporte = null;   // { huella, t }
const red = { enLinea: null, ultimoError: null, ultimoEnvio: null };

const ahora = () => fechaLocal();
const enSegundos = (s) => fechaLocal(new Date(Date.now() + s * 1000));
const correoValido = (c) => RE_CORREO.test(String(c || '').trim());
const correoNegocio = (a = leerAjustes()) => String(a.correo || '').split(/[;,\s]+/).find(correoValido) || '';

function configurar({ cifrador: c, opciones, alCambiar } = {}) {
  cifrador = c || null;
  opcionesPrueba = opciones || null;
  avisar = alCambiar || (() => {});
  transporte = null;
}

/* ---------------- Configuración (Ajustes → Correo) ---------------- */

function guardado() { return leerConfig(CLAVE, null) || {}; }

/** Datos visibles (sin la contraseña). */
function leer() {
  const g = guardado();
  return {
    activo: !!g.activo,
    servidor: g.servidor || '', puerto: g.puerto || 465, seguridad: g.seguridad || 'ssl',
    usuario: g.usuario || '', tieneContrasena: !!g.contrasena,
    remitente: g.remitente || '', nombreRemitente: g.nombreRemitente || '',
    copiaNegocio: g.copiaNegocio !== false,
    actualizado: g.actualizado || null
  };
}

function configurado(c = leer()) { return !!(c.servidor && c.usuario && c.tieneContrasena && c.remitente); }
function activo() { const c = leer(); return c.activo && configurado(c); }

function exigirCifrador() {
  if (!cifrador || !cifrador.disponible()) throw new Error('Esta computadora no permite guardar credenciales cifradas');
}

function contrasena() {
  const g = guardado();
  if (!g.contrasena) return null;
  exigirCifrador();
  try { return cifrador.descifrar(g.contrasena); }
  catch (e) { throw new Error('No se pudo leer la contraseña del correo en esta computadora: vuelva a ingresarla en Ajustes'); }
}

/**
 * Guarda la configuración SMTP. La contraseña vacía se conserva.
 * @param {object} c { activo, servidor, puerto, seguridad, usuario, contrasena?, remitente, nombreRemitente, copiaNegocio }
 */
function guardarConfiguracion(c = {}) {
  const g = guardado();
  const servidor = String(c.servidor || '').trim().replace(/^smtps?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
  if (servidor && !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(servidor)) {
    throw new Error('El servidor SMTP no es válido (ejemplo: mail.sudominio.com)');
  }
  const puerto = Number(c.puerto || 0);
  if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) throw new Error('El puerto debe ser un número (465 o 587, normalmente)');
  const seguridad = SEGURIDAD[c.seguridad] ? c.seguridad : 'ssl';
  if (puerto === 465 && seguridad !== 'ssl') throw new Error('El puerto 465 usa seguridad SSL/TLS');
  if (puerto === 587 && seguridad === 'ssl') throw new Error('El puerto 587 usa STARTTLS (o elija el puerto 465 para SSL/TLS)');
  const usuario = String(c.usuario || '').trim();
  let remitente = String(c.remitente || '').trim().toLowerCase();
  if (!remitente && correoValido(usuario)) remitente = usuario.toLowerCase();
  if (remitente && !correoValido(remitente)) throw new Error('El correo remitente no es válido');
  const nuevo = Object.assign({}, g, {
    activo: !!c.activo, servidor, puerto, seguridad, usuario, remitente,
    nombreRemitente: String(c.nombreRemitente || '').trim().slice(0, 80),
    copiaNegocio: c.copiaNegocio !== false,
    actualizado: new Date().toISOString()
  });
  if (c.contrasena) { exigirCifrador(); nuevo.contrasena = cifrador.cifrar(String(c.contrasena)); }
  if (nuevo.activo && !(servidor && usuario && nuevo.contrasena && remitente)) {
    throw new Error('Para activar el envío complete servidor, usuario, contraseña y correo remitente');
  }
  escribirConfig(CLAVE, nuevo);
  registrar('correo_configuracion', { activo: nuevo.activo, servidor, puerto, seguridad, usuario, remitente,
    copiaNegocio: nuevo.copiaNegocio, contrasena: c.contrasena ? 'cambiada' : 'sin cambios' });
  transporte = null;
  red.enLinea = null; red.ultimoError = null;
  // Con la configuración nueva, lo que esperaba un reintento sale ya
  obtener().prepare("UPDATE comprobantes SET correo_siguiente = NULL WHERE correo_estado = 'pendiente'").run();
  if (nuevo.activo) procesarPronto();
  return estado();
}

function crearTransporte() {
  const c = leer();
  const huella = c.actualizado;
  if (transporte && transporte.huella === huella) return transporte.t;
  const t = nodemailer.createTransport(Object.assign({
    host: c.servidor, port: c.puerto,
    secure: c.seguridad === 'ssl', requireTLS: c.seguridad === 'starttls',
    auth: { user: c.usuario, pass: contrasena() },
    connectionTimeout: 20000, greetingTimeout: 15000, socketTimeout: 60000
  }, opcionesPrueba));
  transporte = { huella, t };
  return t;
}

/* ---------------- Errores ---------------- */

/**
 * Traduce un error de SMTP a algo que se pueda resolver:
 *   red → sin conexión (se reintenta solo) · configuracion → usuario, contraseña, certificado o remitente
 *   temporal → el servidor pidió reintentar · destino → la dirección no existe · otro
 */
function clasificar(e, c = leer()) {
  const codigo = String(e.code || ''), rc = Number(e.responseCode) || 0, msg = String(e.message || e);
  const respuesta = e.response ? String(e.response).slice(0, 200) : '';
  if (codigo === 'EAUTH' || rc === 535 || rc === 534 || rc === 530) {
    return { tipo: 'configuracion', mensaje: 'El servidor de correo rechazó el usuario o la contraseña' + (respuesta ? ' (' + respuesta + ')' : '') };
  }
  if (/altname|certificate|self[- ]signed|CERT_|unable to verify/i.test(msg)) {
    return { tipo: 'configuracion', mensaje: 'El certificado de seguridad no corresponde a "' + c.servidor +
      '": use el nombre de servidor SMTP exacto que da su proveedor (' + msg.replace(/^.*?: /, '').slice(0, 120) + ')' };
  }
  if (/wrong version number|ssl3_get_record|packet length too long/i.test(msg)) {
    return { tipo: 'configuracion', mensaje: 'La seguridad no coincide con el puerto: 465 usa SSL/TLS y 587 usa STARTTLS' };
  }
  if (codigo === 'ETLS') {
    return { tipo: 'configuracion', mensaje: 'El servidor ' + c.servidor + ':' + c.puerto + ' no permitió una conexión cifrada: revise la seguridad (SSL/TLS o STARTTLS) y el puerto' };
  }
  if (codigo === 'EENVELOPE' && rc >= 500 && e.command === 'RCPT TO') {
    return { tipo: 'destino', mensaje: 'El servidor de correo rechazó la dirección del cliente' + (respuesta ? ': ' + respuesta : '') };
  }
  if (codigo === 'EENVELOPE' && rc >= 500 && e.command === 'MAIL FROM') {
    return { tipo: 'configuracion', mensaje: 'El servidor no permite enviar como ' + c.remitente + (respuesta ? ': ' + respuesta : '') };
  }
  if (rc >= 400 && rc < 500) return { tipo: 'temporal', mensaje: 'El servidor de correo pidió reintentar más tarde' + (respuesta ? ': ' + respuesta : '') };
  if (RED.has(codigo) || RED.has(String(e.errno || ''))) {
    return { tipo: 'red', mensaje: 'Sin conexión con el servidor de correo ' + c.servidor + ':' + c.puerto + (codigo === 'ETIMEDOUT' ? ' (no respondió a tiempo)' : '') };
  }
  return { tipo: 'otro', mensaje: (rc >= 500 ? 'El servidor de correo no aceptó el mensaje: ' : 'No se pudo enviar el correo: ') + (respuesta || msg).slice(0, 300) };
}

/* ---------------- Mensaje ---------------- */

/** Correo con la factura: PDF, XML firmado y respuesta de Hacienda (nombres por la clave). */
async function armarMensaje(c, destino, cfg = leer(), a = leerAjustes()) {
  const negocio = correoNegocio(a);
  const nombre = cfg.nombreRemitente || a.nombreComercial || a.negocio;
  const total = pdf.colones(c.total_comprobante);
  const fecha = pdf.fechaHora(c.fecha_emision);
  const firma = [a.negocio, a.cedula ? 'Cédula ' + a.cedula : '', a.telefono ? 'Tel. ' + a.telefono : '', negocio].filter(Boolean).join(' · ');
  const texto = [
    'Estimado(a) ' + c.receptor_nombre + ':', '',
    'Adjuntamos la factura electrónica N.° ' + c.consecutivo + ' emitida por ' + a.negocio + ' el ' + fecha + ', por un total de ' + total + '.', '',
    'Clave numérica: ' + c.clave, '',
    'Archivos adjuntos:',
    '  • ' + c.clave + '.pdf — representación gráfica de la factura',
    '  • ' + c.clave + '.xml — comprobante electrónico firmado',
    '  • ' + c.clave + '_respuesta.xml — aceptación de Hacienda', '',
    a.pieTicket || '', '',
    firma
  ].join('\n');
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const htmlCuerpo = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1d2330;line-height:1.5;max-width:560px">' +
    '<p>Estimado(a) ' + esc(c.receptor_nombre) + ':</p>' +
    '<p>Adjuntamos la <b>factura electrónica N.° ' + esc(c.consecutivo) + '</b> emitida por ' + esc(a.negocio) + ' el ' + esc(fecha) +
    ', por un total de <b>' + esc(total) + '</b>.</p>' +
    '<p style="font-size:12px;color:#5b6475">Clave numérica<br><span style="font-family:Consolas,monospace;color:#1d2330">' + esc(c.clave) + '</span></p>' +
    '<p style="font-size:12px;color:#5b6475">Adjuntos: la factura en PDF, el XML firmado y la respuesta de aceptación de Hacienda.</p>' +
    (a.pieTicket ? '<p>' + esc(a.pieTicket) + '</p>' : '') +
    '<p style="font-size:12px;color:#5b6475;border-top:1px solid #e6e9ef;padding-top:10px">' + esc(firma) + '</p></div>';
  const archivoPdf = await pdf.generar(c, a);
  return {
    from: { name: nombre, address: cfg.remitente },
    to: destino,
    bcc: cfg.copiaNegocio && negocio && negocio.toLowerCase() !== destino.toLowerCase() ? negocio : undefined,
    replyTo: negocio && negocio.toLowerCase() !== cfg.remitente ? negocio : undefined,
    subject: 'Factura electrónica ' + c.consecutivo + ' · ' + a.negocio,
    text: texto,
    html: htmlCuerpo,
    attachments: [
      { filename: c.clave + '.pdf', content: archivoPdf, contentType: 'application/pdf' },
      // Base64 para que el XML llegue byte por byte igual (la firma depende de eso)
      { filename: c.clave + '.xml', content: Buffer.from(c.xml_firmado, 'utf8'), contentType: 'application/xml', contentTransferEncoding: 'base64' },
      { filename: c.clave + '_respuesta.xml', content: Buffer.from(c.hacienda_respuesta, 'utf8'), contentType: 'application/xml', contentTransferEncoding: 'base64' }
    ]
  };
}

/* ---------------- Cola ---------------- */

/** Una cosa a la vez con el servidor de correo (lotes automáticos y reenvíos manuales). */
function enTurno(fn) {
  const p = turno.then(fn);
  turno = p.catch(() => {});
  return p;
}

/**
 * Deja en cola el correo de una factura recién aceptada (lo llama el conector).
 * Solo facturas (01) aceptadas, con correo del receptor y que no estén ya en cola.
 */
function encolar(id) {
  const r = obtener().prepare(`UPDATE comprobantes SET correo_estado = 'pendiente', correo_destino = trim(receptor_correo),
      correo_siguiente = NULL, correo_error = NULL
    WHERE id = ? AND tipo = '01' AND estado_hacienda = 'aceptado' AND correo_estado IS NULL
      AND length(trim(coalesce(receptor_correo, ''))) > 0`).run(id);
  return r.changes > 0;
}

/** Intenta enviar un comprobante en cola. Devuelve la clasificación del error, o null si salió. */
async function enviarUno(id) {
  const d = obtener();
  const c = ventas.obtenerPorId(id);
  if (!c || c.correo_estado !== 'pendiente') return null;
  const cfg = leer();
  const destino = String(c.correo_destino || c.receptor_correo || '').trim();
  let falla = null;
  if (!correoValido(destino)) falla = { tipo: 'destino', mensaje: 'La dirección "' + destino + '" no es un correo válido' };
  else if (!c.xml_firmado || !c.hacienda_respuesta) falla = { tipo: 'otro', mensaje: 'Falta el XML firmado o la respuesta de Hacienda' };
  let t = null;
  if (!falla) {
    try { t = crearTransporte(); }
    catch (e) { falla = { tipo: 'configuracion', mensaje: e.message }; }
  }
  if (!falla) {
    try {
      const mensaje = await armarMensaje(c, destino, cfg);
      const info = await t.sendMail(mensaje);
      const rechazado = (info.rejected || []).map((x) => String(x.address || x).toLowerCase()).includes(destino.toLowerCase());
      if (rechazado) {
        const err = (info.rejectedErrors || [])[0] || {};
        falla = clasificar(Object.assign(new Error(err.message || 'rechazado'), { code: 'EENVELOPE', command: 'RCPT TO',
          responseCode: err.responseCode || 550, response: err.response || '' }), cfg);
      } else {
        d.prepare(`UPDATE comprobantes SET correo_estado = 'enviado', correo_intentos = correo_intentos + 1, correo_error = NULL,
          correo_siguiente = NULL, correo_enviado_en = ?, correo_destino = ? WHERE id = ?`).run(ahora(), destino, id);
        registrar('correo_enviado', { id, consecutivo: c.consecutivo, destino, copia: mensaje.bcc || null });
        red.enLinea = true; red.ultimoError = null; red.ultimoEnvio = new Date().toISOString();
        return null;
      }
    } catch (e) {
      falla = clasificar(e, cfg);
    }
  }
  if (falla.tipo === 'destino' || falla.tipo === 'otro') {
    d.prepare(`UPDATE comprobantes SET correo_estado = 'error', correo_intentos = correo_intentos + 1, correo_error = ?,
      correo_siguiente = NULL WHERE id = ?`).run(falla.mensaje, id);
    registrar('correo_error', { id, consecutivo: c.consecutivo, destino, error: falla.mensaje });
    if (falla.tipo === 'destino') red.enLinea = true;
  } else {
    const espera = falla.tipo === 'configuracion' ? ESPERA_CONFIGURACION : ESPERAS[Math.min(c.correo_intentos, ESPERAS.length - 1)];
    d.prepare('UPDATE comprobantes SET correo_intentos = correo_intentos + 1, correo_error = ?, correo_siguiente = ? WHERE id = ?')
      .run(falla.mensaje, enSegundos(espera), id);
    red.ultimoError = falla.mensaje;
    if (falla.tipo === 'red') red.enLinea = false;
  }
  return falla;
}

async function enviarPendientes() {
  const filas = obtener().prepare(`SELECT id FROM comprobantes WHERE correo_estado = 'pendiente'
    AND (correo_siguiente IS NULL OR correo_siguiente <= ?) ORDER BY id LIMIT ?`).all(ahora(), LOTE);
  let cambios = 0;
  for (const { id } of filas) {
    const falla = await enviarUno(id);
    cambios++;
    // Sin conexión o mal configurado: los demás esperan al próximo intento
    if (falla && (falla.tipo === 'red' || falla.tipo === 'configuracion')) break;
  }
  return cambios;
}

/** Envía lo que esté en cola. Nunca corre dos veces a la vez. */
function procesar() {
  if (procesando) return procesando;
  if (!activo()) return Promise.resolve({ cambios: 0 });
  procesando = enTurno(async () => {
    let cambios = 0;
    try { cambios = await enviarPendientes(); }
    catch (e) { red.ultimoError = e.message; }
    return { cambios };
  }).finally(() => { procesando = null; avisar(); });
  return procesando;
}

function procesarPronto() {
  clearTimeout(pronto);
  pronto = setTimeout(() => procesar(), 300);
}

function detener() { clearTimeout(pronto); }

/** Después de restaurar un respaldo o empezar una base nueva. */
function reiniciar() {
  transporte = null;
  red.enLinea = null; red.ultimoError = null;
}

/* ---------------- Acciones desde Ventas / Ajustes ---------------- */

/**
 * Envía (o vuelve a enviar) una factura aceptada, ahora mismo.
 * @param {number} id comprobante
 * @param {string} [destino] otra dirección (p. ej. si el cliente dio mal su correo)
 * @returns el comprobante con su estado de correo actualizado
 */
async function reenviar(id, destino) {
  const c = ventas.obtenerPorId(id);
  if (!c) throw new Error('El comprobante no existe');
  if (c.tipo !== '01') throw new Error('Solo las facturas electrónicas se envían por correo');
  if (c.estado_hacienda !== 'aceptado') throw new Error('La factura se envía por correo cuando Hacienda la acepta');
  if (!configurado()) throw new Error('Primero configure el correo del negocio en Ajustes → Envío de facturas por correo');
  const a = String(destino || c.correo_destino || c.receptor_correo || '').trim();
  if (!a) throw new Error('Escriba el correo al que se envía la factura');
  if (!correoValido(a)) throw new Error('"' + a + '" no es un correo válido');
  obtener().prepare(`UPDATE comprobantes SET correo_estado = 'pendiente', correo_destino = ?, correo_siguiente = NULL,
    correo_error = NULL WHERE id = ?`).run(a, id);
  registrar('correo_reenvio', { id, consecutivo: c.consecutivo, destino: a });
  try { await enTurno(() => enviarUno(id)); }
  finally { avisar(); }
  return ventas.obtenerPorId(id);
}

/** Verifica el servidor y envía un correo de prueba al correo del negocio. */
async function probar() {
  const cfg = leer();
  if (!configurado(cfg)) throw new Error('Primero guarde servidor, usuario, contraseña y correo remitente');
  const a = leerAjustes();
  const destino = correoNegocio(a) || cfg.remitente;
  try {
    await enTurno(async () => {
      const t = crearTransporte();
      await t.verify();
      await t.sendMail({
        from: { name: cfg.nombreRemitente || a.nombreComercial || a.negocio, address: cfg.remitente }, to: destino,
        subject: 'Prueba de correo · ' + a.negocio,
        text: 'Este es un correo de prueba de Besalú Mercat POS.\n\nSi lo recibió, las facturas aceptadas por Hacienda ' +
          'se enviarán a los clientes desde ' + cfg.remitente + ' (servidor ' + cfg.servidor + ':' + cfg.puerto + ').'
      });
    });
  } catch (e) {
    const f = clasificar(e, cfg);
    if (f.tipo === 'red') red.enLinea = false;
    throw new Error(f.mensaje);
  }
  red.enLinea = true; red.ultimoError = null;
  registrar('correo_prueba', { destino });
  return { ok: true, destino, mensaje: 'Correo de prueba enviado a ' + destino };
}

function estado() {
  const cfg = leer();
  const conteo = { pendiente: 0, enviado: 0, error: 0 };
  for (const f of obtener().prepare('SELECT correo_estado AS e, count(*) AS n FROM comprobantes WHERE correo_estado IS NOT NULL GROUP BY correo_estado').all()) conteo[f.e] = f.n;
  const problemas = [];
  if (conteo.pendiente && !activo()) problemas.push(conteo.pendiente + ' factura(s) esperando para enviarse por correo: ' + (configurado(cfg) ? 'active el envío' : 'configure el correo'));
  if (conteo.error) problemas.push(conteo.error + ' factura(s) no se pudieron enviar por correo: use "Reenviar por correo" en Ventas');
  if (configurado(cfg) && !correoNegocio()) problemas.push('Sin correo del negocio en Datos del negocio: no se guarda copia ni reciben las respuestas de los clientes');
  return Object.assign(cfg, {
    configurado: configurado(cfg), activo: activo(),
    enLinea: red.enLinea, ultimoError: red.ultimoError, ultimoEnvio: red.ultimoEnvio,
    conteo, problemas
  });
}

module.exports = {
  configurar, leer, configurado, activo, guardarConfiguracion, clasificar, armarMensaje,
  encolar, procesar, procesarPronto, detener, reiniciar, reenviar, probar, estado
};
