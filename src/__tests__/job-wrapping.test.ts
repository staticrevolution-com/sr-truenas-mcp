import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JOB_METHODS } from "../job-methods.js";
import { BLOCKED_ACTIONS } from "../safety.js";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Every source file that could call `client.call`, not just `src/tools/`.
 *
 * ⚠ Scoping this to `src/tools/` was a latent hole: `src/disk-usage.ts`
 * (added in a sibling PR) is the first non-tools module to call `client.call`
 * directly, and a future `@job` call there would have been ungated with
 * nothing to say so. A gate scoped to where the problem happened to live the
 * first time is a gate that stops covering the codebase as it grows.
 */
function collect(dir: string): Array<{ name: string; text: string }> {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return e.name === "__tests__" ? [] : collect(resolve(dir, e.name));
    if (!e.name.endsWith(".ts") || e.name === "index.ts") return [];
    const full = resolve(dir, e.name);
    return [{ name: full.slice(SRC.length + 1), text: readFileSync(full, "utf8") }];
  });
}
const files = collect(SRC);

/**
 * Every call to a `@job` middleware method must be wrapped.
 *
 * A `@job` method returns a job id, not a result. Unwrapped, the handler
 * JSON-stringifies that integer and the caller reads an enqueue as an outcome —
 * a FAILED `pool.dataset.unlock` or `certificate.create` looks like success.
 *
 * Two helpers are correct, for different reasons:
 *   - `awaitJobResult` — waits, so a FAILED job surfaces as an error. For
 *     bounded work where the outcome IS the answer.
 *   - `describeAsyncJob` — returns `{job_id, state:"STARTED", note}` without
 *     waiting. For genuinely long work, where awaiting would block the tool
 *     call for the 300 s `waitForJob` default and then throw a **false
 *     failure** for a job that is still running and will likely succeed.
 *
 * That asymmetry is why ambiguous cases default to `describeAsyncJob`:
 * mis-classifying fast work as async costs verbosity; mis-classifying slow work
 * as sync manufactures a failure report for a successful operation.
 */
describe("Every @job middleware call is wrapped", () => {
  // Re-derived from source: find each `client.call("x")`, keep the job ones.
  const sites = files.flatMap(({ name, text }) =>
    [...text.matchAll(/(.{0,60})await client\.call\(\s*"([^"]+)"/gs)].map((m) => {
      const before = text.slice(0, m.index);
      // The enclosing action is the nearest preceding `server.tool("name"`.
      // Deriving the tier this way keeps the Tier-0 exclusion honest: it comes
      // from safety.ts, not from a hand-maintained list in this test that
      // could quietly grow to cover a real miss.
      const decls = [...before.matchAll(/server\.tool\(\s*\n?\s*"([^"]+)"/g)];
      return {
        file: name,
        method: m[2],
        prefix: m[1],
        action: decls.length ? decls[decls.length - 1][1] : "(unknown)",
        line: before.split("\n").length,
      };
    }),
  ).filter((s) => JOB_METHODS.has(s.method));

  // Tier 0 is dropped at registration (registry.ts: getActionTier undefined →
  // never registered), so an unwrapped job call inside one is unreachable.
  const live = sites.filter((s) => !BLOCKED_ACTIONS.has(s.action));

  it("finds job call sites at all (guards against a broken scanner)", () => {
    // A regex that matches nothing would make every assertion below pass
    // vacuously — the classic way a gate becomes decorative.
    expect(sites.length).toBeGreaterThan(30);
    // and the widened scan must actually reach beyond src/tools/
    expect(files.some((f) => !f.name.startsWith("tools/"))).toBe(true);
  });

  it("wraps every one in awaitJobResult or describeAsyncJob", () => {
    const bare = live
      .filter((s) => !/awaitJobResult\(client,\s*$|describeAsyncJob\(\s*$/.test(s.prefix))
      .map((s) => `${s.file}:${s.line} ${s.action} → ${s.method}`);
    expect(
      bare,
      "these return a bare job id, so a failed operation reads as success",
    ).toEqual([]);
  });

  it("awaits awaitJobResult — it is async, and an unawaited call serialises to {}", () => {
    // ⚠ This is not hypothetical. The 2026-09-26 sweep wrapped 36 call sites
    // and omitted the outer `await` on all 18 `awaitJobResult` ones.
    // `JSON.stringify(Promise)` is `{}`, and TypeScript does not object
    // because `JSON.stringify` accepts `any` — so it compiled, and all 305
    // tests passed, while twenty actions returned an empty object.
    const unawaited = files.flatMap(({ name, text }) =>
      [...text.matchAll(/(.{0,20})awaitJobResult\(/g)]
        // Exclude the declaration itself — `export async function
        // awaitJobResult(` is not a call site. Excluding the whole file would
        // also hide any real call made from it, so discriminate on the
        // construct, not the filename.
        .filter((m) => !/\bfunction\s+$/.test(m[1]))
        .filter((m) => !m[1].endsWith("await "))
        .map((m) => `${name}:${text.slice(0, m.index).split("\n").length}`),
    );
    expect(unawaited, "awaitJobResult(...) without `await` returns a Promise").toEqual([]);
  });

  it("does not await describeAsyncJob — it is synchronous by design", () => {
    const wrongly = files.flatMap(({ name, text }) =>
      [...text.matchAll(/await describeAsyncJob\(/g)].map(
        (m) => `${name}:${text.slice(0, m.index).split("\n").length}`,
      ),
    );
    expect(wrongly).toEqual([]);
  });

  it("excludes exactly the Tier-0 job calls, and can still see them", () => {
    // Positive control on the exclusion itself. If the action-name scan broke,
    // `live` would silently equal `sites` and the carve-out would be doing
    // nothing — or worse, would hide a real miss. Assert the difference is
    // real and that every excluded site is genuinely blocked.
    const excluded = sites.filter((s) => BLOCKED_ACTIONS.has(s.action));
    expect(excluded.length).toBe(3);
    for (const s of excluded) expect(BLOCKED_ACTIONS.has(s.action)).toBe(true);
    expect(live.length).toBe(sites.length - excluded.length);
  });
});
