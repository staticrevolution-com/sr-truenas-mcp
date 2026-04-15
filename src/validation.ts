/**
 * Path validation for TrueNAS filesystem operations.
 * Prevents path traversal attacks and access outside /mnt/.
 */

/**
 * Validate and normalize a TrueNAS filesystem path.
 * Must start with /mnt/, no .., no null bytes.
 * Returns the normalized path or throws an error.
 */
export function validateTrueNASPath(path: string): string {
  if (!path || typeof path !== "string") {
    throw new Error("Path is required and must be a string");
  }

  // Reject null bytes
  if (path.includes("\0")) {
    throw new Error("Path must not contain null bytes");
  }

  // Normalize: collapse multiple slashes, resolve . but NOT ..
  const normalized = path.replace(/\/+/g, "/").replace(/\/\.$/, "").replace(/\/\.\//g, "/");

  // Reject path traversal
  if (normalized.includes("..")) {
    throw new Error("Path must not contain '..' (path traversal)");
  }

  // Must start with /mnt/
  if (!normalized.startsWith("/mnt/")) {
    throw new Error("Path must start with /mnt/ — TrueNAS filesystem operations are restricted to mounted pools");
  }

  return normalized;
}
