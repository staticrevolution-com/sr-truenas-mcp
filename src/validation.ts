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

/**
 * The home directory TrueNAS itself assigns when `home` is omitted. Service
 * accounts and SMB-only accounts keep this value — it is an empty, immutable
 * directory that deliberately lives outside `/mnt/`.
 *
 * Mirrors `DEFAULT_HOME_PATH` in the middleware
 * (`plugins/account_/constants.py`).
 */
export const DEFAULT_HOME_PATH = "/var/empty";

/**
 * Validate a user account's `home` directory.
 *
 * This is deliberately NOT `validateTrueNASPath`. That validator is correct for
 * dataset and share paths, which must live under a mounted pool — but applying
 * it to `home` rejected `/var/empty`, i.e. the value TrueNAS itself stores when
 * the caller omits `home` entirely. Creating a service account therefore
 * succeeded only by *not* naming the home directory the product was about to
 * use anyway.
 *
 * The rule enforced here is the middleware's own
 * (`account.validate_homedir_path`): the path must be `/var/empty`, or an
 * absolute path under `/mnt/` that is not the root of `/mnt` itself. Colons are
 * rejected upstream too. Traversal and NUL checks are kept from
 * `validateTrueNASPath`.
 *
 * Returns the (normalized) home path or throws.
 */
export function validateHomeDirectory(home: string): string {
  if (!home || typeof home !== "string") {
    throw new Error("Home directory is required and must be a string");
  }
  if (home.includes("\0")) {
    throw new Error("Home directory must not contain null bytes");
  }
  if (home === DEFAULT_HOME_PATH) return home;
  if (home.includes(":")) {
    throw new Error('Home directory must not contain colons (":")');
  }

  const normalized = home.replace(/\/+/g, "/").replace(/\/\.$/, "").replace(/\/\.\//g, "/");

  if (normalized.includes("..")) {
    throw new Error("Home directory must not contain '..' (path traversal)");
  }
  if (normalized === "/mnt" || normalized === "/mnt/") {
    throw new Error('Home directory cannot be the root of "/mnt"');
  }
  if (!normalized.startsWith("/mnt/")) {
    throw new Error(
      `Home directory must start with /mnt/ or be "${DEFAULT_HOME_PATH}" (the TrueNAS default for accounts without a home directory)`,
    );
  }
  return normalized;
}
