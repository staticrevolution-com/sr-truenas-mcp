import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createLogger, noopLogger } from "../logger.js";

/**
 * Tests for the structured stderr logger (B3). Covers:
 * - Level threshold from explicit arg and from TRUENAS_LOG_LEVEL env.
 * - JSON-line format with required fields (ts, level, msg).
 * - Custom field merging.
 * - Circular-structure failsafe (logger never throws on bad input).
 */

describe("createLogger (B3)", () => {
  describe("level filtering", () => {
    it("default level is error — info/warn/debug are dropped", () => {
      const captured: string[] = [];
      const log = createLogger({ level: "error", sink: (l) => captured.push(l) });
      log.error("e");
      log.warn("w");
      log.info("i");
      log.debug("d");
      expect(captured).toHaveLength(1);
      expect(JSON.parse(captured[0]).msg).toBe("e");
    });

    it("info level emits error+warn+info, drops debug", () => {
      const captured: string[] = [];
      const log = createLogger({ level: "info", sink: (l) => captured.push(l) });
      log.error("e");
      log.warn("w");
      log.info("i");
      log.debug("d");
      expect(captured).toHaveLength(3);
      expect(captured.map((l) => JSON.parse(l).level)).toEqual(["error", "warn", "info"]);
    });

    it("debug level emits everything", () => {
      const captured: string[] = [];
      const log = createLogger({ level: "debug", sink: (l) => captured.push(l) });
      log.error("e");
      log.warn("w");
      log.info("i");
      log.debug("d");
      expect(captured).toHaveLength(4);
    });
  });

  describe("env-driven level (TRUENAS_LOG_LEVEL)", () => {
    let original: string | undefined;
    beforeEach(() => {
      original = process.env.TRUENAS_LOG_LEVEL;
    });
    afterEach(() => {
      if (original === undefined) delete process.env.TRUENAS_LOG_LEVEL;
      else process.env.TRUENAS_LOG_LEVEL = original;
    });

    it("reads TRUENAS_LOG_LEVEL when no explicit level is given", () => {
      process.env.TRUENAS_LOG_LEVEL = "info";
      const captured: string[] = [];
      const log = createLogger({ sink: (l) => captured.push(l) });
      log.info("i");
      expect(captured).toHaveLength(1);
    });

    it("falls back to error on missing env var", () => {
      delete process.env.TRUENAS_LOG_LEVEL;
      const captured: string[] = [];
      const log = createLogger({ sink: (l) => captured.push(l) });
      log.info("i");
      expect(captured).toHaveLength(0);
    });

    it("falls back to error on invalid env value", () => {
      process.env.TRUENAS_LOG_LEVEL = "trace";
      const captured: string[] = [];
      const log = createLogger({ sink: (l) => captured.push(l) });
      log.info("i");
      expect(captured).toHaveLength(0);
    });
  });

  describe("output format", () => {
    it("emits one JSON object per line with ts, level, msg", () => {
      const captured: string[] = [];
      const log = createLogger({ level: "debug", sink: (l) => captured.push(l) });
      log.info("hello");
      const parsed = JSON.parse(captured[0]);
      expect(parsed.level).toBe("info");
      expect(parsed.msg).toBe("hello");
      expect(typeof parsed.ts).toBe("string");
      expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("merges caller fields onto the entry", () => {
      const captured: string[] = [];
      const log = createLogger({ level: "debug", sink: (l) => captured.push(l) });
      log.info("rpc ok", { method: "pool.query", durMs: 12 });
      const parsed = JSON.parse(captured[0]);
      expect(parsed.method).toBe("pool.query");
      expect(parsed.durMs).toBe(12);
    });

    it("never throws on circular fields — emits a fallback line instead", () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      const captured: string[] = [];
      const log = createLogger({ level: "debug", sink: (l) => captured.push(l) });
      expect(() => log.info("circular", circular)).not.toThrow();
      expect(captured).toHaveLength(1);
      const parsed = JSON.parse(captured[0]);
      expect(parsed._logErr).toBe(true);
      expect(parsed.msg).toBe("circular");
    });
  });

  describe("isEnabled", () => {
    it("reports correctly per level", () => {
      const log = createLogger({ level: "info", sink: () => {} });
      expect(log.isEnabled("error")).toBe(true);
      expect(log.isEnabled("warn")).toBe(true);
      expect(log.isEnabled("info")).toBe(true);
      expect(log.isEnabled("debug")).toBe(false);
    });
  });
});

describe("noopLogger (B3)", () => {
  it("never emits", () => {
    expect(() => {
      noopLogger.error("x");
      noopLogger.warn("x");
      noopLogger.info("x");
      noopLogger.debug("x");
    }).not.toThrow();
    expect(noopLogger.isEnabled("error")).toBe(false);
  });
});
