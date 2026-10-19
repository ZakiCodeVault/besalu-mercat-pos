/**
 * esquema.js — Estructura de la base de datos (migraciones versionadas).
 *
 * Reglas de integridad que la PROPIA base hace cumplir (no dependen del código):
 *   - Los comprobantes emitidos y sus líneas NO se pueden modificar ni borrar.
 *     Una corrección se hace con una nota de crédito.
 *   - Los consecutivos solo avanzan de 1 en 1 (sin saltos ni repetidos).
 *   - Los movimientos de inventario (kárdex) no se modifican ni se borran.
 *     El stock de cada producto es la suma de sus movimientos.
 *   - Una factura de compra no se puede registrar dos veces (mismo proveedor y número).
 *   - Solo puede haber un turno de caja abierto; un turno cerrado no cambia.
 *   - Los totales deben cuadrar (total = base + impuesto).
 *
 * Montos: siempre en CÉNTIMOS (enteros), para no tener errores de redondeo.
 * Cada elemento de MIGRACIONES se aplica una sola vez (PRAGMA user_version).
 */

const MIGRACIONES = [
  /* ---------------- v1: base fiscal ---------------- */
  `
  CREATE TABLE config(
    clave TEXT PRIMARY KEY,
    valor TEXT NOT NULL
  );

  CREATE TABLE productos(
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo         TEXT NOT NULL UNIQUE CHECK(length(trim(codigo)) > 0),
    nombre         TEXT NOT NULL CHECK(length(trim(nombre)) > 0),
    cabys          TEXT NOT NULL DEFAULT '' CHECK(cabys = '' OR (length(cabys) = 13 AND cabys NOT GLOB '*[^0-9]*')),
    unidad         TEXT NOT NULL DEFAULT 'Unid',
    tarifa_iva     REAL NOT NULL DEFAULT 13 CHECK(tarifa_iva IN (0, 0.5, 1, 2, 4, 8, 13)),
    precio         INTEGER NOT NULL DEFAULT 0 CHECK(precio >= 0),   -- venta, IVA incluido
    costo          INTEGER NOT NULL DEFAULT 0 CHECK(costo >= 0),    -- sin IVA, promedio ponderado
    stock          REAL NOT NULL DEFAULT 0,                          -- lo mantiene el trigger de movimientos
    stock_minimo   REAL NOT NULL DEFAULT 0 CHECK(stock_minimo >= 0),
    vence          TEXT NOT NULL DEFAULT '',
    activo         INTEGER NOT NULL DEFAULT 1 CHECK(activo IN (0, 1)),
    creado_en      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    actualizado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX productos_nombre ON productos(nombre COLLATE NOCASE);

  CREATE TABLE clientes(
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo_id        TEXT NOT NULL DEFAULT '01' CHECK(tipo_id IN ('01','02','03','04','05')),
    identificacion TEXT NOT NULL UNIQUE,
    nombre         TEXT NOT NULL,
    correo         TEXT NOT NULL DEFAULT '',
    telefono       TEXT NOT NULL DEFAULT '',
    creado_en      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE proveedores(
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo_id        TEXT NOT NULL DEFAULT '02' CHECK(tipo_id IN ('01','02','03','04','05')),
    identificacion TEXT NOT NULL UNIQUE CHECK(length(trim(identificacion)) > 0),
    nombre         TEXT NOT NULL CHECK(length(trim(nombre)) > 0),
    correo         TEXT NOT NULL DEFAULT '',
    telefono       TEXT NOT NULL DEFAULT '',
    creado_en      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  /* ---- Turnos de caja ---- */
  CREATE TABLE turnos(
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    abierto_en  TEXT NOT NULL,
    fondo       INTEGER NOT NULL CHECK(fondo >= 0),
    cerrado_en  TEXT,
    contado     INTEGER,
    esperado    INTEGER,
    diferencia  INTEGER,
    CHECK((cerrado_en IS NULL) = (contado IS NULL))
  );
  -- Solo un turno abierto a la vez
  CREATE UNIQUE INDEX turno_abierto_unico ON turnos(cerrado_en IS NULL) WHERE cerrado_en IS NULL;
  CREATE TRIGGER turnos_cerrados_inmutables BEFORE UPDATE ON turnos WHEN OLD.cerrado_en IS NOT NULL
  BEGIN SELECT RAISE(ABORT, 'Turno cerrado: no se puede modificar'); END;
  CREATE TRIGGER turnos_no_borrar BEFORE DELETE ON turnos
  BEGIN SELECT RAISE(ABORT, 'Turno de caja: no se puede borrar'); END;

  /* ---- Consecutivos (01 factura, 03 nota de crédito, 04 tiquete) ---- */
  CREATE TABLE secuencias(
    tipo   TEXT PRIMARY KEY CHECK(tipo IN ('01','03','04')),
    ultimo INTEGER NOT NULL DEFAULT 0 CHECK(ultimo >= 0)
  );
  INSERT INTO secuencias(tipo, ultimo) VALUES ('01', 0), ('03', 0), ('04', 0);
  CREATE TRIGGER secuencias_sin_saltos BEFORE UPDATE ON secuencias WHEN NEW.ultimo <> OLD.ultimo + 1
  BEGIN SELECT RAISE(ABORT, 'Consecutivo inválido: solo puede avanzar de 1 en 1'); END;
  CREATE TRIGGER secuencias_no_borrar BEFORE DELETE ON secuencias
  BEGIN SELECT RAISE(ABORT, 'Los consecutivos no se pueden borrar'); END;

  /* ---- Comprobantes emitidos (ventas y notas de crédito) ---- */
  CREATE TABLE comprobantes(
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo                    TEXT NOT NULL CHECK(tipo IN ('01','03','04')),
    numero                  INTEGER NOT NULL CHECK(numero > 0),
    consecutivo             TEXT NOT NULL UNIQUE CHECK(length(consecutivo) = 20),
    clave                   TEXT NOT NULL UNIQUE CHECK(length(clave) = 50),
    fecha_emision           TEXT NOT NULL,
    turno_id                INTEGER REFERENCES turnos(id),
    medio_pago              TEXT NOT NULL CHECK(medio_pago IN ('efectivo','tarjeta','sinpe','transferencia','otro')),
    condicion_venta         TEXT NOT NULL DEFAULT '01',
    receptor_tipo_id        TEXT,
    receptor_identificacion TEXT,
    receptor_nombre         TEXT,
    receptor_correo         TEXT,
    total_gravado           INTEGER NOT NULL CHECK(total_gravado >= 0),
    total_exento            INTEGER NOT NULL CHECK(total_exento >= 0),
    total_venta             INTEGER NOT NULL CHECK(total_venta = total_gravado + total_exento),
    total_impuesto          INTEGER NOT NULL CHECK(total_impuesto >= 0),
    total_comprobante       INTEGER NOT NULL CHECK(total_comprobante = total_venta + total_impuesto),
    pago                    INTEGER NOT NULL DEFAULT 0,
    cambio                  INTEGER NOT NULL DEFAULT 0 CHECK(cambio >= 0),
    referencia_id           INTEGER REFERENCES comprobantes(id),
    referencia_razon        TEXT,
    estado_hacienda         TEXT NOT NULL DEFAULT 'pendiente'
                              CHECK(estado_hacienda IN ('pendiente','enviado','aceptado','rechazado','error')),
    hacienda_intentos       INTEGER NOT NULL DEFAULT 0,
    hacienda_error          TEXT,
    hacienda_respuesta      TEXT,
    hacienda_fecha          TEXT,
    xml_firmado             TEXT,
    creado_en               TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(tipo, numero),
    CHECK(tipo <> '03' OR (referencia_id IS NOT NULL AND length(trim(coalesce(referencia_razon,''))) > 0)),
    CHECK(tipo <> '01' OR (length(coalesce(receptor_identificacion,'')) > 0 AND length(coalesce(receptor_nombre,'')) > 0))
  );
  CREATE INDEX comprobantes_fecha  ON comprobantes(fecha_emision);
  CREATE INDEX comprobantes_estado ON comprobantes(estado_hacienda);
  CREATE INDEX comprobantes_ref    ON comprobantes(referencia_id);
  -- El número debe ser exactamente el consecutivo que se acaba de reservar
  CREATE TRIGGER comprobantes_numero_valido BEFORE INSERT ON comprobantes
  WHEN NEW.numero <> (SELECT ultimo FROM secuencias WHERE tipo = NEW.tipo)
  BEGIN SELECT RAISE(ABORT, 'El número del comprobante no coincide con el consecutivo'); END;
  -- Inmutables: solo se puede actualizar el estado del envío a Hacienda
  CREATE TRIGGER comprobantes_inmutables BEFORE UPDATE OF
    tipo, numero, consecutivo, clave, fecha_emision, turno_id, medio_pago, condicion_venta,
    receptor_tipo_id, receptor_identificacion, receptor_nombre, receptor_correo,
    total_gravado, total_exento, total_venta, total_impuesto, total_comprobante,
    pago, cambio, referencia_id, referencia_razon ON comprobantes
  BEGIN SELECT RAISE(ABORT, 'Comprobante emitido: no se puede modificar (use una nota de crédito)'); END;
  CREATE TRIGGER comprobantes_no_borrar BEFORE DELETE ON comprobantes
  BEGIN SELECT RAISE(ABORT, 'Comprobante emitido: no se puede borrar'); END;

  CREATE TABLE comprobante_lineas(
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    comprobante_id  INTEGER NOT NULL REFERENCES comprobantes(id),
    linea           INTEGER NOT NULL CHECK(linea > 0),
    producto_id     INTEGER REFERENCES productos(id),
    codigo          TEXT NOT NULL,
    cabys           TEXT NOT NULL DEFAULT '',
    descripcion     TEXT NOT NULL,
    unidad          TEXT NOT NULL DEFAULT 'Unid',
    cantidad        REAL NOT NULL CHECK(cantidad > 0),
    precio_unitario INTEGER NOT NULL CHECK(precio_unitario >= 0),   -- sin IVA
    subtotal        INTEGER NOT NULL CHECK(subtotal >= 0),          -- base sin IVA
    tarifa_iva      REAL NOT NULL,
    impuesto        INTEGER NOT NULL CHECK(impuesto >= 0),
    total_linea     INTEGER NOT NULL CHECK(total_linea = subtotal + impuesto),
    costo_unitario  INTEGER NOT NULL DEFAULT 0,                      -- costo al momento (utilidad)
    UNIQUE(comprobante_id, linea)
  );
  CREATE INDEX comprobante_lineas_producto ON comprobante_lineas(producto_id);
  CREATE TRIGGER comprobante_lineas_inmutables BEFORE UPDATE ON comprobante_lineas
  BEGIN SELECT RAISE(ABORT, 'Línea de comprobante: no se puede modificar'); END;
  CREATE TRIGGER comprobante_lineas_no_borrar BEFORE DELETE ON comprobante_lineas
  BEGIN SELECT RAISE(ABORT, 'Línea de comprobante: no se puede borrar'); END;

  /* ---- Facturas de compra (entradas) ---- */
  CREATE TABLE compras(
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    proveedor_id     INTEGER NOT NULL REFERENCES proveedores(id),
    tipo_documento   TEXT NOT NULL DEFAULT '01',
    numero_documento TEXT NOT NULL CHECK(length(trim(numero_documento)) > 0),
    clave            TEXT,
    fecha            TEXT NOT NULL CHECK(fecha GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    subtotal         INTEGER NOT NULL CHECK(subtotal >= 0),
    impuesto         INTEGER NOT NULL CHECK(impuesto >= 0),
    otros_cargos     INTEGER NOT NULL DEFAULT 0 CHECK(otros_cargos >= 0),
    total            INTEGER NOT NULL CHECK(total = subtotal + impuesto + otros_cargos),
    notas            TEXT NOT NULL DEFAULT '',
    xml_original     TEXT,
    estado           TEXT NOT NULL DEFAULT 'vigente' CHECK(estado IN ('vigente','anulada')),
    anulada_en       TEXT,
    anulada_razon    TEXT,
    creado_en        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(proveedor_id, numero_documento)
  );
  CREATE UNIQUE INDEX compras_clave_unica ON compras(clave) WHERE clave IS NOT NULL AND clave <> '';
  CREATE INDEX compras_fecha ON compras(fecha);
  CREATE TRIGGER compras_inmutables BEFORE UPDATE OF
    proveedor_id, tipo_documento, numero_documento, clave, fecha, subtotal, impuesto, otros_cargos, total, xml_original ON compras
  BEGIN SELECT RAISE(ABORT, 'Compra registrada: no se puede modificar (anúlela y regístrela de nuevo)'); END;
  CREATE TRIGGER compras_solo_anular BEFORE UPDATE OF estado ON compras
  WHEN NOT (OLD.estado = 'vigente' AND NEW.estado = 'anulada')
  BEGIN SELECT RAISE(ABORT, 'Una compra anulada no se puede reactivar'); END;
  CREATE TRIGGER compras_no_borrar BEFORE DELETE ON compras
  BEGIN SELECT RAISE(ABORT, 'Compra registrada: no se puede borrar'); END;

  CREATE TABLE compra_lineas(
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    compra_id      INTEGER NOT NULL REFERENCES compras(id),
    linea          INTEGER NOT NULL CHECK(linea > 0),
    producto_id    INTEGER REFERENCES productos(id),   -- NULL = gasto (no es inventario)
    descripcion    TEXT NOT NULL,
    cantidad       REAL NOT NULL CHECK(cantidad > 0),
    costo_unitario INTEGER NOT NULL CHECK(costo_unitario >= 0),  -- sin IVA
    subtotal       INTEGER NOT NULL CHECK(subtotal >= 0),
    tarifa_iva     REAL NOT NULL,
    impuesto       INTEGER NOT NULL CHECK(impuesto >= 0),
    total_linea    INTEGER NOT NULL CHECK(total_linea = subtotal + impuesto),
    UNIQUE(compra_id, linea)
  );
  CREATE TRIGGER compra_lineas_inmutables BEFORE UPDATE ON compra_lineas
  BEGIN SELECT RAISE(ABORT, 'Línea de compra: no se puede modificar'); END;
  CREATE TRIGGER compra_lineas_no_borrar BEFORE DELETE ON compra_lineas
  BEGIN SELECT RAISE(ABORT, 'Línea de compra: no se puede borrar'); END;

  /* ---- Kárdex: cada entrada y salida de inventario ---- */
  CREATE TABLE movimientos(
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    producto_id    INTEGER NOT NULL REFERENCES productos(id),
    fecha          TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    tipo           TEXT NOT NULL CHECK(tipo IN ('inicial','compra','venta','nota_credito','ajuste','anulacion_compra')),
    cantidad       REAL NOT NULL CHECK(cantidad <> 0),   -- positivo entra, negativo sale
    costo_unitario INTEGER NOT NULL DEFAULT 0,
    comprobante_id INTEGER REFERENCES comprobantes(id),
    compra_id      INTEGER REFERENCES compras(id),
    nota           TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX movimientos_producto ON movimientos(producto_id, id);
  CREATE INDEX movimientos_fecha    ON movimientos(fecha);
  CREATE TRIGGER movimientos_actualizan_stock AFTER INSERT ON movimientos
  BEGIN UPDATE productos SET stock = round(stock + NEW.cantidad, 3) WHERE id = NEW.producto_id; END;
  CREATE TRIGGER movimientos_inmutables BEFORE UPDATE ON movimientos
  BEGIN SELECT RAISE(ABORT, 'Movimiento de inventario: no se puede modificar'); END;
  CREATE TRIGGER movimientos_no_borrar BEFORE DELETE ON movimientos
  BEGIN SELECT RAISE(ABORT, 'Movimiento de inventario: no se puede borrar'); END;

  /* ---- Bitácora de auditoría ---- */
  CREATE TABLE bitacora(
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    accion  TEXT NOT NULL,
    detalle TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX bitacora_fecha ON bitacora(fecha);
  CREATE TRIGGER bitacora_inmutable BEFORE UPDATE ON bitacora
  BEGIN SELECT RAISE(ABORT, 'La bitácora no se puede modificar'); END;
  CREATE TRIGGER bitacora_no_borrar BEFORE DELETE ON bitacora
  BEGIN SELECT RAISE(ABORT, 'La bitácora no se puede borrar'); END;
  `,

  /* ===== Versión 2: conexión directa con Hacienda ===== */
  `
  -- Comprobante que reemplaza a uno rechazado por Hacienda (mismas líneas y montos)
  ALTER TABLE comprobantes ADD COLUMN sustituye_id INTEGER REFERENCES comprobantes(id);
  ALTER TABLE comprobantes ADD COLUMN hacienda_mensaje   TEXT;   -- detalle legible de la respuesta
  ALTER TABLE comprobantes ADD COLUMN hacienda_ambiente  TEXT;   -- pruebas / produccion
  ALTER TABLE comprobantes ADD COLUMN hacienda_siguiente TEXT;   -- próximo intento (reintentos)
  CREATE UNIQUE INDEX comprobantes_sustituye ON comprobantes(sustituye_id) WHERE sustituye_id IS NOT NULL;

  CREATE TRIGGER comprobantes_sustituye_inmutable BEFORE UPDATE OF sustituye_id ON comprobantes
  BEGIN SELECT RAISE(ABORT, 'Comprobante emitido: no se puede modificar (use una nota de crédito)'); END;
  -- Solo se reemplaza un comprobante que Hacienda rechazó
  CREATE TRIGGER comprobantes_sustituye_rechazado BEFORE INSERT ON comprobantes
  WHEN NEW.sustituye_id IS NOT NULL
   AND coalesce((SELECT estado_hacienda FROM comprobantes WHERE id = NEW.sustituye_id), '') <> 'rechazado'
  BEGIN SELECT RAISE(ABORT, 'Solo se puede reemplazar un comprobante rechazado por Hacienda'); END;
  -- El XML firmado no cambia una vez que Hacienda lo recibió
  CREATE TRIGGER comprobantes_xml_inmutable BEFORE UPDATE OF xml_firmado ON comprobantes
  WHEN OLD.xml_firmado IS NOT NULL AND OLD.estado_hacienda NOT IN ('pendiente','error')
   AND NEW.xml_firmado IS NOT OLD.xml_firmado
  BEGIN SELECT RAISE(ABORT, 'El XML ya fue enviado a Hacienda: no se puede modificar'); END;
  -- La respuesta final de Hacienda (aceptado o rechazado) no se puede cambiar
  CREATE TRIGGER comprobantes_estado_final BEFORE UPDATE OF estado_hacienda ON comprobantes
  WHEN OLD.estado_hacienda IN ('aceptado','rechazado') AND NEW.estado_hacienda <> OLD.estado_hacienda
  BEGIN SELECT RAISE(ABORT, 'La respuesta de Hacienda es definitiva: no se puede cambiar'); END;
  CREATE TRIGGER comprobantes_respuesta_final BEFORE UPDATE OF hacienda_respuesta ON comprobantes
  WHEN OLD.hacienda_respuesta IS NOT NULL AND NEW.hacienda_respuesta IS NOT OLD.hacienda_respuesta
  BEGIN SELECT RAISE(ABORT, 'La respuesta de Hacienda es definitiva: no se puede cambiar'); END;
  `
];

module.exports = { MIGRACIONES };
