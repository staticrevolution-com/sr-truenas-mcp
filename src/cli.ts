#!/usr/bin/env node

import { startStdio } from "./index.js";
import { BUILD_VERSION } from "./version.js";
import { TrueNASClient } from "./client.js";
import { preflight, formatPreflightFailure } from "./preflight.js";
import { createLogger } from "./logger.js";

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
      "  TRUENAS_URL          TrueNAS base URL (e.g. wss://truenas.local:444)\n" +
      "  TRUENAS_API_KEY      API key from TrueNAS UI (Credentials -> API Keys)\n" +
      "\n" +
      "Optional environment:\n" +
      "  TRUENAS_VERIFY_SSL       set 'false' to skip TLS verification (warns on stderr)\n" +
      "  TRUENAS_SKIP_PREFLIGHT   set '1' to bypass the startup health check\n" +
      "  TRUENAS_LOG_LEVEL        error|warn|info|debug — structured stderr logs (default: error)\n" +
      "  TRUENAS_KEEPALIVE_INTERVAL_MS  ms between idle system.info pings (default: 0 = disabled)\n" +
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

async function main(): Promise<void> {
  const logger = createLogger();

  // Optional keepalive — env-driven. Default disabled (0).
  const rawKeepalive = process.env.TRUENAS_KEEPALIVE_INTERVAL_MS;
  const keepaliveIntervalMs = rawKeepalive ? Math.max(0, parseInt(rawKeepalive, 10) || 0) : 0;

  // Pre-flight health check — verifies WS connect + auth + a trivial read
  // before MCP capabilities are announced. Bypassable for environments where
  // TrueNAS may legitimately be unreachable at startup.
  if (process.env.TRUENAS_SKIP_PREFLIGHT !== "1") {
    const probe = new TrueNASClient({ baseUrl: baseUrl!, apiKey: apiKey!, verifySsl, logger });
    const result = await preflight(probe, 5_000);
    probe.close();
    if (!result.ok) {
      console.error(formatPreflightFailure(result, baseUrl!));
      process.exit(1);
    }
    logger.info("preflight ok", { durMs: result.durationMs });
  }

  await startStdio({ baseUrl: baseUrl!, apiKey: apiKey!, verifySsl, logger, keepaliveIntervalMs });
}

main().catch((err) => {
  console.error("Failed to start TrueNAS MCP server:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
