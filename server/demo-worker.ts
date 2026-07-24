import { Hono } from "hono";
import { demoApi } from "../worker/demo/api";

/**
 * Cloudflare Workers entry for the public read-only demo.
 * Static SPA is served via Wrangler assets; this Worker only handles /api/*.
 */
const app = new Hono();
app.route("/api", demoApi);

export default {
  fetch(request: Request, env: { DEMO_MODE?: string }) {
    return app.fetch(request, { ...env, DEMO_MODE: env.DEMO_MODE ?? "true" });
  },
};
