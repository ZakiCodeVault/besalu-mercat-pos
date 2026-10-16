# Besalú Mercat POS · Facturación

Sistema de punto de venta y facturación para **Besalú Mercat — Minimarket Gourmet**
(Costa Rica). Funciona **local** en Windows, guarda todo en una base de datos
**SQLite** en la propia computadora y se **actualiza solo** desde GitHub.

- Una sede, una caja. Sin login.
- Registra **todas** las ventas (tiquetes, facturas y notas de crédito) y
  **todas** las compras a proveedores, con su inventario.
- Calcula en todo momento el **IVA a pagar a Hacienda** (lo cobrado en ventas
  menos lo pagado en compras) y el **balance de entradas y salidas**.
- Los datos fiscales **no se pueden modificar ni borrar**: la base de datos lo
  impide. Los errores se corrigen con documentos nuevos (nota de crédito,
  anulación de compra, ajuste de inventario), igual que en contabilidad.

---

## Índice

1. [Qué hace](#qué-hace)
2. [Reglas fiscales que aplica](#reglas-fiscales-que-aplica)
3. [Integridad de los datos](#integridad-de-los-datos)
4. [Estructura del proyecto](#estructura-del-proyecto)
5. [Cómo funciona por dentro](#cómo-funciona-por-dentro)
6. [Dónde se guardan los datos y respaldos](#dónde-se-guardan-los-datos-y-respaldos)
7. [Instalar en una caja (Windows)](#instalar-en-una-caja-windows)
8. [Primer uso](#primer-uso)
9. [Hacienda (factura electrónica)](#hacienda-factura-electrónica)
10. [Trabajar en el código](#trabajar-en-el-código)
11. [Pruebas](#pruebas)
12. [Publicar una versión nueva](#publicar-una-versión-nueva)
13. [Rendimiento](#rendimiento)
14. [Atajos de teclado](#atajos-de-teclado)
15. [Pendientes](#pendientes)

---

## Qué hace

| Pantalla | Para qué sirve |
|---|---|
| **Caja** (F1) | Escanear o buscar productos y cobrar en efectivo (con cambio), tarjeta o SINPE. Sin cliente emite un **tiquete**; con cliente (identificación + nombre) emite una **factura**. Cada comprobante sale con su **consecutivo** y **clave** de 50 dígitos. |
| **Ventas** (F2) | Todos los comprobantes emitidos, con búsqueda por consecutivo, cliente o cédula. Ver, reimprimir y emitir **nota de crédito** (anula la venta y devuelve el inventario). Exportar a Excel. |
| **Compras** (F3) | Registrar las **facturas de proveedores**: a mano o **importando el XML** de la factura electrónica. Suma el inventario, actualiza el costo promedio y guarda el IVA pagado. Anular una compra mal registrada. |
| **Inventario** (F4) | Productos con CABYS, tarifa de IVA, costo, precio y existencia. **Kárdex** por producto (cada entrada y salida con su documento). Ajustes de inventario con motivo (conteo físico, merma, vencido…). Alertas de stock bajo y vencimientos. |
| **Reportes** (F5) | **IVA a pagar** del período (débito − crédito) y desglose por tarifa. Ventas netas, costo de lo vendido, utilidad, compras. **Entradas y salidas** de inventario. Ventas por día, medios de pago, más vendidos. Exportar ventas, compras e IVA a Excel. |
| **Cierre** (F6) | Turno de caja: fondo inicial, ventas por medio de pago, arqueo de efectivo (esperado vs. contado) y cierre con **reporte Z**. Al cerrar se hace un respaldo automático. |
| **Ajustes** (F7) | Datos del negocio emisor (cédula, sucursal, terminal), impresión, respaldos y restauración, verificación de integridad, bitácora, estado de Hacienda y actualizaciones. |

---

## Reglas fiscales que aplica

| Tema | Cómo lo hace |
|---|---|
| Comprobantes | `04` tiquete electrónico, `01` factura electrónica, `03` nota de crédito. |
| Consecutivo (20 dígitos) | sucursal (3) + terminal (5) + tipo (2) + número (10). Cada tipo lleva su propia numeración, **sin saltos ni repetidos**. |
| Clave (50 dígitos) | 506 + fecha (ddmmaa) + cédula del emisor (12) + consecutivo (20) + situación (1) + código de seguridad (8). |
| Precios de venta | Incluyen IVA. El sistema separa base e impuesto por línea: `base = total ÷ (1 + tarifa)`. |
| Costos de compra | Sin IVA, como vienen en la factura del proveedor. |
| Tarifas de IVA | 0 %, 0,5 %, 1 %, 2 %, 4 %, 8 % y 13 %. |
| CABYS | 13 dígitos por producto (opcional al crear, necesario para Hacienda). |
| IVA a pagar | **IVA cobrado en ventas − IVA devuelto en notas de crédito − IVA pagado en compras vigentes.** Si da negativo, es saldo a favor. Es la base para la declaración mensual: validala con el contador (proporcionalidad, gastos no deducibles, etc.). |
| Inventario | Costo promedio ponderado. Cada movimiento (inicial, compra, venta, nota de crédito, ajuste, anulación) queda en el kárdex. |
| Dinero | Se guarda en **céntimos enteros** (₡1 250,50 = 125050): sin errores de redondeo. |

---

## Integridad de los datos

La protección está **en la base de datos**, no solo en la pantalla. Aunque
alguien abra el archivo con otro programa, SQLite rechaza:

- Modificar o borrar comprobantes, sus líneas, compras, movimientos de
  inventario, turnos cerrados o la bitácora.
- Saltarse o repetir un consecutivo (solo avanza de 1 en 1).
- Totales que no cuadran (gravado + exento = venta; venta + impuesto = total).
- Registrar dos veces la misma factura de compra (mismo proveedor y número, o
  misma clave).
- Facturas de compra con fecha futura.
- Tener dos turnos de caja abiertos.

Además:

- Cada venta se guarda en **una sola transacción** (comprobante, líneas,
  inventario, consecutivo y bitácora): o se guarda todo o nada. Si una venta
  falla, **no consume** consecutivo.
- La existencia de cada producto la calcula la base a partir del kárdex.
- `journal_mode=WAL` + `synchronous=FULL`: un apagón no corrompe la base.
- Al abrir la app se verifica la integridad (archivo, kárdex y consecutivos).
  Si el archivo estuviera dañado, ofrece restaurar el último respaldo.
- La interfaz **no tiene acceso** a la base: solo puede pedir operaciones
  permitidas (vender, registrar compra, etc.).

---

## Estructura del proyecto

```
besalu-mercat-pos/
├── principal/                  ← El sistema (proceso principal de Electron)
│   ├── main.js                 ← Abre la ventana y la base, imprime, respaldo diario,
│   │                             actualizaciones.
│   ├── ipc.js                  ← Las operaciones que la interfaz puede pedir.
│   ├── precarga.js             ← Puente seguro: expone window.BESALU a la interfaz.
│   ├── exportar.js             ← Archivos CSV para Excel.
│   ├── datos/                  ← Toda la lógica de datos y reglas fiscales
│   │   ├── esquema.js          ← Tablas, restricciones y triggers de protección.
│   │   ├── conexion.js         ← Abrir/cerrar SQLite, ajustes, bitácora, integridad.
│   │   ├── montos.js           ← IVA por línea, consecutivo, clave, fechas.
│   │   ├── productos.js        ← Catálogo, ajustes de inventario y kárdex.
│   │   ├── ventas.js           ← Tiquetes, facturas y notas de crédito.
│   │   ├── compras.js          ← Facturas de proveedores y anulaciones.
│   │   ├── caja.js             ← Turnos, arqueo y cierre Z.
│   │   ├── reportes.js         ← IVA, balance, ventas, inventario, alertas.
│   │   ├── respaldos.js        ← Copias verificadas y restauración.
│   │   └── migracionV1.js      ← Importar productos de la versión 1.
│   └── hacienda/
│       └── conector.js         ← Cola de envío a Hacienda (lista para el proveedor).
│
├── interfaz/                   ← Lo que ve el cajero
│   ├── index.html · estilos.css
│   ├── fuentes/                ← Tipografías locales (Inter y Playfair Display).
│   └── js/
│       ├── utilidades.js       ← Íconos, formato de colones, modales, confirmaciones.
│       ├── app.js              ← Arranque, navegación y atajos.
│       ├── caja.js · ventas.js · compras.js · inventario.js
│       ├── reportes.js · cierre.js · ajustes.js
│       ├── ticket.js           ← Comprobante y reporte Z para imprimir.
│       ├── graficos.js         ← Gráfico de ventas por día.
│       └── actualizaciones.js  ← Aviso "Versión X lista → Reiniciar y actualizar".
│
├── recursos/                   ← Ícono, imagen y licencia del instalador.
├── pruebas/
│   ├── datos.prueba.js         ← Reglas fiscales, protecciones, respaldos, velocidad.
│   └── prueba-completa.js      ← La app real de punta a punta.
├── .github/workflows/release.yml ← Compila el .exe en GitHub y publica el Release.
├── package.json · GUIA-VERSIONES.md · DOCKER.md · README.md
```

---

## Cómo funciona por dentro

```
┌───────────── interfaz/ (pantallas) ─────────────┐
│  Pide operaciones: "emitir venta", "registrar    │
│  compra", "reporte de IVA"…  (window.BESALU)     │
└──────────────────────┬──────────────────────────┘
                       │ IPC seguro (precarga.js → ipc.js)
┌──────────────────────▼──────────────────────────┐
│  principal/datos/  →  reglas fiscales + validación │
│        │  una transacción por operación            │
│        ▼                                           │
│  besalu-facturacion.sqlite  (triggers protegen     │
│  los datos fiscales)  →  respaldos/ (verificados)  │
└────────────────────────────────────────────────────┘
```

La interfaz manda solo **qué** se vende (producto y cantidad). Los precios, el
IVA, el consecutivo y la clave los calcula el sistema con los datos de la base.

### Tablas principales

| Tabla | Contenido |
|---|---|
| `productos` | Código, nombre, CABYS, unidad, tarifa IVA, precio (con IVA), costo promedio (sin IVA), existencia, mínimo, vencimiento. |
| `comprobantes` / `comprobante_lineas` | Tiquetes, facturas y notas de crédito con consecutivo, clave, receptor, totales e IVA por línea. Estado de Hacienda. |
| `compras` / `compra_lineas` | Facturas de proveedores con número, clave, fecha, subtotal, IVA, total y el XML original. |
| `movimientos` | Kárdex: cada entrada y salida de inventario con su documento. |
| `secuencias` | Último número usado por tipo de comprobante. |
| `turnos` | Turnos de caja con fondo, esperado, contado y diferencia. |
| `clientes` · `proveedores` | Se guardan solos al facturar o registrar compras. |
| `bitacora` | Registro de cada acción importante (no se puede borrar). |
| `config` | Ajustes del negocio. |

---

## Dónde se guardan los datos y respaldos

En la carpeta del usuario de Windows, **nunca** en la carpeta de instalación:

```
%APPDATA%\Besalu Mercat POS\besalu-facturacion.sqlite   ← base de datos
%APPDATA%\Besalu Mercat POS\respaldos\                  ← copias automáticas
%APPDATA%\Besalu Mercat POS\logs\main.log               ← registro de errores
```

- **Respaldos automáticos**: uno al día y otro en cada cierre de caja. Se
  guardan los últimos 60, y cada copia se verifica al crearla.
- **Copia extra** (recomendado): en Ajustes → Respaldos → *Carpeta extra…*
  elegí una carpeta de OneDrive/Google Drive o una USB; cada respaldo se copia
  también ahí.
- **Restaurar**: Ajustes → Respaldos. Antes de restaurar se guarda una copia
  del estado actual.
- Reinstalar o actualizar la app **no borra** los datos.

---

## Instalar en una caja (Windows)

1. Descargar el instalador más reciente:
   **https://github.com/ZakiCodeVault/besalu-mercat-pos/releases/latest**
   → `BesaluMercatPOS-Setup-X.Y.Z.exe`
2. Ejecutarlo y seguir el asistente (licencia → carpeta → instalar).
3. Mientras no esté firmado, Windows muestra *"Editor desconocido"*:
   tocar **Más información → Ejecutar de todos modos**.
4. Queda un acceso directo en el escritorio y en el menú Inicio.

Para imprimir, dejar la impresora térmica como **impresora predeterminada**
de Windows.

## Primer uso

1. La app abre en **Ajustes**: completar nombre, **cédula** del negocio,
   teléfono, correo y dirección, y tocar **Guardar cambios**. Sin cédula no se
   pueden emitir comprobantes.
2. **Inventario → Agregar producto** (o registrar la primera compra en
   **Compras**, que crea los productos nuevos).
3. **Caja → Abrir caja** con el fondo inicial, y a vender.

> Si venís de la versión 1, en Ajustes → **Versión anterior** aparece
> **Importar esos productos** (solo productos; las ventas viejas no se mezclan con la
> numeración nueva).

---

## Hacienda (factura electrónica)

Hoy el sistema **genera** cada comprobante con su consecutivo y clave y lo deja
**pendiente de envío**. Todavía **no se envía** a Hacienda, por lo que esos
comprobantes no tienen validez fiscal hasta conectar un proveedor.

Cuando se contrate un proveedor de facturación (o se active el ATV directo),
se completa `principal/hacienda/conector.js`: firma el XML, lo envía y guarda la
respuesta (aceptado/rechazado). La cola respeta el orden de los consecutivos y
solo actualiza el estado, nunca los datos del comprobante.

---

## Trabajar en el código

Requisitos: **Node.js 20 o 22** (la base usa `better-sqlite3`, un módulo nativo
que se compila para Electron).

```bash
npm install          # instala dependencias y compila better-sqlite3 para Electron
npm run iniciar      # abre la app en modo desarrollo
npm run prueba       # corre todas las pruebas
npm run dist         # genera el instalador (en Windows)
```

Si `npm install` falla al compilar `better-sqlite3` (por ejemplo con una versión
de Node muy nueva):

```bash
npm install --ignore-scripts
npx @electron/rebuild -v 33.4.11 -w better-sqlite3
```

En modo desarrollo los datos se guardan en la carpeta de usuario del sistema
donde se esté trabajando, y no se buscan actualizaciones.

---

## Pruebas

```bash
npm run prueba:datos   # 39 pruebas de reglas fiscales y protecciones
npm run prueba:app     # 27 pruebas con la app real, de punta a punta
```

Las dos usan una carpeta temporal y **no tocan** los datos del negocio.

**`prueba:datos`** comprueba, entre otras cosas: que no se puede emitir sin
cédula; el IVA por línea en cada tarifa; consecutivos y claves; que una venta
fallida no consume consecutivo; que modificar o borrar comprobantes, compras o
movimientos es rechazado por la base; notas de crédito; compras duplicadas o con
fecha futura; montos exactos del XML; el reporte de IVA y el balance; el arqueo;
la detección y reparación de inventario; respaldos y restauración; y la
velocidad con 2.000 ventas.

**`prueba:app`** hace lo mismo que el personal: configura el negocio, crea un
producto, importa una factura de proveedor en XML (y comprueba que no se puede
registrar dos veces), abre caja, vende en efectivo con cambio, verifica que al
imprimir solo sale el comprobante, factura a un cliente por SINPE, emite una
nota de crédito, revisa el IVA y el balance en Reportes, cierra caja con Z,
respalda, **reinicia la app** y comprueba que todo quedó guardado e íntegro.

---

## Publicar una versión nueva

Resumen (detalle en **[GUIA-VERSIONES.md](GUIA-VERSIONES.md)**):

```bash
npm version patch          # 2.0.0 → 2.0.1 (crea commit y tag)
git push --follow-tags     # GitHub compila el .exe y crea el Release (borrador)
```

Luego en GitHub → **Releases** → abrir el borrador → **Publish release**.
Las cajas instaladas detectan la versión nueva (al abrir y cada 4 horas), la
descargan solas y muestran **"Reiniciar y actualizar"**.

---

## Rendimiento

Medido con las pruebas:

| Acción | Tiempo |
|---|---|
| Emitir una venta (comprobante + inventario + bitácora, guardado en disco) | ~0,5 ms |
| Abrir la app con 1.000+ ventas | ~70 ms |
| Todos los reportes sobre 2.000+ ventas | ~8 ms |
| Recorrer todas las pantallas | ~35 ms |

---

## Atajos de teclado

| Tecla | Acción |
|---|---|
| F1 – F7 | Caja, Ventas, Compras, Inventario, Reportes, Cierre, Ajustes |
| Enter (en el buscador) | Agregar el producto escaneado |
| Enter (buscador vacío) | Ir a cobrar |
| F12 | Cobrar |
| Enter / Esc después de cobrar | Nueva venta |
| Esc | Cancelar la venta / cerrar ventana |

---

## Pendientes

- **Proveedor de Hacienda**: conectar el envío de comprobantes (ver arriba).
- **Firma de código** (quita el aviso "Editor desconocido"): ver GUIA-VERSIONES.md.
- **Logo real** del negocio para el ícono y el instalador (`recursos/`).
