/**
 * patrones.js — Adelanta los números cuando hay un patrón.
 *
 * Series (F-0099 → F-0100, LCH-001 → LCH-002, consecutivos de 20 dígitos),
 * la clave de 50 dígitos de una factura electrónica (de ahí salen el número y
 * la fecha), el tipo de identificación según la forma del número y la mediana
 * para sugerir márgenes. Solo sugiere: siempre se puede escribir otra cosa.
 */
const Patrones = {
  /** 'F-0099' → 'F-0100' (mantiene el prefijo, los ceros y el largo). null si no termina en número. */
  siguiente(texto) {
    const m = /^(.*?)(\d+)$/.exec(String(texto == null ? '' : texto).trim());
    if (!m) return null;
    return m[1] + (BigInt(m[2]) + 1n).toString().padStart(m[2].length, '0');
  },
  esSiguiente(a, b) { return a != null && b != null && Patrones.siguiente(a) === String(b).trim(); },
  /** Lo que va antes del número final ('LCH-001' → 'LCH-'). */
  prefijo(v) { const m = /^(.*?)(\d+)$/.exec(String(v || '').trim()); return m ? m[1] : null; },
  /** El siguiente de la serie con ese prefijo: el mayor que exista + 1. */
  siguienteDeSerie(valores, prefijo, ancho = 3) {
    let max = null, largo = ancho;
    for (const v of valores) {
      const m = /^(.*?)(\d+)$/.exec(String(v || '').trim());
      if (!m || m[1] !== prefijo) continue;
      const n = BigInt(m[2]);
      if (max === null || n > max) max = n;
      largo = Math.max(largo, m[2].length);
    }
    return prefijo + ((max === null ? 0n : max) + 1n).toString().padStart(largo, '0');
  },
  /** El prefijo que más se repite en una lista de códigos. */
  prefijoComun(valores) {
    const cuenta = new Map();
    for (const v of valores) { const p = Patrones.prefijo(v); if (p) cuenta.set(p, (cuenta.get(p) || 0) + 1); }
    let mejor = null, n = 0;
    for (const [p, c] of cuenta) if (c > n) { mejor = p; n = c; }
    return mejor;
  },
  mediana(xs) {
    const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  },
  /**
   * Clave de 50 dígitos de Hacienda: 506 + DDMMAA + cédula (12) + consecutivo (20) + situación + código.
   * @returns {{ numero, fecha, cedula } | null}
   */
  leerClave(clave) {
    const c = String(clave || '').replace(/\D/g, '');
    if (c.length !== 50 || !c.startsWith('506')) return null;
    const dd = c.slice(3, 5), mm = c.slice(5, 7), aa = c.slice(7, 9);
    if (Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) return null;
    return { numero: c.slice(21, 41), fecha: '20' + aa + '-' + mm + '-' + dd, cedula: c.slice(9, 21).replace(/^0+/, '') };
  },
  /** Tipo de identificación por la forma del número (null si no es claro). */
  tipoIdentificacion(id) {
    const d = String(id || '').replace(/\D/g, '');
    if (/^[1-9]\d{8}$/.test(d)) return '01';          // cédula física: 9 dígitos
    if (/^3\d{9}$/.test(d)) return '02';              // cédula jurídica: 10 dígitos, empieza con 3
    if (/^\d{11,12}$/.test(d)) return '03';           // DIMEX
    return null;
  }
};
