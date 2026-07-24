# meshflare — Bun app + warp-cli for in-process WireGuard extract

FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1 AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock tsconfig.json vite.config.ts index.html ./
COPY client ./client
COPY public ./public
COPY worker ./worker
COPY server ./server
RUN bun run build

FROM oven/bun:1 AS runner
WORKDIR /app
ARG DEBIAN_FRONTEND=noninteractive
ARG WARP_VERSION=2026.6.880.0

RUN apt-get -qq update \
  && apt-get -qq install --no-install-recommends ca-certificates dbus jq procps wget \
  && wget -O /usr/share/keyrings/cloudflare-warp-archive-keyring.asc https://pkg.cloudflareclient.com/pubkey.gpg \
  && echo "deb [signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.asc] https://pkg.cloudflareclient.com/ $(. /etc/os-release && echo "$VERSION_CODENAME") main" \
     | tee /etc/apt/sources.list.d/cloudflare-client.list \
  && apt-get -qq update \
  && apt-get -qq install --no-install-recommends cloudflare-warp=$WARP_VERSION \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /run/dbus /var/lib/cloudflare-warp /data

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data
ENV WG_EXTRACT_SCRIPT=/app/scripts/wg-extract.sh

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json bun.lock tsconfig.json ./
COPY worker ./worker
COPY server ./server
COPY scripts/wg-extract.sh ./scripts/wg-extract.sh
RUN chmod +x /app/scripts/wg-extract.sh

EXPOSE 3000
VOLUME ["/data"]
CMD ["bun", "run", "server/index.ts"]
