import { extractWireGuardConf } from "./extractor";

export type WireGuardJobStatus = "pending" | "done" | "error";

export type WireGuardJob = {
  id: string;
  nodeId: string;
  filename: string;
  status: WireGuardJobStatus;
  conf?: string;
  error?: string;
  createdAt: number;
  finishedAt?: number;
};

const jobs = new Map<string, WireGuardJob>();
const JOB_TTL_MS = 15 * 60_000;

function pruneJobs(now = Date.now()): void {
  for (const [id, job] of jobs) {
    const anchor = job.finishedAt ?? job.createdAt;
    if (now - anchor > JOB_TTL_MS) jobs.delete(id);
  }
}

function newJobId(): string {
  return crypto.randomUUID();
}

export function getWireGuardJob(id: string): WireGuardJob | undefined {
  pruneJobs();
  return jobs.get(id);
}

/**
 * Queue a generate job and return immediately. The HTTP request that starts the
 * job must not wait for warp-svc — enroll resets long-lived response sockets.
 */
export function startWireGuardJob(input: {
  nodeId: string;
  filename: string;
  token: string;
}): WireGuardJob {
  pruneJobs();
  const job: WireGuardJob = {
    id: newJobId(),
    nodeId: input.nodeId,
    filename: input.filename.endsWith(".conf")
      ? input.filename
      : `${input.filename}.conf`,
    status: "pending",
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);

  void (async () => {
    try {
      const conf = await extractWireGuardConf(input.token);
      job.conf = conf;
      job.status = "done";
      job.finishedAt = Date.now();
    } catch (err) {
      job.status = "error";
      job.error = err instanceof Error ? err.message : String(err);
      job.finishedAt = Date.now();
      console.error("meshflare wireguard job failed", job.id, job.error);
    }
  })();

  return job;
}
