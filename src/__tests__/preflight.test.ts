import { describe, it, expect } from "vitest";
import { preflight, formatPreflightFailure, type PreflightClient } from "../preflight.js";

/**
 * Tests for the pre-flight health check (B5). Uses stub clients implementing
 * the minimal PreflightClient interface; no real WebSocket involved.
 */

function stub(opts: {
  connectErr?: Error;
  callErr?: Error;
  callResult?: unknown;
  connectDelayMs?: number;
  callDelayMs?: number;
}): PreflightClient {
  return {
    async connect() {
      if (opts.connectDelayMs) await new Promise((r) => setTimeout(r, opts.connectDelayMs));
      if (opts.connectErr) throw opts.connectErr;
    },
    async call() {
      if (opts.callDelayMs) await new Promise((r) => setTimeout(r, opts.callDelayMs));
      if (opts.callErr) throw opts.callErr;
      return opts.callResult ?? { version: "TrueNAS-25.10.1" };
    },
  };
}

describe("preflight (B5)", () => {
  it("returns ok on a successful round-trip", async () => {
    const result = await preflight(stub({}));
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("captures connect-time failures", async () => {
    const result = await preflight(stub({ connectErr: new Error("ECONNREFUSED") }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
  });

  it("captures auth/call-time failures", async () => {
    const result = await preflight(
      stub({ callErr: new Error("TrueNAS API error: invalid api key") }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("invalid api key");
  });

  it("hard-fails when total time exceeds the timeout", async () => {
    // 200ms timeout, but call takes 500ms → race rejects on the timer.
    const result = await preflight(stub({ callDelayMs: 500 }), 200);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/pre-flight timed out after 200ms/);
    // Duration is bounded by the timer; allow some scheduling slack.
    expect(result.durationMs).toBeLessThan(400);
  });

  it("non-Error rejection reasons are stringified", async () => {
    const odd: PreflightClient = {
      async connect() {
        throw "raw string error";
      },
      async call() {
        return null;
      },
    };
    const result = await preflight(odd);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("raw string error");
  });
});

describe("formatPreflightFailure (B5)", () => {
  it("includes the error, duration, and base URL", () => {
    const text = formatPreflightFailure(
      { ok: false, error: "ECONNREFUSED", durationMs: 1234 },
      "wss://truenas.local:444",
    );
    expect(text).toContain("ECONNREFUSED");
    expect(text).toContain("1234ms");
    expect(text).toContain("wss://truenas.local:444");
  });

  it("mentions the bypass flag", () => {
    const text = formatPreflightFailure(
      { ok: false, error: "any", durationMs: 0 },
      "wss://x",
    );
    expect(text).toContain("TRUENAS_SKIP_PREFLIGHT=1");
  });

  it("lists the four common failure causes", () => {
    const text = formatPreflightFailure(
      { ok: false, error: "any", durationMs: 0 },
      "wss://x",
    );
    expect(text).toContain("TRUENAS_URL");
    expect(text).toContain("TRUENAS_API_KEY");
    expect(text).toContain("TRUENAS_VERIFY_SSL");
    expect(text).toContain("Network");
  });
});
