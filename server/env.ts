import { join } from "node:path";
import type { Env } from "../worker/types";
import { openAppDb, openObjectCache } from "./store";

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is required`);
  return v;
}

export async function loadEnv(): Promise<Env> {
  const dataDir = process.env.DATA_DIR?.trim() || "./data";
  return {
    DATA_DIR: dataDir,
    PORT: process.env.PORT?.trim() || "3000",
    DB: await openAppDb(join(dataDir, "db.json")),
    DNS_FILTER_CACHE: openObjectCache(join(dataDir, "dns-filter")),
    CLOUDFLARE_ACCOUNT_ID: required("CLOUDFLARE_ACCOUNT_ID"),
    CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
    CLOUDFLARE_API_KEY: process.env.CLOUDFLARE_API_KEY,
    CLOUDFLARE_EMAIL: process.env.CLOUDFLARE_EMAIL,
    MESH_DNS_SUFFIX: process.env.MESH_DNS_SUFFIX?.trim() || "mesh",
    DEFAULT_OFFLINE_DAYS: process.env.DEFAULT_OFFLINE_DAYS?.trim() || "7",
    DNS_FILTER_LIST_PREFIX:
      process.env.DNS_FILTER_LIST_PREFIX?.trim() || "meshflare-dns-filter",
    DNS_FILTER_RULE_NAME:
      process.env.DNS_FILTER_RULE_NAME?.trim() || "meshflare DNS filter",
    MESH_RULE_PREFIX: process.env.MESH_RULE_PREFIX?.trim() || "meshflare DNS",
  };
}
