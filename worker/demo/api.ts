import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  DEMO_READ_ONLY,
  buildDemoEntries,
  buildDemoRoutes,
  buildDemoSettings,
  isDemoMode,
} from "../demo/fixtures";

type DemoEnv = { DEMO_MODE?: string | boolean };

/** Standalone demo API — no Cloudflare credentials required. */
export const demoApi = new Hono<{ Bindings: DemoEnv }>();

demoApi.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err);
  return c.json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
});

demoApi.get("/health", (c) =>
  c.json({ ok: true, service: "meshflare", demo: true }),
);

demoApi.get("/settings", (c) => c.json(buildDemoSettings()));

demoApi.get("/mesh", (c) => c.json({ entries: buildDemoEntries(), demo: true }));

demoApi.get("/mesh/nodes/:id/routes", (c) =>
  c.json({ routes: buildDemoRoutes(c.req.param("id")) }),
);

demoApi.get("/settings/split-tunnels", (c) =>
  c.json({
    mode: "include" as const,
    include: [
      { address: "100.96.0.0/12", description: "Cloudflare Mesh IPv4" },
      { address: "2606:4700:cf1:1000::/64", description: "Cloudflare Mesh IPv6" },
      { host: "wiki.internal.local", description: "Private application" },
    ],
    exclude: [
      { address: "192.168.0.0/16", description: "Local network" },
      { address: "10.0.0.0/8", description: "Private network" },
    ],
  }),
);

demoApi.all("/*", (c) => {
  if (c.req.method === "GET" || c.req.method === "HEAD") {
    throw new HTTPException(404, { message: "Not found" });
  }
  throw new HTTPException(403, { message: DEMO_READ_ONLY });
});

export { isDemoMode };
