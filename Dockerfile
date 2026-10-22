# Met de hand onderhouden, dus zonder de marker van release-scripting: run-app laat dit bestand met rust.
# De widget wordt hier gebouwd, niet op de host: zo is wat er live staat altijd de code van deze checkout.

# ---------- fase 1: widget bouwen ----------
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY scripts/build.ts scripts/widget-build-options.ts scripts/
COPY widget widget
RUN node scripts/build.ts

# ---------- fase 2: de server (geen runtime-dependencies) ----------
FROM node:22-slim
WORKDIR /app
COPY package.json ./
COPY server server
COPY public public
# Vaste releases uit git, niet opnieuw gebouwd: apps rekenen op hun exacte hash.
COPY releases releases
COPY widget/src/types.ts widget/src/types.ts
COPY --from=build /app/dist dist
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
EXPOSE 8080
CMD ["node", "server/index.ts"]
