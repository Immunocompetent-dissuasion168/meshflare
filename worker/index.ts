import { Hono } from "hono";
import { cleanupOfflineDevices } from "./cf/cleanup";
import { createCfClient } from "./cf/client";
import { syncMeshDns } from "./cf/dns";
import { getSettings, processOisdTick } from "./cf/oisd";
import { api } from "./routes/api";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

app.route("/api", api);

app.all("*", async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

async function runCron(env: Env): Promise<void> {
  const cf = createCfClient(env);
  const settings = await getSettings(env);

  const dns = await syncMeshDns(cf, env);
  console.log("meshflare dns sync", dns);

  const cleanup = await cleanupOfflineDevices(cf, settings.offlineDays);
  if (cleanup.deleted > 0) {
    console.log("meshflare offline cleanup", cleanup);
    await syncMeshDns(cf, env);
  }

  const oisd = await processOisdTick(cf, env);
  console.log("meshflare oisd", oisd);
}

export default {
  fetch: app.fetch,
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(runCron(env));
  },
};
