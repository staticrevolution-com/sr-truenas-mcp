import { describe, it, expect } from "vitest";
import { validateTrueNASPath } from "../validation.js";

describe("validateTrueNASPath", () => {
  it("accepts valid /mnt/ paths", () => {
    expect(validateTrueNASPath("/mnt/tank/data")).toBe("/mnt/tank/data");
    expect(validateTrueNASPath("/mnt/pool/dataset/folder")).toBe("/mnt/pool/dataset/folder");
  });

  it("normalizes multiple slashes", () => {
    expect(validateTrueNASPath("/mnt//tank///data")).toBe("/mnt/tank/data");
  });

  it("rejects path traversal with ..", () => {
    expect(() => validateTrueNASPath("/mnt/tank/../etc/passwd")).toThrow("..");
    expect(() => validateTrueNASPath("/mnt/tank/data/../../etc")).toThrow("..");
    expect(() => validateTrueNASPath("../../etc/passwd")).toThrow("..");
  });

  it("rejects paths not starting with /mnt/", () => {
    expect(() => validateTrueNASPath("/etc/shadow")).toThrow("/mnt/");
    expect(() => validateTrueNASPath("/var/log")).toThrow("/mnt/");
    expect(() => validateTrueNASPath("/root/.ssh")).toThrow("/mnt/");
    expect(() => validateTrueNASPath("mnt/tank")).toThrow("/mnt/");
  });

  it("rejects null bytes", () => {
    expect(() => validateTrueNASPath("/mnt/tank/data\0")).toThrow("null bytes");
    expect(() => validateTrueNASPath("/mnt/tank\0/data")).toThrow("null bytes");
  });

  it("rejects empty or non-string input", () => {
    expect(() => validateTrueNASPath("")).toThrow("required");
    expect(() => validateTrueNASPath(null as unknown as string)).toThrow("required");
    expect(() => validateTrueNASPath(undefined as unknown as string)).toThrow("required");
  });
});
