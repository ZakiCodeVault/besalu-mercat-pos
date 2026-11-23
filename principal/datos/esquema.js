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
 *   - Los mensajes de receptor (aceptación/rechazo de compras ante Hacienda) no se
 *     modifican ni se borran y llevan su propio consecutivo (05, 06, 07).
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
  `,

  /* ===== Versión 3: envío de la factura al receptor por correo ===== */
  `
  -- Estado del correo al receptor (NULL = no corresponde o todavía no se encola).
  -- Son columnas aparte: las columnas fiscales del comprobante siguen inmutables.
  ALTER TABLE comprobantes ADD COLUMN correo_estado TEXT CHECK(correo_estado IN ('pendiente','enviado','error'));
  ALTER TABLE comprobantes ADD COLUMN correo_destino    TEXT;    -- dirección a la que se envía
  ALTER TABLE comprobantes ADD COLUMN correo_intentos   INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE comprobantes ADD COLUMN correo_error      TEXT;    -- último error (legible)
  ALTER TABLE comprobantes ADD COLUMN correo_siguiente  TEXT;    -- próximo intento (reintentos)
  ALTER TABLE comprobantes ADD COLUMN correo_enviado_en TEXT;    -- último envío correcto
  CREATE INDEX comprobantes_correo ON comprobantes(correo_estado) WHERE correo_estado IS NOT NULL;
  `,

  /* ===== Versión 4: Mensaje Receptor (aceptar o rechazar ante Hacienda las facturas de compra) ===== */
  `
  -- Consecutivos propios: 05 aceptación, 06 aceptación parcial, 07 rechazo
  CREATE TABLE secuencias_receptor(
    tipo   TEXT PRIMARY KEY CHECK(tipo IN ('05','06','07')),
    ultimo INTEGER NOT NULL DEFAULT 0 CHECK(ultimo >= 0)
  );
  INSERT INTO secuencias_receptor(tipo, ultimo) VALUES ('05', 0), ('06', 0), ('07', 0);
  CREATE TRIGGER secuencias_receptor_sin_saltos BEFORE UPDATE ON secuencias_receptor WHEN NEW.ultimo <> OLD.ultimo + 1
  BEGIN SELECT RAISE(ABORT, 'Consecutivo inválido: solo puede avanzar de 1 en 1'); END;
  CREATE TRIGGER secuencias_receptor_no_borrar BEFORE DELETE ON secuencias_receptor
  BEGIN SELECT RAISE(ABORT, 'Los consecutivos no se pueden borrar'); END;

  -- Montos con 5 decimales, como texto: son los de la factura del proveedor, tal cual van en el XML
  CREATE TABLE mensajes_receptor(
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    compra_id               INTEGER NOT NULL REFERENCES compras(id),
    tipo                    TEXT NOT NULL CHECK(tipo IN ('05','06','07')),
    numero                  INTEGER NOT NULL CHECK(numero > 0),
    consecutivo             TEXT NOT NULL UNIQUE CHECK(length(consecutivo) = 20 AND substr(consecutivo, 9, 2) = tipo),
    clave                   TEXT NOT NULL CHECK(length(clave) = 50),        -- clave de la factura del proveedor
    fecha_emision           TEXT NOT NULL,
    mensaje                 INTEGER NOT NULL CHECK(mensaje = CASE tipo WHEN '05' THEN 1 WHEN '06' THEN 2 ELSE 3 END),
    detalle                 TEXT CHECK(detalle IS NULL OR length(detalle) <= 160),
    emisor_tipo_id          TEXT NOT NULL,                                   -- el proveedor
    emisor_identificacion   TEXT NOT NULL,
    receptor_tipo_id        TEXT NOT NULL,                                   -- el negocio
    receptor_identificacion TEXT NOT NULL,
    codigo_actividad        TEXT,
    condicion_impuesto      TEXT CHECK(condicion_impuesto IS NULL OR condicion_impuesto IN ('01','02','03','04','05')),
    monto_impuesto          TEXT,
    impuesto_acreditar      TEXT,
    gasto_aplicable         TEXT,
    total_factura           TEXT NOT NULL,
    estado_hacienda         TEXT NOT NULL DEFAULT 'pendiente'
                              CHECK(estado_hacienda IN ('pendiente','enviado','aceptado','rechazado','error')),
    hacienda_intentos       INTEGER NOT NULL DEFAULT 0,
    hacienda_error          TEXT,
    hacienda_mensaje        TEXT,
    hacienda_respuesta      TEXT,
    hacienda_fecha          TEXT,
    hacienda_siguiente      TEXT,
    hacienda_ambiente       TEXT,
    xml_firmado             TEXT,
    creado_en               TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(tipo, numero),
    -- Aceptación parcial y rechazo llevan el motivo (Anexo v4.4: 5 a 160 caracteres)
    CHECK(tipo = '05' OR length(trim(coalesce(detalle, ''))) >= 5),
    -- El rechazo no acredita ni aplica nada
    CHECK(tipo <> '07' OR (condicion_impuesto IS NULL AND impuesto_acreditar IS NULL AND gasto_aplicable IS NULL))
  );
  CREATE INDEX mensajes_receptor_compra ON mensajes_receptor(compra_id);
  CREATE INDEX mensajes_receptor_estado ON mensajes_receptor(estado_hacienda);
  -- Una compra tiene un solo mensaje en curso; si Hacienda rechaza el mensaje se puede enviar otro
  CREATE UNIQUE INDEX mensajes_receptor_vigente ON mensajes_receptor(compra_id) WHERE estado_hacienda <> 'rechazado';

  CREATE TRIGGER mensajes_receptor_numero_valido BEFORE INSERT ON mensajes_receptor
  WHEN NEW.numero <> (SELECT ultimo FROM secuencias_receptor WHERE tipo = NEW.tipo)
  BEGIN SELECT RAISE(ABORT, 'El número del mensaje no coincide con el consecutivo'); END;
  CREATE TRIGGER mensajes_receptor_clave_compra BEFORE INSERT ON mensajes_receptor
  WHEN coalesce((SELECT clave FROM compras WHERE id = NEW.compra_id), '') <> NEW.clave
  BEGIN SELECT RAISE(ABORT, 'La clave del mensaje no es la de la factura de compra'); END;
  CREATE TRIGGER mensajes_receptor_compra_vigente BEFORE INSERT ON mensajes_receptor
  WHEN NEW.tipo <> '07' AND coalesce((SELECT estado FROM compras WHERE id = NEW.compra_id), '') <> 'vigente'
  BEGIN SELECT RAISE(ABORT, 'Una compra anulada no se puede aceptar ante Hacienda'); END;
  -- Inmutables: solo se puede actualizar el estado del envío a Hacienda
  CREATE TRIGGER mensajes_receptor_inmutables BEFORE UPDATE OF
    compra_id, tipo, numero, consecutivo, clave, fecha_emision, mensaje, detalle, emisor_tipo_id, emisor_identificacion,
    receptor_tipo_id, receptor_identificacion, codigo_actividad, condicion_impuesto, monto_impuesto, impuesto_acreditar,
    gasto_aplicable, total_factura, creado_en ON mensajes_receptor
  BEGIN SELECT RAISE(ABORT, 'Mensaje de receptor emitido: no se puede modificar'); END;
  CREATE TRIGGER mensajes_receptor_no_borrar BEFORE DELETE ON mensajes_receptor
  BEGIN SELECT RAISE(ABORT, 'Mensaje de receptor emitido: no se puede borrar'); END;
  CREATE TRIGGER mensajes_receptor_xml_inmutable BEFORE UPDATE OF xml_firmado ON mensajes_receptor
  WHEN OLD.xml_firmado IS NOT NULL AND OLD.estado_hacienda NOT IN ('pendiente','error')
   AND NEW.xml_firmado IS NOT OLD.xml_firmado
  BEGIN SELECT RAISE(ABORT, 'El XML ya fue enviado a Hacienda: no se puede modificar'); END;
  CREATE TRIGGER mensajes_receptor_estado_final BEFORE UPDATE OF estado_hacienda ON mensajes_receptor
  WHEN OLD.estado_hacienda IN ('aceptado','rechazado') AND NEW.estado_hacienda <> OLD.estado_hacienda
  BEGIN SELECT RAISE(ABORT, 'La respuesta de Hacienda es definitiva: no se puede cambiar'); END;
  CREATE TRIGGER mensajes_receptor_respuesta_final BEFORE UPDATE OF hacienda_respuesta ON mensajes_receptor
  WHEN OLD.hacienda_respuesta IS NOT NULL AND NEW.hacienda_respuesta IS NOT OLD.hacienda_respuesta
  BEGIN SELECT RAISE(ABORT, 'La respuesta de Hacienda es definitiva: no se puede cambiar'); END;
  `,

  /* ===== Versión 5: órdenes de compra a proveedores y protección del inventario ===== */
  `
  -- Orden de compra: borrador (se edita libremente) → emitida (se recibe la
  -- mercadería, en una o varias entregas) → cerrada (con faltante) o cancelada.
  -- El número se asigna al emitirla: los borradores no gastan números.
  CREATE TABLE ordenes_compra(
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    numero         INTEGER UNIQUE CHECK(numero IS NULL OR numero > 0),
    proveedor_id   INTEGER NOT NULL REFERENCES proveedores(id),
    estado         TEXT NOT NULL DEFAULT 'borrador' CHECK(estado IN ('borrador','emitida','cerrada','cancelada')),
    fecha_esperada TEXT NOT NULL DEFAULT '' CHECK(fecha_esperada = '' OR fecha_esperada GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    notas          TEXT NOT NULL DEFAULT '',
    subtotal       INTEGER NOT NULL DEFAULT 0 CHECK(subtotal >= 0),   -- estimado, sin IVA
    impuesto       INTEGER NOT NULL DEFAULT 0 CHECK(impuesto >= 0),
    total          INTEGER NOT NULL DEFAULT 0 CHECK(total = subtotal + impuesto),
    emitida_en     TEXT,
    terminada_en   TEXT,                                               -- al cerrarla o cancelarla
    motivo         TEXT,
    creado_en      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    actualizado_en TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    CHECK((estado = 'borrador') = (numero IS NULL)),
    CHECK(estado NOT IN ('cerrada','cancelada') OR length(trim(coalesce(motivo, ''))) > 0)
  );
  CREATE INDEX ordenes_compra_estado    ON ordenes_compra(estado);
  CREATE INDEX ordenes_compra_proveedor ON ordenes_compra(proveedor_id);

  CREATE TABLE orden_compra_lineas(
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    orden_id       INTEGER NOT NULL REFERENCES ordenes_compra(id),
    linea          INTEGER NOT NULL CHECK(linea > 0),
    producto_id    INTEGER NOT NULL REFERENCES productos(id),
    descripcion    TEXT NOT NULL CHECK(length(trim(descripcion)) > 0),
    cantidad       REAL NOT NULL CHECK(cantidad > 0),
    costo_unitario INTEGER NOT NULL CHECK(costo_unitario >= 0),       -- sin IVA (el pactado)
    tarifa_iva     REAL NOT NULL CHECK(tarifa_iva IN (0, 0.5, 1, 2, 4, 8, 13)),
    subtotal       INTEGER NOT NULL CHECK(subtotal >= 0),
    impuesto       INTEGER NOT NULL CHECK(impuesto >= 0),
    total_linea    INTEGER NOT NULL CHECK(total_linea = subtotal + impuesto),
    UNIQUE(orden_id, linea),
    UNIQUE(orden_id, producto_id)                                      -- cada producto una sola vez por orden
  );
  CREATE INDEX orden_compra_lineas_producto ON orden_compra_lineas(producto_id);

  -- Solo un borrador cambia sus líneas
  CREATE TRIGGER oc_lineas_agregar BEFORE INSERT ON orden_compra_lineas
  WHEN coalesce((SELECT estado FROM ordenes_compra WHERE id = NEW.orden_id), '') <> 'borrador'
  BEGIN SELECT RAISE(ABORT, 'La orden ya fue emitida: sus productos no se pueden cambiar'); END;
  CREATE TRIGGER oc_lineas_cambiar BEFORE UPDATE ON orden_compra_lineas
  WHEN coalesce((SELECT estado FROM ordenes_compra WHERE id = OLD.orden_id), '') <> 'borrador'
  BEGIN SELECT RAISE(ABORT, 'La orden ya fue emitida: sus productos no se pueden cambiar'); END;
  CREATE TRIGGER oc_lineas_quitar BEFORE DELETE ON orden_compra_lineas
  WHEN coalesce((SELECT estado FROM ordenes_compra WHERE id = OLD.orden_id), '') <> 'borrador'
  BEGIN SELECT RAISE(ABORT, 'La orden ya fue emitida: sus productos no se pueden cambiar'); END;

  -- Estados: borrador → emitida → cerrada | cancelada (nunca hacia atrás)
  CREATE TRIGGER oc_estados BEFORE UPDATE OF estado ON ordenes_compra
  WHEN NOT (NEW.estado = OLD.estado
         OR (OLD.estado = 'borrador' AND NEW.estado = 'emitida')
         OR (OLD.estado = 'emitida' AND NEW.estado IN ('cerrada','cancelada')))
  BEGIN SELECT RAISE(ABORT, 'Ese cambio de estado de la orden no está permitido'); END;
  CREATE TRIGGER oc_emitir BEFORE UPDATE OF estado ON ordenes_compra
  WHEN OLD.estado = 'borrador' AND NEW.estado = 'emitida' AND (
       NOT EXISTS (SELECT 1 FROM orden_compra_lineas WHERE orden_id = NEW.id)
    OR NEW.subtotal <> (SELECT sum(subtotal) FROM orden_compra_lineas WHERE orden_id = NEW.id)
    OR NEW.impuesto <> (SELECT sum(impuesto) FROM orden_compra_lineas WHERE orden_id = NEW.id))
  BEGIN SELECT RAISE(ABORT, 'La orden no tiene productos o sus totales no cuadran'); END;
  CREATE TRIGGER oc_cancelar BEFORE UPDATE OF estado ON ordenes_compra
  WHEN NEW.estado = 'cancelada' AND OLD.estado <> 'cancelada'
   AND EXISTS (SELECT 1 FROM compras WHERE orden_id = NEW.id AND estado = 'vigente')
  BEGIN SELECT RAISE(ABORT, 'La orden ya tiene mercadería recibida: ciérrela en vez de cancelarla'); END;
  CREATE TRIGGER oc_numero_inmutable BEFORE UPDATE OF numero ON ordenes_compra
  WHEN OLD.numero IS NOT NULL AND NEW.numero IS NOT OLD.numero
  BEGIN SELECT RAISE(ABORT, 'El número de la orden no se puede cambiar'); END;
  CREATE TRIGGER oc_emitida_inmutable BEFORE UPDATE OF proveedor_id, fecha_esperada, notas, subtotal, impuesto, total ON ordenes_compra
  WHEN OLD.estado <> 'borrador'
  BEGIN SELECT RAISE(ABORT, 'La orden ya fue emitida: no se puede modificar'); END;
  CREATE TRIGGER oc_no_borrar BEFORE DELETE ON ordenes_compra
  WHEN OLD.estado <> 'borrador'
  BEGIN SELECT RAISE(ABORT, 'Una orden emitida no se puede borrar (se cancela o se cierra)'); END;

  -- Cada recepción es una factura de compra ligada a la orden (y cada línea, a la línea pedida)
  ALTER TABLE compras ADD COLUMN orden_id INTEGER REFERENCES ordenes_compra(id);
  ALTER TABLE compra_lineas ADD COLUMN orden_linea_id INTEGER REFERENCES orden_compra_lineas(id);
  CREATE INDEX compras_orden ON compras(orden_id) WHERE orden_id IS NOT NULL;
  CREATE INDEX compra_lineas_orden_linea ON compra_lineas(orden_linea_id) WHERE orden_linea_id IS NOT NULL;
  CREATE TRIGGER compras_orden_inmutable BEFORE UPDATE OF orden_id ON compras
  BEGIN SELECT RAISE(ABORT, 'Compra registrada: no se puede modificar (anúlela y regístrela de nuevo)'); END;
  CREATE TRIGGER compras_orden_valida BEFORE INSERT ON compras
  WHEN NEW.orden_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM ordenes_compra WHERE id = NEW.orden_id AND estado = 'emitida' AND proveedor_id = NEW.proveedor_id)
  BEGIN SELECT RAISE(ABORT, 'La orden de compra no está abierta o es de otro proveedor'); END;
  CREATE TRIGGER compra_lineas_orden_valida BEFORE INSERT ON compra_lineas
  WHEN NEW.orden_linea_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM orden_compra_lineas ol JOIN compras c ON c.id = NEW.compra_id
    WHERE ol.id = NEW.orden_linea_id AND ol.orden_id = c.orden_id AND ol.producto_id = NEW.producto_id)
  BEGIN SELECT RAISE(ABORT, 'La línea recibida no corresponde a esa orden de compra'); END;

  -- Avance de cada línea: lo recibido sale de las compras vigentes. Si una
  -- recepción se anula, la orden vuelve a quedar pendiente sola.
  CREATE VIEW orden_compra_avance AS
    SELECT ol.id AS orden_linea_id, ol.orden_id, ol.producto_id, ol.cantidad AS pedido,
           round(coalesce(sum(CASE WHEN c.estado = 'vigente' THEN cl.cantidad END), 0), 3) AS recibido
    FROM orden_compra_lineas ol
    LEFT JOIN compra_lineas cl ON cl.orden_linea_id = ol.id
    LEFT JOIN compras c ON c.id = cl.compra_id
    GROUP BY ol.id;

  -- La existencia SOLO cambia con movimientos del kárdex (nunca escrita a mano)
  CREATE TRIGGER productos_stock_inicial BEFORE INSERT ON productos
  WHEN NEW.stock <> 0
  BEGIN SELECT RAISE(ABORT, 'La existencia inicial se registra como movimiento de inventario'); END;
  CREATE TRIGGER productos_stock_solo_kardex BEFORE UPDATE OF stock ON productos
  WHEN round(NEW.stock, 3) <> round(OLD.stock + coalesce((SELECT cantidad FROM movimientos WHERE producto_id = NEW.id ORDER BY id DESC LIMIT 1), 0), 3)
   AND round(NEW.stock, 3) <> round((SELECT coalesce(sum(cantidad), 0) FROM movimientos WHERE producto_id = NEW.id), 3)
  BEGIN SELECT RAISE(ABORT, 'La existencia solo cambia con movimientos de inventario (kárdex)'); END;
  `,

  /* ===== Versión 6: ficha de proveedores con sus productos, marcas con logo y SKU ===== */
  `
  ALTER TABLE proveedores ADD COLUMN nombre_comercial TEXT NOT NULL DEFAULT '';
  ALTER TABLE proveedores ADD COLUMN contacto TEXT NOT NULL DEFAULT '';
  ALTER TABLE proveedores ADD COLUMN direccion TEXT NOT NULL DEFAULT '';
  ALTER TABLE proveedores ADD COLUMN notas TEXT NOT NULL DEFAULT '';
  ALTER TABLE proveedores ADD COLUMN dias_credito INTEGER NOT NULL DEFAULT 0 CHECK(dias_credito BETWEEN 0 AND 365);
  ALTER TABLE proveedores ADD COLUMN activo INTEGER NOT NULL DEFAULT 1 CHECK(activo IN (0, 1));
  ALTER TABLE proveedores ADD COLUMN actualizado_en TEXT NOT NULL DEFAULT '';

  -- Lo que se le compra a cada proveedor, con el último costo (céntimos, sin IVA).
  -- Se llena solo con cada compra y también se arma a mano en la ficha del proveedor.
  CREATE TABLE proveedor_productos(
    proveedor_id     INTEGER NOT NULL REFERENCES proveedores(id),
    producto_id      INTEGER NOT NULL REFERENCES productos(id),
    codigo_proveedor TEXT NOT NULL DEFAULT '',
    costo            INTEGER NOT NULL DEFAULT 0 CHECK(costo >= 0),
    ultima_compra    TEXT NOT NULL DEFAULT '' CHECK(ultima_compra = '' OR ultima_compra GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    creado_en        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    actualizado_en   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    PRIMARY KEY(proveedor_id, producto_id)
  );
  CREATE INDEX proveedor_productos_producto ON proveedor_productos(producto_id);
  -- El código que usa el proveedor para un producto no se repite dentro de su lista
  CREATE UNIQUE INDEX proveedor_productos_codigo ON proveedor_productos(proveedor_id, codigo_proveedor) WHERE codigo_proveedor <> '';

  -- Marcas: el logo se carga una vez y lo usan todas las etiquetas de sus productos.
  -- Se guarda en la base (viaja en la copia completa) en escala de grises, ya reducido.
  CREATE TABLE marcas(
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre         TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK(length(trim(nombre)) > 0),
    logo           BLOB CHECK(logo IS NULL OR length(logo) <= 400000),
    umbral         INTEGER NOT NULL DEFAULT 128 CHECK(umbral BETWEEN 20 AND 235),
    creado_en      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    actualizado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  ALTER TABLE productos ADD COLUMN sku TEXT NOT NULL DEFAULT '';
  ALTER TABLE productos ADD COLUMN marca_id INTEGER REFERENCES marcas(id);
  CREATE INDEX productos_marca ON productos(marca_id);
  -- El SKU (código interno) es opcional, pero no se repite
  CREATE UNIQUE INDEX productos_sku ON productos(sku) WHERE sku <> '';

  -- Lo ya comprado: cada producto con el costo de su última factura vigente de ese proveedor
  INSERT INTO proveedor_productos(proveedor_id, producto_id, costo, ultima_compra)
    SELECT c.proveedor_id, cl.producto_id,
           (SELECT cl2.costo_unitario FROM compra_lineas cl2 JOIN compras c2 ON c2.id = cl2.compra_id
            WHERE c2.proveedor_id = c.proveedor_id AND cl2.producto_id = cl.producto_id AND c2.estado = 'vigente'
            ORDER BY c2.fecha DESC, c2.id DESC, cl2.linea DESC LIMIT 1),
           max(c.fecha)
    FROM compra_lineas cl JOIN compras c ON c.id = cl.compra_id
    WHERE cl.producto_id IS NOT NULL AND c.estado = 'vigente'
    GROUP BY c.proveedor_id, cl.producto_id;
  `,

  /* ===== Versión 7: usuarios con rol y relevos de cajero dentro del turno ===== */
  `
  -- Quien usa la app. Cada persona crea su propio PIN la primera vez que ingresa
  -- (mientras tanto pin_hash es NULL). Se guarda solo como hash (scrypt con sal propia).
  CREATE TABLE usuarios(
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre         TEXT NOT NULL CHECK(length(trim(nombre)) BETWEEN 1 AND 60),
    rol            TEXT NOT NULL CHECK(rol IN ('admin','encargado','cajero')),
    pin_hash       TEXT CHECK(pin_hash IS NULL OR length(pin_hash) = 64),
    pin_sal        TEXT CHECK(pin_sal IS NULL OR length(pin_sal) = 32),
    correo         TEXT NOT NULL DEFAULT '',
    activo         INTEGER NOT NULL DEFAULT 1 CHECK(activo IN (0, 1)),
    creado_en      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    actualizado_en TEXT NOT NULL DEFAULT '',
    ultimo_ingreso TEXT NOT NULL DEFAULT '',
    CHECK((pin_hash IS NULL) = (pin_sal IS NULL))
  );
  CREATE UNIQUE INDEX usuarios_nombre ON usuarios(nombre COLLATE NOCASE);
  -- Un usuario con historia no se borra: se desactiva
  CREATE TRIGGER usuarios_no_borrar BEFORE DELETE ON usuarios
  BEGIN SELECT RAISE(ABORT, 'Un usuario no se borra: se desactiva'); END;

  -- Tramos de caja: quién tuvo el efectivo de la caja y con cuánto empezó.
  -- Un relevo cierra el tramo del que sale (con lo contado) y abre el del que
  -- entra (recibe lo contado), sin cerrar el turno.
  CREATE TABLE caja_tramos(
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    turno_id    INTEGER NOT NULL REFERENCES turnos(id),
    usuario_id  INTEGER NOT NULL REFERENCES usuarios(id),
    inicio      TEXT NOT NULL,
    recibido    INTEGER NOT NULL CHECK(recibido >= 0),
    origen      TEXT NOT NULL DEFAULT 'apertura' CHECK(origen IN ('apertura','relevo','continuacion')),
    fin         TEXT,
    esperado    INTEGER,
    contado     INTEGER CHECK(contado IS NULL OR contado >= 0),
    diferencia  INTEGER,
    entrega_a   INTEGER REFERENCES usuarios(id),
    CHECK((fin IS NULL) = (contado IS NULL)),
    CHECK(fin IS NULL OR diferencia = contado - esperado)
  );
  CREATE UNIQUE INDEX caja_tramo_abierto ON caja_tramos(turno_id) WHERE fin IS NULL;
  CREATE INDEX caja_tramos_turno ON caja_tramos(turno_id);
  CREATE TRIGGER caja_tramos_cerrados BEFORE UPDATE ON caja_tramos WHEN OLD.fin IS NOT NULL
  BEGIN SELECT RAISE(ABORT, 'Tramo de caja cerrado: no se puede modificar'); END;
  CREATE TRIGGER caja_tramos_no_borrar BEFORE DELETE ON caja_tramos
  BEGIN SELECT RAISE(ABORT, 'Tramo de caja: no se puede borrar'); END;
  CREATE TRIGGER caja_tramos_turno_abierto BEFORE INSERT ON caja_tramos
  WHEN (SELECT cerrado_en FROM turnos WHERE id = NEW.turno_id) IS NOT NULL
  BEGIN SELECT RAISE(ABORT, 'El turno de caja ya está cerrado'); END;

  -- Quién hizo cada cosa (lo anterior a esta versión queda sin usuario)
  ALTER TABLE comprobantes ADD COLUMN usuario_id INTEGER REFERENCES usuarios(id);
  ALTER TABLE comprobantes ADD COLUMN tramo_id INTEGER REFERENCES caja_tramos(id);
  ALTER TABLE comprobantes ADD COLUMN autorizado_por INTEGER REFERENCES usuarios(id);
  ALTER TABLE compras ADD COLUMN usuario_id INTEGER REFERENCES usuarios(id);
  ALTER TABLE movimientos ADD COLUMN usuario_id INTEGER REFERENCES usuarios(id);
  ALTER TABLE turnos ADD COLUMN abierto_por INTEGER REFERENCES usuarios(id);
  ALTER TABLE turnos ADD COLUMN cerrado_por INTEGER REFERENCES usuarios(id);
  ALTER TABLE bitacora ADD COLUMN usuario TEXT NOT NULL DEFAULT '';
  CREATE TRIGGER comprobantes_usuario_inmutable BEFORE UPDATE OF usuario_id, tramo_id, autorizado_por ON comprobantes
  WHEN OLD.usuario_id IS NOT NEW.usuario_id OR OLD.tramo_id IS NOT NEW.tramo_id OR OLD.autorizado_por IS NOT NEW.autorizado_por
  BEGIN SELECT RAISE(ABORT, 'Comprobante emitido: no se puede cambiar quién lo hizo'); END;
  CREATE TRIGGER compras_usuario_inmutable BEFORE UPDATE OF usuario_id ON compras WHEN OLD.usuario_id IS NOT NEW.usuario_id
  BEGIN SELECT RAISE(ABORT, 'Compra registrada: no se puede cambiar quién la hizo'); END;
  CREATE INDEX comprobantes_turno ON comprobantes(turno_id);
  CREATE INDEX comprobantes_tramo ON comprobantes(tramo_id) WHERE tramo_id IS NOT NULL;
  CREATE INDEX comprobantes_usuario ON comprobantes(usuario_id) WHERE usuario_id IS NOT NULL;
  `
];

module.exports = { MIGRACIONES };
