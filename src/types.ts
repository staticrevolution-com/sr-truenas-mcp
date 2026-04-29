import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrueNASClient } from "./client.js";

export type ToolRegistrar = (server: McpServer, client: TrueNASClient) => void;

/** Zod-compatible schema shorthand types used in tool definitions */
export interface PoolStatus {
  id: number;
  name: string;
  status: string;
  healthy: boolean;
  path: string;
  size: number;
  allocated: number;
  free: number;
}
