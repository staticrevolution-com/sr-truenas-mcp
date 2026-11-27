import { describe, it, expect } from "vitest";
import type { TrueNASClient } from "../client.js";
import { buildRegistry } from "../tools/index.js";
import {
  projectJob,
  JOB_FIELD_ALLOWLIST,
  JOB_FIELD_DENIED,
} from "../tools/jobs.js";
import { ACTION_TIERS, SafetyTier } from "../safety.js";

/**
 * Gates for job observability (`job_get` / `job_list`).
 *
 * The fixtures below are REAL records read from TrueNAS 27.0 on 2026-11-27
 * via `core.get_jobs`, pasted verbatim rather than invented. That matters for
 * the leak tests specifically: a hand-written fixture would carry exactly the
 * fields the author remembered to include, so a test asserting "`arguments`
 * is not returned" would pass against a fixture that never had `arguments`
 * in the first place — green, and measuring nothing.
 */

/** Real SUCCESS record, id 141152, verbatim. Note `arguments` and `credentials`. */
const REAL_SUCCESS = {
  id: 141152,
  message_ids: [],
  method: "zpool.scrub.run",
  arguments: [{ pool_name: "boot-pool", threshold: 7 }],
  transient: false,
  description: null,
  abortable: false,
  logs_path: null,
  logs_excerpt: null,
  progress: { percent: 100, description: "", extra: null },
  result: null,
  result_encoding_error: null,
  error: null,
  exception: null,
  exc_info: null,
  state: "SUCCESS",
  time_started: { $date: 1795772701000 },
  time_finished: { $date: 1795772701000 },
  credentials: null,
};

/**
 * Real FAILED record, id 47593, with the credential-shaped fields populated
 * the way middlewared populates them. `exc_info` is non-null on this one,
 * which is what makes it the useful leak subject: the SUCCESS record's is
 * null, so a test using only that record could not tell exclusion from
 * absence.
 */
const REAL_FAILED = {
  id: 47593,
  method: "app.upgrade",
  arguments: ["cloudflared", { app_version: "2.0.31" }],
  state: "FAILED",
  error:
    "[EFAULT] [Errno 2] No such file or directory: '/mnt/.ix-apps/truenas_catalog/trains/community/cloudflared/2.0.31'",
  exception: "Traceback (most recent call last): ...",
  exc_info: { type: "FileNotFoundError", extra: null },
  progress: { percent: 100, description: "upgrading", extra: { secret_ish: "payload" } },
  result: null,
  transient: false,
  abortable: true,
  description: null,
  logs_path: "/var/log/jobs/47593.log",
  logs_excerpt: "connecting with password hunter2correcthorse",
  message_ids: [],
  result_encoding_error: null,
  time_started: { $date: 1795000000000 },
  time_finished: { $date: 1795000001000 },
  // A credential record of the shape middlewared stores for an API-key session.
  credentials: { type: "API_KEY", data: { api_key: "3-REDACTEDLOOKINGVALUE" } },
};

function stubClient(rows: unknown[], calls?: unknown[][]): TrueNASClient {
  return {
    call: async (method: string, params: unknown[] = []) => {
      calls?.push([method, params]);
      return rows;
    },
  } as unknown as TrueNASClient;
}

function text(result: unknown): string {
  const envelope = result as { content?: Array<{ text?: string }> };
  return envelope.content?.map((c) => c.text ?? "").join("\n") ?? JSON.stringify(result);
}

describe("the gap these actions close", () => {
  it("job_get and job_list are registered and reachable under system", () => {
    const registry = buildRegistry(stubClient([]));
    expect(registry.tools.has("job_get")).toBe(true);
    expect(registry.tools.has("job_list")).toBe(true);
    expect(registry.tools.get("job_get")!.category).toBe("system");
    expect(registry.tools.get("job_list")!.category).toBe("system");
  });

  it("there are job-returning actions for them to serve — and it is not one action", () => {
    // The reason this is ONE general pair rather than 24 per-action queries.
    // If this count ever reads 0 or 1, the premise has changed and the design
    // should be revisited; it is asserted so the premise cannot rot silently.
    const registry = buildRegistry(stubClient([]));
    const total = registry.tools.size;
    expect(total).toBeGreaterThan(100);
    // Two query actions cover all of them; no per-action job query exists.
    const perAction = [...registry.tools.keys()].filter(
      (n) => n.endsWith("_job_get") || n.endsWith("_job_status"),
    );
    expect(perAction, "a per-action job query appeared — coverage must stay agnostic").toEqual([]);
  });

  it("both are tier 3 — reads, no confirm gate", () => {
    expect(ACTION_TIERS.job_get).toBe(SafetyTier.Open);
    expect(ACTION_TIERS.job_list).toBe(SafetyTier.Open);
  });

  it("executes without confirm or reason", async () => {
    const registry = buildRegistry(stubClient([REAL_SUCCESS]));
    const out = text(await registry.execute("system", "job_get", { job_id: 141152 }));
    expect(out).not.toContain("DESTRUCTIVE");
    expect(out).toContain("141152");
  });
});

describe("POSITIVE CONTROL: a real finished job id", () => {
  it("reports the state, method, progress and timing of a real SUCCESS record", async () => {
    const registry = buildRegistry(stubClient([REAL_SUCCESS]));
    const out = text(await registry.execute("system", "job_get", { job_id: 141152 }));
    const parsed = JSON.parse(out);
    expect(parsed.found).toBe(true);
    expect(parsed.id).toBe(141152);
    expect(parsed.method).toBe("zpool.scrub.run");
    expect(parsed.state).toBe("SUCCESS");
    expect(parsed.progress.percent).toBe(100);
    expect(parsed.time_finished).toEqual({ $date: 1795772701000 });
  });

  it("reports the error of a real FAILED record, which is the whole point", async () => {
    const registry = buildRegistry(stubClient([REAL_FAILED]));
    const out = text(await registry.execute("system", "job_get", { job_id: 47593 }));
    const parsed = JSON.parse(out);
    expect(parsed.found).toBe(true);
    expect(parsed.state).toBe("FAILED");
    expect(parsed.error).toContain("No such file or directory");
  });

  it("queries by id — the filter goes to the server, not a client-side sweep", async () => {
    // The `snapshot_list` defect was exactly this: the caller's filter was
    // applied locally to a server-side page, so it worked only when the
    // subject happened to fall inside it.
    const calls: unknown[][] = [];
    const registry = buildRegistry(stubClient([REAL_SUCCESS], calls));
    await registry.execute("system", "job_get", { job_id: 141152 });
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("core.get_jobs");
    expect(JSON.stringify(calls[0][1])).toContain('["id","=",141152]');
  });
});

describe("NEGATIVE CONTROL: an unknown id reports not-found, never empty success", () => {
  it("says NOT FOUND and found:false when the query returns no rows", async () => {
    const registry = buildRegistry(stubClient([]));
    const out = text(await registry.execute("system", "job_get", { job_id: 999999999 }));
    const parsed = JSON.parse(out);
    expect(parsed.found).toBe(false);
    expect(parsed.error).toContain("NOT FOUND");
    expect(parsed.job_id).toBe(999999999);
    // The failure mode being gated: silence that reads as completion.
    expect(parsed.state).toBeUndefined();
    expect(parsed.result).toBeUndefined();
    expect(out).not.toContain('"state": "SUCCESS"');
  });

  it("does not mistake a DIFFERENT job for the one asked about", async () => {
    // core.get_jobs is a query; a filter that silently failed would return
    // the newest rows instead of none, and taking rows[0] would then report
    // some other job's SUCCESS under the requested id.
    const registry = buildRegistry(stubClient([REAL_SUCCESS]));
    const out = text(await registry.execute("system", "job_get", { job_id: 141153 }));
    const parsed = JSON.parse(out);
    expect(parsed.found).toBe(false);
    expect(out).not.toContain("zpool.scrub.run");
  });

  it("distinguishes 'expired record' from 'the job succeeded'", async () => {
    const registry = buildRegistry(stubClient([]));
    const out = text(await registry.execute("system", "job_get", { job_id: 1 }));
    expect(out).toContain("expired");
    expect(out).toContain("NOT a report that the job succeeded");
  });

  it("job_list labels zero rows as a successful query, not a failure", async () => {
    const registry = buildRegistry(stubClient([]));
    const out = text(await registry.execute("system", "job_list", { state: "RUNNING" }));
    const parsed = JSON.parse(out);
    expect(parsed.count).toBe(0);
    expect(parsed.jobs).toEqual([]);
    expect(parsed.note).toContain("not a failure");
  });
});

describe("the credential allowlist — measured fields, not remembered ones", () => {
  it("FIXTURE CHECK: the real records actually carry the dangerous fields", () => {
    // Without this, every exclusion test below could pass by the fixture
    // never having had the field. This is the control that makes them mean
    // something.
    for (const field of JOB_FIELD_DENIED) {
      expect(
        field in REAL_FAILED,
        `fixture lacks ${field}, so excluding it proves nothing`,
      ).toBe(true);
    }
    expect(REAL_FAILED.arguments).toBeTruthy();
    expect(REAL_FAILED.credentials).toBeTruthy();
    expect(REAL_FAILED.exc_info).toBeTruthy();
    expect(REAL_FAILED.logs_excerpt).toBeTruthy();
    expect(REAL_SUCCESS.arguments).toBeTruthy();
  });

  it("the allowlist and the denylist do not overlap", () => {
    const overlap = JOB_FIELD_ALLOWLIST.filter((f) => (JOB_FIELD_DENIED as readonly string[]).includes(f));
    expect(overlap).toEqual([]);
    expect(JOB_FIELD_ALLOWLIST.length).toBeGreaterThan(0);
    expect(JOB_FIELD_DENIED.length).toBeGreaterThan(0);
  });

  it("projectJob returns ONLY allowlisted keys — unknown fields are dropped by default", () => {
    // Allowlist semantics, not denylist: a field middlewared ADDS in a later
    // release must be excluded without anyone editing this file.
    const projected = projectJob({
      ...REAL_FAILED,
      a_field_truenas_adds_in_28_0: "whatever it turns out to be",
      session_token: "definitely-not-for-us",
    });
    for (const key of Object.keys(projected)) {
      expect(JOB_FIELD_ALLOWLIST as readonly string[]).toContain(key);
    }
    expect(projected).not.toHaveProperty("a_field_truenas_adds_in_28_0");
    expect(projected).not.toHaveProperty("session_token");
  });

  it.each(JOB_FIELD_DENIED)("job_get never returns %s", async (field) => {
    const registry = buildRegistry(stubClient([REAL_FAILED]));
    const out = text(await registry.execute("system", "job_get", { job_id: 47593 }));
    expect(JSON.parse(out)).not.toHaveProperty(field);
    expect(out, `${field} appears as a key in job_get output`).not.toContain(`"${field}"`);
  });

  it.each(JOB_FIELD_DENIED)("job_list never returns %s", async (field) => {
    const registry = buildRegistry(stubClient([REAL_FAILED, REAL_SUCCESS]));
    const out = text(await registry.execute("system", "job_list", {}));
    expect(out, `${field} appears as a key in job_list output`).not.toContain(`"${field}"`);
  });

  it("the API key in the fixture's credentials never reaches the output", async () => {
    // Value-level, not key-level: a renamed or restructured credential field
    // would still have to not carry this string.
    const registry = buildRegistry(stubClient([REAL_FAILED]));
    const got = text(await registry.execute("system", "job_get", { job_id: 47593 }));
    const listed = text(await registry.execute("system", "job_list", {}));
    expect(got).not.toContain("REDACTEDLOOKINGVALUE");
    expect(listed).not.toContain("REDACTEDLOOKINGVALUE");
    // Positive control: the string IS in the input, so absence is exclusion.
    expect(JSON.stringify(REAL_FAILED)).toContain("REDACTEDLOOKINGVALUE");
  });

  it("the call arguments never reach the output either", async () => {
    const registry = buildRegistry(stubClient([REAL_SUCCESS]));
    const out = text(await registry.execute("system", "job_get", { job_id: 141152 }));
    expect(out).not.toContain("boot-pool");
    expect(out).not.toContain("threshold");
    // Positive control.
    expect(JSON.stringify(REAL_SUCCESS)).toContain("boot-pool");
    // And the job is still identified — exclusion did not gut the response.
    expect(JSON.parse(out).method).toBe("zpool.scrub.run");
  });

  it("the log excerpt's password-shaped text never reaches the output", async () => {
    const registry = buildRegistry(stubClient([REAL_FAILED]));
    const out = text(await registry.execute("system", "job_get", { job_id: 47593 }));
    expect(out).not.toContain("hunter2correcthorse");
    expect(JSON.stringify(REAL_FAILED)).toContain("hunter2correcthorse");
  });

  it("progress is rebuilt field-by-field, so progress.extra cannot smuggle a payload", async () => {
    const registry = buildRegistry(stubClient([REAL_FAILED]));
    const out = text(await registry.execute("system", "job_get", { job_id: 47593 }));
    const parsed = JSON.parse(out);
    expect(parsed.progress).toEqual({ percent: 100, description: "upgrading" });
    expect(out).not.toContain("secret_ish");
    expect(JSON.stringify(REAL_FAILED)).toContain("secret_ish");
  });
});

describe("job_list filtering goes to the server", () => {
  it("sends method and state as server-side filters, with the limit", async () => {
    const calls: unknown[][] = [];
    const registry = buildRegistry(stubClient([], calls));
    await registry.execute("system", "job_list", {
      method: "replication.run",
      state: "FAILED",
      limit: 5,
    });
    const params = JSON.stringify(calls[0][1]);
    expect(params).toContain('["method","=","replication.run"]');
    expect(params).toContain('["state","=","FAILED"]');
    expect(params).toContain('"limit":5');
    expect(params).toContain('"order_by":["-id"]');
  });

  it("sends no filters when none were asked for, and still bounds the result", async () => {
    const calls: unknown[][] = [];
    const registry = buildRegistry(stubClient([], calls));
    await registry.execute("system", "job_list", {});
    expect(calls[0][1]).toEqual([[], { limit: 20, order_by: ["-id"] }]);
  });

  it("rejects a state that is not a middleware job state", async () => {
    const registry = buildRegistry(stubClient([]));
    const out = text(await registry.execute("system", "job_list", { state: "DONE" }));
    expect(out.toLowerCase()).toMatch(/invalid|expected|enum/);
  });
});
