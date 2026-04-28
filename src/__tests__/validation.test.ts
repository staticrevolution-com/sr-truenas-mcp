import { describe, it, expect } from "vitest";
import { validateTrueNASPath, validateDatasetName } from "../validation.js";

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

describe("validateDatasetName", () => {
  it("accepts simple dataset names", () => {
    expect(validateDatasetName("tank")).toBe("tank");
    expect(validateDatasetName("tank/data")).toBe("tank/data");
    expect(validateDatasetName("pool/datasets/mydata")).toBe("pool/datasets/mydata");
  });

  it("accepts allowed special characters", () => {
    expect(validateDatasetName("tank/my_data")).toBe("tank/my_data");
    expect(validateDatasetName("tank/my-data")).toBe("tank/my-data");
    expect(validateDatasetName("tank/snap:1")).toBe("tank/snap:1");
    expect(validateDatasetName("tank/v1.0")).toBe("tank/v1.0");
  });

  it("rejects path traversal", () => {
    expect(() => validateDatasetName("tank/../other")).toThrow("..");
    expect(() => validateDatasetName("../tank")).toThrow("..");
    expect(() => validateDatasetName("..")).toThrow("..");
    expect(() => validateDatasetName("tank/..")).toThrow("..");
  });

  it("rejects null bytes", () => {
    expect(() => validateDatasetName("tank\0/data")).toThrow("null bytes");
    expect(() => validateDatasetName("tank/data\0")).toThrow("null bytes");
  });

  it("rejects empty or non-string input", () => {
    expect(() => validateDatasetName("")).toThrow("required");
    expect(() => validateDatasetName(null as unknown as string)).toThrow("required");
    expect(() => validateDatasetName(undefined as unknown as string)).toThrow("required");
  });

  it("rejects names exceeding 255 characters", () => {
    const longName = "tank/" + "a".repeat(251); // 256 total
    expect(() => validateDatasetName(longName)).toThrow("255");
    const okName = "tank/" + "a".repeat(250); // 255 total
    expect(validateDatasetName(okName)).toBe(okName);
  });

  it("rejects disallowed characters", () => {
    expect(() => validateDatasetName("tank/data with spaces")).toThrow("alphanumerics");
    expect(() => validateDatasetName("tank/data;rm -rf")).toThrow("alphanumerics");
    expect(() => validateDatasetName("tank/data*")).toThrow("alphanumerics");
    expect(() => validateDatasetName("tank/data?foo")).toThrow("alphanumerics");
    expect(() => validateDatasetName("tank/$INJECTED")).toThrow("alphanumerics");
    expect(() => validateDatasetName("tank/data\nfoo")).toThrow("alphanumerics");
  });
});
