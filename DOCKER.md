# Generar el instalador de Windows con Docker

Esto compila `BesaluMercatPOS-Setup-1.0.0.exe` sin necesitar una PC con Windows,
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

El instalador queda en `windows-app/dist/BesaluMercatPOS-Setup-1.0.0.exe`.

## Opción B — con el Dockerfile (reproducible)

```bash
# construir la imagen del compilador (hace npm install adentro)
docker build -t besalu-pos-builder .

# ejecutar: genera el .exe y lo deja en ./dist del host
docker run --rm -v "$PWD/dist:/app/dist" besalu-pos-builder
```

Resultado: `windows-app/dist/BesaluMercatPOS-Setup-1.0.0.exe`.

## En Apple Silicon (si insistís en probar en la Mac)

1. Abrí Docker Desktop (el daemon tiene que estar corriendo).
2. Forzá arquitectura amd64 (necesita Rosetta/qemu, va lento):

```bash
docker run --rm --platform linux/amd64 -v "$PWD:/project" -w /project \
  electronuserland/builder:wine \
  bash -c "npm install && npm run dist"
```

Puede tardar mucho o fallar en el paso de NSIS/Wine. Si pasa eso, usá el VPS.

## Alternativa sin Docker: GitHub Actions

Un runner `windows-latest` compila el `.exe` de forma nativa (lo más estable).
Si querés, te armo el workflow `.github/workflows/release.yml` que lo genera en
cada tag `v*` y lo sube como artefacto/release.

## Notas

- `npm run dist` descarga Electron y utilidades la primera vez: el contenedor
  necesita **internet**.
- La salida y la carpeta `dist/` se ignoran en git (ver `.dockerignore`).
- El icono (`build/icon.ico`) y la firma de código siguen siendo opcionales;
  ver `README.md`.
