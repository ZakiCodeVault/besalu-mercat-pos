/**
 * conector.js — Conexión propia con Hacienda (sin proveedor).
 *
 * Ciclo de cada comprobante:
 *   pendiente ──firma + envío──▶ enviado ──consulta──▶ aceptado
 *        │                          │               └─▶ rechazado → se reemite
 *        └─ sin internet: se reintenta solo, en orden, sin perder nada
 *
 * Los mensajes de receptor (aceptar o rechazar una factura de compra) siguen el
 * mismo ciclo en su propia cola; si Hacienda rechaza el mensaje, se envía otro.
 *
 *  - Se envía en el orden de emisión (Hacienda valida la secuencia).
 *  - Si no hay internet, la venta NO se detiene: el comprobante se emite con
 *    situación "3 · sin internet" y se envía cuando vuelva la conexión.
 *  - La base solo deja cambiar el estado del envío; el XML no cambia una vez
 *    que Hacienda lo recibió y la respuesta final (aceptado/rechazado) es definitiva.
 *  - Cada FACTURA aceptada con correo del receptor pasa a la cola de correo
 *    (correo.js): XML firmado + respuesta de Hacienda + PDF al cliente.
 */
const { obtener, leerAjustes, registrar } = require('../datos/conexion');
const ventas = require('../datos/ventas');
const compras = require('../datos/compras');
const { fechaLocal } = require('../datos/montos');
const { construir, decimal5 } = require('./xml');
const receptor = require('./receptor');
const { cargarLlave, firmar } = require('./firma');
const { ClienteHacienda, ErrorHacienda, leerRespuesta } = require('./api');
const credenciales = require('./credenciales');
const correo = require('./correo');
const { AMBIENTES, CODIGO_TARIFA, LARGO_IDENTIFICACION, PROVINCIAS } = require('./catalogos');

const red = { enLinea: null, ultimoContacto: null, ultimoError: null };
let sesion = null;              // { huella, cliente, llave, ambiente }
let urlsPrueba = null;          // solo pruebas automáticas (servidor simulado)
let avisar = () => {};
let temporizador = null, pronto = null, siguiente = null, procesando = null;
let llaveElegida = null;        // .p12 recién elegido en Ajustes, antes de guardar
let cortarCiclo = false;        // sin conexión o credenciales malas: no insistir con las otras colas en este ciclo

const ahora = () => fechaLocal();
const enSegundos = (s) => fechaLocal(new Date(Date.now() + s * 1000));

function configurar({ cifrador, urls, smtp, alCambiar } = {}) {
  credenciales.configurar(cifrador);
  urlsPrueba = urls || null;
  avisar = alCambiar || (() => {});
  correo.configurar({ cifrador, opciones: smtp, alCambiar: () => { try { avisar(estado()); } catch (e) { /* base cerrada al salir */ } } });
  ventas.configurarHacienda({ situacion, validar });
}

function activo() {
  const c = credenciales.leer();
  return c.activo && c.tieneContrasena && c.tieneLlave && !!c.usuario;
}

/* ---------------- Validaciones antes de emitir ---------------- */

/** Datos del negocio que Hacienda exige en cada comprobante. */
function faltantesEmisor(a = leerAjustes()) {
  const f = [];
  if (!/^\d{9,12}$/.test(a.cedula || '')) f.push('la cédula del negocio');
  if (String(a.negocio || '').trim().length < 5) f.push('el nombre o razón social (mínimo 5 letras)');
  if (!/^[\d.]{6}$/.test(a.actividadEconomica || '')) f.push('el código de actividad económica (6 caracteres)');
  if (!PROVINCIAS[a.provincia]) f.push('la provincia');
  if (!/^\d{1,2}$/.test(a.canton || '') || Number(a.canton) < 1) f.push('el cantón');
  if (!/^\d{1,2}$/.test(a.distrito || '') || Number(a.distrito) < 1) f.push('el distrito');
  if (String(a.direccion || '').trim().length < 5) f.push('la dirección (otras señas)');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(a.correo || '').split(/[;,\s]+/)[0] || '')) f.push('el correo del negocio');
  return f;
}

/** Lanza un error claro si al comprobante le falta algo que Hacienda exige. */
function validar({ tipo, lineas, receptor, ajustes }) {
  if (!activo()) return;
  const f = faltantesEmisor(ajustes);
  if (f.length) throw new Error('Para emitir con Hacienda falta en Ajustes: ' + f.join(', '));
  for (const l of lineas) {
    if (tipo !== '03' && !/^\d{13}$/.test(l.cabys || '')) throw new Error('"' + l.descripcion + '" no tiene código CABYS (13 dígitos): agréguelo en Inventario');
    if (!CODIGO_TARIFA[l.tarifa_iva]) throw new Error('La tarifa de IVA ' + l.tarifa_iva + '% no es válida para Hacienda');
  }
  if (tipo === '01' && receptor) {
    const largos = LARGO_IDENTIFICACION[receptor.tipo_id];
    if (!largos) throw new Error('Tipo de identificación del cliente inválido');
    if (!/^\d+$/.test(receptor.identificacion) || !largos.includes(receptor.identificacion.length)) {
      throw new Error('La identificación del cliente debe tener ' + largos.join(' u ') + ' dígitos, sin guiones');
    }
    if (receptor.tipo_id === '01' && receptor.identificacion.startsWith('0')) throw new Error('La cédula física va sin cero al inicio (9 dígitos)');
    if (receptor.nombre.trim().length < 3) throw new Error('El nombre del cliente debe tener al menos 3 letras');
  }
}

/** Situación que va en la clave: 3 si se sabe que no hay internet. */
function situacion() {
  return activo() && red.enLinea === false ? '3' : '1';
}

/* ---------------- Sesión con Hacienda ---------------- */

function abrirSesion() {
  const datos = credenciales.leer();
  const huella = datos.actualizado + '|' + datos.ambiente;
  if (sesion && sesion.huella === huella) return sesion;
  const s = credenciales.secretos();
  if (!s) throw new ErrorHacienda('credenciales', 'Faltan credenciales de Hacienda');
  if (sesion) sesion.cliente.cerrarSesion();
  sesion = {
    huella, ambiente: datos.ambiente,
    llave: cargarLlave(s.p12, s.pin),
    cliente: new ClienteHacienda({ ambiente: datos.ambiente, usuario: datos.usuario, contrasena: s.contrasena, urls: urlsPrueba })
  };
  return sesion;
}

function marcarRed(enLinea, error) {
  red.enLinea = enLinea;
  if (!enLinea) cortarCiclo = true;
  if (enLinea) { red.ultimoContacto = new Date().toISOString(); red.ultimoError = null; }
  else if (error) red.ultimoError = error;
}

/* ---------------- Cola ---------------- */

const ESPERAS_ENVIO = [30, 60, 120, 300, 600, 900];   // segundos entre reintentos sin conexión

/** XML firmado del comprobante (lo arma la primera vez). */
function xmlDe(c, s) {
  if (c.xml_firmado) return c.xml_firmado;
  const d = obtener();
  // Comprobantes emitidos antes de activar Hacienda: el CABYS se toma del producto
  const cabys = d.prepare('SELECT cabys FROM productos WHERE id = ?');
  c.lineas = c.lineas.map((l) => (l.cabys || !l.producto_id ? l : Object.assign({}, l, { cabys: (cabys.get(l.producto_id) || {}).cabys || '' })));
  const firmado = firmar(construir(c, leerAjustes()).xml, s.llave);
  d.prepare('UPDATE comprobantes SET xml_firmado = ?, hacienda_ambiente = ? WHERE id = ?').run(firmado, s.ambiente, c.id);
  return firmado;
}

/** XML firmado del mensaje de receptor (lo arma la primera vez). */
function xmlMensajeDe(m, s) {
  if (m.xml_firmado) return m.xml_firmado;
  const firmado = firmar(receptor.construir(m), s.llave);
  obtener().prepare('UPDATE mensajes_receptor SET xml_firmado = ?, hacienda_ambiente = ? WHERE id = ?').run(firmado, s.ambiente, m.id);
  return firmado;
}

/**
 * Lo que se envía a Hacienda, cada cosa en su cola (tabla) y en orden de id:
 *   comprobantes        tiquetes, facturas y notas de crédito emitidos
 *   mensajes_receptor   aceptación o rechazo de facturas de compra: la clave y el
 *                       emisor son los de la factura del proveedor, el receptor es
 *                       el negocio, y se consulta con "clave-consecutivo"
 */
const COLAS = [
  {
    tabla: 'comprobantes', bitacora: 'hacienda', nombre: 'el comprobante',
    obtener: (id) => ventas.obtenerPorId(id),
    xml: xmlDe,
    envio: (c, aj) => ({ clave: c.clave, fecha: c.fecha_emision, emisor: { tipo: aj.tipoCedula, numero: aj.cedula },
      receptor: c.receptor_identificacion ? { tipo: c.receptor_tipo_id, numero: c.receptor_identificacion } : null }),
    consulta: (c) => c.clave
  },
  {
    tabla: 'mensajes_receptor', bitacora: 'hacienda_receptor', nombre: 'el mensaje',
    obtener: (id) => compras.obtenerMensaje(id),
    xml: xmlMensajeDe,
    envio: (m) => ({ clave: m.clave, fecha: m.fecha_emision, consecutivoReceptor: m.consecutivo,
      emisor: { tipo: m.emisor_tipo_id, numero: m.emisor_identificacion }, receptor: { tipo: m.receptor_tipo_id, numero: m.receptor_identificacion } }),
    consulta: (m) => m.clave + '-' + m.consecutivo
  }
];

async function enviarPendientes(s, cola) {
  const d = obtener();
  const aj = leerAjustes();
  const filas = d.prepare(`SELECT id FROM ${cola.tabla} WHERE estado_hacienda = 'pendiente'
    AND (hacienda_siguiente IS NULL OR hacienda_siguiente <= ?) ORDER BY id LIMIT 25`).all(ahora());
  let cambios = 0;
  for (const { id } of filas) {
    const c = cola.obtener(id);
    let xmlFirmado;
    try { xmlFirmado = cola.xml(c, s); }
    catch (e) {
      d.prepare(`UPDATE ${cola.tabla} SET estado_hacienda = 'error', hacienda_error = ?, hacienda_mensaje = ? WHERE id = ?`)
        .run(e.message, 'No se pudo generar el XML: ' + e.message, id);
      cambios++; continue;
    }
    try {
      await s.cliente.enviar(Object.assign({ xmlFirmado }, cola.envio(c, aj)));
      marcarRed(true);
      d.prepare(`UPDATE ${cola.tabla} SET estado_hacienda = 'enviado', hacienda_intentos = hacienda_intentos + 1, hacienda_error = NULL,
        hacienda_mensaje = 'Recibido por Hacienda, en validación', hacienda_fecha = ?, hacienda_siguiente = ? WHERE id = ?`)
        .run(ahora(), enSegundos(3), id);
      cambios++;
    } catch (e) {
      if (!(e instanceof ErrorHacienda)) throw e;
      if (e.reintentar) {
        if (e.tipo === 'red') marcarRed(false, e.message); else red.ultimoError = e.message;
        const espera = ESPERAS_ENVIO[Math.min(c.hacienda_intentos, ESPERAS_ENVIO.length - 1)];
        d.prepare(`UPDATE ${cola.tabla} SET hacienda_intentos = hacienda_intentos + 1, hacienda_error = ?, hacienda_siguiente = ? WHERE id = ?`)
          .run(e.message, enSegundos(espera), id);
        cambios++;
        break;   // los siguientes esperan: se respeta el orden
      }
      if (e.tipo === 'credenciales') { red.ultimoError = e.message; cortarCiclo = true; break; }
      // Hacienda no aceptó el envío (validación): no tiene sentido reintentar igual
      d.prepare(`UPDATE ${cola.tabla} SET estado_hacienda = 'error', hacienda_intentos = hacienda_intentos + 1, hacienda_error = ?,
        hacienda_mensaje = ? WHERE id = ?`).run(e.message, 'Hacienda no recibió ' + cola.nombre + ': ' + e.message, id);
      registrar(cola.bitacora + '_error', { id, consecutivo: c.consecutivo, error: e.message });
      cambios++;
    }
  }
  return cambios;
}

async function consultarEnviados(s, cola) {
  const d = obtener();
  const filas = d.prepare(`SELECT id, clave, consecutivo, hacienda_fecha FROM ${cola.tabla} WHERE estado_hacienda = 'enviado'
    AND (hacienda_siguiente IS NULL OR hacienda_siguiente <= ?) ORDER BY id LIMIT 25`).all(ahora());
  let cambios = 0;
  for (const c of filas) {
    let r;
    try { r = await s.cliente.consultar(cola.consulta(c)); }
    catch (e) {
      if (!(e instanceof ErrorHacienda)) throw e;
      if (e.tipo === 'red') { marcarRed(false, e.message); break; }
      if (e.tipo === 'credenciales') { red.ultimoError = e.message; cortarCiclo = true; break; }
      d.prepare(`UPDATE ${cola.tabla} SET hacienda_siguiente = ? WHERE id = ?`).run(enSegundos(300), c.id);
      continue;
    }
    marcarRed(true);
    const minutos = (Date.now() - new Date(String(c.hacienda_fecha).replace(' ', 'T')).getTime()) / 60000;
    if (r.estado === 'aceptado' || r.estado === 'rechazado') {
      const m = leerRespuesta(r.xmlRespuesta);
      const mensaje = r.estado === 'aceptado' ? 'Aceptado por Hacienda' : ('Rechazado por Hacienda' + (m && m.detalle ? ': ' + m.detalle : ''));
      d.prepare(`UPDATE ${cola.tabla} SET estado_hacienda = ?, hacienda_respuesta = ?, hacienda_mensaje = ?, hacienda_error = NULL,
        hacienda_fecha = ?, hacienda_siguiente = NULL WHERE id = ?`).run(r.estado, r.xmlRespuesta, mensaje.slice(0, 4000), ahora(), c.id);
      if (r.estado === 'rechazado') registrar(cola.bitacora + '_rechazo', { id: c.id, consecutivo: c.consecutivo, detalle: m ? m.detalle.slice(0, 500) : '' });
      else if (cola.tabla === 'comprobantes') correo.encolar(c.id);   // factura con correo del cliente: se le envía
      cambios++;
    } else if (r.estado === 'error') {
      d.prepare(`UPDATE ${cola.tabla} SET estado_hacienda = 'error', hacienda_mensaje = ?, hacienda_siguiente = NULL WHERE id = ?`)
        .run('Hacienda reportó un error al procesar ' + cola.nombre + '. Use "Reintentar envío".', c.id);
      cambios++;
    } else if (r.estado === 'no_existe' && minutos > 10) {
      // Hacienda no lo tiene: se vuelve a enviar el mismo XML
      d.prepare(`UPDATE ${cola.tabla} SET estado_hacienda = 'pendiente', hacienda_siguiente = NULL WHERE id = ?`).run(c.id);
      cambios++;
    } else {
      // recibido / procesando: se consulta de nuevo más tarde
      d.prepare(`UPDATE ${cola.tabla} SET hacienda_siguiente = ? WHERE id = ?`).run(enSegundos(minutos < 1 ? 5 : minutos < 10 ? 30 : 300), c.id);
    }
  }
  return cambios;
}

/** Envía los pendientes y consulta los enviados de cada cola. Nunca corre dos veces a la vez. */
function procesar() {
  if (procesando) return procesando;
  if (!activo()) { correo.procesar(); return Promise.resolve({ cambios: 0 }); }
  procesando = (async () => {
    let cambios = 0;
    cortarCiclo = false;
    try {
      const s = abrirSesion();
      for (const paso of [enviarPendientes, consultarEnviados]) {
        for (const cola of COLAS) if (!cortarCiclo) cambios += await paso(s, cola);
      }
    } catch (e) {
      red.ultimoError = e.message;
    } finally {
      procesando = null;
      correo.procesar();   // facturas recién aceptadas y reintentos (con su propio turno: no frena a Hacienda)
      programarSiguiente();
      avisar(estado());
    }
    return { cambios };
  })();
  return procesando;
}

/** Si algún comprobante toca antes del próximo ciclo (p. ej. consultar la respuesta), se adelanta. */
function programarSiguiente() {
  clearTimeout(siguiente);
  if (!temporizador || !activo()) return;
  const f = obtener().prepare(`SELECT min(t) AS t FROM (
    ${COLAS.map((c) => `SELECT hacienda_siguiente AS t FROM ${c.tabla} WHERE estado_hacienda IN ('pendiente','enviado') AND hacienda_siguiente IS NOT NULL`).join(' UNION ALL ')})`).get();
  if (!f || !f.t) return;
  const ms = new Date(f.t.replace(' ', 'T')).getTime() - Date.now();
  if (ms < 25000) siguiente = setTimeout(() => procesar(), Math.max(1000, ms + 200));
}

/** Programa un envío en un momento (p. ej. justo después de cobrar). */
function procesarPronto() {
  clearTimeout(pronto);
  pronto = setTimeout(() => procesar(), 300);
}

function iniciar(intervaloMs = 30000) {
  detener();
  temporizador = setInterval(() => procesar(), intervaloMs);
  procesarPronto();
}

function detener() {
  clearInterval(temporizador); clearTimeout(pronto); clearTimeout(siguiente);
  temporizador = null;
  correo.detener();
}

/** Después de restaurar un respaldo o empezar una base nueva: olvida la sesión anterior. */
function reiniciar() {
  if (sesion) sesion.cliente.cerrarSesion();
  sesion = null; llaveElegida = null;
  red.enLinea = null; red.ultimoError = null;
  correo.reiniciar();
  procesarPronto();
}

/* ---------------- Acciones desde Ajustes / Ventas ---------------- */

/** Comprobantes y mensajes enviados al ambiente de pruebas (no valen ante Hacienda). */
function enviadosAPruebas() {
  return COLAS.reduce((n, c) => n + obtener().prepare(`SELECT count(*) AS n FROM ${c.tabla} WHERE hacienda_ambiente = 'pruebas'`).get().n, 0);
}

function estado() {
  const d = obtener();
  const conteo = { pendiente: 0, enviado: 0, aceptado: 0, rechazado: 0, error: 0 };
  for (const f of d.prepare('SELECT estado_hacienda AS estado, count(*) AS n FROM comprobantes GROUP BY estado_hacienda').all()) conteo[f.estado] = f.n;
  const rechazadosSinReemplazo = d.prepare(`SELECT count(*) AS n FROM comprobantes c WHERE estado_hacienda = 'rechazado'
    AND NOT EXISTS (SELECT 1 FROM comprobantes s WHERE s.sustituye_id = c.id)`).get().n;
  const mensajes = { pendiente: 0, enviado: 0, aceptado: 0, rechazado: 0, error: 0 };
  for (const f of d.prepare('SELECT estado_hacienda AS estado, count(*) AS n FROM mensajes_receptor GROUP BY estado_hacienda').all()) mensajes[f.estado] = f.n;
  // Mensaje rechazado por Hacienda cuya compra no tiene otro en curso: hay que corregir y enviar de nuevo
  const mensajesPorRevisar = d.prepare(`SELECT count(DISTINCT m.compra_id) AS n FROM mensajes_receptor m WHERE m.estado_hacienda IN ('rechazado','error')
    AND NOT EXISTS (SELECT 1 FROM mensajes_receptor o WHERE o.compra_id = m.compra_id AND o.estado_hacienda IN ('pendiente','enviado','aceptado'))`).get().n;
  const c = credenciales.leer();
  const aj = leerAjustes();
  const problemas = [];
  const faltan = faltantesEmisor(aj);
  if (faltan.length) problemas.push('Falta en los datos del negocio: ' + faltan.join(', '));
  const sinCabys = d.prepare("SELECT count(*) AS n FROM productos WHERE activo = 1 AND (length(cabys) <> 13)").get().n;
  if (sinCabys) problemas.push(sinCabys + ' producto(s) sin código CABYS: no se podrán vender mientras Hacienda esté activo');
  let dias = null;
  if (c.certificado) {
    dias = Math.floor((new Date(c.certificado.vence) - Date.now()) / 86400000);
    if (dias < 0) problemas.push('La llave criptográfica venció: genere una nueva en TRIBU-CR');
    else if (dias <= 30) problemas.push('La llave criptográfica vence en ' + dias + ' día(s)');
    if (c.certificado.cedula && aj.cedula && c.certificado.cedula !== aj.cedula) {
      problemas.push('La llave es de la cédula ' + c.certificado.cedula + ' pero el negocio tiene ' + aj.cedula);
    }
  }
  if (c.usuario && !c.usuario.endsWith(AMBIENTES[c.ambiente].dominioUsuario)) {
    problemas.push('El usuario no es del ambiente de ' + AMBIENTES[c.ambiente].nombre + ' (debe terminar en ' + AMBIENTES[c.ambiente].dominioUsuario + ')');
  }
  const enviadosPruebas = enviadosAPruebas();
  if (rechazadosSinReemplazo) problemas.push(rechazadosSinReemplazo + ' comprobante(s) rechazado(s) sin reemitir (Ventas)');
  if (mensajesPorRevisar) problemas.push(mensajesPorRevisar + ' factura(s) de compra con el mensaje de aceptación/rechazo sin resolver (Compras)');
  return {
    configurado: c.tieneContrasena && c.tieneLlave && !!c.usuario,
    activo: activo(),
    ambiente: c.ambiente, ambienteNombre: AMBIENTES[c.ambiente].nombre,
    usuario: c.usuario, tieneContrasena: c.tieneContrasena, tieneLlave: c.tieneLlave,
    certificado: c.certificado ? Object.assign({}, c.certificado, { dias }) : null,
    llaveElegida: llaveElegida ? llaveElegida.nombre : null,
    enLinea: red.enLinea, ultimoContacto: red.ultimoContacto, ultimoError: red.ultimoError,
    conteo, rechazadosSinReemplazo, mensajes, mensajesPorRevisar, enviadosPruebas, problemas,
    correo: correo.estado()
  };
}

/** Guarda en memoria el .p12 elegido (todavía no se guarda en la base). */
function elegirLlave(contenido, nombre) {
  llaveElegida = { contenido: Buffer.from(contenido), nombre };
  return { nombre };
}

/**
 * Guarda la configuración. Verifica la llave con su PIN antes de guardar.
 * @param {object} c { activo, ambiente, usuario, contrasena?, pin? }
 */
function guardarConfiguracion(c) {
  if (!AMBIENTES[c.ambiente]) throw new Error('Elija el ambiente: pruebas o producción');
  const actual = credenciales.leer();
  const usuario = String(c.usuario || '').trim();
  if (usuario && !usuario.endsWith(AMBIENTES[c.ambiente].dominioUsuario)) {
    throw new Error('El usuario de ' + AMBIENTES[c.ambiente].nombre + ' termina en ' + AMBIENTES[c.ambiente].dominioUsuario);
  }
  if (c.ambiente === 'produccion' && actual.ambiente !== 'produccion') {
    const enPruebas = enviadosAPruebas();
    if (enPruebas) {
      throw new Error('Esta base tiene ' + enPruebas + ' comprobante(s) o mensaje(s) enviados al ambiente de pruebas, que no valen ante Hacienda. ' +
        'Para facturar en producción use "Empezar facturación real" (Ajustes → Hacienda), que guarda la base de pruebas y arranca una nueva.');
    }
  }
  let certificado = null;
  const p12 = llaveElegida ? llaveElegida.contenido : null;
  if (p12 || c.pin) {
    const anterior = (p12 && c.pin) ? null : credenciales.secretos();
    const llave = cargarLlave(p12 || (anterior && anterior.p12), c.pin || (anterior && anterior.pin));
    if (!llave.info.cedula) throw new Error('La llave no indica una cédula reconocible (' + (llave.info.serie || 'sin serie') + ')');
    certificado = llave.info;
  }
  const quedaConfigurado = (c.contrasena || actual.tieneContrasena) && (p12 || actual.tieneLlave) && usuario;
  if (c.activo) {
    if (!quedaConfigurado) throw new Error('Para activar el envío complete usuario, contraseña, llave .p12 y PIN');
    const faltan = faltantesEmisor();
    if (faltan.length) throw new Error('Antes de activar Hacienda complete en Datos del negocio: ' + faltan.join(', '));
  }
  const guardado = credenciales.guardar({ activo: !!c.activo, ambiente: c.ambiente, usuario, contrasena: c.contrasena || null,
    p12, pin: c.pin || null, certificado });
  llaveElegida = null;
  if (sesion) { sesion.cliente.cerrarSesion(); sesion = null; }
  red.enLinea = null; red.ultimoError = null;
  if (guardado.activo) procesarPronto();
  return estado();
}

/** Comprueba la llave y pide un token a Hacienda con las credenciales guardadas. */
async function probarConexion() {
  if (!credenciales.leer().tieneContrasena || !credenciales.leer().tieneLlave) throw new Error('Primero guarde usuario, contraseña, llave y PIN');
  sesion = null;
  const s = abrirSesion();
  try {
    await s.cliente.token();
    marcarRed(true);
    return { ok: true, mensaje: 'Conexión correcta con Hacienda · ' + AMBIENTES[s.ambiente].nombre, certificado: s.llave.info };
  } catch (e) {
    if (e.tipo === 'red') marcarRed(false, e.message);
    throw e;
  }
}

/** Vuelve a poner en cola un comprobante con error (regenera el XML con los datos corregidos). */
function reintentar(id) {
  const d = obtener();
  const c = d.prepare('SELECT estado_hacienda FROM comprobantes WHERE id = ?').get(id);
  if (!c) throw new Error('El comprobante no existe');
  if (c.estado_hacienda !== 'error') throw new Error('Solo se reintentan comprobantes con error de envío');
  d.prepare(`UPDATE comprobantes SET estado_hacienda = 'pendiente', xml_firmado = NULL, hacienda_error = NULL,
    hacienda_mensaje = NULL, hacienda_siguiente = NULL WHERE id = ?`).run(id);
  registrar('hacienda_reintento', { id });
  procesarPronto();
  return ventas.obtenerPorId(id);
}

/* ---------------- Mensaje Receptor (Compras) ---------------- */

/** Datos de la factura del proveedor para el formulario de aceptación. */
function datosMensaje(compraId) {
  const c = compras.facturaDe(compraId);
  if (!c) throw new Error('La compra no existe');
  const f = receptor.leerFactura(c.xml_original);
  receptor.exigirReceptor(f, leerAjustes());
  return {
    clave: f.clave, consecutivo: f.consecutivo, moneda: f.moneda, proveedor: f.emisor,
    total: decimal5(f.total), impuesto: decimal5(f.impuesto),
    totalCentimos: Math.round(f.total / 1000), impuestoCentimos: Math.round(f.impuesto / 1000)
  };
}

/**
 * Acepta (05), acepta parcialmente (06) o rechaza (07) ante Hacienda la factura
 * de una compra importada desde su XML. Queda en cola y se envía sola.
 * @param {object} o { tipo, detalle?, condicion?, acreditar? (céntimos) } — ver receptor.calcular()
 */
function responderCompra(compraId, o = {}) {
  if (!activo()) throw new Error('Active el envío a Hacienda (Ajustes → Hacienda) para aceptar o rechazar facturas de compra');
  const aj = leerAjustes();
  const faltan = faltantesEmisor(aj);
  if (faltan.length) throw new Error('Para enviar mensajes a Hacienda falta en Ajustes: ' + faltan.join(', '));
  const c = compras.facturaDe(compraId);
  if (!c) throw new Error('La compra no existe');
  compras.registrarMensaje(compraId, receptor.calcular(receptor.leerFactura(c.xml_original), o, aj));
  procesarPronto();
  return compras.obtenerPorId(compraId);
}

/** Vuelve a poner en cola un mensaje con error de envío (regenera el XML). */
function reintentarMensaje(id) {
  const d = obtener();
  const m = d.prepare('SELECT compra_id, estado_hacienda FROM mensajes_receptor WHERE id = ?').get(id);
  if (!m) throw new Error('El mensaje no existe');
  if (m.estado_hacienda !== 'error') throw new Error('Solo se reintentan mensajes con error de envío');
  d.prepare(`UPDATE mensajes_receptor SET estado_hacienda = 'pendiente', xml_firmado = NULL, hacienda_error = NULL,
    hacienda_mensaje = NULL, hacienda_siguiente = NULL WHERE id = ?`).run(id);
  registrar('hacienda_receptor_reintento', { id });
  procesarPronto();
  return compras.obtenerPorId(m.compra_id);
}

module.exports = {
  configurar, activo, situacion, validar, faltantesEmisor,
  procesar, procesarPronto, iniciar, detener, reiniciar,
  estado, elegirLlave, guardarConfiguracion, probarConexion, reintentar,
  datosMensaje, responderCompra, reintentarMensaje
};
