export type MeshEntry = {
  kind: "node" | "device";
  id: string;
  deviceId?: string;
  name: string;
  meshHostname: string | null;
  ipv4: string | null;
  ipv6: string | null;
  status: string;
  lastSeenAt: string | null;
  createdAt: string;
  tunnelType?: string;
  isConnector: boolean;
};

export type MeshRoute = {
  id?: string;
  type: "cidr" | "hostname";
  network?: string;
  hostname?: string;
  comment?: string;
  created_at?: string;
};

export type SplitTunnelItem = {
  address?: string;
  host?: string;
  description?: string;
};

export type SplitTunnelConfig = {
  mode: "include" | "exclude";
  include: SplitTunnelItem[];
  exclude: SplitTunnelItem[];
};

export type Settings = {
  offlineDays: number;
  dnsFilterEnabled: boolean;
  dnsFilterStatus: string;
  dnsFilterUrl: string;
  dnsFilterLastSyncedAt?: string | null;
  meshSuffix: string;
  lastDnsSyncAt?: string | null;
  lastCleanupAt?: string | null;
  accountName?: string | null;
  accountEmail?: string | null;
  demo?: boolean;
  dnsLocation?: {
    id: string;
    name?: string;
    clientDefault: boolean;
    dohSubdomain?: string;
    ipv4Destination?: string;
    ipv4DestinationBackup?: string;
    ipv6Destination?: string;
    sourceNetworks: string[];
    endpoints: { ipv4: boolean; ipv6: boolean; doh: boolean };
  } | null;
};

export type SettingsPatch = Partial<{
  offlineDays: number;
  dnsFilterEnabled: boolean;
  dnsFilterUrl: string;
  meshSuffix: string;
  dnsIpv4Enabled: boolean;
  dnsIpv6Enabled: boolean;
  dnsDohEnabled: boolean;
  dnsSourceNetwork: string;
}>;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      message = body.error || body.message || message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }

  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return (await res.json()) as T;
  return (await res.text()) as T;
}

export const api = {
  settings: () => request<Settings>("/api/settings"),
  patchSettings: (body: SettingsPatch) =>
    request<Settings>("/api/settings", { method: "PATCH", body: JSON.stringify(body) }),
  listMesh: () => request<{ entries: MeshEntry[] }>("/api/mesh"),
  createNode: (name: string) =>
    request<{ node: { id: string; name: string; created_at?: string }; notice?: string }>(
      "/api/mesh/nodes",
      {
        method: "POST",
        body: JSON.stringify({ name }),
      },
    ),
  getNodeToken: (id: string) =>
    request<{ token: string; decoded: unknown }>(`/api/mesh/nodes/${id}/token`),
  recreateNode: (id: string) =>
    request<{ node: { id: string; name: string; created_at?: string } }>(`/api/mesh/nodes/${id}/regenerate`, {
      method: "POST",
    }),
  listNodeRoutes: (id: string) =>
    request<{ routes: MeshRoute[] }>(`/api/mesh/nodes/${id}/routes`),
  createNodeRoute: (
    id: string,
    type: "cidr" | "hostname",
    value: string,
    comment: string,
  ) =>
    request<{ route: MeshRoute }>(`/api/mesh/nodes/${id}/routes`, {
      method: "POST",
      body: JSON.stringify({
        type,
        ...(type === "cidr" ? { network: value } : { hostname: value }),
        comment: comment || undefined,
      }),
    }),
  removeNodeRoute: (nodeId: string, routeId: string) =>
    request<{ ok: boolean }>(`/api/mesh/nodes/${nodeId}/routes/${routeId}`, {
      method: "DELETE",
    }),
  rename: (kind: "node" | "device", id: string, name: string) =>
    request<{ notice?: string; renamed: unknown; displaced?: unknown }>(
      `/api/mesh/${kind}/${id}`,
      { method: "PATCH", body: JSON.stringify({ name }) },
    ),
  remove: (kind: "node" | "device", id: string) =>
    request<{ ok: boolean }>(`/api/mesh/${kind}/${id}`, { method: "DELETE" }),
  splitTunnels: () => request<SplitTunnelConfig>("/api/settings/split-tunnels"),
  saveSplitTunnels: (mode: "include" | "exclude", items: SplitTunnelItem[]) =>
    request<SplitTunnelConfig>("/api/settings/split-tunnels", {
      method: "PUT",
      body: JSON.stringify({ mode, items }),
    }),
  syncDns: () =>
    request<{ dns: unknown; lastDnsSyncAt?: string }>("/api/mesh/sync-dns", {
      method: "POST",
    }),
  cleanup: () =>
    request<{
      cleanup: {
        scanned: number;
        deleted: number;
        skippedConnector: number;
        skippedRecent: number;
        deletedNames: string[];
      };
      lastCleanupAt?: string;
    }>("/api/mesh/cleanup", {
      method: "POST",
    }),
  generateWireGuard: async (id: string, filename: string) => {
    const start = await fetch(`/api/mesh/nodes/${id}/wireguard`, { method: "POST" });
    if (!start.ok && start.status !== 202) {
      let message = `HTTP ${start.status}`;
      try {
        const body = (await start.json()) as { error?: string };
        message = body.error || message;
      } catch {
        message = await start.text();
      }
      throw new Error(message);
    }
    const started = (await start.json()) as { jobId: string; filename?: string };
    const jobId = started.jobId;
    const downloadName =
      started.filename ||
      (filename.endsWith(".conf") ? filename : `${filename}.conf`);

    const deadline = Date.now() + 150_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      let res: Response;
      try {
        res = await fetch(`/api/mesh/wireguard/jobs/${jobId}`);
      } catch {
        // warp-svc can briefly reset sockets while generating; keep polling.
        continue;
      }
      if (res.status === 404) {
        throw new Error("WireGuard job expired before it finished");
      }
      let body: {
        status?: string;
        conf?: string;
        error?: string;
        filename?: string;
      };
      try {
        body = (await res.json()) as typeof body;
      } catch {
        continue;
      }
      if (body.status === "pending") continue;
      if (body.status === "error" || !res.ok) {
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      if (body.status === "done" && body.conf) {
        const blob = new Blob([body.conf], { type: "text/plain; charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = body.filename || downloadName;
        a.click();
        URL.revokeObjectURL(url);
        return { generated: true as const };
      }
    }
    throw new Error("WireGuard generate timed out — try again");
  },
};
