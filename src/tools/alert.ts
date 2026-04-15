import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TrueNASClient } from "../client.js";

export function register(server: McpServer, client: TrueNASClient): void {
  // ---------------------------------------------------------------------------
  // Alerts
  // ---------------------------------------------------------------------------

  server.tool(
    "alert_list",
    "List all active alerts on the TrueNAS system. Shows alert level, message, source, and dismissal status.",
    {},
    async () => {
      const result = await client.call("alert.list");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "alert_dismiss",
    "Dismiss an alert by its UUID. Dismissed alerts no longer appear as active but can be restored.",
    {
      uuid: z.string().describe("UUID of the alert to dismiss"),
    },
    async ({ uuid }) => {
      const result = await client.call("alert.dismiss", [uuid]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "alert_restore",
    "Restore a previously dismissed alert by its UUID, making it active again.",
    {
      uuid: z.string().describe("UUID of the alert to restore"),
    },
    async ({ uuid }) => {
      const result = await client.call("alert.restore", [uuid]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "alert_categories",
    "List all available alert categories. Useful for understanding the types of alerts the system can generate.",
    {},
    async () => {
      const result = await client.call("alert.list_categories");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "alert_policies",
    "List all available alert policies. Policies define how alerts are escalated and delivered.",
    {},
    async () => {
      const result = await client.call("alert.list_policies");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // Alert Services
  // ---------------------------------------------------------------------------

  server.tool(
    "alertservice_list",
    "List all configured alert notification services (e.g. email, Slack, PagerDuty). Shows their type, enabled status, and alert level.",
    {},
    async () => {
      const result = await client.call("alertservice.query");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "alertservice_create",
    "Create a new alert notification service. Configures how and where alerts are delivered.",
    {
      name: z.string().describe("Display name for this alert service"),
      type: z
        .enum([
          "Mail",
          "Slack",
          "PagerDuty",
          "OpsGenie",
          "SNMP",
          "Telegram",
          "Mattermost",
          "VictorOps",
          "InfluxDB",
        ])
        .describe("Service type"),
      attributes: z
        .record(z.string(), z.unknown())
        .describe("Service-specific attributes (e.g. webhook URL, API key, channel). Varies by type."),
      enabled: z.boolean().describe("Whether this alert service is enabled"),
      level: z
        .enum(["INFO", "NOTICE", "WARNING", "ERROR", "CRITICAL", "ALERT", "EMERGENCY"])
        .describe("Minimum alert level to trigger this service"),
    },
    async ({ name, type, attributes, enabled, level }) => {
      const result = await client.call("alertservice.create", [{
        name,
        type,
        attributes,
        enabled,
        level,
      }]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "alertservice_update",
    "Update an existing alert notification service by its ID. All fields are optional — only provide the ones to change.",
    {
      id: z.number().describe("ID of the alert service to update"),
      name: z.string().optional().describe("Display name for this alert service"),
      type: z
        .enum([
          "Mail",
          "Slack",
          "PagerDuty",
          "OpsGenie",
          "SNMP",
          "Telegram",
          "Mattermost",
          "VictorOps",
          "InfluxDB",
        ])
        .optional()
        .describe("Service type"),
      attributes: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Service-specific attributes"),
      enabled: z.boolean().optional().describe("Whether this alert service is enabled"),
      level: z
        .enum(["INFO", "NOTICE", "WARNING", "ERROR", "CRITICAL", "ALERT", "EMERGENCY"])
        .optional()
        .describe("Minimum alert level to trigger this service"),
    },
    async ({ id, ...params }) => {
      const body: Record<string, unknown> = {};
      if (params.name !== undefined) body.name = params.name;
      if (params.type !== undefined) body.type = params.type;
      if (params.attributes !== undefined) body.attributes = params.attributes;
      if (params.enabled !== undefined) body.enabled = params.enabled;
      if (params.level !== undefined) body.level = params.level;
      const result = await client.call("alertservice.update", [id, body]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "alertservice_delete",
    "Delete an alert notification service by its ID. Use alertservice_list to find the ID.",
    {
      id: z.number().describe("ID of the alert service to delete"),
    },
    async ({ id }) => {
      const result = await client.call("alertservice.delete", [id]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "alertservice_test",
    "Send a test notification through an alert service to verify it is configured correctly.",
    {
      id: z.number().describe("ID of the alert service to test"),
    },
    async ({ id }) => {
      const result = await client.call("alertservice.test", [id]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // Certificates
  // ---------------------------------------------------------------------------

  server.tool(
    "certificate_list",
    "List all certificates on the system, including self-signed, imported, CSR, and ACME certificates.",
    {},
    async () => {
      const result = await client.call("certificate.query");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "certificate_get",
    "Get a specific certificate by its numeric ID. Returns full certificate details including the PEM content.",
    {
      id: z.number().describe("Numeric ID of the certificate"),
    },
    async ({ id }) => {
      const result = await client.call("certificate.get_instance", [id]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "certificate_create",
    "Create a new certificate. Supports internal (self-signed), CSR, imported, and ACME certificate types. Only name and create_type are required; other fields depend on the create_type.",
    {
      name: z.string().describe("Name for the certificate"),
      create_type: z
        .enum([
          "CERTIFICATE_CREATE_INTERNAL",
          "CERTIFICATE_CREATE_CSR",
          "CERTIFICATE_CREATE_IMPORTED",
          "CERTIFICATE_CREATE_ACME",
        ])
        .describe("Type of certificate to create"),
      key_type: z.string().optional().describe("Key type, e.g. 'RSA' or 'EC'"),
      key_length: z.number().optional().describe("RSA key length in bits (e.g. 2048, 4096)"),
      ec_curve: z.string().optional().describe("Elliptic curve name for EC keys (e.g. 'SECP256R1')"),
      digest_algorithm: z.string().optional().describe("Digest algorithm, e.g. 'SHA256'"),
      lifetime: z.number().optional().describe("Certificate lifetime in days"),
      country: z.string().optional().describe("Two-letter country code (e.g. 'US')"),
      state: z.string().optional().describe("State or province name"),
      city: z.string().optional().describe("City or locality name"),
      organization: z.string().optional().describe("Organization name"),
      organizational_unit: z.string().optional().describe("Organizational unit name"),
      email: z.string().optional().describe("Contact email address"),
      common: z.string().optional().describe("Common name (CN) for the certificate"),
      san: z.array(z.string()).optional().describe("Subject Alternative Names"),
      cert_extensions: z.record(z.string(), z.unknown()).optional().describe("Certificate extensions object"),
      signedby: z.number().optional().describe("ID of the CA to sign this certificate"),
      certificate: z.string().optional().describe("PEM certificate data (for imported type)"),
      privatekey: z.string().optional().describe("PEM private key data (for imported type)"),
      acme_directory_uri: z.string().optional().describe("ACME directory URI (for ACME type)"),
      domains: z.array(z.string()).optional().describe("Domain names for ACME certificate"),
    },
    async ({ name, create_type, ...opts }) => {
      const body: Record<string, unknown> = { name, create_type };
      for (const [key, value] of Object.entries(opts)) {
        if (value !== undefined) body[key] = value;
      }
      const result = await client.call("certificate.create", [body]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "certificate_delete",
    "Delete a certificate by its ID. This is a DESTRUCTIVE operation — the 'confirm' parameter must be true to proceed. Optionally force deletion even if the certificate is in use.",
    {
      id: z.number().describe("Numeric ID of the certificate to delete"),
      confirm: z.boolean().describe("Must be true to confirm deletion"),
      force: z.boolean().optional().default(false).describe("Force deletion even if the certificate is in use"),
    },
    async ({ id, confirm, force }) => {
      if (!confirm) {
        return {
          content: [{ type: "text", text: "Deletion aborted: 'confirm' must be set to true." }],
        };
      }
      const result = await client.call("certificate.delete", [id, force]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "certificate_acme_servers",
    "List available ACME server choices (e.g. Let's Encrypt production/staging). Use when configuring ACME certificates.",
    {},
    async () => {
      const result = await client.call("certificate.acme_server_choices");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // ACME DNS Authenticators
  // ---------------------------------------------------------------------------

  server.tool(
    "acme_dns_authenticator_list",
    "List all configured ACME DNS authenticators. These are used for DNS-01 challenge validation when issuing ACME certificates.",
    {},
    async () => {
      const result = await client.call("acme.dns.authenticator.query");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "acme_dns_authenticator_create",
    "Create a new ACME DNS authenticator for DNS-01 challenge validation. The attributes depend on the authenticator type (e.g. Cloudflare, Route53).",
    {
      name: z.string().describe("Display name for this DNS authenticator"),
      authenticator: z.string().describe("Authenticator type (e.g. 'cloudflare', 'route53')"),
      attributes: z.record(z.string(), z.unknown()).describe("Authenticator-specific attributes (e.g. API tokens, credentials)"),
    },
    async ({ name, authenticator, attributes }) => {
      const result = await client.call("acme.dns.authenticator.create", [{
        name,
        authenticator,
        attributes,
      }]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "acme_dns_authenticator_delete",
    "Delete an ACME DNS authenticator by its ID.",
    {
      id: z.number().describe("ID of the ACME DNS authenticator to delete"),
    },
    async ({ id }) => {
      const result = await client.call("acme.dns.authenticator.delete", [id]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // System Updates
  // ---------------------------------------------------------------------------

  server.tool(
    "update_check",
    "Check for available system updates. Returns information about pending updates and the current train.",
    {},
    async () => {
      const result = await client.call("update.available_versions");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "update_config",
    "Get the current update configuration, including the active update train.",
    {},
    async () => {
      const result = await client.call("update.config");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "update_config_set",
    "Set the update configuration. Currently supports changing the update train.",
    {
      train: z.string().describe("Name of the update train to switch to"),
    },
    async ({ train }) => {
      const result = await client.call("update.update", [{ train }]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "update_download",
    "Download pending system updates. This starts the download process; the system is not updated until update_apply is called.",
    {},
    async () => {
      const result = await client.call("update.download");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "update_apply",
    "Apply previously downloaded system updates. This is a DESTRUCTIVE operation that may reboot the system. The 'confirm' parameter must be true to proceed.",
    {
      confirm: z.boolean().describe("Must be true to confirm applying updates"),
      reboot: z.boolean().optional().default(false).describe("Whether to reboot after applying updates"),
    },
    async ({ confirm, reboot }) => {
      if (!confirm) {
        return {
          content: [{ type: "text", text: "Update aborted: 'confirm' must be set to true." }],
        };
      }
      const result = await client.call("update.run", [{ reboot }]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // Boot Environments
  // ---------------------------------------------------------------------------

  server.tool(
    "bootenv_list",
    "List all boot environments. Shows name, active status, creation date, size, and keep flag.",
    {},
    async () => {
      const result = await client.call("boot.environment.query");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "bootenv_create",
    "Create a new boot environment by cloning an existing one. Useful for creating a restore point before updates.",
    {
      name: z.string().describe("Name for the new boot environment"),
      source: z.string().optional().describe("Name of the source boot environment to clone. Defaults to the currently active one."),
    },
    async ({ name, source }) => {
      const body: Record<string, unknown> = { name };
      if (source !== undefined) body.source = source;
      const result = await client.call("boot.environment.clone", [body]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "bootenv_activate",
    "Activate a boot environment so it will be used on next boot.",
    {
      id: z.string().describe("Name/ID of the boot environment to activate"),
    },
    async ({ id }) => {
      const result = await client.call("boot.environment.activate", [id]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "bootenv_delete",
    "Delete a boot environment. This is a DESTRUCTIVE operation — the 'confirm' parameter must be true to proceed. Cannot delete the currently active boot environment.",
    {
      id: z.string().describe("Name/ID of the boot environment to delete"),
      confirm: z.boolean().describe("Must be true to confirm deletion"),
    },
    async ({ id, confirm }) => {
      if (!confirm) {
        return {
          content: [{ type: "text", text: "Deletion aborted: 'confirm' must be set to true." }],
        };
      }
      const result = await client.call("boot.environment.destroy", [id]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "bootenv_keep",
    "Set or clear the 'keep' flag on a boot environment. Boot environments with keep=true are protected from automatic pruning.",
    {
      id: z.string().describe("Name/ID of the boot environment"),
      keep: z.boolean().describe("Whether to keep (protect) this boot environment"),
    },
    async ({ id, keep }) => {
      const result = await client.call("boot.environment.keep", [id, { keep }]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // Boot Pool
  // ---------------------------------------------------------------------------

  server.tool(
    "boot_state",
    "Get the current state of the boot pool, including disk layout, health status, and capacity.",
    {},
    async () => {
      const result = await client.call("boot.get_state");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "boot_attach_disk",
    "Attach a disk to the boot pool to create or extend a mirror. This is a DESTRUCTIVE operation that will erase the target disk. The 'confirm' parameter must be true to proceed.",
    {
      dev: z.string().describe("Device name of the disk to attach (e.g. 'sdb')"),
      expand: z.boolean().optional().default(false).describe("Whether to expand the pool size if the new disk is larger"),
      confirm: z.boolean().describe("Must be true to confirm attaching the disk"),
    },
    async ({ dev, expand, confirm }) => {
      if (!confirm) {
        return {
          content: [{ type: "text", text: "Attach aborted: 'confirm' must be set to true." }],
        };
      }
      const result = await client.call("boot.attach", [dev, { expand }]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "boot_detach_disk",
    "Detach a disk from the boot pool mirror. This is a DESTRUCTIVE operation — the 'confirm' parameter must be true to proceed.",
    {
      dev: z.string().describe("Device name of the disk to detach (e.g. 'sdb')"),
      confirm: z.boolean().describe("Must be true to confirm detaching the disk"),
    },
    async ({ dev, confirm }) => {
      if (!confirm) {
        return {
          content: [{ type: "text", text: "Detach aborted: 'confirm' must be set to true." }],
        };
      }
      const result = await client.call("boot.detach", [dev]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "boot_scrub",
    "Start a scrub of the boot pool to check for and repair data integrity issues.",
    {},
    async () => {
      const result = await client.call("boot.scrub");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );
}
