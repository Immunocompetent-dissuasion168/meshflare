/**
 * WireGuard .conf extraction for mesh nodes.
 * Runs warp-cli locally inside the meshflare container (no separate extractor).
 *
 * Important: warp-svc briefly rewrites container networking during enroll, which
 * resets long-lived HTTP responses. Prefer the async job API over a sync GET.
 */

let extractLock: Promise<void> = Promise.resolve();

const EXTRACT_TIMEOUT_MS = 120_000;

export function decodeConnectorToken(token: string): {
  account_tag: string;
  tunnel_id: string;
  tunnel_secret: string;
} {
  const json = JSON.parse(atob(token)) as { a: string; t: string; s: string };
  if (!json.a || !json.t || !json.s) {
    throw new Error("Invalid connector token payload");
  }
  return {
    account_tag: json.a,
    tunnel_id: json.t,
    tunnel_secret: json.s,
  };
}

function scriptPath(): string {
  return process.env.WG_EXTRACT_SCRIPT?.trim() || `${import.meta.dir}/../../scripts/wg-extract.sh`;
}

/** Keep only the WireGuard conf body if the CLI leaked chatter onto stdout. */
export function sanitizeWireGuardConf(raw: string): string {
  const text = raw.replace(/^\uFEFF/, "").trim();
  const start = text.search(/^(?:#|\s*\[Interface\])/m);
  const conf = (start >= 0 ? text.slice(start) : text).trim();
  if (!conf.includes("[Interface]") || !conf.includes("[Peer]")) {
    throw new Error("WireGuard extract returned an invalid config");
  }
  return `${conf}\n`;
}

export async function extractWireGuardConf(token: string, dnsServers: string[]): Promise<string> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const prev = extractLock;
  extractLock = prev.then(() => gate);
  await prev;

  try {
    const proc = Bun.spawn([scriptPath()], {
      env: {
        ...process.env,
        CONNECTOR_TOKEN: token,
        WARP_DNS_SERVERS: dnsServers.join(", "),
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
      // Ensure warp-svc cannot linger and keep holding the extract lock's work.
      try {
        Bun.spawnSync(["pkill", "-9", "-x", "warp-svc"]);
      } catch {
        /* ignore */
      }
    }, EXTRACT_TIMEOUT_MS);

    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      if (timedOut) {
        throw new Error("WireGuard generate timed out after 120s");
      }
      if (exitCode !== 0) {
        throw new Error(
          (stderr || stdout || `WireGuard extract failed (exit ${exitCode})`).trim(),
        );
      }
      return sanitizeWireGuardConf(stdout);
    } finally {
      clearTimeout(timeout);
    }
  } finally {
    release();
  }
}
