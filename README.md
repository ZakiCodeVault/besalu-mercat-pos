# Besalú Mercat POS · Facturación

Sistema de punto de venta y facturación para **Besalú Mercat — Minimarket Gourmet**
(Costa Rica). Funciona **local** en Windows, guarda todo en una base de datos
**SQLite** en la propia computadora, **envía cada comprobante directo a
Hacienda** (conexión propia, sin proveedor) y se **actualiza solo** desde GitHub.

- Una sede, una caja. Sin login.
- Registra **todas** las ventas (tiquetes, facturas y notas de crédito) y
  **todas** las compras a proveedores, con su inventario.
- **Órdenes de compra** a proveedores: se piden, se mandan en PDF y la
  mercadería se recibe (en una o varias entregas) contra la orden; cada
  recepción suma al inventario y cada venta lo descuenta.
- **Copia completa** de todo en un solo archivo, que se puede **cargar** en
  esta u otra computadora, y **exportación de todo a Excel**.
- **Proveedores con sus productos**: al registrar una compra se elige el
  proveedor, se **escanea** cada producto y ya trae su costo; solo se pone la
  cantidad (y se puede cambiar el costo o el precio de venta ahí mismo).
- **Etiquetas** para la impresora **SAT TT448-2 USE** (USB o red): plantillas
  listas con **logo de la marca**, nombre, **SKU**, **código de barras** y precio.
- Firma cada comprobante (XML 4.4 + firma XAdES-EPES con la llave
  criptográfica) y lo envía a la API de Hacienda en segundo plano. Si no hay
  internet la caja sigue vendiendo y los envía solos al volver la conexión.
- **Envía cada factura aceptada al correo del cliente** (PDF + XML firmado +
  respuesta de Hacienda), con reintentos si no hay internet.
- **Acepta o rechaza ante Hacienda** las facturas electrónicas de los
  proveedores (Mensaje Receptor), lo que respalda su IVA como crédito fiscal.
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
9. [Órdenes de compra y entrada de mercadería](#órdenes-de-compra-y-entrada-de-mercadería)
10. [Proveedores y compra rápida](#proveedores-y-compra-rápida)
11. [Etiquetas (SAT TT448-2)](#etiquetas-sat-tt448-2)
12. [Hacienda: conexión propia](#hacienda-conexión-propia)
13. [Factura al correo del cliente](#factura-al-correo-del-cliente)
14. [Trabajar en el código](#trabajar-en-el-código)
15. [Pruebas](#pruebas)
16. [Publicar una versión nueva](#publicar-una-versión-nueva)
17. [Rendimiento](#rendimiento)
18. [Atajos de teclado](#atajos-de-teclado)
19. [Seguridad](#seguridad)
20. [Pendientes](#pendientes)

---

## Qué hace

| Pantalla | Para qué sirve |
|---|---|
| **Caja** (F1) | Escanear o buscar productos y cobrar en efectivo (con cambio), tarjeta o SINPE. Sin cliente emite un **tiquete**; con cliente (identificación + nombre) emite una **factura**. Cada comprobante sale con su **consecutivo** y **clave** de 50 dígitos. |
| **Ventas** (F2) | Todos los comprobantes emitidos, con su **estado en Hacienda** (pendiente, en validación, aceptado, rechazado). Ver, reimprimir, descargar el **XML firmado** y la **respuesta de Hacienda**, ver si la factura se **envió al correo del cliente** y **reenviarla**, emitir **nota de crédito** (anula la venta y devuelve el inventario) y **reemitir** un comprobante rechazado. Exportar a Excel. |
| **Compras** (F3) | Registrar las **facturas de proveedores**: a mano o **importando el XML** de la factura electrónica. Suma el inventario, actualiza el costo promedio y guarda el IVA pagado. **Aceptar** (total o parcial) o **rechazar** la factura ante Hacienda con el Mensaje Receptor, y ver su estado (columna *Hacienda*). Anular una compra mal registrada (si parte ya se vendió, avisa antes). **Órdenes de compra** (pestaña aparte): borrador → emitida con número `OC-00001` → recibida en una o varias entregas → cerrada; PDF para el proveedor y *Pedir lo que falta*. Ver [Órdenes de compra](#órdenes-de-compra-y-entrada-de-mercadería). **Proveedores** (pestaña aparte): ficha de cada uno con los productos que se le compran y su costo. |
| **Inventario** (F4) | Productos con CABYS, tarifa de IVA, costo, precio y existencia. **Kárdex** por producto (cada entrada y salida con su documento). Ajustes de inventario con motivo (conteo físico, merma, vencido…). Alertas de stock bajo y vencimientos. Lo que viene **en camino** en órdenes de compra y **Pedir lo que falta** (arma la orden con lo que está bajo el mínimo). **SKU** y **marca** de cada producto, con el **logo de la marca** para las etiquetas. |
| **Etiquetas** (F8) | Plantillas listas (producto con marca, precio de góndola, código de barras, oferta, vencimiento/lote) en 50 × 25, 40 × 30, 60 × 40, 100 × 50 mm u otro tamaño. Se escanean los productos, se ponen las copias y se imprime en la SAT TT448-2. Vista previa exacta de lo que sale. Ver [Etiquetas](#etiquetas-sat-tt448-2). |
| **Reportes** (F5) | **IVA a pagar** del período (débito − crédito) y desglose por tarifa. Ventas netas, costo de lo vendido, utilidad, compras. **Entradas y salidas** de inventario. Ventas por día, medios de pago, más vendidos. Exportar ventas, compras e IVA a Excel. |
| **Cierre** (F6) | Turno de caja: fondo inicial, ventas por medio de pago, arqueo de efectivo (esperado vs. contado) y cierre con **reporte Z**. Al cerrar se hace un respaldo automático. |
| **Ajustes** (F7) | **Conexión con Hacienda** (ambiente, usuario y contraseña de la API, llave .p12 y PIN), **correo SMTP** para enviar las facturas, datos del negocio emisor (cédula, actividad económica, ubicación, sucursal, terminal), impresión, respaldos y restauración, **copia completa** (exportar y cargar), **exportar todo a Excel**, verificación de integridad, bitácora y actualizaciones. |

---

## Reglas fiscales que aplica

| Tema | Cómo lo hace |
|---|---|
| Comprobantes | `04` tiquete electrónico, `01` factura electrónica, `03` nota de crédito. |
| Mensaje Receptor | Para las facturas de compra: `05` aceptación, `06` aceptación parcial, `07` rechazo, con su propio consecutivo de 20 dígitos (ver [Aceptar o rechazar facturas de compra](#aceptar-o-rechazar-facturas-de-compra-mensaje-receptor)). |
| Consecutivo (20 dígitos) | sucursal (3) + terminal (5) + tipo (2) + número (10). Cada tipo lleva su propia numeración, **sin saltos ni repetidos**. |
| Clave (50 dígitos) | 506 + fecha (ddmmaa) + cédula del emisor (12) + consecutivo (20) + situación (1) + código de seguridad (8). |
| Precios de venta | Incluyen IVA. El sistema separa base e impuesto por línea: `base = total ÷ (1 + tarifa)`. |
| Costos de compra | Sin IVA, como vienen en la factura del proveedor. |
| Tarifas de IVA | 0 %, 0,5 %, 1 %, 2 %, 4 %, 8 % y 13 %. |
| CABYS | 13 dígitos por producto. Con Hacienda activo, un producto sin CABYS no se puede vender (Inventario lo marca). |
| XML | Versión **4.4** de los Anexos y Estructuras, validado contra los XSD oficiales. Montos con 5 decimales: el IVA siempre es exactamente base × tarifa. |
| IVA a pagar | **IVA cobrado en ventas − IVA devuelto en notas de crédito − IVA pagado en compras vigentes.** Del crédito se descuenta lo que el Mensaje Receptor declaró sin crédito: facturas rechazadas, gasto corriente (condición 04) y la parte no acreditada de un crédito parcial (02). Si da negativo, es saldo a favor. Es la base para la declaración mensual: validala con el contador (proporcionalidad, gastos no deducibles, etc.). |
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
- Cambiar el XML de un comprobante una vez que Hacienda lo recibió, o cambiar
  la respuesta de Hacienda (aceptado/rechazado es definitivo).
- Reemplazar un comprobante que no fue rechazado, o reemplazarlo dos veces.
- Modificar o borrar un Mensaje Receptor, saltarse su consecutivo, tener dos
  mensajes en curso para la misma compra, mandarlo con una clave distinta a la
  de la compra, o aceptar una compra anulada.
- Cambiar la **existencia** de un producto sin un movimiento de kárdex (ni
  siquiera la existencia inicial al crearlo).
- Cambiar una orden de compra ya emitida, borrarla, cambiarle el número,
  emitirla vacía o con totales que no cuadran, saltarse estados (una cancelada
  no se reabre) o cancelarla con mercadería recibida.
- Registrar una recepción contra una orden que no está abierta, de otro
  proveedor, o con una línea que no es de esa orden.
- Repetir un SKU entre productos, o un código del proveedor dentro de su lista.
- Logos que no sean imagen PNG o que pasen de 400 KB.

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
│   ├── seguridad.js            ← Sandbox, origen del IPC, navegación, permisos y
│   │                             filtro de secretos en el registro.
│   ├── ipc.js                  ← Las operaciones que la interfaz puede pedir.
│   ├── precarga.js             ← Puente seguro: expone window.BESALU a la interfaz.
│   ├── exportar.js             ← Archivos CSV y el Excel con todo.
│   ├── xlsx.js                 ← Arma archivos .xlsx (sin dependencias).
│   ├── orden-pdf.js            ← Orden de compra en PDF para el proveedor.
│   ├── etiquetas.js            ← Impresora de etiquetas: configuración, comandos TSPL/ZPL
│   │                             y envío por USB (cola RAW de Windows) o por la red.
│   ├── datos/                  ← Toda la lógica de datos y reglas fiscales
│   │   ├── esquema.js          ← Tablas, restricciones y triggers de protección.
│   │   ├── conexion.js         ← Abrir/cerrar SQLite, ajustes, bitácora, integridad.
│   │   ├── montos.js           ← IVA por línea, consecutivo, clave, fechas.
│   │   ├── productos.js        ← Catálogo (con SKU y marca), ajustes de inventario y kárdex.
│   │   ├── marcas.js           ← Marcas y su logo para las etiquetas.
│   │   ├── proveedores.js      ← Ficha de proveedores y los productos que se le compran.
│   │   ├── ventas.js           ← Tiquetes, facturas y notas de crédito.
│   │   ├── compras.js          ← Facturas de proveedores, recepciones y anulaciones.
│   │   ├── ordenes.js          ← Órdenes de compra: borrador, emitir, avance, cerrar,
│   │   │                         cancelar, en camino y qué pedir.
│   │   ├── caja.js             ← Turnos, arqueo y cierre Z.
│   │   ├── reportes.js         ← IVA, balance, ventas, inventario, alertas.
│   │   ├── respaldos.js        ← Copias verificadas, copia completa y cargar una copia.
│   │   └── migracionV1.js      ← Importar productos de la versión 1.
│   └── hacienda/               ← Conexión propia con Hacienda
│       ├── catalogos.js        ← Códigos oficiales (tarifas, medios de pago, URLs…).
│       ├── xml.js              ← XML 4.4 de tiquete, factura y nota de crédito.
│       ├── receptor.js         ← Mensaje Receptor: lee la factura del proveedor y arma
│       │                         la aceptación o el rechazo.
│       ├── firma.js            ← Llave .p12 y firma XAdES-EPES.
│       ├── api.js              ← Token del IdP, envío y consulta de estado.
│       ├── credenciales.js     ← Secretos cifrados con el sistema operativo.
│       ├── conector.js         ← Colas (comprobantes y mensajes): firma, envía en orden,
│       │                         consulta, reintenta.
│       ├── correo.js           ← Factura aceptada → correo del cliente (SMTP, cola, reintentos).
│       └── pdf.js              ← Representación gráfica en hoja carta (PDF).
│
├── interfaz/                   ← Lo que ve el cajero
│   ├── index.html · estilos.css
│   ├── fuentes/                ← Tipografías locales (Inter y Playfair Display).
│   └── js/
│       ├── utilidades.js       ← Íconos, formato de colones, modales, confirmaciones.
│       ├── app.js              ← Arranque, navegación y atajos.
│       ├── caja.js · ventas.js · compras.js · inventario.js
│       ├── ordenes.js          ← Órdenes de compra: lista, borrador, detalle y recepción.
│       ├── proveedores.js      ← Ficha de proveedores y la elección del proveedor en compras.
│       ├── etiquetas.js        ← Plantillas, vista previa a 203 dpi, logos e impresión.
│       ├── codigo-barras.js    ← EAN-13, EAN-8, UPC-A y Code 128 (sin librerías).
│       ├── reportes.js · cierre.js · ajustes.js
│       ├── hacienda.js         ← Configuración (Hacienda y correo), indicador y estado
│       │                         por comprobante (incluido el correo al cliente).
│       ├── ticket.js           ← Comprobante y reporte Z para imprimir.
│       ├── graficos.js         ← Gráfico de ventas por día.
│       └── actualizaciones.js  ← Aviso "Versión X lista → Reiniciar y actualizar".
│
├── recursos/                   ← Ícono, imagen y licencia del instalador.
├── pruebas/
│   ├── datos.prueba.js         ← Reglas fiscales, protecciones, respaldos, velocidad.
│   ├── inventario.prueba.js    ← Órdenes de compra, recepciones, existencias, copias y Excel.
│   ├── etiquetas.prueba.js     ← Proveedores, marcas y SKU, códigos de barras, TSPL/ZPL y envío.
│   ├── hacienda.prueba.js      ← XML, firma, envío, rechazos, Mensaje Receptor, sin internet,
│   │                             producción.
│   ├── correo.prueba.js        ← Factura al correo: adjuntos, PDF, reintentos, TLS.
│   ├── app.prueba.js           ← La app real de punta a punta (incluye la seguridad de la pantalla).
│   └── apoyo/                  ← Lo que usan las pruebas (nada de esto va en el instalador)
│       ├── hacienda-simulada.js ← Servidor que imita a Hacienda (verifica firma y XSD).
│       ├── smtp-simulado.js    ← Servidor de correo local (plano, SSL/TLS y STARTTLS).
│       ├── llave-prueba.js     ← Genera una llave .p12 falsa para probar.
│       └── esquemas/           ← XSD oficiales v4.4 de Hacienda (incluye MensajeReceptor).
├── docs/
│   ├── GUIA-VERSIONES.md       ← Publicar versiones, actualizaciones y firma de código.
│   └── DOCKER.md               ← Compilar el .exe con Docker (alternativa).
├── .github/workflows/release.yml ← Prueba en Windows, compila el .exe y publica el Release.
├── Dockerfile · package.json · README.md
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
| `productos` | Código, SKU, nombre, marca, CABYS, unidad, tarifa IVA, precio (con IVA), costo promedio (sin IVA), existencia, mínimo, vencimiento. |
| `comprobantes` / `comprobante_lineas` | Tiquetes, facturas y notas de crédito con consecutivo, clave, receptor, totales e IVA por línea. Estado en Hacienda, XML firmado y respuesta de Hacienda, el reemplazo de un rechazado y el estado del correo al cliente (columnas `correo_*`, aparte de las fiscales). |
| `compras` / `compra_lineas` | Facturas de proveedores con número, clave, fecha, subtotal, IVA, total y el XML original. |
| `mensajes_receptor` | Aceptación o rechazo de cada factura de compra ante Hacienda: consecutivo, condición del IVA, montos tal como en la factura, estado en Hacienda, XML firmado y respuesta. |
| `ordenes_compra` / `orden_compra_lineas` | Órdenes a proveedores: número `OC-…`, estado (borrador, emitida, cerrada, cancelada), entrega esperada, productos, cantidades y costos. Lo recibido no se guarda aparte: sale de las compras vigentes ligadas a cada línea (vista `orden_compra_avance`), así que anular una recepción lo devuelve a pendiente solo. |
| `proveedor_productos` | Lo que se le compra a cada proveedor: último costo, fecha de la última compra y el código que usa el proveedor. Se llena solo con cada compra. |
| `marcas` | Marcas con su logo (PNG en grises, dentro de la base) y la intensidad con que se imprime. |
| `movimientos` | Kárdex: cada entrada y salida de inventario con su documento. La existencia de cada producto es la suma de sus movimientos. |
| `secuencias` · `secuencias_receptor` | Último número usado por tipo de comprobante (01, 03, 04) y de mensaje (05, 06, 07). |
| `turnos` | Turnos de caja con fondo, esperado, contado y diferencia. |
| `clientes` · `proveedores` | Se guardan solos al facturar o registrar compras. |
| `bitacora` | Registro de cada acción importante (no se puede borrar). |
| `config` | Ajustes del negocio, conexión con Hacienda y correo SMTP (secretos cifrados). |

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
- **Copia completa**: Ajustes → Respaldos → *Exportar copia completa…* guarda
  un solo archivo `.sqlite` con todo (ventas, compras, órdenes, inventario,
  clientes, proveedores y ajustes) donde usted elija (USB, OneDrive…). Se
  verifica al terminar.
- **Cargar una copia**: Ajustes → Respaldos → *Cargar una copia…* (en esta u
  otra computadora). Antes de cargarla revisa que sea una copia de esta app y
  de una versión compatible; una copia de una versión anterior se actualiza
  sola. El estado actual se guarda como `.antes-de-cargar` y, si algo falla,
  todo queda como estaba.
- **Exportar todo a Excel**: un `.xlsx` con una hoja por tema (resumen,
  productos, kárdex, ventas y sus líneas, compras y sus líneas, órdenes de
  compra, proveedores y clientes), con montos en colones y filtros.
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
   **actividad económica**, provincia, cantón, distrito, dirección, teléfono y
   correo, y tocar **Guardar cambios**. Sin cédula no se pueden emitir
   comprobantes.
2. Conectar **Hacienda** (ver la sección siguiente). Primero en **pruebas**.
3. **Inventario → Agregar producto** con su **CABYS** (o registrar la primera
   compra en **Compras**, que crea los productos nuevos).
4. **Caja → Abrir caja** con el fondo inicial, y a vender.

> Si venís de la versión 1, en Ajustes → **Versión anterior** aparece
> **Importar esos productos** (solo productos; las ventas viejas no se mezclan con la
> numeración nueva).

---

## Órdenes de compra y entrada de mercadería

El inventario solo cambia con movimientos del kárdex: **entra** con cada
compra (o recepción de una orden) y **sale** con cada venta; una nota de crédito
lo devuelve, anular una compra lo saca, y un conteo físico se registra como
ajuste con motivo.

1. **Pedir**: *Compras → Órdenes de compra → Nueva orden* (o *Pedir lo que
   falta*, que agrega los productos bajo su mínimo contando lo que ya viene en
   camino y sugiere pedir hasta el doble del mínimo). Elegir el proveedor,
   escanear o buscar productos, poner cantidades y costos. Un producto no se
   puede repetir en la misma orden.
2. **Borrador**: se guarda y se corrige cuantas veces haga falta; no cuenta como
   pedido ni tiene número.
3. **Emitir**: recibe su número (`OC-00001`, `OC-00002`…) y queda fija. Desde el
   detalle se guarda en **PDF** para mandarla al proveedor. Inventario muestra
   esas cantidades como **en camino**.
4. **Recibir mercadería**: abre la factura de compra con lo pendiente ya
   cargado y el proveedor fijo. Se pone lo que llegó de cada producto (0 si no
   vino) y se registra: entra al inventario, actualiza el costo promedio y la
   orden queda *Recibida en parte* o *Recibida*. Se puede recibir en varias
   entregas; también se puede *Leer XML de la factura* para tomar cantidades y
   montos exactos. Si llega **más** de lo pedido, pide confirmación. Al
   importar el XML de un proveedor con órdenes abiertas, pregunta si es la
   entrega de una de ellas.
5. **Terminar**: si el resto no va a llegar, *Cerrar con faltante* (con motivo).
   Si no llegó nada, *Cancelar orden*. Ambas quedan registradas.

Si una recepción se registró mal, se **anula la compra**: sale del inventario y
lo recibido vuelve a quedar pendiente en la orden. Si parte de esa mercadería ya
se vendió, avisa qué productos quedarían en negativo y pide confirmar.

---

## Proveedores y compra rápida

*Compras → Proveedores* tiene la ficha de cada proveedor: identificación,
nombre, teléfono, correo, contacto, días de crédito, dirección, notas y la
**lista de productos que se le compran** con su costo sin IVA (y, si lo usa, su
propio código para el producto). La lista se llena sola con cada compra y se
puede armar o corregir a mano.

Al registrar una compra (o una orden):

1. Escribir o elegir el **nombre o la cédula** del proveedor: se completan sus
   datos y se cargan sus productos.
2. **Escanear** cada producto que llegó: aparece con el costo de su lista y el
   cursor queda en la cantidad (Enter vuelve al escáner). Escanear otra vez el
   mismo producto suma 1. Un código que no existe abre la línea de producto
   nuevo con ese código.
3. Si cambió el costo, se corrige en la línea. El **precio de venta** también
   se puede cambiar ahí: muestra el margen y el precio anterior, y al registrar
   la compra queda guardado (y en la bitácora).

Al importar el XML de un proveedor, los productos que él factura con su propio
código se reconocen solos desde la segunda vez.

---

## Etiquetas (SAT TT448-2)

La sección **Etiquetas** (F8) imprime en la **SAT TT448-2 USE** (transferencia
térmica, 203 dpi, hasta 104 mm de ancho) en su propio lenguaje (**TSPL**; también
**ZPL**), sin pasar por el diálogo de impresión: cada punto sale exactamente
como en la vista previa.

**Primera vez:**

1. Instalar el driver de SAT que viene con la impresora (USB) o conectarla a la
   red y anotar su IP (sale en su hoja de configuración).
2. Calibrarla con el rollo puesto: mantener presionado **FEED** hasta que avance
   unas etiquetas.
3. *Etiquetas → Configurar impresora*: elegir **USB** (y la impresora de
   Windows) o **Cable de red** (IP y puerto 9100), el tamaño del rollo, la
   separación entre etiquetas (normalmente 2 mm) y la oscuridad.
4. **Etiqueta de prueba**: debe salir un marco completo, el texto y un código de
   barras que el lector de la caja lea como `123456789012`. Si sale corrida, se
   ajusta el corrimiento en mm.

**Imprimir:** elegir la plantilla y el tamaño, escanear los productos, poner las
copias e **Imprimir**. También se mandan desde **Inventario** (botón de
etiqueta en cada producto) o desde el detalle de una **compra** (una etiqueta
por unidad recibida).

| Plantilla | Lleva |
|---|---|
| Producto con marca | Logo de la marca, nombre, SKU, código de barras y precio con IVA en bloque negro |
| Precio de góndola | Nombre, precio muy grande, logo y banda "IVA incluido" con el SKU |
| Código de barras | Código de barras grande, nombre, precio y SKU |
| Oferta | Banda "OFERTA" con fecha límite, precio anterior tachado y precio de oferta |
| Vencimiento / lote | Fecha de vencimiento destacada, lote y SKU |

**Logo de la marca:** en la ficha del producto, *Marca* → **Logo de la marca…**.
Se carga una vez por marca (PNG, JPG, WEBP o SVG; mejor sobre fondo blanco): se
recorta, se pasa a grises y se ve cómo queda impreso en negro, con una barra de
**intensidad** para que no se pierda ni salga muy grueso.

**Códigos de barras:** se codifica exactamente el código del producto, para que
el lector de la caja lo lea igual: EAN-13, UPC-A o EAN-8 si el código es válido,
y Code 128 para códigos internos. Las barras nunca son más delgadas de 0,25 mm
(2 puntos); si en un tamaño chico no caben, la etiqueta se reacomoda o imprime
el número (y la vista previa lo avisa).

---

## Hacienda: conexión propia

El POS se conecta **directo** a la API de Comprobantes Electrónicos de Hacienda,
sin proveedor intermedio.

### Qué hace con cada venta

```
Cobrar ─▶ comprobante guardado (consecutivo + clave) ─▶ ticket impreso
                │  en segundo plano, sin frenar la caja
                ▼
        XML 4.4 ─▶ firma XAdES-EPES (llave .p12) ─▶ POST /recepcion
                                                      │
          aceptado ◀── consulta GET /recepcion/{clave} ┘
             │  factura con correo del cliente
             └─▶ correo: PDF + XML firmado + respuesta de Hacienda
          rechazado ─▶ se ve el motivo ─▶ "Reemitir comprobante"
```

- Se envía **en el orden** en que se emitió (Hacienda valida la secuencia).
- **Sin internet**: la venta no se detiene. El comprobante queda en cola, la
  clave de los siguientes lleva la situación **3 · sin internet** y todo se
  envía solo cuando vuelve la conexión (reintentos a los 30 s, 1, 2, 5, 10 y
  15 minutos).
- **Rechazado**: en Ventas se ve el motivo exacto que dio Hacienda. Después de
  corregir la causa (por ejemplo el CABYS o la actividad económica), el botón
  **Reemitir comprobante** emite uno nuevo con las mismas líneas y montos, un
  consecutivo nuevo y la referencia al rechazado (tipo 10, código 07). No mueve
  inventario ni caja, y en los reportes cuenta una sola vez.
- **Error de envío** (Hacienda no recibió el XML): se ve la causa y el botón
  **Reintentar envío** regenera el XML con los datos corregidos.
- Se guardan el **XML firmado** y la **respuesta firmada de Hacienda** de cada
  comprobante (Ventas → comprobante → *XML firmado* / *Respuesta de Hacienda*,
  con los nombres `clave.xml` y `clave_respuesta.xml` que pide Hacienda) y,
  en las facturas, se le envían al cliente por correo (ver
  [Factura al correo del cliente](#factura-al-correo-del-cliente)).
- El indicador de la barra superior dice si Hacienda está **al día**,
  **enviando**, **sin conexión** o si hay **comprobantes por revisar**.

### Aceptar o rechazar facturas de compra (Mensaje Receptor)

Cuando un proveedor le factura al negocio, el negocio confirma esa factura ante
Hacienda. Aceptarla es lo que **respalda su IVA como crédito fiscal**.

1. Registrar la compra en **Compras → Importar XML** (la factura electrónica que
   manda el proveedor). Una compra registrada a mano no se puede aceptar: el
   mensaje lleva los montos exactos de la factura.
2. Abrir la compra. En **Hacienda · Mensaje Receptor**:
   - **Aceptar ante Hacienda**: aceptación **total** (05) o **parcial** (06,
     con motivo). Se elige la **condición del IVA** (nota 18 del Anexo):
     01 genera crédito (todo), 02 crédito parcial (se indica el IVA a acreditar
     y el resto queda como gasto), 03 bienes de capital, 04 gasto corriente sin
     crédito, 05 proporcionalidad.
   - **Rechazar** (07), con el motivo. Si la mercadería no se recibió, además
     se **anula** la compra para sacarla del inventario. Una compra anulada se
     puede rechazar, pero no aceptar.
3. El mensaje se firma con la llave del negocio y se envía solo, en la misma
   cola que las ventas (también sin internet). La columna **Hacienda** de
   Compras muestra *Sin aceptar*, *En validación*, *Factura aceptada*,
   *Aceptada parcialmente* o *Factura rechazada*.
4. Si Hacienda **no acepta el mensaje** (por ejemplo, porque todavía no tiene
   la factura del proveedor), se ve el motivo y se puede enviar uno nuevo.

Reglas que aplica (Anexos y Estructuras v4.4):

| Campo | Cómo se llena |
|---|---|
| `Clave`, `NumeroCedulaEmisor`, `TotalFactura`, `MontoTotalImpuesto` | Tal cual vienen en el XML de la factura del proveedor (deben coincidir). |
| `NumeroCedulaReceptor` | La cédula del negocio. Si la factura está a nombre de otra cédula, no deja aceptarla. |
| `NumeroConsecutivoReceptor` | sucursal + terminal + `05`/`06`/`07` + número: cada tipo con su numeración. |
| `DetalleMensaje` | Obligatorio (5 a 160 caracteres) en aceptación parcial y rechazo. |
| `CodigoActividad` | La actividad económica del negocio (no va con proporcionalidad). |
| `CondicionImpuesto` · `MontoTotalImpuestoAcreditar` · `MontoTotalDeGastoAplicable` | Solo al aceptar una factura con IVA. Acreditar + gasto = total de la factura. No van en el rechazo, y con proporcionalidad (05) solo va la condición. |

Se guardan el **XML del mensaje** y la **respuesta de Hacienda**
(`clave-consecutivo.xml` y `clave-consecutivo_respuesta.xml`).

### Qué se necesita (todo sale de TRIBU-CR)

En la Oficina Virtual (OVi) de **TRIBU-CR**, con la cuenta del negocio:

1. Estar inscrito como emisor de comprobantes electrónicos, con **sistema
   propio** (en el XML va como *ProveedorSistemas* la misma cédula del negocio).
2. **Llave criptográfica de pruebas** (archivo `.p12`) y su **PIN**.
3. **Usuario y contraseña de pruebas** de la API
   (`cpj-…@stag.comprobanteselectronicos.go.cr`).
4. Más adelante, lo mismo **de producción** (`…@prod.comprobanteselectronicos.go.cr`).

### Pasos

1. **Ajustes → Facturación electrónica · Hacienda**: ambiente **Pruebas**,
   usuario, contraseña, **Elegir archivo .p12…**, PIN, activar **Enviar
   comprobantes a Hacienda** y **Guardar conexión**. Al guardar se abre la
   llave con el PIN y se muestra a quién pertenece y cuándo vence.
2. **Probar conexión** (pide un token a Hacienda).
3. Hacer ventas de prueba y revisar en **Ventas** que queden **Aceptado**.
4. Para facturar de verdad: **Empezar facturación real…**. Guarda la base de
   pruebas completa en la carpeta de respaldos (`archivo-pruebas-hacienda-….sqlite`)
   y arranca una base nueva con los mismos ajustes, productos (la existencia
   actual queda como inventario inicial), clientes y proveedores. Luego se
   ingresan las credenciales de **Producción**. La app no deja pasar a
   producción con comprobantes de pruebas en la base.

### Seguridad de las credenciales

- La contraseña, la llave `.p12` y el PIN se guardan **cifrados con la cuenta
  de Windows** (DPAPI, mediante `safeStorage` de Electron). En la base solo hay
  texto cifrado: copiada a otra computadora no se puede leer (allí hay que
  volver a ingresarlas).
- Nunca se escriben en la bitácora ni en el registro de errores.
- La interfaz no los recibe: el envío ocurre en el proceso principal.

### Detalle técnico

| | |
|---|---|
| Autenticación | OpenID Connect (Keycloak) con `grant_type=password`; realm `rut-stag` / cliente `api-stag` en pruebas, `rut` / `api-prod` en producción. El token se renueva con el *refresh token*. |
| Envío | `POST https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1/recepcion` (pruebas) o `https://api.comprobanteselectronicos.go.cr/recepcion/v1/recepcion` (producción), con el XML firmado en Base64. El Mensaje Receptor va con la clave y el emisor de la factura del proveedor, el negocio como receptor y su `consecutivoReceptor`; su estado se consulta en `GET /recepcion/{clave}-{consecutivoReceptor}`. |
| Firma | XAdES-EPES: C14N 1.0, RSA-SHA256, tres referencias SHA-256 (documento *enveloped*, KeyInfo, SignedProperties), política de firma de la *Resolución General sobre disposiciones técnicas* con su SHA-256. El XML se escribe ya canonicalizado. |
| Pruebas | `npm run prueba:hacienda`: el XML se valida contra los **XSD oficiales v4.4**, la firma se verifica con una librería independiente (`xml-crypto`) y se compara con la canonicalización de `xmllint`; todo el flujo (envío, rechazo, reemisión, Mensaje Receptor, sin internet, credenciales malas, paso a producción) se prueba contra un servidor que imita a Hacienda. |

> **Importante:** todo está probado contra los esquemas oficiales y un Hacienda
> simulado. La primera prueba con el **sandbox real** se hace con las
> credenciales de pruebas del negocio (Ajustes → Probar conexión y ventas de
> prueba) antes de pasar a producción.

---

## Factura al correo del cliente

Hacienda exige que el emisor le haga llegar al receptor la factura electrónica.
El POS lo hace solo: cuando Hacienda **acepta una factura** (`01`) y el cliente
dio su correo, se le envía desde el correo del negocio con tres adjuntos:

| Archivo | Qué es |
|---|---|
| `clave.pdf` | Representación gráfica en **hoja carta**: emisor, cliente, líneas con CABYS, desglose de IVA, clave numérica y estado en Hacienda. |
| `clave.xml` | El comprobante firmado, byte por byte el mismo que recibió Hacienda. |
| `clave_respuesta.xml` | La respuesta firmada de Hacienda (aceptación). |

```
Hacienda acepta la factura ─▶ correo en cola ─▶ SMTP del negocio ─▶ cliente
                                   │                                 (+ copia oculta al negocio)
     sin internet / servidor ocupado ─▶ se reintenta solo (30 s, 1, 2, 5, 10, 15, 30 min…)
     dirección inexistente (550) ─▶ "No enviado" ─▶ Reenviar por correo (a la dirección correcta)
```

- Solo facturas aceptadas. Tiquetes, notas de crédito, facturas rechazadas y
  facturas sin correo del cliente no se envían (en Ventas dice *El cliente no
  dio correo*).
- Si el correo todavía no está configurado, las facturas aceptadas quedan **en
  cola** y salen solas al configurarlo y activarlo. Las aceptadas antes de esta
  versión (2.1.0) no se envían solas: se mandan con **Enviar por correo**.
- La cola del correo es aparte de la de Hacienda: un servidor de correo lento o
  caído no atrasa el envío a Hacienda ni la caja.
- Usuario o contraseña incorrectos, certificado que no corresponde o remitente
  no permitido: se avisa en Ajustes, se reintenta cada 30 minutos y sale apenas
  se guarda la configuración corregida.
- **Ventas → comprobante** muestra el estado del correo (*Enviado*, *En cola*,
  *No enviado*) con la dirección, la fecha o el motivo, y el botón **Reenviar
  por correo**: pide la dirección (por defecto la del cliente) y la envía en el
  momento. El correo del cliente guardado en el comprobante es un dato fiscal y
  no cambia; la dirección usada queda aparte (`correo_destino`).
- Cada envío, error y reenvío queda en la bitácora.

### Configurar (Ajustes → Envío de facturas por correo)

Con los datos SMTP que da el proveedor del dominio o del hosting (cPanel, Zoho,
GoDaddy…):

| Campo | Normalmente |
|---|---|
| Servidor SMTP | `mail.sudominio.com`, o el que indique el proveedor (p. ej. `smtp.zoho.com`, `smtpout.secureserver.net`) |
| Puerto y seguridad | **465 con SSL/TLS** o **587 con STARTTLS** |
| Usuario | el correo completo, p. ej. `facturas@sudominio.com` |
| Contraseña | la del buzón |
| Correo remitente | vacío = el mismo usuario (muchos servidores no dejan enviar como otra dirección) |
| Nombre del remitente | vacío = el nombre comercial |
| Copia oculta al correo del negocio | activado: queda en el buzón del negocio una copia de cada factura enviada |

Después: **Guardar correo** y **Enviar correo de prueba** (llega al correo de
*Datos del negocio*, que también va como *Responder a* en cada factura).

- La contraseña se guarda **cifrada con la cuenta de Windows**, igual que las de
  Hacienda, y nunca se escribe en la bitácora.
- Con STARTTLS la conexión se cifra **antes** de mandar la contraseña; si el
  servidor no lo permite, no se manda. "Ninguna" solo para servidores de la red
  local (no recomendado).
- Si el certificado del servidor no corresponde al nombre escrito (pasa en
  hostings compartidos), use el nombre de servidor que muestra el panel del
  proveedor.
- **Empezar facturación real** conserva esta configuración.
- Para que las facturas no caigan en spam, el dominio debe tener **SPF y DKIM**
  (los configura el proveedor del dominio).

| | |
|---|---|
| Envío | `nodemailer` (sin otras dependencias), una conexión por correo. |
| PDF | HTML propio convertido con `printToPDF` de Chromium en una ventana oculta y sin JavaScript; fuentes incrustadas, se ve igual sin internet. |
| Base | Migración 3: columnas `correo_estado`, `correo_destino`, `correo_intentos`, `correo_error`, `correo_siguiente` y `correo_enviado_en` en `comprobantes`. Los triggers fiscales no cambian. |
| Pruebas | `npm run prueba:correo`, contra servidores SMTP simulados (texto plano, SSL/TLS y STARTTLS) y el Hacienda simulado. |

---

## Trabajar en el código

Requisitos: **Node.js 22 o más nuevo**. Usa **Electron 44** y `better-sqlite3`
13, que ya trae el módulo nativo compilado para Windows, macOS y Linux (no hace
falta compilar nada).

```bash
npm install --ignore-scripts   # dependencias (sin scripts de terceros)
npm run iniciar                # abre la app en modo desarrollo
npm run prueba                 # corre todas las pruebas
npm run dist                   # genera el instalador (en Windows)
```

La primera vez que se ejecuta Electron descarga su programa (~100 MB).

En modo desarrollo los datos se guardan en la carpeta de usuario del sistema
donde se esté trabajando, y no se buscan actualizaciones.

---

## Pruebas

```bash
npm run prueba            # las seis juntas (222 pruebas)
npm run prueba:datos      # 40 pruebas de reglas fiscales y protecciones
npm run prueba:inventario # 24 pruebas de órdenes de compra, existencias y copias
npm run prueba:etiquetas  # 19 pruebas de proveedores, marcas, códigos de barras e impresión
npm run prueba:hacienda   # 50 pruebas de la conexión con Hacienda
npm run prueba:correo     # 25 pruebas del envío de facturas por correo
npm run prueba:app        # 64 pruebas con la app real, de punta a punta
```

Todas usan una carpeta temporal y **no tocan** los datos del negocio. Las de
Hacienda usan una llave `.p12` falsa y un Hacienda simulado en la propia
computadora, y las de correo un servidor SMTP simulado: no se conectan a
Hacienda ni envían correos de verdad. Para validar contra los XSD se necesita
`xmllint` (viene en macOS y Linux; si no está, esa parte se omite y se avisa).

**`prueba:datos`** comprueba, entre otras cosas: que no se puede emitir sin
cédula; el IVA por línea en cada tarifa; consecutivos y claves; que una venta
fallida no consume consecutivo; que modificar o borrar comprobantes, compras o
movimientos es rechazado por la base; notas de crédito; compras duplicadas o con
fecha futura; montos exactos del XML; el reporte de IVA y el balance; el arqueo;
la detección y reparación de inventario; respaldos y restauración; y la
velocidad con 2.000 ventas.

**`prueba:inventario`** comprueba: borrador, emisión con número correlativo y
que una orden emitida no se puede cambiar ni borrar (ni con SQL directo);
recepciones parciales, de más (con confirmación), de otro proveedor, con líneas
o productos que no son de la orden, extras y factura repetida; que anular una
recepción la devuelve a pendiente y que avisa si quedaría inventario negativo;
cerrar con faltante y cancelar; *Pedir lo que falta*; que la existencia solo
cambia con el kárdex; **1 500 operaciones al azar** (compras, ventas, notas de
crédito, ajustes, órdenes, recepciones y anulaciones) comparadas contra un
modelo, con la existencia de cada producto igual a la suma de su kárdex; copia
completa, cargarla, archivo inválido, copia de una versión más nueva o anterior
y que si falla al abrirse todo queda como estaba; y el Excel con todas sus
hojas (leído con otro programa).

**`prueba:etiquetas`** comprueba: las validaciones de la ficha del proveedor
(largo de la cédula según su tipo, correo, días de crédito, repetidos); su lista
de productos (sin repetidos, códigos del proveedor únicos e intercambiables); que
cada compra deja el último costo en la lista sin que una factura vieja lo pise y
aprende el código del proveedor de su XML; el precio de venta cambiado al
recibir (y que una compra fallida no mueve nada); desactivar y reactivar;
*Pedir lo que falta* por proveedor; la migración que arma las listas con lo ya
comprado; marca por nombre, SKU sin repetir y el logo (solo PNG, tamaño máximo);
que la copia completa lleva todo eso; la tabla completa de Code 128 y la
estructura de EAN-13, EAN-8 y UPC-A; los comandos TSPL (imagen invertida, copias)
y ZPL exactos; las validaciones antes de imprimir; el envío por la red a una
impresora simulada (byte por byte) y el aviso si está apagada; y, en Windows, la
cola RAW por USB. Los códigos de barras generados también se leyeron con el
lector de códigos de macOS (EAN-13, EAN-8, UPC-A y Code 128 de varios largos).

**`prueba:hacienda`** comprueba: que IVA = base × tarifa en 20 000 montos al
azar y que el total del XML es lo cobrado; la lectura de la llave y el PIN; que
tiquete, factura, nota de crédito y reemplazo cumplen el XSD oficial; que la
firma es válida y detecta cualquier cambio; que los secretos no quedan en texto
plano; las validaciones antes de emitir (CABYS, identificación del cliente,
datos del emisor); el envío en orden y la aceptación; el rechazo con su motivo
y la reemisión; el Mensaje Receptor (aceptación total, parcial y rechazo con su
consecutivo propio, montos tomados de la factura del proveedor, XSD oficial y
firma, factura a nombre de otra cédula, compra registrada a mano o anulada,
mensaje rechazado por Hacienda y reenvío, protecciones de la base y su efecto en
el reporte de IVA); el modo sin internet; contraseña incorrecta; error de
esquema y reintento; y el paso a producción.

**`prueba:correo`** comprueba: que la migración agrega las columnas del correo
sin tocar las fiscales; que una factura aceptada sin correo configurado espera y
sale al configurarlo; las validaciones de servidor, puerto y seguridad; que la
contraseña queda cifrada y fuera de la bitácora; que cada factura aceptada llega
sola al cliente con copia oculta al negocio y los tres adjuntos **idénticos** a
lo guardado (la firma del XML adjunto sigue válida); que tiquetes, notas de
crédito, rechazadas y facturas sin correo no se envían; el PDF en hoja carta (y
en varias páginas si la factura es larga); sin internet, servidor ocupado (451),
contraseña incorrecta y dirección inexistente (550), con sus reintentos;
**Reenviar por correo** (a otra dirección y otra vez); SSL/TLS y STARTTLS reales
con certificado, que sin cifrado no se manda la contraseña y el aviso de
certificado que no corresponde; y que "Empezar facturación real" conserva la
configuración.

**`prueba:app`** hace lo mismo que el personal: configura el negocio, conecta
Hacienda y el correo desde Ajustes (con correo de prueba), crea un
producto, importa una factura de proveedor en XML (y comprueba que no se puede
registrar dos veces), la acepta ante Hacienda desde el detalle de la compra, abre caja, vende en efectivo con cambio, verifica que al
imprimir solo sale el comprobante, factura a un cliente por SINPE, emite una
nota de crédito, revisa el IVA y el balance en Reportes, cierra caja con Z,
comprueba que Hacienda aceptó todo (también el Mensaje Receptor) y que la factura
llegó sola al correo del cliente (y que **Reenviar por correo** funciona), respalda, **reinicia la app** y comprueba
que todo quedó guardado e íntegro. También verifica la seguridad de la pantalla:
sin Node, sin ventanas nuevas, sin conexión a internet, sin navegar a otra página
y que el sistema solo atiende pedidos de la pantalla del POS. Además recorre las
**órdenes de compra** desde la pantalla: crear, guardar borrador, emitir, PDF,
"en camino" en Inventario, recibir en dos entregas (una de más), anular una
recepción, cerrar con faltante, anular lo ya vendido (aviso de negativo),
*Pedir lo que falta*, exportar la copia completa y el Excel, y cargar la copia.
También crea un **proveedor** con su lista, registra una **compra escaneando**
(con su costo y cambiando el precio de venta), pone **SKU, marca y logo** a un
producto e imprime sus **etiquetas** desde Inventario a una impresora de red
simulada, revisando lo que le llega.
Con `BESALU_CAPTURAS=<carpeta>` guarda capturas de esas pantallas para
revisarlas.

Las mismas pruebas corren en **Windows** (GitHub Actions) antes de compilar cada
versión: si alguna falla, no se publica.

---

## Publicar una versión nueva

Resumen (detalle en **[docs/GUIA-VERSIONES.md](docs/GUIA-VERSIONES.md)**):

```bash
npm version patch          # 2.2.0 → 2.2.1 (crea commit y tag)
git push --follow-tags     # GitHub prueba, compila el .exe y crea el Release (borrador)
```

Luego en GitHub → **Releases** → abrir el borrador → **Publish release**.
Las cajas instaladas detectan la versión nueva (al abrir y **cada hora**), la
descargan solas y muestran **"Reiniciar y actualizar"**, además de una
**notificación de Windows** (se ve aunque la app esté minimizada).

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
| F8 | Etiquetas |
| Enter (en el buscador) | Agregar el producto escaneado |
| Enter (buscador vacío) | Ir a cobrar |
| F12 | Cobrar |
| Enter / Esc después de cobrar | Nueva venta |
| Esc | Cancelar la venta / cerrar ventana |

---

## Seguridad

**Datos y secretos**
- Contraseñas de Hacienda y del correo, llave `.p12` y PIN: **cifrados con la
  cuenta de Windows** (DPAPI). En la base solo hay texto cifrado; la pantalla
  solo sabe si están guardados, nunca su valor.
- Nada de eso va a la bitácora, y el registro de errores **tapa** cualquier
  token, contraseña, PIN o llave privada antes de escribirse.
- El repositorio no contiene llaves ni contraseñas (revisado en todo el
  historial). El `.gitignore` impide subir bases de datos, `.p12`, `.pem`,
  `.env` y similares. La firma de código va como secretos de GitHub.

**La aplicación**
- **Electron 44** (con parches de seguridad vigentes). Pantalla en **sandbox**,
  sin Node y con aislamiento de contexto.
- El sistema **solo atiende pedidos de la pantalla del POS**: cualquier otro
  origen que intente usar el IPC se rechaza y queda en el registro.
- La pantalla **no puede conectarse a internet**, navegar a otra página, abrir
  ventanas ni pedir permisos (cámara, ubicación…); todo pasa por el sistema.
  Política de contenido (CSP) estricta.
- En la app instalada no hay herramientas de desarrollador, y el ejecutable
  tiene apagadas las funciones peligrosas (*fuses*): no se puede usar como
  `node`, no acepta código por variables de entorno ni depuración, y solo carga
  su propio paquete, **verificado por integridad** al abrir.
- Hacienda, el correo y las actualizaciones usan HTTPS/TLS con verificación de
  certificado.

**La compilación**
- GitHub Actions instala sin scripts de terceros, revisa vulnerabilidades
  conocidas (`npm audit`) y corre las pruebas en Windows antes de compilar.
- Las acciones están fijadas a un commit exacto y el permiso de escritura solo
  lo tiene el paso que publica.

---

## Pendientes

- **Primera prueba con el sandbox real de Hacienda** usando las credenciales
  de pruebas del negocio (ventas y también un Mensaje Receptor de una factura
  real de un proveedor).
- **Primer envío real de correo** con el SMTP del dominio del negocio (Ajustes →
  Enviar correo de prueba) y revisar que no caiga en spam (SPF/DKIM).
- **Notas de crédito al correo del cliente**: hoy solo se envían las facturas.
- **Firma de código** (quita el aviso "Editor desconocido" y permite que Windows
  verifique cada actualización): ver [docs/GUIA-VERSIONES.md](docs/GUIA-VERSIONES.md).
- **Logo real** del negocio para el ícono y el instalador (`recursos/`).
- **Primera etiqueta en la SAT TT448-2 real**: configurarla, calibrar el rollo e
  imprimir la etiqueta de prueba (los comandos y los códigos de barras ya están
  verificados, falta confirmar en la impresora física la oscuridad y el corrimiento).
- **Avisos de SINPE Móvil (BAC)** en la caja para que la cajera confirme el
  pago: falta un correo de notificación real del banco (`.eml`) y el buzón donde
  llegan.
