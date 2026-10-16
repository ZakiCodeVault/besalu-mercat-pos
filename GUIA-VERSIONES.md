# Publicar una version y actualizaciones automaticas

La app esta en GitHub: **ZakiCodeVault/besalu-mercat-pos** (repo publico).
Cada vez que empujas un **tag `v*`**, GitHub Actions compila el instalador en
`windows-latest` y crea un **Release** con el `.exe` final. Las copias ya
instaladas en las cajas se actualizan solas (electron-updater).

## Sacar una nueva version

Desde la carpeta `windows-app/`:

```bash
# 1) subir el numero de version (crea el commit y el tag vX.Y.Z)
npm run prueba           # antes de publicar: todas las pruebas deben pasar
npm version patch        # 2.0.0 -> 2.0.1   (usa "minor" o "major" si aplica)

# 2) empujar codigo + tag  -> dispara la compilacion
git push --follow-tags
```

En la pestana **Actions** del repo vas a ver la compilacion. Al terminar queda
un **Release en borrador** con:

- `BesaluMercatPOS-Setup-X.Y.Z.exe`  (el instalador para nuevas PC)
- `latest.yml` y `*.blockmap`         (lo que usa el auto-update)

## Importante: publicar el borrador

El Release se crea como **borrador**. Para que:

- las PC nuevas puedan descargar el `.exe`, y
- las PC ya instaladas reciban la actualizacion,

hay que entrar a **Releases**, abrir el borrador `vX.Y.Z`, revisar y tocar
**Publish release**. (Se deja en borrador a proposito para que verifiques el
`.exe` antes de mandarlo a todas las cajas.)

## Como se ve la actualizacion en la caja

- La app revisa al abrir y cada 4 horas.
- Si hay una version nueva, la **descarga en segundo plano** y muestra un aviso
  discreto: "Descargando actualizacion... %".
- Al terminar: "Version X.Y.Z lista" con **Reiniciar y actualizar** / **Mas tarde**.
- Si eligen "Mas tarde", se instala sola al cerrar la app.
- En **Ajustes > Acerca de** esta la version instalada y un boton
  **Buscar actualizaciones** (incluye "Ya tenes la ultima version").

## Probar el flujo de punta a punta

1. Publica la version actual (2.0.0) y instala el `.exe` en una PC Windows.
2. Sube una version: `npm version patch` y `git push --follow-tags`.
3. Cuando Actions termine, **publica** el nuevo Release.
4. Abri la app instalada: en un rato detecta la 2.0.1, la descarga y ofrece
   reiniciar. Listo.

## Cambios en la base de datos

Las actualizaciones **nunca borran datos**. Si una version nueva necesita
cambiar tablas, se agrega una migracion al final de `MIGRACIONES` en
`principal/datos/esquema.js` (la base guarda su numero en `PRAGMA user_version`
y aplica solo las que faltan, dentro de una transaccion). Nunca editar una
migracion ya publicada. Antes de migrar, la app guarda una copia completa
(`antes-de-migrar-vN-....sqlite`) junto a la base.

## Firma de codigo (para que Windows no marque "Editor desconocido")

Hoy el `.exe` sale **sin firmar** (Windows mostrara SmartScreen / "Editor
desconocido"). Cuando tengas el certificado:

1. Convierte el `.pfx` a base64 y guardalo como secret del repo:
   - `CSC_LINK`          = contenido del `.pfx` en base64
   - `CSC_KEY_PASSWORD`  = contrasena del `.pfx`
2. No hay que tocar codigo: el workflow ya pasa esos secrets y electron-builder
   firma solo en la proxima version.

- **Certificado OV** (~US$150-350/ano): firma valida; el aviso de SmartScreen
  se va ganando reputacion con las descargas.
- **Certificado EV** (~US$250-600/ano, token hardware): **quita el aviso de
  inmediato**. Es el mas recomendado si se instalara en varias PC.

## Build local con Docker (alternativa al CI)

Ver `DOCKER.md`. Util para generar el `.exe` en tu VPS sin esperar a Actions.
