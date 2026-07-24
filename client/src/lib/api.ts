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
};

export type SettingsPatch = Partial<{
  offlineDays: number;
  dnsFilterEnabled: boolean;
  dnsFilterUrl: string;
  meshSuffix: string;
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
  rename: (kind: "node" | "device", id: string, name: string) =>
    request<{ notice?: string; renamed: unknown; displaced?: unknown }>(
      `/api/mesh/${kind}/${id}`,
      { method: "PATCH", body: JSON.stringify({ name }) },
    ),
  remove: (kind: "node" | "device", id: string) =>
    request<{ ok: boolean }>(`/api/mesh/${kind}/${id}`, { method: "DELETE" }),
  syncDns: () =>
    request<{ dns: unknown; lastDnsSyncAt?: string }>("/api/mesh/sync-dns", {
      method: "POST",
    }),
  cleanup: () =>
    request<{ cleanup: unknown; lastCleanupAt?: string }>("/api/mesh/cleanup", {
      method: "POST",
    }),
  downloadWireGuard: async (id: string, filename: string) => {
    const res = await fetch(`/api/mesh/nodes/${id}/wireguard`);
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string };
        message = body.error || message;
      } catch {
        message = await res.text();
      }
      throw new Error(message);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename.endsWith(".conf") ? filename : `${filename}.conf`;
    a.click();
    URL.revokeObjectURL(url);
    return { downloaded: true as const };
  },
};
