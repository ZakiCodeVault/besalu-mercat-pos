/**
 * hacienda-simulada.js — Servidor local que imita el IdP y la API de Recepción
 * de Hacienda, para las pruebas automáticas.
 *
 * Por cada comprobante recibido verifica la firma XAdES (xml-crypto) y lo
 * valida contra los XSD oficiales v4.4 (xmllint, si está instalado).
 * Responde "procesando" en la primera consulta y luego "aceptado" (o
 * "rechazado" para las claves marcadas).
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { SignedXml } = require('xml-crypto');
const { DOMParser } = require('@xmldom/xmldom');

const ESQUEMAS = path.join(__dirname, 'esquemas', '2024', 'v4.4');
const XSD = { '01': 'FacturaElectronica_V4.4.xsd', '03': 'NotaCreditoElectronica_V4.4.xsd', '04': 'TiqueteElectronico_V4.4.xsd' };
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
 * @returns {Promise<object>} simulador con { urls, recibidos, errores, caido, rechazar, validacion400, cerrar() }
 */
async function crearSimulador({ usuario, contrasena, certPem, cedula = '3101123456', puerto = 0 }) {
  const sim = { caido: false, recibidos: [], tokens: 0, refrescos: 0, consultas: {}, rechazar: new Set(), validacion400: new Set(), errores: [] };
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
        if (sim.recibidos.some((r) => r.clave === j.clave)) return responder(400, null, { 'X-Error-Cause': 'El comprobante con la Clave [' + j.clave + '] ya fue recibido.' });
        if (sim.validacion400.has(j.clave)) return responder(400, null, { 'X-Error-Cause': 'El XML no cumple el esquema', 'validation-exception': 'true' });
        const tipo = j.clave.slice(29, 31);
        try {
          ok(/^\d{50}$/.test(j.clave), 'clave');
          ok(j.emisor.numeroIdentificacion === cedula && j.emisor.tipoIdentificacion === '02', 'emisor');
          ok(contenido.includes('<Clave>' + j.clave + '</Clave>'), 'clave en XML');
          ok(firmaValida(contenido, certPem), 'firma inválida');
          validarXsd(tipo, contenido);
        } catch (e) { sim.errores.push(j.clave + ': ' + e.message); return responder(400, null, { 'X-Error-Cause': e.message }); }
        sim.recibidos.push({ clave: j.clave, tipo, xml: contenido, receptor: j.receptor || null });
        return responder(201, null, { Location: '/recepcion/' + j.clave });
      }
      const m = req.url.match(/^\/recepcion\/(\d{50})$/);
      if (req.method === 'GET' && m) {
        const clave = m[1];
        if (!sim.recibidos.some((r) => r.clave === clave)) return responder(400, null, { 'X-Error-Cause': 'No existe el recurso con Clave = [' + clave + ']' });
        sim.consultas[clave] = (sim.consultas[clave] || 0) + 1;
        if (sim.consultas[clave] === 1) return responder(200, { clave, fecha: '', 'ind-estado': 'procesando' });
        const aceptado = !sim.rechazar.has(clave);
        const detalle = aceptado ? 'Este comprobante fue aceptado en el ambiente de pruebas' : 'El código de actividad 471101 no está inscrito &amp; otro error';
        return responder(200, { clave, fecha: '', 'ind-estado': aceptado ? 'aceptado' : 'rechazado',
          'respuesta-xml': Buffer.from(mensajeHacienda(clave, aceptado, detalle)).toString('base64') });
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
