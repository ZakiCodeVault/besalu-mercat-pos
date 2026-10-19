/**
 * llave-prueba.js — Genera una llave criptográfica .p12 FALSA para las pruebas
 * (una autoridad "SANDBOX DE PRUEBA" y un certificado con la cédula indicada).
 * No sirve ante Hacienda: solo para probar la firma localmente.
 */
const forge = require('node-forge');

function generarLlavePrueba({ pin = '1234', serie = 'CPJ-3-101-123456', titular = 'BESALU MERCAT SOCIEDAD ANONIMA' } = {}) {
  const ca = forge.pki.rsa.generateKeyPair(2048);
  const caCert = forge.pki.createCertificate();
  caCert.publicKey = ca.publicKey;
  caCert.serialNumber = '01';
  caCert.validity.notBefore = new Date(Date.now() - 86400000);
  caCert.validity.notAfter = new Date(Date.now() + 2 * 365 * 86400000);
  const caNombre = [{ name: 'countryName', value: 'CR' }, { name: 'organizationName', value: 'MINISTERIO DE HACIENDA - PRUEBA' },
    { name: 'organizationalUnitName', value: 'DGT' }, { name: 'commonName', value: 'CA PERSONA JURIDICA - SANDBOX DE PRUEBA' }];
  caCert.setSubject(caNombre);
  caCert.setIssuer(caNombre);
  caCert.setExtensions([{ name: 'basicConstraints', cA: true }]);
  caCert.sign(ca.privateKey, forge.md.sha256.create());

  const llave = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = llave.publicKey;
  cert.serialNumber = '5c1a2b3d4e5f60718293a4b5c6d7e8f9';
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86400000);
  cert.setSubject([{ name: 'countryName', value: 'CR' }, { name: 'organizationName', value: 'PERSONA JURIDICA' },
    { name: 'organizationalUnitName', value: 'CPJ' }, { type: '2.5.4.5', value: serie }, { name: 'commonName', value: titular }]);
  cert.setIssuer(caNombre);
  cert.sign(ca.privateKey, forge.md.sha256.create());

  const p12 = forge.pkcs12.toPkcs12Asn1(llave.privateKey, [cert, caCert], pin, { algorithm: '3des' });
  return { p12: Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary'), pin, certPem: forge.pki.certificateToPem(cert) };
}

module.exports = { generarLlavePrueba };
