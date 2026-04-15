/**
 * Safety tier classification for every TrueNAS MCP action.
 *
 * Tier 0 — Blocked: hard reject, never registered
 * Tier 1 — Confirm + Reason: requires confirm=true AND a non-empty reason string
 * Tier 2 — Confirm: requires confirm=true
 * Tier 3 — Open: no gate
 *
 * This is pure data — no enforcement logic lives here.
 */

export const enum SafetyTier {
  Blocked = 0,
  ConfirmWithReason = 1,
  Confirm = 2,
  Open = 3,
}

/**
 * Complete mapping of every action name to its safety tier.
 * Every action registered by the 8 tool modules must appear here.
 */
export const ACTION_TIERS: Record<string, SafetyTier> = {
  // ═══════════════════════════════════════════════════════════════════
  // TIER 0 — Blocked (8 actions)
  // These are never registered. Hard reject.
  // ═══════════════════════════════════════════════════════════════════

  // System-level danger
  system_reboot: SafetyTier.Blocked,
  system_shutdown: SafetyTier.Blocked,
  system_config_upload: SafetyTier.Blocked,

  // Raw API bypass — renders all other gates cosmetic
  truenas_api_call: SafetyTier.Blocked,

  // Arbitrary shell command execution on TrueNAS
  cronjob_create: SafetyTier.Blocked,
  cronjob_update: SafetyTier.Blocked,
  initshutdown_create: SafetyTier.Blocked,
  initshutdown_update: SafetyTier.Blocked,

  // ═══════════════════════════════════════════════════════════════════
  // TIER 1 — Confirm + Reason (14 actions)
  // Irreversible or high-blast-radius operations.
  // ═══════════════════════════════════════════════════════════════════

  // Pool-level data operations
  pool_create: SafetyTier.ConfirmWithReason,
  pool_export: SafetyTier.ConfirmWithReason,
  pool_replace_disk: SafetyTier.ConfirmWithReason,

  // Irreversible hardware-level destruction
  disk_wipe: SafetyTier.ConfirmWithReason,

  // Recursive data deletion
  dataset_delete: SafetyTier.ConfirmWithReason,

  // Overwrites current state
  snapshot_rollback: SafetyTier.ConfirmWithReason,

  // System update with potential reboot
  update_apply: SafetyTier.ConfirmWithReason,

  // Boot environment changes
  bootenv_activate: SafetyTier.ConfirmWithReason,
  bootenv_delete: SafetyTier.ConfirmWithReason,

  // Boot pool disk operations
  boot_attach_disk: SafetyTier.ConfirmWithReason,
  boot_detach_disk: SafetyTier.ConfirmWithReason,

  // Breaks auth for domain users
  directory_services_leave: SafetyTier.ConfirmWithReason,

  // Response contains secret seed + encryption keys
  system_config_download: SafetyTier.ConfirmWithReason,

  // Applies staged network changes — could lock out access
  network_commit_changes: SafetyTier.ConfirmWithReason,

  // ═══════════════════════════════════════════════════════════════════
  // TIER 2 — Confirm (destructive writes, config changes)
  // ═══════════════════════════════════════════════════════════════════

  // Services
  service_stop: SafetyTier.Confirm,
  service_restart: SafetyTier.Confirm,
  service_update: SafetyTier.Confirm,

  // Network
  network_config_update: SafetyTier.Confirm,
  network_interface_create: SafetyTier.Confirm,
  network_interface_update: SafetyTier.Confirm,
  network_interface_delete: SafetyTier.Confirm,

  // Accounts
  user_create: SafetyTier.Confirm,
  user_update: SafetyTier.Confirm,
  user_set_password: SafetyTier.Confirm,
  user_delete: SafetyTier.Confirm,
  group_create: SafetyTier.Confirm,
  group_update: SafetyTier.Confirm,
  group_delete: SafetyTier.Confirm,

  // Credentials
  api_key_create: SafetyTier.Confirm,
  api_key_delete: SafetyTier.Confirm,
  keychaincredential_create: SafetyTier.Confirm,
  keychaincredential_delete: SafetyTier.Confirm,

  // Service configs
  ssh_config_update: SafetyTier.Confirm,
  ftp_config_update: SafetyTier.Confirm,
  snmp_config_update: SafetyTier.Confirm,
  ups_config_update: SafetyTier.Confirm,

  // Tunables
  tunable_create: SafetyTier.Confirm,
  tunable_update: SafetyTier.Confirm,
  tunable_delete: SafetyTier.Confirm,

  // Filesystem
  filesystem_mkdir: SafetyTier.Confirm,
  filesystem_set_permissions: SafetyTier.Confirm,
  filesystem_chown: SafetyTier.Confirm,
  filesystem_set_acl: SafetyTier.Confirm,

  // Storage
  dataset_lock: SafetyTier.Confirm,
  dataset_set_permissions: SafetyTier.Confirm,
  dataset_set_quota: SafetyTier.Confirm,
  dataset_promote: SafetyTier.Confirm,

  // Sharing configs
  smb_config_update: SafetyTier.Confirm,
  nfs_config_update: SafetyTier.Confirm,
  iscsi_global_config_update: SafetyTier.Confirm,

  // VMs
  vm_stop: SafetyTier.Confirm,
  vm_restart: SafetyTier.Confirm,
  vm_delete: SafetyTier.Confirm,
  vm_device_delete: SafetyTier.Confirm,

  // Apps
  app_delete: SafetyTier.Confirm,
  app_rollback: SafetyTier.Confirm,
  docker_config_update: SafetyTier.Confirm,

  // Certificates
  certificate_create: SafetyTier.Confirm,
  certificate_delete: SafetyTier.Confirm,
  acme_dns_authenticator_create: SafetyTier.Confirm,
  acme_dns_authenticator_delete: SafetyTier.Confirm,

  // Replication & sync
  replication_create: SafetyTier.Confirm,
  replication_delete: SafetyTier.Confirm,
  cloudsync_create: SafetyTier.Confirm,
  cloudsync_delete: SafetyTier.Confirm,
  rsync_task_create: SafetyTier.Confirm,

  // Audit & privileges
  audit_config_update: SafetyTier.Confirm,
  privilege_create: SafetyTier.Confirm,
  privilege_update: SafetyTier.Confirm,
  privilege_delete: SafetyTier.Confirm,
  alertservice_create: SafetyTier.Confirm,
  alertservice_delete: SafetyTier.Confirm,

  // Updates
  update_config_set: SafetyTier.Confirm,
  update_download: SafetyTier.Confirm,

  // Mail & directory
  mail_update: SafetyTier.Confirm,
  directory_services_update: SafetyTier.Confirm,

  // Share deletions
  smb_share_delete: SafetyTier.Confirm,
  nfs_share_delete: SafetyTier.Confirm,
  iscsi_target_delete: SafetyTier.Confirm,
  iscsi_extent_delete: SafetyTier.Confirm,
  iscsi_portal_delete: SafetyTier.Confirm,
  iscsi_initiator_delete: SafetyTier.Confirm,
  iscsi_targetextent_delete: SafetyTier.Confirm,

  // ═══════════════════════════════════════════════════════════════════
  // TIER 3 — Open (reads, safe creates, queries)
  // ═══════════════════════════════════════════════════════════════════

  // System
  system_info: SafetyTier.Open,
  system_version: SafetyTier.Open,
  system_general_config: SafetyTier.Open,
  system_general_update: SafetyTier.Open,
  system_advanced_config: SafetyTier.Open,
  system_ntp_servers: SafetyTier.Open,
  system_ntp_server_create: SafetyTier.Open,
  system_ntp_server_delete: SafetyTier.Open,
  service_list: SafetyTier.Open,
  service_get: SafetyTier.Open,
  service_start: SafetyTier.Open,
  mail_config: SafetyTier.Open,
  mail_send: SafetyTier.Open,
  api_key_list: SafetyTier.Open,

  // Storage
  pool_list: SafetyTier.Open,
  pool_get: SafetyTier.Open,
  pool_update: SafetyTier.Open,
  pool_status: SafetyTier.Open,
  pool_scrub: SafetyTier.Open,
  pool_attachments: SafetyTier.Open,
  pool_get_disks: SafetyTier.Open,
  dataset_list: SafetyTier.Open,
  dataset_get: SafetyTier.Open,
  dataset_create: SafetyTier.Open,
  dataset_update: SafetyTier.Open,
  dataset_get_quota: SafetyTier.Open,
  dataset_encryption_summary: SafetyTier.Open,
  dataset_unlock: SafetyTier.Open,
  snapshot_list: SafetyTier.Open,
  snapshot_get: SafetyTier.Open,
  snapshot_create: SafetyTier.Open,
  snapshot_delete: SafetyTier.Open,
  snapshot_clone: SafetyTier.Open,
  snapshot_task_list: SafetyTier.Open,
  snapshot_task_create: SafetyTier.Open,
  snapshot_task_delete: SafetyTier.Open,
  snapshot_task_run: SafetyTier.Open,
  rsync_task_list: SafetyTier.Open,
  rsync_task_update: SafetyTier.Open,
  rsync_task_delete: SafetyTier.Open,
  rsync_task_run: SafetyTier.Open,
  initshutdown_list: SafetyTier.Open,
  initshutdown_delete: SafetyTier.Open,
  keychaincredential_list: SafetyTier.Open,
  keychaincredential_generate_ssh_key: SafetyTier.Open,
  keychaincredential_remote_ssh_scan: SafetyTier.Open,

  // Sharing
  smb_share_list: SafetyTier.Open,
  smb_share_get: SafetyTier.Open,
  smb_share_create: SafetyTier.Open,
  smb_share_update: SafetyTier.Open,
  smb_config: SafetyTier.Open,
  nfs_share_list: SafetyTier.Open,
  nfs_share_get: SafetyTier.Open,
  nfs_share_create: SafetyTier.Open,
  nfs_share_update: SafetyTier.Open,
  nfs_config: SafetyTier.Open,
  nfs_client_count: SafetyTier.Open,
  iscsi_global_config: SafetyTier.Open,
  iscsi_target_list: SafetyTier.Open,
  iscsi_target_create: SafetyTier.Open,
  iscsi_target_update: SafetyTier.Open,
  iscsi_extent_list: SafetyTier.Open,
  iscsi_extent_create: SafetyTier.Open,
  iscsi_extent_update: SafetyTier.Open,
  iscsi_portal_list: SafetyTier.Open,
  iscsi_portal_create: SafetyTier.Open,
  iscsi_portal_update: SafetyTier.Open,
  iscsi_initiator_list: SafetyTier.Open,
  iscsi_initiator_create: SafetyTier.Open,
  iscsi_targetextent_list: SafetyTier.Open,
  iscsi_targetextent_create: SafetyTier.Open,
  iscsi_sessions: SafetyTier.Open,

  // Network
  network_interface_list: SafetyTier.Open,
  network_interface_get: SafetyTier.Open,
  network_config: SafetyTier.Open,
  network_summary: SafetyTier.Open,
  network_static_route_list: SafetyTier.Open,
  network_static_route_create: SafetyTier.Open,
  network_static_route_delete: SafetyTier.Open,
  network_ipmi_info: SafetyTier.Open,
  network_rollback_changes: SafetyTier.Open,
  network_checkin: SafetyTier.Open,

  // Account
  user_list: SafetyTier.Open,
  user_get: SafetyTier.Open,
  user_shell_choices: SafetyTier.Open,
  group_list: SafetyTier.Open,
  group_get: SafetyTier.Open,

  // Disk
  disk_list: SafetyTier.Open,
  disk_get: SafetyTier.Open,
  disk_update: SafetyTier.Open,
  disk_temperatures: SafetyTier.Open,
  disk_smart_test_list: SafetyTier.Open,
  disk_smart_test_run: SafetyTier.Open,

  // VM
  vm_list: SafetyTier.Open,
  vm_get: SafetyTier.Open,
  vm_create: SafetyTier.Open,
  vm_update: SafetyTier.Open,
  vm_start: SafetyTier.Open,
  vm_status: SafetyTier.Open,
  vm_clone: SafetyTier.Open,
  vm_device_list: SafetyTier.Open,
  vm_device_create: SafetyTier.Open,
  vm_device_update: SafetyTier.Open,
  vm_available_memory: SafetyTier.Open,
  vm_display_uri: SafetyTier.Open,

  // Apps
  app_list: SafetyTier.Open,
  app_get: SafetyTier.Open,
  app_create: SafetyTier.Open,
  app_update: SafetyTier.Open,
  app_start: SafetyTier.Open,
  app_stop: SafetyTier.Open,
  app_redeploy: SafetyTier.Open,
  app_upgrade: SafetyTier.Open,
  app_available: SafetyTier.Open,
  app_categories: SafetyTier.Open,
  app_outdated_images: SafetyTier.Open,
  app_pull_images: SafetyTier.Open,
  docker_config: SafetyTier.Open,
  docker_status: SafetyTier.Open,

  // Alert
  alert_list: SafetyTier.Open,
  alert_dismiss: SafetyTier.Open,
  alert_restore: SafetyTier.Open,
  alert_categories: SafetyTier.Open,
  alert_policies: SafetyTier.Open,
  alertservice_list: SafetyTier.Open,
  alertservice_update: SafetyTier.Open,
  alertservice_test: SafetyTier.Open,

  // Certificates
  certificate_list: SafetyTier.Open,
  certificate_get: SafetyTier.Open,
  certificate_acme_servers: SafetyTier.Open,
  acme_dns_authenticator_list: SafetyTier.Open,

  // Updates & boot
  update_check: SafetyTier.Open,
  update_config: SafetyTier.Open,
  bootenv_list: SafetyTier.Open,
  bootenv_create: SafetyTier.Open,
  bootenv_keep: SafetyTier.Open,
  boot_state: SafetyTier.Open,
  boot_scrub: SafetyTier.Open,

  // Data protection
  replication_list: SafetyTier.Open,
  replication_get: SafetyTier.Open,
  replication_update: SafetyTier.Open,
  replication_run: SafetyTier.Open,
  replication_restore: SafetyTier.Open,
  cloudsync_list: SafetyTier.Open,
  cloudsync_get: SafetyTier.Open,
  cloudsync_update: SafetyTier.Open,
  cloudsync_run: SafetyTier.Open,
  cloudsync_abort: SafetyTier.Open,
  cloudsync_restore: SafetyTier.Open,
  cloudsync_providers: SafetyTier.Open,
  cloudsync_credentials_list: SafetyTier.Open,
  cloudsync_credentials_create: SafetyTier.Open,
  cloudsync_credentials_update: SafetyTier.Open,
  cloudsync_credentials_delete: SafetyTier.Open,
  cloudsync_credentials_verify: SafetyTier.Open,
  cloudsync_list_buckets: SafetyTier.Open,
  cloudsync_list_directory: SafetyTier.Open,
  cloud_backup_list: SafetyTier.Open,
  cloud_backup_create: SafetyTier.Open,
  cloud_backup_update: SafetyTier.Open,
  cloud_backup_delete: SafetyTier.Open,
  cloud_backup_run: SafetyTier.Open,
  cloud_backup_abort: SafetyTier.Open,
  cloud_backup_snapshots: SafetyTier.Open,
  cronjob_list: SafetyTier.Open,
  cronjob_delete: SafetyTier.Open,
  cronjob_run: SafetyTier.Open,

  // Filesystem
  filesystem_stat: SafetyTier.Open,
  filesystem_listdir: SafetyTier.Open,
  filesystem_get_acl: SafetyTier.Open,

  // Reporting
  reporting_config: SafetyTier.Open,
  reporting_graphs: SafetyTier.Open,
  reporting_get_data: SafetyTier.Open,

  // Directory services
  directory_services_config: SafetyTier.Open,
  directory_services_status: SafetyTier.Open,
  directory_services_cache_refresh: SafetyTier.Open,
  kerberos_config: SafetyTier.Open,
  kerberos_realm_list: SafetyTier.Open,
  kerberos_keytab_list: SafetyTier.Open,

  // Service configs (reads)
  tunable_list: SafetyTier.Open,
  ssh_config: SafetyTier.Open,
  ftp_config: SafetyTier.Open,
  snmp_config: SafetyTier.Open,
  ups_config: SafetyTier.Open,

  // Privileges (reads)
  privilege_list: SafetyTier.Open,

  // Audit (reads)
  audit_query: SafetyTier.Open,
  audit_config: SafetyTier.Open,
};

/** Names of all blocked actions for quick lookup */
export const BLOCKED_ACTIONS = new Set(
  Object.entries(ACTION_TIERS)
    .filter(([, tier]) => tier === SafetyTier.Blocked)
    .map(([name]) => name)
);

/** Get the safety tier for an action, or undefined if not classified */
export function getActionTier(action: string): SafetyTier | undefined {
  return ACTION_TIERS[action];
}
