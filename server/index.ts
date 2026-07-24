import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cleanupOfflineDevices } from "../worker/cf/cleanup";
import { createCfClient } from "../worker/cf/client";
import { syncMeshDns } from "../worker/cf/dns";
import {
  getSettings,
  markCleanupRan,
  processDnsFilterTick,
} from "../worker/cf/dns-filter";
import { api } from "../worker/routes/api";
import type { Env } from "../worker/types";
import { loadEnv } from "./env";

const env = await loadEnv();
const app = new Hono<{ Bindings: Env }>();

app.route("/api", api);

app.use("/*", serveStatic({ root: "./dist" }));
app.get("*", serveStatic({ path: "./dist/index.html" }));

async function runCron(bindings: Env): Promise<void> {
  const cf = createCfClient(bindings);
  const settings = await getSettings(bindings);

  const dns = await syncMeshDns(cf, bindings);
  console.log("meshflare dns sync", dns);

  const cleanup = await cleanupOfflineDevices(cf, settings.offlineDays);
  if (cleanup.deleted > 0) {
    console.log("meshflare offline cleanup", cleanup);
    await markCleanupRan(bindings);
    await syncMeshDns(cf, bindings);
  }

  const filter = await processDnsFilterTick(cf, bindings);
  console.log("meshflare dns filter", filter);
}

const port = Number(env.PORT) || 3000;

Bun.serve({
  port,
  fetch: (req) => app.fetch(req, env),
});

console.log(`meshflare listening on :${port}`);

void runCron(env).catch((e) => console.error("meshflare startup cron", e));
setInterval(() => {
  void runCron(env).catch((e) => console.error("meshflare cron", e));
}, 60_000);
