/**
 * WireGuard extraction for mesh nodes.
 *
 * Reverse-engineered from AnimMouse/wgcf-connector:
 * 1. Mesh node token is base64 JSON: { a: account, t: tunnel_id, s: secret }
 * 2. Enrollment uses Cloudflare's proprietary wdapi (`warp-cli connector new`) —
 *    not plain REST, so Workers cannot enroll with fetch alone.
 * 3. After enroll, reg.json has secret_key; conf.json has IPs, peer public_key,
 *    endpoints. Peer key must be bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=
 *    (MASQUE means the device profile is not WireGuard).
 *
 * Runtime options (first match wins):
 * - Optional Cloudflare Container (Workers Paid): see container/ + WgExtractor
 * - Optional HTTP extractor: set WG_EXTRACTOR_URL to a service that accepts
 *   POST { "token": "..." } and returns text/plain WireGuard conf
 * - Otherwise the API returns a docker one-liner (our extract image / script)
 */

import type { Env } from "../types";

export function decodeConnectorToken(token: string): {
  account_tag: string;
  tunnel_id: string;
  tunnel_secret: string;
} {
  const json = JSON.parse(atob(token)) as { a: string; t: string; s: string };
  if (!json.a || !json.t || !json.s) {
    throw new Error("Invalid connector token payload");
  }
  return {
    account_tag: json.a,
    tunnel_id: json.t,
    tunnel_secret: json.s,
  };
}

export function dockerExtractCommand(token: string): string {
  const escaped = token.replace(/'/g, `'\\''`);
  return `mkdir -p ./wg-out && docker run --rm --platform linux/amd64 -v \"$PWD/wg-out:/app/output\" ghcr.io/animmouse/wgcf-connector:latest '${escaped}'`;
}

/**
 * Prefer a self-hosted HTTP extractor when configured.
 * Expected: POST JSON {token} → 200 text/plain WireGuard conf.
 */
export async function extractWireGuardConf(
  env: Env,
  token: string,
): Promise<{ conf: string } | { needsDocker: true; command: string; token: string }> {
  const url = (env as Env & { WG_EXTRACTOR_URL?: string }).WG_EXTRACTOR_URL?.trim();
  if (url) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`WireGuard extractor failed (${res.status}): ${text}`);
    }
    return { conf: await res.text() };
  }

  return {
    needsDocker: true,
    command: dockerExtractCommand(token),
    token,
  };
}
