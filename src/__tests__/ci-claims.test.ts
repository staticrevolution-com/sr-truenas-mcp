import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => readFileSync(resolve(REPO, rel), "utf8");

/**
 * Gates the claims our docs make ABOUT CI.
 *
 * `COMPARISON.md` exists so a reader can audit this project's rigor, and it
 * asserted that CI runs `tsc --noEmit` and `npm audit` on every push. As of
 * 2026-09-25 it ran neither: the workflow was `npm ci`, `npm run build`,
 * `npm test`. Meanwhile `CLAUDE.md` asserted "npm audit reports 0
 * vulnerabilities" while the real count was 16, including 2 critical and a
 * high on `ws` — the WebSocket transport under every TrueNAS call.
 *
 * Both are the same failure: a sentence describing a gate that did not exist.
 * The fix is the workflow steps; this file is what stops the sentence and the
 * workflow drifting apart again. It re-derives from `ci.yml` rather than
 * restating what we believe is in it.
 */
describe("Documented CI behaviour matches ci.yml", () => {
  const ci = read(".github/workflows/ci.yml");

  it.each([
    ["npm test", "the test suite"],
    ["npm run type-check", "tsc --noEmit, claimed by COMPARISON.md"],
    ["npm audit", "the dependency audit, claimed by COMPARISON.md and CLAUDE.md"],
  ])("ci.yml runs %s (%s)", (command) => {
    expect(ci).toContain(command);
  });

  it("the dependency audit is BLOCKING on the runtime tree, not advisory-only", () => {
    // An audit step that cannot fail is decoration. The blocking one must be
    // scoped to what actually ships (--omit=dev): gating on devDependency
    // advisories fails the build for a test-runner CVE that cannot reach
    // production, and a gate that cries wolf gets `continue-on-error` added.
    expect(ci).toMatch(/npm audit --omit=dev --audit-level=(high|moderate|low)/);
  });

  it("the blocking audit has not been quietly relaxed to critical-only", () => {
    // ⚠ Load-bearing. Dropping to `--audit-level=critical` would make the job
    // pass while silently ignoring the entire `high` class — which is where
    // the `ws` advisory that motivated this gate lives. If a genuinely
    // unreachable advisory blocks a release, add a dated `overrides` entry so
    // the exception stays visible, rather than widening the threshold.
    expect(ci).not.toMatch(/npm audit[^\n]*--audit-level=critical/);
  });

  it("CI is scheduled, so an advisory against unchanged code still surfaces", () => {
    // A push-triggered audit cannot see an advisory published after the last
    // commit. Most of this repo's risk arrives that way.
    expect(ci).toMatch(/schedule:\s*\n\s*(#[^\n]*\n\s*)*- cron:/);
  });

  it("CLAUDE.md no longer asserts a vulnerability count of its own", () => {
    // The count belongs to the job, which re-derives it. A number here is a
    // recorded fact with nothing checking it — it was wrong by 16 last time.
    expect(read("CLAUDE.md")).not.toMatch(/npm audit.{0,40}\b0 vulnerabilities/i);
  });
});

/**
 * Gates the Renovate config.
 *
 * Renovate opened **zero** PRs on this repo between 2026-08-21 and 2026-09-25
 * because `renovate.json` extended a preset in a PRIVATE repo while this repo
 * is PUBLIC — the hosted app will not read one for the other. It halted "as a
 * precaution", which fails toward the reassuring answer: no PRs is
 * indistinguishable from nothing to update. Five weeks later the tree carried
 * 16 advisories.
 */
describe("Renovate config is self-contained", () => {
  const renovate = JSON.parse(read("renovate.json")) as { extends?: string[] };

  it("extends no preset from another repository", () => {
    // `github>owner/repo` or `local>owner/repo` re-introduces the exact
    // failure: a public repo cannot resolve a private org preset. Built-in
    // presets (`config:recommended`, `:semanticCommits`) are fine — they ship
    // with Renovate and need no repository access.
    const external = (renovate.extends ?? []).filter((p) => /^(github|gitlab|local)>/.test(p));
    expect(
      external,
      "renovate.json extends a preset from another repo; if that repo is private, " +
        "Renovate will silently stop opening PRs here (see issue #14)",
    ).toEqual([]);
  });

  it("still enables vulnerability alerts", () => {
    // Inlining the preset must not lose the one setting that matters most.
    expect((renovate as { vulnerabilityAlerts?: { enabled?: boolean } }).vulnerabilityAlerts?.enabled).toBe(true);
  });
});
