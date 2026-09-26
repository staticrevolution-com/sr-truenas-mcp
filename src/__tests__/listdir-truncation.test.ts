import { describe, it, expect } from "vitest";
import type { TrueNASClient } from "../client.js";
import { buildRegistry } from "../tools/index.js";

/**
 * `filesystem_listdir` must never return a partial listing that looks complete.
 *
 * Measured live on 2026-09-26 against a 231-entry directory: the action applied
 * a silent `limit: 100` and hardcoded the filter slot to `[]`, so it returned
 * exactly 100 entries — **in readdir order, not sorted** — with nothing in the
 * response indicating anything was withheld, and any `query_filters` the caller
 * supplied were dropped by the registry's `.strip()` before reaching the
 * handler.
 *
 * 🔑 It is the `snapshot_list` defect in a different organ: **correct iff what
 * you wanted happened to fall inside the first 100 entries.** It is worse here,
 * because the natural next step after listing a directory is to conclude
 * something is NOT THERE — and a short answer reads as an answer, with no error
 * to notice. A caller deciding whether to create, delete or skip gets a
 * confident wrong answer.
 */

function contentText(result: unknown): string {
  return (result as { content: Array<{ text: string }> }).content[0].text;
}

/** A directory of `n` entries; records the query options it was asked for. */
function dirClient(n: number, spy?: { filters?: unknown; options?: Record<string, number> }) {
  const all = Array.from({ length: n }, (_, i) => ({ name: `e${i}`, type: "FILE" }));
  return {
    call: async (method: string, params: unknown[] = []) => {
      expect(method).toBe("filesystem.listdir");
      const [, filters, options] = params as [string, unknown, { limit: number; offset: number }];
      if (spy) { spy.filters = filters; spy.options = options; }
      return all.slice(options.offset, options.offset + options.limit);
    },
  } as unknown as TrueNASClient;
}

describe("filesystem_listdir never hides that it truncated", () => {
  it("flags truncation and says the listing is partial", async () => {
    const reg = buildRegistry(dirClient(231));
    const r = JSON.parse(contentText(await reg.execute("filesystem", "filesystem_listdir", {
      path: "/mnt/tank/big",
    })));

    expect(r.count).toBe(100);
    expect(r.truncated).toBe(true);
    expect(r.next_offset).toBe(100);
    // The wording matters as much as the flag: a caller must not read absence
    // from a partial listing as absence from the directory.
    expect(r.warning).toMatch(/does NOT mean the name is absent/);
    expect(r.entries).toHaveLength(100);
  });

  it("reports truncated:false when the directory fits, and returns everything", async () => {
    // Positive control. Without it, an implementation that always said
    // `truncated: true` would pass the test above and be useless.
    const reg = buildRegistry(dirClient(7));
    const r = JSON.parse(contentText(await reg.execute("filesystem", "filesystem_listdir", {
      path: "/mnt/tank/small",
    })));
    expect(r.truncated).toBe(false);
    expect(r.next_offset).toBeNull();
    expect(r.warning).toBeUndefined();
    expect(r.count).toBe(7);
  });

  it("is exact at the boundary — n === limit is NOT truncated", async () => {
    // The off-by-one that would make every full page cry wolf. A gate that
    // fires on correct behaviour is one that gets ignored.
    const reg = buildRegistry(dirClient(100));
    const r = JSON.parse(contentText(await reg.execute("filesystem", "filesystem_listdir", {
      path: "/mnt/tank/exact",
    })));
    expect(r.count).toBe(100);
    expect(r.truncated).toBe(false);
  });

  it("n === limit + 1 IS truncated", async () => {
    const reg = buildRegistry(dirClient(101));
    const r = JSON.parse(contentText(await reg.execute("filesystem", "filesystem_listdir", {
      path: "/mnt/tank/justover",
    })));
    expect(r.truncated).toBe(true);
    expect(r.count).toBe(100);
  });

  it("honours an explicit limit and still detects truncation beyond it", async () => {
    const reg = buildRegistry(dirClient(231));
    const r = JSON.parse(contentText(await reg.execute("filesystem", "filesystem_listdir", {
      path: "/mnt/tank/big", limit: 300,
    })));
    expect(r.count).toBe(231);
    expect(r.truncated).toBe(false);
  });

  it("paging with next_offset reconstructs the whole directory", async () => {
    // The end-to-end property that matters: following the advertised
    // continuation must eventually yield every entry, with no gap or repeat.
    const reg = buildRegistry(dirClient(231));
    const seen: string[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const r: { entries: Array<{ name: string }>; next_offset: number | null } = JSON.parse(
        contentText(await reg.execute("filesystem", "filesystem_listdir", {
          path: "/mnt/tank/big", limit: 50, offset,
        })),
      );
      seen.push(...r.entries.map((e) => e.name));
      offset = r.next_offset;
    }
    expect(seen).toHaveLength(231);
    expect(new Set(seen).size).toBe(231);
  });

  it("forwards query_filters to the server instead of discarding them", async () => {
    // The filter slot was hardcoded `[]`, and because the action declared no
    // such parameter the registry's `.strip()` dropped it silently — the caller
    // got an unfiltered listing with no indication their filter was ignored.
    const spy: { filters?: unknown } = {};
    const reg = buildRegistry(dirClient(10, spy));
    await reg.execute("filesystem", "filesystem_listdir", {
      path: "/mnt/tank/x",
      query_filters: [["name", "~", "runner-data"]],
    });
    expect(spy.filters).toEqual([["name", "~", "runner-data"]]);
  });

  it("sends no filter when none was given", async () => {
    const spy: { filters?: unknown } = {};
    const reg = buildRegistry(dirClient(10, spy));
    await reg.execute("filesystem", "filesystem_listdir", { path: "/mnt/tank/x" });
    expect(spy.filters).toEqual([]);
  });

  it("over-fetches by exactly one to detect truncation", async () => {
    // Asserts the mechanism, not just the outcome — a future refactor that
    // fetched exactly `limit` could not distinguish full from truncated, and
    // every test above would still pass if it also hardcoded truncated:true.
    const spy: { options?: Record<string, number> } = {};
    const reg = buildRegistry(dirClient(500, spy));
    await reg.execute("filesystem", "filesystem_listdir", { path: "/mnt/tank/x", limit: 42 });
    expect(spy.options?.limit).toBe(43);
  });

  it("still refuses a limit above the server maximum", async () => {
    const reg = buildRegistry(dirClient(10));
    const r = await reg.execute("filesystem", "filesystem_listdir", {
      path: "/mnt/tank/x", limit: 200_000,
    });
    expect(JSON.stringify(r)).toMatch(/10000/);
  });

  it("an empty directory is reported as empty, not as truncated", async () => {
    // "Returned nothing" must not pass as a healthy answer, and must not be
    // confused with "withheld everything".
    const reg = buildRegistry(dirClient(0));
    const r = JSON.parse(contentText(await reg.execute("filesystem", "filesystem_listdir", {
      path: "/mnt/tank/empty",
    })));
    expect(r.count).toBe(0);
    expect(r.truncated).toBe(false);
    expect(r.entries).toEqual([]);
  });
});
