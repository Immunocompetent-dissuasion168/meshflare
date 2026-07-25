import type { CloudflareClient } from "./client";
import type { CloudflareConnector, CloudflareTunnel, TunnelConfig } from "../types";

export async function listTunnels(
  cf: CloudflareClient,
  status?: string,
): Promise<CloudflareTunnel[]> {
  const qs = new URLSearchParams({ tun_types: "cfd_tunnel", is_deleted: "false", per_page: "1000" });
  if (status) qs.set("status", status);
  const res = await cf.request<CloudflareTunnel[]>("GET", cf.accountPath(`/tunnels?${qs}`));
  return res.result ?? [];
}

export async function createTunnel(
  cf: CloudflareClient,
  name: string,
  configSrc: "local" | "cloudflare" = "cloudflare",
): Promise<CloudflareTunnel> {
  const res = await cf.request<CloudflareTunnel>("POST", cf.accountPath("/cfd_tunnel"), {
    name,
    config_src: configSrc,
  });
  return res.result;
}

export async function getTunnel(
  cf: CloudflareClient,
  tunnelId: string,
): Promise<CloudflareTunnel> {
  const res = await cf.request<CloudflareTunnel>("GET", cf.accountPath(`/cfd_tunnel/${tunnelId}`));
  return res.result;
}

export async function updateTunnel(
  cf: CloudflareClient,
  tunnelId: string,
  body: { name?: string; config_src?: "local" | "cloudflare" },
): Promise<CloudflareTunnel> {
  const res = await cf.request<CloudflareTunnel>(
    "PATCH",
    cf.accountPath(`/cfd_tunnel/${tunnelId}`),
    body,
  );
  return res.result;
}

export async function deleteTunnel(
  cf: CloudflareClient,
  tunnelId: string,
): Promise<void> {
  await cf.request("DELETE", cf.accountPath(`/cfd_tunnel/${tunnelId}`));
}

export async function getTunnelToken(
  cf: CloudflareClient,
  tunnelId: string,
): Promise<string> {
  const res = await cf.request<string>("GET", cf.accountPath(`/cfd_tunnel/${tunnelId}/token`));
  return res.result;
}

export async function getTunnelConfig(
  cf: CloudflareClient,
  tunnelId: string,
): Promise<TunnelConfig> {
  const res = await cf.request<TunnelConfig>(
    "GET",
    cf.accountPath(`/cfd_tunnel/${tunnelId}/configurations`),
  );
  return res.result;
}

export async function setTunnelConfig(
  cf: CloudflareClient,
  tunnelId: string,
  config: TunnelConfig,
): Promise<TunnelConfig> {
  const res = await cf.request<TunnelConfig>(
    "PUT",
    cf.accountPath(`/cfd_tunnel/${tunnelId}/configurations`),
    config,
  );
  return res.result;
}

export async function getTunnelConnections(
  cf: CloudflareClient,
  tunnelId: string,
): Promise<CloudflareConnector[]> {
  const res = await cf.request<CloudflareConnector[]>(
    "GET",
    cf.accountPath(`/cfd_tunnel/${tunnelId}/connections`),
  );
  return res.result ?? [];
}
