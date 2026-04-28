import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "../registry.js";
import { SafetyTier } from "../safety.js";

/**
 * Tests for registry-level safety enforcement.
 * Uses a minimal registry with hand-registered tools — no real TrueNAS client.
 */

function makeRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  // Tier 0 — should be blocked at registration
  registry.tool(
    "system_reboot",
    "Reboot the system",
    {},
    async () => ({ result: "rebooted" })
  );

  // Tier 1 — confirm + reason required
  registry.tool(
    "pool_export",
    "Export a pool",
    { pool_id: z.number().describe("Pool ID") },
    async (params) => ({ exported: params.pool_id })
  );

  // Tier 2 — confirm required
  registry.tool(
    "service_stop",
    "Stop a service",
    { service: z.string().describe("Service name") },
    async (params) => ({ stopped: params.service })
  );

  // Tier 3 — open
  registry.tool(
    "pool_list",
    "List pools",
    {},
    async () => ({ pools: ["tank"] })
  );

  // Tier 3 with params — for Zod validation testing
  registry.tool(
    "dataset_get",
    "Get dataset details",
    { id: z.string().describe("Dataset ID") },
    async (params) => ({ dataset: params.id })
  );

  return registry;
}

describe("Registry safety enforcement", () => {
  const registry = makeRegistry();

  describe("Tier 0 — Blocked", () => {
    it("does not register blocked actions", () => {
      expect(registry.tools.has("system_reboot")).toBe(false);
    });

    it("blocked actions are not discoverable", () => {
      const listing = registry.listCategories();
      expect(listing).not.toContain("system_reboot");
    });

    it("blocked actions cannot be executed", async () => {
      const result = await registry.execute("system", "system_reboot", {});
      expect(result).toHaveProperty("error");
      expect((result as { error: string }).error).toContain("Unknown action");
    });
  });

  describe("Tier 1 — Confirm + Reason", () => {
    it("returns warning without confirm", async () => {
      const result = await registry.execute("storage", "pool_export", { pool_id: 1 });
      expect(result).toHaveProperty("content");
      const text = (result as { content: Array<{ text: string }> }).content[0].text;
      expect(text).toContain("HIGH-RISK");
      expect(text).toContain("pool_export");
      expect(text).toContain("confirm: true");
    });

    it("returns warning with confirm but no reason", async () => {
      const result = await registry.execute("storage", "pool_export", {
        pool_id: 1,
        confirm: true,
      });
      expect(result).toHaveProperty("content");
      const text = (result as { content: Array<{ text: string }> }).content[0].text;
      expect(text).toContain("REASON REQUIRED");
    });

    it("returns warning with confirm and empty reason", async () => {
      const result = await registry.execute("storage", "pool_export", {
        pool_id: 1,
        confirm: true,
        reason: "   ",
      });
      expect(result).toHaveProperty("content");
      const text = (result as { content: Array<{ text: string }> }).content[0].text;
      expect(text).toContain("REASON REQUIRED");
    });

    it("accepts with confirm and reason", async () => {
      const result = await registry.execute("storage", "pool_export", {
        pool_id: 1,
        confirm: true,
        reason: "Migrating to new pool layout",
      });
      expect(result).toEqual({ exported: 1 });
    });
  });

  describe("Tier 2 — Confirm", () => {
    it("returns warning without confirm", async () => {
      const result = await registry.execute("system", "service_stop", {
        service: "ssh",
      });
      expect(result).toHaveProperty("content");
      const text = (result as { content: Array<{ text: string }> }).content[0].text;
      expect(text).toContain("DESTRUCTIVE");
      expect(text).toContain("service_stop");
      expect(text).toContain("confirm: true");
    });

    it("accepts with confirm", async () => {
      const result = await registry.execute("system", "service_stop", {
        service: "ssh",
        confirm: true,
      });
      expect(result).toEqual({ stopped: "ssh" });
    });
  });

  describe("Tier 3 — Open", () => {
    it("executes without any gate", async () => {
      const result = await registry.execute("storage", "pool_list", {});
      expect(result).toEqual({ pools: ["tank"] });
    });
  });

  describe("Zod validation", () => {
    it("rejects invalid param types", async () => {
      const result = await registry.execute("storage", "pool_export", {
        pool_id: "not-a-number",
        confirm: true,
        reason: "test",
      });
      expect(result).toHaveProperty("error");
      expect((result as { error: string }).error).toContain("Validation failed");
    });

    it("passes valid params through to handler", async () => {
      const result = await registry.execute("storage", "dataset_get", { id: "tank/data" });
      expect(result).toEqual({ dataset: "tank/data" });
    });
  });

  describe("Discovery", () => {
    it("annotates tier 1 actions as destructive in listings", () => {
      const listing = registry.listActions("storage");
      expect(listing).toContain("[destructive: requires confirm + reason]");
    });

    it("annotates tier 2 actions as destructive in listings", () => {
      const listing = registry.listActions("system");
      expect(listing).toContain("[destructive: requires confirm]");
    });

    it("does not annotate tier 3 actions", () => {
      const listing = registry.listActions("storage");
      // pool_list is tier 3, should not have any tier annotation
      const poolListLine = listing.split("\n").find((l) => l.includes("pool_list"));
      expect(poolListLine).not.toContain("[destructive");
      expect(poolListLine).not.toContain("[requires");
    });

    it("does not include api category", () => {
      const categories = registry.listCategories();
      expect(categories).not.toContain("api ");
      expect(categories).not.toContain("Raw API");
    });
  });
});
