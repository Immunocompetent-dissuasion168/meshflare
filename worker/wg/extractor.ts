/**
 * WireGuard .conf extraction for mesh nodes.
 * Runs warp-cli locally inside the meshflare container (no separate extractor).
 */

let extractLock: Promise<void> = Promise.resolve();

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

export async function extractWireGuardConf(token: string): Promise<string> {
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
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    if (exitCode !== 0) {
      throw new Error(
        (stderr || stdout || `WireGuard extract failed (exit ${exitCode})`).trim(),
      );
    }

    const conf = stdout.trim();
    if (!conf.includes("[Interface]") || !conf.includes("[Peer]")) {
      throw new Error("WireGuard extract returned an invalid config");
    }
    return `${conf}\n`;
  } finally {
    release();
  }
}
