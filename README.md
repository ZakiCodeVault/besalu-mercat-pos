# Besalú Mercat POS · Facturación

Sistema de punto de venta y facturación para **Besalú Mercat — Minimarket Gourmet**
(Costa Rica). Funciona **local** en Windows, guarda todo en una base de datos
**SQLite** en la propia computadora, **envía cada comprobante directo a
Hacienda** (conexión propia, sin proveedor) y se **actualiza solo** desde GitHub.

- Una sede, una caja. Sin login.
- Registra **todas** las ventas (tiquetes, facturas y notas de crédito) y
  **todas** las compras a proveedores, con su inventario.
- Firma cada comprobante (XML 4.4 + firma XAdES-EPES con la llave
  criptográfica) y lo envía a la API de Hacienda en segundo plano. Si no hay
  internet la caja sigue vendiendo y los envía solos al volver la conexión.
- **Envía cada factura aceptada al correo del cliente** (PDF + XML firmado +
  respuesta de Hacienda), con reintentos si no hay internet.
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
9. [Hacienda: conexión propia](#hacienda-conexión-propia)
10. [Factura al correo del cliente](#factura-al-correo-del-cliente)
11. [Trabajar en el código](#trabajar-en-el-código)
12. [Pruebas](#pruebas)
13. [Publicar una versión nueva](#publicar-una-versión-nueva)
14. [Rendimiento](#rendimiento)
15. [Atajos de teclado](#atajos-de-teclado)
16. [Pendientes](#pendientes)

---

## Qué hace

| Pantalla | Para qué sirve |
|---|---|
| **Caja** (F1) | Escanear o buscar productos y cobrar en efectivo (con cambio), tarjeta o SINPE. Sin cliente emite un **tiquete**; con cliente (identificación + nombre) emite una **factura**. Cada comprobante sale con su **consecutivo** y **clave** de 50 dígitos. |
| **Ventas** (F2) | Todos los comprobantes emitidos, con su **estado en Hacienda** (pendiente, en validación, aceptado, rechazado). Ver, reimprimir, descargar el **XML firmado** y la **respuesta de Hacienda**, ver si la factura se **envió al correo del cliente** y **reenviarla**, emitir **nota de crédito** (anula la venta y devuelve el inventario) y **reemitir** un comprobante rechazado. Exportar a Excel. |
| **Compras** (F3) | Registrar las **facturas de proveedores**: a mano o **importando el XML** de la factura electrónica. Suma el inventario, actualiza el costo promedio y guarda el IVA pagado. Anular una compra mal registrada. |
| **Inventario** (F4) | Productos con CABYS, tarifa de IVA, costo, precio y existencia. **Kárdex** por producto (cada entrada y salida con su documento). Ajustes de inventario con motivo (conteo físico, merma, vencido…). Alertas de stock bajo y vencimientos. |
| **Reportes** (F5) | **IVA a pagar** del período (débito − crédito) y desglose por tarifa. Ventas netas, costo de lo vendido, utilidad, compras. **Entradas y salidas** de inventario. Ventas por día, medios de pago, más vendidos. Exportar ventas, compras e IVA a Excel. |
| **Cierre** (F6) | Turno de caja: fondo inicial, ventas por medio de pago, arqueo de efectivo (esperado vs. contado) y cierre con **reporte Z**. Al cerrar se hace un respaldo automático. |
| **Ajustes** (F7) | **Conexión con Hacienda** (ambiente, usuario y contraseña de la API, llave .p12 y PIN), **correo SMTP** para enviar las facturas, datos del negocio emisor (cédula, actividad económica, ubicación, sucursal, terminal), impresión, respaldos y restauración, verificación de integridad, bitácora y actualizaciones. |

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
| CABYS | 13 dígitos por producto. Con Hacienda activo, un producto sin CABYS no se puede vender (Inventario lo marca). |
| XML | Versión **4.4** de los Anexos y Estructuras, validado contra los XSD oficiales. Montos con 5 decimales: el IVA siempre es exactamente base × tarifa. |
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
- Cambiar el XML de un comprobante una vez que Hacienda lo recibió, o cambiar
  la respuesta de Hacienda (aceptado/rechazado es definitivo).
- Reemplazar un comprobante que no fue rechazado, o reemplazarlo dos veces.

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
│   └── hacienda/               ← Conexión propia con Hacienda
│       ├── catalogos.js        ← Códigos oficiales (tarifas, medios de pago, URLs…).
│       ├── xml.js              ← XML 4.4 de tiquete, factura y nota de crédito.
│       ├── firma.js            ← Llave .p12 y firma XAdES-EPES.
│       ├── api.js              ← Token del IdP, envío y consulta de estado.
│       ├── credenciales.js     ← Secretos cifrados con el sistema operativo.
│       ├── conector.js         ← Cola: firma, envía en orden, consulta, reintenta.
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
│   ├── hacienda.prueba.js      ← XML, firma, envío, rechazos, sin internet, producción.
│   ├── correo.prueba.js        ← Factura al correo: adjuntos, PDF, reintentos, TLS.
│   ├── prueba-completa.js      ← La app real de punta a punta.
│   ├── hacienda-simulada.js    ← Servidor que imita a Hacienda (verifica firma y XSD).
│   ├── smtp-simulado.js        ← Servidor de correo local (plano, SSL/TLS y STARTTLS).
│   ├── llave-prueba.js         ← Genera una llave .p12 falsa para probar.
│   └── esquemas/               ← XSD oficiales v4.4 de Hacienda.
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
| `comprobantes` / `comprobante_lineas` | Tiquetes, facturas y notas de crédito con consecutivo, clave, receptor, totales e IVA por línea. Estado en Hacienda, XML firmado y respuesta de Hacienda, el reemplazo de un rechazado y el estado del correo al cliente (columnas `correo_*`, aparte de las fiscales). |
| `compras` / `compra_lineas` | Facturas de proveedores con número, clave, fecha, subtotal, IVA, total y el XML original. |
| `movimientos` | Kárdex: cada entrada y salida de inventario con su documento. |
| `secuencias` | Último número usado por tipo de comprobante. |
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
| Envío | `POST https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1/recepcion` (pruebas) o `https://api.comprobanteselectronicos.go.cr/recepcion/v1/recepcion` (producción), con el XML firmado en Base64. |
| Firma | XAdES-EPES: C14N 1.0, RSA-SHA256, tres referencias SHA-256 (documento *enveloped*, KeyInfo, SignedProperties), política de firma de la *Resolución General sobre disposiciones técnicas* con su SHA-256. El XML se escribe ya canonicalizado. |
| Pruebas | `npm run prueba:hacienda`: el XML se valida contra los **XSD oficiales v4.4**, la firma se verifica con una librería independiente (`xml-crypto`) y se compara con la canonicalización de `xmllint`; todo el flujo (envío, rechazo, reemisión, sin internet, credenciales malas, paso a producción) se prueba contra un servidor que imita a Hacienda. |

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
npm run prueba            # las cuatro juntas
npm run prueba:datos      # 39 pruebas de reglas fiscales y protecciones
npm run prueba:hacienda   # 35 pruebas de la conexión con Hacienda
npm run prueba:correo     # 25 pruebas del envío de facturas por correo
npm run prueba:app        # 37 pruebas con la app real, de punta a punta
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

**`prueba:hacienda`** comprueba: que IVA = base × tarifa en 20 000 montos al
azar y que el total del XML es lo cobrado; la lectura de la llave y el PIN; que
tiquete, factura, nota de crédito y reemplazo cumplen el XSD oficial; que la
firma es válida y detecta cualquier cambio; que los secretos no quedan en texto
plano; las validaciones antes de emitir (CABYS, identificación del cliente,
datos del emisor); el envío en orden y la aceptación; el rechazo con su motivo
y la reemisión; el modo sin internet; contraseña incorrecta; error de esquema y
reintento; y el paso a producción.

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
registrar dos veces), abre caja, vende en efectivo con cambio, verifica que al
imprimir solo sale el comprobante, factura a un cliente por SINPE, emite una
nota de crédito, revisa el IVA y el balance en Reportes, cierra caja con Z,
comprueba que Hacienda aceptó todo y que la factura llegó sola al correo del
cliente (y que **Reenviar por correo** funciona), respalda, **reinicia la app** y comprueba
que todo quedó guardado e íntegro.

---

## Publicar una versión nueva

Resumen (detalle en **[GUIA-VERSIONES.md](GUIA-VERSIONES.md)**):

```bash
npm version patch          # 2.1.0 → 2.1.1 (crea commit y tag)
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

- **Primera prueba con el sandbox real de Hacienda** usando las credenciales
  de pruebas del negocio.
- **Primer envío real de correo** con el SMTP del dominio del negocio (Ajustes →
  Enviar correo de prueba) y revisar que no caiga en spam (SPF/DKIM).
- **Notas de crédito al correo del cliente**: hoy solo se envían las facturas.
- **Aceptar o rechazar las facturas de compra** ante Hacienda (Mensaje Receptor),
  para respaldar el crédito fiscal.
- **Firma de código** (quita el aviso "Editor desconocido"): ver GUIA-VERSIONES.md.
- **Logo real** del negocio para el ícono y el instalador (`recursos/`).
