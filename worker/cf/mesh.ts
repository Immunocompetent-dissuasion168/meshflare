import type { CloudflareClient } from "./client";
import type { DeviceRegistration, MeshNode } from "../types";

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

export async function deleteMeshNode(
  cf: CloudflareClient,
  tunnelId: string,
): Promise<void> {
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
