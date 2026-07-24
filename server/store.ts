import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { JSONFilePreset } from "lowdb/node";
import type { Low } from "lowdb";
import type { AppData, ObjectCache } from "../worker/types";

export const defaultAppData = (): AppData => ({
  offlineDays: 7,
  dnsFilterEnabled: false,
  dnsFilterStatus: "idle",
  dnsFilterUrl: "https://small.oisd.nl/",
  dnsFilterLastSyncedAt: null,
  dnsFilterCursor: 0,
  meshSuffix: "mesh",
  lastDnsSyncAt: null,
  lastCleanupAt: null,
});

export type AppDb = Low<AppData>;

export async function openAppDb(dbPath: string): Promise<AppDb> {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = await JSONFilePreset<AppData>(dbPath, defaultAppData());
  // Fill any missing keys from older files.
  db.data = { ...defaultAppData(), ...db.data };
  await db.write();
  return db;
}

export function openObjectCache(dir: string): ObjectCache {
  mkdirSync(dir, { recursive: true });
  return {
    async get(key) {
      const path = join(dir, key);
      const file = Bun.file(path);
      if (!(await file.exists())) return null;
      return {
        async text() {
          return file.text();
        },
      };
    },
    async put(key, value) {
      const path = join(dir, key);
      mkdirSync(dirname(path), { recursive: true });
      await Bun.write(path, value);
    },
    async delete(key) {
      const path = join(dir, key);
      try {
        const { unlinkSync } = await import("node:fs");
        unlinkSync(path);
      } catch {
        /* missing is fine */
      }
    },
  };
}
