import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TrueNASClient } from "../client.js";
import { validateDatasetName, validateTrueNASPath } from "../validation.js";

export function register(server: McpServer, client: TrueNASClient): void {
  // ---------------------------------------------------------------------------
  // POOLS
  // ---------------------------------------------------------------------------

  server.tool("pool_list", "List all storage pools", {}, async () => {
    const result = await client.call("pool.query");
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  });

  server.tool(
    "pool_get",
    "Get pool details by ID",
    { id: z.number().describe("Pool ID") },
    async ({ id }) => {
      const result = await client.call("pool.get_instance", [id]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "pool_create",
    "Create a new storage pool (destructive operation — requires confirm)",
    {
      name: z.string().describe("Pool name"),
      topology: z
        .object({
          data: z.array(
            z.object({
              type: z.string().describe("VDEV type: STRIPE, MIRROR, RAIDZ1, RAIDZ2, RAIDZ3"),
              disks: z.array(z.string()).describe("List of disk identifiers"),
            }),
          ),
          log: z
            .array(
              z.object({
                type: z.string(),
                disks: z.array(z.string()),
              }),
            )
            .optional()
            .describe("Log VDEV(s)"),
          cache: z
            .array(
              z.object({
                type: z.string(),
                disks: z.array(z.string()),
              }),
            )
            .optional()
            .describe("Cache VDEV(s)"),
          spare: z
            .array(
              z.object({
                type: z.string(),
                disks: z.array(z.string()),
              }),
            )
            .optional()
            .describe("Spare VDEV(s)"),
          special: z
            .array(
              z.object({
                type: z.string(),
                disks: z.array(z.string()),
              }),
            )
            .optional()
            .describe("Special VDEV(s)"),
          dedup: z
            .array(
              z.object({
                type: z.string(),
                disks: z.array(z.string()),
              }),
            )
            .optional()
            .describe("Dedup VDEV(s)"),
        })
        .describe("Pool topology"),
      encryption: z.boolean().optional().describe("Enable encryption"),
      encryption_options: z
        .object({
          generate_key: z.boolean().optional(),
          key: z.string().optional(),
          passphrase: z.string().optional(),
          algorithm: z.string().optional(),
        })
        .optional()
        .describe("Encryption options"),
      confirm: z.boolean().describe("Must be true to confirm this destructive operation"),
    },
    async ({ name, topology, encryption, encryption_options, confirm }) => {
      if (!confirm) {
        return {
          content: [{ type: "text", text: "Operation not confirmed. Set confirm to true to proceed." }],
        };
      }
      const body: Record<string, unknown> = { name, topology };
      if (encryption !== undefined) body.encryption = encryption;
      if (encryption_options !== undefined) body.encryption_options = encryption_options;
      const result = await client.call("pool.create", [body]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "pool_update",
    "Update pool properties (e.g. autotrim) or add vdevs",
    {
      id: z.number().describe("Pool ID"),
      autotrim: z.boolean().optional().describe("Enable/disable autotrim"),
      topology: z
        .object({
          data: z
            .array(
              z.object({
                type: z.string(),
                disks: z.array(z.string()),
              }),
            )
            .optional(),
          log: z
            .array(z.object({ type: z.string(), disks: z.array(z.string()) }))
            .optional(),
          cache: z
            .array(z.object({ type: z.string(), disks: z.array(z.string()) }))
            .optional(),
          spare: z
            .array(z.object({ type: z.string(), disks: z.array(z.string()) }))
            .optional(),
          special: z
            .array(z.object({ type: z.string(), disks: z.array(z.string()) }))
            .optional(),
          dedup: z
            .array(z.object({ type: z.string(), disks: z.array(z.string()) }))
            .optional(),
        })
        .optional()
        .describe("Topology changes (for adding vdevs)"),
    },
    async ({ id, autotrim, topology }) => {
      const body: Record<string, unknown> = {};
      if (autotrim !== undefined) body.autotrim = autotrim;
      if (topology !== undefined) body.topology = topology;
      const result = await client.call("pool.update", [id, body]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "pool_status",
    "Check pool health and status",
    { id: z.number().describe("Pool ID") },
    async ({ id }) => {
      const result = await client.call("pool.get_instance", [id]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "pool_scrub",
    "Start, stop, or pause a pool scrub",
    {
      name: z.string().describe("Pool name (e.g. 'tank')"),
      action: z.enum(["START", "STOP", "PAUSE"]).describe("Scrub action"),
    },
    async ({ name, action }) => {
      const result = await client.call("pool.scrub.scrub", [name, action]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "pool_export",
    "Export (disconnect) a pool (destructive — requires confirm)",
    {
      id: z.number().describe("Pool ID"),
      cascade: z.boolean().describe("Stop services using the pool"),
      destroy: z.boolean().describe("Destroy data on the pool (DANGEROUS)"),
      confirm: z.boolean().describe("Must be true to confirm this destructive operation"),
    },
    async ({ id, cascade, destroy, confirm }) => {
      if (!confirm) {
        return {
          content: [{ type: "text", text: "Operation not confirmed. Set confirm to true to proceed." }],
        };
      }
      const result = await client.call("pool.export", [id, { cascade, destroy }]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "pool_attachments",
    "Get services and resources attached to a pool",
    { id: z.number().describe("Pool ID") },
    async ({ id }) => {
      const result = await client.call("pool.attachments", [id]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "pool_get_disks",
    "Get list of disks in a pool",
    { id: z.number().describe("Pool ID") },
    async ({ id }) => {
      const result = await client.call("pool.get_disks", [id]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "pool_replace_disk",
    "Replace a disk in a pool (destructive — requires confirm)",
    {
      id: z.number().describe("Pool ID"),
      label: z.string().describe("Label of the disk to replace (VDEV GUID or device name)"),
      disk: z.string().describe("Replacement disk identifier"),
      force: z.boolean().optional().describe("Force replacement"),
      preserve_settings: z.boolean().optional().describe("Preserve disk settings"),
      confirm: z.boolean().describe("Must be true to confirm this destructive operation"),
    },
    async ({ id, label, disk, force, preserve_settings, confirm }) => {
      if (!confirm) {
        return {
          content: [{ type: "text", text: "Operation not confirmed. Set confirm to true to proceed." }],
        };
      }
      const body: Record<string, unknown> = { label, disk };
      if (force !== undefined) body.force = force;
      if (preserve_settings !== undefined) body.preserve_settings = preserve_settings;
      const result = await client.call("pool.replace", [id, body]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ---------------------------------------------------------------------------
  // DATASETS
  // ---------------------------------------------------------------------------

  server.tool(
    "dataset_list",
    "List all datasets, optionally filtered by pool name",
    {
      pool: z.string().optional().describe("Filter by pool name (e.g. 'tank')"),
    },
    async ({ pool }) => {
      const result = await client.call("pool.dataset.query");
      let datasets = Array.isArray(result) ? result : [result];
      if (pool) {
        datasets = datasets.filter(
          (ds: any) => ds.pool_name === pool || ds.name?.startsWith(`${pool}/`) || ds.name === pool,
        );
      }
      return { content: [{ type: "text", text: JSON.stringify(datasets, null, 2) }] };
    },
  );

  server.tool(
    "dataset_get",
    "Get dataset details by name (e.g. 'tank/data')",
    { id: z.string().describe("Dataset name/path (e.g. 'tank/data')") },
    async ({ id }) => {
      const result = await client.call("pool.dataset.get_instance", [id]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "dataset_create",
    "Create a new dataset or zvol",
    {
      name: z.string().describe("Full dataset path (e.g. 'tank/data')"),
      type: z.enum(["FILESYSTEM", "VOLUME"]).optional().describe("Dataset type (default: FILESYSTEM)"),
      volsize: z.number().optional().describe("Volume size in bytes (required for VOLUME type)"),
      compression: z.string().optional().describe("Compression algorithm (e.g. LZ4, GZIP, ZLE, ZSTD, OFF)"),
      atime: z.enum(["ON", "OFF"]).optional().describe("Access time tracking"),
      dedup: z.enum(["ON", "OFF", "VERIFY"]).optional().describe("Deduplication"),
      quota: z.number().optional().describe("Quota in bytes (0 to remove)"),
      refquota: z.number().optional().describe("Reference quota in bytes"),
      reservation: z.number().optional().describe("Reservation in bytes"),
      refreservation: z.number().optional().describe("Reference reservation in bytes"),
      copies: z.number().optional().describe("Number of data copies (1-3)"),
      readonly: z.enum(["ON", "OFF"]).optional().describe("Read-only mode"),
      recordsize: z.string().optional().describe("Record size (e.g. '128K')"),
      casesensitivity: z.enum(["SENSITIVE", "INSENSITIVE"]).optional().describe("Case sensitivity"),
      aclmode: z.enum(["PASSTHROUGH", "RESTRICTED", "DISCARD"]).optional().describe("ACL mode"),
      acltype: z.enum(["OFF", "NFSV4", "POSIX"]).optional().describe("ACL type"),
      share_type: z.enum(["GENERIC", "SMB"]).optional().describe("Share type"),
      encryption: z.boolean().optional().describe("Enable encryption"),
      encryption_options: z
        .object({
          generate_key: z.boolean().optional(),
          key: z.string().optional(),
          passphrase: z.string().optional(),
          algorithm: z.string().optional(),
        })
        .optional()
        .describe("Encryption options"),
      inherit_encryption: z.boolean().optional().describe("Inherit encryption from parent"),
    },
    async (params) => {
      // Defense in depth: an LLM may pass a /mnt/-prefixed path by mistake.
      // Route those through the strict path validator; everything else is a
      // bare ZFS dataset name (e.g. "tank/data").
      if (params.name.startsWith("/mnt/")) {
        validateTrueNASPath(params.name);
      } else {
        validateDatasetName(params.name);
      }
      const body: Record<string, unknown> = { name: params.name };
      const optionalFields = [
        "type", "volsize", "compression", "atime", "dedup", "quota", "refquota",
        "reservation", "refreservation", "copies", "readonly", "recordsize",
        "casesensitivity", "aclmode", "acltype", "share_type", "encryption",
        "encryption_options", "inherit_encryption",
      ] as const;
      for (const field of optionalFields) {
        if (params[field] !== undefined) body[field] = params[field];
      }
      const result = await client.call("pool.dataset.create", [body]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "dataset_update",
    "Update dataset properties",
    {
      id: z.string().describe("Dataset name/path (e.g. 'tank/data')"),
      compression: z.string().optional().describe("Compression algorithm"),
      atime: z.enum(["ON", "OFF"]).optional().describe("Access time tracking"),
      dedup: z.enum(["ON", "OFF", "VERIFY"]).optional().describe("Deduplication"),
      quota: z.number().optional().describe("Quota in bytes (0 to remove)"),
      refquota: z.number().optional().describe("Reference quota in bytes"),
      reservation: z.number().optional().describe("Reservation in bytes"),
      refreservation: z.number().optional().describe("Reference reservation in bytes"),
      copies: z.number().optional().describe("Number of data copies (1-3)"),
      readonly: z.enum(["ON", "OFF"]).optional().describe("Read-only mode"),
      recordsize: z.string().optional().describe("Record size (e.g. '128K')"),
      aclmode: z.enum(["PASSTHROUGH", "RESTRICTED", "DISCARD"]).optional().describe("ACL mode"),
      acltype: z.enum(["OFF", "NFSV4", "POSIX"]).optional().describe("ACL type"),
      exec: z.enum(["ON", "OFF"]).optional().describe("Allow executing programs"),
      sync: z.enum(["STANDARD", "ALWAYS", "DISABLED"]).optional().describe("Sync writes"),
    },
    async ({ id, ...props }) => {
      const body: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(props)) {
        if (value !== undefined) body[key] = value;
      }
      const result = await client.call("pool.dataset.update", [id, body]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "dataset_delete",
    "Delete a dataset (destructive — requires confirm)",
    {
      id: z.string().describe("Dataset name/path (e.g. 'tank/data')"),
      recursive: z.boolean().optional().describe("Recursively delete child datasets"),
      force: z.boolean().optional().describe("Force deletion"),
      confirm: z.boolean().describe("Must be true to confirm this destructive operation"),
    },
    async ({ id, recursive, force, confirm }) => {
      if (!confirm) {
        return {
          content: [{ type: "text", text: "Operation not confirmed. Set confirm to true to proceed." }],
        };
      }
      const body: Record<string, unknown> = {};
      if (recursive !== undefined) body.recursive = recursive;
      if (force !== undefined) body.force = force;
      const result = await client.call("pool.dataset.delete", [id, body]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "dataset_set_permissions",
    "Set UNIX permissions on a dataset",
    {
      id: z.string().describe("Dataset name/path (e.g. 'tank/data')"),
      mode: z.string().optional().describe("UNIX permission mode (e.g. '755')"),
      uid: z.number().optional().describe("Owner user ID"),
      gid: z.number().optional().describe("Owner group ID"),
      user: z.string().optional().describe("Owner username"),
      group: z.string().optional().describe("Owner group name"),
      acl: z.array(z.record(z.string(), z.unknown())).optional().describe("ACL entries"),
      options: z
        .object({
          recursive: z.boolean().optional().describe("Apply recursively"),
          traverse: z.boolean().optional().describe("Traverse filesystems"),
          stripacl: z.boolean().optional().describe("Strip existing ACLs"),
        })
        .optional()
        .describe("Permission options"),
    },
    async ({ id, ...props }) => {
      const body: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(props)) {
        if (value !== undefined) body[key] = value;
      }
      body.path = id; // filesystem.setperm expects path in body
      const result = await client.call("filesystem.setperm", [body]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "dataset_get_quota",
    "Get dataset quotas (user, group, dataset, or project)",
    {
      id: z.string().describe("Dataset name/path"),
      quota_type: z
        .enum(["USER", "GROUP", "DATASET", "PROJECT"])
        .describe("Type of quota to retrieve"),
    },
    async ({ id, quota_type }) => {
      const result = await client.call("pool.dataset.get_quota", [id, quota_type]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "dataset_set_quota",
    "Set dataset quotas",
    {
      id: z.string().describe("Dataset name/path"),
      quotas: z
        .array(
          z.object({
            quota_type: z.enum(["USER", "GROUP", "DATASET", "PROJECT"]),
            id: z.string().describe("User/group ID or name"),
            quota_value: z.number().describe("Quota value in bytes (0 to remove)"),
          }),
        )
        .describe("Array of quota entries to set"),
    },
    async ({ id, quotas }) => {
      const result = await client.call("pool.dataset.set_quota", [id, quotas]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "dataset_promote",
    "Promote a cloned dataset to no longer depend on its origin snapshot",
    { id: z.string().describe("Dataset name/path of the clone") },
    async ({ id }) => {
      const result = await client.call("pool.dataset.promote", [id]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "dataset_encryption_summary",
    "Get encryption summary for a dataset and its children",
    { id: z.string().describe("Dataset name/path") },
    async ({ id }) => {
      const result = await client.call("pool.dataset.encryption_summary", [id]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "dataset_lock",
    "Lock an encrypted dataset",
    { id: z.string().describe("Dataset name/path") },
    async ({ id }) => {
      const result = await client.call("pool.dataset.lock", [id]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "dataset_unlock",
    "Unlock an encrypted dataset",
    {
      id: z.string().describe("Dataset name/path"),
      unlock_options: z
        .object({
          key: z.string().optional().describe("Encryption key"),
          passphrase: z.string().optional().describe("Encryption passphrase"),
          recursive: z.boolean().optional().describe("Unlock child datasets"),
          datasets: z
            .array(
              z.object({
                name: z.string(),
                key: z.string().optional(),
                passphrase: z.string().optional(),
              }),
            )
            .optional()
            .describe("Per-dataset unlock credentials"),
        })
        .optional()
        .describe("Unlock options"),
    },
    async ({ id, unlock_options }) => {
      const result = await client.call("pool.dataset.unlock", [id, unlock_options ?? {}]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ---------------------------------------------------------------------------
  // SNAPSHOTS
  // ---------------------------------------------------------------------------

  server.tool(
    "snapshot_list",
    "List all ZFS snapshots, optionally limited by count",
    {
      dataset: z.string().optional().describe("Filter by dataset name"),
      limit: z.number().optional().describe("Maximum number of snapshots to return"),
      offset: z.number().optional().describe("Offset for pagination"),
    },
    async ({ dataset, limit, offset }) => {
      const queryFilters: unknown[] = [];
      const queryOptions: Record<string, unknown> = {};
      if (limit !== undefined) queryOptions.limit = limit;
      if (offset !== undefined) queryOptions.offset = offset;
      const result = await client.call("pool.snapshot.query", [queryFilters, queryOptions]);
      let snapshots = Array.isArray(result) ? result : [result];
      if (dataset) {
        snapshots = snapshots.filter((s: any) => s.dataset === dataset);
      }
      return { content: [{ type: "text", text: JSON.stringify(snapshots, null, 2) }] };
    },
  );

  server.tool(
    "snapshot_get",
    "Get snapshot details by ID (e.g. 'tank/data@snap1')",
    { id: z.string().describe("Snapshot ID (e.g. 'tank/data@snap1')") },
    async ({ id }) => {
      const result = await client.call("pool.snapshot.get_instance", [id]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "snapshot_create",
    "Create a ZFS snapshot",
    {
      dataset: z.string().describe("Dataset to snapshot (e.g. 'tank/data')"),
      name: z.string().describe("Snapshot name"),
      recursive: z.boolean().optional().describe("Recursively snapshot child datasets"),
      suspend_vms: z.boolean().optional().describe("Suspend VMs before snapshot"),
      vmware_sync: z.boolean().optional().describe("VMware quiesced snapshot"),
    },
    async ({ dataset, name, recursive, suspend_vms, vmware_sync }) => {
      const body: Record<string, unknown> = { dataset, name };
      if (recursive !== undefined) body.recursive = recursive;
      if (suspend_vms !== undefined) body.suspend_vms = suspend_vms;
      if (vmware_sync !== undefined) body.vmware_sync = vmware_sync;
      const result = await client.call("pool.snapshot.create", [body]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "snapshot_delete",
    "Delete a ZFS snapshot (destructive — requires confirm)",
    {
      id: z.string().describe("Snapshot ID (e.g. 'tank/data@snap1')"),
      defer: z.boolean().optional().describe("Defer deletion if snapshot is in use"),
      confirm: z.boolean().describe("Must be true to confirm this destructive operation"),
    },
    async ({ id, defer, confirm }) => {
      if (!confirm) {
        return {
          content: [{ type: "text", text: "Operation not confirmed. Set confirm to true to proceed." }],
        };
      }
      const options: Record<string, unknown> = {};
      if (defer !== undefined) options.defer = defer;
      const result = await client.call("pool.snapshot.delete", [id, options]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "snapshot_clone",
    "Clone a snapshot into a new dataset",
    {
      id: z.string().describe("Snapshot ID (e.g. 'tank/data@snap1')"),
      dataset_dst: z.string().describe("Destination dataset path (e.g. 'tank/data-clone')"),
    },
    async ({ id, dataset_dst }) => {
      const result = await client.call("pool.snapshot.clone", [{ snapshot: id, dataset_dst }]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "snapshot_rollback",
    "Rollback a dataset to a snapshot (destructive — requires confirm)",
    {
      id: z.string().describe("Snapshot ID (e.g. 'tank/data@snap1')"),
      recursive: z.boolean().optional().describe("Destroy later snapshots and clones"),
      recursive_clones: z.boolean().optional().describe("Destroy clones of later snapshots"),
      force: z.boolean().optional().describe("Force unmount of clones"),
      confirm: z.boolean().describe("Must be true to confirm this destructive operation"),
    },
    async ({ id, recursive, recursive_clones, force, confirm }) => {
      if (!confirm) {
        return {
          content: [{ type: "text", text: "Operation not confirmed. Set confirm to true to proceed." }],
        };
      }
      const options: Record<string, unknown> = {};
      if (recursive !== undefined) options.recursive = recursive;
      if (recursive_clones !== undefined) options.recursive_clones = recursive_clones;
      if (force !== undefined) options.force = force;
      const result = await client.call("pool.snapshot.rollback", [id, options]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ---------------------------------------------------------------------------
  // SNAPSHOT TASKS
  // ---------------------------------------------------------------------------

  server.tool(
    "snapshot_task_list",
    "List periodic snapshot tasks",
    {},
    async () => {
      const result = await client.call("pool.snapshottask.query");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "snapshot_task_create",
    "Create a periodic snapshot task",
    {
      dataset: z.string().describe("Dataset path to snapshot"),
      recursive: z.boolean().optional().describe("Include child datasets"),
      lifetime_value: z.number().optional().describe("Snapshot retention value"),
      lifetime_unit: z.enum(["HOUR", "DAY", "WEEK", "MONTH", "YEAR"]).optional().describe("Retention unit"),
      naming_schema: z.string().optional().describe("Naming schema (e.g. 'auto-%Y-%m-%d_%H-%M')"),
      schedule: z
        .object({
          minute: z.string().optional(),
          hour: z.string().optional(),
          dom: z.string().optional(),
          month: z.string().optional(),
          dow: z.string().optional(),
        })
        .optional()
        .describe("Cron-style schedule"),
      enabled: z.boolean().optional().describe("Enable the task"),
      allow_empty: z.boolean().optional().describe("Create snapshot even if no changes"),
      exclude: z.array(z.string()).optional().describe("Datasets to exclude"),
    },
    async (params) => {
      const body: Record<string, unknown> = { dataset: params.dataset };
      const optionalFields = [
        "recursive", "lifetime_value", "lifetime_unit", "naming_schema",
        "schedule", "enabled", "allow_empty", "exclude",
      ] as const;
      for (const field of optionalFields) {
        if (params[field] !== undefined) body[field] = params[field];
      }
      const result = await client.call("pool.snapshottask.create", [body]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "snapshot_task_delete",
    "Delete a periodic snapshot task",
    { id: z.number().describe("Snapshot task ID") },
    async ({ id }) => {
      const result = await client.call("pool.snapshottask.delete", [id]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "snapshot_task_run",
    "Run a periodic snapshot task immediately",
    { id: z.number().describe("Snapshot task ID") },
    async ({ id }) => {
      const result = await client.call("pool.snapshottask.run", [id]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );
}
