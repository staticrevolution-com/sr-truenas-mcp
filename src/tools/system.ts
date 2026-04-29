import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TrueNASClient } from "../client.js";

export function register(server: McpServer, client: TrueNASClient): void {
  // ---------------------------------------------------------------------------
  // System Information
  // ---------------------------------------------------------------------------

  server.tool(
    "system_info",
    "Get TrueNAS system information including hostname, version, uptime, CPU, memory, and hardware details. Use this to understand the system you are managing.",
    {},
    async () => {
      const result = await client.call("system.info");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "system_version",
    "Get the TrueNAS version string. Lightweight alternative to system_info when you only need the version.",
    {},
    async () => {
      const result = await client.call("system.version");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // System Power
  // ---------------------------------------------------------------------------

  server.tool(
    "system_reboot",
    "Reboot the TrueNAS system. This is a DESTRUCTIVE operation — all running services will be interrupted. The 'confirm' parameter must be set to true to proceed.",
    {
      confirm: z.boolean().describe("Must be true to confirm reboot"),
      delay: z.number().optional().default(0).describe("Delay in seconds before rebooting (default: 0)"),
    },
    async ({ confirm, delay }) => {
      if (!confirm) {
        return {
          content: [{ type: "text", text: "Reboot aborted: 'confirm' must be set to true." }],
        };
      }
      const result = await client.call("system.reboot", [{ delay }]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "system_shutdown",
    "Shut down the TrueNAS system. This is a DESTRUCTIVE operation — the system will power off and require physical or IPMI intervention to restart. The 'confirm' parameter must be set to true.",
    {
      confirm: z.boolean().describe("Must be true to confirm shutdown"),
      delay: z.number().optional().default(0).describe("Delay in seconds before shutting down (default: 0)"),
    },
    async ({ confirm, delay }) => {
      if (!confirm) {
        return {
          content: [{ type: "text", text: "Shutdown aborted: 'confirm' must be set to true." }],
        };
      }
      const result = await client.call("system.shutdown", [{ delay }]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // General Configuration
  // ---------------------------------------------------------------------------

  server.tool(
    "system_general_config",
    "Get general system configuration including timezone, language, UI port settings, and crash reporting preferences.",
    {},
    async () => {
      const result = await client.call("system.general.config");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // Allowlist of fields system.general.update accepts (per TrueNAS v27.0.0
  // docs: api_methods_system.general.update.html). Any other field is
  // rejected before reaching the API — the registry's `.passthrough()` mode
  // defeats Zod `.strict()`, so unknown-key rejection lives at handler level.
  const SYSTEM_GENERAL_UPDATE_FIELDS = [
    "ds_auth",
    "kbdmap",
    "rollback_timeout",
    "timezone",
    "ui_address",
    "ui_allowlist",
    "ui_certificate",
    "ui_certificate_name",
    "ui_consolemsg",
    "ui_httpsport",
    "ui_httpsprotocols",
    "ui_httpsredirect",
    "ui_port",
    "ui_restart_delay",
    "ui_x_frame_options",
    "usage_collection",
    "wizardshown",
  ] as const;
  const SYSTEM_GENERAL_UPDATE_FIELD_SET = new Set<string>(SYSTEM_GENERAL_UPDATE_FIELDS);

  server.tool(
    "system_general_update",
    "Update general system configuration. All fields are optional — only provide the ones you want to change. Changes to UI ports may require reconnecting on the new port. Unknown fields are rejected.",
    {
      ds_auth: z.boolean().optional().describe("Allow directory-service users to authenticate to the API/UI"),
      kbdmap: z.string().optional().describe("Keyboard map"),
      rollback_timeout: z.number().int().min(1).optional().describe("UI change rollback timeout in seconds"),
      timezone: z.string().optional().describe("System timezone, e.g. 'America/New_York'"),
      ui_address: z.array(z.string()).optional().describe("IPv4 addresses the UI listens on"),
      ui_allowlist: z.array(z.string()).optional().describe("CIDRs allowed to access the UI (empty = no restriction)"),
      ui_certificate: z.number().int().nullable().optional().describe("UI HTTPS certificate ID, or null"),
      ui_certificate_name: z.string().optional().describe("UI HTTPS certificate name"),
      ui_consolemsg: z.boolean().optional().describe("Show system messages on the console"),
      ui_httpsport: z.number().int().min(1).max(65535).optional().describe("HTTPS port for the web UI"),
      ui_httpsprotocols: z
        .array(z.enum(["TLSv1", "TLSv1.1", "TLSv1.2", "TLSv1.3"]))
        .optional()
        .describe("Allowed TLS protocols for the UI"),
      ui_httpsredirect: z.boolean().optional().describe("Whether to redirect HTTP to HTTPS"),
      ui_port: z.number().int().min(1).max(65535).optional().describe("HTTP port for the web UI"),
      ui_restart_delay: z.number().int().min(0).optional().describe("Delay before restarting the UI after a settings change"),
      ui_x_frame_options: z
        .enum(["SAMEORIGIN", "DENY", "ALLOW_ALL"])
        .optional()
        .describe("X-Frame-Options header for the UI"),
      usage_collection: z.boolean().nullable().optional().describe("Enable anonymous usage collection (null = use default)"),
      wizardshown: z.boolean().optional().describe("Whether the initial setup wizard has been shown"),
      confirm: z.boolean().describe("Must be true (tier-2 confirm gate)"),
    },
    async (params) => {
      // Reject any field outside the documented allowlist. Defends against an
      // LLM passing an unsupported field name; the registry's passthrough
      // would otherwise let it slip through to TrueNAS.
      const unknown = Object.keys(params).filter(
        (k) => k !== "confirm" && !SYSTEM_GENERAL_UPDATE_FIELD_SET.has(k),
      );
      if (unknown.length > 0) {
        throw new Error(
          `Unknown field(s) for system_general_update: ${unknown.join(", ")}. ` +
            `Allowed: ${SYSTEM_GENERAL_UPDATE_FIELDS.join(", ")}`,
        );
      }
      const body: Record<string, unknown> = {};
      for (const field of SYSTEM_GENERAL_UPDATE_FIELDS) {
        const value = (params as Record<string, unknown>)[field];
        if (value !== undefined) body[field] = value;
      }
      const result = await client.call("system.general.update", [body]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // Advanced Configuration
  // ---------------------------------------------------------------------------

  server.tool(
    "system_advanced_config",
    "Get advanced system configuration including console settings, serial port config, syslog, debug kernel, MOTD, and other low-level settings.",
    {},
    async () => {
      const result = await client.call("system.advanced.config");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // NTP Servers
  // ---------------------------------------------------------------------------

  server.tool(
    "system_ntp_servers",
    "List all configured NTP time servers. Use this to check time synchronization configuration.",
    {},
    async () => {
      const result = await client.call("system.ntpserver.query");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "system_ntp_server_create",
    "Add a new NTP time server to the system configuration.",
    {
      address: z.string().describe("NTP server hostname or IP address"),
      burst: z.boolean().optional().default(false).describe("Send a burst of packets when the server is reachable"),
      iburst: z.boolean().optional().default(true).describe("Send a burst of packets when the server is unreachable (speeds initial sync)"),
      prefer: z.boolean().optional().default(false).describe("Mark this server as preferred"),
      minpoll: z.number().optional().default(6).describe("Minimum polling interval as a power of 2 in seconds (default: 6 = 64s)"),
      maxpoll: z.number().optional().default(10).describe("Maximum polling interval as a power of 2 in seconds (default: 10 = 1024s)"),
    },
    async (params) => {
      const result = await client.call("system.ntpserver.create", [{
        address: params.address,
        burst: params.burst,
        iburst: params.iburst,
        prefer: params.prefer,
        minpoll: params.minpoll,
        maxpoll: params.maxpoll,
      }]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "system_ntp_server_delete",
    "Delete an NTP server by its ID. Use system_ntp_servers first to find the ID.",
    {
      id: z.number().describe("ID of the NTP server to delete"),
    },
    async ({ id }) => {
      const result = await client.call("system.ntpserver.delete", [id]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // Services
  // ---------------------------------------------------------------------------

  server.tool(
    "service_list",
    "List all system services with their current status (running/stopped) and whether they are enabled at boot. Useful for an overview of all available services.",
    {},
    async () => {
      const result = await client.call("service.query");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "service_get",
    "Get details of a specific service by its numeric ID, including its running state and boot-time enable status.",
    {
      id: z.number().describe("Numeric ID of the service"),
    },
    async ({ id }) => {
      const result = await client.call("service.get_instance", [id]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "service_update",
    "Enable or disable a service at boot time. This does NOT start or stop the service — use service_start / service_stop for that.",
    {
      id: z.number().describe("Numeric ID of the service"),
      enable: z.boolean().describe("Whether the service should start automatically at boot"),
    },
    async ({ id, enable }) => {
      const result = await client.call("service.update", [id, { enable }]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "service_start",
    "Start a service by name (e.g. 'ssh', 'smb', 'nfs', 'cifs', 'iscsitarget'). The service must exist. Use service_list to find available service names.",
    {
      service: z.string().describe("Name of the service to start, e.g. 'ssh', 'smb', 'nfs'"),
    },
    async ({ service }) => {
      const result = await client.call("service.control", ["START", service]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "service_stop",
    "Stop a running service by name (e.g. 'ssh', 'smb', 'nfs'). Use service_list to see which services are running.",
    {
      service: z.string().describe("Name of the service to stop"),
    },
    async ({ service }) => {
      const result = await client.call("service.control", ["STOP", service]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "service_restart",
    "Restart a service by name. Equivalent to stop + start. Useful after configuration changes that require a service reload.",
    {
      service: z.string().describe("Name of the service to restart"),
    },
    async ({ service }) => {
      const result = await client.call("service.control", ["RESTART", service]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // Config Backup
  // ---------------------------------------------------------------------------

  server.tool(
    "system_config_download",
    "Trigger a system configuration backup (database save). Returns or saves the system config. Options control whether to include the secret seed and pool encryption keys.",
    {
      secretseed: z.boolean().optional().default(false).describe("Include the password secret seed in the backup"),
      pool_keys: z.boolean().optional().default(false).describe("Include pool encryption keys in the backup"),
    },
    async () => {
      // config.save requires a pipe/output stream for the binary database file,
      // which is not supported over simple WebSocket JSON-RPC calls.
      return {
        content: [{
          type: "text",
          text: "System config download requires a binary file transfer pipe that is not available via the WebSocket API. Use the TrueNAS web UI: System > General > Manage Configuration > Download File.",
        }],
      };
    }
  );

  server.tool(
    "system_config_upload",
    "Upload a system configuration file to restore settings. Note: this endpoint typically expects a multipart file upload which may not be fully supported via the REST JSON client. Use the TrueNAS web UI for reliable config restores.",
    {},
    async () => {
      const result = await client.call("config.upload");
      return {
        content: [
          {
            type: "text",
            text: "Config upload via REST API requires multipart file upload, which is not supported by this tool. Please use the TrueNAS web UI to upload configuration files.\n\nEndpoint: POST /config/upload",
          },
        ],
      };
    }
  );

  // ---------------------------------------------------------------------------
  // Mail / SMTP
  // ---------------------------------------------------------------------------

  server.tool(
    "mail_config",
    "Get the current mail/SMTP configuration for system email alerts and notifications.",
    {},
    async () => {
      const result = await client.call("mail.config");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "mail_update",
    "Update mail/SMTP configuration for system email alerts. All fields are optional — only provide the ones you want to change.",
    {
      fromemail: z.string().optional().describe("From email address for outgoing mail"),
      outgoingserver: z.string().optional().describe("SMTP server hostname or IP"),
      port: z.number().optional().describe("SMTP server port (e.g. 25, 465, 587)"),
      security: z.enum(["PLAIN", "SSL", "TLS"]).optional().describe("Connection security: PLAIN, SSL, or TLS"),
      smtp: z.boolean().optional().describe("Whether SMTP authentication is required"),
      user: z.string().optional().describe("SMTP authentication username"),
      pass: z.string().optional().describe("SMTP authentication password"),
    },
    async (params) => {
      const body: Record<string, unknown> = {};
      if (params.fromemail !== undefined) body.fromemail = params.fromemail;
      if (params.outgoingserver !== undefined) body.outgoingserver = params.outgoingserver;
      if (params.port !== undefined) body.port = params.port;
      if (params.security !== undefined) body.security = params.security;
      if (params.smtp !== undefined) body.smtp = params.smtp;
      if (params.user !== undefined) body.user = params.user;
      if (params.pass !== undefined) body.pass = params.pass;
      const result = await client.call("mail.update", [body]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "mail_send",
    "Send a test email to verify mail configuration is working. Provide a subject, body text, and one or more recipient addresses.",
    {
      subject: z.string().describe("Email subject line"),
      text: z.string().describe("Email body text"),
      to: z.array(z.string()).describe("Array of recipient email addresses"),
    },
    async ({ subject, text, to }) => {
      const result = await client.call("mail.send", [{ subject, text, to }]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // API Keys
  // ---------------------------------------------------------------------------

  server.tool(
    "api_key_list",
    "List all API keys configured on the system. Shows key names and metadata (not the secret values).",
    {},
    async () => {
      const result = await client.call("api_key.query");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "api_key_create",
    "Create a new API key for programmatic access to the TrueNAS API. Returns the key — store it securely as it cannot be retrieved later.",
    {
      name: z.string().describe("A descriptive name for the API key"),
      allowlist: z
        .array(
          z.object({
            method: z.string().describe("HTTP method: GET, POST, PUT, DELETE, or *"),
            resource: z.string().describe("API resource path or * for all"),
          })
        )
        .optional()
        .describe("Optional list of allowed method/resource pairs. Omit for unrestricted access."),
    },
    async ({ name, allowlist }) => {
      const body: Record<string, unknown> = { name };
      if (allowlist !== undefined) body.allowlist = allowlist;
      const result = await client.call("api_key.create", [body]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "api_key_delete",
    "Delete an API key by its numeric ID. Use api_key_list to find the ID. This immediately revokes access for anyone using that key.",
    {
      id: z.number().describe("Numeric ID of the API key to delete"),
    },
    async ({ id }) => {
      const result = await client.call("api_key.delete", [id]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );
}
