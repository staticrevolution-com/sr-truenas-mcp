/**
 * Response filtering — redact sensitive fields from TrueNAS API responses
 * before returning them to the MCP client.
 */

const SENSITIVE_KEYS = new Set([
  "privatekey",
  "private_key",
  "pass",
  "password",
  "passwd",
  "monpwd",
  "encryption_key",
  "secret",
  "secretseed",
  "secret_seed",
  "v3_password",
  "v3_privpassphrase",
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
