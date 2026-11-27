/**
 * MCP SDK boundary.
 *
 * This file is the **only** runtime importer of `@modelcontextprotocol/sdk`
 * symbols (`McpServer`, `StdioServerTransport`). Other modules import
 * `McpServer` strictly as a TypeScript type. The purpose is to shrink the
 * eventual SDK-2.0 migration (Phase C-1 in PLAN-bulletproofing-v1.0.1-v1.1.0.md) to a one-file change.
 *
 * Behavior here is identical to the original inline registration in
 * `src/index.ts` — pure refactor.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { ToolRegistry } from "./registry.js";

/**
 * MCP ToolAnnotations on the single `truenas` tool. Per spec these are
 * coarse-grained hints at the tool level; per-action destructiveness lives in
 * the tier system surfaced via `listActions()`. A client honouring the spec
 * should treat `destructiveHint: true` here as "this tool may modify state"
 * and check the discovery output for which specific actions are destructive.
 */
export const TRUENAS_TOOL_ANNOTATIONS = {
  title: "TrueNAS SCALE Manager",
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: true,
} as const;

const TRUENAS_TOOL_DESCRIPTION = `Manage your TrueNAS SCALE system. Safety-tiered actions organized in categories.

Usage:
  - No args or category="help" → list all categories
  - category only → list available actions in that category with parameters
  - category + action → execute (pass action-specific params in 'params')
  - detail: true + category (optionally + action) → full, untruncated parameter descriptions; executes nothing, and is REFUSED if combined with params/confirm/reason

Safety tiers: some actions require confirm: true (tier 2) or confirm + reason (tier 1). Discovery output marks destructive actions with [destructive: ...] tags.

Parameter descriptions in the default listing are capped; one ending [+] is cut short. Re-read it with detail: true before relying on it — several carry safety caveats that do not fit the cap.

Tool-level annotation: destructiveHint: true. The annotation is coarse — most actions are read-only — but at least one action in this tool can modify or destroy data. Per-action destructiveness is shown in the discovery output.

Categories: system, storage, sharing, network, account, disk, vm, app, update, certificate, alert, data_protection, filesystem, reporting, directory, service_config, audit`;

const TRUENAS_TOOL_SCHEMA = {
  category: z
    .string()
    .optional()
    .describe(
      'Category name: system, storage, sharing, network, account, disk, vm, app, update, certificate, alert, data_protection, filesystem, reporting, directory, service_config, audit',
    ),
  action: z
    .string()
    .optional()
    .describe(
      "Action name within the category (e.g. 'pool_list', 'dataset_create'). Omit to discover available actions.",
    ),
  params: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Action-specific parameters as key-value pairs. Discover required params by calling with just category.",
    ),
  reason: z
    .string()
    .optional()
    .describe(
      "Required for tier 1 (high-risk) actions. Explains why the operation is being performed.",
    ),
  detail: z
    .boolean()
    .optional()
    .describe(
      "Discovery only: return full, untruncated parameter descriptions instead of the capped listing. Executes nothing — and combining it with params, confirm or reason is REFUSED rather than quietly treated as either one. Use it whenever a description you are about to rely on ends [+], then call again without detail to execute.",
    ),
  confirm: z
    .boolean()
    .optional()
    .describe(
      "Required for destructive actions: set true to approve execution (tier 2), or true alongside 'reason' (tier 1). May also be supplied inside 'params'; this top-level field is the preferred channel.",
    ),
};

export interface McpServerInit {
  /** Server name. Surfaces in MCP `initialize` response. */
  name: string;
  /** Server version. Should match `package.json`. */
  version: string;
  /** Free-text description. */
  description: string;
  /** The tool registry the single `truenas` tool dispatches into. */
  registry: ToolRegistry;
  /**
   * Callback that registers MCP Resources on the server. Decoupled so this
   * adapter doesn't need to know about `TrueNASClient` or any project-side
   * resource shape.
   */
  registerResources: (server: McpServer) => void;
}

/** Arguments the single `truenas` tool accepts, as the schema above declares them. */
export interface TrueNASToolArgs {
  category?: string;
  action?: string;
  params?: Record<string, unknown>;
  reason?: string;
  confirm?: boolean;
  detail?: boolean;
}

export interface McpToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  /**
   * The SDK's tool-result type carries an index signature, so this must too
   * for `dispatch` to satisfy the callback signature. It is not a licence to
   * put anything here — the two declared fields are what this server returns.
   */
  [key: string]: unknown;
}

function textResult(text: string, isError?: boolean): McpToolResult {
  return isError
    ? { content: [{ type: "text" as const, text }], isError: true }
    : { content: [{ type: "text" as const, text }] };
}

/**
 * The tool's whole behaviour, extracted from the SDK registration so it can
 * be driven directly by tests. `createMcpServer` registers this and nothing
 * else, so a gate on this function is a gate on the live dispatch path —
 * reaching into the SDK's private `_registeredTools` to get at the callback
 * would have made the gate depend on SDK internals instead.
 */
export async function dispatch(
  registry: ToolRegistry,
  args: TrueNASToolArgs,
): Promise<McpToolResult> {
  const { category, action, params, reason, confirm, detail } = args;

  // ── The detail/execute gate ───────────────────────────────────────────────
  //
  // Checked FIRST, before any execute path, so a request carrying
  // `detail: true` cannot dispatch a handler under any circumstance.
  //
  // ⚠ A call that asks for detail AND carries execution intent is REFUSED,
  // not silently reinterpreted. An earlier revision returned the description
  // instead, which is fail-safe in that nothing runs — but it reports a
  // description as though it were the outcome of the action, so a caller that
  // meant to execute reads success and never learns the action did not run.
  // Refusing is the only answer that cannot be misread.
  //
  // The discriminator is execution intent, not the mere presence of `action`:
  // `detail: true` with a bare `action` is the documented way to describe one
  // action, so it must keep working. `params`, `confirm` and `reason` are the
  // three fields that exist only to execute something.
  if (detail === true) {
    const intent: string[] = [];
    if (params && Object.keys(params).length > 0) intent.push("params");
    if (confirm !== undefined) intent.push("confirm");
    if (reason !== undefined) intent.push("reason");

    if (intent.length > 0) {
      return textResult(
        [
          `REFUSED: detail cannot be combined with execution.`,
          ``,
          `This call set detail: true and also carried ${intent.join(", ")}, which only an execution uses.`,
          `Nothing was executed, and this is NOT a description of ${action ? `"${action}"` : "an action"}.`,
          ``,
          `To run it, call again WITHOUT detail.`,
          `To read its full parameter descriptions first, call again with detail: true and no ${intent.join("/")}.`,
        ].join("\n"),
        true,
      );
    }

    if (category && category !== "help") {
      return textResult(registry.describeActions(category, action));
    }
  }

  // Mode 1: List categories
  if (!category || category === "help") {
    return textResult(registry.listCategories());
  }

  // Mode 2: List actions in category
  if (!action) {
    return textResult(registry.listActions(category));
  }

  // Mode 3: Execute action
  try {
    const actionParams = { ...(params || {}) };
    if (reason) actionParams.reason = reason;
    // Top-level `confirm` is the preferred channel and overrides any value
    // nested in `params`. The registry's gate reads `actionParams.confirm`;
    // it then strips the flag before dispatch for handlers that don't
    // declare it, so it never leaks into the upstream payload.
    if (confirm !== undefined) actionParams.confirm = confirm;
    const result = await registry.execute(category, action, actionParams);

    // If the handler returned an MCP-shaped response, pass it through
    if (result && typeof result === "object" && "content" in (result as Record<string, unknown>)) {
      return result as McpToolResult;
    }

    return textResult(typeof result === "string" ? result : JSON.stringify(result, null, 2));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return textResult(`Error: ${message}`, true);
  }
}

/**
 * Build an `McpServer` with the single hierarchical `truenas` tool and the
 * caller's resources registered. Returns the server unconnected — call
 * `connectStdio()` to attach a transport.
 */
export function createMcpServer(init: McpServerInit): McpServer {
  const server = new McpServer({
    name: init.name,
    version: init.version,
    description: init.description,
  });

  server.tool(
    "truenas",
    TRUENAS_TOOL_DESCRIPTION,
    TRUENAS_TOOL_SCHEMA,
    TRUENAS_TOOL_ANNOTATIONS,
    async (args) => dispatch(init.registry, args as TrueNASToolArgs),
  );

  init.registerResources(server);

  return server;
}

/**
 * Attach a stdio transport and start serving. Returns once the transport is
 * connected (the SDK keeps it open until the process exits or the parent
 * closes stdin).
 */
export async function connectStdio(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
