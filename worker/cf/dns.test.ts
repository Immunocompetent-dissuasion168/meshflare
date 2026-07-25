import { describe, expect, it } from "bun:test";
import { syncMeshDns } from "./dns";
import type { CloudflareClient } from "./client";

function makeEnv(dnsMissingSince: Record<string, string> = {}) {
  const data = {
    offlineDays: 7,
    dnsFilterEnabled: false,
    dnsFilterStatus: "idle",
    dnsFilterUrl: "https://small.oisd.nl/",
    dnsFilterLastSyncedAt: null,
    dnsFilterCursor: 0,
    meshSuffix: "mesh",
    lastDnsSyncAt: null,
    lastCleanupAt: null,
    dnsMissingSince,
  };
  return {
    MESH_RULE_PREFIX: "meshflare DNS",
    MESH_DNS_SUFFIX: "mesh",
    DB: {
      data,
      update: async (fn: (value: typeof data) => void) => fn(data),
    },
  } as any;
}

function makeClient(rules: unknown[]) {
  const deleted: string[] = [];
  const client = {
    accountPath: (suffix: string) => suffix,
    request: async (method: string, path: string) => {
      if (method === "GET" && path === "/warp_connector") {
        return {
          result: [{
            id: "node-1",
            name: "home-router",
            status: "healthy",
            created_at: new Date().toISOString(),
            connections: [{ client_id: "reg-1" }],
          }],
        };
      }
      if (method === "GET" && path.startsWith("/devices/registrations")) {
        return {
          result: [{
            id: "reg-1",
            created_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
            virtual_ipv4: "100.96.0.4",
            virtual_ipv6: null,
            device: { id: "device-1", name: "home-router" },
            user: { email: "warp_connector@example.com" },
          }],
        };
      }
      if (method === "GET" && path === "/gateway/rules") return { result: rules };
      if (method === "DELETE") {
        deleted.push(path);
        return { result: null };
      }
      if (method === "POST" || method === "PUT") return { result: null };
      throw new Error(`Unexpected request: ${method} ${path}`);
    },
  };
  return { client: client as unknown as CloudflareClient, deleted };
}

describe("syncMeshDns stale rule protection", () => {
  it("does not delete a rule after one missing inventory snapshot", async () => {
    const staleRule = {
      id: "rule-1",
      name: "meshflare DNS: old.mesh",
      enabled: true,
      action: "override",
      filters: ["dns"],
      traffic: 'dns.fqdn == "old.mesh"',
      rule_settings: { override_ips: ["100.96.0.9"] },
    };
    const env = makeEnv();
    const { client, deleted } = makeClient([staleRule]);

    const result = await syncMeshDns(client, env);

    expect(result.deleted).toBe(0);
    expect(deleted).toEqual([]);
    expect(env.DB.data.dnsMissingSince["old.mesh"]).toBeString();
  });

  it("deletes an entry after the grace period", async () => {
    const staleRule = {
      id: "rule-1",
      name: "meshflare DNS: old.mesh",
      enabled: true,
      action: "override",
      filters: ["dns"],
      traffic: 'dns.fqdn == "old.mesh"',
      rule_settings: { override_ips: ["100.96.0.9"] },
    };
    const env = makeEnv({ "old.mesh": new Date(Date.now() - 6 * 60_000).toISOString() });
    const { client, deleted } = makeClient([staleRule]);

    const result = await syncMeshDns(client, env);

    expect(result.deleted).toBe(1);
    expect(deleted).toEqual(["/gateway/rules/rule-1"]);
  });

  it("purges explicitly requested hosts immediately", async () => {
    const staleRule = {
      id: "rule-1",
      name: "meshflare DNS: old.mesh",
      enabled: true,
      action: "override",
      filters: ["dns"],
      traffic: 'dns.fqdn == "old.mesh"',
      rule_settings: { override_ips: ["100.96.0.9"] },
    };
    const env = makeEnv({ "old.mesh": new Date().toISOString() });
    const { client, deleted } = makeClient([staleRule]);

    await syncMeshDns(client, env, { purgeHosts: ["old.mesh"] });

    expect(deleted).toEqual(["/gateway/rules/rule-1"]);
  });
});
