import { describe, it, expect } from "vitest";
import type { TrueNASClient, JobResult } from "../client.js";
import { buildRegistry } from "../tools/index.js";

/**
 * Handler-level outcome verification — added after the 2026-06-12 field
 * report (TrueNAS 26.0.0-BETA.1 live deploy):
 * - filesystem.chown / setperm / setacl are @job methods; handlers must wait
 *   for the job instead of reporting the enqueued job id as success.
 * - filesystem.mkdir and pool.dataset.create can "succeed" while the target
 *   never materializes on disk (parent dataset unmounted); handlers stat back.
 */

interface StubImpl {
  call: (method: string, params: unknown[]) => unknown;
  waitForJob?: (jobId: number) => Promise<Partial<JobResult>>;
}

function stubClient(impl: StubImpl): TrueNASClient {
  return {
    call: async (method: string, params: unknown[] = []) => impl.call(method, params),
    waitForJob: async (jobId: number) => {
      if (!impl.waitForJob) throw new Error(`unexpected waitForJob(${jobId})`);
      return impl.waitForJob(jobId);
    },
  } as unknown as TrueNASClient;
}

function contentText(result: unknown): string {
  return (result as { content: Array<{ text: string }> }).content[0].text;
}

describe("Job-based filesystem handlers wait for job completion", () => {
  it("filesystem_chown waits for the job and reports its terminal state", async () => {
    const methods: string[] = [];
    const registry = buildRegistry(
      stubClient({
        call: (method) => {
          methods.push(method);
          return 123; // middlewared returns the job id immediately
        },
        waitForJob: async (jobId) => {
          expect(jobId).toBe(123);
          return { id: 123, state: "SUCCESS", result: null };
        },
      })
    );

    const result = await registry.execute("filesystem", "filesystem_chown", {
      path: "/mnt/tank/data",
      uid: 1000,
      confirm: true,
    });

    expect(methods).toEqual(["filesystem.chown"]);
    expect(contentText(result)).toContain("SUCCESS");
    expect(contentText(result)).toContain("123");
  });

  it("filesystem_chown surfaces a failed job as an error, not success", async () => {
    const registry = buildRegistry(
      stubClient({
        call: () => 124,
        waitForJob: async () => {
          throw new Error("Job 124 failed: chown: /mnt/tank/missing: No such file or directory");
        },
      })
    );

    await expect(
      registry.execute("filesystem", "filesystem_chown", {
        path: "/mnt/tank/missing",
        uid: 1000,
        confirm: true,
      })
    ).rejects.toThrow("Job 124 failed");
  });

  it("filesystem_set_permissions waits for the job", async () => {
    const registry = buildRegistry(
      stubClient({
        call: () => 125,
        waitForJob: async (jobId) => ({ id: jobId, state: "SUCCESS", result: { done: true } }),
      })
    );

    const result = await registry.execute("filesystem", "filesystem_set_permissions", {
      path: "/mnt/tank/data",
      mode: "755",
      confirm: true,
    });

    expect(contentText(result)).toContain("done");
  });

  it("non-numeric return passes through without a job wait", async () => {
    const registry = buildRegistry(
      stubClient({
        call: () => ({ applied: true }), // sync-style return — no job id
      })
    );

    const result = await registry.execute("filesystem", "filesystem_chown", {
      path: "/mnt/tank/data",
      uid: 1000,
      confirm: true,
    });

    expect(contentText(result)).toContain("applied");
  });
});

describe("Post-write verification", () => {
  it("filesystem_mkdir errors when the directory is absent after a successful mkdir", async () => {
    const registry = buildRegistry(
      stubClient({
        call: (method) => {
          if (method === "filesystem.mkdir") return { path: "/mnt/tank/newdir" };
          throw new Error("TrueNAS API error: [ENOENT] Path /mnt/tank/newdir not found (code 2)");
        },
      })
    );

    await expect(
      registry.execute("filesystem", "filesystem_mkdir", {
        path: "/mnt/tank/newdir",
        confirm: true,
      })
    ).rejects.toThrow("post-write verification failed");
  });

  it("filesystem_mkdir succeeds when the stat-back confirms the directory", async () => {
    const methods: string[] = [];
    const registry = buildRegistry(
      stubClient({
        call: (method) => {
          methods.push(method);
          if (method === "filesystem.mkdir") return { path: "/mnt/tank/newdir" };
          return { type: "DIRECTORY" };
        },
      })
    );

    const result = await registry.execute("filesystem", "filesystem_mkdir", {
      path: "/mnt/tank/newdir",
      confirm: true,
    });

    expect(methods).toEqual(["filesystem.mkdir", "filesystem.stat"]);
    expect(contentText(result)).toContain("/mnt/tank/newdir");
  });

  it("dataset_create warns when the mountpoint is missing after create", async () => {
    const registry = buildRegistry(
      stubClient({
        call: (method) => {
          if (method === "pool.dataset.create") {
            return { name: "tank/apps/x", mountpoint: "/mnt/tank/apps/x" };
          }
          throw new Error("TrueNAS API error: [ENOENT] Path /mnt/tank/apps/x not found (code 2)");
        },
      })
    );

    const result = await registry.execute("storage", "dataset_create", { name: "tank/apps/x" });
    const text = contentText(result);
    expect(text).toContain("tank/apps/x");
    expect(text).toContain("WARNING: dataset was created but its mountpoint");
  });

  it("dataset_create reports clean success when the mountpoint exists", async () => {
    const registry = buildRegistry(
      stubClient({
        call: (method) => {
          if (method === "pool.dataset.create") {
            return { name: "tank/apps/x", mountpoint: "/mnt/tank/apps/x" };
          }
          return { type: "DIRECTORY" };
        },
      })
    );

    const result = await registry.execute("storage", "dataset_create", { name: "tank/apps/x" });
    expect(contentText(result)).not.toContain("WARNING");
  });
});
