import { describe, it, expect } from "vitest";
import { TrueNASClient } from "../client.js";
import { buildRegistry } from "../tools/index.js";

/**
 * Upstream payload-shaping tests for VM actions.
 *
 * The dispatcher exposes a flat, ergonomic schema (top-level `dtype`,
 * underscore-tolerant `cpu_mode`), but several fields must be reconciled to the
 * shape the TrueNAS middleware actually expects before the call. These pin that
 * mapping:
 *   - vm_device_create/update fold the top-level `dtype` into `attributes`
 *     (current middleware requires `attributes.dtype` and rejects top-level
 *     `dtype`).
 *   - vm_create/update normalize an underscore `cpu_mode` to the hyphenated
 *     API enum, and reject VM names with disallowed characters before any call.
 */
function makeSpyRegistry() {
  const client = new TrueNASClient({ baseUrl: "http://stub", apiKey: "stub", verifySsl: true });
  const calls: Array<{ method: string; params: unknown[] }> = [];
  // Replace the real WebSocket round-trip with a capture stub.
  (client as unknown as { call: TrueNASClient["call"] }).call = (async (
    method: string,
    params: unknown[] = [],
  ) => {
    calls.push({ method, params });
    return { id: 1 };
  }) as TrueNASClient["call"];
  return { registry: buildRegistry(client), calls };
}

describe("VM device payload shaping", () => {
  it("vm_device_create folds top-level dtype into attributes and sends no top-level dtype", async () => {
    const { registry, calls } = makeSpyRegistry();
    await registry.execute("vm", "vm_device_create", {
      vm: 9,
      dtype: "DISK",
      attributes: { path: "/dev/zvol/data-pool/charm-workspaces", type: "VIRTIO" },
      order: 1001,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("vm.device.create");
    const body = calls[0].params[0] as Record<string, unknown>;
    expect("dtype" in body).toBe(false);
    expect(body.vm).toBe(9);
    expect(body.order).toBe(1001);
    const attributes = body.attributes as Record<string, unknown>;
    expect(attributes.dtype).toBe("DISK");
    expect(attributes.path).toBe("/dev/zvol/data-pool/charm-workspaces");
    expect(attributes.type).toBe("VIRTIO");
  });

  it("vm_device_create synthesizes attributes when none are provided", async () => {
    const { registry, calls } = makeSpyRegistry();
    await registry.execute("vm", "vm_device_create", { vm: 9, dtype: "DISPLAY" });

    const body = calls[0].params[0] as Record<string, unknown>;
    expect("dtype" in body).toBe(false);
    expect((body.attributes as Record<string, unknown>).dtype).toBe("DISPLAY");
  });

  it("vm_device_create lets the validated top-level dtype win over a stray nested dtype", async () => {
    const { registry, calls } = makeSpyRegistry();
    await registry.execute("vm", "vm_device_create", {
      vm: 9,
      dtype: "DISK",
      attributes: { dtype: "CDROM", path: "/mnt/data-pool/x" },
    });

    const attributes = (calls[0].params[0] as Record<string, unknown>).attributes as Record<string, unknown>;
    expect(attributes.dtype).toBe("DISK");
  });

  it("vm_device_update nests dtype into attributes and sends (id, body) with no top-level dtype", async () => {
    const { registry, calls } = makeSpyRegistry();
    await registry.execute("vm", "vm_device_update", {
      id: 42,
      dtype: "DISK",
      attributes: { path: "/dev/zvol/data-pool/x", type: "AHCI" },
    });

    expect(calls[0].method).toBe("vm.device.update");
    expect(calls[0].params[0]).toBe(42);
    const body = calls[0].params[1] as Record<string, unknown>;
    expect("dtype" in body).toBe(false);
    const attributes = body.attributes as Record<string, unknown>;
    expect(attributes.dtype).toBe("DISK");
    expect(attributes.type).toBe("AHCI");
  });

  it("vm_device_update leaves attributes untouched when only order changes", async () => {
    const { registry, calls } = makeSpyRegistry();
    await registry.execute("vm", "vm_device_update", { id: 42, order: 5 });

    const body = calls[0].params[1] as Record<string, unknown>;
    expect("attributes" in body).toBe(false);
    expect(body.order).toBe(5);
  });
});

describe("VM create discovery / normalization", () => {
  it("normalizes an underscore cpu_mode to the hyphenated API form", async () => {
    const { registry, calls } = makeSpyRegistry();
    await registry.execute("vm", "vm_create", {
      name: "charmworkspaces",
      memory: 8192,
      cpu_mode: "HOST_PASSTHROUGH",
    });

    expect((calls[0].params[0] as Record<string, unknown>).cpu_mode).toBe("HOST-PASSTHROUGH");
  });

  it("passes a correctly hyphenated cpu_mode through unchanged", async () => {
    const { registry, calls } = makeSpyRegistry();
    await registry.execute("vm", "vm_create", {
      name: "vm2",
      memory: 4096,
      cpu_mode: "HOST-MODEL",
    });

    expect((calls[0].params[0] as Record<string, unknown>).cpu_mode).toBe("HOST-MODEL");
  });

  it("rejects a VM name with a hyphen before any upstream call", async () => {
    const { registry, calls } = makeSpyRegistry();
    const result = await registry.execute("vm", "vm_create", {
      name: "charm-workspaces",
      memory: 4096,
    });

    expect((result as { error?: string }).error).toMatch(/name/i);
    expect(calls).toHaveLength(0);
  });

  it("accepts a VM name with underscores", async () => {
    const { registry, calls } = makeSpyRegistry();
    await registry.execute("vm", "vm_create", { name: "charm_workspaces", memory: 4096 });

    expect(calls).toHaveLength(1);
    expect((calls[0].params[0] as Record<string, unknown>).name).toBe("charm_workspaces");
  });
});
