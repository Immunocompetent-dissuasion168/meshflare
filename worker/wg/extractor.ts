/**
 * WireGuard extraction for mesh nodes via Coolify-hosted extractor.
 *
 * Enrollment uses proprietary wdapi (`warp-cli connector new`). Workers cannot
 * run warp-cli; meshflare POSTs the connector token to the Coolify extractor
 * which returns a WireGuard .conf.
 */

import type { Env } from "../types";

const WG_EXTRACTOR_BASE = "https://meshflare-wg.wastu.net";

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

export async function extractWireGuardConf(env: Env, token: string): Promise<string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (env.WG_EXTRACTOR_SECRET?.trim()) {
    headers.Authorization = `Bearer ${env.WG_EXTRACTOR_SECRET.trim()}`;
  }

  const res = await fetch(`${WG_EXTRACTOR_BASE}/extract`, {
    method: "POST",
    headers,
    body: JSON.stringify({ token }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`WireGuard extractor failed (${res.status}): ${text}`);
  }

  return res.text();
}
