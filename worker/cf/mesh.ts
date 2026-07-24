import type { CloudflareClient } from "./client";
import type { DeviceRegistration, MeshNode, MeshRoute } from "../types";

export async function listMeshNodes(cf: CloudflareClient): Promise<MeshNode[]> {
  const res = await cf.request<MeshNode[]>("GET", cf.accountPath("/warp_connector"));
  return res.result ?? [];
}

export async function createMeshNode(
  cf: CloudflareClient,
  name: string,
): Promise<MeshNode> {
  const res = await cf.request<MeshNode>("POST", cf.accountPath("/warp_connector"), {
    name,
  });
  return res.result;
}

export async function renameMeshNode(
  cf: CloudflareClient,
  tunnelId: string,
  name: string,
): Promise<MeshNode> {
  const res = await cf.request<MeshNode>(
    "PATCH",
    cf.accountPath(`/warp_connector/${tunnelId}`),
    { name },
  );
  return res.result;
}

export async function listMeshNodeRoutes(
  cf: CloudflareClient,
  tunnelId: string,
): Promise<MeshRoute[]> {
  const query = new URLSearchParams({
    tunnel_id: tunnelId,
    is_deleted: "false",
    tun_types: "warp_connector",
    per_page: "1000",
  });
  const res = await cf.request<MeshRoute[]>(
    "GET",
    cf.accountPath(`/teamnet/routes?${query}`),
  );
  return res.result ?? [];
}

export async function listMeshNodeHostnameRoutes(
  cf: CloudflareClient,
  tunnelId: string,
): Promise<MeshRoute[]> {
  const query = new URLSearchParams({ tunnel_id: tunnelId, is_deleted: "false", per_page: "1000" });
  const res = await cf.request<MeshRoute[]>(
    "GET",
    cf.accountPath(`/zerotrust/routes/hostname?${query}`),
  );
  return res.result ?? [];
}

export async function createMeshNodeHostnameRoute(
  cf: CloudflareClient,
  tunnelId: string,
  hostname: string,
  comment?: string,
): Promise<MeshRoute> {
  const res = await cf.request<MeshRoute>(
    "POST",
    cf.accountPath("/zerotrust/routes/hostname"),
    { tunnel_id: tunnelId, hostname, ...(comment ? { comment } : {}) },
  );
  return res.result;
}

export async function deleteMeshNodeHostnameRoute(
  cf: CloudflareClient,
  routeId: string,
): Promise<void> {
  await cf.request("DELETE", cf.accountPath(`/zerotrust/routes/hostname/${routeId}`));
}

export async function createMeshNodeRoute(
  cf: CloudflareClient,
  tunnelId: string,
  network: string,
  comment?: string,
): Promise<MeshRoute> {
  const res = await cf.request<MeshRoute>("POST", cf.accountPath("/teamnet/routes"), {
    tunnel_id: tunnelId,
    network,
    ...(comment ? { comment } : {}),
  });
  return res.result;
}

export async function deleteMeshNodeRoute(
  cf: CloudflareClient,
  routeId: string,
): Promise<void> {
  await cf.request("DELETE", cf.accountPath(`/teamnet/routes/${routeId}`));
}

export async function deleteMeshNode(
  cf: CloudflareClient,
  tunnelId: string,
): Promise<void> {
  const [routes, hostnameRoutes] = await Promise.all([
    listMeshNodeRoutes(cf, tunnelId),
    listMeshNodeHostnameRoutes(cf, tunnelId),
  ]);
  for (const route of routes) {
    if (route.id) await deleteMeshNodeRoute(cf, route.id);
  }
  for (const route of hostnameRoutes) {
    if (route.id) await deleteMeshNodeHostnameRoute(cf, route.id);
  }
  await cf.request("DELETE", cf.accountPath(`/warp_connector/${tunnelId}`));
}

/** Base64 connector token JSON `{a,t,s}` for warp-cli / WireGuard extract. */
export async function getMeshNodeToken(
  cf: CloudflareClient,
  tunnelId: string,
): Promise<string> {
  const res = await cf.request<string>(
    "GET",
    cf.accountPath(`/warp_connector/${tunnelId}/token`),
  );
  return res.result;
}

export async function listDeviceRegistrations(
  cf: CloudflareClient,
  status: "active" | "all" = "active",
): Promise<DeviceRegistration[]> {
  const devices: DeviceRegistration[] = [];
  let cursor: string | undefined;

  for (;;) {
    const qs = new URLSearchParams({ per_page: "50", status });
    if (cursor) qs.set("cursor", cursor);
    const res = await cf.request<DeviceRegistration[]>(
      "GET",
      cf.accountPath(`/devices/registrations?${qs}`),
    );
    devices.push(...(res.result ?? []));
    cursor = res.result_info?.cursor;
    if (!cursor) break;
  }

  return devices;
}

export async function renameDevice(
  cf: CloudflareClient,
  deviceId: string,
  name: string,
): Promise<unknown> {
  const res = await cf.request(
    "PATCH",
    cf.accountPath(`/devices/${deviceId}`),
    { name },
  );
  return res.result;
}

export async function deleteDeviceRegistration(
  cf: CloudflareClient,
  registrationId: string,
): Promise<void> {
  await cf.request(
    "DELETE",
    cf.accountPath(`/devices/registrations/${registrationId}`),
  );
}
