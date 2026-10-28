/**
 * firma.js — Firma XAdES-EPES de los comprobantes con la llave criptográfica
 * (.p12) que entrega Hacienda.
 *
 * Estructura (Anexo 2 de los Anexos y Estructuras v4.4):
 *   ds:Signature
 *     ds:SignedInfo        C14N 1.0 · RSA-SHA256 · 3 referencias SHA-256:
 *                          documento (enveloped), KeyInfo y SignedProperties
 *     ds:SignatureValue
 *     ds:KeyInfo           certificado + llave pública
 *     ds:Object/xades:QualifyingProperties/xades:SignedProperties
 *                          hora de firma, certificado firmante, política de firma
 *                          (identificador + SHA-256), rol y formato del documento
 *
 * Todo se escribe ya canonicalizado (ver xml.js), así que cada resumen se
 * calcula sobre el mismo texto que obtiene Hacienda al canonicalizar.
 */
const crypto = require('crypto');
// node-forge solo se carga al abrir una llave (no frena el arranque de la caja)
let _forge = null;
const forgeLib = () => _forge || (_forge = require('node-forge'));
const { POLITICA_FIRMA } = require('./catalogos');
const { texto, atributo, NS_DS } = require('./xml');
const { fechaIso } = require('../datos/montos');

const NS_XADES = 'http://uri.etsi.org/01903/v1.3.2#';
const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const RSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
const SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256';
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';
const TIPO_SIGNED_PROPERTIES = 'http://uri.etsi.org/01903#SignedProperties';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('base64');

/* ---------------- Llave criptográfica (.p12) ---------------- */

const NOMBRES_RFC2253 = { '2.5.4.3': 'CN', '2.5.4.6': 'C', '2.5.4.7': 'L', '2.5.4.8': 'ST', '2.5.4.10': 'O', '2.5.4.11': 'OU',
  '2.5.4.9': 'STREET', '0.9.2342.19200300.100.1.25': 'DC', '0.9.2342.19200300.100.1.1': 'UID' };

/** Nombre del emisor del certificado en formato RFC 2253 (como lo escribe Java). */
function nombreRfc2253(atributos) {
  return atributos.slice().reverse().map((a) => {
    const clave = NOMBRES_RFC2253[a.type];
    if (clave) {
      const v = String(a.value).replace(/([,+"\\<>;])/g, '\\$1').replace(/^([ #])/, '\\$1').replace(/ $/, '\\ ');
      return clave + '=' + v;
    }
    // Atributos sin nombre corto (p. ej. serialNumber): OID=#DER en hexadecimal
    const bytes = a.valueTagClass === forgeLib().asn1.Type.UTF8 ? Buffer.from(String(a.value), 'utf8') : Buffer.from(String(a.value), 'latin1');
    const largo = bytes.length < 128 ? Buffer.from([bytes.length]) : Buffer.from([0x81, bytes.length]);
    return a.type + '=#' + Buffer.concat([Buffer.from([a.valueTagClass]), largo, bytes]).toString('hex');
  }).join(',');
}

/** "CPJ-3-101-123456" → "3101123456"; "CPF-01-0234-0567" → "102340567". */
function cedulaDelCertificado(serial) {
  const m = String(serial || '').toUpperCase().match(/^(CPF|CPJ|DIMEX|NITE|DIDI)-([\d-]+)$/);
  if (!m) return '';
  const digitos = m[2].replace(/\D/g, '');
  return m[1] === 'CPF' ? digitos.replace(/^0/, '') : digitos;
}

/**
 * Abre la llave .p12 con su PIN.
 * @returns {{llave, certificadoB64, certificadoDer, emisorRfc2253, serieDecimal, modulo, exponente, info}}
 */
function cargarLlave(p12, pin) {
  let archivo;
  try {
    const der = forgeLib().util.createBuffer(Buffer.from(p12).toString('binary'));
    archivo = forgeLib().pkcs12.pkcs12FromAsn1(forgeLib().asn1.fromDer(der), String(pin));
  } catch (e) {
    if (/mac|password|invalid/i.test(e.message)) throw new Error('El PIN de la llave criptográfica no es correcto');
    throw new Error('El archivo no es una llave criptográfica .p12 válida');
  }
  const bolsas = [
    ...(archivo.getBags({ bagType: forgeLib().pki.oids.pkcs8ShroudedKeyBag })[forgeLib().pki.oids.pkcs8ShroudedKeyBag] || []),
    ...(archivo.getBags({ bagType: forgeLib().pki.oids.keyBag })[forgeLib().pki.oids.keyBag] || [])
  ];
  const llaveForge = bolsas.map((b) => b.key).find(Boolean);
  if (!llaveForge) throw new Error('La llave .p12 no contiene la clave privada');
  const certificados = (archivo.getBags({ bagType: forgeLib().pki.oids.certBag })[forgeLib().pki.oids.certBag] || []).map((b) => b.cert).filter(Boolean);
  const cert = certificados.find((c) => c.publicKey && c.publicKey.n && c.publicKey.n.equals(llaveForge.n));
  if (!cert) throw new Error('La llave .p12 no contiene el certificado de la clave privada');

  const certificadoDer = Buffer.from(forgeLib().asn1.toDer(forgeLib().pki.certificateToAsn1(cert)).getBytes(), 'binary');
  const atributo = (lista, oid) => { const a = lista.find((x) => x.type === oid); return a ? String(a.value) : ''; };
  const serieSujeto = atributo(cert.subject.attributes, '2.5.4.5');
  const aBytes = (bigInt) => { let h = bigInt.toString(16); if (h.length % 2) h = '0' + h; return Buffer.from(h, 'hex'); };
  return {
    llave: crypto.createPrivateKey(forgeLib().pki.privateKeyToPem(llaveForge)),
    certificadoDer,
    certificadoB64: certificadoDer.toString('base64'),
    emisorRfc2253: nombreRfc2253(cert.issuer.attributes),
    serieDecimal: BigInt('0x' + (cert.serialNumber || '0')).toString(10),
    modulo: aBytes(cert.publicKey.n).toString('base64'),
    exponente: aBytes(cert.publicKey.e).toString('base64'),
    info: {
      titular: atributo(cert.subject.attributes, '2.5.4.3'),
      serie: serieSujeto,
      cedula: cedulaDelCertificado(serieSujeto),
      emisor: atributo(cert.issuer.attributes, '2.5.4.3'),
      desde: cert.validity.notBefore.toISOString(),
      vence: cert.validity.notAfter.toISOString()
    }
  };
}

/* ---------------- Firma ---------------- */

/** Etiqueta de apertura con sus declaraciones de espacio de nombres (orden C14N). */
function apertura(nombre, espacios, atributos) {
  const ns = Object.keys(espacios).sort().map((p) => (p ? ' xmlns:' + p : ' xmlns') + '="' + atributo(espacios[p]) + '"');
  const at = Object.keys(atributos).sort().map((k) => ' ' + k + '="' + atributo(atributos[k]) + '"');
  return '<' + nombre + ns.join('') + at.join('') + '>';
}
const el = (nombre, contenido, atributos = {}) => apertura(nombre, {}, atributos) + contenido + '</' + nombre + '>';

/**
 * Firma el XML (raíz canónica, sin declaración) y devuelve el documento completo.
 * @param {string} xml   salida de xml.construir()
 * @param {object} llave salida de cargarLlave()
 * @param {Date}   [cuando] hora de la firma
 */
function firmar(xml, llave, cuando = new Date()) {
  const m = xml.match(/^<([A-Za-z]+) xmlns="([^"]+)">/);
  if (!m || !xml.endsWith('</' + m[1] + '>')) throw new Error('XML del comprobante inválido para firmar');
  const [, raiz, nsRaiz] = m;
  const id = crypto.randomUUID();
  const ids = { firma: 'Signature-' + id, valor: 'SignatureValue-' + id, keyInfo: 'KeyInfo-' + id, documento: 'Reference-' + id,
    calificantes: 'QualifyingProperties-' + id, propiedades: 'SignedProperties-' + id };
  // Espacios de nombres visibles dentro de la firma (el de la raíz se hereda)
  const enFirma = { '': nsRaiz, ds: NS_DS };
  const enXades = { '': nsRaiz, ds: NS_DS, xades: NS_XADES };

  // 1) Resumen del documento (sin la firma: transformación "enveloped")
  const digestDocumento = sha256(xml);

  // 2) KeyInfo
  const keyInfoInterior =
    el('ds:X509Data', el('ds:X509Certificate', llave.certificadoB64)) +
    el('ds:KeyValue', el('ds:RSAKeyValue', el('ds:Modulus', llave.modulo) + el('ds:Exponent', llave.exponente)));
  const digestKeyInfo = sha256(apertura('ds:KeyInfo', enFirma, { Id: ids.keyInfo }) + keyInfoInterior + '</ds:KeyInfo>');

  // 3) SignedProperties (XAdES-EPES)
  const propiedadesInterior =
    el('xades:SignedSignatureProperties',
      el('xades:SigningTime', texto(fechaIso(cuando))) +
      el('xades:SigningCertificate', el('xades:Cert',
        el('xades:CertDigest', el('ds:DigestMethod', '', { Algorithm: SHA256 }) + el('ds:DigestValue', sha256(llave.certificadoDer))) +
        el('xades:IssuerSerial', el('ds:X509IssuerName', texto(llave.emisorRfc2253)) + el('ds:X509SerialNumber', llave.serieDecimal)))) +
      el('xades:SignaturePolicyIdentifier', el('xades:SignaturePolicyId',
        el('xades:SigPolicyId', el('xades:Identifier', texto(POLITICA_FIRMA.url)) + el('xades:Description', '')) +
        el('xades:SigPolicyHash', el('ds:DigestMethod', '', { Algorithm: SHA256 }) + el('ds:DigestValue', POLITICA_FIRMA.digestSha256)))) +
      el('xades:SignerRole', el('xades:ClaimedRoles', el('xades:ClaimedRole', 'ObligadoTributario')))) +
    el('xades:SignedDataObjectProperties', el('xades:DataObjectFormat',
      el('xades:MimeType', 'text/xml') + el('xades:Encoding', 'UTF-8'), { ObjectReference: '#' + ids.documento }));
  const digestPropiedades = sha256(apertura('xades:SignedProperties', enXades, { Id: ids.propiedades }) + propiedadesInterior + '</xades:SignedProperties>');

  // 4) SignedInfo y valor de la firma
  const referencia = (atributos, transformaciones, digest) => el('ds:Reference',
    (transformaciones ? el('ds:Transforms', el('ds:Transform', '', { Algorithm: transformaciones })) : '') +
    el('ds:DigestMethod', '', { Algorithm: SHA256 }) + el('ds:DigestValue', digest), atributos);
  const signedInfoInterior =
    el('ds:CanonicalizationMethod', '', { Algorithm: C14N }) +
    el('ds:SignatureMethod', '', { Algorithm: RSA_SHA256 }) +
    referencia({ Id: ids.documento, URI: '' }, ENVELOPED, digestDocumento) +
    referencia({ URI: '#' + ids.keyInfo }, null, digestKeyInfo) +
    referencia({ Type: TIPO_SIGNED_PROPERTIES, URI: '#' + ids.propiedades }, null, digestPropiedades);
  const signedInfoCanonico = apertura('ds:SignedInfo', enFirma, {}) + signedInfoInterior + '</ds:SignedInfo>';
  const valor = crypto.sign('sha256', Buffer.from(signedInfoCanonico, 'utf8'), llave.llave).toString('base64');

  // 5) Firma completa, como último hijo de la raíz
  const firma = apertura('ds:Signature', { ds: NS_DS }, { Id: ids.firma }) +
    el('ds:SignedInfo', signedInfoInterior) +
    el('ds:SignatureValue', valor, { Id: ids.valor }) +
    el('ds:KeyInfo', keyInfoInterior, { Id: ids.keyInfo }) +
    el('ds:Object', apertura('xades:QualifyingProperties', { xades: NS_XADES }, { Id: ids.calificantes, Target: '#' + ids.firma }) +
      el('xades:SignedProperties', propiedadesInterior, { Id: ids.propiedades }) + '</xades:QualifyingProperties>') +
    '</ds:Signature>';
  return '<?xml version="1.0" encoding="utf-8"?>' + xml.slice(0, -('</' + raiz + '>').length) + firma + '</' + raiz + '>';
}

module.exports = { cargarLlave, firmar, cedulaDelCertificado, nombreRfc2253, NS_XADES };
