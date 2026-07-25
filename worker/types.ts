/** Shared app env for Bun server and local dev. */

import type { Low } from "lowdb";

export type AppData = {
  offlineDays: number;
  dnsFilterEnabled: boolean;
  dnsFilterStatus: string;
  dnsFilterUrl: string;
  dnsFilterLastSyncedAt: string | null;
  dnsFilterCursor: number;
  meshSuffix: string;
  lastDnsSyncAt: string | null;
  lastCleanupAt: string | null;
};

export type AppDb = Low<AppData>;

export type ObjectCache = {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
};

export type Env = {
  DB: AppDb;
  DNS_FILTER_CACHE: ObjectCache;
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_API_KEY?: string;
  CLOUDFLARE_EMAIL?: string;
  MESH_DNS_SUFFIX: string;
  DEFAULT_OFFLINE_DAYS: string;
  DNS_FILTER_LIST_PREFIX: string;
  DNS_FILTER_RULE_NAME: string;
  MESH_RULE_PREFIX: string;
  DATA_DIR: string;
  PORT: string;
  /** When true/1, serve fixture inventory and reject writes. */
  DEMO_MODE?: string;
};

export type MeshNode = {
  id: string;
  name: string;
  status: string;
  created_at: string;
  tun_type?: string;
  connections?: Array<{
    client_id?: string;
    uuid?: string;
    id?: string;
    opened_at?: string;
    origin_ip?: string;
    colo_name?: string;
  }>;
};

export type MeshRoute = {
  id?: string;
  type?: "cidr" | "hostname";
  network?: string;
  hostname?: string;
  comment?: string;
  created_at?: string;
  deleted_at?: string | null;
  tunnel_id?: string;
  tun_type?: string;
};

export type DeviceRegistration = {
  id: string;
  created_at: string;
  last_seen_at: string | null;
  updated_at?: string;
  tunnel_type?: string;
  virtual_ipv4?: string | null;
  virtual_ipv6?: string | null;
  device: {
    id: string;
    name: string;
    client_version?: string;
  };
  user?: {
    email?: string;
    id?: string;
    name?: string;
  };
};

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

export type RenameResult = {
  renamed: { id: string; kind: "node" | "device"; from: string; to: string };
  displaced?: { id: string; kind: "node" | "device"; from: string; to: string };
  notice?: string;
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
  /** Present when DEMO_MODE is on. */
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
    endpoints: {
      ipv4: boolean;
      ipv6: boolean;
      doh: boolean;
    };
  } | null;
};

export type CfApiResult<T> = {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: unknown[];
  result: T;
  result_info?: {
    cursor?: string;
    count?: number;
    page?: number;
    per_page?: number;
    total_count?: number;
  };
};
