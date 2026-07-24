# meshflare

Self-hostable Cloudflare Mesh manager (account ID + API credentials from env).

## Features

- Inventory of **mesh nodes** (`warp_connector`) and **devices** (Cloudflare One)
- Renames the real Cloudflare name; `name.mesh` is derived from that name
- Name collisions: existing holder becomes `name-2` / `name-3` / … with a UI notice
- Gateway DNS override for `*.mesh` **only when a Mesh IP is known**
- Cron every minute: DNS sync + delete devices offline longer than N days (default 7; nodes never auto-deleted)
- Toggle **OISD Small** (Gateway DOMAIN lists + block rule), synced progressively via cron
- WireGuard for nodes: reverse-engineered wgcf-connector flow (see below)

## Config (account-agnostic)

| Name | Required | Notes |
|------|----------|--------|
| `CLOUDFLARE_ACCOUNT_ID` | yes | Target account |
| `CLOUDFLARE_API_TOKEN` | recommended | Scoped API token |
| `CLOUDFLARE_API_KEY` + `CLOUDFLARE_EMAIL` | alt | Global key auth |
| `MESH_DNS_SUFFIX` | no | default `mesh` |
| `WG_EXTRACTOR_URL` | no | Optional HTTP extractor: `POST {token}` → WireGuard conf |

```bash
cp .dev.vars.example .dev.vars
bun install
bun run db:migrate:local
bun run dev
```

## Deploy

```bash
bunx wrangler d1 create meshflare
bunx wrangler r2 bucket create meshflare-oisd
# put database_id into wrangler.jsonc

bunx wrangler secret put CLOUDFLARE_ACCOUNT_ID
bunx wrangler secret put CLOUDFLARE_API_TOKEN

bun run db:migrate:remote
bun run deploy
```

Attach a custom domain (e.g. `meshflare.wastu.net`) and protect it with Cloudflare Access (Only Bagas).

## WireGuard

Connector enrollment uses Cloudflare’s proprietary device API (`wdapi`), not plain REST — a Worker cannot enroll with `fetch` alone.

meshflare ships:

1. **`container/`** — HTTP service wrapping `warp-cli connector new` (same flow as [wgcf-connector](https://github.com/AnimMouse/wgcf-connector)). Use with Cloudflare Containers on **Workers Paid**, or run the image yourself and set `WG_EXTRACTOR_URL`.
2. **`scripts/extract-wg.sh`** — local Docker extract.
3. **UI fallback** — copies a `docker run … ghcr.io/animmouse/wgcf-connector` command when no extractor is configured.

Peer public key must be `bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=` (WireGuard device profile, not MASQUE). Downloading/enrolling **creates a new connector registration** for that mesh node token.
