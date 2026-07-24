import type { CloudflareClient } from "./client";
import type { Env, Settings } from "../types";

const OISD_SMALL_URL = "https://small.oisd.nl/";
const LIST_CHUNK = 1000;
const CHUNKS_PER_TICK = 3;
const OISD_REFRESH_MS = 6 * 60 * 60 * 1000;

type GatewayList = {
  id: string;
  name: string;
  count?: number;
  type?: string;
};

type GatewayRule = {
  id: string;
  name: string;
};

function normalizeDomain(line: string): string | null {
  let s = line.trim().toLowerCase();
  if (!s || s.startsWith("#") || s.startsWith("!") || s.startsWith("//")) return null;
  if (s.includes("://")) {
    try {
      s = new URL(s).hostname;
    } catch {
      return null;
    }
  }
  s = s.replace(/^\|\|/, "").replace(/\^.*$/, "").replace(/^\*\./, "");
  s = s.split(/\s+/).pop() ?? s;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(s)) {
    return null;
  }
  return s;
}

async function getSetting(db: D1Database, key: string, fallback: string): Promise<string> {
  const row = await db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? fallback;
}

async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(key, value)
    .run();
}

export async function getSettings(env: Env): Promise<Settings> {
  const offlineDays = Number(
    await getSetting(env.DB, "offline_days", env.DEFAULT_OFFLINE_DAYS || "7"),
  );
  const oisdEnabled = (await getSetting(env.DB, "oisd_enabled", "0")) === "1";
  const oisdStatus = await getSetting(env.DB, "oisd_status", "idle");
  const oisdLastSyncedAt = await getSetting(env.DB, "oisd_last_synced_at", "");
  return {
    offlineDays: Number.isFinite(offlineDays) && offlineDays > 0 ? offlineDays : 7,
    oisdEnabled,
    oisdStatus,
    oisdLastSyncedAt: oisdLastSyncedAt || null,
  };
}

export async function updateSettings(
  env: Env,
  patch: Partial<{ offlineDays: number; oisdEnabled: boolean }>,
): Promise<Settings> {
  if (patch.offlineDays !== undefined) {
    const days = Math.max(1, Math.min(365, Math.floor(patch.offlineDays)));
    await setSetting(env.DB, "offline_days", String(days));
  }
  if (patch.oisdEnabled !== undefined) {
    await setSetting(env.DB, "oisd_enabled", patch.oisdEnabled ? "1" : "0");
    await setSetting(
      env.DB,
      "oisd_status",
      patch.oisdEnabled ? "pending_enable" : "pending_disable",
    );
  }
  return getSettings(env);
}

async function listGatewayLists(cf: CloudflareClient): Promise<GatewayList[]> {
  const res = await cf.request<GatewayList[]>("GET", cf.accountPath("/gateway/lists"));
  return res.result ?? [];
}

async function listGatewayRules(cf: CloudflareClient): Promise<GatewayRule[]> {
  const res = await cf.request<GatewayRule[]>("GET", cf.accountPath("/gateway/rules"));
  return res.result ?? [];
}

function meshflareLists(lists: GatewayList[], prefix: string): GatewayList[] {
  return lists.filter((l) => l.name.startsWith(prefix));
}

async function downloadOisdDomains(): Promise<string[]> {
  const res = await fetch(OISD_SMALL_URL, {
    headers: { "User-Agent": "meshflare/0.1" },
  });
  if (!res.ok) throw new Error(`Failed to download OISD Small: HTTP ${res.status}`);
  const text = await res.text();
  const seen = new Set<string>();
  const domains: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const d = normalizeDomain(line);
    if (!d || seen.has(d)) continue;
    seen.add(d);
    domains.push(d);
  }
  return domains;
}

async function upsertBlockRule(
  cf: CloudflareClient,
  env: Env,
  lists: GatewayList[],
): Promise<void> {
  const expression = lists
    .map((l) => `any(dns.domains[*] in $${l.id})`)
    .join(" or ");
  if (!expression) return;

  const rules = await listGatewayRules(cf);
  const existing = rules.find((r) => r.name === env.OISD_RULE_NAME);
  const body = {
    name: env.OISD_RULE_NAME,
    description: "meshflare OISD Small block rule",
    enabled: true,
    action: "block",
    filters: ["dns"],
    traffic: expression,
    rule_settings: {
      block_page_enabled: false,
      block_reason: "Blocked by meshflare OISD Small",
    },
  };

  if (existing) {
    await cf.request("PUT", cf.accountPath(`/gateway/rules/${existing.id}`), body);
  } else {
    await cf.request("POST", cf.accountPath("/gateway/rules"), body);
  }
}

async function deleteOisdArtifacts(cf: CloudflareClient, env: Env): Promise<void> {
  const rules = await listGatewayRules(cf);
  for (const rule of rules) {
    if (rule.name === env.OISD_RULE_NAME) {
      await cf.request("DELETE", cf.accountPath(`/gateway/rules/${rule.id}`));
    }
  }

  const lists = meshflareLists(await listGatewayLists(cf), env.OISD_LIST_PREFIX);
  for (const list of lists) {
    await cf.request("DELETE", cf.accountPath(`/gateway/lists/${list.id}`));
  }
}

/**
 * Progressive OISD enable/disable/refresh. Called from cron so large list
 * uploads stay within Worker time limits (a few chunks per tick).
 * When enabled, refreshes from OISD Small every 6 hours.
 */
export async function processOisdTick(
  cf: CloudflareClient,
  env: Env,
): Promise<string> {
  const settings = await getSettings(env);
  let status = settings.oisdStatus;

  // Periodic refresh while enabled
  if (status === "enabled" && settings.oisdEnabled) {
    const last = settings.oisdLastSyncedAt
      ? Date.parse(settings.oisdLastSyncedAt)
      : 0;
    if (!last || Date.now() - last >= OISD_REFRESH_MS) {
      await setSetting(env.DB, "oisd_status", "pending_refresh");
      status = "pending_refresh";
    }
  }

  if (status === "pending_refresh") {
    await deleteOisdArtifacts(cf, env);
    await env.OISD_CACHE.delete("domains.json");
    await setSetting(env.DB, "oisd_cursor", "0");
    await setSetting(env.DB, "oisd_status", "pending_enable");
    status = "pending_enable";
    return "oisd_refresh_started";
  }

  if (status === "pending_disable" || (status === "idle" && !settings.oisdEnabled)) {
    if (status === "pending_disable") {
      await deleteOisdArtifacts(cf, env);
      await env.OISD_CACHE.delete("domains.json");
      await setSetting(env.DB, "oisd_status", "idle");
      await setSetting(env.DB, "oisd_enabled", "0");
      await setSetting(env.DB, "oisd_cursor", "0");
      await setSetting(env.DB, "oisd_last_synced_at", "");
      return "oisd_disabled";
    }
    return "oisd_idle";
  }

  if (status === "pending_enable" || status === "syncing") {
    let domains: string[] = [];
    const cached = await env.OISD_CACHE.get("domains.json");
    if (cached) {
      domains = JSON.parse(await cached.text()) as string[];
    } else {
      domains = await downloadOisdDomains();
      await env.OISD_CACHE.put("domains.json", JSON.stringify(domains), {
        httpMetadata: { contentType: "application/json" },
      });
    }

    const cursor = Number(await getSetting(env.DB, "oisd_cursor", "0"));
    const existing = meshflareLists(
      await listGatewayLists(cf),
      env.OISD_LIST_PREFIX,
    );
    const existingChunkIndexes = new Set(
      existing.map((l) => {
        const m = l.name.match(/chunk-(\d+)$/);
        return m ? Number(m[1]) : -1;
      }),
    );

    let nextCursor = cursor;
    let created = 0;

    for (let i = 0; i < CHUNKS_PER_TICK; i++) {
      const start = nextCursor;
      if (start >= domains.length) break;
      const chunkIndex = Math.floor(start / LIST_CHUNK) + 1;
      const slice = domains.slice(start, start + LIST_CHUNK);
      if (!existingChunkIndexes.has(chunkIndex)) {
        await cf.request("POST", cf.accountPath("/gateway/lists"), {
          name: `${env.OISD_LIST_PREFIX}-chunk-${chunkIndex}`,
          description: "meshflare OISD Small",
          type: "DOMAIN",
          items: slice.map((value) => ({ value })),
        });
        created += 1;
      }
      nextCursor = start + slice.length;
    }

    await setSetting(env.DB, "oisd_cursor", String(nextCursor));
    await setSetting(env.DB, "oisd_status", "syncing");

    if (nextCursor >= domains.length) {
      const lists = meshflareLists(
        await listGatewayLists(cf),
        env.OISD_LIST_PREFIX,
      );
      await upsertBlockRule(cf, env, lists);
      await setSetting(env.DB, "oisd_status", "enabled");
      await setSetting(env.DB, "oisd_enabled", "1");
      await setSetting(env.DB, "oisd_last_synced_at", new Date().toISOString());
      return `oisd_enabled chunks=${lists.length} created_this_tick=${created}`;
    }

    return `oisd_syncing ${nextCursor}/${domains.length} created_this_tick=${created}`;
  }

  return `oisd_${status}`;
}
