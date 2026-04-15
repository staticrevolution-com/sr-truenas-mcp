/**
 * Response filtering — redact sensitive fields from TrueNAS API responses
 * before returning them to the MCP client.
 */

const SENSITIVE_KEYS = new Set([
  // Passwords
  "pass",
  "password",
  "passwd",
  "new_password",
  "old_password",
  "monpwd",
  "v3_password",
  "v3_privpassphrase",
  "binddn_password",
  "encryption_password",
  // Keys
  "privatekey",
  "private_key",
  "encryption_key",
  "key",
  "api_key",
  "api_token",
  "access_key",
  "secret_key",
  "aws_secret_access_key",
  "application_secret",
  // Secrets & tokens
  "secret",
  "secretseed",
  "secret_seed",
  "token",
  "bot_token",
  "digitalocean_token",
  "routing_key",
  "webhook_url",
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

const REDACTED = "[REDACTED]";

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
      if (SENSITIVE_KEYS.has(key.toLowerCase()) && value !== null && value !== undefined) {
        result[key] = REDACTED;
      } else {
        result[key] = filterSensitiveFields(value);
      }
    }
    return result;
  }

  return data;
}
