import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
