/**
 * xml.js — Arma el XML v4.4 de tiquete (04), factura (01) y nota de crédito (03).
 *
 * El texto se genera ya en forma canónica (C14N 1.0): sin espacios entre
 * etiquetas, sin etiquetas vacías abreviadas y con los caracteres escapados como
 * lo hace la canonicalización. Así el resumen (digest) que calcula la firma sobre
 * este texto es exactamente el que calcula Hacienda al validar.
 *
 * Montos: Hacienda trabaja con 5 decimales y calcula el IVA como
 * "base imponible × tarifa". Los precios del POS incluyen IVA, así que por cada
 * línea se busca la base (en cienmilésimas de colón) tal que base + IVA sea
 * lo que pagó el cliente (exacto, o a 0,00001 colones cuando el redondeo no
 * lo permite).
 */
const { RAIZ, CODIGO_TARIFA, MEDIO_PAGO, UNIDAD, UNIDADES_SERVICIO, DOC_REFERENCIA, CODIGO_REFERENCIA } = require('./catalogos');

const NS_DS = 'http://www.w3.org/2000/09/xmldsig#';

/* ---------- Escritura canónica ---------- */
function texto(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');
}
function atributo(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
    .replace(/\t/g, '&#x9;').replace(/\n/g, '&#xA;').replace(/\r/g, '&#xD;');
}
/** Elemento con texto o con hijos (arreglo de strings ya armados). Omite los nulos. */
function e(nombre, contenido) {
  if (contenido === null || contenido === undefined) return '';
  if (Array.isArray(contenido)) return '<' + nombre + '>' + contenido.join('') + '</' + nombre + '>';
  return '<' + nombre + '>' + texto(contenido) + '</' + nombre + '>';
}
/** Quita caracteres de control que XML no admite y espacios repetidos. */
function limpio(s, max) {
  const t = String(s || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/\s+/g, ' ').trim();
  return max ? t.slice(0, max) : t;
}

/* ---------- Montos en cienmilésimas (1 colón = 100 000) ---------- */
const U = 100000;
function decimal5(unidades) {
  const n = Math.round(unidades);
  const s = String(Math.abs(n)).padStart(6, '0');
  return (n < 0 ? '-' : '') + s.slice(0, -5) + '.' + s.slice(-5);
}
function cantidad3(q) { return (Math.round(q * 1000) / 1000).toFixed(3); }
function tarifa2(t) { return Number(t).toFixed(2); }

/**
 * Base e IVA de una línea con precio IVA incluido.
 * @param {number} totalCentimos lo que paga el cliente por la línea
 * @param {number} tarifa porcentaje (13, 1, 0.5…)
 * @returns {{base:number, iva:number}} en cienmilésimas; iva = base × tarifa; base + iva = total ± 1
 */
function baseEIva(totalCentimos, tarifa) {
  const total = totalCentimos * 1000;
  if (!tarifa) return { base: total, iva: 0 };
  const t10 = Math.round(tarifa * 10);                       // 13 → 130, 0.5 → 5
  const ivaDe = (b) => Math.round(b * t10 / 1000);
  const inicial = Math.round(total * 1000 / (1000 + t10));
  // Primero se busca la base exacta. Si no existe (el redondeo del IVA "salta"
  // ese total), se usa la más cercana: el IVA siempre cumple base × tarifa, que es
  // lo que valida Hacienda, y el total queda a 0,00001 colones de lo cobrado.
  let mejor = null;
  for (let d = 0; d <= 50; d++) {
    for (const b of d ? [inicial - d, inicial + d] : [inicial]) {
      const diferencia = Math.abs(b + ivaDe(b) - total);
      if (diferencia === 0) return { base: b, iva: ivaDe(b) };
      if (!mejor || diferencia < mejor.diferencia) mejor = { base: b, iva: ivaDe(b), diferencia };
    }
  }
  return { base: mejor.base, iva: mejor.iva };
}

/** Calcula todas las cifras del XML a partir de las líneas guardadas. */
function calcularMontos(lineas) {
  const r = { servGravados: 0, servExentos: 0, mercGravadas: 0, mercExentas: 0, impuesto: 0, desglose: new Map(), lineas: [] };
  for (const l of lineas) {
    const { base, iva } = baseEIva(l.total_linea, l.tarifa_iva);
    const servicio = UNIDADES_SERVICIO.has(l.unidad);
    if (l.tarifa_iva > 0) { if (servicio) r.servGravados += base; else r.mercGravadas += base; }
    else { if (servicio) r.servExentos += base; else r.mercExentas += base; }
    const codigoTarifa = CODIGO_TARIFA[l.tarifa_iva];
    if (!codigoTarifa) throw new Error('Tarifa de IVA sin código de Hacienda: ' + l.tarifa_iva + '%');
    if (iva > 0) r.desglose.set(codigoTarifa, (r.desglose.get(codigoTarifa) || 0) + iva);
    r.impuesto += iva;
    r.lineas.push({ ...l, base, iva, codigoTarifa, precioUnitario: Math.round(base / l.cantidad) });
  }
  r.gravado = r.servGravados + r.mercGravadas;
  r.exento = r.servExentos + r.mercExentas;
  r.venta = r.gravado + r.exento;
  r.total = r.venta + r.impuesto;
  return r;
}

/* ---------- Partes del comprobante ---------- */
function ubicacion(a) {
  return e('Ubicacion', [
    e('Provincia', String(a.provincia)), e('Canton', String(a.canton).padStart(2, '0')), e('Distrito', String(a.distrito).padStart(2, '0')),
    a.barrio && limpio(a.barrio).length >= 5 ? e('Barrio', limpio(a.barrio, 50)) : '',
    e('OtrasSenas', limpio(a.direccion, 250))]);
}

function emisor(a) {
  const tel = String(a.telefono || '').replace(/\D/g, '');
  const correos = String(a.correo || '').split(/[;,\s]+/).filter(Boolean).slice(0, 4);
  const comercial = limpio(a.nombreComercial, 80);
  return e('Emisor', [
    e('Nombre', limpio(a.negocio, 100)),
    e('Identificacion', [e('Tipo', a.tipoCedula), e('Numero', a.cedula)]),
    comercial.length >= 3 ? e('NombreComercial', comercial) : '',
    ubicacion(a),
    tel.length >= 8 ? e('Telefono', [e('CodigoPais', '506'), e('NumTelefono', tel.slice(-8))]) : '',
    ...correos.map((c) => e('CorreoElectronico', c))]);
}

function receptor(c) {
  if (!c.receptor_nombre) return '';
  return e('Receptor', [
    e('Nombre', limpio(c.receptor_nombre, 100)),
    c.receptor_identificacion ? e('Identificacion', [e('Tipo', c.receptor_tipo_id || '01'), e('Numero', c.receptor_identificacion)]) : '',
    c.receptor_correo ? e('CorreoElectronico', limpio(c.receptor_correo, 160)) : '']);
}

function detalle(l, tipo) {
  let nombre = limpio(l.descripcion, 200);
  if (nombre.length < 3) nombre = limpio(nombre + ' ' + l.codigo, 200).padEnd(3, '.');
  const codigo = limpio(l.codigo, 20);
  return e('LineaDetalle', [
    e('NumeroLinea', String(l.linea)),
    l.cabys ? e('CodigoCABYS', l.cabys) : '',
    codigo ? e('CodigoComercial', [e('Tipo', /^\d{8,14}$/.test(codigo) ? '03' : '04'), e('Codigo', codigo)]) : '',
    e('Cantidad', cantidad3(l.cantidad)),
    e('UnidadMedida', UNIDAD[l.unidad] || 'Unid'),
    e('Detalle', nombre),
    e('PrecioUnitario', decimal5(l.precioUnitario)),
    e('MontoTotal', decimal5(l.base)),
    e('SubTotal', decimal5(l.base)),
    e('BaseImponible', decimal5(l.base)),
    e('Impuesto', [e('Codigo', '01'), e('CodigoTarifaIVA', l.codigoTarifa), e('Tarifa', tarifa2(l.tarifa_iva)), e('Monto', decimal5(l.iva))]),
    tipo === '03' ? '' : e('ImpuestoAsumidoEmisorFabrica', decimal5(0)),
    e('ImpuestoNeto', decimal5(l.iva)),
    e('MontoTotalLinea', decimal5(l.base + l.iva))]);
}

function resumen(m, c) {
  return e('ResumenFactura', [
    e('CodigoTipoMoneda', [e('CodigoMoneda', 'CRC'), e('TipoCambio', decimal5(U))]),
    e('TotalServGravados', decimal5(m.servGravados)),
    e('TotalServExentos', decimal5(m.servExentos)),
    e('TotalMercanciasGravadas', decimal5(m.mercGravadas)),
    e('TotalMercanciasExentas', decimal5(m.mercExentas)),
    e('TotalGravado', decimal5(m.gravado)),
    e('TotalExento', decimal5(m.exento)),
    e('TotalVenta', decimal5(m.venta)),
    e('TotalDescuentos', decimal5(0)),
    e('TotalVentaNeta', decimal5(m.venta)),
    ...[...m.desglose.entries()].sort().map(([codigo, monto]) =>
      e('TotalDesgloseImpuesto', [e('Codigo', '01'), e('CodigoTarifaIVA', codigo), e('TotalMontoImpuesto', decimal5(monto))])),
    e('TotalImpuesto', decimal5(m.impuesto)),
    e('MedioPago', [e('TipoMedioPago', MEDIO_PAGO[c.medio_pago] || '99'),
      c.medio_pago === 'otro' ? e('MedioPagoOtros', 'Otro medio') : '',
      e('TotalMedioPago', decimal5(m.total))]),
    e('TotalComprobante', decimal5(m.total))]);
}

function informacionReferencia(ref) {
  return e('InformacionReferencia', [
    e('TipoDocIR', ref.tipoDoc), e('Numero', ref.clave), e('FechaEmisionIR', ref.fecha),
    e('Codigo', ref.codigo), e('Razon', limpio(ref.razon, 180))]);
}

/**
 * Referencias que lleva un comprobante:
 *   - nota de crédito → el comprobante que anula (código 01)
 *   - reemplazo de un rechazado → el rechazado (tipo 10, código 07)
 */
function referencias(c) {
  const lista = [];
  if (c.tipo === '03' && c.referencia) {
    lista.push({ tipoDoc: DOC_REFERENCIA[c.referencia.tipo], clave: c.referencia.clave, fecha: c.referencia.fecha_emision,
      codigo: CODIGO_REFERENCIA.anula, razon: c.referencia_razon });
  }
  if (c.sustituye) {
    lista.push({ tipoDoc: DOC_REFERENCIA.rechazado, clave: c.sustituye.clave, fecha: c.sustituye.fecha_emision,
      codigo: CODIGO_REFERENCIA.sustituye, razon: 'Sustituye comprobante rechazado por Hacienda' });
  }
  return lista;
}

/**
 * XML del comprobante, sin firma.
 * @param {object} c comprobante con lineas, referencia y sustituye (ver ventas.obtenerPorId)
 * @param {object} a ajustes del negocio emisor
 * @returns {{xml:string, raiz:string, montos:object}} xml sin declaración, listo para firmar
 */
function construir(c, a) {
  const raiz = RAIZ[c.tipo];
  if (!raiz) throw new Error('Tipo de comprobante no soportado: ' + c.tipo);
  const m = calcularMontos(c.lineas);
  const cuerpo = [
    e('Clave', c.clave),
    e('ProveedorSistemas', a.cedula),                    // desarrollo propio: la cédula del mismo emisor
    e('CodigoActividadEmisor', a.actividadEconomica),
    e('NumeroConsecutivo', c.consecutivo),
    e('FechaEmision', c.fecha_emision),
    emisor(a),
    receptor(c),
    e('CondicionVenta', c.condicion_venta || '01'),
    e('DetalleServicio', m.lineas.map((l) => detalle(l, c.tipo))),
    resumen(m, c),
    ...referencias(c).map(informacionReferencia)
  ].join('');
  // Solo el espacio de nombres por defecto: la firma declara su propio "ds"
  const xml = '<' + raiz.elemento + ' xmlns="' + atributo(raiz.ns) + '">' + cuerpo + '</' + raiz.elemento + '>';
  return { xml, raiz: raiz.elemento, ns: raiz.ns, montos: m };
}

module.exports = { construir, calcularMontos, baseEIva, decimal5, texto, atributo, NS_DS };
