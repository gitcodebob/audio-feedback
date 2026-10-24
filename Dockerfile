# Met de hand onderhouden, dus zonder de marker van release-scripting: run-app laat dit bestand met rust.
# De widget wordt hier gebouwd, niet op de host: zo is wat er live staat altijd de code van deze checkout.

# ---------- fase 1: widget bouwen ----------
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY scripts/build.ts scripts/
COPY widget widget
RUN node scripts/build.ts

# ---------- fase 2: de server (geen npm-dependencies, wel ffmpeg) ----------
FROM node:22-slim
# ffmpeg zet opnames om naar mp3 voor de download. De laatste regel laat de build mislukken als
# ffmpeg zonder mp3-encoder komt, in plaats van dat pas de eerste download dat ontdekt.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/* \
 && ffmpeg -hide_banner -encoders | grep libmp3lame
WORKDIR /app
COPY package.json ./
COPY server server
COPY public public
COPY widget/src/types.ts widget/src/clean-url.ts widget/src/events.ts widget/src/
COPY --from=build /app/dist dist
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
EXPOSE 8080
CMD ["node", "server/index.ts"]
