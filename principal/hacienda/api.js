/**
 * api.js — Conexión directa con la API de Comprobantes Electrónicos de Hacienda.
 *
 *   IdP (OpenID Connect, "Resource Owner Password"): usuario y contraseña de la
 *   API → access_token (se renueva solo con el refresh_token).
 *   POST /recepcion        envía el comprobante firmado (201 = recibido)
 *   GET  /recepcion/{clave} estado: recibido · procesando · aceptado · rechazado · error
 *
 * Los errores se clasifican para que la cola sepa si conviene reintentar:
 *   red · servidor · limite → se reintenta solo
 *   credenciales           → hay que corregir usuario/contraseña en Ajustes
 *   validacion             → Hacienda no aceptó el envío (no se reintenta igual)
 */
const { AMBIENTES } = require('./catalogos');

const ESPERA_MS = 30000;

class ErrorHacienda extends Error {
  constructor(tipo, mensaje, extra = {}) {
    super(mensaje);
    this.tipo = tipo;
    this.reintentar = ['red', 'servidor', 'limite'].includes(tipo);
    Object.assign(this, extra);
  }
}

function formulario(campos) {
  return Object.entries(campos).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
}

class ClienteHacienda {
  /**
   * @param {object} o { ambiente:'pruebas'|'produccion', usuario, contrasena, urls? (solo pruebas automáticas) }
   */
  constructor({ ambiente, usuario, contrasena, urls }) {
    const base = AMBIENTES[ambiente];
    if (!base) throw new Error('Ambiente de Hacienda inválido');
    this.ambiente = ambiente;
    this.urls = { ...base, ...(urls || {}) };
    this.usuario = usuario;
    this.contrasena = contrasena;
    this.sesion = null;          // { acceso, venceAcceso, refresco, venceRefresco }
  }

  async pedir(url, opciones) {
    try {
      return await fetch(url, { ...opciones, signal: AbortSignal.timeout(ESPERA_MS) });
    } catch (e) {
      throw new ErrorHacienda('red', 'Sin conexión con Hacienda (' + (e.cause && e.cause.code || e.name) + ')');
    }
  }

  async pedirToken(campos) {
    const r = await this.pedir(this.urls.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body: formulario({ client_id: this.urls.clientId, ...campos })
    });
    if (r.status >= 500) throw new ErrorHacienda('servidor', 'El servicio de autenticación de Hacienda no responde (' + r.status + ')');
    const json = await r.json().catch(() => ({}));
    if (!r.ok || !json.access_token) {
      throw new ErrorHacienda('credenciales', 'Hacienda rechazó el usuario o la contraseña de la API' + (json.error_description ? ' (' + json.error_description + ')' : ''));
    }
    const ahora = Date.now();
    this.sesion = {
      acceso: json.access_token,
      venceAcceso: ahora + ((json.expires_in || 300) - 30) * 1000,
      refresco: json.refresh_token || null,
      venceRefresco: ahora + ((json.refresh_expires_in || 0) - 30) * 1000
    };
    return this.sesion.acceso;
  }

  /** Token vigente (lo pide o lo renueva si hace falta). */
  async token() {
    const ahora = Date.now();
    if (this.sesion && ahora < this.sesion.venceAcceso) return this.sesion.acceso;
    if (this.sesion && this.sesion.refresco && ahora < this.sesion.venceRefresco) {
      try { return await this.pedirToken({ grant_type: 'refresh_token', refresh_token: this.sesion.refresco }); }
      catch (e) { if (e.tipo === 'red' || e.tipo === 'servidor') throw e; }
    }
    this.sesion = null;
    return this.pedirToken({ grant_type: 'password', username: this.usuario, password: this.contrasena });
  }

  /** Llama a la API con el token; si venció, lo renueva una vez. */
  async api(metodo, ruta, cuerpo, reintento = false) {
    const r = await this.pedir(this.urls.recepcion + ruta, {
      method: metodo,
      headers: { Authorization: 'bearer ' + await this.token(), ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined
    });
    if ((r.status === 401 || r.status === 403) && !reintento) { this.sesion = null; return this.api(metodo, ruta, cuerpo, true); }
    if (r.status === 401 || r.status === 403) throw new ErrorHacienda('credenciales', 'Hacienda no autorizó la consulta (' + r.status + ')');
    if (r.status === 429) throw new ErrorHacienda('limite', 'Hacienda pidió esperar (demasiadas consultas)');
    if (r.status >= 500) throw new ErrorHacienda('servidor', 'Hacienda respondió con un error interno (' + r.status + ')');
    return r;
  }

  /**
   * Envía un comprobante firmado.
   * @returns {Promise<{estado:'recibido'|'ya_recibido'}>}
   */
  async enviar({ clave, fecha, emisor, receptor, xmlFirmado }) {
    const cuerpo = {
      clave, fecha,
      emisor: { tipoIdentificacion: emisor.tipo, numeroIdentificacion: emisor.numero },
      comprobanteXml: Buffer.from(xmlFirmado, 'utf8').toString('base64')
    };
    if (receptor && receptor.numero) cuerpo.receptor = { tipoIdentificacion: receptor.tipo, numeroIdentificacion: receptor.numero };
    const r = await this.api('POST', '', cuerpo);
    if (r.status === 201 || r.status === 202 || r.status === 200) return { estado: 'recibido' };
    const causa = r.headers.get('x-error-cause') || (await r.text().catch(() => '')) || ('HTTP ' + r.status);
    if (/ya fue recibido/i.test(causa)) return { estado: 'ya_recibido' };
    throw new ErrorHacienda('validacion', causa, { status: r.status });
  }

  /**
   * Estado de un comprobante enviado.
   * @returns {Promise<{estado:string, xmlRespuesta:string|null}>}
   */
  async consultar(clave) {
    const r = await this.api('GET', '/' + encodeURIComponent(clave));
    if (r.status === 400 || r.status === 404) {
      const causa = r.headers.get('x-error-cause') || '';
      if (/no existe/i.test(causa)) return { estado: 'no_existe', xmlRespuesta: null };
      throw new ErrorHacienda('validacion', causa || 'Consulta rechazada (' + r.status + ')', { status: r.status });
    }
    if (!r.ok) throw new ErrorHacienda('servidor', 'Respuesta inesperada de Hacienda (' + r.status + ')');
    const json = await r.json();
    const xmlRespuesta = json['respuesta-xml'] ? Buffer.from(json['respuesta-xml'], 'base64').toString('utf8') : null;
    return { estado: String(json['ind-estado'] || '').toLowerCase().trim(), xmlRespuesta };
  }

  /** Cierra la sesión en el IdP (al cambiar credenciales o salir). */
  async cerrarSesion() {
    if (!this.sesion || !this.sesion.refresco) { this.sesion = null; return; }
    const refresco = this.sesion.refresco;
    this.sesion = null;
    try {
      await this.pedir(this.urls.cerrarSesion, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
        body: formulario({ client_id: this.urls.clientId, refresh_token: refresco })
      });
    } catch (e) { /* sin conexión: la sesión vence sola */ }
  }
}

/** Lee el MensajeHacienda (respuesta firmada de aceptación o rechazo). */
function leerRespuesta(xml) {
  if (!xml) return null;
  const valor = (etiqueta) => {
    const m = xml.match(new RegExp('<(?:\\w+:)?' + etiqueta + '>([\\s\\S]*?)</(?:\\w+:)?' + etiqueta + '>'));
    return m ? m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim() : null;
  };
  const codigo = valor('Mensaje');
  return { codigo, aceptado: codigo === '1', detalle: valor('DetalleMensaje') || '', impuesto: valor('MontoTotalImpuesto'), total: valor('TotalFactura') };
}

module.exports = { ClienteHacienda, ErrorHacienda, leerRespuesta };
