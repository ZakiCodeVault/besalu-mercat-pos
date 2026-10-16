/**
 * graficos.js — Gráfico de ventas por día (línea suave con área).
 * Recibe valores en céntimos.
 */
let _idGrafico = 0;

function graficoArea(valores, etiquetas) {
  const w = 620, h = 176, pl = 10, pr = 10, pt = 16, pb = 24, iw = w - pl - pr, ih = h - pt - pb;
  if (!valores.length) valores = [0], etiquetas = [''];
  const mx = Math.max(...valores), mn = Math.min(...valores), sp = (mx - mn) || 1;
  const lo = mn - sp * 0.18, rg = sp * 1.36;
  const X = (i) => pl + (i / Math.max(1, valores.length - 1)) * iw;
  const Y = (v) => pt + ih - ((v - lo) / rg) * ih;
  const P = valores.map((v, i) => [X(i), Y(v)]);
  let d = 'M' + P[0][0].toFixed(1) + ' ' + P[0][1].toFixed(1);
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || p2;
    // Los puntos de control no salen del tramo: la curva nunca baja de cero ni pasa del máximo
    const lim = (y) => Math.min(Math.max(y, Math.min(p1[1], p2[1])), Math.max(p1[1], p2[1]));
    d += 'C' + (p1[0] + (p2[0] - p0[0]) / 6).toFixed(1) + ' ' + lim(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1) + ' ' +
         (p2[0] - (p3[0] - p1[0]) / 6).toFixed(1) + ' ' + lim(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1) + ' ' + p2[0].toFixed(1) + ' ' + p2[1].toFixed(1);
  }
  const base = (pt + ih).toFixed(1);
  const area = d + 'L' + P[P.length - 1][0].toFixed(1) + ' ' + base + 'L' + P[0][0].toFixed(1) + ' ' + base + 'Z';
  let grid = '';
  for (let k = 0; k <= 3; k++) { const gy = (pt + ih * (k / 3)).toFixed(1); grid += '<line x1="' + pl + '" y1="' + gy + '" x2="' + (w - pr) + '" y2="' + gy + '" stroke="rgba(17,22,39,.07)" stroke-width="1"/>'; }
  const paso = Math.ceil(etiquetas.length / 10);
  let xl = '';
  etiquetas.forEach((e, i) => { if (i % paso === 0 || i === etiquetas.length - 1) xl += '<text x="' + X(i).toFixed(1) + '" y="' + (h - 7) + '" text-anchor="middle" style="font:9.5px Inter,sans-serif" fill="#949bab">' + e + '</text>'; });
  const L = P[P.length - 1], id = 'ga' + (++_idGrafico);
  return '<svg viewBox="0 0 ' + w + ' ' + h + '" style="width:100%;height:auto;display:block" xmlns="http://www.w3.org/2000/svg">' +
    '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1f9468" stop-opacity="0.22"/><stop offset="1" stop-color="#1f9468" stop-opacity="0"/></linearGradient></defs>' +
    grid + '<path d="' + area + '" fill="url(#' + id + ')"/><path d="' + d + '" fill="none" stroke="#1f9468" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<circle cx="' + L[0].toFixed(1) + '" cy="' + L[1].toFixed(1) + '" r="3.4" fill="#1f9468"/>' + xl + '</svg>';
}

/** Rellena los días sin ventas con 0 para que el gráfico sea continuo. */
function serieDiaria(filas, desde, hasta) {
  const mapa = {};
  for (const f of filas) mapa[f.dia] = f.total;
  const valores = [], etiquetas = [];
  const d = new Date(desde + 'T00:00:00'), fin = new Date(hasta + 'T00:00:00');
  while (d <= fin) { const k = isoDia(d); valores.push(mapa[k] || 0); etiquetas.push(pad(d.getDate())); d.setDate(d.getDate() + 1); }
  return { valores, etiquetas };
}
