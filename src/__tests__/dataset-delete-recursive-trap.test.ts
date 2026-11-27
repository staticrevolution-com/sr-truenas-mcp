import { describe, it, expect } from "vitest";
import type { TrueNASClient } from "../client.js";
import { buildRegistry } from "../tools/index.js";
import { TRUNCATION_MARKER } from "../registry.js";
import { ACTION_TIERS, SafetyTier } from "../safety.js";

/**
 * Regression gates for the `pool.dataset.delete` recursive trap.
 *
 * MEASURED BEHAVIOUR, TrueNAS 26.0-BETA.1 (2026-09-05/06, homelab, after it
 * hit two real datasets): `recursive: true` on an ordinary NESTED dataset
 * destroys every snapshot of the target, unmounts the filesystem, LEAVES the
 * dataset and all of its bytes, and returns `true`. `recursive: false` fails
 * honestly with `[ENOTEMPTY] … has snapshots. Set recursive=True to remove
 * them.` — and that error names the destructive flag, so an operator who meets
 * the honest failure is handed consent for the damaging path. Verified by
 * unfiltered snapshot enumeration with two positive controls (sibling datasets
 * under the same periodic task at 22 snapshots each, both subjects at 0).
 *
 * These tests encode that behaviour as the reason for the gate. They do NOT
 * re-measure it: the evidence class is "reproduced live on 26.0-BETA.1", and a
 * unit test cannot upgrade that.
 */

interface StubImpl {
  call?: (method: string, params: unknown[]) => unknown;
}

function stubClient(impl: StubImpl): TrueNASClient {
  return {
    call: async (method: string, params: unknown[] = []) => {
      if (!impl.call) throw new Error(`unexpected call(${method})`);
      return impl.call(method, params);
    },
  } as unknown as TrueNASClient;
}

function contentText(result: unknown): string {
  return (result as { content: Array<{ text: string }> }).content[0].text;
}

/** A client whose snapshot query returns `count` snapshots for any dataset. */
function clientWithSnapshots(count: number, calls: string[] = []) {
  return stubClient({
    call: (method, params) => {
      calls.push(method);
      if (method === "pool.snapshot.query") {
        const dataset = (params[0] as unknown[][])?.[0]?.[2] as string;
        return Array.from({ length: count }, (_, i) => ({
          name: `${dataset}@auto-2026-11-26-${String(i).padStart(2, "0")}`,
          dataset,
        }));
      }
      if (method === "pool.dataset.delete") return true;
      throw new Error(`unexpected method ${method}`);
    },
  });
}

const CONFIRMED = { confirm: true, reason: "test" };

describe("dataset_delete refuses the recursive trap", () => {
  it("refuses recursive:true on a nested dataset that has snapshots", async () => {
    const calls: string[] = [];
    const registry = buildRegistry(clientWithSnapshots(3, calls));
    const result = await registry.execute("storage", "dataset_delete", {
      id: "data-pool/apps/litellm",
      recursive: true,
      ...CONFIRMED,
    });
    const text = contentText(result);
    expect(text).toContain("REFUSED");
    expect(text).toContain("3 snapshot(s)");
    // The gate must prevent the call, not merely narrate it.
    expect(calls).not.toContain("pool.dataset.delete");
  });

  it("names the snapshots it would have destroyed, so the count is checkable", async () => {
    const registry = buildRegistry(clientWithSnapshots(2));
    const text = contentText(
      await registry.execute("storage", "dataset_delete", {
        id: "data-pool/apps/litellm",
        recursive: true,
        ...CONFIRMED,
      }),
    );
    expect(text).toContain("data-pool/apps/litellm@auto-2026-11-26-00");
    expect(text).toContain("data-pool/apps/litellm@auto-2026-11-26-01");
  });

  it("proceeds when the acknowledgement is given, and sends recursive through", async () => {
    let sentBody: unknown;
    const registry = buildRegistry(
      stubClient({
        call: (method, params) => {
          if (method === "pool.dataset.delete") {
            sentBody = params[1];
            return true;
          }
          // Snapshot-bearing on purpose: with an empty result this test would
          // pass even if the acknowledgement were ignored, because the gate
          // would not fire anyway. Found by mutation M4.
          if (method === "pool.snapshot.query") {
            return [{ name: "data-pool/apps/litellm@s1", dataset: "data-pool/apps/litellm" }];
          }
          throw new Error(`unexpected method ${method}`);
        },
      }),
    );
    await registry.execute("storage", "dataset_delete", {
      id: "data-pool/apps/litellm",
      recursive: true,
      acknowledge_snapshot_destruction: true,
      ...CONFIRMED,
    });
    expect(sentBody).toEqual({ recursive: true });
  });

  it("does not even query snapshots once the acknowledgement is given", async () => {
    const calls: string[] = [];
    const registry = buildRegistry(clientWithSnapshots(5, calls));
    await registry.execute("storage", "dataset_delete", {
      id: "data-pool/apps/litellm",
      recursive: true,
      acknowledge_snapshot_destruction: true,
      ...CONFIRMED,
    });
    expect(calls).not.toContain("pool.snapshot.query");
    expect(calls).toContain("pool.dataset.delete");
  });

  it("allows recursive:true on a POOL ROOT, where the flag means what it says", async () => {
    const calls: string[] = [];
    const registry = buildRegistry(clientWithSnapshots(9, calls));
    await registry.execute("storage", "dataset_delete", {
      id: "data-pool",
      recursive: true,
      ...CONFIRMED,
    });
    // A root is derived from the absence of '/', so there is no list to maintain.
    expect(calls).toContain("pool.dataset.delete");
    expect(calls).not.toContain("pool.snapshot.query");
  });

  it("allows recursive:true on a nested dataset with NO snapshots", async () => {
    const calls: string[] = [];
    const registry = buildRegistry(clientWithSnapshots(0, calls));
    await registry.execute("storage", "dataset_delete", {
      id: "data-pool/apps/empty",
      recursive: true,
      ...CONFIRMED,
    });
    expect(calls).toContain("pool.snapshot.query");
    expect(calls).toContain("pool.dataset.delete");
  });

  it("does not gate a non-recursive delete at all", async () => {
    const calls: string[] = [];
    const registry = buildRegistry(clientWithSnapshots(22, calls));
    await registry.execute("storage", "dataset_delete", {
      id: "data-pool/apps/litellm",
      recursive: false,
      ...CONFIRMED,
    });
    expect(calls).not.toContain("pool.snapshot.query");
    expect(calls).toContain("pool.dataset.delete");
  });

  it("queries the target's own snapshots with a SERVER-side filter", async () => {
    let sentFilters: unknown;
    const registry = buildRegistry(
      stubClient({
        call: (method, params) => {
          if (method === "pool.snapshot.query") {
            sentFilters = params[0];
            return [{ name: "x@1", dataset: "data-pool/apps/litellm" }];
          }
          throw new Error(`unexpected method ${method}`);
        },
      }),
    );
    await registry.execute("storage", "dataset_delete", {
      id: "data-pool/apps/litellm",
      recursive: true,
      ...CONFIRMED,
    });
    // Client-side filtering of a fetched page is the e2f1e22 defect; a count
    // the gate acts on must not be able to come back short.
    expect(sentFilters).toEqual([["dataset", "=", "data-pool/apps/litellm"]]);
  });
});

describe("the refusal must never recommend the destructive flag", () => {
  /**
   * The pincer: a recursive periodic task regenerates a blocking snapshot
   * nightly, so an operator reliably meets middleware's honest ENOTEMPTY — and
   * THAT error recommends `recursive=True` by name. Our own text must not join
   * it. Worse than a silent failure, because it manufactures consent.
   */
  const RECOMMENDS_RECURSIVE =
    /(set|pass|use|try|with|add)[^.\n]{0,40}recursive\s*[:=]\s*(true|True)/i;

  it("the refusal text does not tell anyone to set recursive true", async () => {
    const registry = buildRegistry(clientWithSnapshots(4));
    const text = contentText(
      await registry.execute("storage", "dataset_delete", {
        id: "data-pool/apps/litellm",
        recursive: true,
        ...CONFIRMED,
      }),
    );
    // Inline positive control: the pattern DOES fire on the middleware's own
    // wording, so a pass means the text is clean and not that the regex is inert.
    expect("[ENOTEMPTY] has snapshots. Set recursive=True to remove them.").toMatch(
      RECOMMENDS_RECURSIVE,
    );
    // Anchor: without this, the assertion below also passes against the
    // SUCCESS-path text, so it would stop gating the refusal the moment the
    // gate stopped firing. Found by mutation M1/M3.
    expect(text).toContain("REFUSED");
    expect(text).not.toMatch(RECOMMENDS_RECURSIVE);
  });

  it("the refusal routes to snapshot_delete and a non-recursive retry instead", async () => {
    const registry = buildRegistry(clientWithSnapshots(4));
    const text = contentText(
      await registry.execute("storage", "dataset_delete", {
        id: "data-pool/apps/litellm",
        recursive: true,
        ...CONFIRMED,
      }),
    );
    expect(text).toContain("snapshot_delete");
    expect(text).toMatch(/recursive omitted or set to false/);
  });

  it("the refusal warns against verifying by pool free space", async () => {
    const registry = buildRegistry(clientWithSnapshots(1));
    const text = contentText(
      await registry.execute("storage", "dataset_delete", {
        id: "data-pool/apps/litellm",
        recursive: true,
        ...CONFIRMED,
      }),
    );
    // ZFS frees asynchronously: a ~56 GiB destroy showed +873 MB in the same
    // second and settled ~2 minutes later, so an immediate space assertion
    // reports failure on a success.
    expect(text).toContain("REFUSED");
    expect(text).toMatch(/asynchronously/);
    expect(text).toContain("dataset_get");
    expect(text).toContain("filesystem_stat");
  });

  it("pool.dataset.delete is documented as not a job, so nobody polls for one", async () => {
    const registry = buildRegistry(clientWithSnapshots(1));
    const text = contentText(
      await registry.execute("storage", "dataset_delete", {
        id: "data-pool/apps/litellm",
        recursive: true,
        ...CONFIRMED,
      }),
    );
    expect(text).toContain("REFUSED");
    expect(text).toMatch(/not a job/);
  });
});

describe("a successful delete does not pass itself off as verified", () => {
  it("returns the result AND how to establish absence independently", async () => {
    const registry = buildRegistry(clientWithSnapshots(0));
    const text = contentText(
      await registry.execute("storage", "dataset_delete", {
        id: "data-pool/apps/empty",
        ...CONFIRMED,
      }),
    );
    expect(text).toContain("true");
    // `pool.dataset.delete` returning true is the enqueue-is-not-the-outcome
    // shape: it is compatible with the dataset still being there.
    expect(text).toContain("dataset_get");
    expect(text).toContain("filesystem_stat");
    expect(text).toMatch(/not a gate/);
  });
});

describe("what discovery actually shows a model", () => {
  /**
   * This dispatcher exposes one tool, so a model never sees per-action zod
   * schemas — `listActions` is the ONLY channel. And `listActions` truncates a
   * parameter description (registry.ts), so a long caveat is cut mid-sentence
   * exactly where it is needed. The measured behaviour therefore lives in the
   * ACTION description, which is not truncated, and the parameter description
   * is kept short enough to arrive whole.
   */
  function datasetDeleteLine(): string {
    const registry = buildRegistry(stubClient({}));
    const lines = registry.listActions("storage").split("\n");
    const i = lines.findIndex((l) => l.includes("dataset_delete"));
    expect(i, "dataset_delete absent from storage discovery").toBeGreaterThanOrEqual(0);
    // the action line plus its two parameter lines
    return lines.slice(i, i + 3).join("\n");
  }

  it("contradicts the old 'recursively delete child datasets' reading", () => {
    expect(datasetDeleteLine()).toMatch(/NOT .?delete child datasets/i);
  });

  it("states the measured outcome, not just that the flag is surprising", () => {
    const shown = datasetDeleteLine();
    expect(shown).toMatch(/EVERY SNAPSHOT/);
    expect(shown).toMatch(/LEAVES the dataset/);
    expect(shown).toMatch(/returns true/);
  });

  it("names a pool root as the case where the documented meaning applies", () => {
    expect(datasetDeleteLine()).toMatch(/POOL ROOT/);
  });

  it("warns that the middleware's own error recommends the destructive flag", () => {
    expect(datasetDeleteLine()).toMatch(/do not follow it/i);
  });

  it("neither parameter description is amputated by discovery truncation", () => {
    const shown = datasetDeleteLine();
    // Derived, not a restated limit: a truncated description ends in the
    // registry's own marker. Imported rather than spelled out, so changing
    // the marker cannot silently retire this check. Inline positive control
    // below proves the check can fail.
    for (const param of ["recursive", "acknowledge_snapshot_destruction"]) {
      const m = shown.match(new RegExp(`${param} \\(([^()]*)\\)`));
      expect(m, `${param} not shown in discovery`).not.toBeNull();
      expect(m![1].endsWith(TRUNCATION_MARKER), `${param} description was truncated`).toBe(false);
    }
  });

  it("the truncation check is live — some other descriptions ARE truncated", () => {
    // Positive control for the assertion above. 15 parameter descriptions in
    // the registry are cut by this limit, including live safety caveats on
    // snapshot_task_update. That is a separate, pre-existing defect; this test
    // exists so the check above cannot pass by the limit having been removed.
    const registry = buildRegistry(stubClient({}));
    const categories = new Set([...registry.tools.values()].map((t) => t.category));
    let truncated = 0;
    const marker = TRUNCATION_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const cat of categories) {
      truncated += [
        ...registry.listActions(cat).matchAll(new RegExp(`\\([^()]*${marker}\\)`, "g")),
      ].length;
    }
    expect(truncated).toBeGreaterThan(0);
  });
});

describe("the surrounding gates are untouched", () => {
  it("dataset_delete is still tier 1 — confirm AND reason", () => {
    expect(ACTION_TIERS.dataset_delete).toBe(SafetyTier.ConfirmWithReason);
  });

  it("the tier gate still fires before any of this, with no confirm", async () => {
    const calls: string[] = [];
    const registry = buildRegistry(clientWithSnapshots(3, calls));
    const text = contentText(
      await registry.execute("storage", "dataset_delete", {
        id: "data-pool/apps/litellm",
        recursive: true,
      }),
    );
    expect(text).toContain("HIGH-RISK");
    expect(calls).toEqual([]);
  });

  it("a malformed dataset name is rejected before any call is made", async () => {
    const calls: string[] = [];
    const registry = buildRegistry(clientWithSnapshots(0, calls));
    await expect(
      registry.execute("storage", "dataset_delete", {
        id: "data-pool/../etc",
        recursive: true,
        ...CONFIRMED,
      }),
    ).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});
