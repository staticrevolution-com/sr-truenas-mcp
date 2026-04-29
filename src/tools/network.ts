import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TrueNASClient } from "../client.js";
import { validateTrueNASPath } from "../validation.js";

export function register(server: McpServer, client: TrueNASClient): void {
  // ---------------------------------------------------------------------------
  // Network Interfaces
  // ---------------------------------------------------------------------------

  server.tool(
    "network_interface_list",
    "List all network interfaces on the TrueNAS system, including physical NICs, VLANs, bridges, and bond/LAGG interfaces.",
    {},
    async () => {
      const result = await client.call("interface.query");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "network_interface_get",
    "Get details of a specific network interface by its ID (e.g. 'em0', 'br0', 'bond0').",
    {
      id: z.string().describe("Interface ID, e.g. 'em0', 'br0', 'bond0'"),
    },
    async ({ id }) => {
      const result = await client.call("interface.get_instance", [id]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "network_interface_create",
    "Create a new network interface (VLAN, bridge, or bond/LAGG). Network changes are staged until committed with network_commit_changes.",
    {
      type: z.enum(["BRIDGE", "LINK_AGGREGATION", "VLAN"]).describe("Type of interface to create"),
      name: z
        .string()
        .regex(
          /^[a-z0-9]+([-._][a-z0-9]+)*$/,
          "Interface name must be lowercase alphanumerics, optionally separated by '-', '.', or '_'",
        )
        .optional()
        .describe("Interface name"),
      ipv4_dhcp: z.boolean().optional().describe("Enable IPv4 DHCP"),
      ipv6_auto: z.boolean().optional().describe("Enable IPv6 auto-configuration"),
      aliases: z
        .array(
          z.object({
            address: z.string().describe("IP address"),
            netmask: z.number().describe("Subnet mask prefix length"),
          })
        )
        .optional()
        .describe("IP address aliases"),
      failover_aliases: z
        .array(
          z.object({
            address: z.string().describe("Failover IP address"),
          })
        )
        .optional()
        .describe("Failover aliases (HA systems)"),
      failover_virtual_aliases: z
        .array(
          z.object({
            address: z.string().describe("Virtual failover IP address"),
          })
        )
        .optional()
        .describe("Virtual failover aliases (HA systems)"),
      vlan_parent_interface: z.string().optional().describe("Parent interface for VLAN"),
      vlan_tag: z.number().optional().describe("VLAN tag (1-4094)"),
      vlan_pcp: z.number().optional().describe("VLAN priority code point"),
      lag_ports: z.array(z.string()).optional().describe("Member ports for LAGG/bond"),
      lag_protocol: z
        .enum(["LACP", "FAILOVER", "LOADBALANCE", "ROUNDROBIN", "NONE"])
        .optional()
        .describe("LAGG protocol"),
      bridge_members: z.array(z.string()).optional().describe("Member interfaces for bridge"),
      mtu: z.number().optional().describe("MTU (maximum transmission unit)"),
      options: z.string().optional().describe("Additional ifconfig options"),
    },
    async (params) => {
      const body: Record<string, unknown> = { type: params.type };
      if (params.name !== undefined) body.name = params.name;
      if (params.ipv4_dhcp !== undefined) body.ipv4_dhcp = params.ipv4_dhcp;
      if (params.ipv6_auto !== undefined) body.ipv6_auto = params.ipv6_auto;
      if (params.aliases !== undefined) body.aliases = params.aliases;
      if (params.failover_aliases !== undefined) body.failover_aliases = params.failover_aliases;
      if (params.failover_virtual_aliases !== undefined) body.failover_virtual_aliases = params.failover_virtual_aliases;
      if (params.vlan_parent_interface !== undefined) body.vlan_parent_interface = params.vlan_parent_interface;
      if (params.vlan_tag !== undefined) body.vlan_tag = params.vlan_tag;
      if (params.vlan_pcp !== undefined) body.vlan_pcp = params.vlan_pcp;
      if (params.lag_ports !== undefined) body.lag_ports = params.lag_ports;
      if (params.lag_protocol !== undefined) body.lag_protocol = params.lag_protocol;
      if (params.bridge_members !== undefined) body.bridge_members = params.bridge_members;
      if (params.mtu !== undefined) body.mtu = params.mtu;
      if (params.options !== undefined) body.options = params.options;
      const result = await client.call("interface.create", [body]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "network_interface_update",
    "Update an existing network interface. All fields are optional — only provide the ones you want to change. Network changes are staged until committed with network_commit_changes.",
    {
      id: z.string().describe("Interface ID to update, e.g. 'em0'"),
      ipv4_dhcp: z.boolean().optional().describe("Enable IPv4 DHCP"),
      ipv6_auto: z.boolean().optional().describe("Enable IPv6 auto-configuration"),
      aliases: z
        .array(
          z.object({
            address: z.string().describe("IP address"),
            netmask: z.number().describe("Subnet mask prefix length"),
          })
        )
        .optional()
        .describe("IP address aliases"),
      failover_aliases: z
        .array(
          z.object({
            address: z.string().describe("Failover IP address"),
          })
        )
        .optional()
        .describe("Failover aliases (HA systems)"),
      failover_virtual_aliases: z
        .array(
          z.object({
            address: z.string().describe("Virtual failover IP address"),
          })
        )
        .optional()
        .describe("Virtual failover aliases (HA systems)"),
      vlan_parent_interface: z.string().optional().describe("Parent interface for VLAN"),
      vlan_tag: z.number().optional().describe("VLAN tag (1-4094)"),
      vlan_pcp: z.number().optional().describe("VLAN priority code point"),
      lag_ports: z.array(z.string()).optional().describe("Member ports for LAGG/bond"),
      lag_protocol: z
        .enum(["LACP", "FAILOVER", "LOADBALANCE", "ROUNDROBIN", "NONE"])
        .optional()
        .describe("LAGG protocol"),
      bridge_members: z.array(z.string()).optional().describe("Member interfaces for bridge"),
      mtu: z.number().optional().describe("MTU (maximum transmission unit)"),
      options: z.string().optional().describe("Additional ifconfig options"),
    },
    async (params) => {
      const { id, ...rest } = params;
      const body: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(rest)) {
        if (value !== undefined) body[key] = value;
      }
      const result = await client.call("interface.update", [id, body]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "network_interface_delete",
    "Delete a network interface. This is a DESTRUCTIVE operation — the 'confirm' parameter must be set to true to proceed. Network changes are staged until committed.",
    {
      id: z.string().describe("Interface ID to delete"),
      confirm: z.boolean().describe("Must be true to confirm deletion"),
    },
    async ({ id, confirm }) => {
      if (!confirm) {
        return {
          content: [{ type: "text", text: "Delete aborted: 'confirm' must be set to true." }],
        };
      }
      const result = await client.call("interface.delete", [id]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // Network Configuration
  // ---------------------------------------------------------------------------

  server.tool(
    "network_config",
    "Get the global network configuration including hostname, domain, gateways, nameservers, and proxy settings.",
    {},
    async () => {
      const result = await client.call("network.configuration.config");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "network_config_update",
    "Update global network configuration. All fields are optional — only provide the ones you want to change.",
    {
      hostname: z.string().optional().describe("System hostname"),
      domain: z.string().optional().describe("System domain name"),
      ipv4gateway: z.string().optional().describe("Default IPv4 gateway"),
      ipv6gateway: z.string().optional().describe("Default IPv6 gateway"),
      nameserver1: z.string().optional().describe("Primary DNS nameserver"),
      nameserver2: z.string().optional().describe("Secondary DNS nameserver"),
      nameserver3: z.string().optional().describe("Tertiary DNS nameserver"),
      httpproxy: z.string().optional().describe("HTTP proxy URL"),
      hosts: z.string().optional().describe("Additional hosts file entries"),
      activity: z
        .object({
          type: z.enum(["ALLOW", "DENY"]).describe("Activity type"),
          activities: z.array(z.string()).optional().describe("List of activities"),
        })
        .optional()
        .describe("Network activity configuration"),
    },
    async (params) => {
      const body: Record<string, unknown> = {};
      if (params.hostname !== undefined) body.hostname = params.hostname;
      if (params.domain !== undefined) body.domain = params.domain;
      if (params.ipv4gateway !== undefined) body.ipv4gateway = params.ipv4gateway;
      if (params.ipv6gateway !== undefined) body.ipv6gateway = params.ipv6gateway;
      if (params.nameserver1 !== undefined) body.nameserver1 = params.nameserver1;
      if (params.nameserver2 !== undefined) body.nameserver2 = params.nameserver2;
      if (params.nameserver3 !== undefined) body.nameserver3 = params.nameserver3;
      if (params.httpproxy !== undefined) body.httpproxy = params.httpproxy;
      if (params.hosts !== undefined) body.hosts = params.hosts;
      if (params.activity !== undefined) body.activity = params.activity;
      const result = await client.call("network.configuration.update", [body]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "network_summary",
    "Get a summary of the network configuration including all interfaces, IPs, default routes, and nameservers.",
    {},
    async () => {
      const result = await client.call("network.general.summary");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // Static Routes
  // ---------------------------------------------------------------------------

  server.tool(
    "network_static_route_list",
    "List all configured static routes.",
    {},
    async () => {
      const result = await client.call("staticroute.query");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "network_static_route_create",
    "Create a new static route.",
    {
      destination: z.string().describe("Destination network in CIDR notation, e.g. '10.0.0.0/24'"),
      gateway: z.string().describe("Gateway IP address"),
      description: z.string().optional().describe("Optional description for the route"),
    },
    async (params) => {
      const body: Record<string, unknown> = {
        destination: params.destination,
        gateway: params.gateway,
      };
      if (params.description !== undefined) body.description = params.description;
      const result = await client.call("staticroute.create", [body]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "network_static_route_delete",
    "Delete a static route by its numeric ID. Use network_static_route_list to find the ID.",
    {
      id: z.number().describe("Numeric ID of the static route to delete"),
    },
    async ({ id }) => {
      const result = await client.call("staticroute.delete", [id]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // IPMI
  // ---------------------------------------------------------------------------

  server.tool(
    "network_ipmi_info",
    "Get IPMI chassis information if IPMI is available on this system. First checks whether IPMI hardware is present.",
    {},
    async () => {
      const isLoaded = await client.call("ipmi.is_loaded") as boolean;
      if (!isLoaded) {
        return {
          content: [{ type: "text", text: "IPMI is not available on this system." }],
        };
      }
      const info = await client.call("ipmi.chassis.info");
      return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // Network Change Management
  // ---------------------------------------------------------------------------

  server.tool(
    "network_commit_changes",
    "Commit pending network interface changes. Network changes are staged and must be committed to take effect. Use checkin_timeout to set a rollback timer — if you do not check in (network_checkin) within that time, changes are automatically rolled back.",
    {
      checkin_timeout: z.number().describe("Timeout in seconds before automatic rollback if not checked in (e.g. 60)"),
    },
    async ({ checkin_timeout }) => {
      const result = await client.call("interface.commit", [{ checkin_timeout }]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "network_rollback_changes",
    "Rollback all pending (uncommitted) network interface changes, restoring the previous network configuration.",
    {},
    async () => {
      const result = await client.call("interface.rollback");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "network_checkin",
    "Check in after committing network changes to confirm they are working. This prevents the automatic rollback that occurs if you don't check in within the checkin_timeout window.",
    {},
    async () => {
      const result = await client.call("interface.checkin");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // Users
  // ---------------------------------------------------------------------------

  server.tool(
    "user_list",
    "List all users on the TrueNAS system, including system and local accounts.",
    {},
    async () => {
      const result = await client.call("user.query");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "user_get",
    "Get details of a specific user by their numeric ID.",
    {
      id: z.number().describe("Numeric user ID"),
    },
    async ({ id }) => {
      const result = await client.call("user.get_instance", [id]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "user_create",
    "Create a new user account on the TrueNAS system.",
    {
      username: z.string().describe("Login username"),
      group: z.number().optional().describe("Primary group ID. Omit if using group_create."),
      group_create: z.boolean().optional().describe("Automatically create a new group with the same name as the user"),
      full_name: z.string().describe("Full name of the user"),
      email: z.string().optional().describe("Email address"),
      password: z.string().optional().describe("User password"),
      uid: z.number().optional().describe("Unix UID. If omitted, auto-assigned."),
      smb: z.boolean().optional().describe("Enable SMB/Samba authentication for this user"),
      home: z.string().optional().describe("Home directory path"),
      home_create: z.boolean().optional().describe("Create the home directory if it does not exist"),
      shell: z.string().optional().describe("Login shell path, e.g. '/bin/bash'. Use user_shell_choices to see options."),
      sudo_commands: z.array(z.string()).optional().describe("Commands this user can run with sudo"),
      sudo_commands_nopasswd: z.array(z.string()).optional().describe("Commands this user can run with sudo without a password"),
      locked: z.boolean().optional().describe("Whether the account is locked"),
      microsoft_account: z.boolean().optional().describe("Whether this is a Microsoft account"),
      ssh_password_enabled: z.boolean().optional().describe("Allow SSH login with password"),
      sshpubkey: z.string().optional().describe("SSH public key for key-based authentication"),
    },
    async (params) => {
      const body: Record<string, unknown> = {
        username: params.username,
        full_name: params.full_name,
      };
      if (params.group !== undefined) body.group = params.group;
      if (params.group_create !== undefined) body.group_create = params.group_create;
      if (params.email !== undefined) body.email = params.email;
      if (params.password !== undefined) body.password = params.password;
      if (params.uid !== undefined) body.uid = params.uid;
      if (params.smb !== undefined) body.smb = params.smb;
      if (params.home !== undefined) { validateTrueNASPath(params.home); body.home = params.home; }
      if (params.home_create !== undefined) body.home_create = params.home_create;
      if (params.shell !== undefined) body.shell = params.shell;
      if (params.sudo_commands !== undefined) body.sudo_commands = params.sudo_commands;
      if (params.sudo_commands_nopasswd !== undefined) body.sudo_commands_nopasswd = params.sudo_commands_nopasswd;
      if (params.locked !== undefined) body.locked = params.locked;
      if (params.microsoft_account !== undefined) body.microsoft_account = params.microsoft_account;
      if (params.ssh_password_enabled !== undefined) body.ssh_password_enabled = params.ssh_password_enabled;
      if (params.sshpubkey !== undefined) body.sshpubkey = params.sshpubkey;
      const result = await client.call("user.create", [body]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "user_update",
    "Update an existing user account. All fields are optional — only provide the ones you want to change.",
    {
      id: z.number().describe("Numeric user ID to update"),
      username: z.string().optional().describe("Login username"),
      group: z.number().optional().describe("Primary group ID"),
      full_name: z.string().optional().describe("Full name of the user"),
      email: z.string().optional().describe("Email address"),
      password: z.string().optional().describe("User password"),
      uid: z.number().optional().describe("Unix UID"),
      smb: z.boolean().optional().describe("Enable SMB/Samba authentication"),
      home: z.string().optional().describe("Home directory path"),
      home_create: z.boolean().optional().describe("Create the home directory if it does not exist"),
      shell: z.string().optional().describe("Login shell path"),
      sudo_commands: z.array(z.string()).optional().describe("Commands this user can run with sudo"),
      sudo_commands_nopasswd: z.array(z.string()).optional().describe("Commands this user can run with sudo without a password"),
      locked: z.boolean().optional().describe("Whether the account is locked"),
      microsoft_account: z.boolean().optional().describe("Whether this is a Microsoft account"),
      ssh_password_enabled: z.boolean().optional().describe("Allow SSH login with password"),
      sshpubkey: z.string().optional().describe("SSH public key"),
    },
    async (params) => {
      const { id, ...rest } = params;
      if (rest.home !== undefined) validateTrueNASPath(rest.home as string);
      const body: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(rest)) {
        if (value !== undefined) body[key] = value;
      }
      const result = await client.call("user.update", [id, body]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "user_delete",
    "Delete a user account. This is a DESTRUCTIVE operation — the 'confirm' parameter must be set to true to proceed.",
    {
      id: z.number().describe("Numeric user ID to delete"),
      delete_group: z.boolean().optional().default(false).describe("Also delete the user's primary group if no other users belong to it"),
      confirm: z.boolean().describe("Must be true to confirm deletion"),
    },
    async ({ id, delete_group, confirm }) => {
      if (!confirm) {
        return {
          content: [{ type: "text", text: "Delete aborted: 'confirm' must be set to true." }],
        };
      }
      const result = await client.call("user.delete", [id, { delete_group }]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "user_shell_choices",
    "Get a list of available login shells on the system. Useful when creating or updating a user to know which shells are valid.",
    {},
    async () => {
      const result = await client.call("user.shell_choices");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "user_set_password",
    "Set or change a user's password by username.",
    {
      username: z.string().describe("Username of the account"),
      new_password: z.string().describe("New password"),
      old_password: z.string().optional().describe("Current password (required for non-root users changing their own password)"),
    },
    async ({ username, new_password, old_password }) => {
      const body: Record<string, unknown> = { username, new_password };
      if (old_password !== undefined) body.old_password = old_password;
      const result = await client.call("user.set_password", [body]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // Groups
  // ---------------------------------------------------------------------------

  server.tool(
    "group_list",
    "List all groups on the TrueNAS system.",
    {},
    async () => {
      const result = await client.call("group.query");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "group_get",
    "Get details of a specific group by its numeric ID.",
    {
      id: z.number().describe("Numeric group ID"),
    },
    async ({ id }) => {
      const result = await client.call("group.get_instance", [id]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "group_create",
    "Create a new group on the TrueNAS system.",
    {
      gid: z.number().optional().describe("Unix GID. If omitted, auto-assigned."),
      name: z.string().describe("Group name"),
      smb: z.boolean().optional().describe("Enable SMB/Samba for this group"),
      sudo_commands: z.array(z.string()).optional().describe("Commands members can run with sudo"),
      sudo_commands_nopasswd: z.array(z.string()).optional().describe("Commands members can run with sudo without a password"),
      users: z.array(z.number()).optional().describe("Array of user IDs to add as members"),
    },
    async (params) => {
      const body: Record<string, unknown> = { name: params.name };
      if (params.gid !== undefined) body.gid = params.gid;
      if (params.smb !== undefined) body.smb = params.smb;
      if (params.sudo_commands !== undefined) body.sudo_commands = params.sudo_commands;
      if (params.sudo_commands_nopasswd !== undefined) body.sudo_commands_nopasswd = params.sudo_commands_nopasswd;
      if (params.users !== undefined) body.users = params.users;
      const result = await client.call("group.create", [body]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "group_update",
    "Update an existing group. All fields are optional — only provide the ones you want to change.",
    {
      id: z.number().describe("Numeric group ID to update"),
      gid: z.number().optional().describe("Unix GID"),
      name: z.string().optional().describe("Group name"),
      smb: z.boolean().optional().describe("Enable SMB/Samba for this group"),
      sudo_commands: z.array(z.string()).optional().describe("Commands members can run with sudo"),
      sudo_commands_nopasswd: z.array(z.string()).optional().describe("Commands members can run with sudo without a password"),
      users: z.array(z.number()).optional().describe("Array of user IDs to set as members"),
    },
    async (params) => {
      const { id, ...rest } = params;
      const body: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(rest)) {
        if (value !== undefined) body[key] = value;
      }
      const result = await client.call("group.update", [id, body]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "group_delete",
    "Delete a group. This is a DESTRUCTIVE operation — the 'confirm' parameter must be set to true to proceed.",
    {
      id: z.number().describe("Numeric group ID to delete"),
      delete_users: z.boolean().optional().default(false).describe("Also delete all users that have this as their primary group"),
      confirm: z.boolean().describe("Must be true to confirm deletion"),
    },
    async ({ id, delete_users, confirm }) => {
      if (!confirm) {
        return {
          content: [{ type: "text", text: "Delete aborted: 'confirm' must be set to true." }],
        };
      }
      const result = await client.call("group.delete", [id, { delete_users }]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // Disks
  // ---------------------------------------------------------------------------

  server.tool(
    "disk_list",
    "List all physical disks in the TrueNAS system with their details including serial numbers, sizes, and pool membership.",
    {},
    async () => {
      const result = await client.call("disk.query");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "disk_get",
    "Get details of a specific disk by its device name (e.g. 'sda', 'nvme0n1').",
    {
      id: z.string().describe("Disk identifier, e.g. 'sda', 'nvme0n1'"),
    },
    async ({ id }) => {
      const disks = await client.call("disk.query", [[["name", "=", id]]]) as unknown[];
      const result = Array.isArray(disks) && disks.length > 0 ? disks[0] : { error: `Disk "${id}" not found` };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "disk_update",
    "Update disk settings such as description, power management, SMART monitoring, and standby configuration.",
    {
      id: z.string().describe("Disk identifier, e.g. 'sda'"),
      description: z.string().optional().describe("Disk description"),
      standby: z.number().optional().describe("Standby timeout in minutes (0 to disable)"),
      advpowermgmt: z.string().optional().describe("Advanced power management level (DISABLED, 1, 64, 127, 128, 192, 254)"),
      togglesmart: z.boolean().optional().describe("Enable or disable SMART monitoring for this disk"),
      smartoptions: z.string().optional().describe("Extra smartctl options"),
      critical: z.number().optional().describe("Critical temperature threshold in Celsius"),
      difference: z.number().optional().describe("Temperature difference threshold for alerts"),
      informational: z.number().optional().describe("Informational temperature threshold in Celsius"),
      hddstandby: z.string().optional().describe("HDD standby setting"),
      passwd: z.string().optional().describe("SED (Self-Encrypting Drive) password"),
      email: z.string().optional().describe("Email address for disk alerts"),
      enclosure_slot: z.number().optional().describe("Physical enclosure slot number"),
    },
    async (params) => {
      const { id, ...rest } = params;
      const body: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(rest)) {
        if (value !== undefined) body[key] = value;
      }
      const result = await client.call("disk.update", [id, body]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "disk_wipe",
    "Wipe a disk, destroying all data on it. This is a DESTRUCTIVE operation — the 'confirm' parameter must be set to true to proceed. Returns a job ID that can be monitored.",
    {
      id: z.string().describe("Disk identifier, e.g. 'sda'"),
      dev_name: z.string().describe("Device name to wipe, e.g. 'sda'"),
      mode: z
        .enum(["QUICK", "FULL", "FULL_RANDOM"])
        .describe(
          "Wipe mode: QUICK erases partitions, FULL overwrites with zeros, FULL_RANDOM with random data",
        ),
      synccache: z.boolean().optional().default(true).describe("Sync cache after wipe"),
      confirm: z.boolean().describe("Must be true to confirm wipe"),
    },
    async ({ id, dev_name, mode, synccache, confirm }) => {
      if (!confirm) {
        return {
          content: [{ type: "text", text: "Wipe aborted: 'confirm' must be set to true." }],
        };
      }
      const result = await client.call("disk.wipe", [dev_name, mode, synccache]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "disk_temperatures",
    "Get current temperatures for one or more disks. Omit names to get all disk temperatures.",
    {
      names: z.array(z.string()).optional().describe("Disk device names, e.g. ['sda', 'sdb']. Omit for all disks."),
    },
    async (params) => {
      let names = params.names;
      if (!names) {
        const disks = await client.call("disk.query") as Array<{ name: string }>;
        names = disks.map((d) => d.name);
      }
      const result = await client.call("disk.temperatures", [names]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // SMART Tests
  // ---------------------------------------------------------------------------

  server.tool(
    "disk_smart_test_list",
    "List SMART test results. Optionally filter by disk name.",
    {
      disk: z.string().optional().describe("Disk device name to filter results, e.g. 'sda'. Omit for all disks."),
    },
    async ({ disk }) => {
      // SMART test results are included in disk.query response (tests_results field)
      const filters = disk ? [[["name", "=", disk]]] : [];
      const result = await client.call("disk.query", filters);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "disk_smart_test_run",
    "Run a SMART test on one or more disks. Returns a job ID for the test.",
    {
      disks: z.array(z.string()).describe("Array of disk device names to test, e.g. ['sda', 'sdb']"),
      type: z.enum(["LONG", "SHORT", "CONVEYANCE", "OFFLINE"]).describe("Type of SMART test to run"),
    },
    async ({ disks, type }) => {
      // SMART test initiation is not available in the WebSocket API
      return {
        content: [{
          type: "text",
          text: `SMART test initiation is not available via the TrueNAS WebSocket API. Use the TrueNAS web UI to run SMART tests on disks: ${disks.join(", ")} (type: ${type}).`,
        }],
      };
    }
  );
}
