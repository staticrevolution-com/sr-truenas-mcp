import { describe, it, expect } from "vitest";
import { ACTION_TIERS, SafetyTier, BLOCKED_ACTIONS } from "../safety.js";
import { TrueNASClient } from "../client.js";
import { buildRegistry } from "../tools/index.js";

/**
 * Build a real registry with a stub client to get all registered action names.
 * Tier 0 actions are blocked at registration — they won't appear here.
 */
function getRegisteredActions(): Set<string> {
  const client = new TrueNASClient({
    baseUrl: "http://stub",
    apiKey: "stub",
    verifySsl: true,
  });
  const registry = buildRegistry(client);
  return new Set(registry.tools.keys());
}

describe("Safety tier map", () => {
  const registeredActions = getRegisteredActions();
  const tieredActions = new Set(Object.keys(ACTION_TIERS));

  it("has a tier assignment for every registered action", () => {
    const missing: string[] = [];
    for (const action of registeredActions) {
      if (!tieredActions.has(action)) {
        missing.push(action);
      }
    }
    expect(missing, `Actions without tier assignment: ${missing.join(", ")}`).toEqual([]);
  });

  it("non-blocked tier entries match registered actions", () => {
    const orphans: string[] = [];
    for (const [action, tier] of Object.entries(ACTION_TIERS)) {
      if (tier === SafetyTier.Blocked) continue; // blocked actions aren't registered
      if (!registeredActions.has(action)) {
        orphans.push(action);
      }
    }
    expect(orphans, `Non-blocked tier entries not found in registry: ${orphans.join(", ")}`).toEqual([]);
  });

  it("blocked actions are NOT registered", () => {
    for (const action of BLOCKED_ACTIONS) {
      expect(registeredActions.has(action), `Blocked action "${action}" should not be registered`).toBe(false);
    }
  });

  it("has exactly 8 blocked actions (tier 0)", () => {
    const blocked = Object.entries(ACTION_TIERS)
      .filter(([, tier]) => tier === SafetyTier.Blocked)
      .map(([name]) => name)
      .sort();

    expect(blocked).toEqual([
      "cronjob_create",
      "cronjob_update",
      "initshutdown_create",
      "initshutdown_update",
      "system_config_upload",
      "system_reboot",
      "system_shutdown",
      "truenas_api_call",
    ]);
  });

  it("BLOCKED_ACTIONS set matches tier 0 entries", () => {
    const tier0 = new Set(
      Object.entries(ACTION_TIERS)
        .filter(([, tier]) => tier === SafetyTier.Blocked)
        .map(([name]) => name)
    );
    expect(BLOCKED_ACTIONS).toEqual(tier0);
  });

  it("has 20 tier 1 (confirm + reason) actions", () => {
    const tier1 = Object.entries(ACTION_TIERS)
      .filter(([, tier]) => tier === SafetyTier.ConfirmWithReason);
    expect(tier1.length).toBe(20);
  });

  it("tier 1 contains the expected high-risk actions", () => {
    const tier1 = new Set(
      Object.entries(ACTION_TIERS)
        .filter(([, tier]) => tier === SafetyTier.ConfirmWithReason)
        .map(([name]) => name)
    );

    const expected = [
      "pool_create", "pool_export", "pool_replace_disk",
      "disk_wipe", "dataset_delete", "snapshot_rollback",
      "update_apply", "bootenv_activate", "bootenv_delete",
      "boot_attach_disk", "boot_detach_disk",
      "directory_services_leave", "system_config_download",
      "network_commit_changes",
    ];

    for (const action of expected) {
      expect(tier1.has(action), `Expected ${action} in tier 1`).toBe(true);
    }
  });

  it("tier 2 count is in expected range (60-110)", () => {
    // Loose sanity guard; the exact count is enforced against CLAUDE.md by the
    // doc-sync drift gate.
    const tier2 = Object.entries(ACTION_TIERS)
      .filter(([, tier]) => tier === SafetyTier.Confirm);
    expect(tier2.length).toBeGreaterThanOrEqual(60);
    expect(tier2.length).toBeLessThanOrEqual(110);
  });

  it("tier map has 278 total entries (all actions classified)", () => {
    expect(tieredActions.size).toBe(278);
  });

  it("registered actions = 278 - 8 blocked = 270", () => {
    expect(registeredActions.size).toBe(270);
  });

  it("every tier value is a valid SafetyTier", () => {
    const validTiers = new Set([
      SafetyTier.Blocked,
      SafetyTier.ConfirmWithReason,
      SafetyTier.Confirm,
      SafetyTier.Open,
    ]);
    for (const [action, tier] of Object.entries(ACTION_TIERS)) {
      expect(validTiers.has(tier), `Invalid tier ${tier} for action ${action}`).toBe(true);
    }
  });
});
