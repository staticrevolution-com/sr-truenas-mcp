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

export interface TrueNASClientConfig {
  baseUrl: string;
  apiKey: string;
  verifySsl?: boolean;
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
}

export class TrueNASClient {
  private wsUrl: string;
  private apiKey: string;
  private verifySsl: boolean;

  private ws: WebSocket | null = null;
  private requestId = 0;
  private pending = new Map<string, PendingRequest>();
  private authenticated = false;
  private connectPromise: Promise<void> | null = null;

  constructor(config: TrueNASClientConfig) {
    const base = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.verifySsl = config.verifySsl ?? true;

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
      throw new Error("TrueNAS authentication failed — check API key");
    }
    this.authenticated = true;
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

        const pending = this.pending.get(msg.id);
        if (!pending) return; // Response for unknown request

        this.pending.delete(msg.id);
        clearTimeout(pending.timer);

        if (msg.msg === "failed" || msg.error) {
          const errMsg = msg.error?.message || "API call failed";
          const code = msg.error?.code ? ` (code ${msg.error.code})` : "";
          pending.reject(new Error(`TrueNAS API error: ${errMsg}${code}`));
        } else {
          pending.resolve(msg.result);
        }
      } catch {
        // Ignore unparseable messages
      }
    });

    this.ws.on("close", () => {
      this.failAllPending(new Error("WebSocket connection closed"));
      this.authenticated = false;
    });

    this.ws.on("error", (err) => {
      this.failAllPending(new Error(`WebSocket error: ${err.message}`));
    });
  }

  /**
   * Call a TrueNAS WebSocket API method.
   * Automatically connects if not already connected.
   */
  async call(method: string, params: unknown[] = [], timeoutMs = 30_000): Promise<unknown> {
    await this.connect();

    try {
      return await this.callRaw(method, params, timeoutMs);
    } catch (err) {
      // Retry once on connection errors
      if (isConnectionError(err)) {
        this.cleanup();
        await this.connect();
        return this.callRaw(method, params, timeoutMs);
      }
      throw err;
    }
  }

  private callRaw(method: string, params: unknown[], timeoutMs = 30_000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket not connected"));
        return;
      }

      const id = String(++this.requestId);

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timed out after ${timeoutMs}ms: ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      const request: DDPRequest = { id, msg: "method", method, params };
      this.ws.send(JSON.stringify(request), (err) => {
        if (err) {
          this.pending.delete(id);
          clearTimeout(timer);
          reject(new Error(`Failed to send request: ${err.message}`));
        }
      });
    });
  }

  /**
   * Wait for a long-running job to complete.
   * Polls core.get_jobs until the job reaches a terminal state.
   */
  async waitForJob(jobId: number, timeoutMs = 300_000): Promise<JobResult> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const jobs = await this.call(
        "core.get_jobs",
        [[["id", "=", jobId]]],
        30_000
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
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(`Job ${jobId} timed out after ${timeoutMs}ms`);
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
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
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
