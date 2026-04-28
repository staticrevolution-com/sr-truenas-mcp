#!/usr/bin/env node
/**
 * audit-counts — print the structural counts CLAUDE.md claims, derived from
 * source. Run via `npm run audit:counts`. Intended as a drift-detection aid:
 * if CLAUDE.md says "57 exact filter keys" and this script prints 60, the doc
 * is stale.
 *
 * Pure static text analysis — no module imports, no build dependency. Works
 * against `src/` directly so it stays accurate even when the dist/ tree is
 * absent.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const SRC = join(REPO, "src");

function read(p) {
  return readFileSync(p, "utf8");
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

function countSetEntries(text, varName) {
  // Match `export const X = new Set<string>([ ... ]);` and count quoted strings.
  const re = new RegExp(`export const ${varName}[^=]*=\\s*new Set<string>\\(\\[([\\s\\S]*?)\\]\\)`);
  const m = text.match(re);
  if (!m) return null;
  const body = m[1];
  // Strip line comments before counting strings to avoid false positives.
  const stripped = body.replace(/\/\/[^\n]*/g, "");
  const matches = stripped.match(/"[^"]+"/g);
  return matches ? matches.length : 0;
}

function countSuffixPatterns(text) {
  const re = /export const SUFFIX_PATTERNS:[^=]*=\s*\[([\s\S]*?)\]/;
  const m = text.match(re);
  if (!m) return null;
  const body = m[1].replace(/\/\/[^\n]*/g, "");
  const matches = body.match(/\/[^/\n]+\/[a-z]*/g);
  return matches ? matches.length : 0;
}

function tierCounts(safetyText) {
  const tally = { Blocked: 0, ConfirmWithReason: 0, Confirm: 0, Open: 0 };
  for (const line of safetyText.split("\n")) {
    const m = line.match(/SafetyTier\.(Blocked|ConfirmWithReason|Confirm|Open),?\s*$/);
    if (m) tally[m[1]]++;
  }
  return tally;
}

function countActionTierEntries(safetyText) {
  // Crude: match `^  identifier: SafetyTier....` inside the ACTION_TIERS object.
  const m = safetyText.match(/export const ACTION_TIERS[^=]*=\s*\{([\s\S]*?)\n\};/);
  if (!m) return null;
  const body = m[1];
  const matches = body.match(/^\s+[a-z_][a-z0-9_]*:\s*SafetyTier\./gim);
  return matches ? matches.length : 0;
}

function countCallSites(files, pattern) {
  let n = 0;
  for (const f of files) {
    const text = read(f);
    for (const line of text.split("\n")) {
      if (line.includes("import")) continue;
      if (pattern.test(line)) n++;
    }
  }
  return n;
}

function countConfirmGuards(files) {
  // Match in-handler `if (!confirm)` defense-in-depth checks. Excludes
  // registry-level enforcement; only counts handler bodies under src/tools/.
  let n = 0;
  for (const f of files) {
    const text = read(f);
    const matches = text.match(/if\s*\(\s*!confirm\s*\)/g);
    if (matches) n += matches.length;
  }
  return n;
}

const filtersText = read(join(SRC, "filters.ts"));
const safetyText = read(join(SRC, "safety.ts"));
const toolFiles = walk(join(SRC, "tools"));

const exactKeys = countSetEntries(filtersText, "SENSITIVE_KEYS");
const suffixCount = countSuffixPatterns(filtersText);
const allowlist = countSetEntries(filtersText, "NEVER_REDACT");

const tiers = tierCounts(safetyText);
const totalEntries = countActionTierEntries(safetyText);
const registered = totalEntries == null ? null : totalEntries - tiers.Blocked;

const pathValidationSites = countCallSites(toolFiles, /validateTrueNASPath\(/);
const datasetValidationSites = countCallSites(toolFiles, /validateDatasetName\(/);
const confirmGuards = countConfirmGuards(toolFiles);

const lines = [
  "Filter coverage (src/filters.ts):",
  `  Exact keys (SENSITIVE_KEYS):     ${exactKeys}`,
  `  Suffix patterns:                 ${suffixCount}`,
  `  NEVER_REDACT allowlist:          ${allowlist}`,
  "",
  "Safety tiers (src/safety.ts):",
  `  Tier 0 — Blocked:                ${tiers.Blocked}`,
  `  Tier 1 — ConfirmWithReason:      ${tiers.ConfirmWithReason}`,
  `  Tier 2 — Confirm:                ${tiers.Confirm}`,
  `  Tier 3 — Open:                   ${tiers.Open}`,
  `  Total ACTION_TIERS entries:      ${totalEntries}`,
  `  Registered (total − blocked):    ${registered}`,
  "",
  "Validation surface (src/tools/*.ts):",
  `  validateTrueNASPath call sites:  ${pathValidationSites}`,
  `  validateDatasetName call sites:  ${datasetValidationSites}`,
  `  In-handler !confirm guards:      ${confirmGuards}`,
];

console.log(lines.join("\n"));
