/**
 * etiquetas.js — Etiquetas de productos (F8) para la SAT TT448-2 USE.
 *
 *  - Plantillas listas: precio de góndola, código de barras, oferta y
 *    vencimiento/lote. Se elige la plantilla, el tamaño del rollo y los
 *    productos (escaneando o buscando), con cuántas copias de cada uno.
 *  - Cada etiqueta se dibuja aquí a 203 dpi (8 puntos por mm) en blanco y
 *    negro puro: la vista previa es exactamente lo que sale impreso.
 *  - El sistema la manda a la impresora en su lenguaje (TSPL o ZPL), por
 *    USB o por la red (ver principal/etiquetas.js).
 */
const PUNTOS_MM = 8;
const TAMANOS_ETIQUETA = [[50, 25], [40, 30], [60, 40], [100, 50]];
const Etiquetas = { plantilla: 'marca', ancho: null, alto: null, items: [], seleccion: 0, config: null, logos: new Map() };

/* ---------------- Dibujo ---------------- */
const precioEtiqueta = (c) => '₡' + (Number(c || 0) / 100).toLocaleString('es-CR', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
const fechaEtiqueta = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(iso || '') ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '');

function envolver(ctx, texto, ancho, maxLineas) {
  const lineas = [];
  let actual = '';
  for (const palabra of String(texto).split(/\s+/).filter(Boolean)) {
    const prueba = actual ? actual + ' ' + palabra : palabra;
    if (ctx.measureText(prueba).width <= ancho) { actual = prueba; continue; }
    if (!actual || ctx.measureText(palabra).width > ancho) return null;
    lineas.push(actual);
    actual = palabra;
  }
  if (actual) lineas.push(actual);
  return lineas.length <= maxLineas ? lineas : null;
}

/** Escribe el texto lo más grande posible dentro de la caja (en varias líneas si hace falta). */
function textoEnCaja(ctx, texto, x, y, w, h, { peso = 700, lineas = 1, alinear = 'left', maximo = 999, minimo = 9 } = {}) {
  const dibujar = (ls, tam) => {
    const alto = tam * 1.1;
    const inicio = y + (h - alto * ls.length) / 2;
    ctx.textBaseline = 'middle';
    ctx.textAlign = alinear;
    const ax = alinear === 'center' ? x + w / 2 : alinear === 'right' ? x + w : x;
    ls.forEach((l, i) => ctx.fillText(l, ax, inicio + alto * (i + 0.5)));
    return tam;
  };
  for (let tam = Math.floor(Math.min(maximo, h / lineas / 1.1)); tam >= minimo; tam--) {
    ctx.font = peso + ' ' + tam + 'px Inter, sans-serif';
    const ls = envolver(ctx, texto, w, lineas);
    if (ls) return dibujar(ls, tam);
  }
  // No cabe ni al mínimo: una línea recortada con "…"
  ctx.font = peso + ' ' + minimo + 'px Inter, sans-serif';
  let t = String(texto);
  while (t.length > 1 && ctx.measureText(t + '…').width > w) t = t.slice(0, -1);
  return dibujar([t + '…'], minimo);
}

const MODULO_MINIMO = 2;   // puntos (0,25 mm): más delgado, el lector de la caja no lo lee bien

/** Ancho en puntos que necesita el código con barras de `m` puntos (null si no se puede codificar). */
function anchoBarras(codigo, m = MODULO_MINIMO) {
  try { const cb = CodigoBarras.codificar(codigo); return (cb.modulos.reduce((a, b) => a + b, 0) + cb.silencio * 2) * m; } catch (e) { return null; }
}

/** Barras con módulos de ancho entero (en puntos de la impresora): nítidas para el lector. */
function dibujarBarras(ctx, codigo, x, y, w, h, conTexto = true) {
  let cb;
  try { cb = CodigoBarras.codificar(codigo); } catch (e) {
    if (ctx._avisos) ctx._avisos.push(e.message);
    textoEnCaja(ctx, String(codigo || ''), x, y, w, h, { peso: 700, alinear: 'center' });
    return { cabe: false };
  }
  const modulos = cb.modulos.reduce((a, b) => a + b, 0) + cb.silencio * 2;
  const m = Math.floor(w / modulos);
  if (m < MODULO_MINIMO) {
    // No cabe legible: el número, que se puede digitar en la caja
    if (ctx._avisos) ctx._avisos.push('El código de barras no cabe en este tamaño: se imprime solo el número');
    textoEnCaja(ctx, cb.texto, x, y + h * 0.2, w, h * 0.6, { peso: 700, alinear: 'center' });
    return { cabe: false, tipo: cb.tipo };
  }
  const altoTexto = conTexto ? Math.max(10, Math.round(h * 0.26)) : 0;
  const altoBarras = h - altoTexto;
  let cx = Math.round(x + (w - modulos * m) / 2) + cb.silencio * m;
  let negro = true;
  for (const a of cb.modulos) { if (negro) ctx.fillRect(cx, Math.round(y), a * m, Math.round(altoBarras)); cx += a * m; negro = !negro; }
  if (conTexto) textoEnCaja(ctx, cb.texto, x, y + altoBarras, w, altoTexto, { peso: 600, alinear: 'center', maximo: altoTexto });
  return { cabe: true, tipo: cb.tipo, modulo: m };
}

/**
 * Precio con el ₡ y los céntimos más pequeños y alineados arriba (como en las
 * góndolas). Lo más grande que quepa en la caja.
 */
function dibujarPrecio(ctx, centimos, x, y, w, h, { alinear = 'left', color = '#000', peso = 800 } = {}) {
  const entero = String(Math.floor(Math.abs(centimos) / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u2005');   // ₡1 250 (espacio de ¼ de letra)
  const cent = Math.abs(centimos) % 100;
  const decimales = cent ? String(cent).padStart(2, '0') : '';
  const ALTO_CIFRA = 0.727;   // alto de los números de Inter respecto al tamaño de letra
  let tam = Math.floor(h * 0.9 / ALTO_CIFRA);
  const medir = (t) => {
    ctx.font = peso + ' ' + Math.round(t * 0.52) + 'px Inter, sans-serif'; const wc = ctx.measureText('₡').width;
    ctx.font = peso + ' ' + t + 'px Inter, sans-serif'; const we = ctx.measureText(entero).width;
    ctx.font = peso + ' ' + Math.round(t * 0.42) + 'px Inter, sans-serif'; const wd = decimales ? ctx.measureText(decimales).width : 0;
    return { wc, we, wd, total: wc + t * 0.04 + we + (decimales ? t * 0.05 + wd : 0) };
  };
  let m = medir(tam);
  while (m.total > w && tam > 10) { tam--; m = medir(tam); }
  const altoCifra = tam * ALTO_CIFRA;
  const base = Math.round(y + (h + altoCifra) / 2);
  const arriba = base - altoCifra;
  let cx = alinear === 'center' ? x + (w - m.total) / 2 : alinear === 'right' ? x + w - m.total : x;
  ctx.save();
  ctx.fillStyle = color; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  const tc = Math.round(tam * 0.52);
  ctx.font = peso + ' ' + tc + 'px Inter, sans-serif';
  ctx.fillText('₡', cx, arriba + tc * 0.76);
  cx += m.wc + tam * 0.04;
  ctx.font = peso + ' ' + tam + 'px Inter, sans-serif';
  ctx.fillText(entero, cx, base);
  cx += m.we + tam * 0.05;
  if (decimales) {
    const td = Math.round(tam * 0.42);
    ctx.font = peso + ' ' + td + 'px Inter, sans-serif';
    ctx.fillText(decimales, cx, arriba + td * ALTO_CIFRA);
  }
  ctx.restore();
  return tam;
}

/** Texto en mayúsculas con espaciado (para rótulos chicos: SKU, IVA incluido, marca). */
function rotulo(ctx, texto, x, y, w, h, { alinear = 'left', peso = 700, color = '#000', espacio = 0.08 } = {}) {
  if (!texto) return;
  ctx.save();
  ctx.fillStyle = color;
  let tam = Math.floor(h * 0.95);
  const t = String(texto).toUpperCase();
  const ancho = (z) => {
    ctx.font = peso + ' ' + z + 'px Inter, sans-serif';
    const ls = Math.round(z * espacio);
    if ('letterSpacing' in ctx) { ctx.letterSpacing = ls + 'px'; return ctx.measureText(t).width - ls; }   // sin el espacio después de la última letra
    return ctx.measureText(t).width;
  };
  while (tam > 8 && ancho(tam) > w) tam--;
  const total = ancho(tam);
  ctx.textBaseline = 'middle';
  const cx = alinear === 'center' ? x + (w - total) / 2 : alinear === 'right' ? x + w - total : x;
  ctx.textAlign = 'left';
  ctx.fillText(t, cx, y + h / 2);
  ctx.restore();
}

/** Bloque negro redondeado con el precio en blanco. */
function bloquePrecio(ctx, centimos, x, y, w, h) {
  const r = Math.round(Math.min(w, h) * 0.18);
  ctx.beginPath(); ctx.roundRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h), r); ctx.fill();
  const px = Math.round(h * 0.12);
  dibujarPrecio(ctx, centimos, x + px * 1.4, y + px, w - px * 2.8, h - px * 2, { alinear: 'center', color: '#fff' });
}

/** El logo de la marca (ya en blanco y negro) dentro de la caja, sin deformarlo. */
function dibujarLogo(ctx, logo, x, y, w, h, alinear = 'left') {
  if (!logo) return false;
  const k = Math.min(w / logo.width, h / logo.height);
  const lw = Math.round(logo.width * k), lh = Math.round(logo.height * k);
  const lx = alinear === 'center' ? x + (w - lw) / 2 : alinear === 'right' ? x + w - lw : x;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(logo, Math.round(lx), Math.round(y + (h - lh) / 2), lw, lh);
  return true;
}

const linea = (ctx, x, y, w, grosor) => ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.max(2, Math.round(grosor)));

/** Las plantillas: cada una dibuja en un lienzo de W × H puntos (8 por mm). */
const PLANTILLAS_ETIQUETA = {
  marca: {
    nombre: 'Producto con marca', descripcion: 'Logo de la marca, nombre, SKU, código de barras y precio',
    dibujar(ctx, W, H, d) {
      const p = Math.round(Math.min(W, H) * 0.065);
      const necesita = (anchoBarras(d.codigo) || 0) + p * 0.4;
      // Si las barras no caben al lado del precio: tres filas (nombre, precio, barras a todo lo ancho)
      const tresFilas = necesita > W * 0.63;
      const encabezado = (y, h, w, conSku) => {
        const anchoLogo = d.logo ? Math.min(w * 0.36, (h - p * 0.3) * 2.6) : 0;
        if (d.logo) dibujarLogo(ctx, d.logo, p, y, anchoLogo, h - p * 0.3);
        const xn = d.logo ? p + anchoLogo + p * 0.7 : p, wn = w - xn - p;
        let yn = y, hn = h;
        if (!d.logo && d.marca) { rotulo(ctx, d.marca, xn, yn, wn, hn * 0.22, { peso: 800 }); yn += hn * 0.24; hn -= hn * 0.24; }
        if (conSku && d.sku) hn -= h * 0.2;
        textoEnCaja(ctx, d.nombre, xn, yn, wn, hn, { lineas: 2, peso: 700 });
        if (conSku && d.sku) rotulo(ctx, 'SKU ' + d.sku, xn, yn + hn + h * 0.03, wn, h * 0.16, { peso: 600 });
      };
      if (tresFilas) {
        encabezado(p * 0.6, H * 0.30, W, false);
        const y2 = H * 0.33, h2 = H * 0.26;
        bloquePrecio(ctx, d.precio, W * 0.45, y2, W * 0.55 - p, h2);
        if (d.sku) rotulo(ctx, 'SKU ' + d.sku, p, y2 + h2 * 0.08, W * 0.42 - p, h2 * 0.36, { peso: 700 });
        rotulo(ctx, 'IVA incluido', p, y2 + h2 * (d.sku ? 0.56 : 0.32), W * 0.42 - p, h2 * 0.36, { peso: 600 });
        linea(ctx, p, H * 0.62, W - 2 * p, H * 0.012);
        dibujarBarras(ctx, d.codigo, p * 0.2, H * 0.655, W - p * 0.4, H * 0.345 - p * 0.5);
        return;
      }
      // Dos filas: arriba logo, nombre y SKU; abajo las barras (lo justo) y el precio
      const arriba = H * 0.43;
      encabezado(p * 0.6, arriba - p * 0.6, W, true);
      linea(ctx, p, arriba + p * 0.35, W - 2 * p, H * 0.012);
      const y = arriba + p * 0.95, alto = H - y - p * 0.55;
      const anchoIzq = Math.max(W * 0.5, necesita);
      dibujarBarras(ctx, d.codigo, p * 0.2, y, anchoIzq - p * 0.2, alto);
      const xp = anchoIzq + p * 0.4, wp = W - xp - p;
      bloquePrecio(ctx, d.precio, xp, y + alto * 0.02, wp, alto * 0.72);
      rotulo(ctx, 'IVA incluido', xp, y + alto * 0.78, wp, alto * 0.2, { peso: 600, alinear: 'center' });
    }
  },
  gondola: {
    nombre: 'Precio de góndola', descripcion: 'Precio bien grande para el estante, con nombre, marca y código',
    dibujar(ctx, W, H, d) {
      const p = Math.round(Math.min(W, H) * 0.065);
      const banda = Math.round(H * 0.17);
      const anchoNombre = d.logo ? W * 0.70 : W - 2 * p;
      textoEnCaja(ctx, d.nombre, p, p * 0.6, anchoNombre - p, H * 0.27, { lineas: 2, peso: 700 });
      if (d.logo) dibujarLogo(ctx, d.logo, W * 0.72, p * 0.6, W * 0.28 - p, H * 0.27, 'right');
      dibujarPrecio(ctx, d.precio, p, H * 0.31, W - 2 * p, H - banda - H * 0.35, { peso: 800 });
      // Banda negra abajo, letra blanca: dos mitades que no se tocan
      ctx.fillRect(0, H - banda, W, banda);
      const t = banda * 0.55, ty = H - banda + (banda - t) / 2;
      rotulo(ctx, 'IVA incluido' + (d.unidad && d.unidad !== 'Unid' ? ' · por ' + d.unidad : ''), p, ty, W * 0.5 - p * 1.5, t, { color: '#fff', peso: 700 });
      rotulo(ctx, d.sku ? 'SKU ' + d.sku : d.codigo, W * 0.5 + p * 0.5, ty, W * 0.5 - p * 1.5, t, { color: '#fff', peso: 600, alinear: 'right', espacio: 0.04 });
    }
  },
  codigo: {
    nombre: 'Código de barras', descripcion: 'Para pegar en el producto: código grande, nombre y precio',
    dibujar(ctx, W, H, d) {
      const p = Math.round(Math.min(W, H) * 0.06);
      const fila = H * 0.27;
      textoEnCaja(ctx, d.nombre, p, p * 0.5, W * 0.6 - p, fila - p * 0.5, { lineas: 2, peso: 700 });
      bloquePrecio(ctx, d.precio, W * 0.62, p * 0.5, W * 0.38 - p, fila - p * 0.3);
      const y = fila + p * 0.7, alto = H - y - p * 0.5;
      dibujarBarras(ctx, d.codigo, p * 0.3, y, W - p * 0.6, alto * (d.sku ? 0.82 : 1));
      if (d.sku) rotulo(ctx, 'SKU ' + d.sku, p, y + alto * 0.83, W - 2 * p, alto * 0.17, { peso: 600, alinear: 'center' });
    }
  },
  oferta: {
    nombre: 'Oferta', descripcion: 'Precio anterior tachado y precio de oferta destacado',
    campos: ['oferta'],
    dibujar(ctx, W, H, d) {
      const p = Math.round(Math.min(W, H) * 0.065);
      const banda = Math.round(H * 0.24);
      ctx.fillRect(0, 0, W, banda);
      rotulo(ctx, 'Oferta', p, banda * 0.14, W * 0.44, banda * 0.72, { color: '#fff', peso: 800, espacio: 0.14 });
      if (d.hasta) rotulo(ctx, 'Hasta el ' + fechaEtiqueta(d.hasta).slice(0, 5), W * 0.52, banda * 0.27, W * 0.48 - p, banda * 0.46, { color: '#fff', peso: 600, alinear: 'right' });
      textoEnCaja(ctx, d.nombre, p, banda + p * 0.4, W - 2 * p, H * 0.24, { lineas: 2, peso: 700 });
      const y = banda + H * 0.27, alto = H - y - p * 0.5;
      // Antes (tachado), a la izquierda
      rotulo(ctx, 'Antes', p, y + alto * 0.08, W * 0.3, alto * 0.24, { peso: 600 });
      const tam = dibujarPrecio(ctx, d.precio, p, y + alto * 0.34, W * 0.3, alto * 0.42, { peso: 600 });
      ctx.font = '600 ' + tam + 'px Inter, sans-serif';
      const largo = Math.min(W * 0.3, ctx.measureText('₡' + Math.floor(d.precio / 100).toLocaleString('es-CR')).width * 0.95);
      ctx.save(); ctx.translate(p, y + alto * 0.55); ctx.rotate(-0.12); ctx.fillRect(-2, -Math.max(2, tam * 0.05), largo + 4, Math.max(3, tam * 0.1)); ctx.restore();
      // Ahora, grande
      dibujarPrecio(ctx, d.precioOferta || d.precio, W * 0.34, y, W * 0.66 - p, alto, { alinear: 'right', peso: 800 });
    }
  },
  vence: {
    nombre: 'Vencimiento / lote', descripcion: 'Producto, fecha de vencimiento destacada y lote',
    campos: ['vence'],
    dibujar(ctx, W, H, d) {
      const p = Math.round(Math.min(W, H) * 0.065);
      textoEnCaja(ctx, d.nombre, p, p * 0.6, W - 2 * p, H * 0.28, { lineas: 2, peso: 700 });
      // Fecha dentro de un marco redondeado
      const y = H * 0.34, alto = H * 0.36;
      const g = Math.max(3, Math.round(H * 0.018));
      ctx.beginPath(); ctx.roundRect(p, y, W - 2 * p, alto, Math.round(alto * 0.2)); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.roundRect(p + g, y + g, W - 2 * p - 2 * g, alto - 2 * g, Math.round(alto * 0.2) - g); ctx.fill(); ctx.fillStyle = '#000';
      rotulo(ctx, 'Vence', p + g * 3, y + alto * 0.25, W * 0.22, alto * 0.5, { peso: 800 });
      textoEnCaja(ctx, fechaEtiqueta(d.vence) || '__/__/____', W * 0.3, y + g, W * 0.7 - p - g * 3, alto - 2 * g, { peso: 800, alinear: 'right' });
      const abajo = y + alto + p * 0.5, altoAbajo = Math.min(H - abajo - p * 0.5, H * 0.13);
      const texto = [d.lote ? 'Lote ' + d.lote : '', d.sku ? 'SKU ' + d.sku : ''].filter(Boolean).join(' · ');
      rotulo(ctx, texto || d.codigo, p, abajo, W * 0.52 - p, altoAbajo, { peso: 700 });
      if (texto) rotulo(ctx, d.codigo, W * 0.55, abajo, W * 0.45 - p, altoAbajo, { peso: 600, alinear: 'right', espacio: 0.02 });
    }
  },
  prueba: {
    nombre: 'Prueba', oculta: true,
    dibujar(ctx, W, H, d) {
      const g = Math.max(2, Math.round(PUNTOS_MM * 0.25));
      ctx.fillRect(PUNTOS_MM, PUNTOS_MM, W - 2 * PUNTOS_MM, g); ctx.fillRect(PUNTOS_MM, H - PUNTOS_MM - g, W - 2 * PUNTOS_MM, g);
      ctx.fillRect(PUNTOS_MM, PUNTOS_MM, g, H - 2 * PUNTOS_MM); ctx.fillRect(W - PUNTOS_MM - g, PUNTOS_MM, g, H - 2 * PUNTOS_MM);
      const p = PUNTOS_MM * 2;
      textoEnCaja(ctx, 'Besalú Mercat · prueba', p, p, W - 2 * p, H * 0.22, { peso: 800, alinear: 'center' });
      rotulo(ctx, d.ancho + ' × ' + d.alto + ' mm · 203 dpi · ' + d.lenguaje, p, p + H * 0.2, W - 2 * p, H * 0.12, { peso: 600, alinear: 'center' });
      dibujarBarras(ctx, '123456789012', p, H * 0.45, W - 2 * p, H * 0.45 - p);
    }
  }
};

/**
 * Dibuja una etiqueta en blanco y negro puro (umbral al 50 %).
 * @returns {{ lienzo: HTMLCanvasElement, anchoPx, altoPx, datos?: Uint8Array }}
 * @param {object} [o] { bits: true } también devuelve la imagen de 1 bit para imprimir;
 *   { corrimiento: [dxMm, dyMm] } mueve el contenido (solo al imprimir)
 */
function dibujarEtiqueta(plantilla, ancho, alto, datos, o = {}) {
  const W = Math.round(ancho * PUNTOS_MM), H = Math.round(alto * PUNTOS_MM);
  const lienzo = document.createElement('canvas');
  lienzo.width = W; lienzo.height = H;
  const ctx = lienzo.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#000';
  const [dx, dy] = (o.corrimiento || [0, 0]).map((v) => Math.round((Number(v) || 0) * PUNTOS_MM));
  ctx._avisos = [];
  ctx.save();
  ctx.translate(dx, dy);
  (PLANTILLAS_ETIQUETA[plantilla] || PLANTILLAS_ETIQUETA.marca).dibujar(ctx, W, H, datos);
  ctx.restore();
  const avisos = [...new Set(ctx._avisos)];
  // Umbral: cada punto queda negro o blanco (lo que se ve es lo que se imprime)
  const img = ctx.getImageData(0, 0, W, H);
  const px = img.data;
  const bytesPorFila = Math.ceil(W / 8);
  const bits = o.bits ? new Uint8Array(bytesPorFila * H) : null;
  for (let yy = 0; yy < H; yy++) {
    for (let xx = 0; xx < W; xx++) {
      const i = (yy * W + xx) * 4;
      const negro = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114 < 128;
      px[i] = px[i + 1] = px[i + 2] = negro ? 0 : 255; px[i + 3] = 255;
      if (negro && bits) bits[yy * bytesPorFila + (xx >> 3)] |= 0x80 >> (xx & 7);
    }
  }
  ctx.putImageData(img, 0, 0);
  return { lienzo, anchoPx: W, altoPx: H, datos: bits, avisos };
}

/** Lo que va en la etiqueta de un renglón de la lista. */
function datosEtiqueta(item) {
  const p = App.catalogo.find((x) => x.id === item.producto_id) || item.producto || {};
  return { nombre: p.nombre || '', codigo: p.codigo || '', precio: p.precio || 0, unidad: p.unidad || 'Unid', sku: p.sku || '',
    marca: p.marca || '', logo: p.marca_id ? Etiquetas.logos.get(p.marca_id) || null : null,
    precioOferta: item.precioOferta, hasta: item.hasta, vence: item.vence != null ? item.vence : p.vence, lote: item.lote };
}

/* ---------------- Logos de las marcas ---------------- */
/** Carga (una vez) el logo de cada marca, ya en blanco y negro con su intensidad. */
async function precargarLogos(marcaIds) {
  for (const id of new Set(marcaIds.filter(Boolean))) {
    if (Etiquetas.logos.has(id)) continue;
    const m = await BESALU.marcas.logo(id).catch(() => null);
    Etiquetas.logos.set(id, m && m.png ? await logoEnBlancoYNegro(m.png, m.umbral) : null);
  }
}
function olvidarLogo(marcaId) { Etiquetas.logos.delete(marcaId); }

function imagenDe(bytes, tipo = 'image/png') {
  return new Promise((resolver, rechazar) => {
    const url = URL.createObjectURL(new Blob([bytes], { type: tipo }));
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolver(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rechazar(new Error('No se pudo leer la imagen')); };
    img.src = url;
  });
}

/** Lienzo con el logo: negro donde el gris es más oscuro que el umbral, transparente el resto. */
async function logoEnBlancoYNegro(png, umbral) {
  const img = png instanceof HTMLImageElement ? png : await imagenDe(png);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || img.width; c.height = img.naturalHeight || img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const datos = ctx.getImageData(0, 0, c.width, c.height);
  const px = datos.data;
  for (let i = 0; i < px.length; i += 4) {
    const negro = px[i] < umbral;   // ya viene en grises
    px[i] = px[i + 1] = px[i + 2] = 0; px[i + 3] = negro ? 255 : 0;
  }
  ctx.putImageData(datos, 0, 0);
  return c;
}

/**
 * Prepara un logo subido por el usuario: lo pone sobre blanco, lo pasa a
 * grises, le recorta los bordes vacíos y lo achica (máximo 640 × 320).
 * @returns {Promise<Uint8Array>} PNG en grises
 */
async function prepararLogo(archivo) {
  if (!/^image\/(png|jpeg|webp|svg\+xml|gif|bmp)$/.test(archivo.type)) throw new Error('Elija una imagen (PNG, JPG, WEBP o SVG)');
  if (archivo.size > 15 * 1024 * 1024) throw new Error('La imagen pesa demasiado (máximo 15 MB)');
  const img = await imagenDe(await archivo.arrayBuffer(), archivo.type);
  const w0 = img.naturalWidth || 600, h0 = img.naturalHeight || 300;
  const k0 = Math.min(1, 1600 / Math.max(w0, h0));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w0 * k0)); c.height = Math.max(1, Math.round(h0 * k0));
  let ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  // Recorte de los bordes casi blancos
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const i = (y * c.width + x) * 4;
    if (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114 < 240) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) throw new Error('La imagen está en blanco');
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const k = Math.min(1, 640 / cw, 320 / ch);
  const salida = document.createElement('canvas');
  salida.width = Math.max(1, Math.round(cw * k)); salida.height = Math.max(1, Math.round(ch * k));
  ctx = salida.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, salida.width, salida.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(c, x0, y0, cw, ch, 0, 0, salida.width, salida.height);
  const g = ctx.getImageData(0, 0, salida.width, salida.height);
  for (let i = 0; i < g.data.length; i += 4) { const v = Math.round(g.data[i] * 0.299 + g.data[i + 1] * 0.587 + g.data[i + 2] * 0.114); g.data[i] = g.data[i + 1] = g.data[i + 2] = v; g.data[i + 3] = 255; }
  ctx.putImageData(g, 0, 0);
  const blob = await new Promise((r) => salida.toBlob(r, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Cargar o cambiar el logo de una marca, viendo cómo queda impreso (solo
 * negro) y ajustando la intensidad.
 */
async function editorLogoMarca(nombreMarca, alGuardar) {
  const nombre = String(nombreMarca || '').trim();
  if (!nombre) { toast('Escriba primero el nombre de la marca', 'err'); return; }
  const lista = (await intentar(() => BESALU.marcas.listar())) || [];
  const existente = lista.find((m) => m.nombre.toLowerCase() === nombre.toLowerCase());
  const actual = existente && existente.tiene_logo ? await BESALU.marcas.logo(existente.id).catch(() => null) : null;
  let png = actual && actual.png ? new Uint8Array(actual.png) : null;
  let umbral = actual ? actual.umbral : 128;
  let original = png ? await imagenDe(png) : null;
  const vista = el('div', { class: 'logo-vista' });
  const intensidad = el('input', { type: 'range', min: 20, max: 235, value: String(umbral), style: 'width:100%' });
  const archivo = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/svg+xml', style: 'display:none' });
  async function pintar() {
    vista.innerHTML = '';
    if (!original) { vista.appendChild(el('div', { class: 'mini', text: 'Todavía no tiene logo. Elija una imagen (mejor si es el logo sobre fondo blanco).' })); return; }
    const bn = await logoEnBlancoYNegro(original, umbral);
    const muestra = dibujarEtiqueta('marca', 50, 25, { nombre: 'Así se ve en la etiqueta', codigo: '7441001100118', precio: 125000, sku: 'SKU', logo: bn });
    muestra.lienzo.className = 'etiqueta';
    vista.append(el('div', { class: 'mini', text: 'Así se imprime (solo negro):' }), muestra.lienzo);
  }
  intensidad.addEventListener('input', () => { umbral = Number(intensidad.value); pintar(); });
  archivo.addEventListener('change', async () => {
    const f = archivo.files[0];
    if (!f) return;
    try { png = await prepararLogo(f); original = await imagenDe(png); pintar(); }
    catch (e) { toast('No se pudo usar esa imagen', 'err', e.message); }
  });
  async function guardar(quitar) {
    const r = await intentar(() => BESALU.marcas.guardar({ id: existente ? existente.id : undefined, nombre, logo: quitar ? null : png || undefined, umbral }), 'No se guardó el logo');
    if (!r) return;
    olvidarLogo(r.id);
    cerrarModal();
    await App.recargarCatalogo();
    toast(quitar ? 'Logo quitado' : 'Logo de ' + r.nombre + ' guardado', 'ok', 'Sale en las etiquetas de todos sus productos');
    if (alGuardar) alGuardar(r);
  }
  abrirModal(el('div', { class: 'modal', 'data-logo-marca': nombre }, [
    el('div', { class: 'card-t' }, [el('h2', { text: 'Logo de ' + nombre }), el('button', { class: 'icon-btn', onclick: cerrarModal }, icon('x', 18))]),
    archivo, vista,
    campo('Intensidad', intensidad, 'Si el logo sale muy claro o se pierde, súbala; si sale muy grueso, bájela.'),
    el('div', { class: 'modal-acc' }, [
      png ? el('button', { class: 'btn btn--danger-ghost', style: 'margin-right:auto', onclick: () => guardar(true) }, 'Quitar logo') : null,
      el('button', { class: 'btn btn--ghost', onclick: () => archivo.click() }, [icon('upload', 16), png ? 'Cambiar imagen…' : 'Elegir imagen…']),
      el('button', { class: 'btn btn--pos', onclick: () => guardar(false) }, [icon('check', 17), 'Guardar'])])
  ]));
  pintar();
}

/* ---------------- Pantalla ---------------- */
async function renderEtiquetas() {
  const root = $('#v-etiquetas');
  if (!Etiquetas.config) Etiquetas.config = await intentar(() => BESALU.etiquetas.config());
  if (!Etiquetas.config) return;
  if (Etiquetas.ancho == null) { Etiquetas.ancho = Etiquetas.config.ancho; Etiquetas.alto = Etiquetas.config.alto; }
  await document.fonts.load('800 40px Inter', '₡0123456789').catch(() => {});
  await document.fonts.load('700 40px Inter').catch(() => {});
  await document.fonts.load('600 40px Inter').catch(() => {});
  await precargarLogos(Etiquetas.items.map((it) => (App.catalogo.find((x) => x.id === it.producto_id) || {}).marca_id));
  root.innerHTML = '';
  const c = Etiquetas.config;
  const plantilla = PLANTILLAS_ETIQUETA[Etiquetas.plantilla];

  // Plantillas
  root.appendChild(el('div', { class: 'plantillas-etq' }, Object.entries(PLANTILLAS_ETIQUETA).filter(([, t]) => !t.oculta).map(([k, t]) => {
    const muestra = dibujarEtiqueta(k, 50, 25, { nombre: 'Café molido tueste oscuro 340 g', codigo: '7441001100118', precio: 489000, precioOferta: 425000,
      vence: '2027-03-31', lote: 'A-0425', unidad: 'Unid', sku: 'CAF-340', marca: 'Café de altura' }).lienzo;
    muestra.className = 'muestra';
    return el('button', { class: 'plantilla-etq' + (Etiquetas.plantilla === k ? ' sel' : ''), 'data-plantilla': k, onclick: () => { Etiquetas.plantilla = k; renderEtiquetas(); } },
      [muestra, el('b', { text: t.nombre }), el('span', { class: 'mini', text: t.descripcion })]);
  })));

  // Tamaño e impresora
  const tamanos = TAMANOS_ETIQUETA.slice();
  if (!tamanos.some(([a, b]) => a === c.ancho && b === c.alto)) tamanos.push([c.ancho, c.alto]);
  const impresoraTexto = c.conexion === 'red' ? (c.ip ? 'Red · ' + c.ip + ':' + c.puerto : 'Red · sin dirección') : (c.impresora ? 'USB · ' + c.impresora : 'USB · sin elegir');
  const configurada = c.conexion === 'red' ? !!c.ip : !!c.impresora;
  root.appendChild(el('div', { class: 'toolbar' }, [
    el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [
      el('span', { class: 'mini', text: 'Tamaño del rollo' }),
      el('div', { class: 'segmento' }, tamanos.map(([a, b]) => el('button', { class: Etiquetas.ancho === a && Etiquetas.alto === b ? 'sel' : '', onclick: () => cambiarTamano(a, b) }, a + ' × ' + b + ' mm'))),
      el('button', { class: 'btn btn--ghost btn--sm', onclick: () => configurarImpresora(true) }, 'Otro tamaño…')]),
    el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [
      el('span', { class: 'pill ' + (configurada ? 'pill--green' : 'pill--amber'), title: c.modelo + ' · ' + c.lenguaje.toUpperCase(), text: configurada ? c.modelo + ' · ' + impresoraTexto : 'Falta configurar la impresora' }),
      el('button', { class: 'btn btn--ghost btn--sm', onclick: () => configurarImpresora() }, [icon('sliders', 15), 'Configurar impresora']),
      el('button', { class: 'btn btn--ghost btn--sm', onclick: imprimirPruebaEtiqueta }, [icon('printer', 15), 'Etiqueta de prueba'])])
  ]));

  // Lista de productos y vista previa
  const buscar = el('input', { list: 'dl-productos-etq', placeholder: 'Escanee o busque el producto…', style: 'padding-left:40px', autocomplete: 'off' });
  const listaProd = el('datalist', { id: 'dl-productos-etq' }, App.catalogo.map((x) => el('option', { value: x.codigo + ' — ' + x.nombre })));
  const agregar = () => {
    const t = buscar.value.trim();
    if (!t) return;
    buscar.value = '';
    const cod = t.split(' — ')[0].trim();
    const p = App.catalogo.find((x) => x.codigo === cod) || App.catalogo.find((x) => x.nombre.toLowerCase() === t.toLowerCase());
    if (!p) { toast('Producto no encontrado', 'err', t); return; }
    agregarEtiquetas([{ producto_id: p.id, copias: 1 }], { sinIr: true });
    renderEtiquetas().then(() => { const b = $('#v-etiquetas input[list="dl-productos-etq"]'); if (b) b.focus(); });
  };
  buscar.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); agregar(); } });
  buscar.addEventListener('input', (e) => { if (e.inputType === 'insertReplacementText' || !e.inputType) agregar(); });

  const tb = el('tbody');
  if (!Etiquetas.items.length) tb.appendChild(el('tr', {}, el('td', { colspan: 4, class: 'mini', style: 'text-align:center;padding:26px', text: 'Escanee los productos a los que les quiere hacer etiqueta. También puede mandarlos desde Inventario o desde una compra.' })));
  Etiquetas.seleccion = Math.min(Etiquetas.seleccion, Math.max(0, Etiquetas.items.length - 1));
  Etiquetas.items.forEach((it, i) => {
    const d = datosEtiqueta(it);
    const copias = el('input', { inputmode: 'numeric', value: String(it.copias), style: 'width:70px;text-align:right' });
    copias.addEventListener('input', () => { it.copias = Math.max(0, parseInt(copias.value || '0', 10) || 0); pintarTotal(); });
    const extra = [];
    if ((plantilla.campos || []).includes('oferta')) {
      const precio = el('input', { inputmode: 'decimal', value: it.precioOferta ? aColonesTexto(it.precioOferta) : '', placeholder: 'Precio de oferta ₡', style: 'width:130px' });
      const hasta = el('input', { type: 'date', value: it.hasta || '', title: 'Oferta válida hasta (opcional)', style: 'width:150px' });
      precio.addEventListener('input', () => { it.precioOferta = aCentimos(precio.value) || null; pintarVista(); });
      hasta.addEventListener('change', () => { it.hasta = hasta.value; pintarVista(); });
      extra.push(precio, hasta);
    }
    if ((plantilla.campos || []).includes('vence')) {
      const vence = el('input', { type: 'date', value: d.vence || '', title: 'Fecha de vencimiento', style: 'width:150px' });
      const lote = el('input', { value: it.lote || '', placeholder: 'Lote', style: 'width:100px' });
      vence.addEventListener('change', () => { it.vence = vence.value; pintarVista(); });
      lote.addEventListener('input', () => { it.lote = lote.value.trim(); pintarVista(); });
      extra.push(vence, lote);
    }
    tb.appendChild(el('tr', { class: 'clic' + (i === Etiquetas.seleccion ? ' sel' : ''), onclick: (e) => { if (e.target.closest('input,button')) return; Etiquetas.seleccion = i; renderEtiquetas(); } }, [
      el('td', {}, [el('div', { style: 'font-weight:600', text: d.nombre }), el('div', { class: 'mini', text: d.codigo + ' · ' + money(d.precio) })]),
      el('td', {}, el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, extra)),
      el('td', { class: 'der' }, copias),
      el('td', {}, el('button', { class: 'icon-btn icon-btn--danger', title: 'Quitar', onclick: () => { Etiquetas.items.splice(i, 1); renderEtiquetas(); } }, icon('trash', 16)))
    ]));
  });
  const total = el('span', { class: 'mini' });
  const botonImprimir = el('button', { class: 'btn btn--pos', onclick: (e) => imprimirEtiquetas(e.currentTarget) }, [icon('printer', 17), 'Imprimir']);
  const pintarTotal = () => {
    const n = Etiquetas.items.reduce((s, x) => s + (x.copias || 0), 0);
    total.textContent = plural(n, 'etiqueta', 'etiquetas') + ' · ' + Etiquetas.ancho + ' × ' + Etiquetas.alto + ' mm';
    botonImprimir.disabled = !n;
  };
  const vista = el('div', { class: 'vista-etq' });
  const pie = el('div', { class: 'mini', style: 'text-align:center;margin-top:8px' });
  function pintarVista() {
    vista.innerHTML = '';
    const it = Etiquetas.items[Etiquetas.seleccion];
    const datos = it ? datosEtiqueta(it) : { nombre: 'Elija un producto', codigo: '0000000000000', precio: 0 };
    const r = dibujarEtiqueta(Etiquetas.plantilla, Etiquetas.ancho, Etiquetas.alto, datos);
    r.lienzo.className = 'etiqueta';
    r.lienzo.style.aspectRatio = Etiquetas.ancho + ' / ' + Etiquetas.alto;
    vista.appendChild(r.lienzo);
    pie.innerHTML = '';
    pie.append(plantilla.nombre + ' · ' + Etiquetas.ancho + ' × ' + Etiquetas.alto + ' mm · ' + r.anchoPx + ' × ' + r.altoPx + ' puntos (203 dpi)');
    for (const a of r.avisos) pie.appendChild(el('div', { style: 'color:var(--warn);font-weight:600;margin-top:4px', text: a }));
  }

  root.appendChild(el('div', { class: 'grid-etq' }, [
    el('div', { class: 'card glass' }, [
      listaProd,
      el('div', { class: 'search', style: 'margin-bottom:10px' }, [icon('search', 18), buscar]),
      el('div', { class: 'tabla-wrap', style: 'max-height:420px' }, el('table', {}, [
        el('thead', {}, el('tr', {}, ['Producto', (plantilla.campos || []).includes('oferta') ? 'Oferta' : (plantilla.campos || []).includes('vence') ? 'Vence y lote' : '', 'Copias', ''].map((t, i) => el('th', { text: t, class: i === 2 ? 'der' : '' })))), tb])),
      el('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:12px;flex-wrap:wrap' }, [
        el('div', { style: 'display:flex;gap:8px;align-items:center' }, [total,
          Etiquetas.items.length ? el('button', { class: 'btn btn--ghost btn--sm', onclick: () => { Etiquetas.items = []; renderEtiquetas(); } }, 'Vaciar') : null]),
        botonImprimir])]),
    el('div', { class: 'card glass' }, [el('h2', { text: 'Vista previa' }), vista, pie])
  ]));
  pintarTotal();
  pintarVista();
  buscar.focus();
}

/** Agrega productos a la lista de etiquetas (desde Inventario, una compra o el escáner). */
function agregarEtiquetas(items, { sinIr = false } = {}) {
  for (const it of items) {
    const ya = Etiquetas.items.find((x) => x.producto_id === it.producto_id);
    if (ya) { ya.copias += it.copias || 1; continue; }
    Etiquetas.items.push(Object.assign({ copias: 1 }, it));
  }
  Etiquetas.seleccion = Math.max(0, Etiquetas.items.length - 1);
  if (!sinIr) { cerrarTodosLosModales(); go('etiquetas'); }
}
function cerrarTodosLosModales() { while (hayModal()) cerrarModal(); }

async function cambiarTamano(ancho, alto) {
  Etiquetas.ancho = ancho; Etiquetas.alto = alto;
  const r = await intentar(() => BESALU.etiquetas.guardarConfig({ ancho, alto }));   // queda como el tamaño del rollo
  if (r) Etiquetas.config = r;
  renderEtiquetas();
}

/** Arma el trabajo (una imagen por producto, con sus copias) y lo manda a la impresora. */
async function imprimirEtiquetas(boton) {
  const c = Etiquetas.config;
  const items = Etiquetas.items.filter((x) => x.copias > 0);
  if (!items.length) return;
  const plantilla = PLANTILLAS_ETIQUETA[Etiquetas.plantilla];
  if ((plantilla.campos || []).includes('oferta')) {
    const sin = items.find((x) => !x.precioOferta);
    if (sin) { toast('Falta el precio de oferta', 'err', datosEtiqueta(sin).nombre); return; }
  }
  const etiquetas = items.map((it) => {
    const r = dibujarEtiqueta(Etiquetas.plantilla, Etiquetas.ancho, Etiquetas.alto, datosEtiqueta(it), { bits: true, corrimiento: [c.corrimientoX, c.corrimientoY] });
    return { anchoPx: r.anchoPx, altoPx: r.altoPx, datos: r.datos, copias: Math.min(500, it.copias) };
  });
  if (boton) boton.disabled = true;
  const r = await intentar(() => BESALU.etiquetas.imprimir({ ancho: Etiquetas.ancho, alto: Etiquetas.alto, etiquetas }), 'No se imprimieron las etiquetas');
  if (boton) boton.disabled = false;
  if (r) toast(plural(r.copias, 'etiqueta enviada', 'etiquetas enviadas') + ' a la impresora', 'ok', plantilla.nombre + ' · ' + Etiquetas.ancho + ' × ' + Etiquetas.alto + ' mm');
}

async function imprimirPruebaEtiqueta() {
  const c = Etiquetas.config;
  const r = dibujarEtiqueta('prueba', Etiquetas.ancho, Etiquetas.alto, { ancho: Etiquetas.ancho, alto: Etiquetas.alto, lenguaje: c.lenguaje.toUpperCase() }, { bits: true, corrimiento: [c.corrimientoX, c.corrimientoY] });
  const ok = await intentar(() => BESALU.etiquetas.imprimir({ ancho: Etiquetas.ancho, alto: Etiquetas.alto, etiquetas: [{ anchoPx: r.anchoPx, altoPx: r.altoPx, datos: r.datos, copias: 1 }] }), 'No se imprimió la prueba');
  if (ok) toast('Etiqueta de prueba enviada', 'ok', 'Debe salir un marco completo, el texto y un código de barras que el lector de la caja lea como 123456789012');
}

/** Configuración de la impresora de etiquetas. */
async function configurarImpresora(enfocarTamano) {
  const c = Object.assign({}, Etiquetas.config);
  const impresoras = (await intentar(() => BESALU.etiquetas.impresoras())) || [];
  let conexion = c.conexion;
  const seg = el('div', { class: 'segmento' });
  const opciones = impresoras.map((p) => [p.nombre, p.nombre + (p.predeterminada ? ' (predeterminada)' : '')]);
  if (c.impresora && !opciones.some(([n]) => n === c.impresora)) opciones.unshift([c.impresora, c.impresora + ' (no está instalada)']);
  const impresora = selector([['', impresoras.length ? 'Elija la impresora…' : 'No hay impresoras instaladas en Windows']].concat(opciones), c.impresora);
  // Si no hay una elegida, sugiere la que parece de etiquetas
  if (!c.impresora) { const sat = impresoras.find((p) => /sat|tt448|tsc|label|etiq/i.test(p.nombre + ' ' + p.descripcion)); if (sat) impresora.value = sat.nombre; }
  const ip = el('input', { value: c.ip, placeholder: '192.168.1.50', inputmode: 'decimal' });
  const puerto = el('input', { value: String(c.puerto), inputmode: 'numeric', style: 'max-width:110px' });
  const lenguaje = selector([['tspl', 'TSPL (recomendado, propio de la impresora)'], ['zpl', 'ZPL (compatible Zebra)']], c.lenguaje);
  const num = (v, w) => el('input', { value: String(v).replace('.', ','), inputmode: 'decimal', style: 'max-width:' + (w || 110) + 'px' });
  const ancho = num(c.ancho), alto = num(c.alto), sep = num(c.separacion), osc = num(c.oscuridad), vel = num(c.velocidad), cx = num(c.corrimientoX), cy = num(c.corrimientoY);
  const campoUsb = campo('Impresora (USB, instalada en Windows)', impresora, 'Instale primero el driver de SAT que viene con la impresora.');
  const campoRed = el('div', { class: 'g2' }, [campo('Dirección IP de la impresora', ip, 'Se ve en la hoja de configuración de la impresora.'), campo('Puerto', puerto)]);
  const pintar = () => {
    seg.innerHTML = '';
    for (const [k, t] of [['usb', 'USB'], ['red', 'Cable de red (Ethernet)']]) seg.appendChild(el('button', { class: conexion === k ? 'sel' : '', onclick: () => { conexion = k; pintar(); } }, t));
    campoUsb.hidden = conexion !== 'usb'; campoRed.hidden = conexion !== 'red';
  };
  async function guardar() {
    const nuevo = { conexion, impresora: impresora.value, ip: ip.value, puerto: parseInt(puerto.value, 10), lenguaje: lenguaje.value,
      ancho: leerNumero(ancho.value), alto: leerNumero(alto.value), separacion: leerNumero(sep.value), oscuridad: parseInt(osc.value, 10),
      velocidad: parseInt(vel.value, 10), corrimientoX: leerNumero(cx.value), corrimientoY: leerNumero(cy.value) };
    const r = await intentar(() => BESALU.etiquetas.guardarConfig(nuevo), 'No se guardó la configuración');
    if (!r) return;
    Etiquetas.config = r; Etiquetas.ancho = r.ancho; Etiquetas.alto = r.alto;
    cerrarModal();
    toast('Impresora de etiquetas configurada', 'ok', r.modelo + ' · ' + (r.conexion === 'red' ? r.ip : r.impresora || 'sin impresora'));
    if (App.vista === 'etiquetas') renderEtiquetas();
  }
  abrirModal(el('div', { class: 'modal', 'data-config-etiquetas': '' }, [
    el('div', { class: 'card-t' }, [el('h2', { text: 'Impresora de etiquetas' }), el('button', { class: 'icon-btn', onclick: cerrarModal }, icon('x', 18))]),
    el('div', { class: 'mini', style: 'margin-bottom:12px', text: c.modelo + ' · transferencia térmica · 203 dpi (8 puntos por mm) · hasta 104 mm de ancho' }),
    campo('Conexión', seg), campoUsb, campoRed,
    campo('Lenguaje de la impresora', lenguaje),
    el('div', { class: 'g2' }, [campo('Ancho de la etiqueta (mm)', ancho, 'Hasta 104 mm'), campo('Alto de la etiqueta (mm)', alto)]),
    el('div', { class: 'g3' }, [campo('Separación entre etiquetas (mm)', sep, 'Normalmente 2 o 3'), campo('Oscuridad (0 a 15)', osc, 'Más alto = más negro'), campo('Velocidad (2 a 5 pulg/s)', vel)]),
    el('div', { class: 'g2' }, [campo('Corrimiento horizontal (mm)', cx, 'Si sale corrida a un lado (−5 a 5)'), campo('Corrimiento vertical (mm)', cy, 'Si sale corrida arriba o abajo')]),
    el('div', { class: 'note', text: 'Si la impresora es nueva o se cambió el rollo, haga su calibración (mantenga presionado el botón FEED hasta que avance unas etiquetas) y después imprima una etiqueta de prueba.' }),
    el('div', { class: 'modal-acc' }, [el('button', { class: 'btn btn--ghost', onclick: cerrarModal }, 'Cancelar'), el('button', { class: 'btn btn--pos', onclick: guardar }, [icon('check', 17), 'Guardar'])])
  ]));
  pintar();
  if (enfocarTamano) { ancho.focus(); ancho.select(); }
}
