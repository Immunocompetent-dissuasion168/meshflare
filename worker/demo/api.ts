import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  DEMO_ENTRIES,
  DEMO_READ_ONLY,
  DEMO_SETTINGS,
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

demoApi.get("/settings", (c) => c.json(DEMO_SETTINGS));

demoApi.get("/mesh", (c) => c.json({ entries: DEMO_ENTRIES, demo: true }));

demoApi.all("/*", (c) => {
  if (c.req.method === "GET" || c.req.method === "HEAD") {
    throw new HTTPException(404, { message: "Not found" });
  }
  throw new HTTPException(403, { message: DEMO_READ_ONLY });
});

export { isDemoMode };
