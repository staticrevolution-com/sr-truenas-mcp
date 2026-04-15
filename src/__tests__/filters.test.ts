import { describe, it, expect } from "vitest";
import { filterSensitiveFields } from "../filters.js";

describe("filterSensitiveFields", () => {
  it("redacts known sensitive keys", () => {
    const data = {
      name: "admin",
      password: "secret123",
      email: "admin@test.com",
    };
    expect(filterSensitiveFields(data)).toEqual({
      name: "admin",
      password: "[REDACTED]",
      email: "admin@test.com",
    });
  });

  it("redacts all sensitive field variants", () => {
    const data = {
      privatekey: "key1",
      private_key: "key2",
      pass: "pass1",
      passwd: "pass2",
      monpwd: "pwd1",
      encryption_key: "enc1",
      secret: "sec1",
      secretseed: "seed1",
      secret_seed: "seed2",
      v3_password: "v3p",
      v3_privpassphrase: "v3pp",
    };
    const result = filterSensitiveFields(data) as Record<string, unknown>;
    for (const key of Object.keys(data)) {
      expect(result[key], `Expected ${key} to be redacted`).toBe("[REDACTED]");
    }
  });

  it("handles case-insensitive matching", () => {
    const data = { Password: "secret", SECRET: "value" };
    const result = filterSensitiveFields(data) as Record<string, unknown>;
    expect(result.Password).toBe("[REDACTED]");
    expect(result.SECRET).toBe("[REDACTED]");
  });

  it("preserves non-sensitive fields", () => {
    const data = { name: "pool1", id: 42, enabled: true };
    expect(filterSensitiveFields(data)).toEqual(data);
  });

  it("handles nested objects", () => {
    const data = {
      user: {
        name: "admin",
        password: "secret",
        profile: { secret: "nested-secret", bio: "hello" },
      },
    };
    expect(filterSensitiveFields(data)).toEqual({
      user: {
        name: "admin",
        password: "[REDACTED]",
        profile: { secret: "[REDACTED]", bio: "hello" },
      },
    });
  });

  it("handles arrays", () => {
    const data = [
      { name: "user1", password: "pass1" },
      { name: "user2", password: "pass2" },
    ];
    expect(filterSensitiveFields(data)).toEqual([
      { name: "user1", password: "[REDACTED]" },
      { name: "user2", password: "[REDACTED]" },
    ]);
  });

  it("passes primitives through unchanged", () => {
    expect(filterSensitiveFields("hello")).toBe("hello");
    expect(filterSensitiveFields(42)).toBe(42);
    expect(filterSensitiveFields(true)).toBe(true);
    expect(filterSensitiveFields(null)).toBe(null);
    expect(filterSensitiveFields(undefined)).toBe(undefined);
  });

  it("preserves null/undefined values in sensitive fields", () => {
    const data = { password: null, secret: undefined };
    expect(filterSensitiveFields(data)).toEqual({ password: null, secret: undefined });
  });
});
