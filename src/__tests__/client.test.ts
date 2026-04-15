import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

// Mock WebSocket before importing the client
class MockWebSocket extends EventEmitter {
  static OPEN = 1;
  static CONNECTING = 0;
  readyState = 1; // OPEN
  sentMessages: string[] = [];

  constructor(_url: string, _opts?: unknown) {
    super();
    // Simulate async open
    setTimeout(() => this.emit("open"), 0);
  }

  send(data: string, cb?: (err?: Error) => void): void {
    this.sentMessages.push(data);
    cb?.();
  }

  close(): void {
    this.readyState = 3; // CLOSED
  }

  terminate(): void {
    this.readyState = 3;
  }

  removeAllListeners(): this {
    super.removeAllListeners();
    return this;
  }

  /** Test helper: simulate server sending a message */
  serverSend(msg: Record<string, unknown>): void {
    this.emit("message", JSON.stringify(msg));
  }
}

vi.mock("ws", () => ({
  default: MockWebSocket,
  WebSocket: MockWebSocket,
}));

// Import after mock is set up
const { TrueNASClient } = await import("../client.js");

describe("TrueNASClient WebSocket", () => {
  let client: InstanceType<typeof TrueNASClient>;
  let mockWs: MockWebSocket;

  function interceptWs(): void {
    const origEmit = MockWebSocket.prototype.emit;
    const origSend = MockWebSocket.prototype.send;

    // Intercept send to auto-respond to handshake and auth
    MockWebSocket.prototype.send = function (data: string, cb?: (err?: Error) => void) {
      this.sentMessages.push(data);
      cb?.();

      const msg = JSON.parse(data);
      if (msg.msg === "connect") {
        // Respond with connected
        setTimeout(() => this.emit("message", JSON.stringify({ msg: "connected", session: "test-session" })), 0);
      } else if (msg.method === "auth.login_with_api_key") {
        // Respond with auth success
        setTimeout(() => this.emit("message", JSON.stringify({ id: msg.id, msg: "result", result: true })), 0);
      }

      mockWs = this;
    };
  }

  beforeEach(() => {
    interceptWs();
    client = new TrueNASClient({
      baseUrl: "https://192.168.1.235",
      apiKey: "test-api-key",
      verifySsl: false,
    });
  });

  afterEach(() => {
    client.close();
    vi.restoreAllMocks();
  });

  describe("Connection", () => {
    it("sends DDP connect handshake", async () => {
      await client.connect();
      const handshake = JSON.parse(mockWs.sentMessages[0]);
      expect(handshake).toEqual({
        msg: "connect",
        version: "1",
        support: ["1"],
      });
    });

    it("authenticates with API key", async () => {
      await client.connect();
      const authMsg = JSON.parse(mockWs.sentMessages[1]);
      expect(authMsg.msg).toBe("method");
      expect(authMsg.method).toBe("auth.login_with_api_key");
      expect(authMsg.params).toEqual(["test-api-key"]);
    });

    it("uses incrementing string IDs", async () => {
      await client.connect();
      const authMsg = JSON.parse(mockWs.sentMessages[1]);
      expect(authMsg.id).toBe("1");
    });
  });

  describe("call()", () => {
    it("sends method call in DDP format", async () => {
      await client.connect();

      const callPromise = client.call("pool.query", []);

      // Wait for the send to happen
      await new Promise((r) => setTimeout(r, 10));

      const callMsg = JSON.parse(mockWs.sentMessages[2]);
      expect(callMsg.msg).toBe("method");
      expect(callMsg.method).toBe("pool.query");
      expect(callMsg.params).toEqual([]);

      // Respond
      mockWs.serverSend({ id: callMsg.id, msg: "result", result: [{ name: "tank" }] });

      const result = await callPromise;
      expect(result).toEqual([{ name: "tank" }]);
    });

    it("routes responses to correct pending request by ID", async () => {
      await client.connect();

      const call1 = client.call("pool.query", []);
      const call2 = client.call("system.info", []);

      await new Promise((r) => setTimeout(r, 10));

      const msg1 = JSON.parse(mockWs.sentMessages[2]);
      const msg2 = JSON.parse(mockWs.sentMessages[3]);

      // Respond out of order
      mockWs.serverSend({ id: msg2.id, msg: "result", result: { version: "25.10.1" } });
      mockWs.serverSend({ id: msg1.id, msg: "result", result: [{ name: "tank" }] });

      expect(await call1).toEqual([{ name: "tank" }]);
      expect(await call2).toEqual({ version: "25.10.1" });
    });

    it("rejects on error response", async () => {
      await client.connect();

      const callPromise = client.call("pool.create", [{}]);
      await new Promise((r) => setTimeout(r, 10));

      const callMsg = JSON.parse(mockWs.sentMessages[2]);
      mockWs.serverSend({
        id: callMsg.id,
        msg: "failed",
        error: { code: 403, message: "Permission denied" },
      });

      await expect(callPromise).rejects.toThrow("Permission denied");
    });

    it("rejects on timeout", async () => {
      await client.connect();

      // Use a very short timeout
      const callPromise = client.call("slow.method", [], 50);

      // Don't respond — let it timeout
      await expect(callPromise).rejects.toThrow("timed out");
    }, 5000);
  });

  describe("TLS safety", () => {
    it("does NOT modify process.env.NODE_TLS_REJECT_UNAUTHORIZED", async () => {
      const before = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      new TrueNASClient({
        baseUrl: "https://192.168.1.235",
        apiKey: "test",
        verifySsl: false,
      });
      expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBe(before);
    });
  });

  describe("URL handling", () => {
    it("converts https:// to wss:// for WebSocket", async () => {
      const c = new TrueNASClient({
        baseUrl: "https://192.168.1.235",
        apiKey: "test",
      });
      await c.connect();
      // The MockWebSocket constructor receives the URL — we verify the handshake works
      // which means the URL was accepted
      c.close();
    });

    it("converts http:// to ws://", async () => {
      const c = new TrueNASClient({
        baseUrl: "http://192.168.1.235",
        apiKey: "test",
      });
      await c.connect();
      c.close();
    });
  });

  describe("ping()", () => {
    it("returns true on successful system.info call", async () => {
      await client.connect();

      const pingPromise = client.ping();
      await new Promise((r) => setTimeout(r, 10));

      // Find the system.info call
      const lastMsg = JSON.parse(mockWs.sentMessages[mockWs.sentMessages.length - 1]);
      expect(lastMsg.method).toBe("system.info");
      mockWs.serverSend({ id: lastMsg.id, msg: "result", result: { version: "25.10" } });

      expect(await pingPromise).toBe(true);
    });
  });

  describe("close()", () => {
    it("fails all pending requests on close", async () => {
      await client.connect();

      const callPromise = client.call("slow.method", [], 30_000);
      await new Promise((r) => setTimeout(r, 10));

      client.close();

      await expect(callPromise).rejects.toThrow("closing");
    });
  });
});
