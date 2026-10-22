/**
 * smtp-simulado.js — Servidor de correo (SMTP) local para las pruebas automáticas.
 *
 * Habla lo justo del protocolo (EHLO, STARTTLS, AUTH PLAIN/LOGIN, MAIL, RCPT,
 * DATA, RSET, NOOP, QUIT), guarda cada mensaje recibido y lo separa en partes
 * MIME para revisar los adjuntos. Puede simular:
 *   caido     → corta cada conexión (como si no hubiera internet)
 *   ocupado   → "451 intente más tarde" al empezar cada mensaje
 *   rechazar  → direcciones que no existen (550)
 * y una contraseña incorrecta (535). Nada sale de esta computadora.
 */
const net = require('net');
const tls = require('tls');
const forge = require('node-forge');

/** Certificado propio para "localhost" (sin la IP, para probar el error de nombre). */
function certificadoLocal() {
  const llaves = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = llaves.publicKey;
  cert.serialNumber = '0a1b2c';
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + 30 * 86400000);
  const nombre = [{ name: 'commonName', value: 'localhost' }, { name: 'organizationName', value: 'SMTP DE PRUEBA' }];
  cert.setSubject(nombre);
  cert.setIssuer(nombre);
  cert.setExtensions([{ name: 'basicConstraints', cA: true }, { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }] }]);
  cert.sign(llaves.privateKey, forge.md.sha256.create());
  return { key: forge.pki.privateKeyToPem(llaves.privateKey), cert: forge.pki.certificateToPem(cert) };
}

/* ---------------- Lectura de mensajes (MIME) ---------------- */

/** "=?UTF-8?Q?Factura_electr=C3=B3nica?=" → "Factura electrónica" */
function decodificarEncabezado(s) {
  return String(s || '').replace(/\?=\s+=\?/g, '?==?').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, _juego, modo, texto) => {
    if (modo.toUpperCase() === 'B') return Buffer.from(texto, 'base64').toString('utf8');
    return Buffer.from(texto.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (_x, h) => String.fromCharCode(parseInt(h, 16))), 'binary').toString('utf8');
  });
}

/** Valor de un parámetro (name, filename, boundary), incluido el formato largo de RFC 2231. */
function parametro(valor, nombre) {
  const pares = {};
  const re = /;\s*([^=;\s]+)\s*=\s*("(?:[^"\\]|\\.)*"|[^;]*)/g;
  let m;
  while ((m = re.exec(String(valor || '')))) pares[m[1].toLowerCase()] = m[2].trim().replace(/^"|"$/g, '');
  if (pares[nombre] != null) return decodificarEncabezado(pares[nombre]);
  const trozos = [];
  for (let i = 0; ; i++) {
    if (pares[nombre + '*' + i] != null) trozos.push({ v: pares[nombre + '*' + i], cod: false });
    else if (pares[nombre + '*' + i + '*'] != null) trozos.push({ v: pares[nombre + '*' + i + '*'], cod: true });
    else break;
  }
  if (pares[nombre + '*'] != null) trozos.push({ v: pares[nombre + '*'], cod: true });
  if (!trozos.length) return null;
  const texto = trozos.map((t, i) => (t.cod ? (i === 0 ? t.v.replace(/^[^']*'[^']*'/, '') : t.v) : t.v)).join('');
  return trozos.some((t) => t.cod) ? decodeURIComponent(texto) : texto;
}

function decodificarCuerpo(cuerpo, codificacion) {
  const c = String(codificacion || '').toLowerCase();
  if (c === 'base64') return Buffer.from(cuerpo.replace(/\s+/g, ''), 'base64');
  if (c === 'quoted-printable') {
    return Buffer.from(cuerpo.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_x, h) => String.fromCharCode(parseInt(h, 16))), 'binary');
  }
  return Buffer.from(cuerpo, 'binary');
}

/** Separa un mensaje en encabezados y partes. Devuelve { encabezados, partes:[{ tipo, archivo, contenido }] }. */
function leerMensaje(raw) {
  const texto = Buffer.isBuffer(raw) ? raw.toString('binary') : String(raw);
  const partes = [];
  const leerParte = (t) => {
    const corte = t.indexOf('\r\n\r\n');
    const cab = corte < 0 ? t : t.slice(0, corte), cuerpo = corte < 0 ? '' : t.slice(corte + 4);
    const enc = {};
    for (const linea of cab.replace(/\r\n[ \t]+/g, ' ').split('\r\n')) {
      const i = linea.indexOf(':');
      if (i > 0) enc[linea.slice(0, i).trim().toLowerCase()] = linea.slice(i + 1).trim();
    }
    const tipo = (enc['content-type'] || 'text/plain').split(';')[0].trim().toLowerCase();
    if (tipo.startsWith('multipart/')) {
      const limite = '--' + parametro(enc['content-type'], 'boundary');
      const trozos = cuerpo.split(limite).slice(1);
      for (const tr of trozos) {
        if (tr.startsWith('--')) break;
        leerParte(tr.replace(/^\r\n/, '').replace(/\r\n$/, ''));
      }
    } else {
      partes.push({
        tipo,
        archivo: parametro(enc['content-disposition'], 'filename') || parametro(enc['content-type'], 'name'),
        contenido: decodificarCuerpo(cuerpo, enc['content-transfer-encoding'])
      });
    }
    return enc;
  };
  const encabezados = leerParte(texto);
  return { encabezados, asunto: decodificarEncabezado(encabezados.subject), partes };
}

/* ---------------- Servidor ---------------- */

/**
 * @param {object} o { usuario, contrasena, modo: 'plano' | 'ssl' | 'starttls', certificado?, puerto? }
 * @returns {Promise<object>} simulador con { puerto, mensajes, caido, ocupado, rechazar, autenticaciones, cerrar() }
 */
async function crearSmtp({ usuario, contrasena, modo = 'plano', certificado = null, puerto = 0 }) {
  const sim = { mensajes: [], caido: false, ocupado: false, rechazar: new Set(), autenticaciones: 0, conexiones: 0 };
  const cert = modo === 'plano' ? null : (certificado || certificadoLocal());
  const sockets = new Set();

  const sesion = (sock, cifrado, saludar) => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
    sock.on('error', () => {});
    let buf = '', datos = null, esperando = null, autenticado = false, desde = null, para = [];
    const decir = (l) => { if (!sock.destroyed) sock.write(l + '\r\n'); };
    const reiniciar = () => { desde = null; para = []; };
    const ingresar = (u, p) => {
      sim.autenticaciones++;
      if (u === usuario && p === contrasena) { autenticado = true; decir('235 2.7.0 Autenticado'); }
      else decir('535 5.7.8 Credenciales inválidas');
    };
    const comando = (linea) => {
      if (esperando === 'usuario') { esperando = { u: Buffer.from(linea, 'base64').toString('utf8') }; return decir('334 UGFzc3dvcmQ6'); }
      if (esperando && esperando.u != null) { const u = esperando.u; esperando = null; return ingresar(u, Buffer.from(linea, 'base64').toString('utf8')); }
      const [verbo, ...resto] = linea.split(' ');
      const arg = resto.join(' ');
      switch (verbo.toUpperCase()) {
        case 'EHLO': case 'HELO':
          reiniciar();
          return decir(['250-smtp.prueba', '250-8BITMIME', '250-SMTPUTF8', modo === 'starttls' && !cifrado ? '250-STARTTLS' : null, '250 AUTH PLAIN LOGIN']
            .filter(Boolean).join('\r\n'));
        case 'STARTTLS': {
          if (modo !== 'starttls' || cifrado) return decir('502 5.5.1 No disponible');
          decir('220 2.0.0 Listo para TLS');
          sock.removeAllListeners('data');
          const seguro = new tls.TLSSocket(sock, { isServer: true, key: cert.key, cert: cert.cert });
          return sesion(seguro, true, false);
        }
        case 'AUTH': {
          const [metodo, inicial] = arg.split(' ');
          if (metodo.toUpperCase() === 'PLAIN') {
            const [, u, p] = Buffer.from(inicial || '', 'base64').toString('utf8').split('\0');
            return ingresar(u, p);
          }
          if (metodo.toUpperCase() === 'LOGIN') { esperando = 'usuario'; return decir('334 VXNlcm5hbWU6'); }
          return decir('504 5.5.4 Método no soportado');
        }
        case 'MAIL':
          if (!autenticado) return decir('530 5.7.0 Debe autenticarse');
          if (sim.ocupado) return decir('451 4.3.0 Intente más tarde');
          desde = (arg.match(/<([^>]*)>/) || [])[1] || '';
          return decir('250 2.1.0 OK');
        case 'RCPT': {
          if (desde == null) return decir('503 5.5.1 Primero MAIL FROM');
          const a = ((arg.match(/<([^>]*)>/) || [])[1] || '').toLowerCase();
          if (sim.rechazar.has(a)) return decir('550 5.1.1 <' + a + '>: el buzón no existe');
          para.push(a);
          return decir('250 2.1.5 OK');
        }
        case 'DATA':
          if (!para.length) return decir('503 5.5.1 Sin destinatarios');
          datos = '';
          return decir('354 Termine con <CR><LF>.<CR><LF>');
        case 'RSET': reiniciar(); return decir('250 2.0.0 OK');
        case 'NOOP': return decir('250 2.0.0 OK');
        case 'QUIT': decir('221 2.0.0 Adiós'); return sock.end();
        default: return decir('502 5.5.2 Comando desconocido');
      }
    };
    sock.on('data', (trozo) => {
      buf += trozo.toString('binary');
      for (;;) {
        if (datos !== null) {
          const fin = ('\r\n' + buf).indexOf('\r\n.\r\n');
          if (fin < 0) return;
          const contenido = buf.slice(0, Math.max(0, fin - 2)).replace(/^\.\./, '.').replace(/\r\n\.\./g, '\r\n.');
          buf = buf.slice(fin + 3);
          const raw = Buffer.from(contenido, 'binary');
          sim.mensajes.push(Object.assign({ de: desde, para: para.slice(), cifrado, raw }, leerMensaje(raw)));
          datos = null; reiniciar();
          decir('250 2.0.0 OK recibido');
          continue;
        }
        const i = buf.indexOf('\r\n');
        if (i < 0) return;
        const linea = Buffer.from(buf.slice(0, i), 'binary').toString('utf8');
        buf = buf.slice(i + 2);
        comando(linea);
        if (sock.destroyed) return;
      }
    });
    if (saludar) decir('220 smtp.prueba ESMTP listo');
  };

  const alConectar = (sock, cifrado) => {
    sim.conexiones++;
    if (sim.caido) { sock.destroy(); return; }
    sesion(sock, cifrado, true);
  };
  const servidor = modo === 'ssl'
    ? tls.createServer({ key: cert.key, cert: cert.cert }, (s) => alConectar(s, true))
    : net.createServer((s) => alConectar(s, false));
  servidor.on('tlsClientError', () => {});
  await new Promise((r) => servidor.listen(puerto, '127.0.0.1', r));
  sim.puerto = servidor.address().port;
  sim.certificado = cert;
  sim.cerrar = () => new Promise((r) => { for (const s of sockets) s.destroy(); servidor.close(() => r()); });
  return sim;
}

module.exports = { crearSmtp, leerMensaje, certificadoLocal };
