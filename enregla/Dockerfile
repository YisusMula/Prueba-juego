# syntax=docker/dockerfile:1
# Construir desde la carpeta enregla/:   docker build -t enregla .

# --- Dependencias y build del servidor ---------------------------------------
FROM node:22-bookworm-slim AS server-build
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ ./
RUN npm run build && npm prune --omit=dev

# --- Build del frontend (solo si existe web/) --------------------------------
FROM node:22-bookworm-slim AS web-build
WORKDIR /src
# Se copia el contexto (filtrado por .dockerignore) para poder comprobar si web/ existe.
COPY . .
RUN mkdir -p /app/web/dist && \
    if [ -f web/package.json ]; then \
      cd web && (if [ -f package-lock.json ]; then npm ci; else npm install; fi) && npm run build && \
      cp -r dist/. /app/web/dist/; \
    else \
      echo "web/ no existe: la imagen servirá solo la API"; \
    fi

# --- Imagen final ------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
WORKDIR /app/server
COPY --from=server-build --chown=node:node /app/server/package.json ./package.json
COPY --from=server-build --chown=node:node /app/server/node_modules ./node_modules
COPY --from=server-build --chown=node:node /app/server/dist ./dist
COPY --from=server-build --chown=node:node /app/server/migrations ./migrations
COPY --from=web-build --chown=node:node /app/web/dist /app/web/dist
# Si el build web está vacío (sin index.html) el servidor lo ignora y sirve solo la API.
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
