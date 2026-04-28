import { describe, it, expect } from "vitest";
import { BUILD_VERSION } from "../version.js";

describe("BUILD_VERSION (A9)", () => {
  it("falls back to 'dev' when no esbuild --define stamp ran", () => {
    // Vitest runs the TS source directly without going through the
    // bundle script that injects __BUILD_VERSION__. The fallback path
    // is what's exercised here; the bundled-binary path is covered by
    // the smoke check `node dist/bundle.cjs --version` after bundling.
    expect(BUILD_VERSION).toBe("dev");
  });
});
