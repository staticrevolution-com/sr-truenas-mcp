/**
 * File-content transfer over TrueNAS's HTTP pipe endpoints.
 *
 * `filesystem.get` and `filesystem.put` are the only way to read or write file
 * CONTENT through the middleware, and neither is callable over the WebSocket:
 * both are `@job` methods whose payload travels through a *pipe*, which
 * middlewared exposes only as two HTTP routes (registered in `main.py`):
 *
 *   POST /_upload    — multipart; part "data" is the JSON call, part "file" is
 *                      the bytes. Responds `{"job_id": N}`.
 *   GET  /_download  — URL minted by `core.download`, single-use, 300s TTL, and
 *                      origin-matched against the session that minted it.
 *
 * Hence this module: everything else in this server speaks JSON-RPC over WSS,
 * but file content cannot. `node:https` is used directly rather than `fetch` so
 * that `TRUENAS_VERIFY_SSL=false` keeps working — opting a `fetch` call out of
 * certificate verification needs an undici dispatcher, i.e. a new dependency,
 * for something `node:https` does with one flag.
 */

import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { randomBytes } from "node:crypto";
import { URL } from "node:url";

/**
 * Ceiling on a single transfer, in bytes, in either direction.
 *
 * File content crosses an LLM context window here, so the binding limit is not
 * what the NAS can serve — it is what a tool result can usefully carry. 16 MiB
 * is already far past that; it exists to turn "the agent asked for a 40 GB
 * disk image" into an immediate, cheap error instead of an OOM.
 */
export const MAX_TRANSFER_BYTES = 16 * 1024 * 1024;

/** Default read size when the caller does not specify one. */
export const DEFAULT_DOWNLOAD_BYTES = 1024 * 1024;

export interface HttpTransportConfig {
  /** Origin only, e.g. `https://truenas.example:444`. */
  baseUrl: string;
  apiKey: string;
  verifySsl: boolean;
}

/**
 * Derive the HTTP origin for the pipe endpoints from the configured API base.
 *
 * `TRUENAS_URL` is normally a `wss://` URL because everything else in this
 * server is WebSocket; the pipe endpoints live on the same host and port over
 * plain HTTPS. `ws://` maps to `http://` so a local plaintext deployment keeps
 * working rather than silently attempting TLS.
 */
export function toHttpOrigin(base: string): string {
  const trimmed = base.replace(/\/+$/, "");
  if (trimmed.startsWith("wss://")) return "https://" + trimmed.slice("wss://".length);
  if (trimmed.startsWith("ws://")) return "http://" + trimmed.slice("ws://".length);
  if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) return trimmed;
  return "https://" + trimmed;
}

interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

/**
 * Issue one request and buffer the response.
 *
 * `limitBytes` aborts mid-stream rather than after the fact: the point of a cap
 * on a download is not to refuse a large file once it has already been pulled
 * into memory.
 */
function send(
  url: string,
  options: {
    method: "GET" | "POST";
    headers: Record<string, string>;
    body?: Buffer;
    verifySsl: boolean;
    timeoutMs: number;
    limitBytes?: number;
  },
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isTls = parsed.protocol === "https:";
    const doRequest = isTls ? httpsRequest : httpRequest;

    const req = doRequest(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (isTls ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: options.method,
        headers: options.headers,
        ...(isTls ? { rejectUnauthorized: options.verifySsl } : {}),
      },
      (res) => {
        const chunks: Buffer[] = [];
        let total = 0;
        let aborted = false;

        res.on("data", (chunk: Buffer) => {
          if (aborted) return;
          total += chunk.length;
          if (options.limitBytes !== undefined && total > options.limitBytes) {
            aborted = true;
            res.destroy();
            reject(
              new Error(
                `Response exceeded the ${options.limitBytes}-byte limit; aborted after ${total} bytes.`,
              ),
            );
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          if (aborted) return;
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
        res.on("error", (err) => {
          if (!aborted) reject(err);
        });
      },
    );

    req.setTimeout(options.timeoutMs, () => {
      req.destroy(new Error(`Request to ${parsed.pathname} timed out after ${options.timeoutMs}ms`));
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

/**
 * Build the two-part `multipart/form-data` body `/_upload` requires.
 *
 * The handler is strict about shape: the FIRST part must be named `data` and
 * carry the JSON call, and the second must be named `file`. Anything else is
 * rejected with a 405 naming the offending part.
 */
export function buildUploadBody(
  method: string,
  params: unknown[],
  content: Buffer,
): { body: Buffer; contentType: string } {
  const boundary = "----srtruenasmcp" + randomBytes(16).toString("hex");
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="data"\r\n` +
      `Content-Type: application/json\r\n\r\n` +
      `${JSON.stringify({ method, params })}\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="upload"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`,
    "utf8",
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  return {
    body: Buffer.concat([head, content, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

/**
 * POST a pipe-input job to `/_upload` and return the job id it enqueues.
 *
 * The 200 means the job STARTED, not that it succeeded — the caller must wait
 * on the job. Reporting the enqueue as success is how a failed write gets
 * reported as a completed one.
 */
export async function uploadToPipe(
  config: HttpTransportConfig,
  method: string,
  params: unknown[],
  content: Buffer,
  timeoutMs = 120_000,
): Promise<number> {
  if (content.length > MAX_TRANSFER_BYTES) {
    throw new Error(
      `Refusing to upload ${content.length} bytes: the limit is ${MAX_TRANSFER_BYTES} (16 MiB).`,
    );
  }
  const { body, contentType } = buildUploadBody(method, params, content);
  const res = await send(`${toHttpOrigin(config.baseUrl)}/_upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": contentType,
      "Content-Length": String(body.length),
    },
    body,
    verifySsl: config.verifySsl,
    timeoutMs,
  });

  if (res.status !== 200) {
    throw new Error(
      `Upload to /_upload failed with HTTP ${res.status}: ${res.body.toString("utf8").slice(0, 500)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(res.body.toString("utf8"));
  } catch {
    throw new Error(`Upload returned a non-JSON body: ${res.body.toString("utf8").slice(0, 200)}`);
  }
  const jobId = (parsed as { job_id?: unknown }).job_id;
  if (typeof jobId !== "number") {
    throw new Error(`Upload response did not carry a job_id: ${JSON.stringify(parsed).slice(0, 200)}`);
  }
  return jobId;
}

/**
 * Fetch bytes from a `/_download` URL minted by `core.download`.
 *
 * The URL is relative and carries its own single-use `auth_token`, so no
 * Authorization header is sent — and it must be used promptly: the token lives
 * 300 seconds and is origin-matched to the session that minted it.
 */
export async function downloadFromPipe(
  config: HttpTransportConfig,
  relativeUrl: string,
  limitBytes: number,
  timeoutMs = 120_000,
): Promise<Buffer> {
  const url = relativeUrl.startsWith("http")
    ? relativeUrl
    : `${toHttpOrigin(config.baseUrl)}${relativeUrl.startsWith("/") ? "" : "/"}${relativeUrl}`;

  const res = await send(url, {
    method: "GET",
    headers: {},
    verifySsl: config.verifySsl,
    timeoutMs,
    limitBytes,
  });

  if (res.status !== 200) {
    throw new Error(
      `Download failed with HTTP ${res.status}: ${res.body.toString("utf8").slice(0, 500)}`,
    );
  }
  return res.body;
}
