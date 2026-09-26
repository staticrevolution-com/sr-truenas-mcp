import { describe, it, expect } from "vitest";
import type { TrueNASClient } from "../client.js";
import { buildRegistry } from "../tools/index.js";
import { ACTION_TIERS, SafetyTier } from "../safety.js";

/**
 * `snapshot_task_update` — the missing verb, and why its absence was not a
 * mere inconvenience.
 *
 * Before this existed, the only MCP route to editing a periodic snapshot task
 * was `snapshot_task_delete` + `snapshot_task_create`. That substitutes a
 * low-risk edit with a materially higher-risk operation:
 *
 *   - it briefly leaves the dataset tree with NO periodic snapshot task at all
 *     (for `data-pool/apps`: 90 datasets, 14-day retention, every stateful
 *     service on the box);
 *   - the recreated task is a new object, so any external reference to the old
 *     id breaks;
 *   - a create that differs from the original in a field nobody re-typed
 *     (`allow_empty`, `naming_schema`, `lifetime_unit`, the schedule window)
 *     produces a task that looks right and retains differently — undetectable,
 *     because the symptom is a snapshot that is *not there*, months later;
 *   - and if the delete succeeds while the create fails, the result is silent
 *     loss of all future snapshots for that tree.
 *
 * 🔑 An absent update action does not just inconvenience a caller: it pushes a
 * low-risk edit onto a high-risk path.
 */

function contentText(result: unknown): string {
  return (result as { content: Array<{ text: string }> }).content[0].text;
}

function spyClient(spy: { method?: string; args?: unknown[] }): TrueNASClient {
  return {
    call: async (method: string, params: unknown[] = []) => {
      spy.method = method;
      spy.args = params;
      return { id: 12, updated: true };
    },
  } as unknown as TrueNASClient;
}

describe("snapshot_task_update", () => {
  it("exists, and is gated behind confirm", () => {
    expect(ACTION_TIERS.snapshot_task_update).toBe(SafetyTier.Confirm);
    const reg = buildRegistry(spyClient({}));
    expect(reg.tools.has("snapshot_task_update")).toBe(true);
  });

  it("⚠ sends ONLY the supplied fields — never nulls what the caller omitted", async () => {
    // THE failure mode, and it has a precedent one system over: Portainer's
    // `git/redeploy` wipes `Env` to null unless the full array is re-sent, and
    // that has cost this fleet real outages. `pool.snapshottask.update` is a
    // true partial update (all schema fields optional; the 26.0 handler does
    // `new = old.updated(data)`), so forwarding a sparse body is safe — but
    // only as long as we actually forward a sparse one. A handler that built a
    // full object and filled the gaps with nulls would look identical here and
    // silently clear `exclude`, `naming_schema` and the schedule.
    const spy: { method?: string; args?: unknown[] } = {};
    const reg = buildRegistry(spyClient(spy));

    await reg.execute("storage", "snapshot_task_update", {
      confirm: true,
      id: 12,
      exclude: ["data-pool/apps/gh-runners/registry-mirror"],
    });

    expect(spy.method).toBe("pool.snapshottask.update");
    const [id, body] = spy.args as [number, Record<string, unknown>];
    expect(id).toBe(12);
    // Exactly one key. Not "exclude is correct and the rest are null".
    expect(Object.keys(body)).toEqual(["exclude"]);
    expect(body.exclude).toEqual(["data-pool/apps/gh-runners/registry-mirror"]);
  });

  it("does not leak the confirm flag into the upstream payload", async () => {
    // Upstream pydantic models forbid extra keys, so a leaked `confirm` makes
    // the gate unsatisfiable — the failure this repo already hit once.
    const spy: { args?: unknown[] } = {};
    const reg = buildRegistry(spyClient(spy));
    await reg.execute("storage", "snapshot_task_update", { confirm: true, id: 12, enabled: false });
    const [, body] = spy.args as [number, Record<string, unknown>];
    expect(body).not.toHaveProperty("confirm");
    expect(body).not.toHaveProperty("id");
  });

  it("forwards several fields together, and only those", async () => {
    const spy: { args?: unknown[] } = {};
    const reg = buildRegistry(spyClient(spy));
    await reg.execute("storage", "snapshot_task_update", {
      confirm: true, id: 12, lifetime_value: 30, lifetime_unit: "DAY",
    });
    const [, body] = spy.args as [number, Record<string, unknown>];
    expect(Object.keys(body).sort()).toEqual(["lifetime_unit", "lifetime_value"]);
  });

  it("refuses an update that changes nothing", async () => {
    // An empty body would be a no-op that returns the task and reads as a
    // successful edit — the caller would believe their change landed.
    const reg = buildRegistry(spyClient({}));
    await expect(
      reg.execute("storage", "snapshot_task_update", { confirm: true, id: 12 }),
    ).rejects.toThrow(/at least one field/);
  });

  it("without confirm it does not reach the server", async () => {
    const reg = buildRegistry({
      call: async () => { throw new Error("must not be called without confirm"); },
    } as unknown as TrueNASClient);
    const r = await reg.execute("storage", "snapshot_task_update", { id: 12, enabled: false });
    expect(contentText(r)).toContain("DESTRUCTIVE OPERATION");
  });
});

/**
 * The pattern behind the one instance.
 *
 * `snapshot_task` was not the only CRUD family missing its update verb — it
 * was the one someone happened to need. Fixing the instance without recording
 * the pattern would leave the next caller to rediscover it the same way.
 */
describe("CRUD families missing an update verb", () => {
  it("records the families still lacking one, so the gap is visible not folklore", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const TOOLS = resolve(dirname(fileURLToPath(import.meta.url)), "../tools");

    const actions = new Set<string>();
    for (const f of readdirSync(TOOLS).filter((x) => x.endsWith(".ts") && x !== "index.ts")) {
      for (const m of readFileSync(resolve(TOOLS, f), "utf8").matchAll(/server\.tool\(\s*\n?\s*"([^"]+)"/g)) {
        actions.add(m[1]);
      }
    }
    const VERBS = ["_create", "_update", "_delete", "_list", "_get", "_run", "_query"];
    const fam = new Map<string, Set<string>>();
    for (const a of actions) {
      for (const v of VERBS) {
        if (a.endsWith(v)) {
          const k = a.slice(0, -v.length);
          if (!fam.has(k)) fam.set(k, new Set());
          fam.get(k)!.add(v.slice(1));
          break;
        }
      }
    }
    const missing = [...fam.entries()]
      .filter(([, v]) => (v.has("create") || v.has("delete")) && !v.has("update"))
      .map(([k]) => k)
      .sort();

    // Verified against `core.get_methods` on 26.0.0-BETA.1 (2026-09-26): each
    // of these has an `update` in middleware that this server does not expose,
    // EXCEPT `bootenv` — `boot.environment.update` genuinely does not exist,
    // so that one is not a gap.
    expect(missing).toEqual([
      "acme_dns_authenticator",
      "api_key",
      "bootenv",
      "certificate",
      "iscsi_initiator",
      "iscsi_targetextent",
      "keychaincredential",
      "network_static_route",
      "snapshot",
      "system_ntp_server",
    ]);
    // snapshot_task must NOT be in that list any more — that is this PR.
    expect(missing).not.toContain("snapshot_task");
  });
});
