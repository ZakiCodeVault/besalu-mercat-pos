/**
 * codigo-barras.js — Códigos de barras para las etiquetas (sin librerías).
 *
 * Se codifica EXACTAMENTE el código del producto, para que el lector de la
 * caja lo lea igual que el código guardado:
 *   - 13 dígitos con dígito verificador correcto → EAN-13
 *   - 12 dígitos con verificador correcto        → UPC-A (EAN-13 con 0 inicial)
 *   - 8 dígitos con verificador correcto         → EAN-8
 *   - cualquier otro (internos, alfanuméricos)   → Code 128 (B, o C para números)
 *
 * Devuelve el ancho de cada barra y espacio en módulos, empezando por barra.
 */
const CodigoBarras = (() => {
  const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
  const R = L.map((p) => p.replace(/./g, (b) => (b === '1' ? '0' : '1')));
  const PARIDAD = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
  // Code 128: barra, espacio, barra, espacio, barra, espacio (valores 0 a 105) y la parada (106)
  const C128 = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 ' +
    '123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 ' +
    '131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 ' +
    '213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 ' +
    '112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 ' +
    '421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112').split(' ');

  /** Dígito verificador GS1 de los dígitos dados (sin el verificador). */
  function verificador(digitos) {
    let suma = 0;
    for (let i = 0; i < digitos.length; i++) suma += Number(digitos[digitos.length - 1 - i]) * (i % 2 === 0 ? 3 : 1);
    return String((10 - (suma % 10)) % 10);
  }
  const valido = (c) => verificador(c.slice(0, -1)) === c.slice(-1);

  /** Cadena de módulos '1'/'0' → anchos de cada barra y espacio. */
  function corridas(bits) {
    const salida = [];
    let n = 1;
    for (let i = 1; i <= bits.length; i++) {
      if (bits[i] === bits[i - 1]) n++;
      else { salida.push(n); n = 1; }
    }
    return salida;
  }

  function ean13(c) {
    const paridad = PARIDAD[Number(c[0])];
    let bits = '101';
    for (let i = 1; i <= 6; i++) bits += (paridad[i - 1] === 'L' ? L : G)[Number(c[i])];
    bits += '01010';
    for (let i = 7; i <= 12; i++) bits += R[Number(c[i])];
    bits += '101';
    return corridas(bits);
  }

  function ean8(c) {
    let bits = '101';
    for (let i = 0; i < 4; i++) bits += L[Number(c[i])];
    bits += '01010';
    for (let i = 4; i < 8; i++) bits += R[Number(c[i])];
    return corridas(bits + '101');
  }

  function code128(texto) {
    const valores = [];
    if (/^\d{4,}$/.test(texto)) {
      // Números: de dos en dos (más corto). Si es impar, el primero va en B y después se cambia a C.
      let resto = texto;
      if (texto.length % 2) { valores.push(104, texto.charCodeAt(0) - 32, 99); resto = texto.slice(1); }
      else valores.push(105);
      for (let i = 0; i < resto.length; i += 2) valores.push(Number(resto.slice(i, i + 2)));
    } else {
      valores.push(104);
      for (const ch of texto) {
        const c = ch.charCodeAt(0);
        if (c < 32 || c > 126) throw new Error('El código "' + texto + '" tiene letras con tilde o símbolos que no caben en un código de barras');
        valores.push(c - 32);
      }
    }
    let suma = valores[0];
    for (let i = 1; i < valores.length; i++) suma += valores[i] * i;
    valores.push(suma % 103, 106);
    return valores.map((v) => C128[v]).join('').split('').map(Number);
  }

  /**
   * @returns {{ tipo: string, modulos: number[], silencio: number, texto: string }}
   *   silencio = módulos en blanco que necesita a cada lado para leerse bien
   */
  function codificar(codigo) {
    const c = String(codigo || '').trim();
    if (!c) throw new Error('El producto no tiene código');
    if (c.length > 40) throw new Error('El código es demasiado largo para una etiqueta');
    if (/^\d{13}$/.test(c) && valido(c)) return { tipo: 'EAN-13', modulos: ean13(c), silencio: 9, texto: c };
    if (/^\d{12}$/.test(c) && valido(c)) return { tipo: 'UPC-A', modulos: ean13('0' + c), silencio: 9, texto: c };
    if (/^\d{8}$/.test(c) && valido(c)) return { tipo: 'EAN-8', modulos: ean8(c), silencio: 7, texto: c };
    return { tipo: 'Code 128', modulos: code128(c), silencio: 10, texto: c };
  }

  return { codificar, verificador, ean13, ean8, code128, C128 };
})();
