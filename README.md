# meshflare

Cloudflare Mesh manager (Bun + Hono). One Docker image — UI, API, cron, and WireGuard extract.

## Features

- Machines inventory (nodes + devices); rename updates the real Cloudflare name
- Configurable mesh domain (default `.mesh`) and Gateway DNS sync when an IP is known
- Auto-delete devices offline longer than N days (default 7; nodes excluded)
- Configurable DNS filtering from any domain-list URL (default [small.oisd.nl](https://small.oisd.nl/))
- WireGuard `.conf` download for nodes (warp-cli in the same container)

## Image

`ghcr.io/bgwastu/meshflare`

## Config

| Name | Notes |
|------|--------|
| `CLOUDFLARE_ACCOUNT_ID` | required |
| `CLOUDFLARE_API_TOKEN` | preferred |
| `CLOUDFLARE_API_KEY` + `CLOUDFLARE_EMAIL` | alt |
| `DATA_DIR` | default `/data` (lowdb + filter cache) |
| `PORT` | default `3000` |

```bash
cp .env.example .env
bun install
bun run build
bun run dev        # API on :3000
bun run dev:client # Vite UI (proxies /api)
```

## Docker

```bash
docker run --rm -p 3000:3000 \
  -v meshflare-data:/data \
  -e CLOUDFLARE_ACCOUNT_ID=… \
  -e CLOUDFLARE_API_TOKEN=… \
  ghcr.io/bgwastu/meshflare:latest
```

WireGuard download needs a WireGuard device profile. CI pushes GHCR and triggers Coolify via `COOLIFY_WEBHOOK` + `COOLIFY_TOKEN`.
