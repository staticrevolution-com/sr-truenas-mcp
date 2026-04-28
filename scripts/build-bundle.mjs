#!/usr/bin/env node
/**
 * Bundle dist/cli.js into dist/bundle.cjs with a build-time version stamp.
 *
 * Replaces the previous one-line `esbuild` package.json script so we can
 * inject `__BUILD_VERSION__` (pkg.version + git short SHA). The pkg-packaged
 * Linux binary embeds the substituted literal; `--version` reports it.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

const pkg = JSON.parse(readFileSync(resolve(REPO, "package.json"), "utf8"));

let sha = "unknown";
try {
  sha = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { cwd: REPO })
    .toString()
    .trim();
} catch {
  // git unavailable / not a checkout — leave "unknown"
}

let dirty = "";
try {
  const status = execFileSync("git", ["status", "--porcelain"], { cwd: REPO })
    .toString()
    .trim();
  if (status.length > 0) dirty = ".dirty";
} catch {
  // ignore
}

const version = `${pkg.version}+${sha}${dirty}`;

await esbuild.build({
  entryPoints: [resolve(REPO, "dist/cli.js")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: resolve(REPO, "dist/bundle.cjs"),
  define: {
    __BUILD_VERSION__: JSON.stringify(version),
  },
  logLevel: "info",
});

console.log(`Bundled with __BUILD_VERSION__=${version}`);
