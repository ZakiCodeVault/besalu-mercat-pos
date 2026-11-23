/**
 * actualizacion.prueba.js — Los datos del negocio sobreviven a cada actualización.
 *
 * Parte de una base REAL creada con la v2.4.0 (pruebas/apoyo/base-v2.4.0.sqlite,
 * hecha con el código de esa versión: proveedores, compras, una anulada, una
 * orden de compra recibida en parte, ventas, nota de crédito, marcas con logo,
 * un turno cerrado y la CAJA ABIERTA) y comprueba que la versión actual:
 *   - la actualiza sin perder ni cambiar un solo dato (fila por fila),
 *   - deja la copia de seguridad idéntica al lado antes de tocar nada,
 *   - sigue funcionando sobre esos datos (vender en la caja abierta, cerrarla,
 *     registrar otra compra al mismo proveedor),
 *   - y que si una actualización fallara o intentara cambiar datos, la base
 *     queda exactamente como estaba.
 *
 * Uso:  npm run prueba:actualizacion
 */
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const datos = require('../principal/datos');
const { MIGRACIONES } = require('../principal/datos/esquema');

const { conexion, productos, ventas, compras, caja, proveedores } = datos;
const BASE = path.join(__dirname, 'apoyo', 'base-v2.4.0.sqlite');

const resultados = [];
async function prueba(nombre, fn) {
  try {
    const detalle = await fn();
    resultados.push(true);
    console.log('  ✔ ' + nombre + (detalle ? '  — ' + detalle : ''));
  } catch (e) {
    resultados.push(false);
    console.log('  ✘ ' + nombre + '\n      ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n      ') : e));
  }
}
function ok(c, m) { if (!c) throw new Error(m || 'falló'); }

/** Copia la base de la v2.4.0 a una carpeta nueva y devuelve la carpeta. */
function copiaDeLaBase() {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'besalu-actualizacion-'));
  fs.copyFileSync(BASE, path.join(carpeta, conexion.NOMBRE_ARCHIVO));
  return carpeta;
}
/** Huella de la base tal como está en el disco (sin abrirla con la app). */
function huellaDelArchivo(archivo, soloDe) {
  const d = new Database(archivo, { readonly: true });
  try { return { version: d.pragma('user_version', { simple: true }), huella: conexion.huellaDatos(d, soloDe) }; } finally { d.close(); }
}
function iguales(a, b) {
  for (const t of Object.keys(a)) {
    if (!b[t]) return 'falta la tabla ' + t;
    if (a[t].filas !== b[t].filas) return t + ': ' + a[t].filas + ' filas → ' + b[t].filas;
    if (a[t].huella !== b[t].huella) return t + ': cambiaron datos';
  }
  return null;
}

async function correr() {
  const original = huellaDelArchivo(BASE);
  console.log('\nBase de la v2.4.0 (esquema ' + original.version + ') → esquema actual ' + MIGRACIONES.length);

  await prueba('Se actualiza sin perder ni cambiar un solo dato', () => {
    const carpeta = copiaDeLaBase();
    conexion.abrir(carpeta);
    const d = conexion.obtener();
    const v = d.pragma('user_version', { simple: true });
    const despues = conexion.huellaDatos(d, original.huella, { soloLasQueHabia: true });
    // Lo único nuevo en las tablas que ya existían: la anotación de la actualización en la bitácora
    const nuevas = Object.keys(original.huella).map((t) => [t, d.prepare(`SELECT count(*) AS n FROM "${t}"`).get().n - original.huella[t].filas]).filter(([, n]) => n);
    const anotaciones = d.prepare('SELECT accion FROM bitacora ORDER BY id DESC LIMIT ?').all(nuevas.length ? nuevas[0][1] : 0).map((b) => b.accion);
    conexion.cerrar();
    const dif = iguales(original.huella, despues);
    ok(v === MIGRACIONES.length, 'esquema ' + v);
    ok(!dif, dif);
    ok(nuevas.every(([t]) => t === 'bitacora') && anotaciones.every((a) => a.startsWith('migracion')), 'filas nuevas: ' + JSON.stringify(nuevas) + ' ' + anotaciones);
    const filas = Object.values(original.huella).reduce((s, t) => s + t.filas, 0);
    fs.rmSync(carpeta, { recursive: true, force: true });
    return Object.keys(original.huella).length + ' tablas · ' + filas + ' filas idénticas';
  });

  await prueba('Antes de actualizar deja una copia idéntica de la base al lado', () => {
    if (original.version === MIGRACIONES.length) return 'el esquema no cambió: no hace falta copia';
    const carpeta = copiaDeLaBase();
    conexion.abrir(carpeta);
    conexion.cerrar();
    const copias = fs.readdirSync(carpeta).filter((f) => f.startsWith('antes-de-migrar-v' + original.version + '-'));
    ok(copias.length === 1, 'copias: ' + copias.join(', '));
    const c = huellaDelArchivo(path.join(carpeta, copias[0]));
    ok(c.version === original.version && !iguales(original.huella, c.huella), 'la copia no es idéntica');
    fs.rmSync(carpeta, { recursive: true, force: true });
    return copias[0];
  });

  await prueba('Sigue funcionando sobre esos datos: vender en la caja abierta, cerrarla y comprar', () => {
    const carpeta = copiaDeLaBase();
    conexion.abrir(carpeta);
    const v = conexion.verificarIntegridad();
    ok(v.ok, v.problemas.join(' | '));
    const turno = caja.actual();
    ok(turno, 'la caja que estaba abierta sigue abierta');
    const pan = productos.buscarPorCodigo('7440000000019');
    const antes = pan.stock;
    const venta = ventas.emitir({ lineas: [{ producto_id: pan.id, cantidad: 2 }], medio_pago: 'efectivo', pago: 400000 });
    ok(venta.consecutivo.endsWith('0000000004') && productos.obtenerPorId(pan.id).stock === antes - 2, venta.consecutivo);
    const z = caja.cerrar(caja.resumen(turno.id).efectivo_esperado);
    ok(z.turno.cerrado_en && z.turno.diferencia === 0, 'cierre');
    const prov = proveedores.porIdentificacion('3101777777');
    ok(prov && prov.productos.length >= 2, 'el proveedor y su lista siguen');
    compras.registrarCompra({ proveedor: prov, numero_documento: '00100001010000000103', fecha: datos.montos.fechaLocal().slice(0, 10),
      lineas: [{ producto_id: prov.productos[0].producto_id, cantidad: 6, costo_unitario: 99000, tarifa_iva: 1 }] });
    ok(conexion.verificarIntegridad().ok, 'integridad después');
    conexion.cerrar();
    fs.rmSync(carpeta, { recursive: true, force: true });
    return 'venta ' + venta.consecutivo.slice(-4) + ' · caja cerrada · compra registrada';
  });

  await prueba('Si una actualización falla, la base queda exactamente como estaba', () => {
    const carpeta = copiaDeLaBase();
    MIGRACIONES.push('CREATE TABLE prueba_falla(x); CREATE TABLE productos(x);');   // la segunda falla (ya existe)
    let error = null;
    try { conexion.abrir(carpeta); } catch (e) { error = e; } finally { MIGRACIONES.pop(); }
    ok(error && error.codigo === 'MIGRACION' && /quedaron exactamente como estaban/.test(error.message), error && error.message);
    const ahora = huellaDelArchivo(path.join(carpeta, conexion.NOMBRE_ARCHIVO));
    ok(ahora.version === original.version, 'esquema ' + ahora.version);
    ok(!iguales(original.huella, ahora.huella) && !ahora.huella.prueba_falla, 'cambió algo');
    fs.rmSync(carpeta, { recursive: true, force: true });
    return 'esquema ' + ahora.version + ', datos intactos';
  });

  await prueba('Si una actualización intentara cambiar datos existentes, se deshace todo', () => {
    const carpeta = copiaDeLaBase();
    MIGRACIONES.push("UPDATE proveedores SET notas = notas || ' (cambiado)';");
    let error = null;
    try { conexion.abrir(carpeta); } catch (e) { error = e; } finally { MIGRACIONES.pop(); }
    ok(error && error.codigo === 'MIGRACION' && /cambiarían datos de la tabla proveedores/.test(error.message), error && error.message);
    const ahora = huellaDelArchivo(path.join(carpeta, conexion.NOMBRE_ARCHIVO));
    ok(ahora.version === original.version && !iguales(original.huella, ahora.huella), 'la base cambió');
    fs.rmSync(carpeta, { recursive: true, force: true });
    return 'detectado y deshecho';
  });

  await prueba('Una base de una versión más nueva no se abre (no se arriesga a dañarla)', () => {
    const carpeta = copiaDeLaBase();
    const archivo = path.join(carpeta, conexion.NOMBRE_ARCHIVO);
    const d = new Database(archivo); d.pragma('user_version = ' + (MIGRACIONES.length + 5)); d.close();
    let error = null;
    try { conexion.abrir(carpeta); } catch (e) { error = e; }
    ok(error && error.codigo === 'MIGRACION' && /más nueva/.test(error.message), error && error.message);
    fs.rmSync(carpeta, { recursive: true, force: true });
    return 'rechazada';
  });

  const fallas = resultados.filter((r) => !r).length;
  console.log('\n' + (fallas ? '✘ ' + fallas + ' prueba(s) fallaron' : '✔ Todas las pruebas pasaron (' + resultados.length + ')') + '\n');
  try { conexion.cerrar(); } catch (e) {}
  app.exit(fallas ? 1 : 0);
}

app.whenReady().then(() => correr().catch((e) => { console.error('Error en la prueba:', e); app.exit(1); }));
