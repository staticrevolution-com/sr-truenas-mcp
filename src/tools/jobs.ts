import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TrueNASClient } from "../client.js";

/**
 * Job observability.
 *
 * 24 actions across this server return a middlewared `@job` id and do not
 * await it (`describeAsyncJob`). Until these two actions existed, **none of
 * the registered actions accepted a job id back**, so every long-running
 * job's outcome — replication runs, cloud syncs, pool scrubs, disk wipes,
 * update applies — was unreachable through this server. The id was a receipt
 * for something the caller could never look up.
 *
 * One general pair, not one query per originating action: a job id is a job
 * id regardless of which action minted it, so a per-action query surface
 * would be 24 near-identical actions whose coverage came from a
 * hand-maintained list — and the list would go stale the first time a 25th
 * action started a job, with nothing reporting it. These two cover every
 * job the middleware has, including ones this server did not start.
 */

/**
 * ⚠ THE ALLOWLIST IS THE SECURITY CONTROL. Do not convert it to a denylist.
 *
 * Measured against TrueNAS 27.0 on 2026-11-27: `core.get_jobs` returns these
 * top-level fields —
 *
 *   abortable, arguments, credentials, description, error, exc_info,
 *   exception, id, logs_excerpt, logs_path, message_ids, method, progress,
 *   result, result_encoding_error, state, time_finished, time_started,
 *   transient
 *
 * Four of those are credential-bearing by construction, not by accident:
 *
 *   - `arguments` — the call arguments verbatim. A `user.create` job carries
 *     the password; an auth-adjacent job carries whatever was passed in.
 *   - `credentials` — the authenticating credential record for the session
 *     that started the job. This is the same exposure class as the
 *     middleware audit log, which stores API key values in plaintext.
 *   - `exc_info` / `exception` — tracebacks, whose frames and reprs can
 *     embed the arguments that caused the failure.
 *
 * And two are unbounded text that can quote anything: `logs_excerpt`,
 * `logs_path`.
 *
 * ⚠ None of the jobs present on the box when this was measured happened to
 * carry a credential. That is exactly why this is an allowlist: a denylist
 * tuned to the values observed on one day is a control calibrated against a
 * reassuring sample. Nothing is returned unless it is named here, so a field
 * the middleware ADDS in a later release is excluded by default rather than
 * passed through until someone notices.
 */
export const JOB_FIELD_ALLOWLIST = [
  "id",
  "method",
  "state",
  "description",
  "progress",
  "result",
  "error",
  "time_started",
  "time_finished",
  "abortable",
  "transient",
] as const;

/** Fields measured present on a job record and deliberately NOT returned. */
export const JOB_FIELD_DENIED = [
  "arguments",
  "credentials",
  "exc_info",
  "exception",
  "logs_excerpt",
  "logs_path",
  "message_ids",
  "result_encoding_error",
] as const;

/**
 * Project a raw middleware job record onto the allowlist.
 *
 * `progress` is rebuilt field-by-field rather than passed through, because
 * `progress.extra` is arbitrary payload set by the job itself.
 */
export function projectJob(raw: unknown): Record<string, unknown> {
  const job = (raw ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const field of JOB_FIELD_ALLOWLIST) {
    if (!(field in job)) continue;
    if (field === "progress") {
      const p = (job.progress ?? {}) as Record<string, unknown>;
      out.progress = {
        percent: typeof p.percent === "number" ? p.percent : null,
        description: typeof p.description === "string" ? p.description : null,
      };
      continue;
    }
    out[field] = job[field];
  }
  return out;
}

const JOB_STATES = ["WAITING", "RUNNING", "SUCCESS", "FAILED", "ABORTED"] as const;

export function register(server: McpServer, client: TrueNASClient): void {
  server.tool(
    "job_get",
    [
      "Look up one middlewared job by the id a long-running action returned.",
      "This is how the outcome of an asynchronous action is reached: actions that start replication runs, cloud syncs, pool scrubs, disk wipes or update applies return a job id and do NOT wait for it, so the id is the only handle on whether the work succeeded.",
      "Reports state (WAITING/RUNNING/SUCCESS/FAILED/ABORTED), progress, the result on success and the error on failure.",
      "An unknown id is reported as NOT FOUND, never as an empty success — so a mistyped id cannot read as 'the job finished with no result'. Note that middlewared expires old job records, so NOT FOUND means 'not retrievable now', not 'never existed'.",
      "Returns job metadata only. The job's own call arguments and the credentials of the session that started it are deliberately not returned; see JOB_FIELD_DENIED in src/tools/jobs.ts for why.",
    ].join(" "),
    {
      job_id: z.number().describe("Job id, as returned by an asynchronous action"),
    },
    async ({ job_id }) => {
      const raw = await client.call("core.get_jobs", [[["id", "=", job_id]]]);
      const rows = Array.isArray(raw) ? raw : [];
      const match = rows.find((j) => (j as { id?: unknown })?.id === job_id);

      if (!match) {
        // An empty query result is a defect report here, not an outcome: the
        // caller asked about a specific id and the only honest answers are
        // the record or its absence. Returning `[]` or `{}` would be
        // indistinguishable from "finished, no result".
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  job_id,
                  found: false,
                  error: `NOT FOUND: no job with id ${job_id} is retrievable from core.get_jobs.`,
                  note:
                    "Either the id is wrong, or middlewared has expired the record. This is NOT a report that the job succeeded with an empty result. Use job_list to see what ids currently exist.",
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      return {
        content: [
          { type: "text", text: JSON.stringify({ found: true, ...projectJob(match) }, null, 2) },
        ],
      };
    },
  );

  server.tool(
    "job_list",
    [
      "List recent middlewared jobs, newest first — every job on the system, not only ones this server started.",
      "Use it to find a job id that was lost, to see what is running now (state: 'RUNNING'), or to check whether a class of work keeps failing (method + state: 'FAILED').",
      "Returns job metadata only: call arguments and session credentials are deliberately excluded.",
    ].join(" "),
    {
      method: z
        .string()
        .optional()
        .describe("Exact middleware method to filter by, e.g. 'pool.scrub.scrub' or 'replication.run'"),
      state: z
        .enum(JOB_STATES)
        .optional()
        .describe("Filter by job state"),
      limit: z
        .number()
        .optional()
        .default(20)
        .describe("Maximum rows to return (default 20). The job table holds thousands; raise it deliberately"),
    },
    async ({ method, state, limit }) => {
      const filters: unknown[] = [];
      if (method) filters.push(["method", "=", method]);
      if (state) filters.push(["state", "=", state]);

      const raw = await client.call("core.get_jobs", [
        filters,
        { limit, order_by: ["-id"] },
      ]);
      const rows = Array.isArray(raw) ? raw : [];

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                count: rows.length,
                filtered_by: { method: method ?? null, state: state ?? null },
                limit,
                // An empty list under a filter is a real answer here (unlike
                // job_get's single-id lookup), so it is reported as such
                // rather than as an error — but it is labelled, so it cannot
                // be mistaken for a failed query.
                note:
                  rows.length === 0
                    ? "No jobs matched. This is a successful query returning zero rows, not a failure."
                    : undefined,
                jobs: rows.map(projectJob),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
