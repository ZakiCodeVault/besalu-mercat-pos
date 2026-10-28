/**
 * receptor.js — Mensaje Receptor v4.4: el negocio acepta (05), acepta
 * parcialmente (06) o rechaza (07) ante Hacienda una factura electrónica que le
 * emitió un proveedor. Aceptarla es lo que respalda su IVA como crédito fiscal.
 *
 * Reglas del Anexo v4.4 ("Formato para la confirmación de aceptación o rechazo"):
 *   - Clave, cédula del vendedor, TotalFactura y MontoTotalImpuesto deben coincidir
 *     con la factura: se toman tal cual del XML que mandó el proveedor.
 *   - NumeroCedulaReceptor debe ser el receptor de la factura (la cédula del negocio).
 *   - DetalleMensaje (5 a 160 caracteres) es obligatorio en aceptación parcial y rechazo.
 *   - CondicionImpuesto (nota 18) dice cuánto del IVA se acredita; con 05
 *     (proporcionalidad) no se indican la actividad, el monto a acreditar ni el gasto.
 *   - El rechazo no lleva condición ni montos a acreditar.
 *
 * Aquí no se toca la base ni la red: solo se lee la factura y se arma el XML.
 */
const { RAIZ_MENSAJE_RECEPTOR, MENSAJE_RECEPTOR, CONDICION_IMPUESTO } = require('./catalogos');
const { e, limpio, atributo, decimal5, U } = require('./xml');

/* ---------- Lectura de la factura del proveedor ---------- */
const ENTIDADES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
function desescapar(s) {
  return s.replace(/&(lt|gt|amp|quot|apos|#x[0-9a-fA-F]+|#\d+);/g, (m, k) => (k[0] === '#'
    ? String.fromCodePoint(k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10)) : ENTIDADES[k]));
}
/** Contenido del primer elemento con ese nombre (con o sin prefijo), o null. */
function interior(xml, etiqueta) {
  if (xml == null) return null;
  const m = xml.match(new RegExp('<(?:[\\w.-]+:)?' + etiqueta + '(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?' + etiqueta + '\\s*>'));
  return m ? m[1] : null;
}
function valor(xml, etiqueta) {
  const v = interior(xml, etiqueta);
  return v == null ? '' : desescapar(v.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim();
}

/** "1234.5" → 123450000 (cienmilésimas de la moneda de la factura, exacto). */
function aCienmilesimas(texto, campo) {
  const m = String(texto || '').trim().match(/^(\d{1,13})(?:\.(\d{1,5}))?$/);
  const n = m ? Number(m[1]) * U + Number((m[2] || '').padEnd(5, '0')) : NaN;
  if (!Number.isSafeInteger(n)) throw new Error('La factura tiene un monto inválido en ' + campo + ': "' + texto + '"');
  return n;
}

function identificacion(nodo) {
  const id = interior(nodo, 'Identificacion');
  return id == null ? null : { tipo: valor(id, 'Tipo'), numero: valor(id, 'Numero').replace(/\D/g, '') };
}

/**
 * Datos de la factura del proveedor que necesita el mensaje.
 * @param {string} xml el XML original que se importó en Compras
 * @returns {{clave, consecutivo, fecha, moneda, emisor:{tipo,numero,nombre}, receptor:{tipo,numero,nombre}|null, total:number, impuesto:number}}
 *          montos en cienmilésimas
 */
function leerFactura(xml) {
  if (!xml) throw new Error('Esta compra se registró a mano: para aceptarla ante Hacienda regístrela importando el XML de la factura');
  const doc = String(xml).replace(/^﻿/, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').trim();
  const raiz = (doc.match(/^<(?:[\w.-]+:)?([\w.-]+)/) || [])[1] || '';
  if (raiz === 'TiqueteElectronico') throw new Error('Un tiquete electrónico no lleva receptor: no se acepta ante Hacienda ni da crédito fiscal');
  if (raiz !== 'FacturaElectronica') throw new Error('Solo se aceptan o rechazan facturas electrónicas de proveedores (el XML es ' + (raiz || 'desconocido') + ')');
  // Sin las firmas, para no confundir sus nodos con los de la factura
  const cuerpo = doc.replace(/<(?:[\w.-]+:)?Signature[\s>][\s\S]*?<\/(?:[\w.-]+:)?Signature>/g, '');
  const clave = valor(cuerpo, 'Clave');
  if (!/^\d{50}$/.test(clave)) throw new Error('El XML de la factura no tiene una clave válida de 50 dígitos');
  const emisor = interior(cuerpo, 'Emisor');
  const receptor = interior(cuerpo, 'Receptor');
  const resumen = interior(cuerpo, 'ResumenFactura');
  const idEmisor = identificacion(emisor);
  if (!idEmisor || !/^\d{9,12}$/.test(idEmisor.numero)) throw new Error('El XML de la factura no trae la cédula del proveedor');
  if (resumen == null || !valor(resumen, 'TotalComprobante')) throw new Error('El XML de la factura no trae el total del comprobante');
  const idReceptor = identificacion(receptor);
  const impuesto = valor(resumen, 'TotalImpuesto');
  return {
    clave,
    consecutivo: valor(cuerpo, 'NumeroConsecutivo'),
    fecha: valor(cuerpo, 'FechaEmision'),
    moneda: valor(interior(resumen, 'CodigoTipoMoneda'), 'CodigoMoneda') || 'CRC',
    emisor: Object.assign({ nombre: valor(emisor, 'Nombre') }, idEmisor),
    receptor: idReceptor && idReceptor.numero ? Object.assign({ nombre: valor(receptor, 'Nombre') }, idReceptor) : null,
    total: aCienmilesimas(valor(resumen, 'TotalComprobante'), 'TotalComprobante'),
    impuesto: impuesto ? aCienmilesimas(impuesto, 'TotalImpuesto') : 0
  };
}

/** Lanza un error si la factura no es del negocio (Hacienda solo acepta el mensaje del receptor). */
function exigirReceptor(f, ajustes) {
  if (!f.receptor) throw new Error('La factura no indica receptor: el proveedor la emitió sin la cédula del negocio y no se puede aceptar ante Hacienda');
  if (f.receptor.numero !== ajustes.cedula) {
    throw new Error('La factura está a nombre de la cédula ' + f.receptor.numero + (f.receptor.nombre ? ' (' + f.receptor.nombre + ')' : '') +
      ', no de la del negocio (' + ajustes.cedula + '): pídale al proveedor que la corrija');
  }
}

/**
 * ¿Se puede aceptar o rechazar ante Hacienda la compra con este XML?
 * @returns {string|null} null si se puede; si no, el motivo
 */
function motivoNoAceptable(xml, ajustes) {
  try { exigirReceptor(leerFactura(xml), ajustes); return null; }
  catch (e) { return e.message; }
}

/* ---------- Campos del mensaje ---------- */
/**
 * Calcula los campos del mensaje según el Anexo v4.4.
 * @param {object} f leerFactura()
 * @param {object} o { tipo:'05'|'06'|'07', detalle?, condicion? (nota 18, por defecto 01), acreditar? (céntimos, solo condición 02) }
 * @param {object} ajustes del negocio (receptor)
 * @returns {object} fila lista para la tabla mensajes_receptor (sin consecutivo ni fecha)
 */
function calcular(f, o, ajustes) {
  const tipo = String(o.tipo || '');
  if (!MENSAJE_RECEPTOR[tipo]) throw new Error('Elija si acepta, acepta parcialmente o rechaza la factura');
  exigirReceptor(f, ajustes);
  const detalle = limpio(o.detalle);
  if (detalle.length > 160) throw new Error('El motivo admite como máximo 160 caracteres (tiene ' + detalle.length + ')');
  if ((tipo !== '05' || detalle) && detalle.length < 5) {
    throw new Error('Indique el motivo ' + ({ '05': 'de la aceptación', '06': 'de la aceptación parcial', '07': 'del rechazo' })[tipo] + ' (mínimo 5 caracteres)');
  }
  const m = {
    tipo, mensaje: MENSAJE_RECEPTOR[tipo], detalle: detalle || null, clave: f.clave,
    emisor_tipo_id: f.emisor.tipo || '02', emisor_identificacion: f.emisor.numero,
    receptor_tipo_id: ajustes.tipoCedula, receptor_identificacion: ajustes.cedula,
    codigo_actividad: null, condicion_impuesto: null, impuesto_acreditar: null, gasto_aplicable: null,
    monto_impuesto: f.impuesto > 0 ? decimal5(f.impuesto) : null,
    total_factura: decimal5(f.total)
  };
  if (tipo === '07') return m;   // rechazo: no se acredita ni se aplica nada

  if (!(f.impuesto > 0)) { m.codigo_actividad = ajustes.actividadEconomica; return m; }
  const condicion = String(o.condicion || '01');
  if (!CONDICION_IMPUESTO[condicion]) throw new Error('Condición del IVA inválida: ' + condicion);
  m.condicion_impuesto = condicion;
  if (condicion === '05') return m;   // proporcionalidad: se define en la declaración
  let acreditar = f.impuesto;                                      // 01 y 03: todo el IVA
  if (condicion === '04') acreditar = 0;                           // gasto: nada
  if (condicion === '02') {                                        // parcial: lo que indique
    acreditar = Math.round(Number(o.acreditar) * 1000);
    if (!Number.isSafeInteger(acreditar) || acreditar <= 0 || acreditar >= f.impuesto) {
      throw new Error('Con crédito parcial, el IVA a acreditar debe ser mayor que cero y menor que el IVA de la factura (' + decimal5(f.impuesto) + ')');
    }
  }
  m.codigo_actividad = ajustes.actividadEconomica;
  m.impuesto_acreditar = decimal5(acreditar);
  m.gasto_aplicable = decimal5(f.total - acreditar);              // lo que no se acredita es gasto
  return m;
}

/**
 * XML del mensaje, sin firma (forma canónica, ver xml.js).
 * @param {object} m fila de mensajes_receptor (con consecutivo y fecha_emision)
 */
function construir(m) {
  const cuerpo = [
    e('Clave', m.clave),
    e('NumeroCedulaEmisor', m.emisor_identificacion),
    e('FechaEmisionDoc', m.fecha_emision),
    e('Mensaje', String(m.mensaje)),
    e('DetalleMensaje', m.detalle),
    e('MontoTotalImpuesto', m.monto_impuesto),
    e('CodigoActividad', m.codigo_actividad),
    e('CondicionImpuesto', m.condicion_impuesto),
    e('MontoTotalImpuestoAcreditar', m.impuesto_acreditar),
    e('MontoTotalDeGastoAplicable', m.gasto_aplicable),
    e('TotalFactura', m.total_factura),
    e('NumeroCedulaReceptor', m.receptor_identificacion),
    e('NumeroConsecutivoReceptor', m.consecutivo)
  ].join('');
  const r = RAIZ_MENSAJE_RECEPTOR;
  return '<' + r.elemento + ' xmlns="' + atributo(r.ns) + '">' + cuerpo + '</' + r.elemento + '>';
}

module.exports = { leerFactura, exigirReceptor, motivoNoAceptable, calcular, construir };
