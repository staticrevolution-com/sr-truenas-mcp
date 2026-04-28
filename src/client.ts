/**
 * TrueNAS WebSocket JSON-RPC 2.0 Client (DDP protocol)
 *
 * Replaces the REST API v2.0 client. Uses the same DDP (Distributed Data Protocol)
 * format as the upstream Go reference implementation.
 *
 * Protocol: wss://{host}/websocket
 * Handshake: {"msg":"connect","version":"1","support":["1"]} → {"msg":"connected","session":"..."}
 * Auth: auth.login_with_api_key
 * Calls: {"id":"N","msg":"method","method":"...","params":[...]} → {"id":"N","msg":"result","result":...}
 */

import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { type Logger, noopLogger } from "./logger.js";

export interface TrueNASClientConfig {
  baseUrl: string;
  apiKey: string;
  verifySsl?: boolean;
  /** Optional structured logger — defaults to a no-op. */
  logger?: Logger;
  /**
   * Periodic `system.info` ping interval, in milliseconds. Default `0`
   * (disabled). Useful only for persistent-mode deploys where the same
   * WebSocket is held open across long idle gaps; AgentGateway's stateless
   * mode tears down sessions per request, so this is dead weight there.
   * Can be set via `TRUENAS_KEEPALIVE_INTERVAL_MS`.
   */
  keepaliveIntervalMs?: number;
}

export interface JobResult {
  id: number;
  method: string;
  state: string;
  progress: { percent: number; description: string };
  result: unknown;
  error: string | null;
  time_started: { $date: number } | null;
  time_finished: { $date: number } | null;
}

interface DDPRequest {
  id: string;
  msg: "method";
  method: string;
  params: unknown[];
}

interface DDPResponse {
  id: string;
  msg: "result" | "failed";
  result?: unknown;
  error?: { code?: number; message?: string; trace?: string };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  settled: boolean;
  method: string;
  idempotent: boolean;
}

/**
 * Thrown when a request fails to be written to the WebSocket — either
 * because `ws.send` invoked its callback with an error, or threw
 * synchronously. Distinct from API-level errors so callers can
 * distinguish "never reached the server" from "server rejected".
 */
export class WebSocketSendError extends Error {
  constructor(message: string) {
    super(`Failed to send request: ${message}`);
    this.name = "WebSocketSendError";
  }
}

/**
 * Thrown when a non-idempotent request was in flight (or about to retry)
 * across a connection drop. The server may or may not have processed
 * the original send, so retrying could double-create / double-mutate.
 * Callers must decide whether to manually retry.
 */
export class ReconnectAborted extends Error {
  constructor(method: string) {
    super(`Connection lost during non-idempotent call '${method}'; not retrying to avoid duplicate side effects`);
    this.name = "ReconnectAborted";
  }
}

/**
 * Method names that are safe to retry across a transparent reconnect.
 * Read-only queries and the job-poll endpoint. Anything else is treated
 * as potentially-side-effectful and surfaces ReconnectAborted instead.
 */
const IDEMPOTENT_METHOD_RE = /(\.query|\.get_instance|\.config)$|^core\.get_jobs$/;

function inferIdempotent(method: string): boolean {
  return IDEMPOTENT_METHOD_RE.test(method);
}

/** Initial delay between job-poll attempts. Exported for tests. */
export const INITIAL_POLL_DELAY_MS = 1_000;

/** Cap on the job-poll delay after backoff. Exported for tests. */
export const MAX_POLL_DELAY_MS = 15_000;

/**
 * Compute the next poll delay from the current one — exponential growth
 * (×1.5) capped at MAX_POLL_DELAY_MS. Pure helper so the backoff curve
 * can be asserted directly without driving a full waitForJob loop.
 */
export function nextPollDelay(currentMs: number): number {
  return Math.min(Math.floor(currentMs * 1.5), MAX_POLL_DELAY_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TrueNASClient {
  private wsUrl: string;
  private apiKey: string;
  private verifySsl: boolean;
  private logger: Logger;
  private keepaliveIntervalMs: number;

  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private authenticated = false;
  private connectPromise: Promise<void> | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: TrueNASClientConfig) {
    const base = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.verifySsl = config.verifySsl ?? true;
    this.logger = config.logger ?? noopLogger;
    this.keepaliveIntervalMs = config.keepaliveIntervalMs ?? 0;

    // Build WebSocket URL
    this.wsUrl = toWsUrl(base);
  }

  /**
   * Connect to TrueNAS WebSocket and authenticate.
   * Safe to call multiple times — returns existing connection if already connected.
   */
  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN && this.authenticated) return;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = this.doConnect();
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  private async doConnect(): Promise<void> {
    this.cleanup();

    const ws = new WebSocket(this.wsUrl, {
      rejectUnauthorized: this.verifySsl,
      handshakeTimeout: 10_000,
      maxPayload: 10 * 1024 * 1024, // 10MB
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.terminate();
        reject(new Error("WebSocket connection timed out"));
      }, 10_000);

      ws.once("open", () => {
        clearTimeout(timeout);
        resolve();
      });
      ws.once("error", (err) => {
        clearTimeout(timeout);
        reject(new Error(`WebSocket connection failed: ${err.message}`));
      });
    });

    this.ws = ws;

    // DDP handshake (before read loop — handshake uses its own temporary handler)
    await this.handshake();

    // Start the generic read loop only after handshake completes
    this.startReadLoop();

    // Authenticate
    const authResult = await this.callRaw("auth.login_with_api_key", [this.apiKey]);
    if (authResult !== true) {
      this.close();
      this.logger.error("ws auth failed", { url: this.wsUrl });
      throw new Error("TrueNAS authentication failed — check API key");
    }
    this.authenticated = true;
    this.logger.info("ws connected", { url: this.wsUrl });
    this.startKeepalive();
  }

  private startKeepalive(): void {
    if (this.keepaliveIntervalMs <= 0) return;
    this.stopKeepalive();
    this.keepaliveTimer = setInterval(() => {
      this.callRaw("system.info", [], 5_000, true)
        .then(() => this.logger.debug("keepalive ok"))
        .catch((err) => {
          this.logger.warn("keepalive failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        });
    }, this.keepaliveIntervalMs);
    // Don't keep the event loop alive on this timer alone.
    if (typeof this.keepaliveTimer.unref === "function") {
      this.keepaliveTimer.unref();
    }
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  private async handshake(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        settled = true;
        clearTimeout(timeout);
        this.ws?.off("message", handler);
      };

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("DDP handshake timed out"));
      }, 10_000);

      const handler = (data: WebSocket.Data) => {
        if (settled) return;
        try {
          const msg = JSON.parse(data.toString());
          if (msg.msg === "connected") {
            cleanup();
            resolve();
          } else if (msg.msg === "failed") {
            cleanup();
            reject(new Error(`DDP handshake failed: ${JSON.stringify(msg)}`));
          }
        } catch {
          // ignore parse errors during handshake
        }
      };

      this.ws?.on("message", handler);
      this.ws?.send(JSON.stringify({
        msg: "connect",
        version: "1",
        support: ["1"],
      }));
    });
  }

  private startReadLoop(): void {
    if (!this.ws) return;

    this.ws.on("message", (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString()) as DDPResponse;
        if (!msg.id) return; // Ignore messages without IDs (ping, sub events)

        if (msg.msg === "failed" || msg.error) {
          const errMsg = msg.error?.message || "API call failed";
          const code = msg.error?.code ? ` (code ${msg.error.code})` : "";
          this.settlePending(msg.id, "reject", new Error(`TrueNAS API error: ${errMsg}${code}`));
        } else {
          this.settlePending(msg.id, "resolve", msg.result);
        }
      } catch {
        // Ignore unparseable messages
      }
    });

    this.ws.on("close", () => {
      this.failAllPending(new Error("WebSocket connection closed"));
      this.authenticated = false;
      this.logger.warn("ws closed", { pending: this.pending.size });
    });

    this.ws.on("error", (err) => {
      this.failAllPending(new Error(`WebSocket error: ${err.message}`));
      this.logger.error("ws error", { error: err.message });
    });
  }

  /**
   * Call a TrueNAS WebSocket API method.
   * Automatically connects if not already connected.
   *
   * @param idempotent  Override the inferred idempotency hint. When the
   *                    underlying ws drops and reconnect succeeds, only
   *                    idempotent calls are auto-retried; non-idempotent
   *                    calls reject with `ReconnectAborted` so callers can
   *                    decide whether duplicate side effects are safe.
   *                    Default: inferred from method name (`*.query`,
   *                    `*.get_instance`, `*.config`, `core.get_jobs`).
   */
  async call(method: string, params: unknown[] = [], timeoutMs = 30_000, idempotent?: boolean): Promise<unknown> {
    await this.connect();

    const isIdempotent = idempotent ?? inferIdempotent(method);
    const start = Date.now();

    try {
      const result = await this.callRaw(method, params, timeoutMs, isIdempotent);
      this.logger.debug("rpc ok", { method, durMs: Date.now() - start });
      return result;
    } catch (err) {
      if (!isConnectionError(err)) {
        this.logger.warn("rpc err", {
          method,
          durMs: Date.now() - start,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }

      // Connection dropped. Idempotent calls retry transparently; everything
      // else surfaces ReconnectAborted so the caller can make the safety
      // call about replaying.
      if (!isIdempotent) {
        this.cleanup();
        this.logger.warn("rpc abort (non-idempotent reconnect)", {
          method,
          durMs: Date.now() - start,
        });
        throw new ReconnectAborted(method);
      }

      this.cleanup();
      this.logger.info("rpc retry on reconnect", { method });
      await this.connect();
      const result = await this.callRaw(method, params, timeoutMs, isIdempotent);
      this.logger.debug("rpc ok (after retry)", { method, durMs: Date.now() - start });
      return result;
    }
  }

  private callRaw(method: string, params: unknown[], timeoutMs = 30_000, idempotent = false): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket not connected"));
        return;
      }

      const id = randomUUID();

      const timer = setTimeout(() => {
        this.settlePending(id, "reject", new Error(`Request timed out after ${timeoutMs}ms: ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer, settled: false, method, idempotent });

      const request: DDPRequest = { id, msg: "method", method, params };
      const payload = JSON.stringify(request);

      try {
        this.ws.send(payload, (err) => {
          if (err) this.settlePending(id, "reject", new WebSocketSendError(err.message));
        });
      } catch (e) {
        this.settlePending(id, "reject", new WebSocketSendError(e instanceof Error ? e.message : String(e)));
      }
    });
  }

  /**
   * Single state-transition point for settling a pending request.
   * Idempotent: subsequent calls for the same id are no-ops. This eliminates
   * the late-response-after-timeout race and any double-settle attempts from
   * timer / message-handler / send-error / close / error paths.
   */
  private settlePending(id: string, mode: "resolve" | "reject", payload: unknown): void {
    const req = this.pending.get(id);
    if (!req || req.settled) return;
    req.settled = true;
    this.pending.delete(id);
    clearTimeout(req.timer);
    if (mode === "resolve") {
      req.resolve(payload);
    } else {
      req.reject(payload as Error);
    }
  }

  /**
   * Wait for a long-running job to complete.
   * Polls core.get_jobs with exponential backoff (start 1s, ×1.5, cap 15s)
   * and skips poll attempts while the WebSocket is disconnected so we
   * don't burn timeout budget hammering reconnects.
   */
  async waitForJob(jobId: number, timeoutMs = 300_000): Promise<JobResult> {
    const start = Date.now();
    let delay = INITIAL_POLL_DELAY_MS;

    while (Date.now() - start < timeoutMs) {
      const remaining = timeoutMs - (Date.now() - start);

      // If the ws isn't connected, sleep first and let the next call()
      // attempt the reconnect through its normal path. Avoids back-to-back
      // reconnect storms when TrueNAS is down.
      if (!this.isConnected()) {
        await sleep(Math.min(delay, remaining));
        delay = nextPollDelay(delay);
        continue;
      }

      const jobs = await this.call(
        "core.get_jobs",
        [[["id", "=", jobId]]],
        30_000,
      ) as JobResult[];

      const target = Array.isArray(jobs)
        ? jobs.find((j) => j.id === jobId)
        : undefined;

      if (target) {
        if (target.state === "SUCCESS") return target;
        if (target.state === "FAILED") {
          throw new Error(`Job ${jobId} failed: ${target.error}`);
        }
        if (target.state === "ABORTED") {
          throw new Error(`Job ${jobId} was aborted`);
        }
      }

      await sleep(Math.min(delay, timeoutMs - (Date.now() - start)));
      delay = nextPollDelay(delay);
    }
    throw new Error(`Job ${jobId} timed out after ${timeoutMs}ms`);
  }

  private isConnected(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN && this.authenticated;
  }

  /** Test connectivity via WebSocket ping. */
  async ping(): Promise<boolean> {
    try {
      await this.call("system.info", [], 10_000);
      return true;
    } catch {
      return false;
    }
  }

  /** Close the WebSocket connection. */
  close(): void {
    this.cleanup();
  }

  private cleanup(): void {
    this.stopKeepalive();
    this.failAllPending(new Error("Connection closing"));
    this.authenticated = false;
    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
  }

  private failAllPending(error: Error): void {
    // Snapshot ids so iteration is unaffected by settlePending's map mutations.
    const ids = [...this.pending.keys()];
    for (const id of ids) {
      this.settlePending(id, "reject", error);
    }
  }

}

// ═══════════════════════════════════════════════════════════════════════
// URL helpers
// ═══════════════════════════════════════════════════════════════════════

function toWsUrl(base: string): string {
  if (base.startsWith("wss://") || base.startsWith("ws://")) {
    return base.replace(/\/+$/, "") + "/websocket";
  }
  const scheme = base.startsWith("http://") ? "ws" : "wss";
  const host = base.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `${scheme}://${host}/websocket`;
}

function isConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("broken pipe") ||
    msg.includes("connection reset") ||
    msg.includes("eof") ||
    msg.includes("closed") ||
    msg.includes("connection refused") ||
    msg.includes("timeout") ||
    msg.includes("not connected")
  );
}
