/**
 * etiquetas.js — Impresión de etiquetas en la SAT TT448-2 USE (transferencia
 * térmica, 203 dpi = 8 puntos por mm, hasta 104 mm de ancho, TSPL/ZPL/EPL).
 *
 * La pantalla dibuja cada etiqueta (la misma imagen que muestra en la vista
 * previa) y la manda aquí como imagen de 1 bit. Este módulo:
 *   - guarda la configuración de la impresora,
 *   - arma los comandos en TSPL (el lenguaje propio de la impresora) o ZPL,
 *   - los manda tal cual ("RAW") a la impresora de Windows por USB, o por la
 *     red al puerto 9100 de la impresora.
 * Nada pasa por el diálogo de impresión ni por el driver gráfico: cada punto
 * de la etiqueta es exactamente el de la vista previa.
 */
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { leerConfig, escribirConfig, registrar } = require('./datos/conexion');

const PUNTOS_POR_MM = 8;   // 203 dpi
const ANCHO_MAXIMO_MM = 104;
const BASE = {
  modelo: 'SAT TT448-2 USE',
  conexion: 'usb',       // 'usb' (impresora instalada en Windows) | 'red' (Ethernet)
  impresora: '',         // nombre de la impresora en Windows
  ip: '', puerto: 9100,
  lenguaje: 'tspl',      // 'tspl' (propio de la impresora) | 'zpl'
  ancho: 50, alto: 25,   // mm, tamaño de la etiqueta del rollo
  separacion: 2,         // mm entre etiquetas (gap)
  oscuridad: 8,          // 0 a 15
  velocidad: 4,          // pulgadas por segundo (la TT448-2 llega a 5)
  corrimientoX: 0, corrimientoY: 0   // mm, para centrar si el rollo queda corrido
};

function leer() { return Object.assign({}, BASE, leerConfig('etiquetas', {})); }

function numero(v, min, max, nombre, entero = false) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max || (entero && !Number.isInteger(n))) throw new Error(nombre + ': debe ser un número entre ' + min + ' y ' + max);
  return n;
}

/** Solo direcciones de la red local (la impresora está en el negocio) o de esta misma computadora. */
function ipLocal(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip || '').trim());
  if (!m || m.slice(1).some((x) => Number(x) > 255)) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a === 127;
}

function guardar(nuevo) {
  const c = Object.assign(leer(), nuevo || {});
  if (!['usb', 'red'].includes(c.conexion)) throw new Error('Conexión inválida');
  if (!['tspl', 'zpl'].includes(c.lenguaje)) throw new Error('Lenguaje inválido');
  c.impresora = String(c.impresora || '').slice(0, 200);
  c.ip = String(c.ip || '').trim();
  if (c.conexion === 'red' && !ipLocal(c.ip)) throw new Error('Escriba la dirección IP de la impresora en la red del negocio (por ejemplo 192.168.1.50)');
  c.puerto = numero(c.puerto, 1, 65535, 'Puerto', true);
  c.ancho = numero(c.ancho, 10, ANCHO_MAXIMO_MM, 'Ancho de la etiqueta (mm)');
  c.alto = numero(c.alto, 10, 300, 'Alto de la etiqueta (mm)');
  c.separacion = numero(c.separacion, 0, 10, 'Separación entre etiquetas (mm)');
  c.oscuridad = numero(c.oscuridad, 0, 15, 'Oscuridad', true);
  c.velocidad = numero(c.velocidad, 2, 5, 'Velocidad', true);
  c.corrimientoX = numero(c.corrimientoX, -5, 5, 'Corrimiento horizontal (mm)');
  c.corrimientoY = numero(c.corrimientoY, -5, 5, 'Corrimiento vertical (mm)');
  const final = {};
  for (const k of Object.keys(BASE)) final[k] = c[k];
  escribirConfig('etiquetas', final);
  registrar('etiquetas_configuradas', { conexion: final.conexion, lenguaje: final.lenguaje, tamano: final.ancho + '×' + final.alto });
  return final;
}

/**
 * Revisa lo que manda la pantalla: cada etiqueta es una imagen de 1 bit por
 * punto (1 = negro), fila por fila, del tamaño de la etiqueta.
 * @param {object} t { ancho, alto (mm), etiquetas: [{ anchoPx, altoPx, datos: Uint8Array, copias }] }
 */
function validarTrabajo(t) {
  if (!t || !Array.isArray(t.etiquetas) || !t.etiquetas.length) throw new Error('No hay etiquetas para imprimir');
  if (t.etiquetas.length > 300) throw new Error('Máximo 300 etiquetas distintas por impresión');
  const ancho = numero(t.ancho, 10, ANCHO_MAXIMO_MM, 'Ancho de la etiqueta (mm)');
  const alto = numero(t.alto, 10, 300, 'Alto de la etiqueta (mm)');
  let total = 0, copias = 0;
  const etiquetas = t.etiquetas.map((e, i) => {
    const anchoPx = numero(e.anchoPx, 8, ANCHO_MAXIMO_MM * PUNTOS_POR_MM, 'Etiqueta ' + (i + 1) + ': ancho', true);
    const altoPx = numero(e.altoPx, 8, 300 * PUNTOS_POR_MM, 'Etiqueta ' + (i + 1) + ': alto', true);
    if (anchoPx > Math.round(ancho * PUNTOS_POR_MM) || altoPx > Math.round(alto * PUNTOS_POR_MM)) throw new Error('Etiqueta ' + (i + 1) + ': la imagen es más grande que la etiqueta');
    const datos = Buffer.from(e.datos && e.datos.buffer ? new Uint8Array(e.datos.buffer, e.datos.byteOffset, e.datos.byteLength) : (e.datos || []));
    const bytesPorFila = Math.ceil(anchoPx / 8);
    if (datos.length !== bytesPorFila * altoPx) throw new Error('Etiqueta ' + (i + 1) + ': la imagen está incompleta');
    const n = numero(e.copias == null ? 1 : e.copias, 1, 500, 'Etiqueta ' + (i + 1) + ': copias', true);
    total += datos.length; copias += n;
    return { anchoPx, altoPx, bytesPorFila, datos, copias: n };
  });
  if (total > 20 * 1024 * 1024) throw new Error('Demasiadas etiquetas en una sola impresión: divídalas');
  if (copias > 2000) throw new Error('Máximo 2 000 etiquetas por impresión');
  return { ancho, alto, etiquetas, copias };
}

const mm = (n) => String(Math.round(n * 10) / 10);

/** TSPL (TSC/SAT): en BITMAP el bit 0 imprime (negro) y el 1 deja en blanco: se invierte. */
function comandosTspl(c, t) {
  const partes = [];
  const txt = (s) => partes.push(Buffer.from(s, 'latin1'));
  txt('SIZE ' + mm(t.ancho) + ' mm,' + mm(t.alto) + ' mm\r\n' + 'GAP ' + mm(c.separacion) + ' mm,0 mm\r\n' +
    'DIRECTION 1,0\r\nREFERENCE 0,0\r\nOFFSET 0 mm\r\nSET TEAR ON\r\n' + 'DENSITY ' + c.oscuridad + '\r\nSPEED ' + c.velocidad + '\r\n');
  for (const e of t.etiquetas) {
    const inv = Buffer.allocUnsafe(e.datos.length);
    for (let i = 0; i < e.datos.length; i++) inv[i] = ~e.datos[i] & 0xff;
    txt('CLS\r\nBITMAP 0,0,' + e.bytesPorFila + ',' + e.altoPx + ',0,');
    partes.push(inv);
    txt('\r\nPRINT 1,' + e.copias + '\r\n');
  }
  return Buffer.concat(partes);
}

/** ZPL: en ^GFA el bit 1 es negro (sin invertir), en hexadecimal. */
function comandosZpl(c, t) {
  const salida = [];
  for (const e of t.etiquetas) {
    const bytes = e.datos.length;
    salida.push('^XA^PW' + Math.round(t.ancho * PUNTOS_POR_MM) + '^LL' + Math.round(t.alto * PUNTOS_POR_MM) + '^LH0,0^MNY' +
      '~SD' + String(Math.round(c.oscuridad * 2)).padStart(2, '0') + '^PR' + c.velocidad +
      '^FO0,0^GFA,' + bytes + ',' + bytes + ',' + e.bytesPorFila + ',' + e.datos.toString('hex').toUpperCase() + '^FS^PQ' + e.copias + '^XZ\r\n');
  }
  return Buffer.from(salida.join(''), 'latin1');
}

function comandos(c, trabajo) {
  const t = validarTrabajo(trabajo);
  return { datos: c.lenguaje === 'zpl' ? comandosZpl(c, t) : comandosTspl(c, t), copias: t.copias };
}

/* ---------------- Envío ---------------- */
function enviarRed(ip, puerto, datos, espera = 10000) {
  return new Promise((resolver, rechazar) => {
    const s = net.createConnection({ host: ip, port: puerto });
    let listo = false;
    const fallo = (motivo) => { if (listo) return; listo = true; s.destroy(); rechazar(new Error('No se pudo imprimir en ' + ip + ':' + puerto + ' (' + motivo + '). Revise que la impresora esté encendida y conectada a la red.')); };
    s.setTimeout(espera, () => fallo('no responde'));
    s.on('error', (e) => fallo(e.code === 'ECONNREFUSED' ? 'rechazó la conexión' : e.code === 'EHOSTUNREACH' ? 'no se encuentra en la red' : e.code || e.message));
    s.on('connect', () => s.end(datos));
    s.on('close', (conError) => { if (!listo && !conError) { listo = true; resolver(); } });
  });
}

// Manda los bytes tal cual a la cola de la impresora de Windows (winspool, datos "RAW").
// El nombre de la impresora y el archivo van por variables de entorno: nunca dentro del script.
const SCRIPT_RAW = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class BesaluRaw {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool OpenPrinter(string nombre, out IntPtr h, IntPtr defecto);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern int StartDocPrinter(IntPtr h, int nivel, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO doc);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool WritePrinter(IntPtr h, byte[] datos, int largo, out int escritos);
  public static void Enviar(string impresora, byte[] datos) {
    IntPtr h;
    if (!OpenPrinter(impresora, out h, IntPtr.Zero)) throw new Exception("BESALU_SIN_IMPRESORA " + Marshal.GetLastWin32Error());
    try {
      DOCINFO doc = new DOCINFO();
      doc.pDocName = "Etiquetas Besalu Mercat";
      doc.pDataType = "RAW";
      if (StartDocPrinter(h, 1, doc) == 0) throw new Exception("BESALU_SIN_TRABAJO " + Marshal.GetLastWin32Error());
      try {
        if (!StartPagePrinter(h)) throw new Exception("BESALU_SIN_PAGINA " + Marshal.GetLastWin32Error());
        int escritos;
        bool ok = WritePrinter(h, datos, datos.Length, out escritos);
        EndPagePrinter(h);
        if (!ok || escritos != datos.Length) throw new Exception("BESALU_SIN_ESCRIBIR " + Marshal.GetLastWin32Error());
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
'@
[BesaluRaw]::Enviar($env:BESALU_IMPRESORA, [System.IO.File]::ReadAllBytes($env:BESALU_ARCHIVO))
`;

function enviarWindows(impresora, datos) {
  if (process.platform !== 'win32') return Promise.reject(new Error('La impresión por USB funciona en la computadora de la caja (Windows)'));
  const archivo = path.join(os.tmpdir(), 'besalu-etiquetas-' + crypto.randomBytes(6).toString('hex') + '.bin');
  fs.writeFileSync(archivo, datos);
  const codificado = Buffer.from(SCRIPT_RAW, 'utf16le').toString('base64');
  return new Promise((resolver, rechazar) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', codificado], {
      windowsHide: true, timeout: 45000, env: Object.assign({}, process.env, { BESALU_IMPRESORA: impresora, BESALU_ARCHIVO: archivo })
    }, (error, _salida, errores) => {
      fs.rm(archivo, { force: true }, () => {});
      if (!error) return resolver();
      const texto = String(errores || error.message);
      if (/BESALU_SIN_IMPRESORA/.test(texto)) rechazar(new Error('Windows no encontró la impresora "' + impresora + '"'));
      else if (/BESALU_SIN_(TRABAJO|PAGINA|ESCRIBIR)/.test(texto)) rechazar(new Error('La impresora "' + impresora + '" no recibió las etiquetas. Revise que esté encendida y con el cable USB conectado.'));
      else rechazar(new Error('No se pudo imprimir: ' + texto.split('\n')[0].slice(0, 200)));
    });
  });
}

/**
 * Imprime un trabajo de etiquetas.
 * @param {object} trabajo ver validarTrabajo
 * @param {() => Promise<string[]>} impresorasInstaladas nombres de las impresoras de Windows
 */
async function imprimir(trabajo, impresorasInstaladas) {
  const c = leer();
  const { datos, copias } = comandos(c, trabajo);
  if (c.conexion === 'red') {
    if (!ipLocal(c.ip)) throw new Error('Configure la dirección IP de la impresora de etiquetas');
    await enviarRed(c.ip, c.puerto, datos);
  } else {
    if (!c.impresora) throw new Error('Elija la impresora de etiquetas en "Configurar impresora"');
    const nombres = await impresorasInstaladas();
    if (!nombres.includes(c.impresora)) throw new Error('La impresora "' + c.impresora + '" no está instalada en esta computadora');
    await enviarWindows(c.impresora, datos);
  }
  registrar('etiquetas_impresas', { etiquetas: copias, distintas: trabajo.etiquetas.length, por: c.conexion === 'red' ? c.ip : c.impresora, lenguaje: c.lenguaje });
  return { copias, bytes: datos.length };
}

module.exports = { BASE, PUNTOS_POR_MM, ANCHO_MAXIMO_MM, leer, guardar, validarTrabajo, comandos, comandosTspl, comandosZpl, imprimir, enviarRed, enviarWindows, ipLocal };
