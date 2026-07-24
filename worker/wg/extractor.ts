/**
 * WireGuard extraction for mesh nodes via Coolify-hosted extractor.
 *
 * Enrollment uses proprietary wdapi (`warp-cli connector new`). Workers cannot
 * run warp-cli; meshflare POSTs the connector token to WG_EXTRACTOR_URL
 * (Coolify container) which returns a WireGuard .conf.
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

export async function extractWireGuardConf(env: Env, token: string): Promise<string> {
  const url = env.WG_EXTRACTOR_URL?.trim();
  if (!url) {
    throw new Error(
      "WG_EXTRACTOR_URL is not configured. Deploy the meshflare WG extractor on Coolify and set the Worker secret.",
    );
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (env.WG_EXTRACTOR_SECRET?.trim()) {
    headers.Authorization = `Bearer ${env.WG_EXTRACTOR_SECRET.trim()}`;
  }

  const res = await fetch(url.replace(/\/$/, "") + "/extract", {
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
