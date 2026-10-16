# Besalú Mercat POS

Punto de venta de escritorio para **Besalú Mercat — Minimarket Gourmet**.
Funciona **local** en Windows (sin internet), guarda todo en una base de datos
**SQLite** en la propia computadora y se **actualiza solo** desde GitHub.

- Una sola sede, una caja.
- Sin login: abre directo en la Caja.
- Arranca vacía, lista para cargar los productos del negocio.

---

## Índice

1. [Qué hace](#qué-hace)
2. [Estructura del proyecto](#estructura-del-proyecto)
3. [Cómo funciona por dentro](#cómo-funciona-por-dentro)
4. [Dónde se guardan los datos](#dónde-se-guardan-los-datos)
5. [Instalar en una caja (Windows)](#instalar-en-una-caja-windows)
6. [Trabajar en el código](#trabajar-en-el-código)
7. [Pruebas](#pruebas)
8. [Publicar una versión nueva](#publicar-una-versión-nueva)
9. [Rendimiento](#rendimiento)
10. [Atajos de teclado](#atajos-de-teclado)
11. [Pendientes](#pendientes)

---

## Qué hace

| Pantalla | Para qué sirve |
|---|---|
| **Caja** (F1) | Escanear o buscar productos, armar la venta, cobrar en efectivo (con cambio), tarjeta o SINPE. Cliente opcional (nombre + cédula) para facturar a nombre de alguien. Imprime el ticket. |
| **Ventas** (F2) | Historial de todas las ventas: ver/reimprimir el recibo, anular (devuelve el stock). |
| **Inventario** (F3) | Agregar, editar, reabastecer y eliminar productos. Calculadora de precio sugerido (costo + impuestos + envío + margen). Alertas de stock bajo y productos por vencer. Valor del inventario al costo. |
| **Reportes** (F4) | Ventas del mes y del día, gráfico de 14 días, más vendidos, resumen de IVA por tarifa y medios de pago. Todo calculado de las ventas reales. |
| **Cierre** (F5) | Abrir caja con fondo inicial, arqueo de efectivo (esperado vs. contado) y cierre con reporte Z. |
| **Ajustes** (F6) | Datos del negocio, impresora y ticket, alertas, exportar a CSV, respaldo JSON, borrar datos y "Acerca de" (versión + buscar actualizaciones). |

> La conexión con **Hacienda** (factura electrónica) está **desactivada** por ahora:
> el POS guarda los comprobantes internamente (qué se vendió y a quién).

---

## Estructura del proyecto

```
besalu-mercat-pos/
├── principal/                 ← "Cerebro" de la app (proceso principal de Electron)
│   ├── main.js                ← Abre la ventana, conecta la base de datos,
│   │                            imprime tickets y busca actualizaciones.
│   ├── baseDatos.js           ← Todo lo de SQLite: tablas, leer y guardar.
│   └── precarga.js            ← Puente seguro: lo único que la interfaz
│                                puede pedirle al sistema (window.BESALU).
│
├── interfaz/                  ← Lo que ve el cajero
│   ├── index.html             ← Estructura de la pantalla.
│   ├── estilos.css            ← Colores, tipografía, tamaños, impresión del ticket.
│   ├── app.js                 ← Lógica del POS: caja, ventas, inventario,
│   │                            reportes, cierre y ajustes.
│   ├── actualizaciones.js     ← Aviso "Versión X lista → Reiniciar y actualizar".
│   └── fuentes/               ← Tipografías locales (Inter y Playfair Display).
│
├── recursos/                  ← Archivos del instalador de Windows
│   ├── icono.png              ← Ícono de la app y del instalador.
│   ├── panel-instalador.bmp   ← Imagen lateral del asistente de instalación.
│   └── licencia.txt           ← Términos que se aceptan al instalar.
│
├── pruebas/
│   └── prueba-completa.js     ← Prueba de punta a punta con la app real.
│
├── .github/workflows/
│   └── release.yml            ← Compila el .exe en GitHub y publica el Release.
│
├── package.json               ← Dependencias, scripts y configuración del instalador.
├── GUIA-VERSIONES.md          ← Paso a paso para publicar actualizaciones.
├── DOCKER.md / Dockerfile     ← Compilar el .exe con Docker (opcional).
└── README.md                  ← Este archivo.
```

---

## Cómo funciona por dentro

```
┌──────────────── interfaz/ (lo que se ve) ────────────────┐
│  app.js mantiene los datos en memoria → pantallas rápidas │
│  Cada acción manda SOLO lo que cambió  ─────────┐         │
└─────────────────────────────────────────────────┼─────────┘
                       window.BESALU (precarga.js) │  IPC seguro
┌──────────────── principal/ (el sistema) ─────────▼─────────┐
│  main.js  →  baseDatos.js  →  besalu.sqlite (en disco)      │
│           →  impresora predeterminada de Windows            │
│           →  GitHub Releases (actualizaciones)              │
└─────────────────────────────────────────────────────────────┘
```

**Seguridad:** la interfaz no tiene acceso a Node ni a archivos
(`contextIsolation` activado, `nodeIntegration` apagado). Solo puede usar las
funciones de `window.BESALU`:

| Función | Qué hace |
|---|---|
| `BESALU.datos.cargar()` | Lee todo al abrir la app (una sola vez). |
| `BESALU.datos.guardarProducto(p)` | Crea o actualiza un producto. |
| `BESALU.datos.borrarProducto(cod)` | Elimina un producto. |
| `BESALU.datos.registrarVenta(venta, productos, consecutivo)` | Guarda la venta, el stock y el consecutivo **juntos** (si algo falla, no queda nada a medias). |
| `BESALU.datos.registrarAnulacion(folio, productos)` | Marca la venta anulada y devuelve el stock, juntos. |
| `BESALU.datos.guardarConfig(clave, valor)` | Ajustes, turno de caja, cierres y consecutivo. |
| `BESALU.datos.reiniciar()` | Borra todo (botón en Ajustes). |
| `BESALU.imprimir()` | Imprime el ticket en la impresora predeterminada, sin diálogo. |
| `BESALU.version()` | Versión instalada. |
| `BESALU.actualizaciones.*` | Escuchar, buscar e instalar actualizaciones. |

### Tablas de la base de datos (`besalu.sqlite`)

| Tabla | Contenido |
|---|---|
| `productos` | Código (clave), nombre, IVA, precio, costo, impuestos, envío, margen, stock, vencimiento, CABYS. |
| `ventas` | Folio (clave), comprobante, fecha, medio de pago, total, base, IVA, pago, cambio, anulada, cliente, desglose por tarifa y artículos. |
| `config` | `ajustes`, `turno`, `cierres`, `consecutivo` (en JSON). |

---

## Dónde se guardan los datos

En la carpeta del usuario de Windows, **nunca** en la carpeta de instalación:

```
%APPDATA%\Besalu Mercat POS\besalu.sqlite      ← base de datos
%APPDATA%\Besalu Mercat POS\logs\main.log      ← registro de errores
```

- Reinstalar o actualizar **no borra** los datos.
- Respaldo: **Ajustes → Respaldo JSON** (o copiar `besalu.sqlite` con la app cerrada).
- Exportar: **Ajustes → Exportar ventas / inventario** (CSV, se abre en Excel).

---

## Instalar en una caja (Windows)

1. Descargar el instalador más reciente:
   **https://github.com/ZakiCodeVault/besalu-mercat-pos/releases/latest**
   → `BesaluMercatPOS-Setup-X.Y.Z.exe`
2. Ejecutarlo y seguir el asistente (licencia → carpeta → instalar).
3. Mientras no esté firmado, Windows muestra *"Editor desconocido"*:
   tocar **Más información → Ejecutar de todos modos**.
4. Queda un acceso directo en el escritorio y en el menú Inicio.

Para la impresión del ticket, dejar la impresora térmica como
**impresora predeterminada** de Windows.

---

## Trabajar en el código

Requisitos: **Node.js 20+**.

```bash
npm install          # instala Electron y dependencias
npm run iniciar      # abre la app en modo desarrollo
npm run prueba       # corre la prueba completa
npm run dist         # genera el instalador (en Windows)
```

En modo desarrollo los datos se guardan en la carpeta de usuario del sistema
operativo donde se esté trabajando, y no se buscan actualizaciones.

---

## Pruebas

`npm run prueba` abre la **app real** con una base de datos temporal (no toca
datos del negocio) y hace lo mismo que un cajero:

1. Verifica que abre sin login, vacía, sin logo y con todos los estilos cargados.
2. Agrega un producto desde Inventario.
3. Abre caja, escanea 3 unidades, cobra en efectivo y revisa el cambio.
   Comprueba que al imprimir **solo sale el ticket** (no la pantalla).
4. Anula la venta (vuelve el stock) y vende otra con tarjeta buscando por nombre.
5. Cierra la caja (Z) y cambia un ajuste.
6. **Reinicia la app** y comprueba que todo quedó guardado en SQLite.
7. Carga 3.000 ventas y mide tiempos de guardado, apertura y reportes.

Resultado esperado: `✔ Todas las pruebas pasaron (21)`.

---

## Publicar una versión nueva

Resumen (detalle en **[GUIA-VERSIONES.md](GUIA-VERSIONES.md)**):

```bash
npm version patch          # 1.0.3 → 1.0.4 (crea commit y tag)
git push --follow-tags     # GitHub compila el .exe y crea el Release (borrador)
```

Luego en GitHub → **Releases** → abrir el borrador → **Publish release**.
Las cajas instaladas detectan la versión nueva (al abrir y cada 4 horas), la
descargan solas y muestran **"Reiniciar y actualizar"**.

---

## Rendimiento

Medido con `npm run prueba` sobre la app real:

| Acción | Tiempo |
|---|---|
| Abrir la app (vacía) | ~0,2 s |
| Abrir la app con 3.000+ ventas | ~60 ms |
| Registrar una venta en pantalla | ~2 ms |
| Guardar una venta en disco (en segundo plano) | ~10 ms |
| Abrir Reportes y Ventas con 3.000+ ventas | ~15 ms |

Qué se hizo para que sea rápida:

- **Guardado por fila**: cada acción escribe solo lo que cambió. Antes se
  reescribía toda la base en cada clic, y se volvía lenta con cada venta.
- **Sin efectos pesados de GPU**: se quitó el desenfoque de vidrio
  (`backdrop-filter`) y el fondo animado, que trababan equipos sin tarjeta
  gráfica dedicada.
- **Ajustes con guardado diferido**: se guardan 0,3 s después de dejar de escribir.
- **Fuentes locales**: no depende de internet para abrir.
- **Reloj cada 15 s** en vez de cada segundo.

¿Por qué Electron + JavaScript y no otro lenguaje? La lentitud no venía del
lenguaje sino de cómo se guardaban los datos y de los efectos visuales. Con
eso corregido, los tiempos de arriba están muy por debajo de lo que un cajero
puede notar, y se mantiene la actualización automática ya funcionando.

---

## Atajos de teclado

| Tecla | Acción |
|---|---|
| F1 – F6 | Caja, Ventas, Inventario, Reportes, Cierre, Ajustes |
| Enter (en el buscador) | Agregar el producto escaneado |
| Enter (buscador vacío) | Ir a cobrar |
| F12 | Cobrar |
| Esc | Cancelar la venta / cerrar ventana |

---

## Pendientes

- **Firma de código** (quita el aviso "Editor desconocido"): ver GUIA-VERSIONES.md.
- **Factura electrónica (Hacienda)**: desactivada por ahora.
- **Logo real** del negocio para el ícono y el instalador (`recursos/`).
- Envío automático de reportes por correo (la pantalla ya está, falta el servidor de correo).
