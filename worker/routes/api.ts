import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { fetchAccountInfo } from "../cf/account";
import { cleanupOfflineDevices } from "../cf/cleanup";
import { createCfClient, CloudflareApiError } from "../cf/client";
import { buildMeshInventory, syncMeshDns, syncMeshDnsAfterDelete, syncMeshDnsAfterRename } from "../cf/dns";
import {
  createMeshNodeHostnameRoute,
  createMeshNodeRoute,
  deleteMeshNodeHostnameRoute,
  deleteMeshNodeRoute,
  getMeshNodeToken,
  listMeshNodeHostnameRoutes,
  listMeshNodeRoutes,
  recreateMeshNode,
} from "../cf/mesh";
import {
  getSettings,
  markCleanupRan,
  markDnsSynced,
  processDnsFilterTick,
  updateSettings,
} from "../cf/dns-filter";
import {
  createNodeWithUniqueName,
  deleteMeshEntry,
  renameWithCollisionHandling,
} from "../cf/rename";
import { getDefaultSplitTunnels, setDefaultSplitTunnels } from "../cf/split-tunnels";
import type { Env } from "../types";
import { decodeConnectorToken } from "../wg/extractor";
import { getWireGuardJob, startWireGuardJob } from "../wg/jobs";

type AppEnv = { Bindings: Env };

export const api = new Hono<AppEnv>();

api.onError((err, c) => {
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  if (err instanceof CloudflareApiError) {
    return c.json({ error: err.message, errors: err.errors }, err.status >= 400 ? (err.status as 400) : 502);
  }
  console.error(err);
  return c.json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
});

api.get("/health", (c) => c.json({ ok: true, service: "meshflare" }));

api.get("/settings", async (c) => {
  const cf = createCfClient(c.env);
  const [settings, account] = await Promise.all([
    getSettings(c.env),
    fetchAccountInfo(cf, c.env.CLOUDFLARE_EMAIL),
  ]);
  return c.json({
    ...settings,
    accountName: account.name,
    accountEmail: account.email,
  });
});

api.patch("/settings", async (c) => {
  const body = await c.req.json<{
    offlineDays?: number;
    dnsFilterEnabled?: boolean;
    dnsFilterUrl?: string;
    meshSuffix?: string;
  }>();
  const before = await getSettings(c.env);
  const settings = await updateSettings(c.env, body);

  const suffixChanged =
    body.meshSuffix !== undefined && settings.meshSuffix !== before.meshSuffix;
  if (suffixChanged) {
    const cf = createCfClient(c.env);
    await syncMeshDns(cf, c.env);
    await markDnsSynced(c.env);
  }

  const filterTouched =
    body.dnsFilterEnabled !== undefined || body.dnsFilterUrl !== undefined;
  if (filterTouched) {
    const cf = createCfClient(c.env);
    // Advance filter status immediately instead of waiting for the 60s cron.
    void processDnsFilterTick(cf, c.env).catch((err) =>
      console.error("meshflare dns filter tick", err),
    );
  }

  const cf = createCfClient(c.env);
  const account = await fetchAccountInfo(cf, c.env.CLOUDFLARE_EMAIL);
  return c.json({
    ...(await getSettings(c.env)),
    accountName: account.name,
    accountEmail: account.email,
  });
});

api.get("/mesh", async (c) => {
  const cf = createCfClient(c.env);
  const entries = await buildMeshInventory(cf, c.env);
  return c.json({ entries });
});

api.post("/mesh/nodes", async (c) => {
  const body = await c.req.json<{ name?: string }>();
  if (!body.name?.trim()) throw new HTTPException(400, { message: "name is required" });
  const cf = createCfClient(c.env);
  const { node, notice } = await createNodeWithUniqueName(cf, body.name);
  const dns = await syncMeshDns(cf, c.env);
  await markDnsSynced(c.env);
  return c.json({ node, notice, dns }, 201);
});

api.patch("/mesh/:kind/:id", async (c) => {
  const kind = c.req.param("kind");
  if (kind !== "node" && kind !== "device") {
    throw new HTTPException(400, { message: "kind must be node or device" });
  }
  const body = await c.req.json<{ name?: string }>();
  if (!body.name?.trim()) throw new HTTPException(400, { message: "name is required" });

  const cf = createCfClient(c.env);
  const result = await renameWithCollisionHandling(cf, kind, c.req.param("id"), body.name);
  const dns = await syncMeshDnsAfterRename(cf, c.env, result);
  await markDnsSynced(c.env);
  return c.json({ ...result, dns });
});

api.delete("/mesh/:kind/:id", async (c) => {
  const kind = c.req.param("kind");
  if (kind !== "node" && kind !== "device") {
    throw new HTTPException(400, { message: "kind must be node or device" });
  }
  const cf = createCfClient(c.env);
  const id = c.req.param("id");
  const inventory = await buildMeshInventory(cf, c.env);
  const entry = inventory.find((e) => e.kind === kind && e.id === id);
  await deleteMeshEntry(cf, kind, id);
  const dns = entry
    ? await syncMeshDnsAfterDelete(cf, c.env, entry)
    : await syncMeshDns(cf, c.env);
  await markDnsSynced(c.env);
  return c.json({ ok: true, dns });
});

api.get("/mesh/nodes/:id/routes", async (c) => {
  const cf = createCfClient(c.env);
  const id = c.req.param("id");
  const [cidrRoutes, hostnameRoutes] = await Promise.all([
    listMeshNodeRoutes(cf, id),
    listMeshNodeHostnameRoutes(cf, id),
  ]);
  return c.json({
    routes: [
      ...cidrRoutes.map((route) => ({ ...route, type: "cidr" as const })),
      ...hostnameRoutes.map((route) => ({ ...route, type: "hostname" as const })),
    ],
  });
});

api.post("/mesh/nodes/:id/routes", async (c) => {
  const body = await c.req.json<{
    type?: "cidr" | "hostname";
    network?: string;
    hostname?: string;
    comment?: string;
  }>();
  const type = body.type ?? "cidr";
  const value = type === "hostname" ? body.hostname?.trim() : body.network?.trim();
  const comment = body.comment?.trim();
  if (!value) throw new HTTPException(400, { message: `${type === "hostname" ? "hostname" : "network"} is required` });
  if (comment && comment.length > 100) {
    throw new HTTPException(400, { message: "comment must be 100 characters or fewer" });
  }
  const cf = createCfClient(c.env);
  const route = type === "hostname"
    ? await createMeshNodeHostnameRoute(cf, c.req.param("id"), value, comment)
    : await createMeshNodeRoute(cf, c.req.param("id"), value, comment);
  return c.json({ route: { ...route, type } }, 201);
});

api.delete("/mesh/nodes/:id/routes/:routeId", async (c) => {
  const cf = createCfClient(c.env);
  const nodeId = c.req.param("id");
  const routeId = c.req.param("routeId");
  const [cidrRoutes, hostnameRoutes] = await Promise.all([
    listMeshNodeRoutes(cf, nodeId),
    listMeshNodeHostnameRoutes(cf, nodeId),
  ]);
  if (cidrRoutes.some((route) => route.id === routeId)) {
    await deleteMeshNodeRoute(cf, routeId);
  } else if (hostnameRoutes.some((route) => route.id === routeId)) {
    await deleteMeshNodeHostnameRoute(cf, routeId);
  } else {
    throw new HTTPException(404, { message: "Route not found for this node" });
  }
  return c.json({ ok: true });
});

api.get("/settings/split-tunnels", async (c) => {
  const cf = createCfClient(c.env);
  return c.json(await getDefaultSplitTunnels(cf));
});

api.put("/settings/split-tunnels", async (c) => {
  const body = await c.req.json<{
    mode?: "include" | "exclude";
    items?: Array<{ address?: string; host?: string; description?: string }>;
  }>();
  if (body.mode !== "include" && body.mode !== "exclude") {
    throw new HTTPException(400, { message: "mode must be include or exclude" });
  }
  if (!Array.isArray(body.items)) {
    throw new HTTPException(400, { message: "items is required" });
  }
  const items = body.items.map((item) => ({
    ...(item.address?.trim() ? { address: item.address.trim() } : {}),
    ...(item.host?.trim() ? { host: item.host.trim() } : {}),
    ...(item.description?.trim() ? { description: item.description.trim() } : {}),
  }));
  if (items.some((item) => (!item.address && !item.host) || (item.address && item.host))) {
    throw new HTTPException(400, { message: "each item must contain one address or host" });
  }
  const cf = createCfClient(c.env);
  await setDefaultSplitTunnels(cf, body.mode, items);
  return c.json(await getDefaultSplitTunnels(cf));
});

api.post("/mesh/sync-dns", async (c) => {
  const cf = createCfClient(c.env);
  const dns = await syncMeshDns(cf, c.env);
  await markDnsSynced(c.env);
  return c.json({ dns, lastDnsSyncAt: new Date().toISOString() });
});

api.post("/mesh/cleanup", async (c) => {
  const cf = createCfClient(c.env);
  const settings = await getSettings(c.env);
  const cleanup = await cleanupOfflineDevices(cf, settings.offlineDays);
  const dns = await syncMeshDns(cf, c.env);
  await markCleanupRan(c.env);
  await markDnsSynced(c.env);
  return c.json({ cleanup, dns, lastCleanupAt: new Date().toISOString() });
});

/**
 * Start WireGuard .conf generation. Returns immediately with a job id — do not
 * stream the conf on this request (warp-svc resets long-lived HTTP sockets).
 */
api.post("/mesh/nodes/:id/wireguard", async (c) => {
  const cf = createCfClient(c.env);
  const id = c.req.param("id");
  const token = await getMeshNodeToken(cf, id);
  decodeConnectorToken(token);

  const inventory = await buildMeshInventory(cf, c.env);
  const node = inventory.find((e) => e.kind === "node" && e.id === id);
  const name = node?.name ?? id;

  const job = startWireGuardJob({ nodeId: id, filename: name, token });
  return c.json({ jobId: job.id, status: job.status, filename: job.filename }, 202);
});

api.get("/mesh/wireguard/jobs/:jobId", async (c) => {
  const job = getWireGuardJob(c.req.param("jobId"));
  if (!job) {
    throw new HTTPException(404, { message: "WireGuard job not found or expired" });
  }
  if (job.status === "pending") {
    return c.json({
      jobId: job.id,
      status: job.status,
      filename: job.filename,
    });
  }
  if (job.status === "error") {
    return c.json(
      {
        jobId: job.id,
        status: job.status,
        filename: job.filename,
        error: job.error ?? "WireGuard generate failed",
      },
      500,
    );
  }
  return c.json({
    jobId: job.id,
    status: job.status,
    filename: job.filename,
    conf: job.conf,
  });
});

api.get("/mesh/nodes/:id/token", async (c) => {
  const cf = createCfClient(c.env);
  const token = await getMeshNodeToken(cf, c.req.param("id"));
  const decoded = decodeConnectorToken(token);
  return c.json({ token, decoded });
});

api.post("/mesh/nodes/:id/regenerate", async (c) => {
  const cf = createCfClient(c.env);
  const node = await recreateMeshNode(cf, c.req.param("id"));
  return c.json({ node }, 201);
});
