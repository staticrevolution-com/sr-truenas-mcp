/**
 * Response filtering — redact sensitive fields from TrueNAS API responses
 * before returning them to the MCP client.
 *
 * Matching is layered: NEVER_REDACT > exact key > suffix pattern. All
 * comparisons are case-insensitive. Public-key material and password-policy
 * descriptors are explicitly allowlisted so legitimate reads (e.g. user.query
 * with sshpubkey, last_password_change) keep working.
 */

export const SENSITIVE_KEYS = new Set<string>([
  // Passwords (exact)
  "pass",
  "password",
  "passwd",
  "new_password",
  "old_password",
  "monpwd",
  "v3_password",
  "v3_privpassphrase",
  "binddn_password",
  "bind_password",
  "bindpw",
  "encryption_password",
  // Keys (exact). Suffix /_key$/ is deliberately not used — too many benign
  // *_key fields (id_key, pool_key, vdev_key, routing_key already-named).
  "privatekey",
  "private_key",
  "encryption_key",
  "key",
  "api_key",
  "api_token",
  "access_key",
  "access_key_id",
  "secret_key",
  "secret_access_key",
  "aws_secret_access_key",
  "application_secret",
  "application_credential_secret",
  "host_key",
  "client_key",
  "server_key",
  "stored_key",
  "passkey",
  "routing_key",
  // Secrets & tokens (exact)
  "secret",
  "secretseed",
  "secret_seed",
  "peersecret",
  "client_secret",
  "oauth_client_secret",
  "mfa_secret",
  "token",
  "auth_token",
  "reconnect_token",
  "otp_token",
  "bot_token",
  "digitalocean_token",
  "webhook_url",
  // Cryptographic material / one-time codes (exact)
  "salt",
  "iv",
  "nonce",
  "signature",
  "recovery_code",
  "recovery_codes",
  // Password hashes
  "unixhash",
  "smbhash",
  "nt_password",
  "lm_password",
  // SNMP
  "community",
  // Passphrase
  "passphrase",
]);

/**
 * Suffix patterns catch new/unknown sensitive fields without requiring an
 * exact-list update. Anchored at end with leading underscore to avoid
 * over-matching (e.g. `_key$` is intentionally absent — id_key, pool_key,
 * vdev_key are not secrets).
 */
export const SUFFIX_PATTERNS: RegExp[] = [
  /_password$/i,
  /_passwd$/i,
  /_passphrase$/i,
  /_token$/i,
  /_secret$/i,
  /_seed$/i,
  /_private_key$/i,
  /_credentials$/i,
  /_pin$/i,
];

/**
 * Allowlist — never redact, even if matched by exact set or suffix pattern.
 * Two categories:
 *   1. Benign *_key fields (defensive — _key$ is already not a suffix rule,
 *      but listed here in case a future rule change affects them).
 *   2. Password-policy descriptors and public-key material that surface in
 *      user.query / sshkey / cert reads. These are not secrets — public keys
 *      are access-control-relevant but designed to be shareable.
 * NEVER_REDACT wins over both EXACT and SUFFIX matches.
 */
export const NEVER_REDACT = new Set<string>([
  // Benign *_key identifiers
  "id_key",
  "pool_key",
  "vdev_key",
  "device_key",
  // Password-policy descriptors (booleans, dates, ints — not secrets)
  "password_disabled",
  "password_history",
  "password_age",
  "password_change_required",
  "min_password_length",
  "max_password_age",
  "last_password_change",
  "ssh_password_enabled",
  // Public key material (access-control-relevant, not secret)
  "public_key",
  "sshpubkey",
  "authorized_keys",
]);

const REDACTED = "[REDACTED]";

/**
 * Decide whether a key name should have its value redacted.
 * Order: NEVER_REDACT > exact match > suffix pattern.
 */
export function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (NEVER_REDACT.has(lower)) return false;
  if (SENSITIVE_KEYS.has(lower)) return true;
  for (const pattern of SUFFIX_PATTERNS) {
    if (pattern.test(lower)) return true;
  }
  return false;
}

/**
 * Deep recursive redaction of sensitive fields in API response data.
 * Replaces values of known sensitive keys with "[REDACTED]".
 * Handles objects, arrays, and nested structures. Primitives pass through unchanged.
 */
export function filterSensitiveFields(data: unknown): unknown {
  if (data === null || data === undefined) return data;

  if (Array.isArray(data)) {
    return data.map(filterSensitiveFields);
  }

  if (typeof data === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (isSensitiveKey(key) && value !== null && value !== undefined) {
        result[key] = REDACTED;
      } else {
        result[key] = filterSensitiveFields(value);
      }
    }
    return result;
  }

  return data;
}
