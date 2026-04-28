/**
 * Pre-flight health check (B5).
 *
 * Runs once at MCP-server startup before announcing capabilities, so a
 * misconfigured deployment fails loudly at agent-spawn time rather than at
 * first tool call. Verifies: (1) WebSocket can connect, (2) DDP handshake +
 * api-key auth succeed, (3) a trivial read-only call returns. Disable via
 * `TRUENAS_SKIP_PREFLIGHT=1` for environments where TrueNAS may legitimately
 * be unreachable at MCP startup (offline dev, intermittent VPN, etc).
 */

export interface PreflightClient {
  connect(): Promise<void>;
  call(method: string, params?: unknown[], timeoutMs?: number): Promise<unknown>;
  close?(): void;
}

export interface PreflightResult {
  ok: boolean;
  error?: string;
  durationMs: number;
}

export async function preflight(
  client: PreflightClient,
  timeoutMs = 5_000,
): Promise<PreflightResult> {
  const start = Date.now();
  try {
    // Race the work against a hard timeout so a hung connect() can't stall
    // startup forever — TrueNAS unreachable is the most common failure shape.
    await Promise.race([
      (async () => {
        await client.connect();
        await client.call("system.info", [], timeoutMs);
      })(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`pre-flight timed out after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
    return { ok: true, durationMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Format a preflight failure into a human-readable diagnostic for stderr.
 * Pulled out so it can be unit-tested independently of the runtime path.
 */
export function formatPreflightFailure(
  result: PreflightResult,
  baseUrl: string,
): string {
  return (
    `Pre-flight check failed (${result.durationMs}ms): ${result.error}\n` +
    `\n` +
    `Possible causes:\n` +
    `  - TRUENAS_URL is unreachable: ${baseUrl}\n` +
    `  - TRUENAS_API_KEY is invalid or revoked\n` +
    `  - TLS verification is failing (set TRUENAS_VERIFY_SSL=false to skip)\n` +
    `  - Network path between agent and TrueNAS is blocked\n` +
    `\n` +
    `Set TRUENAS_SKIP_PREFLIGHT=1 to bypass this check at startup.\n`
  );
}
