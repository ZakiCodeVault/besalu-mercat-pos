/**
 * generar-icono.js — Genera el ícono de la app con el mismo logo de la pantalla.
 *
 *   npx electron herramientas/generar-icono.js
 *
 * Deja recursos/icono.png (512 × 512) y recursos/icono.ico (16 a 256, para
 * Windows: el .exe, la barra de tareas y el instalador). En los tamaños chicos
 * (16 a 32) va solo la "B": la palabra completa no se lee. También la imagen
 * lateral del instalador (recursos/panel-instalador.bmp, 164 × 314).
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
// La fuente del logo se carga desde su archivo (la misma que usa la app)
const PLAYFAIR = fs.readFileSync(path.join(RAIZ, 'interfaz', 'fuentes', 'playfair-display-latin.woff2')).toString('base64');
const TAMANOS = [16, 24, 32, 48, 64, 128, 256, 512];

const DIBUJAR = `(async () => {
  const f = new FontFace('Logo', 'url(data:font/woff2;base64,${PLAYFAIR})', { weight: '700 900' });
  document.fonts.add(await f.load());
  await document.fonts.load('800 100px Logo', 'Besalú'); await document.fonts.load('700 100px Logo', 'MERCAT');
  const salida = {};
  for (const s of ${JSON.stringify(TAMANOS)}) {
    const c = document.createElement('canvas'); c.width = s; c.height = s;
    const x = c.getContext('2d');
    // Cuadro redondeado verde oliva con un brillo suave arriba
    const r = s * 0.22;
    const g = x.createLinearGradient(0, 0, 0, s); g.addColorStop(0, '#565d2f'); g.addColorStop(1, '#33381b');
    x.fillStyle = g; x.beginPath(); x.roundRect(0, 0, s, s, r); x.fill();
    if (s >= 48) { x.strokeStyle = 'rgba(244,236,214,.22)'; x.lineWidth = Math.max(1, s * 0.012); x.beginPath(); x.roundRect(s * 0.045, s * 0.045, s * 0.91, s * 0.91, r * 0.8); x.stroke(); }
    x.textAlign = 'center'; x.textBaseline = 'alphabetic';
    if (s < 48) {
      x.fillStyle = '#f4ecd6';
      x.font = '800 ' + Math.round(s * 0.78) + 'px Logo';
      x.fillText('B', s / 2, s * 0.77);
      x.fillStyle = '#cdb57a'; x.fillRect(Math.round(s * 0.3), Math.round(s * 0.84), Math.round(s * 0.4), Math.max(1, Math.round(s * 0.05)));
    } else if (s < 96) {
      // Mediano: solo "Besalú" (MERCAT quedaría ilegible)
      let t = s * 0.34;
      x.font = '800 ' + t + 'px Logo';
      t = t * (s * 0.82) / x.measureText('Besalú').width;
      x.font = '800 ' + t + 'px Logo';
      x.fillStyle = '#f4ecd6';
      x.fillText('Besalú', s / 2, s * 0.5 + t * 0.3);
    } else {
      // "Besalú" lo más grande que quepa en el 76 % del ancho
      let t = s * 0.34;
      x.font = '800 ' + t + 'px Logo';
      const w0 = x.measureText('Besalú').width; t = t * (s * 0.76) / w0;
      x.font = '800 ' + t + 'px Logo';
      const ancho = x.measureText('Besalú').width;
      x.fillStyle = '#f4ecd6';
      x.fillText('Besalú', s / 2, s * 0.565);
      // "MERCAT" del mismo ancho, con dos líneas finas a los lados
      const tm = t * 0.34;
      x.font = '700 ' + tm + 'px Logo';
      const linea = s >= 128 ? tm * 1.1 : 0, hueco = s >= 128 ? tm * 0.5 : 0;
      const propio = x.measureText('MERCAT').width;
      const esp = Math.max(0, (ancho - propio - 2 * (linea + hueco)) / 5);
      const y = s * 0.565 + tm * 1.55;
      x.fillStyle = '#cdb57a'; x.textAlign = 'left';
      let cx = s / 2 - ancho / 2 + linea + hueco;
      for (const letra of 'MERCAT') { x.fillText(letra, cx, y); cx += x.measureText(letra).width + esp; }
      if (linea) { const ly = y - tm * 0.36, lw = Math.max(1, s * 0.006); x.fillRect(s / 2 - ancho / 2, ly, linea, lw); x.fillRect(s / 2 + ancho / 2 - linea, ly, linea, lw); }
    }
    salida[s] = c.toDataURL('image/png');
  }
  // Imagen lateral del instalador: el logo sobre el mismo verde, con el nombre del sistema abajo
  const p = document.createElement('canvas'); p.width = 164; p.height = 314;
  const x = p.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 314); g.addColorStop(0, '#565d2f'); g.addColorStop(1, '#2e3218');
  x.fillStyle = g; x.fillRect(0, 0, 164, 314);
  x.textAlign = 'center'; x.fillStyle = '#f4ecd6'; x.font = '800 34px Logo'; x.fillText('Besalú', 82, 128);
  const ancho = x.measureText('Besalú').width;
  x.font = '700 11px Logo'; x.fillStyle = '#cdb57a'; x.textAlign = 'left';
  const propio = x.measureText('MERCAT').width, linea = 12, hueco = 6;
  const esp = (ancho - propio - 2 * (linea + hueco)) / 5;
  let cx = 82 - ancho / 2 + linea + hueco;
  for (const l of 'MERCAT') { x.fillText(l, cx, 148); cx += x.measureText(l).width + esp; }
  x.fillRect(82 - ancho / 2, 144, linea, 1); x.fillRect(82 + ancho / 2 - linea, 144, linea, 1);
  x.textAlign = 'center'; x.fillStyle = 'rgba(244,236,214,.75)'; x.font = '600 8.5px Logo';
  x.fillText('MINIMARKET GOURMET', 82, 172);
  x.fillStyle = 'rgba(244,236,214,.55)'; x.font = '600 10px sans-serif'; x.fillText('Punto de venta y facturación', 82, 290);
  salida.panel = Array.from(x.getImageData(0, 0, 164, 314).data);
  return salida;
})()`;

/** BMP de 24 bits (lo que pide el instalador NSIS), filas de abajo hacia arriba. */
function crearBmp(rgba, ancho, alto) {
  const fila = Math.ceil(ancho * 3 / 4) * 4;
  const b = Buffer.alloc(54 + fila * alto);
  b.write('BM', 0); b.writeUInt32LE(b.length, 2); b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14); b.writeInt32LE(ancho, 18); b.writeInt32LE(alto, 22); b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28);
  b.writeUInt32LE(fila * alto, 34); b.writeInt32LE(2835, 38); b.writeInt32LE(2835, 42);
  for (let y = 0; y < alto; y++) for (let x = 0; x < ancho; x++) {
    const i = ((alto - 1 - y) * ancho + x) * 4, o = 54 + y * fila + x * 3;
    b[o] = rgba[i + 2]; b[o + 1] = rgba[i + 1]; b[o + 2] = rgba[i];
  }
  return b;
}

/** ICO con imágenes PNG adentro (Windows Vista en adelante). */
function crearIco(pngs) {
  const cab = Buffer.alloc(6); cab.writeUInt16LE(0, 0); cab.writeUInt16LE(1, 2); cab.writeUInt16LE(pngs.length, 4);
  const entradas = [], datos = [];
  let desplazamiento = 6 + 16 * pngs.length;
  for (const [s, png] of pngs) {
    const e = Buffer.alloc(16);
    e[0] = s >= 256 ? 0 : s; e[1] = s >= 256 ? 0 : s; e[2] = 0; e[3] = 0;
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(png.length, 8); e.writeUInt32LE(desplazamiento, 12);
    entradas.push(e); datos.push(png); desplazamiento += png.length;
  }
  return Buffer.concat([cab, ...entradas, ...datos]);
}

app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false });
  await w.loadURL('data:text/html;charset=utf-8,<!doctype html><html><body></body></html>');
  const imgs = await w.webContents.executeJavaScript(DIBUJAR);
  const png = (s) => Buffer.from(imgs[s].split(',')[1], 'base64');
  fs.writeFileSync(path.join(RAIZ, 'recursos', 'icono.png'), png(512));
  fs.writeFileSync(path.join(RAIZ, 'recursos', 'icono.ico'), crearIco([16, 24, 32, 48, 64, 128, 256].map((s) => [s, png(s)])));
  fs.writeFileSync(path.join(RAIZ, 'recursos', 'panel-instalador.bmp'), crearBmp(imgs.panel, 164, 314));
  if (process.env.BESALU_MUESTRA) for (const s of TAMANOS) fs.writeFileSync(path.join(process.env.BESALU_MUESTRA, 'icono-' + s + '.png'), png(s));
  console.log('Listo: recursos/icono.png, recursos/icono.ico y recursos/panel-instalador.bmp');
  app.exit(0);
});
