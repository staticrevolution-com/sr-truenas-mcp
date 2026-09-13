import { describe, it, expect } from "vitest";
import type { TrueNASClient, JobResult } from "../client.js";
import { buildRegistry } from "../tools/index.js";
import { ACTION_TIERS, SafetyTier } from "../safety.js";
import { validateHomeDirectory, DEFAULT_HOME_PATH } from "../validation.js";
import {
  buildUploadBody,
  toHttpOrigin,
  MAX_TRANSFER_BYTES,
  DEFAULT_DOWNLOAD_BYTES,
} from "../file-transfer.js";

/**
 * Regression gates for five defects hit live against TrueNAS 26.0.0-BETA.1 on
 * 2026-09-13. Each `describe` names the defect and, importantly, the evidence
 * class behind it — reproduced live, read from upstream source, or inferred —
 * because the fix and the confidence in the fix are different facts.
 */

interface StubImpl {
  call?: (method: string, params: unknown[]) => unknown;
  waitForJob?: (jobId: number) => Promise<Partial<JobResult>>;
  getFileContent?: (path: string, limit: number) => Promise<Buffer>;
  putFileContent?: (
    path: string,
    content: Buffer,
    options: { append?: boolean; mode?: number | null },
  ) => Promise<Partial<JobResult>>;
}

function stubClient(impl: StubImpl): TrueNASClient {
  return {
    call: async (method: string, params: unknown[] = []) => {
      if (!impl.call) throw new Error(`unexpected call(${method})`);
      return impl.call(method, params);
    },
    waitForJob: async (jobId: number) => {
      if (!impl.waitForJob) throw new Error(`unexpected waitForJob(${jobId})`);
      return impl.waitForJob(jobId);
    },
    getFileContent: async (path: string, limit: number) => {
      if (!impl.getFileContent) throw new Error(`unexpected getFileContent(${path})`);
      return impl.getFileContent(path, limit);
    },
    putFileContent: async (
      path: string,
      content: Buffer,
      options: { append?: boolean; mode?: number | null },
    ) => {
      if (!impl.putFileContent) throw new Error(`unexpected putFileContent(${path})`);
      return impl.putFileContent(path, content, options);
    },
  } as unknown as TrueNASClient;
}

function contentText(result: unknown): string {
  return (result as { content: Array<{ text: string }> }).content[0].text;
}

// ═══════════════════════════════════════════════════════════════════════
// #4 — snapshot_list applied the dataset filter client-side
// Evidence: REPRODUCED LIVE. `pool.snapshot.query` with a server-side
// [["dataset","=",X]] filter returned 21 rows for a dataset that the old
// code path reported as empty under `limit: 50` (2513 snapshots on the box).
// ═══════════════════════════════════════════════════════════════════════

describe("#4 snapshot_list pushes the dataset filter to the server", () => {
  it("sends [[dataset,=,X]] rather than filtering the fetched page", async () => {
    let sentFilters: unknown;
    const registry = buildRegistry(
      stubClient({
        call: (method, params) => {
          expect(method).toBe("pool.snapshot.query");
          sentFilters = (params as unknown[])[0];
          return [{ id: "tank/data@a", dataset: "tank/data" }];
        },
      }),
    );

    await registry.execute("storage", "snapshot_list", { dataset: "tank/data", limit: 50 });

    expect(sentFilters).toEqual([["dataset", "=", "tank/data"]]);
  });

  it("returns rows the old client-side filter would have dropped", async () => {
    // The exact live shape: the caller asks for one dataset with a small
    // limit, and the server — now actually filtered — answers with that
    // dataset's snapshots. Under the old code the page was drawn from every
    // snapshot on the pool and then narrowed, yielding [].
    const registry = buildRegistry(
      stubClient({
        call: (_method, params) => {
          const filters = (params as unknown[])[0] as unknown[];
          // A stub of a *filtering* server: honour the filter it is given.
          const all = [
            { id: "other/ds@1", dataset: "other/ds" },
            { id: "tank/data@1", dataset: "tank/data" },
          ];
          if (filters.length === 0) return all.slice(0, 1); // the old page boundary
          return all.filter((s) => s.dataset === "tank/data");
        },
      }),
    );

    const result = await registry.execute("storage", "snapshot_list", {
      dataset: "tank/data",
      limit: 1,
    });
    expect(JSON.parse(contentText(result))).toHaveLength(1);
  });

  it("sends no filter when no dataset is given", async () => {
    let sentFilters: unknown = "unset";
    const registry = buildRegistry(
      stubClient({
        call: (_method, params) => {
          sentFilters = (params as unknown[])[0];
          return [];
        },
      }),
    );
    await registry.execute("storage", "snapshot_list", { limit: 5 });
    expect(sentFilters).toEqual([]);
  });

  it("rejects a malformed dataset name instead of forwarding it", async () => {
    const registry = buildRegistry(
      stubClient({
        call: () => {
          throw new Error("the query must never be reached");
        },
      }),
    );
    await expect(
      registry.execute("storage", "snapshot_list", { dataset: "tank/../etc" }),
    ).rejects.toThrow(/path traversal/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// #3 — the /mnt/ guard was applied to user home directories
// Evidence: REPRODUCED LIVE, and confirmed against `user.create`'s own
// schema, which declares `home` with default "/var/empty".
// ═══════════════════════════════════════════════════════════════════════

describe("#3 validateHomeDirectory accepts the product's own default", () => {
  it("accepts /var/empty — the value TrueNAS assigns when home is omitted", () => {
    expect(validateHomeDirectory(DEFAULT_HOME_PATH)).toBe("/var/empty");
  });

  it("accepts a real home under /mnt/", () => {
    expect(validateHomeDirectory("/mnt/tank/homes/alice")).toBe("/mnt/tank/homes/alice");
  });

  it("still rejects an arbitrary path outside /mnt/", () => {
    expect(() => validateHomeDirectory("/etc")).toThrow(/must start with \/mnt\//);
  });

  it("rejects the root of /mnt, as the middleware does", () => {
    expect(() => validateHomeDirectory("/mnt")).toThrow(/root of "\/mnt"/);
    expect(() => validateHomeDirectory("/mnt/")).toThrow(/root of "\/mnt"/);
  });

  it("still rejects traversal, NUL bytes and colons", () => {
    expect(() => validateHomeDirectory("/mnt/tank/../etc")).toThrow(/path traversal/);
    expect(() => validateHomeDirectory("/mnt/tank\0/x")).toThrow(/null bytes/);
    expect(() => validateHomeDirectory("/mnt/tank/a:b")).toThrow(/colons/);
  });

  it("user_create forwards /var/empty instead of refusing it", async () => {
    let sentBody: Record<string, unknown> | undefined;
    const registry = buildRegistry(
      stubClient({
        call: (method, params) => {
          expect(method).toBe("user.create");
          sentBody = (params as unknown[])[0] as Record<string, unknown>;
          return { id: 42 };
        },
      }),
    );

    const result = await registry.execute("account", "user_create", {
      username: "svc",
      full_name: "Service Account",
      home: "/var/empty",
      home_create: false,
      confirm: true,
      reason: "regression test",
    });

    expect(sentBody?.home).toBe("/var/empty");
    expect(contentText(result)).toContain("42");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// #1 — pool.snapshottask.run is broken upstream on 26.0
// Evidence: REPRODUCED LIVE (task 14, PENDING, valid) and READ FROM
// UPSTREAM SOURCE — plugins/snapshot.py on origin/release/26.0.0-BETA.1
// does `task["enabled"]` against a pydantic model. Fixed upstream in
// b237df99 (NAS-140147, 27.0.0-BETA.1). Not fixable in this server.
// ═══════════════════════════════════════════════════════════════════════

describe("#1 snapshot_task_run explains the upstream bug instead of leaking EINVAL", () => {
  const upstreamError =
    "TrueNAS API error: [EINVAL] 'PeriodicSnapshotTaskQueryResultItem' object is not subscriptable (code 22)";

  it("names the cause, the fix version and the task's own config", async () => {
    const registry = buildRegistry(
      stubClient({
        call: (method) => {
          if (method === "pool.snapshottask.run") throw new Error(upstreamError);
          if (method === "pool.snapshottask.query") {
            return [
              {
                id: 14,
                dataset: "tank/backups",
                recursive: false,
                naming_schema: "auto-%Y-%m-%d_%H-%M",
                schedule: { minute: "30", hour: "0,4,8,12,16,20" },
              },
            ];
          }
          throw new Error(`unexpected ${method}`);
        },
      }),
    );

    await expect(
      registry.execute("storage", "snapshot_task_run", { id: 14, confirm: true }),
    ).rejects.toThrow(/upstream middleware bug/);

    const err = await registry
      .execute("storage", "snapshot_task_run", { id: 14, confirm: true })
      .catch((e: Error) => e.message);

    expect(err).toContain("27.0.0-BETA.1");
    expect(err).toContain("b237df99");
    expect(err).toContain("auto-%Y-%m-%d_%H-%M");
    // The retention trap is the load-bearing half: a snapshot created by hand
    // is owned by the task only if its NAME encodes a scheduled moment, so a
    // caller told merely to "use snapshot_create" would silently accumulate
    // snapshots that nothing ever prunes.
    expect(err).toMatch(/never be pruned/);
  });

  it("degrades gracefully when the task config cannot be fetched", async () => {
    const registry = buildRegistry(
      stubClient({
        call: (method) => {
          if (method === "pool.snapshottask.run") throw new Error(upstreamError);
          throw new Error("query unavailable");
        },
      }),
    );
    const err = await registry
      .execute("storage", "snapshot_task_run", { id: 14, confirm: true })
      .catch((e: Error) => e.message);
    expect(err).toContain("upstream middleware bug");
    expect(err).toContain("snapshot_task_list");
  });

  it("does not swallow unrelated errors", async () => {
    const registry = buildRegistry(
      stubClient({
        call: () => {
          throw new Error("TrueNAS API error: [ENOENT] task 99 does not exist");
        },
      }),
    );
    await expect(
      registry.execute("storage", "snapshot_task_run", { id: 99, confirm: true }),
    ).rejects.toThrow(/ENOENT/);
  });

  it("passes a working call straight through", async () => {
    const registry = buildRegistry(stubClient({ call: () => null }));
    const result = await registry.execute("storage", "snapshot_task_run", {
      id: 1,
      confirm: true,
    });
    expect(contentText(result)).toBe("null");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// #5 — nothing in the tool surface reported this server's own version
// Evidence: INFERRED. The deployed build was established behaviourally
// through the gateway (v1.2.0 summary shaping + v1.2.1 unit/page handling),
// not by reading the backend's image pin. This action removes the need to
// infer it next time.
// ═══════════════════════════════════════════════════════════════════════

describe("#5 system_mcp_version reports this server's build", () => {
  it("is registered, open-tier, and distinct from system_version", () => {
    expect(ACTION_TIERS.system_mcp_version).toBe(SafetyTier.Open);
    const registry = buildRegistry(stubClient({}));
    expect(registry.tools.has("system_mcp_version")).toBe(true);
    expect(registry.tools.has("system_version")).toBe(true);
  });

  it("reports the build stamp without touching TrueNAS", async () => {
    // No `call` in the stub: any middleware call would throw. The version of
    // the server must be answerable when the NAS is unreachable — that is
    // precisely when you need to know what is deployed.
    const registry = buildRegistry(stubClient({}));
    const parsed = JSON.parse(
      contentText(await registry.execute("system", "system_mcp_version", {})),
    );
    expect(parsed.name).toBe("sr-truenas-mcp");
    expect(typeof parsed.version).toBe("string");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// #2 — filesystem could not read or write file content
// Evidence: the middleware surface was ENUMERATED LIVE (781 methods) and the
// /_upload and /_download handlers were READ FROM UPSTREAM SOURCE. The
// transfers themselves are NOT exercised against a live NAS in this suite.
// ═══════════════════════════════════════════════════════════════════════

describe("#2 filesystem_get / filesystem_put", () => {
  it("registers both, with put gated on confirm and get open", () => {
    expect(ACTION_TIERS.filesystem_put).toBe(SafetyTier.Confirm);
    expect(ACTION_TIERS.filesystem_get).toBe(SafetyTier.Open);
  });

  it("filesystem_get returns text when the bytes are valid UTF-8", async () => {
    const registry = buildRegistry(
      stubClient({ getFileContent: async () => Buffer.from("hello — world", "utf8") }),
    );
    const parsed = JSON.parse(
      contentText(
        await registry.execute("filesystem", "filesystem_get", { path: "/mnt/tank/a.txt" }),
      ),
    );
    expect(parsed.encoding).toBe("utf8");
    expect(parsed.content).toBe("hello — world");
  });

  it("filesystem_get falls back to base64 rather than returning mojibake", async () => {
    // 0xff is not valid UTF-8. A naive toString("utf8") would substitute
    // U+FFFD and report a clean success carrying corrupted content.
    const raw = Buffer.from([0x00, 0xff, 0xfe, 0x41]);
    const registry = buildRegistry(stubClient({ getFileContent: async () => raw }));
    const parsed = JSON.parse(
      contentText(
        await registry.execute("filesystem", "filesystem_get", { path: "/mnt/tank/a.bin" }),
      ),
    );
    expect(parsed.encoding).toBe("base64");
    expect(Buffer.from(parsed.content, "base64").equals(raw)).toBe(true);
  });

  it("filesystem_get passes the default byte cap down to the transport", async () => {
    let seenLimit = -1;
    const registry = buildRegistry(
      stubClient({
        getFileContent: async (_p, limit) => {
          seenLimit = limit;
          return Buffer.from("x");
        },
      }),
    );
    await registry.execute("filesystem", "filesystem_get", { path: "/mnt/tank/a" });
    expect(seenLimit).toBe(DEFAULT_DOWNLOAD_BYTES);
  });

  it("filesystem_get rejects a cap above the hard ceiling", async () => {
    const registry = buildRegistry(stubClient({}));
    const result = await registry.execute("filesystem", "filesystem_get", {
      path: "/mnt/tank/a",
      max_bytes: MAX_TRANSFER_BYTES + 1,
    });
    expect(JSON.stringify(result)).toMatch(/Validation failed/);
  });

  it("filesystem_get enforces the /mnt/ path guard", async () => {
    const registry = buildRegistry(stubClient({}));
    await expect(
      registry.execute("filesystem", "filesystem_get", { path: "/etc/shadow" }),
    ).rejects.toThrow(/must start with \/mnt\//);
  });

  it("filesystem_put writes utf8 content and verifies the file exists after", async () => {
    let written: Buffer | undefined;
    const registry = buildRegistry(
      stubClient({
        putFileContent: async (_p, content) => {
          written = content;
          return { id: 1, state: "SUCCESS" };
        },
        call: (method) => {
          expect(method).toBe("filesystem.stat");
          return { size: 5, type: "FILE" };
        },
      }),
    );
    const parsed = JSON.parse(
      contentText(
        await registry.execute("filesystem", "filesystem_put", {
          path: "/mnt/tank/a.txt",
          content: "hello",
          confirm: true,
        }),
      ),
    );
    expect(written?.toString("utf8")).toBe("hello");
    expect(parsed.bytes_written).toBe(5);
    expect(parsed.job_state).toBe("SUCCESS");
  });

  it("filesystem_put fails loudly when the file is absent after a 'successful' write", async () => {
    // Mirrors the filesystem_mkdir finding from the 2026-06-12 field report:
    // a write into an unmounted parent dataset reports success and leaves
    // nothing on disk.
    const registry = buildRegistry(
      stubClient({
        putFileContent: async () => ({ id: 1, state: "SUCCESS" }),
        call: () => {
          throw new Error("[ENOENT] path does not exist");
        },
      }),
    );
    await expect(
      registry.execute("filesystem", "filesystem_put", {
        path: "/mnt/tank/a.txt",
        content: "hello",
        confirm: true,
      }),
    ).rejects.toThrow(/post-write verification failed/);
  });

  it("filesystem_put requires exactly one of content / content_base64", async () => {
    const registry = buildRegistry(stubClient({}));
    await expect(
      registry.execute("filesystem", "filesystem_put", { path: "/mnt/t/a", confirm: true }),
    ).rejects.toThrow(/exactly one/);
    await expect(
      registry.execute("filesystem", "filesystem_put", {
        path: "/mnt/t/a",
        content: "x",
        content_base64: "eA==",
        confirm: true,
      }),
    ).rejects.toThrow(/exactly one/);
  });

  it("filesystem_put refuses malformed base64 instead of writing a short file", async () => {
    // Buffer.from(s, "base64") discards invalid characters silently, so
    // without this check a mangled payload becomes a truncated file that
    // reports success.
    const registry = buildRegistry(stubClient({}));
    await expect(
      registry.execute("filesystem", "filesystem_put", {
        path: "/mnt/t/a",
        content_base64: "not!valid!base64!!",
        confirm: true,
      }),
    ).rejects.toThrow(/not valid base64/);
  });

  it("filesystem_put round-trips real base64", async () => {
    let written: Buffer | undefined;
    const raw = Buffer.from([0x00, 0xff, 0x10]);
    const registry = buildRegistry(
      stubClient({
        putFileContent: async (_p, content) => {
          written = content;
          return { id: 1, state: "SUCCESS" };
        },
        call: () => ({ type: "FILE" }),
      }),
    );
    await registry.execute("filesystem", "filesystem_put", {
      path: "/mnt/t/a.bin",
      content_base64: raw.toString("base64"),
      confirm: true,
    });
    expect(written?.equals(raw)).toBe(true);
  });

  it("filesystem_put parses mode as octal", async () => {
    let seenMode: number | null | undefined;
    const registry = buildRegistry(
      stubClient({
        putFileContent: async (_p, _c, options) => {
          seenMode = options.mode;
          return { id: 1, state: "SUCCESS" };
        },
        call: () => ({ type: "FILE" }),
      }),
    );
    await registry.execute("filesystem", "filesystem_put", {
      path: "/mnt/t/a",
      content: "x",
      mode: "644",
      confirm: true,
    });
    expect(seenMode).toBe(0o644);
  });

  it("filesystem_put rejects a nonsensical mode", async () => {
    const registry = buildRegistry(stubClient({}));
    await expect(
      registry.execute("filesystem", "filesystem_put", {
        path: "/mnt/t/a",
        content: "x",
        mode: "9999",
        confirm: true,
      }),
    ).rejects.toThrow(/Invalid mode/);
  });

  it("filesystem_put is gated: no confirm, no write", async () => {
    const registry = buildRegistry(
      stubClient({
        putFileContent: async () => {
          throw new Error("must not be called without confirm");
        },
      }),
    );
    const result = await registry.execute("filesystem", "filesystem_put", {
      path: "/mnt/t/a",
      content: "x",
    });
    expect(contentText(result)).toContain("DESTRUCTIVE OPERATION");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Transport mechanics for the pipe endpoints.
// Evidence: READ FROM UPSTREAM SOURCE (apps/file_app.py, main.py routes) —
// the handler rejects any body whose first part is not named "data" and
// whose second is not named "file", so the shape is asserted here.
// ═══════════════════════════════════════════════════════════════════════

describe("#2 pipe transport shape", () => {
  it("derives the HTTP origin from the WebSocket base URL", () => {
    expect(toHttpOrigin("wss://nas.example:444")).toBe("https://nas.example:444");
    expect(toHttpOrigin("wss://nas.example:444/")).toBe("https://nas.example:444");
    expect(toHttpOrigin("ws://nas.example")).toBe("http://nas.example");
    expect(toHttpOrigin("https://nas.example:444")).toBe("https://nas.example:444");
    expect(toHttpOrigin("nas.example:444")).toBe("https://nas.example:444");
  });

  it("puts the JSON call in a first part named 'data' and the bytes in 'file'", () => {
    const payload = Buffer.from([0x00, 0x01, 0xff]);
    const { body, contentType } = buildUploadBody("filesystem.put", ["/mnt/t/a", {}], payload);
    const boundary = /boundary=(.+)$/.exec(contentType)?.[1];
    expect(boundary).toBeTruthy();

    const text = body.toString("latin1");
    const dataIdx = text.indexOf('name="data"');
    const fileIdx = text.indexOf('name="file"');
    expect(dataIdx).toBeGreaterThan(-1);
    expect(fileIdx).toBeGreaterThan(dataIdx); // order is enforced by the server
    expect(text).toContain('{"method":"filesystem.put","params":["/mnt/t/a",{}]}');
    expect(text.endsWith(`--${boundary}--\r\n`)).toBe(true);
    // The raw bytes must survive verbatim — no encoding applied.
    expect(body.includes(payload)).toBe(true);
  });
});
