/**
 * MCP SDK boundary.
 *
 * This file is the **only** runtime importer of `@modelcontextprotocol/sdk`
 * symbols (`McpServer`, `StdioServerTransport`). Other modules import
 * `McpServer` strictly as a TypeScript type. The purpose is to shrink the
 * eventual SDK-2.0 migration (Phase C-1 in PLAN.md) to a one-file change.
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

Safety tiers: some actions require confirm: true (tier 2) or confirm + reason (tier 1). Discovery output marks destructive actions with [destructive: ...] tags.

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
    async ({ category, action, params, reason }) => {
      // Mode 1: List categories
      if (!category || category === "help") {
        return {
          content: [{ type: "text" as const, text: init.registry.listCategories() }],
        };
      }

      // Mode 2: List actions in category
      if (!action) {
        return {
          content: [{ type: "text" as const, text: init.registry.listActions(category) }],
        };
      }

      // Mode 3: Execute action
      try {
        const actionParams = { ...(params || {}) };
        if (reason) actionParams.reason = reason;
        const result = await init.registry.execute(category, action, actionParams);

        // If the handler returned an MCP-shaped response, pass it through
        if (
          result &&
          typeof result === "object" &&
          "content" in (result as Record<string, unknown>)
        ) {
          return result as { content: Array<{ type: "text"; text: string }> };
        }

        // Otherwise wrap the result
        return {
          content: [
            {
              type: "text" as const,
              text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
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
