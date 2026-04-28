import { describe, it, expect } from "vitest";
import { TRUENAS_TOOL_ANNOTATIONS } from "../index.js";

/**
 * Tests for the MCP ToolAnnotations exported from src/index.ts.
 * These are the coarse-grained tool-level hints the MCP spec defines;
 * per-action destructiveness lives in the tier system surfaced via
 * registry.listActions() (covered in registry.test.ts).
 */

describe("TRUENAS_TOOL_ANNOTATIONS (B1)", () => {
  it("declares destructiveHint: true", () => {
    expect(TRUENAS_TOOL_ANNOTATIONS.destructiveHint).toBe(true);
  });

  it("declares readOnlyHint: false", () => {
    // Explicitly false — tool can modify state. readOnlyHint: false
    // pairs with destructiveHint: true to fully describe the surface.
    expect(TRUENAS_TOOL_ANNOTATIONS.readOnlyHint).toBe(false);
  });

  it("declares openWorldHint: true", () => {
    // The tool talks to a remote system (TrueNAS over WS). openWorldHint
    // tells clients that effects extend beyond the local MCP server.
    expect(TRUENAS_TOOL_ANNOTATIONS.openWorldHint).toBe(true);
  });

  it("provides a human-readable title", () => {
    expect(typeof TRUENAS_TOOL_ANNOTATIONS.title).toBe("string");
    expect(TRUENAS_TOOL_ANNOTATIONS.title.length).toBeGreaterThan(0);
  });

  it("does not declare idempotentHint (varies per action)", () => {
    // Idempotency is per-action, not tool-wide — leaving the hint absent
    // is more honest than declaring a value that isn't uniformly true.
    expect((TRUENAS_TOOL_ANNOTATIONS as Record<string, unknown>).idempotentHint).toBeUndefined();
  });
});
