/**
 * catalogos.js — Códigos oficiales de Hacienda (Anexos y Estructuras v4.4).
 *
 * Todo lo que va dentro del XML sale de aquí, para que un cambio de
 * normativa se corrija en un solo lugar.
 */

/** Ambientes de Hacienda: el de pruebas (sandbox) y el real. */
const AMBIENTES = {
  pruebas: {
    nombre: 'Pruebas (sandbox)',
    token: 'https://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/token',
    cerrarSesion: 'https://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/logout',
    clientId: 'api-stag',
    recepcion: 'https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1/recepcion',
    dominioUsuario: '@stag.comprobanteselectronicos.go.cr'
  },
  produccion: {
    nombre: 'Producción',
    token: 'https://idp.comprobanteselectronicos.go.cr/auth/realms/rut/protocol/openid-connect/token',
    cerrarSesion: 'https://idp.comprobanteselectronicos.go.cr/auth/realms/rut/protocol/openid-connect/logout',
    clientId: 'api-prod',
    recepcion: 'https://api.comprobanteselectronicos.go.cr/recepcion/v1/recepcion',
    dominioUsuario: '@prod.comprobanteselectronicos.go.cr'
  }
};

/** Espacio de nombres (raíz) de cada comprobante. */
const RAIZ = {
  '01': { elemento: 'FacturaElectronica', ns: 'https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica' },
  '03': { elemento: 'NotaCreditoElectronica', ns: 'https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/notaCreditoElectronica' },
  '04': { elemento: 'TiqueteElectronico', ns: 'https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/tiqueteElectronico' }
};

/** Nota 8.1: tarifa de IVA (%) → CodigoTarifaIVA. */
const CODIGO_TARIFA = {
  0: '10',     // Tarifa Exenta (Ley 9635, art. 8)
  0.5: '09',   // Tarifa reducida 0.5%
  1: '02',     // Tarifa reducida 1%
  2: '03',     // Tarifa reducida 2%
  4: '04',     // Tarifa reducida 4%
  8: '07',     // Tarifa transitoria 8%
  13: '08'     // Tarifa general 13%
};

/** Medio de pago del POS → TipoMedioPago. */
const MEDIO_PAGO = { efectivo: '01', tarjeta: '02', transferencia: '04', sinpe: '06', otro: '99' };

/** Unidad del producto → UnidadMedida (RTC 443:2010, distingue mayúsculas). */
const UNIDAD = { Unid: 'Unid', kg: 'Kg', Kg: 'Kg', g: 'G', G: 'G', L: 'L', mL: 'mL', m: 'M', M: 'M' };
/** Unidades que corresponden a servicios (el resto son mercancías). */
const UNIDADES_SERVICIO = new Set(['Sp', 'Spe', 'St', 'Os', 'Al', 'Alc', 'Cm', 'I', 'h', 'D', 'Min']);

/** Nota 10: tipo de documento de referencia. */
const DOC_REFERENCIA = { '01': '01', '03': '03', '04': '04', rechazado: '10' };
/** Nota 9: código de referencia. */
const CODIGO_REFERENCIA = { anula: '01', sustituye: '07' };

/** Identificación: largos válidos por tipo (nota 4). */
const LARGO_IDENTIFICACION = { '01': [9], '02': [10], '03': [11, 12], '04': [10] };

const PROVINCIAS = { 1: 'San José', 2: 'Alajuela', 3: 'Cartago', 4: 'Heredia', 5: 'Guanacaste', 6: 'Puntarenas', 7: 'Limón' };

/** Política de firma vigente (Resolución General sobre disposiciones técnicas). */
const POLITICA_FIRMA = {
  url: 'https://cdn.comprobanteselectronicos.go.cr/xml-schemas/Resoluci%C3%B3n_General_sobre_disposiciones_t%C3%A9cnicas_comprobantes_electr%C3%B3nicos_para_efectos_tributarios.pdf',
  // SHA-256 del PDF publicado por Hacienda (verificado al descargarlo)
  digestSha256: 'DWxin1xWOeI8OuWQXazh4VjLWAaCLAA954em7DMh0h8='
};

module.exports = {
  AMBIENTES, RAIZ, CODIGO_TARIFA, MEDIO_PAGO, UNIDAD, UNIDADES_SERVICIO,
  DOC_REFERENCIA, CODIGO_REFERENCIA, LARGO_IDENTIFICACION, PROVINCIAS, POLITICA_FIRMA
};
