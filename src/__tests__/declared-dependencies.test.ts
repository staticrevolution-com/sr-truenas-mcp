import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Gates against a PHANTOM DEPENDENCY: a package this repo imports but does
 * not declare.
 *
 * `zod` was one from the beginning. Ten source files `import { z } from
 * "zod"` — it backs every tool schema here — and it appeared in no
 * dependency list at all. It resolved only because the MCP SDK's own copy
 * sits hoisted at the top of `node_modules`, so nothing ever failed.
 *
 * Two things made that worse than untidy. The version was set entirely by a
 * transitive: the 2026-10-25 advisory sweep moved it 4.3.6 -> 4.6.7
 * underneath us with no change to our manifest. And the SDK's declared range
 * is `^3.25 || ^4.0`, which SPANS A MAJOR BOUNDARY — so a legitimate
 * resolution of the SDK's own constraint could hand this repo zod 3, against
 * which its schemas are not written.
 *
 * A declared range fixes the instance. This test is what stops the class:
 * it re-derives every bare import specifier from source and fails on any
 * that no dependency list covers. Restating "zod is declared" in a doc would
 * not have caught the next one.
 */

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== "__tests__") sourceFiles(full, out);
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Strip comments before scanning.
 *
 * The first version of this test did not, and reported `server rejected` as
 * an undeclared package — matching the words `from "server rejected"` inside
 * a PROSE COMMENT in `client.ts`. A gate that reports a package nobody
 * imported is a gate someone switches off, so the two guards below are
 * deliberate and each would catch that case alone: comments are removed, and
 * a specifier containing whitespace is rejected (no package name has a space).
 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Bare specifiers only: skip relative paths and `node:` builtins. */
function importedPackages(files: string[]): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const re = /(?:\bfrom\s+|\bimport\s*\(?\s*)["']([^"']+)["']/g;
  for (const file of files) {
    const text = stripComments(readFileSync(file, "utf8"));
    for (const m of text.matchAll(re)) {
      const spec = m[1];
      if (spec.startsWith(".") || spec.startsWith("node:")) continue;
      if (/\s/.test(spec)) continue; // prose, not a package name
      const parts = spec.split("/");
      const pkg = spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
      const rel = file.slice(REPO.length + 1);
      found.set(pkg, [...(found.get(pkg) ?? []), rel]);
    }
  }
  return found;
}

describe("Every package imported by src/ is declared in package.json", () => {
  const pkg = JSON.parse(readFileSync(resolve(REPO, "package.json"), "utf8"));
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
  ]);
  const imported = importedPackages(sourceFiles(resolve(REPO, "src")));

  it("finds imports to check, so the assertion cannot pass by being empty", () => {
    // A negative assertion over an empty set passes trivially. The population
    // is known non-empty: the SDK and ws are both imported by name.
    expect(imported.size).toBeGreaterThanOrEqual(2);
    expect([...imported.keys()]).toContain("@modelcontextprotocol/sdk");
  });

  it("declares zod, which is imported by the schema layer", () => {
    // The specific regression. Kept alongside the general rule because this
    // one was live for the project's whole history.
    expect(imported.has("zod")).toBe(true);
    expect(pkg.dependencies?.zod).toBeTruthy();
  });

  it("does not mistake prose in a comment for an import", () => {
    // The exact regression: client.ts line 108 contains the words
    // `from "server rejected"` inside a comment. Both guards must hold.
    expect([...imported.keys()]).not.toContain("server");
    expect([...imported.keys()].some((k) => /\s/.test(k))).toBe(false);
    expect(stripComments('// x from "ghost"\n').includes("ghost")).toBe(false);
    expect(stripComments('/* from "ghost" */').includes("ghost")).toBe(false);
    // ...while a real import on the next line still survives stripping.
    expect(stripComments('// c\nimport x from "real";').includes("real")).toBe(true);
  });

  it("declares every imported package", () => {
    const undeclared = [...imported.entries()]
      .filter(([name]) => !declared.has(name))
      .map(([name, files]) => `${name} (imported by ${files.join(", ")})`);
    expect(undeclared).toEqual([]);
  });
});
