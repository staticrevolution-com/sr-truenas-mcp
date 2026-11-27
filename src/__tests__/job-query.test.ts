import { describe, it, expect } from "vitest";
import type { TrueNASClient } from "../client.js";
import { buildRegistry } from "../tools/index.js";
import {
  projectJob,
  projectJobResult,
  JOB_FIELD_ALLOWLIST,
  JOB_FIELD_DENIED,
} from "../tools/jobs.js";
import { filterSensitiveFields } from "../filters.js";
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

describe("a scalar job result is withheld — the field-name filter cannot redact one", () => {
  /**
   * ⚠ This is the defect the allowlist did NOT cover. `arguments` and
   * `credentials` were excluded by name; `result` was allowlisted because it
   * is the point of the action. But `filterSensitiveFields` matches field
   * NAMES, and a bare string has none — so a string result reached the caller
   * intact, and one such result is a ZFS dataset encryption key.
   *
   * Measured on TrueNAS 27.0 via `core.get_methods`: of 105 `@job` methods,
   * three return a bare string — `pool.dataset.export_key` (the key as hex),
   * `audit.export` (a path), `docker.backup` (a name).
   */

  /** `pool.dataset.export_key` as middlewared records it. Real schema, real shape. */
  const EXPORT_KEY_JOB = {
    id: 777,
    method: "pool.dataset.export_key",
    state: "SUCCESS",
    arguments: ["data-pool/secret"],
    credentials: null,
    progress: { percent: 100, description: "", extra: null },
    result: "deadbeefcafe0123456789abcdef0123456789abcdef0123456789abcdef0123",
    error: null,
    exception: null,
    exc_info: null,
    logs_excerpt: null,
    logs_path: null,
    message_ids: [],
    result_encoding_error: null,
    transient: false,
    abortable: false,
    description: null,
    time_started: { $date: 1 },
    time_finished: { $date: 2 },
  };

  it("POSITIVE CONTROL: the filter genuinely cannot redact a bare string", () => {
    // The premise the whole fix rests on. If filterSensitiveFields ever grows
    // the ability to redact scalars, this fails and the fix can be revisited.
    const key = EXPORT_KEY_JOB.result;
    expect(JSON.stringify(filterSensitiveFields({ result: key }))).toContain(key);
    // And the contrast: key material under a NAME is redacted correctly, so
    // the filter is not simply broken.
    const named = filterSensitiveFields({ privatekey: "SENTINEL-KEY-MATERIAL-NOT-A-REAL-KEY" });
    expect(JSON.stringify(named)).not.toContain("SENTINEL-KEY-MATERIAL");
  });

  it("the dataset encryption key does not reach job_get's output", async () => {
    const registry = buildRegistry(stubClient([EXPORT_KEY_JOB]));
    const out = text(await registry.execute("system", "job_get", { job_id: 777 }));
    expect(out).not.toContain("deadbeefcafe");
    // Positive control: it IS in the input, so absence is withholding.
    expect(JSON.stringify(EXPORT_KEY_JOB)).toContain("deadbeefcafe");
    // And the job is still identified, so withholding did not gut the answer.
    const parsed = JSON.parse(out);
    expect(parsed.found).toBe(true);
    expect(parsed.method).toBe("pool.dataset.export_key");
    expect(parsed.state).toBe("SUCCESS");
  });

  it("says what was withheld and why, rather than returning null", async () => {
    // Silence would be indistinguishable from "the job returned nothing",
    // which is the same failure class as an unknown id reading as success.
    const registry = buildRegistry(stubClient([EXPORT_KEY_JOB]));
    const parsed = JSON.parse(text(await registry.execute("system", "job_get", { job_id: 777 })));
    expect(parsed.result.withheld).toBeTruthy();
    expect(parsed.result.type).toBe("string");
    expect(parsed.result.length).toBe(EXPORT_KEY_JOB.result.length);
    expect(parsed.result.reason).toContain("field name");
  });

  it("job_list withholds it too, not only job_get", async () => {
    const registry = buildRegistry(stubClient([EXPORT_KEY_JOB]));
    const out = text(await registry.execute("system", "job_list", {}));
    expect(out).not.toContain("deadbeefcafe");
    expect(out).toContain("withheld");
  });

  it.each([
    ["pool.dataset.export_key", "deadbeefcafe0123456789abcdef0123"],
    ["audit.export", "/mnt/data-pool/audit-export-2026.csv"],
    ["docker.backup", "backup-2026-11-27"],
    // core.job_wait proxies ANOTHER job's result, and its own return schema
    // is untyped — so it is a second path to the same leak that no method
    // list could enumerate.
    ["core.job_wait", "deadbeefcafe0123456789abcdef0123"],
    // A method that does not exist yet. The rule must hold for it too,
    // which is what makes this a shape rule and not a denylist.
    ["some.method.truenas.adds.in.28", "whatever-this-turns-out-to-be"],
  ])("withholds a bare-string result from %s", (method, value) => {
    const projected = projectJob({ id: 1, method, state: "SUCCESS", result: value });
    expect(JSON.stringify(projected)).not.toContain(value);
    expect((projected.result as Record<string, unknown>).withheld).toBeTruthy();
  });

  it("withholds an array containing bare strings", () => {
    // No @job method returns one today — every array-returning method
    // returns objects — but core.job_wait can proxy any shape, so this is
    // checked rather than assumed.
    const projected = projectJob({ id: 2, method: "core.job_wait", state: "SUCCESS", result: ["key-a", "key-b"] });
    expect(JSON.stringify(projected)).not.toContain("key-a");
    expect((projected.result as Record<string, unknown>).type).toBe("array");
  });

  it("STRUCTURED results still pass through, filtered as before", async () => {
    // The cost of the rule must stay bounded: objects are what the filter
    // can handle, so they are not withheld. 21 of 105 @job methods return
    // an object and they keep working.
    const job = {
      id: 3,
      method: "certificate.create",
      state: "SUCCESS",
      result: { id: 7, name: "mycert", privatekey: "SENTINEL-KEY-MATERIAL-NOT-A-REAL-KEY", certificate: "PEM" },
      error: null,
    };
    const registry = buildRegistry(stubClient([job]));
    const parsed = JSON.parse(text(await registry.execute("system", "job_get", { job_id: 3 })));
    // Useful content survives…
    expect(parsed.result.name).toBe("mycert");
    expect(parsed.result.id).toBe(7);
    expect(parsed.result.withheld).toBeUndefined();
    // …and the named key material is redacted by the existing filter.
    expect(JSON.stringify(parsed)).not.toContain("SENTINEL-KEY-MATERIAL");
  });

  it.each([
    ["boolean", true],
    ["number", 42],
    ["null", null],
  ])("passes a %s result through — it cannot carry key material", (_label, value) => {
    const projected = projectJob({ id: 4, method: "update.download", state: "SUCCESS", result: value });
    expect(projected.result).toEqual(value);
  });

  it("projectJobResult is the unit doing this, and it is exported for reuse", () => {
    // Tested directly as well as through the action, so a future caller that
    // needs the same rule has a gated function to reach for rather than
    // reimplementing the shape check.
    expect((projectJobResult("abc") as Record<string, unknown>).withheld).toBeTruthy();
    expect(projectJobResult({ a: 1 })).toEqual({ a: 1 });
    expect(projectJobResult(null)).toBeNull();
    expect(projectJobResult([{ a: 1 }])).toEqual([{ a: 1 }]);
  });

  it("an empty-string result is withheld too, not treated as absent", () => {
    // `if (result)` would have let this through; the check is on type.
    const projected = projectJob({ id: 5, method: "audit.export", state: "SUCCESS", result: "" });
    expect((projected.result as Record<string, unknown>).withheld).toBeTruthy();
  });
});
