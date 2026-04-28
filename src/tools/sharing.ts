import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TrueNASClient } from "../client.js";
import { validateTrueNASPath } from "../validation.js";

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
// Registration
// ---------------------------------------------------------------------------

export function register(server: McpServer, client: TrueNASClient): void {
  // =========================================================================
  // SMB Shares
  // =========================================================================

  server.tool(
    "smb_share_list",
    "List all SMB shares",
    {},
    async () => jsonContent(await client.call("sharing.smb.query")),
  );

  server.tool(
    "smb_share_get",
    "Get an SMB share by ID",
    { id: z.number().describe("SMB share ID") },
    async ({ id }) => jsonContent(await client.call("sharing.smb.get_instance", [id])),
  );

  server.tool(
    "smb_share_create",
    "Create a new SMB share",
    {
      path: z.string().describe("Filesystem path to share"),
      name: z
        .string()
        .min(1)
        .max(80)
        .regex(
          /^[a-zA-Z0-9._-]+$/,
          "SMB share name must be alphanumerics, '_', '-', or '.'",
        )
        .optional()
        .describe("Share name (defaults to last path component)"),
      comment: z.string().optional().describe("Description / comment"),
      enabled: z.boolean().optional().describe("Whether the share is enabled"),
      home: z.boolean().optional().describe("Use as home share"),
      purpose: z
        .enum([
          "DEFAULT_SHARE",
          "LEGACY_SHARE",
          "TIMEMACHINE_SHARE",
          "MULTIPROTOCOL_SHARE",
          "TIME_LOCKED_SHARE",
          "PRIVATE_DATASETS_SHARE",
          "EXTERNAL_SHARE",
          "VEEAM_REPOSITORY_SHARE",
          "FCP_SHARE",
        ])
        .optional()
        .describe("Share purpose preset (DEFAULT_SHARE recommended for general use)"),
      readonly: z.boolean().optional().describe("Read-only"),
      browsable: z.boolean().optional().describe("Visible when browsing shares"),
      guestok: z.boolean().optional().describe("Allow guest access"),
      hostsallow: z.array(z.string()).optional().describe("Allowed hosts"),
      hostsdeny: z.array(z.string()).optional().describe("Denied hosts"),
      recyclebin: z.boolean().optional().describe("Enable recycle bin"),
      access_based_share_enumeration: z.boolean().optional().describe("Access-based enumeration"),
      acl: z.boolean().optional().describe("Enable ACL support"),
      durablehandle: z.boolean().optional().describe("Enable durable handles"),
      streams: z.boolean().optional().describe("Enable alternate data streams"),
      timemachine: z.boolean().optional().describe("Enable Time Machine backups"),
      shadowcopy: z.boolean().optional().describe("Enable shadow copies"),
      auxsmbconf: z.string().optional().describe("Auxiliary smb.conf parameters"),
    },
    async (params) => {
      if (params.path) validateTrueNASPath(params.path);
      const body = clean(params);
      return jsonContent(await client.call("sharing.smb.create", [body]));
    },
  );

  server.tool(
    "smb_share_update",
    "Update an existing SMB share",
    {
      id: z.number().describe("SMB share ID"),
      path: z.string().optional().describe("Filesystem path to share"),
      name: z.string().optional().describe("Share name"),
      comment: z.string().optional().describe("Description / comment"),
      enabled: z.boolean().optional().describe("Whether the share is enabled"),
      home: z.boolean().optional().describe("Use as home share"),
      purpose: z
        .enum([
          "DEFAULT_SHARE",
          "LEGACY_SHARE",
          "TIMEMACHINE_SHARE",
          "MULTIPROTOCOL_SHARE",
          "TIME_LOCKED_SHARE",
          "PRIVATE_DATASETS_SHARE",
          "EXTERNAL_SHARE",
          "VEEAM_REPOSITORY_SHARE",
          "FCP_SHARE",
        ])
        .optional()
        .describe("Share purpose preset"),
      readonly: z.boolean().optional().describe("Read-only"),
      browsable: z.boolean().optional().describe("Visible when browsing shares"),
      guestok: z.boolean().optional().describe("Allow guest access"),
      hostsallow: z.array(z.string()).optional().describe("Allowed hosts"),
      hostsdeny: z.array(z.string()).optional().describe("Denied hosts"),
      recyclebin: z.boolean().optional().describe("Enable recycle bin"),
      access_based_share_enumeration: z.boolean().optional().describe("Access-based enumeration"),
      acl: z.boolean().optional().describe("Enable ACL support"),
      durablehandle: z.boolean().optional().describe("Enable durable handles"),
      streams: z.boolean().optional().describe("Enable alternate data streams"),
      timemachine: z.boolean().optional().describe("Enable Time Machine backups"),
      shadowcopy: z.boolean().optional().describe("Enable shadow copies"),
      auxsmbconf: z.string().optional().describe("Auxiliary smb.conf parameters"),
    },
    async ({ id, ...rest }) => {
      if (rest.path) validateTrueNASPath(rest.path);
      const body = clean(rest);
      return jsonContent(await client.call("sharing.smb.update", [id, body]));
    },
  );

  server.tool(
    "smb_share_delete",
    "Delete an SMB share",
    {
      id: z.number().describe("SMB share ID"),
      confirm: z.boolean().describe("Must be true to confirm deletion"),
    },
    async ({ id, confirm }) => {
      if (!confirm) return jsonContent({ error: "Deletion not confirmed" });
      return jsonContent(await client.call("sharing.smb.delete", [id]));
    },
  );

  // =========================================================================
  // SMB Global Config
  // =========================================================================

  server.tool(
    "smb_config",
    "Get global SMB configuration",
    {},
    async () => jsonContent(await client.call("smb.config")),
  );

  server.tool(
    "smb_config_update",
    "Update global SMB configuration",
    {
      netbiosname: z.string().optional().describe("NetBIOS name"),
      netbiosalias: z.array(z.string()).optional().describe("NetBIOS aliases"),
      workgroup: z.string().optional().describe("Workgroup"),
      description: z.string().optional().describe("Server description"),
      enable_smb1: z.boolean().optional().describe("Enable SMB1 protocol"),
      guest: z.string().optional().describe("Guest account"),
      admin_group: z.string().optional().describe("Admin group"),
      bindip: z.array(z.string()).optional().describe("Bind IP addresses"),
      localmaster: z.boolean().optional().describe("Local master browser"),
      aapl_extensions: z.boolean().optional().describe("Enable Apple SMB extensions"),
      multichannel: z.boolean().optional().describe("Enable SMB multichannel"),
    },
    async (params) => {
      const body = clean(params);
      return jsonContent(await client.call("smb.update", [body]));
    },
  );

  // =========================================================================
  // NFS Shares
  // =========================================================================

  server.tool(
    "nfs_share_list",
    "List all NFS shares/exports",
    {},
    async () => jsonContent(await client.call("sharing.nfs.query")),
  );

  server.tool(
    "nfs_share_get",
    "Get an NFS share by ID",
    { id: z.number().describe("NFS share ID") },
    async ({ id }) => jsonContent(await client.call("sharing.nfs.get_instance", [id])),
  );

  server.tool(
    "nfs_share_create",
    "Create a new NFS share/export",
    {
      path: z.string().describe("Filesystem path to export (e.g. '/mnt/tank/data')"),
      comment: z.string().optional().describe("Description / comment"),
      enabled: z.boolean().optional().describe("Whether the share is enabled"),
      ro: z.boolean().optional().describe("Read-only"),
      maproot_user: z.string().optional().describe("Map root to this user"),
      maproot_group: z.string().optional().describe("Map root to this group"),
      mapall_user: z.string().optional().describe("Map all users to this user"),
      mapall_group: z.string().optional().describe("Map all users to this group"),
      networks: z.array(z.string()).optional().describe("Allowed networks (CIDR)"),
      hosts: z.array(z.string()).optional().describe("Allowed hosts"),
      security: z.array(z.string()).optional().describe("Security flavors (e.g. sys, krb5, krb5i, krb5p)"),
    },
    async (params) => {
      if (params.path) validateTrueNASPath(params.path);
      const body = clean(params);
      return jsonContent(await client.call("sharing.nfs.create", [body]));
    },
  );

  server.tool(
    "nfs_share_update",
    "Update an existing NFS share/export",
    {
      id: z.number().describe("NFS share ID"),
      path: z.string().optional().describe("Filesystem path to export"),
      comment: z.string().optional().describe("Description / comment"),
      enabled: z.boolean().optional().describe("Whether the share is enabled"),
      ro: z.boolean().optional().describe("Read-only"),
      maproot_user: z.string().optional().describe("Map root to this user"),
      maproot_group: z.string().optional().describe("Map root to this group"),
      mapall_user: z.string().optional().describe("Map all users to this user"),
      mapall_group: z.string().optional().describe("Map all users to this group"),
      networks: z.array(z.string()).optional().describe("Allowed networks (CIDR)"),
      hosts: z.array(z.string()).optional().describe("Allowed hosts"),
      security: z.array(z.string()).optional().describe("Security flavors (e.g. sys, krb5, krb5i, krb5p)"),
    },
    async ({ id, ...rest }) => {
      if (rest.path) validateTrueNASPath(rest.path as string);
      const body = clean(rest);
      return jsonContent(await client.call("sharing.nfs.update", [id, body]));
    },
  );

  server.tool(
    "nfs_share_delete",
    "Delete an NFS share/export",
    {
      id: z.number().describe("NFS share ID"),
      confirm: z.boolean().describe("Must be true to confirm deletion"),
    },
    async ({ id, confirm }) => {
      if (!confirm) return jsonContent({ error: "Deletion not confirmed" });
      return jsonContent(await client.call("sharing.nfs.delete", [id]));
    },
  );

  // =========================================================================
  // NFS Global Config
  // =========================================================================

  server.tool(
    "nfs_config",
    "Get global NFS configuration",
    {},
    async () => jsonContent(await client.call("nfs.config")),
  );

  server.tool(
    "nfs_config_update",
    "Update global NFS configuration",
    {
      servers: z.number().optional().describe("Number of NFS server instances"),
      allow_nonroot: z.boolean().optional().describe("Allow non-root mount requests"),
      protocols: z.array(z.string()).optional().describe("Enabled protocols (NFSv3, NFSv4)"),
      v4_krb: z.boolean().optional().describe("Require Kerberos for NFSv4"),
      v4_domain: z.string().optional().describe("NFSv4 domain"),
      bindip: z.array(z.string()).optional().describe("Bind IP addresses"),
      mountd_port: z.number().optional().describe("mountd port"),
      rpcstatd_port: z.number().optional().describe("rpc.statd port"),
      rpclockd_port: z.number().optional().describe("rpc.lockd port"),
      userd_manage_gids: z.boolean().optional().describe("Allow server to manage group memberships"),
    },
    async (params) => {
      const body = clean(params);
      return jsonContent(await client.call("nfs.update", [body]));
    },
  );

  server.tool(
    "nfs_client_count",
    "Get the number of connected NFS clients",
    {},
    async () => jsonContent(await client.call("nfs.client_count")),
  );

  // =========================================================================
  // iSCSI — Global Config
  // =========================================================================

  server.tool(
    "iscsi_global_config",
    "Get iSCSI global configuration",
    {},
    async () => jsonContent(await client.call("iscsi.global.config")),
  );

  server.tool(
    "iscsi_global_config_update",
    "Update iSCSI global configuration",
    {
      basename: z.string().optional().describe("Base name (IQN) for iSCSI targets"),
      isns_servers: z.array(z.string()).optional().describe("iSNS server addresses"),
      pool_avail_threshold: z.number().optional().describe("Pool available space threshold (%)"),
      alua: z.boolean().optional().describe("Enable ALUA"),
    },
    async (params) => {
      const body = clean(params);
      return jsonContent(await client.call("iscsi.global.update", [body]));
    },
  );

  // =========================================================================
  // iSCSI — Targets
  // =========================================================================

  server.tool(
    "iscsi_target_list",
    "List all iSCSI targets",
    {},
    async () => jsonContent(await client.call("iscsi.target.query")),
  );

  server.tool(
    "iscsi_target_create",
    "Create an iSCSI target",
    {
      name: z.string().describe("Target name"),
      alias: z.string().optional().describe("Target alias"),
      mode: z.string().optional().describe("Target mode (e.g. ISCSI, FC, BOTH)"),
      groups: z
        .array(
          z.object({
            portal: z.number().describe("Portal group ID"),
            initiator: z.number().optional().describe("Initiator group ID"),
            auth: z.number().optional().describe("Auth group ID"),
            authmethod: z.string().optional().describe("Auth method (NONE, CHAP, CHAP_MUTUAL)"),
          }),
        )
        .optional()
        .describe("Target portal groups"),
    },
    async (params) => {
      const body = clean(params);
      return jsonContent(await client.call("iscsi.target.create", [body]));
    },
  );

  server.tool(
    "iscsi_target_update",
    "Update an iSCSI target",
    {
      id: z.number().describe("Target ID"),
      name: z.string().optional().describe("Target name"),
      alias: z.string().optional().describe("Target alias"),
      mode: z.string().optional().describe("Target mode"),
      groups: z
        .array(
          z.object({
            portal: z.number().describe("Portal group ID"),
            initiator: z.number().optional().describe("Initiator group ID"),
            auth: z.number().optional().describe("Auth group ID"),
            authmethod: z.string().optional().describe("Auth method"),
          }),
        )
        .optional()
        .describe("Target portal groups"),
    },
    async ({ id, ...rest }) => {
      const body = clean(rest);
      return jsonContent(await client.call("iscsi.target.update", [id, body]));
    },
  );

  server.tool(
    "iscsi_target_delete",
    "Delete an iSCSI target",
    {
      id: z.number().describe("Target ID"),
      force: z.boolean().optional().describe("Force deletion"),
      confirm: z.boolean().describe("Must be true to confirm deletion"),
    },
    async ({ id, force, confirm }) => {
      if (!confirm) return jsonContent({ error: "Deletion not confirmed" });
      return jsonContent(await client.call("iscsi.target.delete", force !== undefined ? [id, force] : [id]));
    },
  );

  // =========================================================================
  // iSCSI — Extents (LUNs)
  // =========================================================================

  server.tool(
    "iscsi_extent_list",
    "List all iSCSI extents (LUNs)",
    {},
    async () => jsonContent(await client.call("iscsi.extent.query")),
  );

  server.tool(
    "iscsi_extent_create",
    "Create an iSCSI extent (LUN)",
    {
      name: z.string().describe("Extent name"),
      type: z.enum(["DISK", "FILE"]).describe("Extent type"),
      disk: z.string().optional().describe("Disk device (when type=DISK)"),
      path: z.string().optional().describe("File path (when type=FILE)"),
      filesize: z.number().optional().describe("File size in bytes (when type=FILE)"),
      blocksize: z.number().optional().describe("Logical block size (512 or 4096)"),
      pblocksize: z.boolean().optional().describe("Disable physical block size reporting"),
      comment: z.string().optional().describe("Description / comment"),
      insecure_tpc: z.boolean().optional().describe("Enable insecure third-party copy"),
      xen: z.boolean().optional().describe("Xen compatibility"),
      rpm: z.string().optional().describe("RPM reporting (SSD, 5400, 7200, 10000, 15000)"),
      ro: z.boolean().optional().describe("Read-only"),
      enabled: z.boolean().optional().describe("Whether the extent is enabled"),
    },
    async (params) => {
      if (params.path) validateTrueNASPath(params.path);
      const body = clean(params);
      return jsonContent(await client.call("iscsi.extent.create", [body]));
    },
  );

  server.tool(
    "iscsi_extent_update",
    "Update an iSCSI extent (LUN)",
    {
      id: z.number().describe("Extent ID"),
      name: z.string().optional().describe("Extent name"),
      type: z.enum(["DISK", "FILE"]).optional().describe("Extent type"),
      disk: z.string().optional().describe("Disk device"),
      path: z.string().optional().describe("File path"),
      filesize: z.number().optional().describe("File size in bytes"),
      blocksize: z.number().optional().describe("Logical block size"),
      pblocksize: z.boolean().optional().describe("Disable physical block size reporting"),
      comment: z.string().optional().describe("Description / comment"),
      insecure_tpc: z.boolean().optional().describe("Enable insecure third-party copy"),
      xen: z.boolean().optional().describe("Xen compatibility"),
      rpm: z.string().optional().describe("RPM reporting"),
      ro: z.boolean().optional().describe("Read-only"),
      enabled: z.boolean().optional().describe("Whether the extent is enabled"),
    },
    async ({ id, ...rest }) => {
      if (rest.path) validateTrueNASPath(rest.path as string);
      const body = clean(rest);
      return jsonContent(await client.call("iscsi.extent.update", [id, body]));
    },
  );

  server.tool(
    "iscsi_extent_delete",
    "Delete an iSCSI extent (LUN)",
    {
      id: z.number().describe("Extent ID"),
      remove: z.boolean().optional().describe("Remove the underlying file"),
      force: z.boolean().optional().describe("Force deletion"),
      confirm: z.boolean().describe("Must be true to confirm deletion"),
    },
    async ({ id, remove, force, confirm }) => {
      if (!confirm) return jsonContent({ error: "Deletion not confirmed" });
      return jsonContent(await client.call("iscsi.extent.delete", [id, remove ?? false, force ?? false]));
    },
  );

  // =========================================================================
  // iSCSI — Portals
  // =========================================================================

  server.tool(
    "iscsi_portal_list",
    "List all iSCSI portals",
    {},
    async () => jsonContent(await client.call("iscsi.portal.query")),
  );

  server.tool(
    "iscsi_portal_create",
    "Create an iSCSI portal",
    {
      comment: z.string().optional().describe("Description / comment"),
      discovery_authmethod: z.string().optional().describe("Discovery auth method (NONE, CHAP, CHAP_MUTUAL)"),
      discovery_authgroup: z.number().optional().describe("Discovery auth group ID"),
      listen: z
        .array(
          z.object({
            ip: z.string().describe("Listen IP address"),
            port: z.number().optional().describe("Listen port (default 3260)"),
          }),
        )
        .describe("Listen addresses"),
    },
    async (params) => {
      const body = clean(params);
      return jsonContent(await client.call("iscsi.portal.create", [body]));
    },
  );

  server.tool(
    "iscsi_portal_update",
    "Update an iSCSI portal",
    {
      id: z.number().describe("Portal ID"),
      comment: z.string().optional().describe("Description / comment"),
      discovery_authmethod: z.string().optional().describe("Discovery auth method"),
      discovery_authgroup: z.number().optional().describe("Discovery auth group ID"),
      listen: z
        .array(
          z.object({
            ip: z.string().describe("Listen IP address"),
            port: z.number().optional().describe("Listen port"),
          }),
        )
        .optional()
        .describe("Listen addresses"),
    },
    async ({ id, ...rest }) => {
      const body = clean(rest);
      return jsonContent(await client.call("iscsi.portal.update", [id, body]));
    },
  );

  server.tool(
    "iscsi_portal_delete",
    "Delete an iSCSI portal",
    {
      id: z.number().describe("Portal ID"),
      confirm: z.boolean().describe("Must be true to confirm deletion"),
    },
    async ({ id, confirm }) => {
      if (!confirm) return jsonContent({ error: "Deletion not confirmed" });
      return jsonContent(await client.call("iscsi.portal.delete", [id]));
    },
  );

  // =========================================================================
  // iSCSI — Initiators
  // =========================================================================

  server.tool(
    "iscsi_initiator_list",
    "List all iSCSI initiator groups",
    {},
    async () => jsonContent(await client.call("iscsi.initiator.query")),
  );

  server.tool(
    "iscsi_initiator_create",
    "Create an iSCSI initiator group",
    {
      comment: z.string().optional().describe("Description / comment"),
      initiators: z.array(z.string()).optional().describe("Allowed initiator IQNs (empty = allow all)"),
    },
    async (params) => {
      const body = clean(params);
      return jsonContent(await client.call("iscsi.initiator.create", [body]));
    },
  );

  server.tool(
    "iscsi_initiator_delete",
    "Delete an iSCSI initiator group",
    {
      id: z.number().describe("Initiator group ID"),
      confirm: z.boolean().describe("Must be true to confirm deletion"),
    },
    async ({ id, confirm }) => {
      if (!confirm) return jsonContent({ error: "Deletion not confirmed" });
      return jsonContent(await client.call("iscsi.initiator.delete", [id]));
    },
  );

  // =========================================================================
  // iSCSI — Target-Extent Mappings
  // =========================================================================

  server.tool(
    "iscsi_targetextent_list",
    "List all iSCSI target-to-extent mappings",
    {},
    async () => jsonContent(await client.call("iscsi.targetextent.query")),
  );

  server.tool(
    "iscsi_targetextent_create",
    "Create an iSCSI target-to-extent mapping",
    {
      target: z.number().describe("Target ID"),
      extent: z.number().describe("Extent ID"),
      lunid: z.number().optional().describe("LUN ID (auto-assigned if omitted)"),
    },
    async (params) => {
      const body = clean(params);
      return jsonContent(await client.call("iscsi.targetextent.create", [body]));
    },
  );

  server.tool(
    "iscsi_targetextent_delete",
    "Delete an iSCSI target-to-extent mapping",
    {
      id: z.number().describe("Target-extent mapping ID"),
      force: z.boolean().optional().describe("Force deletion"),
      confirm: z.boolean().describe("Must be true to confirm deletion"),
    },
    async ({ id, force, confirm }) => {
      if (!confirm) return jsonContent({ error: "Deletion not confirmed" });
      return jsonContent(await client.call("iscsi.targetextent.delete", force !== undefined ? [id, force] : [id]));
    },
  );

  // =========================================================================
  // iSCSI — Sessions
  // =========================================================================

  server.tool(
    "iscsi_sessions",
    "Get active iSCSI sessions",
    {},
    async () => jsonContent(await client.call("iscsi.global.sessions")),
  );
}
