import type { CloudflareClient } from "./client";

export type SplitTunnelItem = {
  address?: string;
  host?: string;
  description?: string;
};

export type SplitTunnelMode = "include" | "exclude";

type DevicePolicy = {
  include?: SplitTunnelItem[];
  exclude?: SplitTunnelItem[];
};

export async function getDefaultSplitTunnels(
  cf: CloudflareClient,
): Promise<{ mode: SplitTunnelMode; items: SplitTunnelItem[] }> {
  const res = await cf.request<DevicePolicy>("GET", cf.accountPath("/devices/policy"));
  const mode: SplitTunnelMode = res.result.include ? "include" : "exclude";
  return { mode, items: res.result[mode] ?? [] };
}

export async function setDefaultSplitTunnels(
  cf: CloudflareClient,
  mode: SplitTunnelMode,
  items: SplitTunnelItem[],
): Promise<SplitTunnelItem[]> {
  const res = await cf.request<SplitTunnelItem[]>(
    "PUT",
    cf.accountPath(`/devices/policy/${mode}`),
    items,
  );
  return res.result ?? [];
}
