# Compila el instalador de Windows (.exe) desde Linux usando Wine.
# Pensado para un host amd64 / x86_64 (tu VPS Ubuntu, o GitHub Actions).
# En Apple Silicon (arm64) corre emulado y es poco confiable: usar el VPS.
FROM electronuserland/builder:wine

WORKDIR /app

# 1) Dependencias primero (capa cacheable; se reusa si no cambia package.json)
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts   # versiones exactas del lockfile, sin scripts de terceros

# 2) Codigo de la app
COPY . .

# 3) Al ejecutar el contenedor, genera el instalador NSIS x64 en /app/dist
CMD ["npm", "run", "dist"]
