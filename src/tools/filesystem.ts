import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TrueNASClient } from "../client.js";
import { validateTrueNASPath } from "../validation.js";

/**
 * filesystem.chown / filesystem.setperm / filesystem.setacl are @job methods
 * in middlewared — the immediate return value is a job id, not an outcome.
 * Wait for the job so a failed job surfaces as an error instead of the
 * enqueue being reported as success.
 */
async function awaitJobResult(client: TrueNASClient, raw: unknown): Promise<unknown> {
  if (typeof raw !== "number") return raw;
  const job = await client.waitForJob(raw);
  return job.result ?? { job_id: raw, state: job.state };
}

export function register(server: McpServer, client: TrueNASClient): void {
  // ---------------------------------------------------------------------------
  // Filesystem
  // ---------------------------------------------------------------------------

  server.tool(
    "filesystem_stat",
    "Get file or directory info including permissions, size, owner, and timestamps. Provide the full path on the TrueNAS system.",
    {
      path: z.string().describe("Full filesystem path, e.g. '/mnt/tank/data'"),
    },
    async ({ path }) => {
      const validPath = validateTrueNASPath(path);
      const result = await client.call("filesystem.stat", [validPath]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "filesystem_listdir",
    "List contents of a directory. Returns files and subdirectories with metadata. Supports pagination via limit and offset.",
    {
      path: z.string().describe("Full directory path to list"),
      limit: z.number().optional().default(100).describe("Maximum number of entries to return (default: 100)"),
      offset: z.number().optional().default(0).describe("Number of entries to skip (default: 0)"),
    },
    async ({ path, limit, offset }) => {
      const validPath = validateTrueNASPath(path);
      const result = await client.call("filesystem.listdir", [validPath, [], { limit, offset }]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "filesystem_mkdir",
    "Create a new directory at the specified path. Optionally set the UNIX mode (permissions).",
    {
      path: z.string().describe("Full path of the directory to create"),
      mode: z.string().optional().default("755").describe("UNIX permission mode, e.g. '755' (default: '755')"),
    },
    async ({ path, mode }) => {
      const validPath = validateTrueNASPath(path);
      const result = await client.call("filesystem.mkdir", [{ path: validPath, options: { mode } }]);
      // mkdir can report success while the parent dataset is unmounted,
      // leaving nothing on disk (observed live on 26.0.0-BETA.1) — stat back.
      try {
        await client.call("filesystem.stat", [validPath]);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(
          `filesystem.mkdir reported success but post-write verification failed — '${validPath}' does not exist (is the parent dataset mounted?): ${detail}`
        );
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "filesystem_set_permissions",
    "Set UNIX permissions on a file or directory. Can optionally apply recursively and strip existing ACLs.",
    {
      path: z.string().describe("Full filesystem path"),
      mode: z.string().optional().describe("UNIX permission mode, e.g. '755'"),
      uid: z.number().optional().describe("Owner user ID"),
      gid: z.number().optional().describe("Owner group ID"),
      recursive: z.boolean().optional().default(false).describe("Apply recursively to contents"),
      traverse: z.boolean().optional().default(false).describe("Traverse filesystem boundaries"),
      stripacl: z.boolean().optional().default(false).describe("Strip existing ACLs when setting permissions"),
    },
    async ({ path, mode, uid, gid, recursive, traverse, stripacl }) => {
      const validPath = validateTrueNASPath(path);
      const body: Record<string, unknown> = { path: validPath };
      if (mode !== undefined) body.mode = mode;
      if (uid !== undefined) body.uid = uid;
      if (gid !== undefined) body.gid = gid;
      body.options = { recursive, traverse, stripacl };
      const result = await awaitJobResult(client, await client.call("filesystem.setperm", [body]));
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "filesystem_get_acl",
    "Get the Access Control List (ACL) for a file or directory path. Optionally return a simplified representation.",
    {
      path: z.string().describe("Full filesystem path"),
      simplified: z.boolean().optional().default(false).describe("Return simplified ACL representation"),
    },
    async ({ path, simplified }) => {
      const validPath = validateTrueNASPath(path);
      const result = await client.call("filesystem.getacl", [validPath, simplified]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "filesystem_set_acl",
    "Set the Access Control List (ACL) for a file or directory. This is a powerful operation — the 'confirm' parameter must be true to proceed.",
    {
      confirm: z.boolean().describe("Must be true to confirm ACL change"),
      path: z.string().describe("Full filesystem path"),
      dacl: z.array(z.record(z.string(), z.unknown())).describe("Array of ACL entry objects"),
      nfs41_flags: z.record(z.string(), z.unknown()).optional().describe("NFS 4.1 ACL flags"),
      acltype: z.string().optional().describe("ACL type: NFS4 or POSIX1E"),
      uid: z.number().optional().describe("Owner user ID"),
      gid: z.number().optional().describe("Owner group ID"),
      options: z.record(z.string(), z.unknown()).optional().describe("Additional options (e.g. recursive, traverse, stripacl)"),
    },
    async ({ confirm, path, dacl, nfs41_flags, acltype, uid, gid, options }) => {
      if (!confirm) {
        return {
          content: [{ type: "text", text: "ACL change aborted: 'confirm' must be set to true." }],
        };
      }
      const validPath = validateTrueNASPath(path);
      const body: Record<string, unknown> = { path: validPath, dacl };
      if (nfs41_flags !== undefined) body.nfs41_flags = nfs41_flags;
      if (acltype !== undefined) body.acltype = acltype;
      if (uid !== undefined) body.uid = uid;
      if (gid !== undefined) body.gid = gid;
      if (options !== undefined) body.options = options;
      const result = await awaitJobResult(client, await client.call("filesystem.setacl", [body]));
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "filesystem_chown",
    "Change ownership of a file or directory. Can optionally apply recursively.",
    {
      path: z.string().describe("Full filesystem path"),
      uid: z.number().optional().describe("New owner user ID"),
      gid: z.number().optional().describe("New owner group ID"),
      recursive: z.boolean().optional().default(false).describe("Apply recursively to contents"),
      traverse: z.boolean().optional().default(false).describe("Traverse filesystem boundaries"),
    },
    async ({ path, uid, gid, recursive, traverse }) => {
      const validPath = validateTrueNASPath(path);
      const body: Record<string, unknown> = { path: validPath };
      if (uid !== undefined) body.uid = uid;
      if (gid !== undefined) body.gid = gid;
      body.options = { recursive, traverse };
      const result = await awaitJobResult(client, await client.call("filesystem.chown", [body]));
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // Reporting / Monitoring
  // ---------------------------------------------------------------------------

  server.tool(
    "reporting_config",
    "Get the current reporting/metrics configuration.",
    {},
    async () => {
      const result = await client.call("reporting.config");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "reporting_graphs",
    "List all available reporting graphs (CPU, memory, disk, network, etc.). Use the graph names with reporting_get_data to fetch time-series data.",
    {},
    async () => {
      const result = await client.call("reporting.netdata_graphs");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "reporting_get_data",
    "Get time-series reporting data for one or more graphs (CPU, memory, disk, network, etc.). Use reporting_graphs first to discover available graph names and identifiers.",
    {
      graphs: z
        .array(
          z.object({
            name: z.string().describe("Graph name, e.g. 'cpu', 'memory', 'disk', 'interface'"),
            identifier: z.string().optional().describe("Graph identifier, e.g. disk name or interface name"),
          })
        )
        .describe("Array of graphs to query"),
      start: z.string().optional().describe("Start time in ISO 8601 or epoch format"),
      end: z.string().optional().describe("End time in ISO 8601 or epoch format"),
      aggregate: z.boolean().optional().default(true).describe("Whether to aggregate data points"),
    },
    async ({ graphs, start, end, aggregate }) => {
      const query: Record<string, unknown> = { aggregate };
      if (start !== undefined) query.start = start;
      if (end !== undefined) query.end = end;
      const result = await client.call("reporting.get_data", [graphs, query]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // Directory Services
  // ---------------------------------------------------------------------------

  server.tool(
    "directory_services_config",
    "Get directory services configuration (Active Directory / LDAP).",
    {},
    async () => {
      const result = await client.call("directoryservices.config");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "directory_services_update",
    "Update directory services configuration. Fields depend on whether Active Directory or LDAP is configured. Pass only the fields you want to change.",
    {
      config: z.record(z.string(), z.unknown()).describe("Directory services configuration fields to update"),
    },
    async ({ config }) => {
      const result = await client.call("directoryservices.update", [config]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "directory_services_status",
    "Get current directory services status including connection state and health.",
    {},
    async () => {
      const result = await client.call("directoryservices.status");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "directory_services_leave",
    "Leave the current Active Directory or LDAP domain. This is a DESTRUCTIVE operation — 'confirm' must be true to proceed. Requires domain credentials.",
    {
      confirm: z.boolean().describe("Must be true to confirm leaving the domain"),
      username: z.string().describe("Domain username with permission to leave"),
      password: z.string().describe("Domain password"),
    },
    async ({ confirm, username, password }) => {
      if (!confirm) {
        return {
          content: [{ type: "text", text: "Leave domain aborted: 'confirm' must be set to true." }],
        };
      }
      const result = await client.call("directoryservices.leave", [{ credential: { credential_type: "KERBEROS_USER", username, password } }]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "directory_services_cache_refresh",
    "Refresh the directory services cache. Forces re-read of users and groups from the directory server.",
    {},
    async () => {
      const result = await client.call("directoryservices.cache_refresh");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "kerberos_config",
    "Get Kerberos configuration settings.",
    {},
    async () => {
      const result = await client.call("kerberos.config");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "kerberos_realm_list",
    "List all configured Kerberos realms.",
    {},
    async () => {
      const result = await client.call("kerberos.realm.query");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "kerberos_keytab_list",
    "List all configured Kerberos keytabs.",
    {},
    async () => {
      const result = await client.call("kerberos.keytab.query");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // Tunable (sysctl / loader / rc)
  // ---------------------------------------------------------------------------

  server.tool(
    "tunable_list",
    "List all system tunables (sysctl, loader, and rc variables).",
    {},
    async () => {
      const result = await client.call("tunable.query");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "tunable_create",
    "Create a new system tunable. Tunables allow setting sysctl, loader, or rc variables.",
    {
      type: z.enum(["SYSCTL", "LOADER", "RC"]).describe("Tunable type"),
      var: z.string().describe("Variable name, e.g. 'net.inet.tcp.recvspace'"),
      value: z.string().describe("Variable value"),
      comment: z.string().optional().default("").describe("Optional comment describing the tunable"),
      enabled: z.boolean().optional().default(true).describe("Whether the tunable is active"),
    },
    async ({ type, var: varName, value, comment, enabled }) => {
      const result = await client.call("tunable.create", [{
        type,
        var: varName,
        value,
        comment,
        enabled,
      }]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "tunable_update",
    "Update an existing tunable by its ID. Use tunable_list to find the ID. All fields are optional — only provide the ones to change.",
    {
      id: z.number().describe("Tunable ID"),
      type: z.enum(["SYSCTL", "LOADER", "RC"]).optional().describe("Tunable type"),
      var: z.string().optional().describe("Variable name"),
      value: z.string().optional().describe("Variable value"),
      comment: z.string().optional().describe("Comment"),
      enabled: z.boolean().optional().describe("Whether the tunable is active"),
    },
    async ({ id, type, var: varName, value, comment, enabled }) => {
      const body: Record<string, unknown> = {};
      if (type !== undefined) body.type = type;
      if (varName !== undefined) body.var = varName;
      if (value !== undefined) body.value = value;
      if (comment !== undefined) body.comment = comment;
      if (enabled !== undefined) body.enabled = enabled;
      const result = await client.call("tunable.update", [id, body]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "tunable_delete",
    "Delete a tunable by its ID. Use tunable_list to find the ID.",
    {
      id: z.number().describe("Tunable ID to delete"),
    },
    async ({ id }) => {
      const result = await client.call("tunable.delete", [id]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // Service Configs — SSH
  // ---------------------------------------------------------------------------

  server.tool(
    "ssh_config",
    "Get the current SSH service configuration.",
    {},
    async () => {
      const result = await client.call("ssh.config");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "ssh_config_update",
    "Update SSH service configuration. All fields are optional — only provide the ones you want to change. Restart the SSH service after changes.",
    {
      tcpport: z.number().optional().describe("SSH listening port (default: 22)"),
      rootlogin: z.boolean().optional().describe("Allow root login via SSH"),
      passwordauth: z.boolean().optional().describe("Allow password authentication"),
      kerberosauth: z.boolean().optional().describe("Allow Kerberos authentication"),
      tcpfwd: z.boolean().optional().describe("Allow TCP forwarding"),
      bindiface: z.array(z.string()).optional().describe("Interfaces to bind SSH to"),
      compression: z.boolean().optional().describe("Enable compression"),
      sftp_log_level: z.string().optional().describe("SFTP log level"),
      sftp_log_facility: z.string().optional().describe("SFTP log facility"),
      weak_ciphers: z.array(z.string()).optional().describe("List of weak ciphers to allow"),
      options: z.string().optional().describe("Additional sshd_config options"),
    },
    async (params) => {
      const body: Record<string, unknown> = {};
      if (params.tcpport !== undefined) body.tcpport = params.tcpport;
      if (params.rootlogin !== undefined) body.rootlogin = params.rootlogin;
      if (params.passwordauth !== undefined) body.passwordauth = params.passwordauth;
      if (params.kerberosauth !== undefined) body.kerberosauth = params.kerberosauth;
      if (params.tcpfwd !== undefined) body.tcpfwd = params.tcpfwd;
      if (params.bindiface !== undefined) body.bindiface = params.bindiface;
      if (params.compression !== undefined) body.compression = params.compression;
      if (params.sftp_log_level !== undefined) body.sftp_log_level = params.sftp_log_level;
      if (params.sftp_log_facility !== undefined) body.sftp_log_facility = params.sftp_log_facility;
      if (params.weak_ciphers !== undefined) body.weak_ciphers = params.weak_ciphers;
      if (params.options !== undefined) body.options = params.options;
      const result = await client.call("ssh.update", [body]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // Service Configs — FTP
  // ---------------------------------------------------------------------------

  server.tool(
    "ftp_config",
    "Get the current FTP service configuration.",
    {},
    async () => {
      const result = await client.call("ftp.config");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "ftp_config_update",
    "Update FTP service configuration. All fields are optional — only provide the ones you want to change. Restart the FTP service after changes.",
    {
      port: z.number().optional().describe("FTP listening port"),
      clients: z.number().optional().describe("Maximum number of simultaneous clients"),
      ipconnections: z.number().optional().describe("Maximum connections per IP"),
      loginattempt: z.number().optional().describe("Maximum login attempts before disconnect"),
      timeout: z.number().optional().describe("Idle timeout in seconds"),
      rootlogin: z.boolean().optional().describe("Allow root login"),
      onlyanonymous: z.boolean().optional().describe("Allow only anonymous access"),
      anonpath: z.string().optional().describe("Path for anonymous FTP root"),
      onlylocal: z.boolean().optional().describe("Allow only local user access"),
      banner: z.string().optional().describe("FTP banner message"),
      filemask: z.string().optional().describe("File creation umask"),
      dirmask: z.string().optional().describe("Directory creation umask"),
      localuserbw: z.number().optional().describe("Local user upload bandwidth limit (KB/s, 0=unlimited)"),
      localuserdlbw: z.number().optional().describe("Local user download bandwidth limit (KB/s, 0=unlimited)"),
      anonuserbw: z.number().optional().describe("Anonymous user upload bandwidth limit (KB/s, 0=unlimited)"),
      anonuserdlbw: z.number().optional().describe("Anonymous user download bandwidth limit (KB/s, 0=unlimited)"),
      tls: z.boolean().optional().describe("Enable TLS"),
      tls_policy: z.string().optional().describe("TLS policy: on, off, data, !data, auth, ctrl, ctrl+data, ctrl+!data, auth+data, auth+!data"),
      tls_opt_allow_client_renegotiations: z.boolean().optional().describe("Allow client renegotiations"),
      tls_opt_allow_dot_login: z.boolean().optional().describe("Allow dot-login"),
      tls_opt_allow_per_user: z.boolean().optional().describe("Allow per-user TLS"),
      tls_opt_common_name_required: z.boolean().optional().describe("Require common name"),
      tls_opt_enable_diags: z.boolean().optional().describe("Enable TLS diagnostics"),
      tls_opt_export_cert_data: z.boolean().optional().describe("Export certificate data"),
      tls_opt_no_cert_request: z.boolean().optional().describe("Do not request client certificate"),
      tls_opt_no_empty_fragments: z.boolean().optional().describe("No empty fragments"),
      tls_opt_no_session_reuse_required: z.boolean().optional().describe("Do not require session reuse"),
      tls_opt_stdenvvars: z.boolean().optional().describe("Set standard environment variables"),
      tls_opt_dns_name_required: z.boolean().optional().describe("Require DNS name"),
      tls_opt_ip_address_required: z.boolean().optional().describe("Require IP address"),
      ssltls_certificate: z.number().optional().describe("SSL/TLS certificate ID"),
      options: z.string().optional().describe("Additional proftpd options"),
      resume: z.boolean().optional().describe("Allow resume of transfers"),
      defaultroot: z.boolean().optional().describe("Chroot users to home directory"),
      reversedns: z.boolean().optional().describe("Enable reverse DNS lookups"),
      masqaddress: z.string().optional().describe("Masquerade address for NAT"),
      passiveportsmin: z.number().optional().describe("Minimum passive port"),
      passiveportsmax: z.number().optional().describe("Maximum passive port"),
    },
    async (params) => {
      const body: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) body[key] = value;
      }
      const result = await client.call("ftp.update", [body]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // Service Configs — SNMP
  // ---------------------------------------------------------------------------

  server.tool(
    "snmp_config",
    "Get the current SNMP service configuration.",
    {},
    async () => {
      const result = await client.call("snmp.config");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "snmp_config_update",
    "Update SNMP service configuration. All fields are optional — only provide the ones you want to change.",
    {
      community: z.string().optional().describe("SNMP community string (v1/v2c)"),
      contact: z.string().optional().describe("System contact information"),
      location: z.string().optional().describe("System location"),
      traps: z.boolean().optional().describe("Enable SNMP traps"),
      v3: z.boolean().optional().describe("Enable SNMPv3"),
      v3_username: z.string().optional().describe("SNMPv3 username"),
      v3_authtype: z.string().optional().describe("SNMPv3 auth type: MD5 or SHA"),
      v3_password: z.string().optional().describe("SNMPv3 auth password"),
      v3_privproto: z.string().optional().describe("SNMPv3 privacy protocol: AES or DES"),
      v3_privpassphrase: z.string().optional().describe("SNMPv3 privacy passphrase"),
      loglevel: z.number().optional().describe("Log level (0-7)"),
      options: z.string().optional().describe("Additional SNMP options"),
    },
    async (params) => {
      const body: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) body[key] = value;
      }
      const result = await client.call("snmp.update", [body]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // Service Configs — UPS
  // ---------------------------------------------------------------------------

  server.tool(
    "ups_config",
    "Get the current UPS service configuration.",
    {},
    async () => {
      const result = await client.call("ups.config");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "ups_config_update",
    "Update UPS service configuration. All fields are optional — only provide the ones you want to change.",
    {
      mode: z.enum(["MASTER", "SLAVE"]).optional().describe("UPS mode: MASTER or SLAVE"),
      identifier: z.string().optional().describe("UPS identifier name"),
      remotehost: z.string().optional().describe("Remote UPS host (for SLAVE mode)"),
      remoteport: z.number().optional().describe("Remote UPS port (for SLAVE mode)"),
      driver: z.string().optional().describe("UPS driver name"),
      port: z.string().optional().describe("UPS device port/path"),
      monuser: z.string().optional().describe("Monitor username"),
      monpwd: z.string().optional().describe("Monitor password"),
      extrausers: z.string().optional().describe("Extra users configuration"),
      rmonitor: z.boolean().optional().describe("Enable remote monitoring"),
      shutdown: z.enum(["LOWBATT", "BATT"]).optional().describe("Shutdown mode: LOWBATT or BATT"),
      shutdowntimer: z.number().optional().describe("Shutdown timer in seconds"),
      shutdowncmd: z.string().optional().describe("Custom shutdown command"),
      powerdown: z.boolean().optional().describe("Power down UPS after shutdown"),
      nocommwarntime: z.number().optional().describe("No-communication warning time in seconds"),
      hostsync: z.number().optional().describe("Host synchronization timeout in seconds"),
      description: z.string().optional().describe("UPS description"),
      options: z.string().optional().describe("Additional UPS options"),
      complete_identifier: z.string().optional().describe("Complete UPS identifier string"),
    },
    async (params) => {
      const body: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) body[key] = value;
      }
      const result = await client.call("ups.update", [body]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // Privilege & Audit
  // ---------------------------------------------------------------------------

  server.tool(
    "privilege_list",
    "List all privileges/roles configured on the system.",
    {},
    async () => {
      const result = await client.call("privilege.query");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "privilege_create",
    "Create a new privilege/role with specific permissions and group bindings.",
    {
      name: z.string().describe("Privilege name"),
      local_groups: z.array(z.number()).optional().default([]).describe("Array of local group IDs"),
      ds_groups: z.array(z.number()).optional().default([]).describe("Array of directory service group IDs"),
      allowlist: z
        .array(
          z.object({
            method: z.string().describe("HTTP method: GET, POST, PUT, DELETE, or *"),
            resource: z.string().describe("API resource path or * for all"),
          })
        )
        .optional()
        .default([])
        .describe("API allowlist entries"),
      web_shell: z.boolean().optional().default(false).describe("Allow web shell access"),
      roles: z.array(z.string()).optional().default([]).describe("Array of role names to assign"),
    },
    async ({ name, local_groups, ds_groups, allowlist, web_shell, roles }) => {
      const result = await client.call("privilege.create", [{
        name,
        local_groups,
        ds_groups,
        allowlist,
        web_shell,
        roles,
      }]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "privilege_update",
    "Update an existing privilege/role by its ID. Use privilege_list to find the ID. All fields are optional.",
    {
      id: z.number().describe("Privilege ID"),
      name: z.string().optional().describe("Privilege name"),
      local_groups: z.array(z.number()).optional().describe("Array of local group IDs"),
      ds_groups: z.array(z.number()).optional().describe("Array of directory service group IDs"),
      allowlist: z
        .array(
          z.object({
            method: z.string().describe("HTTP method"),
            resource: z.string().describe("API resource path"),
          })
        )
        .optional()
        .describe("API allowlist entries"),
      web_shell: z.boolean().optional().describe("Allow web shell access"),
      roles: z.array(z.string()).optional().describe("Array of role names"),
    },
    async ({ id, ...rest }) => {
      const body: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(rest)) {
        if (value !== undefined) body[key] = value;
      }
      const result = await client.call("privilege.update", [id, body]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "privilege_delete",
    "Delete a privilege/role by its ID. Use privilege_list to find the ID.",
    {
      id: z.number().describe("Privilege ID to delete"),
    },
    async ({ id }) => {
      const result = await client.call("privilege.delete", [id]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "audit_query",
    "Query the TrueNAS audit log. Supports filtering by services and applying query filters and options.",
    {
      services: z.array(z.string()).optional().describe("Services to query, e.g. ['SMB', 'MIDDLEWARE']"),
      query_filters: z.array(z.array(z.unknown())).optional().default([]).describe("Query filter conditions as arrays, e.g. [['service', '=', 'SMB']]"),
      query_options: z.record(z.string(), z.unknown()).optional().default({}).describe("Query options like { limit: 50, offset: 0, order_by: ['-id'] }"),
    },
    async ({ services, query_filters, query_options }) => {
      const body: Record<string, unknown> = {};
      if (services !== undefined) body.services = services;
      body["query-filters"] = query_filters;
      body["query-options"] = query_options;
      const result = await client.call("audit.query", [body]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "audit_config",
    "Get the current audit configuration including retention and quota settings.",
    {},
    async () => {
      const result = await client.call("audit.config");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "audit_config_update",
    "Update audit configuration. All fields are optional — only provide the ones you want to change.",
    {
      retention: z.number().optional().describe("Retention period in days"),
      reservation: z.number().optional().describe("Space reservation in GiB"),
      quota: z.number().optional().describe("Maximum quota in GiB"),
      quota_fill_warning: z.number().optional().describe("Percentage at which to warn about quota usage"),
      quota_fill_critical: z.number().optional().describe("Percentage at which quota usage is critical"),
    },
    async (params) => {
      const body: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) body[key] = value;
      }
      const result = await client.call("audit.update", [body]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

}
