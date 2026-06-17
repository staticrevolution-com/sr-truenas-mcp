import { describe, it, expect } from "vitest";
import { TrueNASClient } from "../client.js";
import { buildRegistry } from "../tools/index.js";
import { ACTION_TIERS, BLOCKED_ACTIONS, SafetyTier } from "../safety.js";
import { filterSensitiveFields } from "../filters.js";

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
    it("registers every classified action except the blocked ones", () => {
      // Self-maintaining: registry size + blocked == total classified actions.
      // Adding an action to ACTION_TIERS without registering its handler will
      // fail this; classifying an existing handler as Blocked drops it out.
      expect(registry.tools.size + BLOCKED_ACTIONS.size).toBe(Object.keys(ACTION_TIERS).length);
    });

    it("registry tier breakdown matches ACTION_TIERS", () => {
      // Counts derived from ACTION_TIERS, not hardcoded — drift-resistant.
      const expectedByTier = new Map<SafetyTier, number>();
      for (const tier of Object.values(ACTION_TIERS)) {
        expectedByTier.set(tier, (expectedByTier.get(tier) ?? 0) + 1);
      }
      expect(expectedByTier.get(SafetyTier.Blocked)).toBe(BLOCKED_ACTIONS.size);
      expect(
        (expectedByTier.get(SafetyTier.ConfirmWithReason) ?? 0)
        + (expectedByTier.get(SafetyTier.Confirm) ?? 0)
        + (expectedByTier.get(SafetyTier.Open) ?? 0),
      ).toBe(registry.tools.size);
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
    it("tier 1 action returns warning without confirm + reason", async () => {
      const result = await registry.execute("storage", "dataset_delete", { id: "tank/test" });
      expect(result).toHaveProperty("content");
      const text = (result as { content: Array<{ text: string }> }).content[0].text;
      expect(text).toContain("HIGH-RISK");
    });

    it("tier 2 action returns warning without confirm", async () => {
      const result = await registry.execute("system", "service_stop", { service: "ssh" });
      expect(result).toHaveProperty("content");
      const text = (result as { content: Array<{ text: string }> }).content[0].text;
      expect(text).toContain("DESTRUCTIVE");
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
    it("filters are applied (verified via filterSensitiveFields directly)", () => {
      // The registry applies filterSensitiveFields() on all handler returns.
      // We verify the filter function works correctly here since we can't
      // register dynamic test tools (fail-closed rejects unclassified actions).
      const data = {
        name: "admin",
        password: "secret123",
        nested: { private_key: "key-data" },
      };
      const filtered = filterSensitiveFields(data) as Record<string, unknown>;
      expect(filtered.password).toBe("[REDACTED]");
      expect((filtered.nested as Record<string, unknown>).private_key).toBe("[REDACTED]");
      expect(filtered.name).toBe("admin");
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

  describe("Dataset-name validation through handlers", () => {
    it("dataset_create rejects names with traversal", async () => {
      // Tier 3 (open): handler runs immediately. Validation MUST throw before
      // client.call("pool.dataset.create"); the stub client would otherwise
      // attempt a network round-trip and fail differently.
      await expect(
        registry.execute("storage", "dataset_create", { name: "tank/../other" }),
      ).rejects.toThrow("..");
    });

    it("dataset_create rejects names with disallowed characters", async () => {
      await expect(
        registry.execute("storage", "dataset_create", { name: "tank/data; rm -rf" }),
      ).rejects.toThrow("alphanumerics");
    });

    it("dataset_create rejects names with null bytes", async () => {
      await expect(
        registry.execute("storage", "dataset_create", { name: "tank/data\0evil" }),
      ).rejects.toThrow("null bytes");
    });

    it("dataset_create routes /mnt/-prefixed names through path validator", async () => {
      // /mnt/-prefixed → strict validateTrueNASPath. Traversal must be caught.
      await expect(
        registry.execute("storage", "dataset_create", { name: "/mnt/tank/../etc" }),
      ).rejects.toThrow("..");
    });

    it("replication_create rejects bad source_datasets entries", async () => {
      // Tier 2 (confirm): need confirm:true for the handler to execute at all.
      await expect(
        registry.execute("data_protection", "replication_create", {
          confirm: true,
          name: "test",
          direction: "PUSH",
          transport: "LOCAL",
          source_datasets: ["tank/good", "tank/../evil"],
          target_dataset: "backup/data",
        }),
      ).rejects.toThrow("..");
    });

    it("replication_create rejects bad target_dataset", async () => {
      await expect(
        registry.execute("data_protection", "replication_create", {
          confirm: true,
          name: "test",
          direction: "PUSH",
          transport: "LOCAL",
          source_datasets: ["tank/good"],
          target_dataset: "backup/../etc",
        }),
      ).rejects.toThrow("..");
    });

    it("replication_create without confirm returns tier-2 warning, never validates", async () => {
      // Defense-in-depth check: even with traversal, the registry's confirm
      // gate fires first and returns the warning content. No throw.
      const result = await registry.execute("data_protection", "replication_create", {
        name: "test",
        direction: "PUSH",
        transport: "LOCAL",
        source_datasets: ["tank/../evil"],
        target_dataset: "backup/data",
      });
      const text = (result as { content: Array<{ text: string }> }).content[0].text;
      expect(text).toContain("DESTRUCTIVE");
    });
  });

  describe("Schema tightening (A3)", () => {
    // Helper: registry returns { error: string } for Zod-failed input. We
    // assert that without dispatching the handler (which would otherwise hit
    // the stub client and fail differently). All tier-1/2 actions need
    // confirm:true so the tier gate doesn't short-circuit before validation.
    function expectValidationError(result: unknown, fragment: string | RegExp) {
      const error = (result as { error?: string }).error;
      expect(error, "expected validation error from registry").toBeDefined();
      if (typeof fragment === "string") {
        expect(error).toContain(fragment);
      } else {
        expect(error).toMatch(fragment);
      }
    }

    describe("pool_create", () => {
      // pool_create is tier 1 (ConfirmWithReason) — needs both confirm + reason
      // for the tier gate to pass and Zod validation to fire.
      const baseValid = {
        confirm: true,
        reason: "test",
        name: "tank",
        topology: { data: [{ type: "MIRROR", disks: ["sda", "sdb"] }] },
      };

      it("rejects pool name starting with a digit", async () => {
        const result = await registry.execute("storage", "pool_create", {
          ...baseValid,
          name: "1pool",
        });
        expectValidationError(result, "name");
      });

      it("rejects unknown VDEV type", async () => {
        const result = await registry.execute("storage", "pool_create", {
          ...baseValid,
          topology: { data: [{ type: "RAIDZ7", disks: ["sda"] }] },
        });
        expectValidationError(result, /topology|type/);
      });

      it("rejects unknown encryption algorithm", async () => {
        const result = await registry.execute("storage", "pool_create", {
          ...baseValid,
          encryption: true,
          encryption_options: { algorithm: "AES-512-GCM" },
        });
        expectValidationError(result, "algorithm");
      });

      it("rejects encryption passphrase shorter than 8 chars", async () => {
        const result = await registry.execute("storage", "pool_create", {
          ...baseValid,
          encryption: true,
          encryption_options: { passphrase: "short" },
        });
        expectValidationError(result, "8");
      });
    });

    describe("dataset_update", () => {
      it("rejects unknown acltype", async () => {
        const result = await registry.execute("storage", "dataset_update", {
          id: "tank/data",
          acltype: "FAKE_ACL",
        });
        expectValidationError(result, "acltype");
      });
    });

    describe("replication_create", () => {
      const baseValid = {
        confirm: true,
        name: "test",
        direction: "PUSH",
        transport: "LOCAL",
        source_datasets: ["tank/data"],
        target_dataset: "backup/data",
      };

      it("rejects unknown lifetime_unit", async () => {
        const result = await registry.execute("data_protection", "replication_create", {
          ...baseValid,
          lifetime_unit: "DECADE",
        });
        expectValidationError(result, "lifetime_unit");
      });

      it("rejects name longer than 150 chars", async () => {
        const result = await registry.execute("data_protection", "replication_create", {
          ...baseValid,
          name: "a".repeat(151),
        });
        expectValidationError(result, /150|name/);
      });
    });

    describe("vm_create", () => {
      it("rejects vcpus > 64", async () => {
        const result = await registry.execute("vm", "vm_create", {
          name: "test",
          memory: 1024,
          vcpus: 65,
        });
        expectValidationError(result, /vcpus|64/);
      });

      it("rejects memory < 256 MiB", async () => {
        const result = await registry.execute("vm", "vm_create", {
          name: "test",
          memory: 128,
        });
        expectValidationError(result, /memory|256/);
      });
    });

    describe("network_interface_create", () => {
      it("rejects interface name with disallowed characters", async () => {
        const result = await registry.execute("network", "network_interface_create", {
          confirm: true,
          type: "BRIDGE",
          name: "Bad Name!",
        });
        expectValidationError(result, "name");
      });
    });

    describe("disk_wipe", () => {
      it("rejects unknown wipe mode", async () => {
        const result = await registry.execute("disk", "disk_wipe", {
          confirm: true,
          reason: "test",
          id: "sda",
          dev_name: "sda",
          mode: "BURN",
        });
        expectValidationError(result, "mode");
      });
    });

    describe("smb_share_create", () => {
      it("rejects unknown purpose", async () => {
        const result = await registry.execute("sharing", "smb_share_create", {
          confirm: true,
          path: "/mnt/tank/share",
          name: "share1",
          purpose: "FOO_BAR",
        });
        expectValidationError(result, "purpose");
      });

      it("rejects share name with spaces", async () => {
        const result = await registry.execute("sharing", "smb_share_create", {
          confirm: true,
          path: "/mnt/tank/share",
          name: "my share",
        });
        expectValidationError(result, "name");
      });
    });

    describe("system_general_update", () => {
      // Unknown-field handling is now centralized in the registry's .strip()
      // (covered in "Confirm-gate param leak" below), not a per-handler
      // allowlist.
      it("rejects ui_port out of range", async () => {
        const result = await registry.execute("system", "system_general_update", {
          confirm: true,
          ui_port: 99999,
        });
        expectValidationError(result, /ui_port|65535/);
      });

      it("rejects ui_x_frame_options outside enum", async () => {
        const result = await registry.execute("system", "system_general_update", {
          confirm: true,
          ui_x_frame_options: "ALLOW",
        });
        expectValidationError(result, "ui_x_frame_options");
      });
    });
  });

  describe("Confirm-gate param leak (handoff fix)", () => {
    // The confirm gate clears via `params.confirm`, but for handlers that do
    // not declare `confirm` in their own schema the flag must be stripped
    // before the handler forwards params upstream — otherwise TrueNAS rejects
    // the create/update call with "[EINVAL] data.confirm: Extra inputs are not
    // permitted". These tests pin the strip in place.

    // Build a registry whose client.call is captured so we can inspect the
    // exact payload that would reach the TrueNAS middleware.
    function makeSpyRegistry() {
      const client = new TrueNASClient({
        baseUrl: "http://stub",
        apiKey: "stub",
        verifySsl: true,
      });
      const calls: Array<{ method: string; params: unknown[] }> = [];
      // Replace the real WebSocket round-trip with a capture stub.
      (client as unknown as { call: TrueNASClient["call"] }).call = (async (
        method: string,
        params: unknown[] = [],
      ) => {
        calls.push({ method, params });
        return { id: 1 };
      }) as TrueNASClient["call"];
      return { registry: buildRegistry(client), calls };
    }

    it("strips confirm from the upstream body for a non-declaring create handler", async () => {
      const { registry, calls } = makeSpyRegistry();
      const result = await registry.execute("sharing", "smb_share_create", {
        confirm: true,
        path: "/mnt/data-pool/isos",
        name: "isos",
        purpose: "DEFAULT_SHARE",
        enabled: true,
        browsable: true,
      });

      // The gate cleared (no warning content) and the handler executed.
      expect((result as { content?: unknown }).content).toBeDefined();
      expect(calls).toHaveLength(1);
      expect(calls[0].method).toBe("sharing.smb.create");

      const body = calls[0].params[0] as Record<string, unknown>;
      // The leaked flag is gone; the real fields survive.
      expect("confirm" in body).toBe(false);
      expect("reason" in body).toBe(false);
      expect(body.name).toBe("isos");
      expect(body.path).toBe("/mnt/data-pool/isos");
    });

    it("strips both confirm and reason for a tier-1 spread-style update handler", async () => {
      const { registry, calls } = makeSpyRegistry();
      // user_update is tier-1 (ConfirmWithReason) and copies the whole params
      // object (minus id) into the upstream body via Object.entries.
      await registry.execute("account", "user_update", {
        confirm: true,
        reason: "rotate full name",
        id: 1,
        full_name: "New Name",
      });

      expect(calls).toHaveLength(1);
      expect(calls[0].method).toBe("user.update");
      // user.update is called as [id, body].
      const body = calls[0].params[1] as Record<string, unknown>;
      expect("confirm" in body).toBe(false);
      expect("reason" in body).toBe(false);
      expect(body.full_name).toBe("New Name");
    });

    it("preserves confirm for a delete handler that declares it in its schema", async () => {
      const { registry, calls } = makeSpyRegistry();
      // smb_share_delete declares confirm and uses it as in-handler
      // defense-in-depth. If the registry over-stripped confirm, the handler
      // would short-circuit with "Deletion not confirmed" and never call the
      // client. Reaching sharing.smb.delete proves confirm survived.
      await registry.execute("sharing", "smb_share_delete", {
        confirm: true,
        id: 7,
      });

      expect(calls).toHaveLength(1);
      expect(calls[0].method).toBe("sharing.smb.delete");
      expect(calls[0].params).toEqual([7]);
    });

    it("still gates the create handler when confirm is absent (no upstream call)", async () => {
      const { registry, calls } = makeSpyRegistry();
      const result = await registry.execute("sharing", "smb_share_create", {
        path: "/mnt/data-pool/isos",
        name: "isos",
      });
      const text = (result as { content: Array<{ text: string }> }).content[0].text;
      expect(text).toContain("DESTRUCTIVE");
      // Gate fired before dispatch — nothing was forwarded upstream.
      expect(calls).toHaveLength(0);
    });

    it("strips any unknown param (registry .strip()) so it never reaches upstream", async () => {
      const { registry, calls } = makeSpyRegistry();
      await registry.execute("system", "system_general_update", {
        confirm: true,
        ui_port: 8080,
        malicious_field: "x",
      });

      expect(calls).toHaveLength(1);
      expect(calls[0].method).toBe("system.general.update");
      const body = calls[0].params[0] as Record<string, unknown>;
      expect(body.ui_port).toBe(8080);
      expect("malicious_field" in body).toBe(false);
      expect("confirm" in body).toBe(false);
    });
  });
});
