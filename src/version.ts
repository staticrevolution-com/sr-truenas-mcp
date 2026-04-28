/**
 * Build-time version stamp.
 *
 * `__BUILD_VERSION__` is replaced at bundle time by esbuild's `--define` flag
 * (see `scripts/build-bundle.mjs`) with a string like `"1.0.1+abc1234"` —
 * that's `pkg.version` plus the git short SHA at build time. The pkg-built
 * Linux binary embeds the substituted literal.
 *
 * In contexts where no bundling step ran (direct `node dist/cli.js`,
 * vitest), the symbol is undeclared. `typeof` evaluates to `"undefined"`
 * without throwing, so we fall back to a `"dev"` marker.
 */
declare const __BUILD_VERSION__: string;

export const BUILD_VERSION: string =
  typeof __BUILD_VERSION__ !== "undefined" ? __BUILD_VERSION__ : "dev";
