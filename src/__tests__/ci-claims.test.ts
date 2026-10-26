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


  it("the audit step is not neutered with continue-on-error", () => {
    // The step's own comment predicts this bypass. Asserting the command text
    // while leaving `continue-on-error: true` unguarded gates the wrong half:
    // the job would still run, still report, and never block anything.
    expect(ci).not.toMatch(/continue-on-error:\s*true/);
  });

  it("the ws transport pins maxFragments, so an 8.21 default cannot bite silently", () => {
    // ws 8.21 added a client-side maxFragments default of 16,384. Exceeding it
    // throws at the socket, which trips failAllPending and tears the
    // connection — surfacing as intermittent failures across every action
    // category, the hardest signature to attribute correctly.
    expect(read("src/client.ts")).toMatch(/maxFragments:\s*0/);
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

/**
 * Gates the release workflow's version assertion.
 *
 * One release used to be able to publish three artifacts carrying two
 * different versions. Only the `docker` job derives its version stamp from
 * the release tag; `npm-tarball` names the tarball from `package.json`, and
 * `binary` falls back to `package.json` because nothing passes it a
 * `BUILD_VERSION`. So v1.4.2 shipped an asset literally named
 * `sr-truenas-mcp-1.4.0.tgz` while the image correctly reported `1.4.2`.
 *
 * ⚠ Note which half was fine: the DEPLOYED artifact is the image, so
 * `system_mcp_version` was telling the truth the whole time. The drift was in
 * the release assets, not in production — the opposite of what the stale
 * manifest suggests at a glance.
 *
 * The assertion lives in the `test` job because all three publishing jobs
 * already declare `needs: test`, so a mismatch blocks every artifact instead
 * of publishing an inconsistent set. This test fails if that step is removed
 * or stops being gated.
 */
describe("release.yml asserts the manifest matches the release tag", () => {
  const release = read(".github/workflows/release.yml");

  it("carries the assertion step", () => {
    expect(release).toContain("Assert package.json version matches the release tag");
  });

  it("compares the tag to package.json and exits non-zero on mismatch", () => {
    // Re-derive the comparison rather than restate it: the step must read the
    // manifest, strip the tag's leading "v", and fail.
    expect(release).toMatch(/require\("\.\/package\.json"\)\.version/);
    expect(release).toMatch(/\$\{TAG#v\}/);
    expect(release).toMatch(/exit 1/);
  });

  it("takes the release tag from env, never interpolated into a run block", () => {
    // A `${{ }}` expansion is substituted into the shell SOURCE before bash
    // parses it, so a crafted tag name would execute as code. `"$TAG"` is only
    // ever a value.
    //
    // ⚠ Scoped to the whole workflow deliberately, not to the assertion step.
    // When this was raised, the step under review was one of FOUR jobs doing
    // it -- `binary` and `npm-tarball` interpolated the tag straight into a
    // `gh release upload`, and `docker` assigned it the same way. A test
    // covering only the new step would have passed with the pattern still
    // present three jobs away in the same file.
    const runBlocks = [...release.matchAll(/^ {8}run: \|\n((?: {10}.*\n|\n)+)/gm)];
    expect(runBlocks.length).toBeGreaterThanOrEqual(4);
    const interpolated = runBlocks
      .flatMap((m) => m[1].split("\n"))
      .filter((line) => line.includes("${{") && !line.includes("env."))
      .map((line) => line.trim());
    // `${{ env.REGISTRY }}` is a workflow-level literal, not external input,
    // so it is excluded; anything carrying event or input data is not.
    expect(interpolated).toEqual([]);
    expect(release).not.toMatch(/TAG="\$\{\{/);
  });

  it("sits in a job every publishing job depends on", () => {
    // If the assertion were in its own ungated job, a mismatch would warn
    // while the artifacts published anyway.
    const jobs = release.slice(release.indexOf("\njobs:"));
    const testJob = jobs.slice(jobs.indexOf("\n  test:"), jobs.indexOf("\n  binary:"));
    expect(testJob).toContain("Assert package.json version matches the release tag");
    for (const job of ["binary", "docker", "npm-tarball"]) {
      const start = jobs.indexOf(`\n  ${job}:`);
      expect(start, `${job} job must exist`).toBeGreaterThan(-1);
      expect(jobs.slice(start, start + 200)).toContain("needs: test");
    }
  });
});
