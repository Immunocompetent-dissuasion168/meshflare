import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { cleanupOfflineDevices } from "../cf/cleanup";
import { createCfClient, CloudflareApiError } from "../cf/client";
import { buildMeshInventory, syncMeshDns } from "../cf/dns";
import { getMeshNodeToken } from "../cf/mesh";
import { getSettings, processOisdTick, updateSettings } from "../cf/oisd";
import {
  createNodeWithUniqueName,
  deleteMeshEntry,
  renameWithCollisionHandling,
} from "../cf/rename";
import type { Env } from "../types";
import { decodeConnectorToken, extractWireGuardConf } from "../wg/extractor";

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
  const settings = await getSettings(c.env);
  return c.json({
    ...settings,
    accountIdConfigured: Boolean(c.env.CLOUDFLARE_ACCOUNT_ID),
    meshSuffix: c.env.MESH_DNS_SUFFIX || "mesh",
  });
});

api.patch("/settings", async (c) => {
  const body = await c.req.json<{ offlineDays?: number; oisdEnabled?: boolean }>();
  const settings = await updateSettings(c.env, body);
  return c.json(settings);
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
  const dns = await syncMeshDns(cf, c.env);
  return c.json({ ...result, dns });
});

api.delete("/mesh/:kind/:id", async (c) => {
  const kind = c.req.param("kind");
  if (kind !== "node" && kind !== "device") {
    throw new HTTPException(400, { message: "kind must be node or device" });
  }
  const cf = createCfClient(c.env);
  await deleteMeshEntry(cf, kind, c.req.param("id"));
  const dns = await syncMeshDns(cf, c.env);
  return c.json({ ok: true, dns });
});

api.post("/mesh/sync-dns", async (c) => {
  const cf = createCfClient(c.env);
  const dns = await syncMeshDns(cf, c.env);
  return c.json({ dns });
});

api.post("/mesh/cleanup", async (c) => {
  const cf = createCfClient(c.env);
  const settings = await getSettings(c.env);
  const cleanup = await cleanupOfflineDevices(cf, settings.offlineDays);
  const dns = await syncMeshDns(cf, c.env);
  return c.json({ cleanup, dns });
});

api.get("/mesh/nodes/:id/wireguard", async (c) => {
  const cf = createCfClient(c.env);
  const id = c.req.param("id");
  const token = await getMeshNodeToken(cf, id);
  // Validate token shape early
  decodeConnectorToken(token);

  const inventory = await buildMeshInventory(cf, c.env);
  const node = inventory.find((e) => e.kind === "node" && e.id === id);
  const name = node?.name ?? id;

  const result = await extractWireGuardConf(c.env, token);
  if ("conf" in result) {
    return new Response(result.conf, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}.conf"`,
      },
    });
  }

  return c.json(
    {
      needsDocker: true,
      nodeName: name,
      token: result.token,
      command: result.command,
      note:
        "Cloudflare connector enrollment uses proprietary wdapi. Run this Docker command locally (requires a WireGuard device profile). Or set WG_EXTRACTOR_URL to a self-hosted extractor.",
    },
    200,
  );
});

api.get("/mesh/nodes/:id/token", async (c) => {
  const cf = createCfClient(c.env);
  const token = await getMeshNodeToken(cf, c.req.param("id"));
  const decoded = decodeConnectorToken(token);
  return c.json({ token, decoded });
});
