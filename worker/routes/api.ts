import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { fetchAccountInfo } from "../cf/account";
import { cleanupOfflineDevices } from "../cf/cleanup";
import { createCfClient, CloudflareApiError } from "../cf/client";
import { buildMeshInventory, syncMeshDns, syncMeshDnsAfterDelete, syncMeshDnsAfterRename } from "../cf/dns";
import { getMeshNodeToken } from "../cf/mesh";
import {
  getSettings,
  markCleanupRan,
  markDnsSynced,
  updateSettings,
} from "../cf/dns-filter";
import {
  createNodeWithUniqueName,
  deleteMeshEntry,
  renameWithCollisionHandling,
} from "../cf/rename";
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
    fetchAccountInfo(cf),
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

  const cf = createCfClient(c.env);
  const account = await fetchAccountInfo(cf);
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
