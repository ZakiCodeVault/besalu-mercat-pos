/**
 * datos/index.js — Punto de entrada de la capa de datos.
 *
 *   conexion   abrir/cerrar, ajustes, bitácora, verificación de integridad
 *   productos  catálogo, ajustes de inventario, kárdex
 *   ventas     tiquetes, facturas y notas de crédito
 *   compras    facturas de compra (entradas) y proveedores
 *   caja       turnos: apertura, arqueo y cierre
 *   reportes   IVA a pagar, balance, ventas, alertas
 *   respaldos  copias de seguridad verificadas
 *   migracionV1 importar productos de la versión 1.0.x
 */
module.exports = {
  conexion: require('./conexion'),
  montos: require('./montos'),
  productos: require('./productos'),
  ventas: require('./ventas'),
  compras: require('./compras'),
  caja: require('./caja'),
  reportes: require('./reportes'),
  respaldos: require('./respaldos'),
  migracionV1: require('./migracionV1')
};
