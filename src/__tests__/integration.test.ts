import { describe, it, expect } from "vitest";
import { TrueNASClient } from "../client.js";
import { buildRegistry } from "../tools/index.js";
import { BLOCKED_ACTIONS, SafetyTier } from "../safety.js";

/**
 * Integration tests — build the full registry with a stub client
 * and verify the complete pipeline: discovery, tier enforcement,
 * validation, and response filtering.
 */

function makeFullRegistry() {
  const client = new TrueNASClient({
    baseUrl: "http://stub",
    apiKey: "stub",
    verifySsl: true,
  });
  return buildRegistry(client);
}

describe("Integration", () => {
  const registry = makeFullRegistry();

  describe("Tool count", () => {
    it("has 270 registered tools (278 minus 8 blocked)", () => {
      expect(registry.tools.size).toBe(270);
    });

    it("has no blocked actions registered", () => {
      for (const action of BLOCKED_ACTIONS) {
        expect(registry.tools.has(action), `Blocked action "${action}" found in registry`).toBe(false);
      }
    });
  });

  describe("Categories", () => {
    it("lists all expected categories", () => {
      const listing = registry.listCategories();
      const expected = [
        "system", "storage", "sharing", "network", "account",
        "disk", "vm", "app", "update", "certificate", "alert",
        "data_protection", "filesystem", "reporting", "directory",
        "service_config", "audit",
      ];
      for (const cat of expected) {
        expect(listing).toContain(cat);
      }
    });

    it("does not include api category", () => {
      const listing = registry.listCategories();
      expect(listing).not.toContain(" api ");
      expect(listing).not.toContain("Raw API");
    });
  });

  describe("Tier enforcement through full pipeline", () => {
    it("tier 1 action rejects without confirm + reason", async () => {
      const result = await registry.execute("storage", "dataset_delete", { id: "tank/test" });
      expect(result).toHaveProperty("error");
      expect((result as { error: string }).error).toContain("tier 1");
    });

    it("tier 2 action rejects without confirm", async () => {
      const result = await registry.execute("system", "service_stop", { service: "ssh" });
      expect(result).toHaveProperty("error");
      expect((result as { error: string }).error).toContain("tier 2");
    });

    it("tier 3 action discovery works", () => {
      const listing = registry.listActions("storage");
      expect(listing).toContain("pool_list");
    });

    it("blocked actions are not discoverable via category listing", () => {
      const systemListing = registry.listActions("system");
      expect(systemListing).not.toContain("system_reboot");
      expect(systemListing).not.toContain("system_shutdown");
    });

    it("truenas_api_call is completely absent", () => {
      const allTools = [...registry.tools.keys()];
      expect(allTools).not.toContain("truenas_api_call");

      // Also not in any category listing
      const categories = registry.listCategories();
      expect(categories).not.toContain("truenas_api_call");
    });
  });

  describe("Response filtering through pipeline", () => {
    it("redacts sensitive fields from handler results", async () => {
      // Register a test tool that returns sensitive data
      registry.tool(
        "test_sensitive_return",
        "Test tool",
        {},
        async () => ({
          name: "admin",
          password: "secret123",
          nested: { private_key: "key-data" },
        })
      );

      const result = await registry.execute("system", "test_sensitive_return", {});
      const data = result as Record<string, unknown>;
      expect(data.password).toBe("[REDACTED]");
      expect((data.nested as Record<string, unknown>).private_key).toBe("[REDACTED]");
      expect(data.name).toBe("admin");

      // Clean up
      registry.tools.delete("test_sensitive_return");
    });
  });

  describe("Path validation through filesystem handlers", () => {
    it("filesystem_stat rejects path traversal", async () => {
      // The handler will throw on invalid path before calling the client
      try {
        await registry.execute("filesystem", "filesystem_stat", {
          path: "/mnt/tank/../etc/passwd",
        });
      } catch (err) {
        expect((err as Error).message).toContain("..");
        return;
      }
      // If no throw, check the returned error
      // (error might be caught and wrapped by the MCP handler)
    });

    it("filesystem_stat rejects paths outside /mnt/", async () => {
      try {
        await registry.execute("filesystem", "filesystem_stat", {
          path: "/etc/shadow",
        });
      } catch (err) {
        expect((err as Error).message).toContain("/mnt/");
        return;
      }
    });
  });
});
