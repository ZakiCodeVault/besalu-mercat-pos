/**
 * conector.js — Envío de comprobantes a Hacienda (a través del proveedor).
 *
 * ESTADO ACTUAL: sin proveedor configurado.
 * Los comprobantes se emiten localmente (con su consecutivo y clave) y quedan
 * en estado "pendiente". Cuando el negocio tenga cuenta con el proveedor
 * (p. ej. Alanube) se implementa `proveedor.enviar()` y `proveedor.consultar()`,
 * y esta cola los enviará en orden, con reintentos, aunque haya habido días sin internet.
 *
 * La base de datos solo permite actualizar los campos de estado del envío
 * (estado_hacienda, hacienda_*, xml_firmado); nunca el contenido del comprobante.
 */
const { obtener, registrar } = require('../datos/conexion');

let proveedor = null;   // { nombre, enviar(comprobante) -> {estado, xml, respuesta}, consultar(clave) }

function configurarProveedor(p) { proveedor = p; }

function estado() {
  const filas = obtener().prepare('SELECT estado_hacienda AS estado, count(*) AS n FROM comprobantes GROUP BY estado_hacienda').all();
  const conteo = { pendiente: 0, enviado: 0, aceptado: 0, rechazado: 0, error: 0 };
  for (const f of filas) conteo[f.estado] = f.n;
  return { configurado: !!proveedor, proveedor: proveedor ? proveedor.nombre : null, conteo };
}

/** Envía los comprobantes pendientes (uno por uno, en orden). */
async function procesarCola({ maximo = 20 } = {}) {
  if (!proveedor) return { procesados: 0, motivo: 'sin proveedor configurado' };
  const d = obtener();
  const pendientes = d.prepare("SELECT id FROM comprobantes WHERE estado_hacienda IN ('pendiente','error') ORDER BY id LIMIT ?").all(maximo);
  const actualizar = d.prepare(`UPDATE comprobantes SET estado_hacienda = ?, hacienda_intentos = hacienda_intentos + 1,
    hacienda_error = ?, hacienda_respuesta = ?, hacienda_fecha = datetime('now','localtime'), xml_firmado = coalesce(?, xml_firmado) WHERE id = ?`);
  let procesados = 0;
  for (const { id } of pendientes) {
    const c = require('../datos/ventas').obtenerPorId(id);
    try {
      const r = await proveedor.enviar(c);
      actualizar.run(r.estado || 'enviado', null, r.respuesta || null, r.xml || null, id);
    } catch (e) {
      actualizar.run('error', String(e.message || e), null, null, id);
      registrar('hacienda_error', { id, error: String(e.message || e) });
    }
    procesados++;
  }
  return { procesados };
}

module.exports = { configurarProveedor, estado, procesarCola };
