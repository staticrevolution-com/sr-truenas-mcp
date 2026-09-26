/**
 * Bounded directory-tree measurement.
 *
 * Deliberately NOT a recursive `du`. A plain recursive total is structurally
 * wrong for this transport: every level costs a `filesystem.listdir` round-trip
 * over the WebSocket, and the directories worth asking about are exactly the
 * ones with enough entries to make that intractable. Measured on a live
 * 26.0.0-BETA.1 host, 2026-09-24: `/mnt/.ix-apps/docker/overlay2` holds
 * **48,544** entries, and merely counting them flat took 10.4 s and five paged
 * calls. A full recursive walk of that tree is ~10^5 round-trips.
 *
 * So an action promising a recursive total would hang, or time out and return a
 * partial sum indistinguishable from a real one, on the single directory the
 * caller most needs. This module instead spends a fixed budget and reports
 * honestly what it did not finish:
 *
 *   { entries: 48544, recursive_allocation: null, truncated: true }
 *
 * That localises a leak without pretending to size it. For an authoritative
 * total, ask ZFS (`dataset_zfs_query` → `used` / `usedbydataset`) rather than
 * summing a walk — one source of truth beats two that can disagree.
 *
 * ⚠ Sizes here are `allocation_size` (bytes actually on disk), never `size`
 * (apparent length). Under a Docker root the two differ by up to 23x because
 * buildkit's databases are sparse. See `SPARSE_FILE_NOTE`.
 */

import type { TrueNASClient } from "./client.js";

/** middlewared rejects `query_options.limit` above this. */
export const LISTDIR_MAX_LIMIT = 10_000;

/**
 * Shared wording for the `size` vs `allocation_size` trap, reused across every
 * action that returns either.
 *
 * Measured under `/mnt/.ix-apps/docker` on 2026-09-24: buildkit's
 * `metadata_v2.db` reports 320 MB apparent against 69 MB allocated, and two
 * sibling databases are similarly sparse — ~1.1 GB apparent for ~175 MB real.
 * A caller reading `size` gets a plausible number that is wrong by an order of
 * magnitude with nothing signalling it, which is how a session nearly concluded
 * buildkit metadata was material.
 */
export const SPARSE_FILE_NOTE =
  "'size' is the file's APPARENT length and 'allocation_size' is the bytes actually " +
  "on disk. They differ sharply for sparse files — under a Docker root 'size' has been " +
  "measured overstating by up to 23x. Use allocation_size for space accounting.";

export interface DuChild {
  name: string;
  path: string;
  type: string;
  /** Bytes on disk for this entry alone (not its subtree). */
  own_allocation: number;
  /** Entries counted beneath this child, as far as its budget allowed. */
  entries: number;
  /**
   * Bytes on disk for the whole subtree, or `null` when the walk was cut short
   * — never a partial sum presented as a total.
   */
  recursive_allocation: number | null;
  truncated: boolean;
  /**
   * Why it stopped: "budget" (raise max_entries/timeout_ms), "depth" (raise
   * depth), or "error" (the subtree could not be read — no limit will help).
   */
  stopped_because?: "budget" | "depth" | "error";
}

export interface DuResult {
  path: string;
  depth: number;
  children: DuChild[];
  /** Sum over children whose subtree completed; null if any was truncated. */
  total_allocation: number | null;
  entries_scanned: number;
  truncated: boolean;
  limits: { max_entries: number; timeout_ms: number };
  note: string;
}

interface Budget {
  remaining: number;
  deadline: number;
  scanned: number;
}

function exhausted(b: Budget): boolean {
  return b.remaining <= 0 || Date.now() >= b.deadline;
}

/**
 * List a directory completely, paging around the 10,000-entry server cap.
 *
 * Only the fields needed for accounting are selected — on a 48k-entry directory
 * the full metadata payload is what makes the call expensive, not the walk.
 */
async function listAll(
  client: TrueNASClient,
  path: string,
  budget: Budget,
): Promise<{ entries: Array<Record<string, unknown>>; truncated: boolean }> {
  const entries: Array<Record<string, unknown>> = [];
  let offset = 0;

  for (;;) {
    if (exhausted(budget)) return { entries, truncated: true };

    // ⚠ Clamp the page to what the budget can still afford. Checking
    // `exhausted` before the call is not enough on its own: a budget of 19
    // still pulled a full page, so 50 children with a 1-entry floor each
    // fetched 900 rows and the "cap" of 1,000 admitted 45,050. The budget has
    // to bound the REQUEST, not merely gate whether one is made.
    const pageSize = Math.min(LISTDIR_MAX_LIMIT, Math.max(1, budget.remaining));
    const page = (await client.call("filesystem.listdir", [
      path,
      [],
      { limit: pageSize, offset, select: ["name", "path", "type", "allocation_size"] },
    ])) as Array<Record<string, unknown>>;

    // A non-array response is an unknown, not an empty directory. Breaking
    // here silently reported the subtree as COMPLETE with zero bytes — the
    // emptiness-is-not-health shape this module exists to avoid.
    if (!Array.isArray(page)) return { entries, truncated: true };
    entries.push(...page);
    budget.remaining -= page.length;
    budget.scanned += page.length;

    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return { entries, truncated: false };
}

/**
 * Walk one subtree within the shared budget.
 *
 * `bytes` is only meaningful when `truncated` is false — the caller must not
 * present a truncated sum as a total.
 */
async function walk(
  client: TrueNASClient,
  path: string,
  depthRemaining: number,
  budget: Budget,
): Promise<{ bytes: number; entries: number; truncated: boolean; reason?: "budget" | "depth" | "error" }> {
  if (exhausted(budget)) return { bytes: 0, entries: 0, truncated: true, reason: "budget" };

  let listing;
  try {
    listing = await listAll(client, path, budget);
  } catch {
    // An unreadable subtree (EACCES, a vanished path, a transport error) is a
    // gap in the measurement, not a zero — and NOT a budget stop. Reporting it
    // as "budget" tells the operator to raise a limit that will never help.
    return { bytes: 0, entries: 0, truncated: true, reason: "error" };
  }

  let bytes = 0;
  let entries = listing.entries.length;
  let truncated = listing.truncated;
  let reason: "budget" | "depth" | "error" | undefined = listing.truncated ? "budget" : undefined;

  for (const entry of listing.entries) {
    bytes += Number(entry.allocation_size ?? 0);

    if (entry.type === "DIRECTORY" && depthRemaining > 0) {
      const sub = await walk(client, String(entry.path), depthRemaining - 1, budget);
      bytes += sub.bytes;
      entries += sub.entries;
      if (sub.truncated) {
        truncated = true;
        reason = reason ?? sub.reason;
      }
    } else if (entry.type === "DIRECTORY") {
      // Depth cap reached: this subtree was never measured, so the total for
      // the branch is unknown rather than "the bytes we happen to have".
      truncated = true;
      reason = reason ?? "depth";
    }
  }

  return { bytes, entries, truncated, reason };
}

/**
 * Measure the immediate children of `path`, recursing while the budget lasts.
 *
 * **The budget is the limiter, not the depth.** `depth` defaults to effectively
 * unlimited because a low depth cap makes almost every subtree report
 * `truncated` for a reason the caller did not care about, which drowns the
 * signal that actually matters — running out of budget on a genuinely huge
 * tree. `stopped_because` separates the two.
 *
 * Each directory child is walked against its OWN share of the entry budget, so
 * one oversized subtree cannot starve its siblings; comparing siblings is the
 * entire point. A child that exceeds its share comes back with
 * `recursive_allocation: null` plus its entry count — the localising answer.
 */
export async function measureDiskUsage(
  client: TrueNASClient,
  path: string,
  opts: { depth: number; maxEntries: number; timeoutMs: number },
): Promise<DuResult> {
  const budget: Budget = {
    remaining: opts.maxEntries,
    deadline: Date.now() + opts.timeoutMs,
    scanned: 0,
  };

  const top = await listAll(client, path, budget);
  const children: DuChild[] = [];
  let anyTruncated = top.truncated;
  const dirCount = top.entries.filter((e) => e.type === "DIRECTORY").length;

  // Share out only what is actually left, among the children still to come —
  // so an early cheap child returns its unspent share to the pool rather than
  // forfeiting it, and the sum across children can never exceed maxEntries.
  let remainingGlobal = Math.max(0, opts.maxEntries - budget.scanned);
  let dirsLeft = dirCount;

  for (const entry of top.entries) {
    const own = Number(entry.allocation_size ?? 0);
    const childPath = String(entry.path);

    if (entry.type !== "DIRECTORY") {
      children.push({
        name: String(entry.name),
        path: childPath,
        type: String(entry.type),
        own_allocation: own,
        entries: 0,
        recursive_allocation: own,
        truncated: false,
      });
      continue;
    }

    // ⚠ Per-child budget, not a shared one. Measured 2026-09-24: with a single
    // global budget, `overlay2` (48k+ entries) consumed all 60,000 as the
    // SECOND child processed, and every sibling afterwards came back
    // `entries: 0, truncated: true` — including `volumes`, which actually holds
    // 231 entries. A reader would see zeroes and conclude those trees were
    // small. One oversized subtree must not starve the others, because the
    // whole purpose here is comparing siblings.
    // ⚠ NO FLOOR. An earlier revision used `Math.max(1_000, …)` so that a
    // directory with many children still gave each a workable share — but that
    // floor defeats the global cap entirely: 50 children x a 1,000 floor
    // licenses 50,000 entries against a requested `max_entries` of 1,000.
    // Measured at **45x** the stated budget, while the response reported the
    // honoured-looking limit and the overrun side by side. On the directory
    // that motivated this action (48,544 child dirs) the floor would have
    // licensed ~48.5M entries, bounded only by the deadline.
    //
    // A parameter documented as "stop after scanning this many entries" must
    // actually stop. If the resulting per-child share is too small to be
    // useful, that is the caller's signal to raise `max_entries` — not ours to
    // overspend quietly on their behalf.
    if (remainingGlobal <= 0 || Date.now() >= budget.deadline) {
      // Budget gone. Record the child as unmeasured rather than walking it
      // anyway — a floor that guarantees every child "at least a little" is
      // how the cap became advisory in the first place.
      anyTruncated = true;
      children.push({
        name: String(entry.name), path: childPath, type: "DIRECTORY",
        own_allocation: own, entries: 0, recursive_allocation: null,
        truncated: true, stopped_because: "budget",
      });
      dirsLeft -= 1;
      continue;
    }

    const perChild: Budget = {
      remaining: Math.max(1, Math.floor(remainingGlobal / Math.max(1, dirsLeft))),
      deadline: budget.deadline,
      scanned: 0,
    };
    const sub = await walk(client, childPath, opts.depth, perChild);
    budget.scanned += perChild.scanned;
    remainingGlobal = Math.max(0, remainingGlobal - perChild.scanned);
    dirsLeft -= 1;
    if (sub.truncated) anyTruncated = true;
    children.push({
      name: String(entry.name),
      path: childPath,
      type: "DIRECTORY",
      own_allocation: own,
      entries: sub.entries,
      recursive_allocation: sub.truncated ? null : own + sub.bytes,
      truncated: sub.truncated,
      ...(sub.truncated ? { stopped_because: sub.reason } : {}),
    });
  }

  children.sort((a, b) => {
    // Unmeasured subtrees sort first — they are the ones needing attention,
    // and ordering by a null total would bury them at the bottom.
    if (a.truncated !== b.truncated) return a.truncated ? -1 : 1;
    return (b.recursive_allocation ?? 0) - (a.recursive_allocation ?? 0);
  });

  const complete = children.every((c) => !c.truncated);
  return {
    path,
    depth: opts.depth,
    children,
    total_allocation: complete
      ? children.reduce((sum, c) => sum + (c.recursive_allocation ?? 0), 0)
      : null,
    entries_scanned: budget.scanned,
    truncated: anyTruncated,
    limits: { max_entries: opts.maxEntries, timeout_ms: opts.timeoutMs },
    note:
      (anyTruncated
        ? "TRUNCATED: one or more subtrees exceeded the entry budget or the time limit. " +
          "Those rows carry recursive_allocation: null and are listed first — their entry " +
          "count localises the usage without claiming to size it. Raise max_entries/" +
          "timeout_ms, or narrow the path, to measure them. "
        : "") +
      "For an authoritative dataset total use dataset_zfs_query (used / usedbydataset) " +
      "rather than summing this walk. " +
      SPARSE_FILE_NOTE,
  };
}
