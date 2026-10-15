# Besalu Mercat POS - App de escritorio (Windows)

Punto de venta local de Besalu Mercat empaquetado con Electron. Toda la
informacion (productos, ventas, clientes, ajustes) se guarda en la propia
maquina, en la carpeta de datos del usuario de Windows (no en la carpeta de
instalacion), y funciona sin internet.

## Que hay aqui

- `main.js` - proceso principal de Electron (abre la ventana del POS).
- `preload.js` - puente seguro (contextIsolation activado).
- `renderer/index.html` - la aplicacion POS completa.
- `package.json` - dependencias y configuracion del instalador (electron-builder).
- `build/` - aqui va el icono `icon.ico` (ver nota dentro).

## Probar la app (en cualquier PC con Node 18+)

```
npm install
npm start
```

## Generar el instalador para Windows (hacerlo EN una PC con Windows)

```
npm install
npm run dist
```

Al terminar, en la carpeta `dist/` queda:

- `BesaluMercatPOS-Setup-1.0.0.exe`  <- este es el instalador que se le pasa al cliente.

El cliente solo descarga ese `Setup.exe`, lo ejecuta y la app queda instalada
con acceso directo en el escritorio y en el menu inicio. Se abre sola al terminar.

> Importante: el `.exe` de Windows se debe generar en una PC con Windows. Desde
> una Mac no se puede producir de forma confiable.

## Datos del usuario

El POS guarda los datos con `localStorage`, que Electron almacena por usuario en
`%APPDATA%\Besalu Mercat POS` (fuera de la carpeta de instalacion). Al desinstalar
no se borran solos; se pueden respaldar con el boton "Respaldo JSON" dentro de Ajustes.

## Pendiente (cuando quieras)

- `build/icon.ico` para el branding (ver `build/PONER-ICONO-AQUI.txt`).
- Firma de codigo (evita la advertencia de "editor desconocido" de Windows).
  Se configura en `package.json` -> `build.win.certificateFile` / variables de entorno.
- Actualizaciones automaticas (electron-updater + un repo de releases). Se dejo
  fuera a proposito; se agrega cuando definas donde se alojan los releases.
- Conexion con Hacienda / impresion termica real (hoy la impresion es simulada).
