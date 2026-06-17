/**
 * Tool Registry — captures tool definitions from modules and organizes them
 * into categories for hierarchical discovery via a single MCP tool.
 *
 * Safety enforcement is centralized here:
 * - Tier 0 actions are silently dropped at registration time
 * - Tier 1/2 confirm gates are checked before handler dispatch
 * - Runtime Zod validation wraps every handler
 */

import { z } from "zod";
import { ACTION_TIERS, SafetyTier, BLOCKED_ACTIONS, getActionTier } from "./safety.js";
import { filterSensitiveFields } from "./filters.js";

export interface CapturedTool {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  handler: (params: Record<string, unknown>) => Promise<unknown>;
  category: string;
  tier: SafetyTier;
}

export interface ParamInfo {
  name: string;
  required: boolean;
  description: string;
}

const CATEGORIES: Record<string, string> = {
  system: "System info, configuration, services, mail, API keys, and NTP",
  storage: "Storage pools, datasets, snapshots, and periodic snapshot tasks",
  sharing: "File sharing — SMB/CIFS, NFS exports, and iSCSI (targets, extents, portals, initiators)",
  network: "Network interfaces, global config, static routes, IPMI, and staged change management",
  account: "User accounts, groups, and privilege/role management",
  disk: "Physical disks, SMART tests, and temperature monitoring",
  vm: "Virtual machines and VM devices (disk, NIC, display, PCI, etc.)",
  app: "Applications (Docker containers) and container runtime configuration",
  update: "System updates, boot environments, and boot pool management",
  certificate: "TLS certificates, ACME/Let's Encrypt, and DNS authenticators",
  alert: "System alerts and alert notification services (Slack, email, PagerDuty, etc.)",
  data_protection: "Replication, cloud sync, cloud backup, cron jobs, rsync, init/shutdown scripts, and SSH credentials",
  filesystem: "Filesystem operations — stat, listdir, mkdir, permissions, ACLs, and ownership",
  reporting: "System metrics — reporting config, available graphs, and time-series data",
  directory: "Directory services (Active Directory, LDAP) and Kerberos",
  service_config: "Service-specific configs — SSH, FTP, SNMP, UPS, and system tunables",
  audit: "Audit logs, audit configuration, and system security",
};

export class ToolRegistry {
  tools = new Map<string, CapturedTool>();

  /** Called by existing register() functions in place of McpServer.tool() */
  tool(
    name: string,
    description: string,
    schema: Record<string, unknown>,
    handler: (params: Record<string, unknown>) => Promise<unknown>
  ): void {
    // Tier 0: silently drop blocked actions — they are never registered
    if (BLOCKED_ACTIONS.has(name)) return;

    // Fail-closed: refuse to register unclassified actions
    const tier = getActionTier(name);
    if (tier === undefined) return;

    const category = categorize(name);
    this.tools.set(name, { name, description, schema, handler, category, tier });
  }

  /** List all categories with descriptions and tool counts */
  listCategories(): string {
    const counts = new Map<string, number>();
    for (const tool of this.tools.values()) {
      counts.set(tool.category, (counts.get(tool.category) || 0) + 1);
    }

    const lines: string[] = [
      `TrueNAS MCP — ${this.tools.size} tools across ${counts.size} categories\n`,
      "Call with a category to see available actions, or with category + action + params to execute.",
      "Not sure what release the target system runs? system_version (category system) reports it — API behavior differs across TrueNAS major versions.\n",
      "Categories:",
    ];

    for (const [cat, desc] of Object.entries(CATEGORIES)) {
      const count = counts.get(cat);
      if (count) {
        lines.push(`  ${cat} (${count} actions) — ${desc}`);
      }
    }

    return lines.join("\n");
  }

  /** List all actions in a category with their params */
  listActions(category: string): string {
    const catDesc = CATEGORIES[category];
    if (!catDesc) {
      const available = Object.keys(CATEGORIES).join(", ");
      return `Unknown category "${category}". Available categories: ${available}`;
    }

    const actions = [...this.tools.values()].filter((t) => t.category === category);
    if (actions.length === 0) {
      return `No actions found in category "${category}".`;
    }

    const lines: string[] = [
      `Category: ${category} — ${catDesc}\n`,
      `${actions.length} available actions:\n`,
    ];

    for (const action of actions) {
      // Tier tag now makes the destructive marker explicit — mirrors the
      // tool-level destructiveHint annotation. Tier 3 (no tag) is implicitly
      // non-destructive.
      const tierTag =
        action.tier === SafetyTier.ConfirmWithReason ? " [destructive: requires confirm + reason]" :
        action.tier === SafetyTier.Confirm ? " [destructive: requires confirm]" : "";
      lines.push(`  ${action.name}${tierTag} — ${action.description}`);
      const params = extractParams(action.schema);
      if (params.length > 0) {
        const required = params.filter((p) => p.required);
        const optional = params.filter((p) => !p.required);
        if (required.length > 0) {
          lines.push(
            `    Required: ${required.map((p) => `${p.name}${p.description ? ` (${p.description})` : ""}`).join(", ")}`
          );
        }
        if (optional.length > 0) {
          lines.push(
            `    Optional: ${optional.map((p) => `${p.name}${p.description ? ` (${p.description})` : ""}`).join(", ")}`
          );
        }
      }
    }

    return lines.join("\n");
  }

  /** Execute an action with safety tier enforcement and parameter validation */
  async execute(
    category: string,
    action: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    const tool = this.tools.get(action);
    if (!tool) {
      // Unknown category first — otherwise the "Available:" list below is
      // built from a category filter that matches nothing and renders empty.
      if (!CATEGORIES[category]) {
        const available = Object.keys(CATEGORIES).join(", ");
        return {
          error: `Unknown category "${category}". Available categories: ${available}`,
        };
      }
      const catTools = [...this.tools.values()].filter((t) => t.category === category);
      if (catTools.length === 0) {
        return {
          error: `Unknown action "${action}". Category "${category}" has no registered actions — call with just the category to discover others.`,
        };
      }
      const names = catTools.map((t) => t.name).join(", ");
      return {
        error: `Unknown action "${action}" in category "${category}". Available: ${names}`,
      };
    }
    if (tool.category !== category) {
      return {
        error: `Action "${action}" belongs to category "${tool.category}", not "${category}". Use category "${tool.category}" instead.`,
      };
    }

    // Safety tier enforcement — return detailed warnings for unconfirmed destructive actions
    if (tool.tier === SafetyTier.ConfirmWithReason) {
      if (params.confirm !== true) {
        const paramSummary = Object.entries(params)
          .filter(([k]) => k !== "confirm" && k !== "reason")
          .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
          .join("\n");
        return {
          content: [{
            type: "text",
            text: `⚠ HIGH-RISK OPERATION: ${action}\n\n` +
              `${tool.description}\n\n` +
              `Parameters:\n${paramSummary || "  (none)"}\n\n` +
              `This is a tier 1 action — it may be irreversible or have high blast radius.\n` +
              `To proceed, the user must explicitly approve. Then call again with:\n` +
              `  confirm: true\n` +
              `  reason: "explanation of why this operation is needed"`,
          }],
        };
      }
      if (typeof params.reason !== "string" || params.reason.trim().length === 0) {
        return {
          content: [{
            type: "text",
            text: `⚠ REASON REQUIRED: ${action}\n\n` +
              `This tier 1 action requires a reason explaining why it is being performed.\n` +
              `Call again with reason: "your explanation"`,
          }],
        };
      }
    } else if (tool.tier === SafetyTier.Confirm) {
      if (params.confirm !== true) {
        const paramSummary = Object.entries(params)
          .filter(([k]) => k !== "confirm")
          .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
          .join("\n");
        return {
          content: [{
            type: "text",
            text: `⚠ DESTRUCTIVE OPERATION: ${action}\n\n` +
              `${tool.description}\n\n` +
              `Parameters:\n${paramSummary || "  (none)"}\n\n` +
              `This action modifies system state and may not be easily reversible.\n` +
              `To proceed, the user must explicitly approve. Then call again with:\n` +
              `  confirm: true`,
          }],
        };
      }
    }

    // Strip safety-control fields before dispatching to the handler.
    //
    // `reason` is always stripped — it is tier-1 gate metadata and no upstream
    // TrueNAS method accepts it.
    //
    // `confirm` is stripped UNLESS the handler declares it in its own schema.
    // Two handler shapes coexist:
    //   - delete/teardown handlers declare `confirm` as a required schema field
    //     and consume it as in-handler defense-in-depth — they must keep
    //     receiving it (and Zod would reject the call without it).
    //   - create/update/config handlers do NOT declare `confirm`; for them it
    //     is wrapper-only gate metadata. These handlers forward the whole
    //     params object to the upstream call, whose pydantic model forbids
    //     extra keys — a leaked `confirm` fails with
    //     "[EINVAL] data.confirm: Extra inputs are not permitted", making the
    //     gate unsatisfiable. Strip it so the create/update family stays usable.
    const declaresConfirm = Object.prototype.hasOwnProperty.call(tool.schema, "confirm");
    const { reason: _r, ...rest } = params;
    let handlerParams: Record<string, unknown> = rest;
    if (!declaresConfirm) {
      const { confirm: _c, ...withoutConfirm } = rest;
      handlerParams = withoutConfirm;
    }

    // Runtime Zod validation
    if (Object.keys(tool.schema).length > 0) {
      const zodShape = tool.schema as z.ZodRawShape;
      const result = z.object(zodShape).passthrough().safeParse(handlerParams);
      if (!result.success) {
        const issues = result.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        return { error: `Validation failed for "${action}": ${issues}` };
      }
      const handlerResult = await tool.handler(result.data as Record<string, unknown>);
      return filterSensitiveFields(handlerResult);
    }

    const handlerResult = await tool.handler(handlerParams);
    return filterSensitiveFields(handlerResult);
  }
}

function categorize(name: string): string {
  // System & Services
  if (
    name.startsWith("system_") ||
    name.startsWith("service_") ||
    name.startsWith("mail_") ||
    name.startsWith("api_key_")
  )
    return "system";

  // Storage
  if (
    name.startsWith("pool_") ||
    name.startsWith("dataset_") ||
    name.startsWith("snapshot_")
  )
    return "storage";

  // Sharing
  if (
    name.startsWith("smb_") ||
    name.startsWith("nfs_") ||
    name.startsWith("iscsi_")
  )
    return "sharing";

  // Network
  if (name.startsWith("network_")) return "network";

  // Account
  if (
    name.startsWith("user_") ||
    name.startsWith("group_") ||
    name.startsWith("privilege_")
  )
    return "account";

  // Disk
  if (name.startsWith("disk_")) return "disk";

  // VM
  if (name.startsWith("vm_")) return "vm";

  // Apps
  if (name.startsWith("app_") || name.startsWith("docker_")) return "app";

  // Update & Boot
  if (
    name.startsWith("update_") ||
    name.startsWith("bootenv_") ||
    name.startsWith("boot_")
  )
    return "update";

  // Certificates
  if (name.startsWith("certificate_") || name.startsWith("acme_"))
    return "certificate";

  // Alerts
  if (name.startsWith("alert")) return "alert";

  // Data Protection
  if (
    name.startsWith("replication_") ||
    name.startsWith("cloudsync_") ||
    name.startsWith("cloud_backup_") ||
    name.startsWith("cronjob_") ||
    name.startsWith("rsync_task_") ||
    name.startsWith("initshutdown_") ||
    name.startsWith("keychaincredential_")
  )
    return "data_protection";

  // Filesystem
  if (name.startsWith("filesystem_")) return "filesystem";

  // Reporting
  if (name.startsWith("reporting_")) return "reporting";

  // Directory Services
  if (name.startsWith("directory_") || name.startsWith("kerberos_"))
    return "directory";

  // Service Configs
  if (
    name.startsWith("ssh_config") ||
    name.startsWith("ftp_config") ||
    name.startsWith("snmp_config") ||
    name.startsWith("ups_config") ||
    name.startsWith("tunable_")
  )
    return "service_config";

  // Audit
  if (name.startsWith("audit_")) return "audit";

  return "system";
}

function extractParams(schema: Record<string, unknown>): ParamInfo[] {
  const params: ParamInfo[] = [];
  for (const [name, field] of Object.entries(schema)) {
    if (!field || typeof field !== "object") continue;
    const f = field as Record<string, unknown>;

    let description = "";
    let required = true;

    // Zod 4: description is a property
    if (typeof f.description === "string") {
      description = f.description;
    }
    // Check nested _zod or _def for description
    if (!description) {
      const def = (f as any)?._zod?.def || (f as any)?._def;
      if (def?.description) description = def.description;
    }

    // Check if optional — Zod 4 optional types
    try {
      if (typeof (f as any).isOptional === "function" && (f as any).isOptional()) {
        required = false;
      }
    } catch {
      // fallback: check type name
      const typeName = (f as any)?._zod?.def?.typeName || (f as any)?._def?.typeName;
      if (typeName === "ZodOptional" || typeName === "optional") {
        required = false;
      }
    }

    // Truncate long descriptions for listing
    if (description.length > 100) {
      description = description.slice(0, 97) + "...";
    }

    params.push({ name, required, description });
  }
  return params;
}
