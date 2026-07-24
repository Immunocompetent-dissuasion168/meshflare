import type { CloudflareClient } from "./client";
import { meshHostname, slugifyName } from "./names";
import type { DeviceRegistration, Env, MeshEntry, MeshNode } from "../types";
import { isConnectorRegistration } from "./names";
import { listDeviceRegistrations, listMeshNodes } from "./mesh";

type GatewayRule = {
  id: string;
  name: string;
  description?: string;
  traffic?: string;
  action?: string;
  enabled?: boolean;
  filters?: string[];
  rule_settings?: { override_ips?: string[] };
};

function parseFqdnFromTraffic(traffic: string | undefined): string | null {
  if (!traffic) return null;
  const m = traffic.match(/dns\.fqdn\s*==\s*"([^"]+)"/);
  return m?.[1] ?? null;
}

export async function listGatewayRules(cf: CloudflareClient): Promise<GatewayRule[]> {
  const res = await cf.request<GatewayRule[]>("GET", cf.accountPath("/gateway/rules"));
  return res.result ?? [];
}

export async function upsertMeshDnsRule(
  cf: CloudflareClient,
  env: Env,
  hostname: string,
  ipv4: string,
  existing?: GatewayRule,
): Promise<void> {
  const name = `${env.MESH_RULE_PREFIX}: ${hostname}`;
  const body = {
    name,
    description: `meshflare auto-sync: ${hostname} → ${ipv4}`,
    enabled: true,
    action: "override",
    filters: ["dns"],
    traffic: `dns.fqdn == "${hostname}"`,
    rule_settings: { override_ips: [ipv4] },
  };

  if (existing) {
    await cf.request("PUT", cf.accountPath(`/gateway/rules/${existing.id}`), body);
  } else {
    await cf.request("POST", cf.accountPath("/gateway/rules"), body);
  }
}

export async function deleteGatewayRule(
  cf: CloudflareClient,
  ruleId: string,
): Promise<void> {
  await cf.request("DELETE", cf.accountPath(`/gateway/rules/${ruleId}`));
}

/** Build unified mesh inventory (nodes + devices). */
export async function buildMeshInventory(
  cf: CloudflareClient,
  env: Env,
): Promise<MeshEntry[]> {
  const suffix = env.MESH_DNS_SUFFIX || "mesh";
  const [nodes, regs] = await Promise.all([
    listMeshNodes(cf),
    listDeviceRegistrations(cf, "active"),
  ]);

  const connectorRegsByName = new Map<string, DeviceRegistration>();
  const regsById = new Map<string, DeviceRegistration>();
  const deviceEntries: MeshEntry[] = [];

  for (const reg of regs) {
    regsById.set(reg.id, reg);
    if (reg.device?.id) regsById.set(reg.device.id, reg);

    const name = reg.device?.name?.trim() || "unnamed";
    const ipv4 = reg.virtual_ipv4?.trim() || null;
    const ipv6 = reg.virtual_ipv6?.trim() || null;
    const connector = isConnectorRegistration(reg);

    if (connector) {
      const key = name.toLowerCase();
      const prev = connectorRegsByName.get(key);
      if (!prev || newerRegistration(reg, prev)) {
        connectorRegsByName.set(key, reg);
      }
      continue;
    }

    deviceEntries.push({
      kind: "device",
      id: reg.id,
      deviceId: reg.device?.id ?? reg.id,
      name,
      meshHostname: ipv4 ? meshHostname(name, suffix) : null,
      ipv4,
      ipv6,
      status: "registered",
      lastSeenAt: reg.last_seen_at,
      createdAt: reg.created_at,
      tunnelType: reg.tunnel_type,
      isConnector: false,
    });
  }

  const nodeEntries: MeshEntry[] = nodes.map((node: MeshNode) => {
    const reg = resolveNodeRegistration(node, regsById, connectorRegsByName);
    const ipv4 = reg?.virtual_ipv4?.trim() || null;
    const ipv6 = reg?.virtual_ipv6?.trim() || null;
    return {
      kind: "node" as const,
      id: node.id,
      deviceId: reg?.device?.id,
      name: node.name,
      meshHostname: ipv4 ? meshHostname(node.name, suffix) : null,
      ipv4,
      ipv6,
      status: node.status,
      lastSeenAt: reg?.last_seen_at ?? null,
      createdAt: node.created_at,
      tunnelType: reg?.tunnel_type ?? "warp_connector",
      isConnector: true,
    };
  });

  return [...nodeEntries, ...deviceEntries].sort((a, b) => {
    const tb = Date.parse(b.createdAt) || 0;
    const ta = Date.parse(a.createdAt) || 0;
    if (tb !== ta) return tb - ta;
    return a.name.localeCompare(b.name);
  });
}

function newerRegistration(a: DeviceRegistration, b: DeviceRegistration): boolean {
  const ta = Date.parse(a.last_seen_at ?? a.created_at) || 0;
  const tb = Date.parse(b.last_seen_at ?? b.created_at) || 0;
  return ta >= tb;
}

/**
 * WireGuard/connector enrollments often keep a host/docker name that does not
 * match the mesh node name. Prefer the active tunnel connection's client_id.
 */
function resolveNodeRegistration(
  node: MeshNode,
  regsById: Map<string, DeviceRegistration>,
  connectorRegsByName: Map<string, DeviceRegistration>,
): DeviceRegistration | undefined {
  for (const conn of node.connections ?? []) {
    const clientId = conn.client_id ?? conn.id ?? conn.uuid;
    if (!clientId) continue;
    const byConn = regsById.get(clientId);
    if (byConn) return byConn;
  }
  return connectorRegsByName.get(node.name.toLowerCase());
}

export type DnsSyncStats = {
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
  desired: number;
};

/**
 * Sync Gateway DNS overrides for *.mesh — only when an IP is known.
 * Removes stale meshflare-managed rules whose hostname is no longer desired.
 */
export async function syncMeshDns(
  cf: CloudflareClient,
  env: Env,
): Promise<DnsSyncStats> {
  const suffix = env.MESH_DNS_SUFFIX || "mesh";
  const inventory = await buildMeshInventory(cf, env);
  const desired = new Map<string, string>();

  for (const entry of inventory) {
    if (!entry.ipv4) continue;
    const host = meshHostname(entry.name, suffix);
    // First writer wins on slug collision; rename flow should prevent this.
    if (!desired.has(host)) desired.set(host, entry.ipv4);
  }

  const rules = await listGatewayRules(cf);
  const managed = new Map<string, GatewayRule>();
  for (const rule of rules) {
    if (rule.action !== "override") continue;
    if (!rule.filters?.includes("dns")) continue;
    const fqdn = parseFqdnFromTraffic(rule.traffic);
    if (!fqdn?.endsWith(`.${suffix}`)) continue;
    if (!rule.name?.startsWith(env.MESH_RULE_PREFIX)) continue;
    managed.set(fqdn, rule);
  }

  let created = 0;
  let updated = 0;
  let deleted = 0;
  let skipped = 0;

  for (const [host, ipv4] of desired) {
    const existing = managed.get(host);
    const current = existing?.rule_settings?.override_ips?.[0];
    if (existing && current === ipv4) {
      skipped += 1;
      continue;
    }
    await upsertMeshDnsRule(cf, env, host, ipv4, existing);
    if (existing) updated += 1;
    else created += 1;
  }

  for (const [host, rule] of managed) {
    if (desired.has(host)) continue;
    await deleteGatewayRule(cf, rule.id);
    deleted += 1;
  }

  return {
    created,
    updated,
    deleted,
    skipped,
    desired: desired.size,
  };
}

export { slugifyName, meshHostname };
