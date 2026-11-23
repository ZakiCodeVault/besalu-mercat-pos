/**
 * datos/index.js — Punto de entrada de la capa de datos.
 *
 *   conexion   abrir/cerrar, ajustes, bitácora, verificación de integridad
 *   productos  catálogo, ajustes de inventario, kárdex
 *   marcas     marcas de los productos con su logo (para las etiquetas)
 *   ventas     tiquetes, facturas y notas de crédito
 *   compras    facturas de compra (entradas) y recepciones
 *   proveedores ficha de cada proveedor y los productos que se le compran
 *   ordenes    órdenes de compra a proveedores
 *   caja       turnos: apertura, relevos de cajero, arqueo y cierre
 *   usuarios   usuarios con rol y PIN
 *   sesion     quién está usando la app (para dejar constancia)
 *   reportes   IVA a pagar, balance, ventas, alertas
 *   respaldos  copias de seguridad verificadas
 *   migracionV1 importar productos de la versión 1.0.x
 */
module.exports = {
  conexion: require('./conexion'),
  montos: require('./montos'),
  productos: require('./productos'),
  marcas: require('./marcas'),
  ventas: require('./ventas'),
  compras: require('./compras'),
  proveedores: require('./proveedores'),
  ordenes: require('./ordenes'),
  caja: require('./caja'),
  usuarios: require('./usuarios'),
  sesion: require('./sesion'),
  reportes: require('./reportes'),
  respaldos: require('./respaldos'),
  migracionV1: require('./migracionV1')
};
