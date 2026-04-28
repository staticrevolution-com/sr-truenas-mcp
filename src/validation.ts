/**
 * Path / dataset-name validation for TrueNAS operations.
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

/**
 * Validate a TrueNAS dataset name (e.g. "tank/data", "pool/datasets/mydata").
 *
 * Dataset names are NOT filesystem paths — they must not start with `/mnt/`.
 * They are passed to ZFS-side methods (`pool.dataset.create`, `replication.create`,
 * `pool.snapshot.*`) where path-traversal would target other datasets, not the
 * host filesystem. Charset matches the documented ZFS dataset name grammar.
 *
 * Rules:
 *   - Required, non-empty string
 *   - Max length 255 (ZFS limit)
 *   - No null bytes
 *   - No `..` substring (traversal)
 *   - Allowed chars: a-z, A-Z, 0-9, `_`, `-`, `:`, `.`, `/`
 *
 * Returns the (unmodified) name or throws.
 */
export function validateDatasetName(name: string): string {
  if (!name || typeof name !== "string") {
    throw new Error("Dataset name is required and must be a string");
  }
  if (name.includes("\0")) {
    throw new Error("Dataset name must not contain null bytes");
  }
  if (name.length > 255) {
    throw new Error("Dataset name must not exceed 255 characters");
  }
  if (name.includes("..")) {
    throw new Error("Dataset name must not contain '..' (path traversal)");
  }
  if (!/^[a-zA-Z0-9._:/-]+$/.test(name)) {
    throw new Error(
      "Dataset name may only contain alphanumerics and the characters _, -, :, ., /",
    );
  }
  return name;
}
