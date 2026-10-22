/**
 * hacienda-simulada.js — Servidor local que imita el IdP y la API de Recepción
 * de Hacienda, para las pruebas automáticas.
 *
 * Por cada comprobante recibido verifica la firma XAdES (xml-crypto) y lo
 * valida contra los XSD oficiales v4.4 (xmllint, si está instalado).
 * Responde "procesando" en la primera consulta y luego "aceptado" (o
 * "rechazado" para las claves marcadas).
 *
 * Mensajes de receptor (llevan consecutivoReceptor): se consultan con
 * "clave-consecutivo". Si la factura del proveedor está en `sim.facturas`,
 * se comparan las cédulas y los montos como lo hace Hacienda y, si no
 * coinciden, el mensaje se rechaza.
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { SignedXml } = require('xml-crypto');
const { DOMParser } = require('@xmldom/xmldom');

const ESQUEMAS = path.join(__dirname, 'esquemas', '2024', 'v4.4');
const XSD = { '01': 'FacturaElectronica_V4.4.xsd', '03': 'NotaCreditoElectronica_V4.4.xsd', '04': 'TiqueteElectronico_V4.4.xsd',
  MR: 'MensajeReceptor_V4.4.xsd' };
const CODIGO_MENSAJE = { '05': '1', '06': '2', '07': '3' };
const valorXml = (xml, etiqueta) => { const m = xml.match(new RegExp('<' + etiqueta + '>([^<]*)</' + etiqueta + '>')); return m ? m[1] : null; };
const NS_DS = 'http://www.w3.org/2000/09/xmldsig#';

let hayXmllint = true;
try { execFileSync('xmllint', ['--version'], { stdio: 'ignore' }); } catch (e) { hayXmllint = false; }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'besalu-xsd-'));

function validarXsd(tipo, contenido) {
  if (!hayXmllint) return 'sin xmllint';
  const archivo = path.join(tmp, Date.now() + '-' + Math.random().toString(16).slice(2) + '.xml');
  fs.writeFileSync(archivo, contenido);
  try { execFileSync('xmllint', ['--noout', '--schema', path.join(ESQUEMAS, XSD[tipo]), archivo], { stdio: 'pipe' }); }
  catch (e) { throw new Error('XSD: ' + e.stderr.toString().split('\n').slice(0, 3).join(' | ')); }
  finally { fs.rmSync(archivo, { force: true }); }
  return 'XSD ok';
}

function firmaValida(contenido, certPem) {
  const doc = new DOMParser().parseFromString(contenido, 'text/xml');
  const nodo = doc.getElementsByTagNameNS(NS_DS, 'Signature')[0];
  if (!nodo) return false;
  const sx = new SignedXml({ publicCert: certPem, getCertFromKeyInfo: () => null });
  sx.loadSignature(nodo);
  return sx.checkSignature(contenido);
}

function mensajeHacienda(clave, aceptado, detalle) {
  return '<?xml version="1.0" encoding="UTF-8"?><MensajeHacienda xmlns="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/mensajeHacienda">' +
    '<Clave>' + clave + '</Clave><NombreEmisor>Besalu</NombreEmisor><TipoIdentificacionEmisor>02</TipoIdentificacionEmisor>' +
    '<NumeroCedulaEmisor>3101123456</NumeroCedulaEmisor><Mensaje>' + (aceptado ? 1 : 3) + '</Mensaje><EstadoMensaje>' +
    (aceptado ? 'Aceptado' : 'Rechazado') + '</EstadoMensaje><DetalleMensaje>' + detalle + '</DetalleMensaje><TotalFactura>1</TotalFactura></MensajeHacienda>';
}

/**
 * @param {object} o { usuario, contrasena, certPem, cedula, puerto (0 = cualquiera) }
 * @returns {Promise<object>} simulador con { urls, recibidos, errores, caido, rechazar, validacion400, facturas, cerrar() }
 *   facturas: Map clave → { emisor, receptor, total, impuesto } (facturas de proveedores que "tiene" Hacienda)
 */
async function crearSimulador({ usuario, contrasena, certPem, cedula = '3101123456', puerto = 0 }) {
  const sim = { caido: false, recibidos: [], tokens: 0, refrescos: 0, consultas: {}, rechazar: new Set(), validacion400: new Set(), errores: [], facturas: new Map() };

  /** Lo que Hacienda revisa de un mensaje de receptor contra la factura (Anexo v4.4). */
  function revisarMensaje(r) {
    const f = sim.facturas.get(r.claveFactura);
    if (!f) return null;
    const x = r.xml;
    if (valorXml(x, 'NumeroCedulaEmisor') !== f.emisor) return 'La cédula del emisor no coincide con la del comprobante';
    if (valorXml(x, 'NumeroCedulaReceptor') !== f.receptor) return 'La cédula del receptor no coincide con la del comprobante';
    if (Number(valorXml(x, 'TotalFactura')) !== Number(f.total)) return 'El total de la factura no coincide con el del comprobante';
    if (Number(valorXml(x, 'MontoTotalImpuesto') || 0) !== Number(f.impuesto || 0)) return 'El monto total del impuesto no coincide con el del comprobante';
    return null;
  }
  const ok = (c, m) => { if (!c) throw new Error(m); };
  const servidor = http.createServer((req, res) => {
    if (sim.caido) { req.socket.destroy(); return; }
    let cuerpo = '';
    req.on('data', (c) => (cuerpo += c));
    req.on('end', () => {
      const responder = (status, obj, headers = {}) => { res.writeHead(status, Object.assign({ 'Content-Type': 'application/json' }, headers)); res.end(obj ? JSON.stringify(obj) : ''); };
      if (req.url === '/token') {
        const f = new URLSearchParams(cuerpo);
        if (f.get('client_id') !== 'api-stag' && f.get('client_id') !== 'api-prod') return responder(400, { error: 'invalid_client' });
        if (f.get('grant_type') === 'refresh_token') { sim.refrescos++; return responder(200, { access_token: 'tok-r' + sim.refrescos, expires_in: 300, refresh_token: 'ref', refresh_expires_in: 36000 }); }
        if (f.get('username') !== usuario || f.get('password') !== contrasena) return responder(401, { error: 'invalid_grant', error_description: 'Invalid user credentials' });
        sim.tokens++;
        return responder(200, { access_token: 'tok-' + sim.tokens, expires_in: 300, refresh_token: 'ref', refresh_expires_in: 36000 });
      }
      if (req.url === '/logout') return responder(204);
      if (!/^bearer tok-/.test(req.headers.authorization || '')) return responder(401);
      if (req.method === 'POST' && req.url === '/recepcion') {
        const j = JSON.parse(cuerpo);
        const contenido = Buffer.from(j.comprobanteXml, 'base64').toString('utf8');
        const mensajeReceptor = j.consecutivoReceptor !== undefined;
        const id = mensajeReceptor ? j.clave + '-' + j.consecutivoReceptor : j.clave;
        if (sim.recibidos.some((r) => r.clave === id)) return responder(400, null, { 'X-Error-Cause': 'El comprobante con la Clave [' + id + '] ya fue recibido.' });
        if (sim.validacion400.has(id)) return responder(400, null, { 'X-Error-Cause': 'El XML no cumple el esquema', 'validation-exception': 'true' });
        const tipo = mensajeReceptor ? String(j.consecutivoReceptor).slice(8, 10) : j.clave.slice(29, 31);
        try {
          ok(/^\d{50}$/.test(j.clave), 'clave');
          ok(contenido.includes('<Clave>' + j.clave + '</Clave>'), 'clave en XML');
          if (mensajeReceptor) {
            // Mensaje Receptor: emisor = el proveedor, receptor = el negocio que acepta o rechaza
            ok(/^\d{20}$/.test(j.consecutivoReceptor) && CODIGO_MENSAJE[tipo], 'consecutivoReceptor');
            ok(j.receptor && j.receptor.numeroIdentificacion === cedula && j.receptor.tipoIdentificacion === '02', 'receptor');
            ok(j.emisor && /^\d{9,12}$/.test(j.emisor.numeroIdentificacion) && j.emisor.numeroIdentificacion !== cedula, 'emisor');
            ok(contenido.includes('<NumeroConsecutivoReceptor>' + j.consecutivoReceptor + '</NumeroConsecutivoReceptor>'), 'consecutivo en XML');
            ok(contenido.includes('<Mensaje>' + CODIGO_MENSAJE[tipo] + '</Mensaje>'), 'código de mensaje según el tipo ' + tipo);
            ok(contenido.includes('<NumeroCedulaEmisor>' + j.emisor.numeroIdentificacion + '</NumeroCedulaEmisor>'), 'cédula del emisor en XML');
          } else {
            ok(j.emisor.numeroIdentificacion === cedula && j.emisor.tipoIdentificacion === '02', 'emisor');
          }
          ok(firmaValida(contenido, certPem), 'firma inválida');
          validarXsd(mensajeReceptor ? 'MR' : tipo, contenido);
        } catch (e) { sim.errores.push(id + ': ' + e.message); return responder(400, null, { 'X-Error-Cause': e.message }); }
        sim.recibidos.push({ clave: id, tipo, xml: contenido, receptor: j.receptor || null, emisor: j.emisor,
          mensajeReceptor, claveFactura: j.clave, consecutivoReceptor: j.consecutivoReceptor || null });
        return responder(201, null, { Location: '/recepcion/' + id });
      }
      const m = req.url.match(/^\/recepcion\/(\d{50}(?:-\d{20})?)$/);
      if (req.method === 'GET' && m) {
        const clave = m[1];
        if (!sim.recibidos.some((r) => r.clave === clave)) return responder(400, null, { 'X-Error-Cause': 'No existe el recurso con Clave = [' + clave + ']' });
        sim.consultas[clave] = (sim.consultas[clave] || 0) + 1;
        if (sim.consultas[clave] === 1) return responder(200, { clave, fecha: '', 'ind-estado': 'procesando' });
        const recibido = sim.recibidos.find((r) => r.clave === clave);
        const problema = recibido.mensajeReceptor ? revisarMensaje(recibido) : null;
        const aceptado = !sim.rechazar.has(clave) && !problema;
        const detalle = aceptado ? 'Este comprobante fue aceptado en el ambiente de pruebas'
          : problema || 'El código de actividad 471101 no está inscrito &amp; otro error';
        return responder(200, { clave, fecha: '', 'ind-estado': aceptado ? 'aceptado' : 'rechazado',
          'respuesta-xml': Buffer.from(mensajeHacienda(clave.slice(0, 50), aceptado, detalle)).toString('base64') });
      }
      responder(404);
    });
  });
  await new Promise((r) => servidor.listen(puerto, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + servidor.address().port;
  sim.urls = { token: base + '/token', cerrarSesion: base + '/logout', recepcion: base + '/recepcion' };
  sim.cerrar = () => new Promise((r) => { servidor.closeAllConnections && servidor.closeAllConnections(); servidor.close(r); });
  return sim;
}

module.exports = { crearSimulador, validarXsd, firmaValida, hayXmllint: () => hayXmllint };
