# Generar el instalador de Windows con Docker

Esto compila `BesaluMercatPOS-Setup-X.Y.Z.exe` sin necesitar una PC con Windows,
usando la imagen `electronuserland/builder:wine` (Node + electron-builder + Wine).

> **Dónde correrlo:** en un host **amd64 / x86_64** con Docker — tu **VPS Ubuntu**
> es ideal. En una Mac con Apple Silicon (arm64) funciona emulado y suele fallar
> o ir muy lento; no lo recomiendo ahí.

## Opción A — rápida (sin construir imagen)

Desde la carpeta `windows-app/`:

```bash
docker run --rm -v "$PWD:/project" -w /project \
  electronuserland/builder:wine \
  bash -c "npm install && npm run dist"
```

El instalador queda en `windows-app/dist/BesaluMercatPOS-Setup-X.Y.Z.exe`.

## Opción B — con el Dockerfile (reproducible)

```bash
# construir la imagen del compilador (hace npm install adentro)
docker build -t besalu-pos-builder .

# ejecutar: genera el .exe y lo deja en ./dist del host
docker run --rm -v "$PWD/dist:/app/dist" besalu-pos-builder
```

Resultado: `windows-app/dist/BesaluMercatPOS-Setup-X.Y.Z.exe`.

## En Apple Silicon (si insistís en probar en la Mac)

1. Abrí Docker Desktop (el daemon tiene que estar corriendo).
2. Forzá arquitectura amd64 (necesita Rosetta/qemu, va lento):

```bash
docker run --rm --platform linux/amd64 -v "$PWD:/project" -w /project \
  electronuserland/builder:wine \
  bash -c "npm install && npm run dist"
```

Puede tardar mucho o fallar en el paso de NSIS/Wine. Si pasa eso, usá el VPS.

## Alternativa sin Docker: GitHub Actions (la que se usa hoy)

El workflow `.github/workflows/release.yml` compila el `.exe` de forma nativa en
`windows-latest` cada vez que se empuja un tag `v*`. Ver `GUIA-VERSIONES.md`.

## Notas

- La base usa `better-sqlite3`, un modulo nativo. Desde la v2.2 (better-sqlite3
  13) el paquete ya trae el binario compilado para Windows, asi que no hace falta
  compilar nada desde Linux. El camino oficial y probado sigue siendo GitHub
  Actions, que ademas corre las pruebas en Windows antes de compilar.
- Los comandos se corren desde la carpeta `windows-app/` (donde esta el `Dockerfile`).

- `npm run dist` descarga Electron y utilidades la primera vez: el contenedor
  necesita **internet**.
- La salida y la carpeta `dist/` se ignoran en git (ver `.dockerignore`).
- El ícono está en `recursos/icono.png`. La firma de código es opcional;
  ver `GUIA-VERSIONES.md`.
