/**
 * migracionV1.js — Importa los PRODUCTOS de la versión anterior (1.0.x).
 *
 * No se hace sola: el dueño decide desde Ajustes, porque la versión anterior
 * pudo tener datos de prueba. Las ventas viejas NO se importan: no eran
 * comprobantes fiscales y mezclarlas ensuciaría los registros oficiales.
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { obtener, registrar } = require('./conexion');
const productos = require('./productos');
const { validarTarifa } = require('./montos');

function archivoAnterior(carpetaDatos) {
  const f = path.join(carpetaDatos, 'besalu.sqlite');
  return fs.existsSync(f) ? f : null;
}

function leerAnteriores(carpetaDatos) {
  const f = archivoAnterior(carpetaDatos);
  if (!f) return [];
  const db = new Database(f, { readonly: true, fileMustExist: true });
  try {
    const existe = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='productos'").get();
    return existe ? db.prepare('SELECT * FROM productos').all() : [];
  } finally { db.close(); }
}

function detectar(carpetaDatos) {
  try { return { archivo: archivoAnterior(carpetaDatos), productos: leerAnteriores(carpetaDatos).length }; }
  catch (e) { return { archivo: null, productos: 0, error: e.message }; }
}

function importar(carpetaDatos) {
  const viejos = leerAnteriores(carpetaDatos);
  let creados = 0, omitidos = 0;
  obtener().transaction(() => {
    for (const v of viejos) {
      if (productos.buscarPorCodigo(v.cod)) { omitidos++; continue; }
      let tarifa = 13;
      try { tarifa = validarTarifa(v.iva); } catch (e) {}
      productos.crear({
        codigo: v.cod, nombre: v.nom, tarifa_iva: tarifa,
        precio: Math.round(Number(v.precio || 0) * 100), costo: Math.round(Number(v.costo || 0) * 100),
        cabys: /^\d{13}$/.test(String(v.cabys || '')) ? v.cabys : '', vence: v.vence || '',
        stock_inicial: Math.max(0, Number(v.stock || 0))
      }, { conBitacora: false });
      creados++;
    }
    registrar('importacion_v1', { creados, omitidos });
  })();
  return { creados, omitidos };
}

module.exports = { detectar, importar };
