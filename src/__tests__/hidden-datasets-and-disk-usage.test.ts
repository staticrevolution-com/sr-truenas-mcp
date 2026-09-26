import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const TOOLS = resolve(dirname(fileURLToPath(import.meta.url)), "../tools");
import type { TrueNASClient } from "../client.js";
import { buildRegistry } from "../tools/index.js";
import { ACTION_TIERS, SafetyTier } from "../safety.js";
import { measureDiskUsage, SPARSE_FILE_NOTE, LISTDIR_MAX_LIMIT } from "../disk-usage.js";

/**
 * Gates for the 2026-09-24 findings, raised from an ep11 outage investigation
 * where the apps pool hit zero bytes. Evidence class is stated per block:
 * reproduced live against 26.0.0-BETA.1, or constructed here.
 */

function contentText(result: unknown): string {
  return (result as { content: Array<{ text: string }> }).content[0].text;
}

/** A stub filesystem: `tree[path]` is that directory's entries. */
function fsClient(tree: Record<string, Array<Record<string, unknown>>>): TrueNASClient {
  return {
    call: async (method: string, params: unknown[] = []) => {
      if (method !== "filesystem.listdir") throw new Error(`unexpected ${method}`);
      const [path, , opts] = params as [string, unknown, { limit: number; offset: number }];
      const all = tree[path] ?? [];
      return all.slice(opts.offset ?? 0, (opts.offset ?? 0) + opts.limit);
    },
  } as unknown as TrueNASClient;
}

/** Build a directory of `n` entries, each a leaf file of `bytes`. */
function fanout(parent: string, n: number, bytes = 512) {
  return Array.from({ length: n }, (_, i) => ({
    name: `e${i}`,
    path: `${parent}/e${i}`,
    type: "FILE",
    allocation_size: bytes,
  }));
}

/**
 * A NESTED tree: `parent` holds `dirs` subdirectories of `each` files apiece.
 *
 * Fixtures must be nested, not flat. A flat directory of n < 10000 entries
 * comes back in a single page and is therefore genuinely complete however small
 * the budget — the budget bounds recursion, which is where the round-trips are.
 * An earlier version of these tests used flat fanouts and failed, which was the
 * fixture being unrealistic rather than the walk being wrong: the live trees
 * that motivated this action (overlay2, volumes) are deep.
 */
function nested(parent: string, dirs: number, each: number, bytes = 512) {
  const tree: Record<string, Array<Record<string, unknown>>> = {
    [parent]: Array.from({ length: dirs }, (_, i) => ({
      name: `d${i}`,
      path: `${parent}/d${i}`,
      type: "DIRECTORY",
      allocation_size: 0,
    })),
  };
  for (let i = 0; i < dirs; i++) tree[`${parent}/d${i}`] = fanout(`${parent}/d${i}`, each, bytes);
  return tree;
}

// ═══════════════════════════════════════════════════════════════════════
// filesystem_disk_usage — the bounded walk
// ═══════════════════════════════════════════════════════════════════════

describe("filesystem_disk_usage budgets per child, not globally", () => {
  it("does not let one oversized subtree starve its siblings", async () => {
    // ⚠ THE REGRESSION. Measured live 2026-09-24: with a single shared budget,
    // `overlay2` (48k+ entries) consumed all 60,000 as the SECOND child walked,
    // and every sibling after it returned `entries: 0, truncated: true` —
    // including `volumes`, which really held 231 entries. Zeroes for
    // non-empty trees is the emptiness-is-not-health failure inside the very
    // tool built to find a leak by comparing siblings.
    const tree: Record<string, Array<Record<string, unknown>>> = {
      "/root": [
        { name: "huge", path: "/root/huge", type: "DIRECTORY", allocation_size: 512 },
        { name: "small", path: "/root/small", type: "DIRECTORY", allocation_size: 512 },
      ],
      ...nested("/root/huge", 20, 1000),
      "/root/small": fanout("/root/small", 3, 1000),
    };

    const result = await measureDiskUsage(fsClient(tree), "/root", {
      depth: 64,
      maxEntries: 4000,
      timeoutMs: 30_000,
    });

    const huge = result.children.find((c) => c.name === "huge")!;
    const small = result.children.find((c) => c.name === "small")!;

    expect(huge.truncated).toBe(true);
    expect(huge.recursive_allocation).toBeNull();

    // The whole point: the sibling is still measured.
    expect(small.truncated).toBe(false);
    expect(small.entries).toBe(3);
    expect(small.recursive_allocation).toBe(512 + 3 * 1000);
  });

  it("never reports a partial sum as a total", async () => {
    const tree = {
      "/root": [{ name: "big", path: "/root/big", type: "DIRECTORY", allocation_size: 0 }],
      ...nested("/root/big", 20, 1000),
    };
    const r = await measureDiskUsage(fsClient(tree), "/root", {
      depth: 64,
      maxEntries: 1000,
      timeoutMs: 30_000,
    });
    expect(r.children[0].recursive_allocation).toBeNull();
    expect(r.total_allocation).toBeNull();
    expect(r.truncated).toBe(true);
  });

  it("reports a real total when nothing is truncated", async () => {
    // Positive control — without this, the null-on-truncation tests above pass
    // trivially for a walk that can never complete anything.
    const tree = {
      "/root": [{ name: "a", path: "/root/a", type: "DIRECTORY", allocation_size: 100 }],
      "/root/a": fanout("/root/a", 4, 25),
    };
    const r = await measureDiskUsage(fsClient(tree), "/root", {
      depth: 64,
      maxEntries: 10_000,
      timeoutMs: 30_000,
    });
    expect(r.truncated).toBe(false);
    expect(r.children[0].recursive_allocation).toBe(200);
    expect(r.total_allocation).toBe(200);
  });

  it("distinguishes a depth stop from a budget stop", async () => {
    const tree = {
      "/root": [{ name: "a", path: "/root/a", type: "DIRECTORY", allocation_size: 0 }],
      "/root/a": [{ name: "b", path: "/root/a/b", type: "DIRECTORY", allocation_size: 0 }],
      "/root/a/b": [{ name: "c", path: "/root/a/b/c", type: "DIRECTORY", allocation_size: 0 }],
      "/root/a/b/c": fanout("/root/a/b/c", 2),
    };
    const r = await measureDiskUsage(fsClient(tree), "/root", {
      depth: 1,
      maxEntries: 10_000,
      timeoutMs: 30_000,
    });
    expect(r.children[0].truncated).toBe(true);
    expect(r.children[0].stopped_because).toBe("depth");
  });

  it("sorts unmeasured subtrees first so they are not buried", async () => {
    const tree = {
      "/root": [
        { name: "small", path: "/root/small", type: "DIRECTORY", allocation_size: 0 },
        { name: "huge", path: "/root/huge", type: "DIRECTORY", allocation_size: 0 },
      ],
      "/root/small": fanout("/root/small", 2, 10),
      ...nested("/root/huge", 20, 1000),
    };
    const r = await measureDiskUsage(fsClient(tree), "/root", {
      depth: 64,
      maxEntries: 3000,
      timeoutMs: 30_000,
    });
    expect(r.children[0].name).toBe("huge");
    expect(r.children[0].truncated).toBe(true);
  });

  it("pages around the server's 10000-entry listdir cap", async () => {
    const tree = {
      "/root": [{ name: "a", path: "/root/a", type: "DIRECTORY", allocation_size: 0 }],
      "/root/a": fanout("/root/a", LISTDIR_MAX_LIMIT + 250, 1),
    };
    const r = await measureDiskUsage(fsClient(tree), "/root", {
      depth: 64,
      maxEntries: 100_000,
      timeoutMs: 30_000,
    });
    expect(r.children[0].entries).toBe(LISTDIR_MAX_LIMIT + 250);
    expect(r.children[0].truncated).toBe(false);
  });


  it("⚠ NEVER scans more entries than max_entries, however many children there are", async () => {
    // The gate that was missing. A per-child floor of 1,000 made the global
    // cap advisory: measured at 45x the requested budget (50 children x 900
    // files, max_entries 1000 -> entries_scanned 45,050) while the response
    // reported `limits.max_entries: 1000` in the same object. On the directory
    // that motivated this action (48,544 child dirs) the floor would have
    // licensed ~48.5M entries.
    //
    // A parameter documented as "stop after scanning this many entries" must
    // actually stop, and only an assertion on entries_scanned can say so —
    // every other field looked correct while it overran.
    const tree: Record<string, Array<Record<string, unknown>>> = {
      "/root": Array.from({ length: 50 }, (_, i) => ({
        name: `d${i}`, path: `/root/d${i}`, type: "DIRECTORY", allocation_size: 0,
      })),
    };
    for (let i = 0; i < 50; i++) tree[`/root/d${i}`] = fanout(`/root/d${i}`, 900);

    const r = await measureDiskUsage(fsClient(tree), "/root", {
      depth: 64, maxEntries: 1_000, timeoutMs: 60_000,
    });
    expect(r.entries_scanned).toBeLessThanOrEqual(1_000);
    expect(r.truncated).toBe(true);
    expect(r.total_allocation).toBeNull();
  });

  it("an unreadable subtree is reported as an error, not as a budget stop", async () => {
    // "budget" tells the operator to raise a limit. For EACCES or a vanished
    // path no limit will ever help, so the causes must not share a label.
    const tree = {
      "/root": [{ name: "denied", path: "/root/denied", type: "DIRECTORY", allocation_size: 0 }],
    };
    const client = {
      call: async (_m: string, params: unknown[] = []) => {
        const [path] = params as [string];
        if (path === "/root/denied") throw new Error("[EACCES] permission denied");
        return tree["/root"];
      },
    } as unknown as TrueNASClient;
    const r = await measureDiskUsage(client, "/root", { depth: 64, maxEntries: 10_000, timeoutMs: 30_000 });
    expect(r.children[0].truncated).toBe(true);
    expect(r.children[0].stopped_because).toBe("error");
  });

  it("is registered open-tier and points at ZFS for authoritative totals", () => {
    expect(ACTION_TIERS.filesystem_disk_usage).toBe(SafetyTier.Open);
    const reg = buildRegistry(fsClient({}));
    const desc = reg.tools.get("filesystem_disk_usage")!.description;
    expect(desc).toMatch(/dataset_zfs_query/);
    expect(desc).toMatch(/allocation_size/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Hidden datasets — evidence: reproduced live on 26.0.0-BETA.1.
// pool.dataset.query omits data-pool/ix-apps and its 12 children entirely,
// including the Docker root; zfs.resource.query returns them in full.
// ═══════════════════════════════════════════════════════════════════════

describe("dataset_get keeps hidden datasets hidden, and ENOENT means absent", () => {
  function client(impl: (m: string, p: unknown[]) => unknown): TrueNASClient {
    return { call: async (m: string, p: unknown[] = []) => impl(m, p) } as unknown as TrueNASClient;
  }

  it("does NOT fall back to the ZFS namespace for a hidden dataset", () => {
    // Internal datasets (the apps/Docker root and its 12 children) are omitted
    // from pool.dataset.query by TrueNAS itself. They stay omitted here:
    // hidden-by-default is the operator's stated preference, and
    // dataset_zfs_query is the explicit way to ask for them by name.
    const source = readFileSync(resolve(TOOLS, "storage.ts"), "utf8");
    const from = source.indexOf('"dataset_get"');
    const to = source.indexOf('"dataset_zfs_query"');
    // ⚠ Guard the slice before trusting it. If the two tools were ever
    // reordered in storage.ts, `from > to` yields an EMPTY string and the
    // assertion below would pass on nothing — a silent green on the one test
    // guarding a destructive verification in another repository.
    expect(from, "dataset_get not found in storage.ts").toBeGreaterThan(-1);
    expect(to, "dataset_zfs_query not found in storage.ts").toBeGreaterThan(from);
    const getBody = source.slice(from, to);
    expect(getBody.length).toBeGreaterThan(200);
    expect(getBody).not.toMatch(/zfs\.resource\.query/);
  });

  it("⚠ CHARM CONTRACT: ENOENT propagates unchanged — it is an absence proof", async () => {
    // This is not a defensive nicety. sr-charm's dataset-conversion plan uses
    // `dataset_get` ENOENT as ONE OF THREE independent absence proofs when
    // verifying `pool.dataset.delete`, specifically below ~1 GB where
    // pool-space deltas are pure noise (internal/dsconvert/plan.go).
    //
    // If this action ever answered with a record for something the dataset
    // namespace reports as gone, charm would report a DESTROYED dataset as
    // still present, and the operator would conclude a destroy had failed and
    // act on that. Anything that softens ENOENT here breaks a destructive
    // verification in another repository.
    const reg = buildRegistry(
      client((method) => {
        if (method === "pool.dataset.get_instance") {
          throw new Error("TrueNAS API error: [ENOENT] None: PoolDataset gone does not exist");
        }
        throw new Error(`must not consult ${method} — ENOENT is the answer`);
      }),
    );
    await expect(reg.execute("storage", "dataset_get", { id: "gone" })).rejects.toThrow(/ENOENT/);
  });

  it("dataset_zfs_query is the explicit, opt-in route to hidden datasets", async () => {
    let seen: unknown;
    const reg = buildRegistry(
      client((method, params) => {
        expect(method).toBe("zfs.resource.query");
        seen = (params as unknown[])[0];
        return [{ name: "data-pool/ix-apps", properties: { used: { value: 998_600_000_000 } } }];
      }),
    );
    const parsed = JSON.parse(
      contentText(await reg.execute("storage", "dataset_zfs_query", { paths: ["data-pool/ix-apps"] })),
    );
    expect(parsed[0].properties.used.value).toBe(998_600_000_000);
    expect((seen as { paths: string[] }).paths).toEqual(["data-pool/ix-apps"]);
  });

  it("dataset_zfs_query is registered open-tier and validates its paths", async () => {
    expect(ACTION_TIERS.dataset_zfs_query).toBe(SafetyTier.Open);
    const reg = buildRegistry(client(() => { throw new Error("must not reach the server"); }));
    await expect(
      reg.execute("storage", "dataset_zfs_query", { paths: ["tank/../etc"] }),
    ).rejects.toThrow(/path traversal/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Response size and parameter ergonomics
// ═══════════════════════════════════════════════════════════════════════

describe("dataset_get response shaping", () => {
  const record = {
    id: "data-pool/apps",
    used: { value: 1 },
    available: { value: 2 },
    children: [{ id: "data-pool/apps/a", used: { value: 3 } }, { id: "data-pool/apps/b" }],
  };
  const reg = buildRegistry({
    call: async () => record,
  } as unknown as TrueNASClient);

  it("returns the full record by default (no silent behaviour change)", async () => {
    const parsed = JSON.parse(contentText(await reg.execute("storage", "dataset_get", { id: "x" })));
    expect(parsed.children[0].used.value).toBe(3);
  });

  it("'fields' narrows a 571,342-character response to what was asked for", async () => {
    const parsed = JSON.parse(
      contentText(await reg.execute("storage", "dataset_get", { id: "x", fields: ["id", "used"] })),
    );
    expect(Object.keys(parsed)).toEqual(["id", "used"]);
  });

  it("include_children: names / none collapse the array that dominates the payload", async () => {
    const names = JSON.parse(
      contentText(await reg.execute("storage", "dataset_get", { id: "x", include_children: "names" })),
    );
    expect(names.children).toEqual(["data-pool/apps/a", "data-pool/apps/b"]);

    const none = JSON.parse(
      contentText(await reg.execute("storage", "dataset_get", { id: "x", include_children: "none" })),
    );
    expect(none.children).toBeUndefined();
    expect(none.children_count).toBe(2);
  });
});

describe("parameter errors name the key that was rejected", () => {
  const reg = buildRegistry({ call: async () => ({}) } as unknown as TrueNASClient);

  it("reports the ignored key, not just the missing one", async () => {
    // `dataset` is the obvious guess for dataset_get; `.strip()` discarded it
    // silently and the error named only the field it wanted, so the actual
    // mistake was invisible.
    const result = await reg.execute("storage", "dataset_get", { dataset: "data-pool/apps" });
    const error = (result as { error: string }).error;
    expect(error).toMatch(/Ignored unknown parameter\(s\): dataset/);
    expect(error).toMatch(/Accepted parameter\(s\).*id/);
  });

  it("adds no noise when every key was understood", async () => {
    const result = await reg.execute("storage", "snapshot_get", {});
    expect((result as { error: string }).error).not.toMatch(/Ignored unknown/);
  });
});

describe("filesystem_listdir limit is bounded client-side", () => {
  it("rejects a limit above the server maximum instead of relaying [EAGAIN]", async () => {
    // Live, 2026-09-24: limit 200000 returned
    // "[EAGAIN] [EINVAL] query_options: Value error, Options limit must be
    // between 1 and 10000" — an opaque server error for a client-checkable bug.
    const reg = buildRegistry({ call: async () => [] } as unknown as TrueNASClient);
    const result = await reg.execute("filesystem", "filesystem_listdir", {
      path: "/mnt/x",
      limit: 200_000,
    });
    expect(JSON.stringify(result)).toMatch(/limit/);
    expect(JSON.stringify(result)).toMatch(/10000/);
  });
});

describe("sparse-file hazard is documented where the fields appear", () => {
  it("names allocation_size as the on-disk field on stat and listdir", () => {
    const reg = buildRegistry({ call: async () => ({}) } as unknown as TrueNASClient);
    for (const action of ["filesystem_stat", "filesystem_listdir"]) {
      expect(reg.tools.get(action)!.description).toContain("allocation_size");
    }
    expect(SPARSE_FILE_NOTE).toMatch(/23x/);
  });
});
