import { describe, it, expect } from "vitest";
import {
  filterSensitiveFields,
  isSensitiveKey,
  SENSITIVE_KEYS,
  SUFFIX_PATTERNS,
  NEVER_REDACT,
} from "../filters.js";

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

describe("filterSensitiveFields — new exact keys (v1.0.1)", () => {
  it.each([
    "auth_token",
    "reconnect_token",
    "otp_token",
    "peersecret",
    "passkey",
    "stored_key",
    "application_credential_secret",
    "access_key_id",
    "secret_access_key",
    "host_key",
    "client_key",
    "server_key",
    "oauth_client_secret",
    "bind_password",
    "bindpw",
    "client_secret",
    "mfa_secret",
    "recovery_code",
    "recovery_codes",
    "salt",
    "iv",
    "nonce",
    "signature",
  ])("redacts exact key %s", (key) => {
    const data = { [key]: "value" };
    const result = filterSensitiveFields(data) as Record<string, unknown>;
    expect(result[key]).toBe("[REDACTED]");
  });
});

describe("filterSensitiveFields — suffix patterns", () => {
  it.each([
    ["certificate_private_key", "PEM..."],
    ["ssh_private_key", "PEM..."],
    ["oauth_token", "abc"],
    ["refresh_token", "abc"],
    ["service_account_credentials", "{}"],
    ["custom_passphrase", "p"],
    ["custom_passwd", "p"],
    ["api_password", "p"],
    ["random_secret", "s"],
    ["random_seed", "s"],
    ["unlock_pin", "1234"],
  ])("redacts %s via suffix match", (key, value) => {
    const data = { [key]: value };
    const result = filterSensitiveFields(data) as Record<string, unknown>;
    expect(result[key]).toBe("[REDACTED]");
  });

  it("does NOT redact bare *_key fields (suffix _key$ is intentionally absent)", () => {
    const data = {
      foo_key: "abc",
      bar_key: "def",
      device_key: "xyz", // also in NEVER_REDACT for defense
    };
    const result = filterSensitiveFields(data) as Record<string, unknown>;
    expect(result.foo_key).toBe("abc");
    expect(result.bar_key).toBe("def");
    expect(result.device_key).toBe("xyz");
  });
});

describe("filterSensitiveFields — NEVER_REDACT allowlist", () => {
  it.each([
    ["id_key", "abc123"],
    ["pool_key", "tank-key"],
    ["vdev_key", "v1"],
    ["device_key", "d1"],
    ["password_disabled", false],
    ["password_history", null],
    ["password_age", 30],
    ["password_change_required", false],
    ["min_password_length", 12],
    ["max_password_age", 90],
    ["last_password_change", 1700000000],
    ["ssh_password_enabled", true],
    ["public_key", "ssh-rsa AAAA..."],
    ["sshpubkey", "ssh-rsa AAAA..."],
    ["authorized_keys", "ssh-rsa AAAA..."],
  ])("preserves %s through allowlist", (key, value) => {
    const data = { [key]: value };
    const result = filterSensitiveFields(data) as Record<string, unknown>;
    expect(result[key]).toEqual(value);
  });

  it("allowlist wins over exact match", () => {
    expect(NEVER_REDACT.has("public_key")).toBe(true);
    expect(isSensitiveKey("public_key")).toBe(false);
  });
});

describe("filterSensitiveFields — user.query fixture (regression)", () => {
  // Shape derived from docs/truenas-v27.0.0-docs/api_methods_user.query.html.
  // Fields chosen to exercise sensitive (unixhash/smbhash), allowlisted
  // (sshpubkey, password_*), and identifier (uid, username) handling.
  const userQueryResponse = [
    {
      id: 1,
      uid: 0,
      username: "root",
      home: "/root",
      shell: "/usr/bin/bash",
      full_name: "root",
      email: null,
      builtin: true,
      smb: true,
      group: { id: 41, gid: 0, name: "root" },
      groups: [],
      // sensitive
      unixhash: "$6$rounds=...$xxxxxxxx",
      smbhash: "ROOT:0:ABCDEF...",
      // policy descriptors (allowlisted)
      password_disabled: false,
      password_history: null,
      last_password_change: 1700000000,
      password_age: 30,
      password_change_required: false,
      ssh_password_enabled: true,
      // public key material (allowlisted)
      sshpubkey: "ssh-rsa AAAAB3NzaC1yc2E...",
      // identifiers
      sudo_commands: [],
      sudo_commands_nopasswd: [],
      api_keys: [42],
      twofactor_auth_configured: false,
      locked: false,
      immutable: true,
      local: true,
      sid: null,
      roles: [],
    },
  ];

  it("redacts hashes, preserves public-key + policy fields", () => {
    const filtered = filterSensitiveFields(userQueryResponse) as Array<Record<string, unknown>>;
    const u = filtered[0];

    expect(u.unixhash).toBe("[REDACTED]");
    expect(u.smbhash).toBe("[REDACTED]");

    expect(u.sshpubkey).toBe("ssh-rsa AAAAB3NzaC1yc2E...");
    expect(u.password_disabled).toBe(false);
    expect(u.password_history).toBeNull();
    expect(u.last_password_change).toBe(1700000000);
    expect(u.password_age).toBe(30);
    expect(u.password_change_required).toBe(false);
    expect(u.ssh_password_enabled).toBe(true);

    expect(u.username).toBe("root");
    expect(u.uid).toBe(0);
  });

  it("leaves no plausibly-sensitive string field exposed", () => {
    const filtered = filterSensitiveFields(userQueryResponse) as Array<Record<string, unknown>>;
    const u = filtered[0];

    // Any string-typed field whose name matches a sensitive suffix or is a
    // known-sensitive exact key MUST be either redacted or allowlisted.
    const suspectSuffix = /(_password|_passwd|_passphrase|_token|_secret|_seed|_private_key|_credentials|_pin)$/i;
    for (const [key, value] of Object.entries(u)) {
      if (typeof value !== "string") continue;
      const isExact = SENSITIVE_KEYS.has(key.toLowerCase());
      const isSuffix = suspectSuffix.test(key);
      const isAllowed = NEVER_REDACT.has(key.toLowerCase());
      if ((isExact || isSuffix) && !isAllowed) {
        expect(value, `${key} should be redacted`).toBe("[REDACTED]");
      }
    }
  });
});

describe("isSensitiveKey", () => {
  it("returns true for exact matches", () => {
    expect(isSensitiveKey("password")).toBe(true);
    expect(isSensitiveKey("Password")).toBe(true);
    expect(isSensitiveKey("salt")).toBe(true);
  });

  it("returns true for suffix matches", () => {
    expect(isSensitiveKey("custom_token")).toBe(true);
    expect(isSensitiveKey("user_passphrase")).toBe(true);
  });

  it("returns false for allowlist hits", () => {
    expect(isSensitiveKey("public_key")).toBe(false);
    expect(isSensitiveKey("sshpubkey")).toBe(false);
    expect(isSensitiveKey("password_disabled")).toBe(false);
  });

  it("returns false for non-matching keys", () => {
    expect(isSensitiveKey("name")).toBe(false);
    expect(isSensitiveKey("id")).toBe(false);
    expect(isSensitiveKey("foo_key")).toBe(false); // _key$ not a suffix rule
  });
});

describe("filter constants — counts (sanity)", () => {
  // These assertions guard against accidental shrinkage. If you're
  // intentionally adding/removing patterns, update the lower bound here
  // *and* the count claimed in CLAUDE.md / PLAN.md (see plan item A5/B7).
  it("has at least the v1.0.1 baseline coverage", () => {
    expect(SENSITIVE_KEYS.size).toBeGreaterThanOrEqual(50);
    expect(SUFFIX_PATTERNS.length).toBeGreaterThanOrEqual(9);
    expect(NEVER_REDACT.size).toBeGreaterThanOrEqual(13);
  });
});
