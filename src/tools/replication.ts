import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TrueNASClient } from "../client.js";
import { validateDatasetName, validateTrueNASPath } from "../validation.js";
import { describeAsyncJob } from "../job-utils.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonContent(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

/** Strip undefined keys so we only send fields the caller provided. */
function clean(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

// ---------------------------------------------------------------------------
// Common schema fragments
// ---------------------------------------------------------------------------

const scheduleSchema = {
  minute: z.string().optional().describe("Minute (cron)"),
  hour: z.string().optional().describe("Hour (cron)"),
  dom: z.string().optional().describe("Day of month (cron)"),
  month: z.string().optional().describe("Month (cron)"),
  dow: z.string().optional().describe("Day of week (cron)"),
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function register(server: McpServer, client: TrueNASClient): void {
  // =========================================================================
  // REPLICATION
  // =========================================================================

  server.tool(
    "replication_list",
    "List all replication tasks",
    {},
    async () => jsonContent(await client.call("replication.query")),
  );

  server.tool(
    "replication_get",
    "Get a replication task by ID",
    { id: z.number().describe("Replication task ID") },
    async ({ id }) => jsonContent(await client.call("replication.get_instance", [id])),
  );

  server.tool(
    "replication_create",
    "Create a new replication task",
    {
      name: z.string().min(1).max(150).describe("Replication task name"),
      direction: z.enum(["PUSH", "PULL"]).describe("Replication direction"),
      transport: z.enum(["LOCAL", "SSH", "SSH+NETCAT", "LEGACY"]).describe("Transport method"),
      ssh_credentials: z.number().optional().describe("SSH credential ID (keychaincredential)"),
      source_datasets: z.array(z.string()).describe("Source dataset paths"),
      target_dataset: z.string().describe("Target dataset path"),
      recursive: z.boolean().optional().describe("Recursively replicate child datasets"),
      exclude: z.array(z.string()).optional().describe("Datasets to exclude"),
      auto: z.boolean().optional().describe("Run automatically on schedule"),
      schedule: z.object(scheduleSchema).optional().describe("Cron schedule"),
      restrict_schedule: z.object(scheduleSchema).optional().describe("Restrict schedule"),
      only_matching_schedule: z.boolean().optional().describe("Only replicate snapshots matching schedule"),
      retention_policy: z.enum(["SOURCE", "CUSTOM", "NONE"]).optional().describe("Snapshot retention policy"),
      lifetime_value: z.number().optional().describe("Retention lifetime value"),
      lifetime_unit: z
        .enum(["HOUR", "DAY", "WEEK", "MONTH", "YEAR"])
        .optional()
        .describe("Retention lifetime unit"),
      naming_schema: z.array(z.string()).optional().describe("Snapshot naming schema"),
      also_include_naming_schema: z.array(z.string()).optional().describe("Additional naming schemas to include"),
      readonly: z.enum(["SET", "REQUIRE", "IGNORE"]).optional().describe("Target dataset readonly policy"),
      encryption: z.boolean().optional().describe("Enable encryption"),
      encryption_key: z.string().optional().describe("Encryption key"),
      encryption_key_format: z.string().optional().describe("Encryption key format (HEX|PASSPHRASE)"),
      encryption_key_location: z.string().optional().describe("Encryption key location"),
      allow_from_scratch: z.boolean().optional().describe("Allow full replication if incremental fails"),
      hold_pending_snapshots: z.boolean().optional().describe("Hold pending snapshots"),
      enabled: z.boolean().optional().describe("Enable this task"),
    },
    async (params) => {
      for (const ds of params.source_datasets) validateDatasetName(ds);
      validateDatasetName(params.target_dataset);
      const result = await client.call("replication.create", [clean(params)]);
      return jsonContent(result);
    },
  );

  server.tool(
    "replication_update",
    "Update an existing replication task",
    {
      id: z.number().describe("Replication task ID"),
      name: z.string().optional().describe("Task name"),
      direction: z.enum(["PUSH", "PULL"]).optional().describe("Replication direction"),
      transport: z.enum(["LOCAL", "SSH", "SSH+NETCAT", "LEGACY"]).optional().describe("Transport method"),
      ssh_credentials: z.number().optional().describe("SSH credential ID"),
      source_datasets: z.array(z.string()).optional().describe("Source dataset paths"),
      target_dataset: z.string().optional().describe("Target dataset path"),
      recursive: z.boolean().optional().describe("Recursively replicate child datasets"),
      auto: z.boolean().optional().describe("Run automatically on schedule"),
      retention_policy: z.enum(["SOURCE", "CUSTOM", "NONE"]).optional().describe("Snapshot retention policy"),
      readonly: z.enum(["SET", "REQUIRE", "IGNORE"]).optional().describe("Target dataset readonly policy"),
      enabled: z.boolean().optional().describe("Enable this task"),
    },
    async ({ id, ...rest }) => {
      const result = await client.call("replication.update", [id, clean(rest)]);
      return jsonContent(result);
    },
  );

  server.tool(
    "replication_delete",
    "Delete a replication task (destructive — requires confirm)",
    {
      id: z.number().describe("Replication task ID"),
      confirm: z.boolean().describe("Must be true to confirm deletion"),
    },
    async ({ id, confirm }) => {
      if (!confirm) return jsonContent({ error: "Deletion not confirmed. Set confirm to true." });
      const result = await client.call("replication.delete", [id]);
      return jsonContent(result);
    },
  );

  server.tool(
    "replication_run",
    "Manually run a replication task now",
    { id: z.number().describe("Replication task ID") },
    async ({ id }) => jsonContent(describeAsyncJob(await client.call("replication.run", [id]))),
  );

  server.tool(
    "replication_restore",
    "Restore from a replication task",
    {
      id: z.number().describe("Replication task ID"),
      name: z.string().describe("Name for the restored replication task"),
      target_dataset: z.string().describe("Target dataset for restoration"),
    },
    async ({ id, ...rest }) => {
      validateDatasetName(rest.target_dataset);
      return jsonContent(await client.call("replication.restore", [id, rest]));
    },
  );

  // =========================================================================
  // CLOUD SYNC
  // =========================================================================

  server.tool(
    "cloudsync_list",
    "List all cloud sync tasks",
    {},
    async () => jsonContent(await client.call("cloudsync.query")),
  );

  server.tool(
    "cloudsync_get",
    "Get a cloud sync task by ID",
    { id: z.number().describe("Cloud sync task ID") },
    async ({ id }) => jsonContent(await client.call("cloudsync.get_instance", [id])),
  );

  server.tool(
    "cloudsync_create",
    "Create a new cloud sync task",
    {
      description: z.string().describe("Task description"),
      direction: z.enum(["PUSH", "PULL"]).describe("Sync direction"),
      transfer_mode: z.enum(["SYNC", "COPY", "MOVE"]).describe("Transfer mode"),
      path: z.string().describe("Local filesystem path"),
      credentials: z.number().describe("Cloud credential ID"),
      encryption: z.boolean().optional().describe("Enable encryption"),
      filename_encryption: z.boolean().optional().describe("Encrypt filenames"),
      encryption_password: z.string().optional().describe("Encryption password"),
      encryption_salt: z.string().optional().describe("Encryption salt"),
      schedule: z.object(scheduleSchema).optional().describe("Cron schedule"),
      enabled: z.boolean().optional().describe("Enable this task"),
      follow_symlinks: z.boolean().optional().describe("Follow symlinks"),
      transfers: z.number().optional().describe("Number of simultaneous transfers"),
      bwlimit: z.array(z.object({ time: z.string(), bandwidth: z.number().optional() })).optional().describe("Bandwidth limits"),
      exclude: z.array(z.string()).optional().describe("Exclusion patterns"),
      attributes: z.record(z.string(), z.unknown()).optional().describe("Provider-specific attributes (bucket, folder, etc.)"),
      pre_script: z.string().optional().describe("Script to run before sync"),
      post_script: z.string().optional().describe("Script to run after sync"),
      args: z.string().optional().describe("Extra rclone arguments"),
      snapshot: z.boolean().optional().describe("Use ZFS snapshot for consistent data"),
    },
    async (params) => {
      if (params.path) validateTrueNASPath(params.path);
      return jsonContent(await client.call("cloudsync.create", [clean(params)]));
    },
  );

  server.tool(
    "cloudsync_update",
    "Update an existing cloud sync task",
    {
      id: z.number().describe("Cloud sync task ID"),
      description: z.string().optional().describe("Task description"),
      direction: z.enum(["PUSH", "PULL"]).optional().describe("Sync direction"),
      transfer_mode: z.enum(["SYNC", "COPY", "MOVE"]).optional().describe("Transfer mode"),
      path: z.string().optional().describe("Local filesystem path"),
      credentials: z.number().optional().describe("Cloud credential ID"),
      schedule: z.object(scheduleSchema).optional().describe("Cron schedule"),
      enabled: z.boolean().optional().describe("Enable this task"),
      attributes: z.record(z.string(), z.unknown()).optional().describe("Provider-specific attributes"),
    },
    async ({ id, ...rest }) => {
      if (rest.path) validateTrueNASPath(rest.path as string);
      return jsonContent(await client.call("cloudsync.update", [id, clean(rest)]));
    },
  );

  server.tool(
    "cloudsync_delete",
    "Delete a cloud sync task (destructive — requires confirm)",
    {
      id: z.number().describe("Cloud sync task ID"),
      confirm: z.boolean().describe("Must be true to confirm deletion"),
    },
    async ({ id, confirm }) => {
      if (!confirm) return jsonContent({ error: "Deletion not confirmed. Set confirm to true." });
      return jsonContent(await client.call("cloudsync.delete", [id]));
    },
  );

  server.tool(
    "cloudsync_run",
    "Run a cloud sync task now",
    { id: z.number().describe("Cloud sync task ID") },
    async ({ id }) => jsonContent(describeAsyncJob(await client.call("cloudsync.sync", [id]))),
  );

  server.tool(
    "cloudsync_abort",
    "Abort a running cloud sync task",
    { id: z.number().describe("Cloud sync task ID") },
    async ({ id }) => jsonContent(await client.call("cloudsync.abort", [id])),
  );

  server.tool(
    "cloudsync_restore",
    "Restore data from cloud to a local path",
    {
      id: z.number().describe("Cloud sync task ID to restore from"),
      description: z.string().describe("Description for the restore task"),
      transfer_mode: z.enum(["SYNC", "COPY", "MOVE"]).describe("Transfer mode for restoration"),
      path: z.string().describe("Local path to restore to"),
    },
    async ({ id, ...rest }) => {
      if (rest.path) validateTrueNASPath(rest.path as string);
      return jsonContent(await client.call("cloudsync.restore", [id, rest]));
    },
  );

  server.tool(
    "cloudsync_providers",
    "List available cloud sync providers",
    {},
    async () => jsonContent(await client.call("cloudsync.providers")),
  );

  // -- Cloud Sync Credentials ------------------------------------------------

  server.tool(
    "cloudsync_credentials_list",
    "List all cloud sync credentials",
    {},
    async () => jsonContent(await client.call("cloudsync.credentials.query")),
  );

  server.tool(
    "cloudsync_credentials_create",
    "Create a new cloud sync credential",
    {
      name: z.string().describe("Credential name"),
      provider: z.string().describe("Cloud provider (e.g. S3, GOOGLE_CLOUD_STORAGE, AZUREBLOB, B2)"),
      attributes: z.record(z.string(), z.unknown()).describe("Provider-specific attributes (access keys, tokens, etc.)"),
    },
    async (params) => jsonContent(await client.call("cloudsync.credentials.create", [params])),
  );

  server.tool(
    "cloudsync_credentials_update",
    "Update an existing cloud sync credential",
    {
      id: z.number().describe("Credential ID"),
      name: z.string().optional().describe("Credential name"),
      provider: z.string().optional().describe("Cloud provider"),
      attributes: z.record(z.string(), z.unknown()).optional().describe("Provider-specific attributes"),
    },
    async ({ id, ...rest }) => jsonContent(await client.call("cloudsync.credentials.update", [id, clean(rest)])),
  );

  server.tool(
    "cloudsync_credentials_delete",
    "Delete a cloud sync credential",
    { id: z.number().describe("Credential ID") },
    async ({ id }) => jsonContent(await client.call("cloudsync.credentials.delete", [id])),
  );

  server.tool(
    "cloudsync_credentials_verify",
    "Verify a cloud sync credential is working",
    {
      provider: z.string().describe("Cloud provider"),
      attributes: z.record(z.string(), z.unknown()).describe("Provider-specific attributes to verify"),
    },
    async (params) => jsonContent(await client.call("cloudsync.credentials.verify", [params])),
  );

  server.tool(
    "cloudsync_list_buckets",
    "List remote buckets for a cloud credential",
    {
      credentials: z.number().describe("Credential ID"),
      attributes: z.record(z.string(), z.unknown()).optional().describe("Provider-specific attributes"),
    },
    async (params) => jsonContent(await client.call("cloudsync.list_buckets", [clean(params)])),
  );

  server.tool(
    "cloudsync_list_directory",
    "List files in a remote directory",
    {
      credentials: z.number().describe("Credential ID"),
      attributes: z.record(z.string(), z.unknown()).optional().describe("Provider-specific attributes"),
      id: z.number().optional().describe("Cloud sync task ID for context"),
    },
    async (params) => jsonContent(await client.call("cloudsync.list_directory", [clean(params)])),
  );

  // =========================================================================
  // CLOUD BACKUP
  // =========================================================================

  server.tool(
    "cloud_backup_list",
    "List all cloud backup tasks",
    {},
    async () => jsonContent(await client.call("cloud_backup.query")),
  );

  server.tool(
    "cloud_backup_create",
    "Create a new cloud backup task",
    {
      description: z.string().describe("Backup task description"),
      path: z.string().describe("Dataset or path to back up"),
      credentials: z.number().describe("Cloud credential ID"),
      attributes: z.record(z.string(), z.unknown()).optional().describe("Provider-specific attributes"),
      schedule: z.object(scheduleSchema).optional().describe("Cron schedule"),
      enabled: z.boolean().optional().describe("Enable this task"),
      password: z.string().optional().describe("Encryption password for backups"),
      keep_last: z.number().optional().describe("Number of recent backups to keep"),
      transfer_setting: z.string().optional().describe("Transfer setting (DEFAULT, PERFORMANCE, FAST_STORAGE)"),
    },
    async (params) => {
      if (params.path) validateTrueNASPath(params.path);
      return jsonContent(await client.call("cloud_backup.create", [clean(params)]));
    },
  );

  server.tool(
    "cloud_backup_update",
    "Update an existing cloud backup task",
    {
      id: z.number().describe("Cloud backup task ID"),
      description: z.string().optional().describe("Backup task description"),
      path: z.string().optional().describe("Dataset or path to back up"),
      credentials: z.number().optional().describe("Cloud credential ID"),
      attributes: z.record(z.string(), z.unknown()).optional().describe("Provider-specific attributes"),
      schedule: z.object(scheduleSchema).optional().describe("Cron schedule"),
      enabled: z.boolean().optional().describe("Enable this task"),
      password: z.string().optional().describe("Encryption password"),
      keep_last: z.number().optional().describe("Number of recent backups to keep"),
    },
    async ({ id, ...rest }) => {
      if (rest.path) validateTrueNASPath(rest.path as string);
      return jsonContent(await client.call("cloud_backup.update", [id, clean(rest)]));
    },
  );

  server.tool(
    "cloud_backup_delete",
    "Delete a cloud backup task (destructive — requires confirm)",
    {
      id: z.number().describe("Cloud backup task ID"),
      confirm: z.boolean().describe("Must be true to confirm deletion"),
    },
    async ({ id, confirm }) => {
      if (!confirm) return jsonContent({ error: "Deletion not confirmed. Set confirm to true." });
      return jsonContent(await client.call("cloud_backup.delete", [id]));
    },
  );

  server.tool(
    "cloud_backup_run",
    "Run a cloud backup task now",
    { id: z.number().describe("Cloud backup task ID") },
    async ({ id }) => jsonContent(describeAsyncJob(await client.call("cloud_backup.sync", [id]))),
  );

  server.tool(
    "cloud_backup_abort",
    "Abort a running cloud backup task",
    { id: z.number().describe("Cloud backup task ID") },
    async ({ id }) => jsonContent(await client.call("cloud_backup.abort", [id])),
  );

  server.tool(
    "cloud_backup_snapshots",
    "List snapshots for a cloud backup task",
    { id: z.number().describe("Cloud backup task ID") },
    async ({ id }) => jsonContent(await client.call("cloud_backup.list_snapshots", [id])),
  );

  // =========================================================================
  // CRON JOBS
  // =========================================================================

  server.tool(
    "cronjob_list",
    "List all cron jobs",
    {},
    async () => jsonContent(await client.call("cronjob.query")),
  );

  server.tool(
    "cronjob_create",
    "Create a new cron job",
    {
      user: z.string().describe("User to run the command as"),
      command: z.string().describe("Command to execute"),
      description: z.string().optional().describe("Job description"),
      enabled: z.boolean().optional().describe("Enable this cron job"),
      schedule: z.object(scheduleSchema).optional().describe("Cron schedule"),
    },
    async (params) => jsonContent(await client.call("cronjob.create", [clean(params)])),
  );

  server.tool(
    "cronjob_update",
    "Update an existing cron job",
    {
      id: z.number().describe("Cron job ID"),
      user: z.string().optional().describe("User to run the command as"),
      command: z.string().optional().describe("Command to execute"),
      description: z.string().optional().describe("Job description"),
      enabled: z.boolean().optional().describe("Enable this cron job"),
      schedule: z.object(scheduleSchema).optional().describe("Cron schedule"),
    },
    async ({ id, ...rest }) => jsonContent(await client.call("cronjob.update", [id, clean(rest)])),
  );

  server.tool(
    "cronjob_delete",
    "Delete a cron job",
    { id: z.number().describe("Cron job ID") },
    async ({ id }) => jsonContent(await client.call("cronjob.delete", [id])),
  );

  server.tool(
    "cronjob_run",
    "Run a cron job immediately",
    { id: z.number().describe("Cron job ID") },
    async ({ id }) => jsonContent(await client.call("cronjob.run", [id])),
  );

  // =========================================================================
  // RSYNC TASKS
  // =========================================================================

  server.tool(
    "rsync_task_list",
    "List all rsync tasks",
    {},
    async () => jsonContent(await client.call("rsynctask.query")),
  );

  server.tool(
    "rsync_task_create",
    "Create a new rsync task",
    {
      path: z.string().describe("Local path"),
      user: z.string().describe("User to run rsync as"),
      remotehost: z.string().describe("Remote host"),
      remoteport: z.number().optional().describe("Remote SSH port"),
      mode: z.enum(["MODULE", "SSH"]).describe("Rsync mode"),
      remotemodule: z.string().optional().describe("Remote rsync module name (MODULE mode)"),
      remotepath: z.string().optional().describe("Remote path (SSH mode)"),
      direction: z.enum(["PUSH", "PULL"]).describe("Sync direction"),
      desc: z.string().optional().describe("Task description"),
      schedule: z.object(scheduleSchema).optional().describe("Cron schedule"),
      recursive: z.boolean().optional().describe("Recursive sync"),
      times: z.boolean().optional().describe("Preserve modification times"),
      compress: z.boolean().optional().describe("Enable compression"),
      archive: z.boolean().optional().describe("Archive mode"),
      delete: z.boolean().optional().describe("Delete files on destination that don't exist on source"),
      quiet: z.boolean().optional().describe("Suppress non-error messages"),
      preserveperm: z.boolean().optional().describe("Preserve permissions"),
      preserveattr: z.boolean().optional().describe("Preserve extended attributes"),
      delayupdates: z.boolean().optional().describe("Delay updates until transfer is complete"),
      extra: z.array(z.string()).optional().describe("Extra rsync arguments"),
      enabled: z.boolean().optional().describe("Enable this task"),
      ssh_credentials: z.number().optional().describe("SSH credential ID for SSH mode"),
    },
    async (params) => {
      if (params.path) validateTrueNASPath(params.path);
      return jsonContent(await client.call("rsynctask.create", [clean(params)]));
    },
  );

  server.tool(
    "rsync_task_update",
    "Update an existing rsync task",
    {
      id: z.number().describe("Rsync task ID"),
      path: z.string().optional().describe("Local path"),
      user: z.string().optional().describe("User to run rsync as"),
      remotehost: z.string().optional().describe("Remote host"),
      remoteport: z.number().optional().describe("Remote SSH port"),
      mode: z.enum(["MODULE", "SSH"]).optional().describe("Rsync mode"),
      remotemodule: z.string().optional().describe("Remote rsync module name"),
      remotepath: z.string().optional().describe("Remote path"),
      direction: z.enum(["PUSH", "PULL"]).optional().describe("Sync direction"),
      desc: z.string().optional().describe("Task description"),
      schedule: z.object(scheduleSchema).optional().describe("Cron schedule"),
      enabled: z.boolean().optional().describe("Enable this task"),
    },
    async ({ id, ...rest }) => {
      if (rest.path) validateTrueNASPath(rest.path as string);
      return jsonContent(await client.call("rsynctask.update", [id, clean(rest)]));
    },
  );

  server.tool(
    "rsync_task_delete",
    "Delete an rsync task",
    { id: z.number().describe("Rsync task ID") },
    async ({ id }) => jsonContent(await client.call("rsynctask.delete", [id])),
  );

  server.tool(
    "rsync_task_run",
    "Run an rsync task immediately",
    { id: z.number().describe("Rsync task ID") },
    async ({ id }) => jsonContent(await client.call("rsynctask.run", [id])),
  );

  // =========================================================================
  // INIT/SHUTDOWN SCRIPTS
  // =========================================================================

  server.tool(
    "initshutdown_list",
    "List all init/shutdown scripts",
    {},
    async () => jsonContent(await client.call("initshutdownscript.query")),
  );

  server.tool(
    "initshutdown_create",
    "Create an init/shutdown script",
    {
      type: z.enum(["COMMAND", "SCRIPT"]).describe("Type: COMMAND or SCRIPT"),
      command: z.string().optional().describe("Command to execute (type=COMMAND)"),
      script: z.string().optional().describe("Path to script file (type=SCRIPT)"),
      when: z.enum(["PREINIT", "POSTINIT", "SHUTDOWN"]).describe("When to run"),
      enabled: z.boolean().optional().describe("Enable this script"),
      timeout: z.number().optional().describe("Timeout in seconds"),
      comment: z.string().optional().describe("Comment / description"),
    },
    async (params) => jsonContent(await client.call("initshutdownscript.create", [clean(params)])),
  );

  server.tool(
    "initshutdown_update",
    "Update an init/shutdown script",
    {
      id: z.number().describe("Init/shutdown script ID"),
      type: z.enum(["COMMAND", "SCRIPT"]).optional().describe("Type: COMMAND or SCRIPT"),
      command: z.string().optional().describe("Command to execute"),
      script: z.string().optional().describe("Path to script file"),
      when: z.enum(["PREINIT", "POSTINIT", "SHUTDOWN"]).optional().describe("When to run"),
      enabled: z.boolean().optional().describe("Enable this script"),
      timeout: z.number().optional().describe("Timeout in seconds"),
      comment: z.string().optional().describe("Comment / description"),
    },
    async ({ id, ...rest }) => jsonContent(await client.call("initshutdownscript.update", [id, clean(rest)])),
  );

  server.tool(
    "initshutdown_delete",
    "Delete an init/shutdown script",
    { id: z.number().describe("Init/shutdown script ID") },
    async ({ id }) => jsonContent(await client.call("initshutdownscript.delete", [id])),
  );

  // =========================================================================
  // SSH KEYPAIR / KEYCHAIN CREDENTIALS
  // =========================================================================

  server.tool(
    "keychaincredential_list",
    "List all SSH credentials and keypairs",
    {},
    async () => jsonContent(await client.call("keychaincredential.query")),
  );

  server.tool(
    "keychaincredential_create",
    "Create an SSH credential or keypair",
    {
      name: z.string().describe("Credential name"),
      type: z.enum(["SSH_KEY_PAIR", "SSH_CREDENTIALS"]).describe("Credential type"),
      attributes: z.record(z.string(), z.unknown()).describe("Type-specific attributes (e.g. private_key, public_key, host, username, etc.)"),
    },
    async (params) => jsonContent(await client.call("keychaincredential.create", [params])),
  );

  server.tool(
    "keychaincredential_delete",
    "Delete an SSH credential or keypair",
    { id: z.number().describe("Keychain credential ID") },
    async ({ id }) => jsonContent(await client.call("keychaincredential.delete", [id])),
  );

  server.tool(
    "keychaincredential_generate_ssh_key",
    "Generate a new SSH key pair",
    {},
    async () => jsonContent(await client.call("keychaincredential.generate_ssh_key_pair")),
  );

  server.tool(
    "keychaincredential_remote_ssh_scan",
    "Scan a remote host for its SSH host key",
    {
      host: z.string().describe("Remote hostname or IP"),
      port: z.number().optional().describe("SSH port (default 22)"),
      connect_timeout: z.number().optional().describe("Connection timeout in seconds"),
    },
    async (params) => jsonContent(await client.call("keychaincredential.remote_ssh_host_key_scan", [clean(params)])),
  );
}
