import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TrueNASClient } from "./client.js";
import { buildRegistry } from "./tools/index.js";
import { registerResources } from "./resources.js";
import { createMcpServer, connectStdio, TRUENAS_TOOL_ANNOTATIONS } from "./mcp-adapter.js";
import { type Logger } from "./logger.js";

/**
 * Re-exported for tests and external consumers. Defined in `mcp-adapter.ts`
 * (the SDK boundary).
 */
export { TRUENAS_TOOL_ANNOTATIONS };

export interface ServerConfig {
  baseUrl: string;
  apiKey: string;
  verifySsl?: boolean;
  /** Optional structured logger threaded into the WebSocket client. */
  logger?: Logger;
  /** Keepalive ping interval in ms. 0 disables. See `TrueNASClientConfig`. */
  keepaliveIntervalMs?: number;
}

export function createServer(config: ServerConfig): McpServer {
  const client = new TrueNASClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    verifySsl: config.verifySsl,
    logger: config.logger,
    keepaliveIntervalMs: config.keepaliveIntervalMs,
  });

  return createMcpServer({
    name: "truenas-mcp",
    version: "1.1.0",
    description:
      "Comprehensive MCP server for TrueNAS SCALE — 278 tools behind a single hierarchical interface",
    registry: buildRegistry(client),
    registerResources: (server) => registerResources(server, client),
  });
}

export async function startStdio(config: ServerConfig): Promise<void> {
  await connectStdio(createServer(config));
}
