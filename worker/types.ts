export type Env = Cloudflare.Env & {
  CLOUDFLARE_API_KEY?: string;
  CLOUDFLARE_EMAIL?: string;
  WG_EXTRACTOR_SECRET?: string;
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
  oisdEnabled: boolean;
  oisdStatus: string;
  oisdLastSyncedAt?: string | null;
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
