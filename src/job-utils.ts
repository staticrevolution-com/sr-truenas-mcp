import type { TrueNASClient } from "./client.js";

/**
 * Helpers for middlewared `@job` methods, whose immediate return value is a job
 * id (number), not an outcome.
 */

/**
 * Await a short-lived `@job` to completion so a FAILED/ABORTED job surfaces as
 * an error instead of the enqueue being reported as success. Use for jobs that
 * complete quickly (filesystem.setperm/chown/setacl). Non-numeric returns
 * (synchronous methods) pass through unchanged.
 */
export async function awaitJobResult(client: TrueNASClient, raw: unknown): Promise<unknown> {
  if (typeof raw !== "number") return raw;
  const job = await client.waitForJob(raw);
  return job.result ?? { job_id: raw, state: job.state };
}

/**
 * Describe a long-running `@job` that was started but deliberately NOT awaited
 * (replication/cloud sync/backup runs, disk wipe, pool scrub, update apply) —
 * awaiting could block the MCP call for minutes-to-hours. Returns a structured
 * descriptor instead of a bare job-id number so the caller understands the work
 * is asynchronous and its outcome is not yet known. Non-numeric returns pass
 * through unchanged.
 */
export function describeAsyncJob(raw: unknown): unknown {
  if (typeof raw !== "number") return raw;
  return {
    job_id: raw,
    state: "STARTED",
    note: "Long-running background job started; not awaited. This id identifies the job — its final result is not yet known.",
  };
}
