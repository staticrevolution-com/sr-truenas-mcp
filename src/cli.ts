#!/usr/bin/env node

import { startStdio } from "./index.js";
import { BUILD_VERSION } from "./version.js";

// Early exits — must run before env-var validation so they work without
// TRUENAS_URL/TRUENAS_API_KEY set.
const args = process.argv.slice(2);
if (args.includes("--version") || args.includes("-v")) {
  console.log(BUILD_VERSION);
  process.exit(0);
}
if (args.includes("--help") || args.includes("-h")) {
  console.log(
    `sr-truenas-mcp ${BUILD_VERSION}\n` +
      "\n" +
      "Hardened MCP server for TrueNAS SCALE. Reads its TrueNAS endpoint\n" +
      "from environment variables and speaks MCP over stdio.\n" +
      "\n" +
      "Required environment:\n" +
      "  TRUENAS_URL          TrueNAS base URL (e.g. wss://192.168.1.235:444)\n" +
      "  TRUENAS_API_KEY      API key from TrueNAS UI (Credentials -> API Keys)\n" +
      "\n" +
      "Optional environment:\n" +
      "  TRUENAS_VERIFY_SSL   set 'false' to skip TLS verification (warns on stderr)\n" +
      "\n" +
      "Flags:\n" +
      "  -v, --version        print version and exit\n" +
      "  -h, --help           print this help and exit\n",
  );
  process.exit(0);
}

const baseUrl = process.env.TRUENAS_URL || process.env.TRUENAS_HOST;
const apiKey = process.env.TRUENAS_API_KEY;

if (!baseUrl) {
  console.error(
    "Error: TRUENAS_URL environment variable is required.\n" +
      "Set it to your TrueNAS instance URL, e.g.:\n" +
      "  export TRUENAS_URL=https://truenas.local\n" +
      "  export TRUENAS_API_KEY=1-abc123...\n"
  );
  process.exit(1);
}

if (!apiKey || !apiKey.trim()) {
  console.error(
    "Error: TRUENAS_API_KEY environment variable is required.\n" +
      "Generate an API key in TrueNAS UI: Credentials → API Keys → Add\n"
  );
  process.exit(1);
}

const verifySsl = process.env.TRUENAS_VERIFY_SSL !== "false";

// Security warnings
if (!verifySsl) {
  console.error("Warning: TLS certificate verification is disabled (TRUENAS_VERIFY_SSL=false)");
}
if (baseUrl.startsWith("http://") || baseUrl.startsWith("ws://")) {
  console.error("Warning: Connecting over plaintext (no TLS). API key will be transmitted unencrypted.");
}

startStdio({ baseUrl, apiKey, verifySsl }).catch((err) => {
  console.error("Failed to start TrueNAS MCP server:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
