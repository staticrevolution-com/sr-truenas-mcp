import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { TrueNASClient } from "./client.js";
import { buildRegistry } from "./tools/index.js";
import { registerResources } from "./resources.js";

import { type Logger } from "./logger.js";

export interface ServerConfig {
  baseUrl: string;
  apiKey: string;
  verifySsl?: boolean;
  /** Optional structured logger threaded into the WebSocket client. */
  logger?: Logger;
}

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

export function createServer(config: ServerConfig): McpServer {
  const client = new TrueNASClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    verifySsl: config.verifySsl,
    logger: config.logger,
  });

  const server = new McpServer({
    name: "truenas-mcp",
    version: "1.0.0",
    description:
      "Comprehensive MCP server for TrueNAS SCALE — 278 tools behind a single hierarchical interface",
  });

  // Build the tool registry from all modules
  const registry = buildRegistry(client);

  // Register ONE tool with hierarchical discovery
  server.tool(
    "truenas",
    `Manage your TrueNAS SCALE system. Safety-tiered actions organized in categories.

Usage:
  - No args or category="help" → list all categories
  - category only → list available actions in that category with parameters
  - category + action → execute (pass action-specific params in 'params')

Safety tiers: some actions require confirm: true (tier 2) or confirm + reason (tier 1). Discovery output marks destructive actions with [destructive: ...] tags.

Tool-level annotation: destructiveHint: true. The annotation is coarse — most actions are read-only — but at least one action in this tool can modify or destroy data. Per-action destructiveness is shown in the discovery output.

Categories: system, storage, sharing, network, account, disk, vm, app, update, certificate, alert, data_protection, filesystem, reporting, directory, service_config, audit`,
    {
      category: z
        .string()
        .optional()
        .describe(
          'Category name: system, storage, sharing, network, account, disk, vm, app, update, certificate, alert, data_protection, filesystem, reporting, directory, service_config, audit'
        ),
      action: z
        .string()
        .optional()
        .describe(
          "Action name within the category (e.g. 'pool_list', 'dataset_create'). Omit to discover available actions."
        ),
      params: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "Action-specific parameters as key-value pairs. Discover required params by calling with just category."
        ),
      reason: z
        .string()
        .optional()
        .describe(
          "Required for tier 1 (high-risk) actions. Explains why the operation is being performed."
        ),
    },
    TRUENAS_TOOL_ANNOTATIONS,
    async ({ category, action, params, reason }) => {
      // Mode 1: List categories
      if (!category || category === "help") {
        return {
          content: [{ type: "text" as const, text: registry.listCategories() }],
        };
      }

      // Mode 2: List actions in category
      if (!action) {
        return {
          content: [{ type: "text" as const, text: registry.listActions(category) }],
        };
      }

      // Mode 3: Execute action
      try {
        const actionParams = { ...(params || {}) };
        if (reason) actionParams.reason = reason;
        const result = await registry.execute(category, action, actionParams);

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
    }
  );

  registerResources(server, client);

  return server;
}

export async function startStdio(config: ServerConfig): Promise<void> {
  const server = createServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
