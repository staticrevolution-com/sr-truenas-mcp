import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRegistry } from "../tools/index.js";

/**
 * Doc-sync drift gate (B7) — fails CI if CLAUDE.md numerical claims don't
 * match the source. Catches the "edited filters.ts but forgot to bump
 * '57 exact keys' in CLAUDE.md" class of bug at PR time, not after release.
 *
 * Same counting logic as `scripts/audit-counts.mjs`. If you change one,
 * update the other (kept duplicated rather than abstracted because the
 * logic is small and the script needs to be runnable as a standalone CLI
 * via `npm run audit:counts`).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const SRC = resolve(REPO, "src");

function read(p: string): string {
  return readFileSync(p, "utf8");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

function countSetEntries(text: string, varName: string): number {
  const re = new RegExp(`export const ${varName}[^=]*=\\s*new Set<string>\\(\\[([\\s\\S]*?)\\]\\)`);
  const m = text.match(re);
  if (!m) throw new Error(`Could not find ${varName} Set declaration`);
  const body = m[1].replace(/\/\/[^\n]*/g, "");
  const matches = body.match(/"[^"]+"/g);
  return matches ? matches.length : 0;
}

function countSuffixPatterns(text: string): number {
  const re = /export const SUFFIX_PATTERNS:[^=]*=\s*\[([\s\S]*?)\]/;
  const m = text.match(re);
  if (!m) throw new Error("Could not find SUFFIX_PATTERNS declaration");
  const body = m[1].replace(/\/\/[^\n]*/g, "");
  const matches = body.match(/\/[^/\n]+\/[a-z]*/g);
  return matches ? matches.length : 0;
}

function tierCounts(safetyText: string): Record<string, number> {
  const tally: Record<string, number> = { Blocked: 0, ConfirmWithReason: 0, Confirm: 0, Open: 0 };
  for (const line of safetyText.split("\n")) {
    const m = line.match(/SafetyTier\.(Blocked|ConfirmWithReason|Confirm|Open),?\s*$/);
    if (m) tally[m[1]]++;
  }
  return tally;
}

function countActionTierEntries(safetyText: string): number {
  const m = safetyText.match(/export const ACTION_TIERS[^=]*=\s*\{([\s\S]*?)\n\};/);
  if (!m) throw new Error("Could not find ACTION_TIERS declaration");
  const matches = m[1].match(/^\s+[a-z_][a-z0-9_]*:\s*SafetyTier\./gim);
  return matches ? matches.length : 0;
}

function countCallSites(files: string[], pattern: RegExp): number {
  let n = 0;
  for (const f of files) {
    for (const line of read(f).split("\n")) {
      if (line.includes("import")) continue;
      if (pattern.test(line)) n++;
    }
  }
  return n;
}

function countConfirmGuards(files: string[]): number {
  let n = 0;
  for (const f of files) {
    const matches = read(f).match(/if\s*\(\s*!confirm\s*\)/g);
    if (matches) n += matches.length;
  }
  return n;
}

function extractNumber(claudeMd: string, label: string, pattern: RegExp): number {
  const m = claudeMd.match(pattern);
  if (!m || !m[1]) throw new Error(`Could not extract '${label}' from CLAUDE.md (pattern: ${pattern})`);
  return parseInt(m[1], 10);
}

const claudeMd = read(resolve(REPO, "CLAUDE.md"));
const filtersText = read(resolve(SRC, "filters.ts"));
const safetyText = read(resolve(SRC, "safety.ts"));
const toolFiles = walk(resolve(SRC, "tools"));

describe("Doc-sync drift gate (B7)", () => {
  describe("Filter coverage in src/filters.ts", () => {
    it("CLAUDE.md exact-keys claim matches SENSITIVE_KEYS Set size", () => {
      const actual = countSetEntries(filtersText, "SENSITIVE_KEYS");
      const claimed = extractNumber(claudeMd, "exact-keys", /(\d+) exact keys/);
      expect(claimed).toBe(actual);
    });

    it("CLAUDE.md suffix-patterns claim matches SUFFIX_PATTERNS array length", () => {
      const actual = countSuffixPatterns(filtersText);
      const claimed = extractNumber(claudeMd, "suffix-patterns", /(\d+) suffix patterns/);
      expect(claimed).toBe(actual);
    });

    it("CLAUDE.md allowlist claim matches NEVER_REDACT Set size", () => {
      const actual = countSetEntries(filtersText, "NEVER_REDACT");
      const claimed = extractNumber(claudeMd, "allowlist", /(\d+)-entry NEVER_REDACT/);
      expect(claimed).toBe(actual);
    });
  });

  describe("Safety tiers in src/safety.ts", () => {
    const tiers = tierCounts(safetyText);

    it("CLAUDE.md tier-0 (Blocked) count matches source", () => {
      const claimed = extractNumber(
        claudeMd,
        "tier-0",
        /\| 0 — Blocked \| Never registered \| (\d+) \|/,
      );
      expect(claimed).toBe(tiers.Blocked);
    });

    it("CLAUDE.md tier-1 (Confirm+Reason) count matches source", () => {
      const claimed = extractNumber(
        claudeMd,
        "tier-1",
        /\| 1 — Confirm\+Reason \|[^|]*\| (\d+) \|/,
      );
      expect(claimed).toBe(tiers.ConfirmWithReason);
    });

    it("CLAUDE.md tier-2 (Confirm) count matches source", () => {
      const claimed = extractNumber(
        claudeMd,
        "tier-2",
        /\| 2 — Confirm \|[^|]*\| (\d+) \|/,
      );
      expect(claimed).toBe(tiers.Confirm);
    });

    it("CLAUDE.md tier-3 (Open) count matches source", () => {
      const claimed = extractNumber(
        claudeMd,
        "tier-3",
        /\| 3 — Open \| None \| (\d+) \|/,
      );
      expect(claimed).toBe(tiers.Open);
    });

    it("CLAUDE.md '270 active actions' claim matches registered tool count", () => {
      const total = countActionTierEntries(safetyText);
      const registered = total - tiers.Blocked;
      const claimed = extractNumber(claudeMd, "active-actions", /(\d+) active actions/);
      expect(claimed).toBe(registered);
    });
  });

  describe("Validation surface in src/tools/", () => {
    it("CLAUDE.md validateTrueNASPath call-site count matches source", () => {
      const actual = countCallSites(toolFiles, /validateTrueNASPath\(/);
      const claimed = extractNumber(claudeMd, "path-validation", /(\d+) call sites across/);
      expect(claimed).toBe(actual);
    });

    it("CLAUDE.md validateDatasetName call-site count matches source", () => {
      const actual = countCallSites(toolFiles, /validateDatasetName\(/);
      // Phrased as "3 call sites: ..." in CLAUDE.md
      const claimed = extractNumber(claudeMd, "dataset-validation", /(\d+) call sites:/);
      expect(claimed).toBe(actual);
    });

    it("CLAUDE.md in-handler !confirm count matches source", () => {
      const actual = countConfirmGuards(toolFiles);
      const claimed = extractNumber(
        claudeMd,
        "in-handler-confirm",
        /(\d+) handlers also have in-handler/,
      );
      expect(claimed).toBe(actual);
    });
  });
});

/**
 * The test-count claim, which decayed three times before it was gated.
 *
 * `CLAUDE.md` said "272 tests" against a suite of 378. `README.md` and
 * `COMPARISON.md` both said "211 tests across 12 test files" — a figure from
 * v1.1.0, stale by 167 tests and 11 files, sitting in the two documents a
 * reader consults to judge whether this project is rigorous. Three PRs in a
 * row corrected an adjacent claim and left these, because each was the
 * next-door subject every time.
 *
 * 🔑 A per-test total cannot be derived in-repo, which is why it kept
 * decaying. Counting `it(` and `test(` calls gives 329; the suite reports 378,
 * because five `it.each(...)` calls expand to 49 tests. Expanding them
 * statically means evaluating array literals — one of them is a variable
 * declared above the call — so the "obvious" gate would be a parser that is
 * wrong by 49 and confidently green.
 *
 * So the docs now state only what IS derivable — the number of test files —
 * and the per-test number is gone rather than re-pinned to 378. A count no
 * gate can re-derive is a claim with a timer on it; the fourth hand-edited
 * figure would have been the same defect with a fresher number.
 */
describe("Test-suite claims in the docs", () => {
  const TESTS_DIR = resolve(SRC, "__tests__");
  const testFiles = readdirSync(TESTS_DIR).filter((f) => f.endsWith(".test.ts"));

  // Population check: if the glob ever yields nothing, every assertion below
  // would compare 0 against 0 or pass over an empty set.
  it("finds the test files it is counting", () => {
    expect(testFiles.length).toBeGreaterThan(0);
  });

  const fileClaims: Array<[string, string]> = [
    ["README.md", read(resolve(REPO, "README.md"))],
    ["COMPARISON.md", read(resolve(REPO, "COMPARISON.md"))],
  ];

  // ⚠ The **bold** is the scope marker, and it is load-bearing. COMPARISON.md
  // is a comparison: its table also states "6 test files" for a THIRD-PARTY
  // project, which this gate must not hold to our count. An unbolded figure is
  // someone else's; ours is bolded, which is how that file already wrote it.
  // A first version without this matched 6 and 23 alike and would have forced
  // another project's number to equal ours.
  const CLAIM = /\*\*(\d+) test files\*\*/g;

  it("the scope marker discriminates ours from a third party's", () => {
    // Two controls, because a pattern that matches nothing and a pattern that
    // matches everything both look like a passing gate from the outside.
    expect([..."ships **23 test files**".matchAll(CLAIM)].map((m) => m[1])).toEqual(["23"]);
    expect([..."27 (Go test), 6 test files".matchAll(CLAIM)]).toEqual([]);
  });

  it.each(fileClaims)("%s's test-file count matches src/__tests__", (name, text) => {
    const matches = [...text.matchAll(CLAIM)].map((m) => Number(m[1]));
    expect(matches, `${name} states no test-file count`).not.toEqual([]);
    for (const claimed of matches) {
      expect(claimed, `${name} claims ${claimed} test files, found ${testFiles.length}`)
        .toBe(testFiles.length);
    }
  });

  it("no doc re-pins a per-test count, because nothing can re-derive one", () => {
    // ⚠ Scope: the living docs only. CHANGELOG.md and the PLAN-* files state
    // counts as of a dated release and are correct AS history — gating them
    // would force rewriting the record every time the suite grows.
    const living = ["README.md", "COMPARISON.md", "CLAUDE.md", "CONTRIBUTING.md"];
    const pattern = /\b\d+ tests\b/g;

    // Positive control, inline: a negative assertion that never matches
    // anything passes whether or not the pattern works. This proves it does.
    expect("the suite has 378 tests today".match(pattern)).not.toBeNull();

    for (const name of living) {
      const text = read(resolve(REPO, name));
      expect(text.length, `${name} read as empty`).toBeGreaterThan(0);
      const hits = [...text.matchAll(pattern)].map((m) => m[0]);
      expect(hits, `${name} states a per-test count (${hits.join(", ")}) that no gate can check — state test files instead, or drop the number`)
        .toEqual([]);
    }
  });
});

/**
 * The ungated documents, 2026-11-17.
 *
 * `CLAUDE.md`'s numbers were gated (above) and were right. Every document
 * that was NOT gated had drifted, and the gap between the two is the whole
 * argument for this block:
 *
 *   - `README.md` claimed tier 2 = 81 and tier 3 = 169 against 95 and 161;
 *     listed 8 tier-0 actions while naming 7 and omitting `system_config_upload`;
 *     and carried a category table with an invented "Replication" category, no
 *     `service_config` row at all, and pool `import`/`destroy` actions that do
 *     not exist.
 *   - `COMPARISON.md` and `docs/` said 270 actions; the dispatcher registers 276.
 *   - `SECURITY.md` listed `1.0.x` as the actively supported line, four minors
 *     later. That one is not cosmetic: a reader on 1.0.0 would conclude they
 *     were covered.
 *   - `src/index.ts` reported `version: "1.1.2"` in the MCP handshake, which is
 *     what every connecting client is told the server is.
 *
 * 🔑 These gates derive from the registry the dispatcher actually builds, not
 * from a second list of what we believe it contains. A table of category names
 * checked against another table of category names would just be two things to
 * decay.
 */
describe("Previously ungated doc claims", () => {
  const registry = buildRegistry({
    call: async () => null,
  } as unknown as Parameters<typeof buildRegistry>[0]);

  const pkg = JSON.parse(read(resolve(REPO, "package.json"))) as { version: string };
  const readme = read(resolve(REPO, "README.md"));
  const comparison = read(resolve(REPO, "COMPARISON.md"));
  const security = read(resolve(REPO, "SECURITY.md"));
  const indexTs = read(resolve(SRC, "index.ts"));

  const perCategory = new Map<string, number>();
  for (const tool of registry.tools.values()) {
    perCategory.set(tool.category, (perCategory.get(tool.category) ?? 0) + 1);
  }

  it("the registry is populated, so the comparisons below are not over an empty set", () => {
    expect(registry.tools.size).toBeGreaterThan(100);
    expect(perCategory.size).toBeGreaterThan(5);
  });

  describe("README safety tiers", () => {
    const tiers = tierCounts(safetyText);
    const claims: Array<[string, RegExp, number]> = [
      ["tier 0", /\*\*Tier 0 — never register\.\*\* (\d+) actions/, tiers.Blocked],
      ["tier 1", /\*\*Tier 1 — confirm \+ reason\.\*\* (\d+) actions/, tiers.ConfirmWithReason],
      ["tier 2", /\*\*Tier 2 — confirm\.\*\* (\d+) actions/, tiers.Confirm],
      ["tier 3", /\*\*Tier 3 — open\.\*\* (\d+) actions/, tiers.Open],
    ];

    it.each(claims)("README's %s count matches src/safety.ts", (_name, re, actual) => {
      const m = readme.match(re);
      expect(m, `README no longer states this tier count in the expected shape`).not.toBeNull();
      expect(Number(m![1])).toBe(actual);
    });

    it("README names every tier-0 action, not just most of them", () => {
      // The original sentence read "reboot, shutdown, the raw-API escape
      // hatch, cron and init/shutdown script creation" — 8 claimed, 7
      // described, and the two *_update actions invisible. A count alone
      // cannot catch that, so this asserts the names.
      const blocked = [...safetyText.matchAll(/^\s*(\w+): SafetyTier\.Blocked,/gm)].map((m) => m[1]);
      expect(blocked.length).toBe(tiers.Blocked);
      const section = readme.slice(
        readme.indexOf("**Tier 0 — never register.**"),
        readme.indexOf("**Tier 1 — confirm + reason.**"),
      );
      expect(section.length).toBeGreaterThan(50);
      for (const name of blocked) {
        expect(section, `README's tier-0 paragraph does not name ${name}`).toContain(name);
      }
    });
  });

  describe("README category table", () => {
    // Rows look like: | `storage` (34) | ... |
    const rows = [...readme.matchAll(/^\| `([a-z_]+)` \((\d+)\) \|/gm)].map(
      (m) => [m[1], Number(m[2])] as const,
    );

    it("the table parses, so the assertions below have rows to check", () => {
      expect(rows.length).toBeGreaterThan(5);
    });

    it("names exactly the categories the dispatcher registers", () => {
      expect([...rows.map(([c]) => c)].sort()).toEqual([...perCategory.keys()].sort());
    });

    it.each(rows)("the `%s` row's count matches the registry", (cat, claimed) => {
      expect(claimed).toBe(perCategory.get(cat));
    });

    it("the row counts sum to the registered total", () => {
      // Catches a row that is individually right while the table as a whole
      // has gained or lost one.
      expect(rows.reduce((a, [, n]) => a + n, 0)).toBe(registry.tools.size);
    });
  });

  describe("Action and category totals outside CLAUDE.md", () => {
    it.each([
      ["README.md", readme],
      ["COMPARISON.md", comparison],
    ])("%s's bolded action count matches the registry", (_name, text) => {
      const m = [...text.matchAll(/\*\*(\d+) actions\*\*/g)].map((x) => Number(x[1]));
      const plain = [...text.matchAll(/^(\d+) actions across (\d+) categories/gm)].map((x) => [
        Number(x[1]),
        Number(x[2]),
      ]);
      expect(m.length + plain.length, "no action count found").toBeGreaterThan(0);
      for (const n of m) expect(n).toBe(registry.tools.size);
      for (const [actions, cats] of plain) {
        expect(actions).toBe(registry.tools.size);
        expect(cats).toBe(perCategory.size);
      }
    });

    it("COMPARISON's bolded category count matches the registry", () => {
      const m = comparison.match(/\*\*(\d+) categories\*\*/);
      expect(m, "COMPARISON states no bolded category count").not.toBeNull();
      expect(Number(m![1])).toBe(perCategory.size);
    });
  });

  describe("Version claims", () => {
    it("src/index.ts reports package.json's version in the MCP handshake", () => {
      const m = indexTs.match(/version:\s*"([^"]+)"/);
      expect(m, "src/index.ts no longer declares a version literal").not.toBeNull();
      expect(m![1]).toBe(pkg.version);
    });

    it("src/index.ts's server description states the registered action count", () => {
      const m = indexTs.match(/(\d+) safety-tiered actions/);
      expect(m, "src/index.ts no longer states an action count").not.toBeNull();
      expect(Number(m![1])).toBe(registry.tools.size);
    });

    it.each([
      ["README.md", readme, /\| \*\*Status\*\* \| v([0-9.]+) \|/],
      ["COMPARISON.md", comparison, /\| \*\*Status\*\* \| Released — v([0-9.]+) \|/],
    ])("%s's status row names the current version", (_name, text, re) => {
      const m = text.match(re);
      expect(m, "status row not found in the expected shape").not.toBeNull();
      expect(m![1]).toBe(pkg.version);
    });

    it("SECURITY.md's actively supported line is the current minor", () => {
      // A stale supported-versions table tells a reader on an old release
      // that they are covered. Derive the line from package.json.
      const minor = pkg.version.split(".").slice(0, 2).join(".");
      const m = security.match(/\| \*\*(\d+\.\d+)\.x\*\* \| ✅ Active \|/);
      expect(m, "SECURITY.md has no bolded active line in the expected shape").not.toBeNull();
      expect(m![1]).toBe(minor);
    });

    it("the newest CHANGELOG version heading is the current version", () => {
      // The inverse — a release with no CHANGELOG section — is asserted by
      // release.yml, where the tag exists. This catches a section with no
      // release, which is how [1.3.1] sat untagged between v1.3.0 and v1.4.0.
      const headings = [...read(resolve(REPO, "CHANGELOG.md")).matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)]
        .map((m) => m[1]);
      expect(headings.length).toBeGreaterThan(1);
      expect(headings[0]).toBe(pkg.version);
    });
  });

  it("no document links into a sibling repo checkout", () => {
    // `../sr-mcp-gateway/docs/CONFIGURATION.md` resolved in a local clone and
    // 404'd for every reader of this public repo — and the target repo is
    // private, so there is no public URL to fix it to.
    const docs = [
      ["README.md", readme],
      ["CLAUDE.md", claudeMd],
      ["COMPARISON.md", comparison],
      ["SECURITY.md", security],
      ...readdirSync(resolve(REPO, "docs"))
        .filter((f) => f.endsWith(".md"))
        .map((f) => [`docs/${f}`, read(resolve(REPO, "docs", f))] as [string, string]),
    ] as Array<[string, string]>;
    expect(docs.length).toBeGreaterThan(4);
    // Positive control: the pattern must match the form that was there.
    expect("see [x](../sr-mcp-gateway/docs/CONFIGURATION.md)").toMatch(/\]\(\.\.\/sr-[a-z-]+\//);
    for (const [name, text] of docs) {
      expect(text.length, `${name} read as empty`).toBeGreaterThan(0);
      const hits = [...text.matchAll(/\]\(\.\.\/sr-[a-z-]+\/[^)]*\)/g)].map((m) => m[0]);
      expect(hits, `${name} links into a sibling repo checkout: ${hits.join(", ")}`).toEqual([]);
    }
  });
});

/**
 * Two claims the test-count gate could not see.
 *
 * ⚠ The gate added with that block matched `/\b\d+ tests\b/`, and README's
 * comparison table states ours as a bare figure in a `Tests / CI` row —
 * `| **Tests / CI** | 226 / yes | 0 / no | 27 / yes |`. No word "tests", so
 * the gate read clean over a number stale by 150. The lesson is the same one
 * the bold-marker scoping taught: a pattern written for the phrasing you
 * remember misses the phrasing you used somewhere else.
 *
 * Scoping matters here for the same reason — the other two cells are OTHER
 * projects' counts, measured once and correct as dated facts. Only our cell
 * is checked, and it is identified structurally (the first data cell), not by
 * hoping a regex tells the columns apart.
 */
describe("The comparison table's own-project test cell", () => {
  const readme = read(resolve(REPO, "README.md"));
  const testFiles = readdirSync(resolve(SRC, "__tests__")).filter((f) => f.endsWith(".test.ts"));

  const row = readme.split("\n").find((l) => /^\| \*\*Tests \/ CI\*\* \|/.test(l));

  it("finds the row it is checking", () => {
    expect(row, "README has no `Tests / CI` comparison row").toBeDefined();
    expect(testFiles.length).toBeGreaterThan(0);
  });

  it("states no figure in our cell that is not the test-file count", () => {
    const cells = row!.split("|").map((c) => c.trim());
    // cells[0] is empty (leading pipe), [1] is the row label, [2] is ours.
    const ours = cells[2];
    expect(ours, "our cell is empty").toBeTruthy();
    const numbers = [...ours.matchAll(/\d+/g)].map((m) => Number(m[0]));
    expect(numbers.length, `our cell states no figure at all: ${ours}`).toBeGreaterThan(0);
    for (const n of numbers) {
      expect(
        n,
        `our Tests/CI cell says ${n}; the only checkable figure is the test-file count (${testFiles.length}). A per-test total cannot be re-derived here — see the block above.`,
      ).toBe(testFiles.length);
    }
    // The other projects' cells are dated measurements of someone else's
    // repo and are deliberately not touched.
    expect(cells[3]).toContain("0");
    expect(cells[4]).toContain("27");
  });
});

/**
 * The plans layout, per the house convention: two index files that are the
 * source of truth for status, and detail plans linked from them.
 */
describe("plans/ layout", () => {
  const PLANS = resolve(REPO, "plans");
  const entryRe = /^- \[([ x~-])\] (.+)$/gm;

  const indexes = ["OPEN-PLAN.md", "ROADMAP.md"];

  it.each(indexes)("plans/%s exists and its entries parse", (name) => {
    const text = read(resolve(PLANS, name));
    const entries = [...text.matchAll(entryRe)];
    expect(entries.length, `${name} has no \`- [m] text\` entries`).toBeGreaterThan(0);
  });

  it("every detail plan is linked from exactly one index entry", () => {
    const details = readdirSync(PLANS).filter((f) => f.endsWith(".md") && !indexes.includes(f));
    expect(details.length, "no detail plans found").toBeGreaterThan(0);
    const entryText = indexes
      .flatMap((n) => [...read(resolve(PLANS, n)).matchAll(entryRe)].map((m) => m[2]))
      .join("\n");
    for (const f of details) {
      const refs = entryText.split("\n").filter((line) => line.includes(f));
      expect(refs.length, `plans/${f} is linked from ${refs.length} index entries, want 1`).toBe(1);
    }
  });

  it("no plan file is left at the repo root", () => {
    const stray = readdirSync(REPO).filter((f) => /^PLAN.*\.md$/.test(f));
    expect(stray).toEqual([]);
  });
});
