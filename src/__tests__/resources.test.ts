import { describe, it, expect } from "vitest";
import { gatherLabelled } from "../resources.js";

describe("gatherLabelled (A6)", () => {
  it("merges all fulfilled values without _errors", async () => {
    const out = await gatherLabelled([
      ["smb", Promise.resolve([{ id: 1 }])],
      ["nfs", Promise.resolve([{ id: 2 }])],
      ["iscsi_targets", Promise.resolve([])],
    ]);
    expect(out).toEqual({
      smb: [{ id: 1 }],
      nfs: [{ id: 2 }],
      iscsi_targets: [],
    });
    expect(out).not.toHaveProperty("_errors");
  });

  it("nulls a rejected source and records a single _errors entry", async () => {
    const out = await gatherLabelled([
      ["smb", Promise.resolve([{ id: 1 }])],
      ["nfs", Promise.reject(new Error("nfs daemon down"))],
      ["iscsi_targets", Promise.resolve([])],
    ]);
    expect(out.smb).toEqual([{ id: 1 }]);
    expect(out.nfs).toBeNull();
    expect(out.iscsi_targets).toEqual([]);
    expect(out._errors).toEqual([{ source: "nfs", error: "nfs daemon down" }]);
  });

  it("collects every error when all calls reject", async () => {
    const out = await gatherLabelled([
      ["smb", Promise.reject(new Error("smb down"))],
      ["nfs", Promise.reject(new Error("nfs down"))],
      ["iscsi_targets", Promise.reject(new Error("iscsi down"))],
    ]);
    expect(out.smb).toBeNull();
    expect(out.nfs).toBeNull();
    expect(out.iscsi_targets).toBeNull();
    expect(out._errors).toHaveLength(3);
    expect(out._errors).toEqual([
      { source: "smb", error: "smb down" },
      { source: "nfs", error: "nfs down" },
      { source: "iscsi_targets", error: "iscsi down" },
    ]);
  });

  it("stringifies non-Error rejection reasons", async () => {
    const out = await gatherLabelled([
      ["smb", Promise.reject("plain string failure")],
      ["nfs", Promise.resolve([])],
      ["iscsi_targets", Promise.resolve([])],
    ]);
    expect(out._errors).toEqual([{ source: "smb", error: "plain string failure" }]);
  });

  it("preserves call order in _errors", async () => {
    const out = await gatherLabelled([
      ["a", Promise.reject(new Error("a"))],
      ["b", Promise.resolve(1)],
      ["c", Promise.reject(new Error("c"))],
    ]);
    expect(out._errors?.map((e) => e.source)).toEqual(["a", "c"]);
  });
});
