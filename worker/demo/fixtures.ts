import type { MeshEntry, Settings } from "../types";

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

/** Fixed demo inventory — no Cloudflare calls. */
export const DEMO_ENTRIES: MeshEntry[] = [
  {
    kind: "node",
    id: "demo-node-edge-1",
    name: "edge-1",
    meshHostname: "edge-1.mesh",
    ipv4: "100.96.0.10",
    ipv6: "2606:4700:cf1:1000::a",
    status: "healthy",
    lastSeenAt: hoursAgo(0.1),
    createdAt: daysAgo(40),
    tunnelType: "warp_connector",
    isConnector: true,
  },
  {
    kind: "node",
    id: "demo-node-lab",
    name: "lab-gw",
    meshHostname: "lab-gw.mesh",
    ipv4: "100.96.0.20",
    ipv6: "2606:4700:cf1:1000::14",
    status: "healthy",
    lastSeenAt: hoursAgo(2),
    createdAt: daysAgo(28),
    tunnelType: "warp_connector",
    isConnector: true,
  },
  {
    kind: "node",
    id: "demo-node-spare",
    name: "spare-node",
    meshHostname: null,
    ipv4: null,
    ipv6: null,
    status: "down",
    lastSeenAt: null,
    createdAt: daysAgo(3),
    tunnelType: "warp_connector",
    isConnector: true,
  },
  {
    kind: "device",
    id: "demo-dev-laptop",
    deviceId: "demo-dev-laptop-device",
    name: "bagas-laptop",
    meshHostname: "bagas-laptop.mesh",
    ipv4: "100.96.0.40",
    ipv6: "2606:4700:cf1:1000::28",
    status: "online",
    lastSeenAt: hoursAgo(0.2),
    createdAt: daysAgo(14),
    tunnelType: "wireguard",
    isConnector: false,
  },
  {
    kind: "device",
    id: "demo-dev-phone",
    deviceId: "demo-dev-phone-device",
    name: "pixel-9",
    meshHostname: "pixel-9.mesh",
    ipv4: "100.96.0.41",
    ipv6: "2606:4700:cf1:1000::29",
    status: "online",
    lastSeenAt: hoursAgo(0.05),
    createdAt: daysAgo(10),
    tunnelType: "masque",
    isConnector: false,
  },
  {
    kind: "device",
    id: "demo-dev-tablet",
    deviceId: "demo-dev-tablet-device",
    name: "ipad-mini",
    meshHostname: "ipad-mini.mesh",
    ipv4: "100.96.0.42",
    ipv6: null,
    status: "offline",
    lastSeenAt: daysAgo(2),
    createdAt: daysAgo(21),
    tunnelType: "wireguard",
    isConnector: false,
  },
  {
    kind: "device",
    id: "demo-dev-stale",
    deviceId: "demo-dev-stale-device",
    name: "old-chromebook",
    meshHostname: "old-chromebook.mesh",
    ipv4: "100.96.0.50",
    ipv6: null,
    status: "offline",
    lastSeenAt: daysAgo(12),
    createdAt: daysAgo(60),
    tunnelType: "wireguard",
    isConnector: false,
  },
];

export const DEMO_SETTINGS: Settings & { demo: true } = {
  demo: true,
  offlineDays: 7,
  dnsFilterEnabled: true,
  dnsFilterStatus: "enabled",
  dnsFilterUrl: "https://small.oisd.nl/",
  dnsFilterLastSyncedAt: hoursAgo(3),
  meshSuffix: "mesh",
  lastDnsSyncAt: hoursAgo(0.5),
  lastCleanupAt: daysAgo(1),
  accountName: "Demo Org",
  accountEmail: "demo@meshflare.example",
};

export function isDemoMode(env: { DEMO_MODE?: string | boolean }): boolean {
  const v = env.DEMO_MODE;
  if (typeof v === "boolean") return v;
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

export const DEMO_READ_ONLY =
  "Demo is read-only. Deploy your own meshflare instance to create, rename, or delete machines.";
