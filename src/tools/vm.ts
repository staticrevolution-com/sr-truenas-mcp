import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TrueNASClient } from "../client.js";

export function register(server: McpServer, client: TrueNASClient): void {
  // ---------------------------------------------------------------------------
  // Virtual Machines
  // ---------------------------------------------------------------------------

  server.tool(
    "vm_list",
    "List all virtual machines on the TrueNAS system, including their configuration and status.",
    {},
    async () => {
      const result = await client.call("vm.query");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "vm_get",
    "Get detailed information about a specific VM by its numeric ID.",
    {
      id: z.number().describe("Numeric ID of the VM"),
    },
    async ({ id }) => {
      const result = await client.call("vm.get_instance", [id]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "vm_create",
    "Create a new virtual machine. At minimum provide a name and memory (in MiB). Other fields have sensible defaults.",
    {
      name: z.string().describe("Name of the VM"),
      description: z.string().optional().describe("Description of the VM"),
      vcpus: z.number().optional().describe("Number of virtual CPUs"),
      cores: z.number().optional().describe("Number of cores per virtual CPU"),
      threads: z.number().optional().describe("Number of threads per core"),
      memory: z.number().describe("Memory in MiB"),
      bootloader: z.enum(["UEFI", "UEFI_CSM"]).optional().describe("Bootloader type"),
      autostart: z.boolean().optional().describe("Whether to start the VM automatically on boot"),
      time: z.enum(["LOCAL", "UTC"]).optional().describe("System time setting for the VM"),
      shutdown_timeout: z.number().optional().describe("Timeout in seconds for graceful shutdown"),
      cpu_mode: z.string().optional().describe("CPU mode (e.g. CUSTOM, HOST_MODEL, HOST_PASSTHROUGH)"),
      cpu_model: z.string().optional().describe("CPU model when cpu_mode is CUSTOM"),
      machine_type: z.string().optional().describe("Machine type (e.g. q35, i440fx)"),
      hide_from_msr: z.boolean().optional().describe("Hide the hypervisor from MSR (useful for GPU passthrough)"),
      ensure_display_device: z.boolean().optional().describe("Ensure a display device is added"),
      arch_type: z.string().optional().describe("Architecture type (e.g. x86_64, aarch64)"),
      hyperv_enlightenments: z.boolean().optional().describe("Enable Hyper-V enlightenments for Windows guests"),
    },
    async (params) => {
      const body: Record<string, unknown> = { name: params.name, memory: params.memory };
      if (params.description !== undefined) body.description = params.description;
      if (params.vcpus !== undefined) body.vcpus = params.vcpus;
      if (params.cores !== undefined) body.cores = params.cores;
      if (params.threads !== undefined) body.threads = params.threads;
      if (params.bootloader !== undefined) body.bootloader = params.bootloader;
      if (params.autostart !== undefined) body.autostart = params.autostart;
      if (params.time !== undefined) body.time = params.time;
      if (params.shutdown_timeout !== undefined) body.shutdown_timeout = params.shutdown_timeout;
      if (params.cpu_mode !== undefined) body.cpu_mode = params.cpu_mode;
      if (params.cpu_model !== undefined) body.cpu_model = params.cpu_model;
      if (params.machine_type !== undefined) body.machine_type = params.machine_type;
      if (params.hide_from_msr !== undefined) body.hide_from_msr = params.hide_from_msr;
      if (params.ensure_display_device !== undefined) body.ensure_display_device = params.ensure_display_device;
      if (params.arch_type !== undefined) body.arch_type = params.arch_type;
      if (params.hyperv_enlightenments !== undefined) body.hyperv_enlightenments = params.hyperv_enlightenments;
      const result = await client.call("vm.create", [body]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "vm_update",
    "Update an existing VM's configuration. Provide the VM ID and any fields to change. Only provided fields are updated.",
    {
      id: z.number().describe("Numeric ID of the VM to update"),
      name: z.string().optional().describe("New name for the VM"),
      description: z.string().optional().describe("New description"),
      vcpus: z.number().optional().describe("Number of virtual CPUs"),
      cores: z.number().optional().describe("Number of cores per virtual CPU"),
      threads: z.number().optional().describe("Number of threads per core"),
      memory: z.number().optional().describe("Memory in MiB"),
      bootloader: z.enum(["UEFI", "UEFI_CSM"]).optional().describe("Bootloader type"),
      autostart: z.boolean().optional().describe("Whether to start the VM automatically on boot"),
      time: z.enum(["LOCAL", "UTC"]).optional().describe("System time setting for the VM"),
      shutdown_timeout: z.number().optional().describe("Timeout in seconds for graceful shutdown"),
      cpu_mode: z.string().optional().describe("CPU mode"),
      cpu_model: z.string().optional().describe("CPU model when cpu_mode is CUSTOM"),
      machine_type: z.string().optional().describe("Machine type"),
      hide_from_msr: z.boolean().optional().describe("Hide the hypervisor from MSR"),
      ensure_display_device: z.boolean().optional().describe("Ensure a display device is added"),
      arch_type: z.string().optional().describe("Architecture type"),
      hyperv_enlightenments: z.boolean().optional().describe("Enable Hyper-V enlightenments"),
    },
    async ({ id, ...params }) => {
      const body: Record<string, unknown> = {};
      if (params.name !== undefined) body.name = params.name;
      if (params.description !== undefined) body.description = params.description;
      if (params.vcpus !== undefined) body.vcpus = params.vcpus;
      if (params.cores !== undefined) body.cores = params.cores;
      if (params.threads !== undefined) body.threads = params.threads;
      if (params.memory !== undefined) body.memory = params.memory;
      if (params.bootloader !== undefined) body.bootloader = params.bootloader;
      if (params.autostart !== undefined) body.autostart = params.autostart;
      if (params.time !== undefined) body.time = params.time;
      if (params.shutdown_timeout !== undefined) body.shutdown_timeout = params.shutdown_timeout;
      if (params.cpu_mode !== undefined) body.cpu_mode = params.cpu_mode;
      if (params.cpu_model !== undefined) body.cpu_model = params.cpu_model;
      if (params.machine_type !== undefined) body.machine_type = params.machine_type;
      if (params.hide_from_msr !== undefined) body.hide_from_msr = params.hide_from_msr;
      if (params.ensure_display_device !== undefined) body.ensure_display_device = params.ensure_display_device;
      if (params.arch_type !== undefined) body.arch_type = params.arch_type;
      if (params.hyperv_enlightenments !== undefined) body.hyperv_enlightenments = params.hyperv_enlightenments;
      const result = await client.call("vm.update", [id, body]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "vm_delete",
    "Delete a virtual machine. This is a DESTRUCTIVE operation. The 'confirm' parameter must be true to proceed. Optionally delete associated zvols and force deletion.",
    {
      id: z.number().describe("Numeric ID of the VM to delete"),
      confirm: z.boolean().describe("Must be true to confirm deletion"),
      zvols: z.boolean().optional().default(false).describe("Also delete associated zvols"),
      force: z.boolean().optional().default(false).describe("Force deletion even if the VM is running"),
    },
    async ({ id, confirm, zvols, force }) => {
      if (!confirm) {
        return {
          content: [{ type: "text", text: "VM deletion aborted: 'confirm' must be set to true." }],
        };
      }
      const result = await client.call("vm.delete", [id, { zvols, force }]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "vm_start",
    "Start a virtual machine by its ID. Optionally allow memory overcommit.",
    {
      id: z.number().describe("Numeric ID of the VM to start"),
      overcommit: z.boolean().optional().default(false).describe("Allow memory overcommit"),
    },
    async ({ id, overcommit }) => {
      const result = await client.call("vm.start", [id, { overcommit }]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "vm_stop",
    "Stop a running virtual machine by its ID. Optionally force-stop (power off) instead of graceful shutdown.",
    {
      id: z.number().describe("Numeric ID of the VM to stop"),
      force: z.boolean().optional().default(false).describe("Force stop (power off) instead of graceful shutdown"),
    },
    async ({ id, force }) => {
      const result = await client.call("vm.stop", [id, { force }]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "vm_restart",
    "Restart a running virtual machine by its ID.",
    {
      id: z.number().describe("Numeric ID of the VM to restart"),
    },
    async ({ id }) => {
      const result = await client.call("vm.restart", [id]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "vm_status",
    "Get the current status of a virtual machine (running, stopped, etc.).",
    {
      id: z.number().describe("Numeric ID of the VM"),
    },
    async ({ id }) => {
      const result = await client.call("vm.status", [id]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "vm_clone",
    "Clone an existing VM, creating a copy with a new name.",
    {
      id: z.number().describe("Numeric ID of the VM to clone"),
      name: z.string().optional().describe("Name for the cloned VM"),
    },
    async ({ id, name }) => {
      const result = await client.call("vm.clone", name !== undefined ? [id, name] : [id]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // VM Devices
  // ---------------------------------------------------------------------------

  server.tool(
    "vm_device_list",
    "List VM devices. Optionally filter by VM ID to see devices attached to a specific VM.",
    {
      vm_id: z.number().optional().describe("Optional VM ID to filter devices for a specific VM"),
    },
    async ({ vm_id }) => {
      const result = await client.call("vm.device.query");
      if (vm_id !== undefined) {
        const devices = Array.isArray(result) ? result.filter((d: any) => d.vm === vm_id) : result;
        return { content: [{ type: "text", text: JSON.stringify(devices, null, 2) }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "vm_device_create",
    "Create a new device and attach it to a VM. The 'attributes' object varies by device type (dtype). For DISK: { path, type, physical_sectorsize, logical_sectorsize, iotype }. For NIC: { type (VIRTIO|E1000), nic_attach, mac }. For CDROM: { path }. For DISPLAY: { resolution, port, bind, type (VNC|SPICE), password, web }.",
    {
      vm: z.number().describe("VM ID to attach the device to"),
      dtype: z.enum(["NIC", "DISK", "CDROM", "PCI", "DISPLAY", "RAW", "USB"]).describe("Device type"),
      attributes: z.record(z.string(), z.unknown()).optional().describe("Device-specific attributes object"),
      order: z.number().optional().describe("Boot order for the device"),
    },
    async (params) => {
      const body: Record<string, unknown> = {
        vm: params.vm,
        dtype: params.dtype,
      };
      if (params.attributes !== undefined) body.attributes = params.attributes;
      if (params.order !== undefined) body.order = params.order;
      const result = await client.call("vm.device.create", [body]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "vm_device_update",
    "Update an existing VM device by its ID. Provide any fields to change (dtype, attributes, order, vm).",
    {
      id: z.number().describe("Numeric ID of the VM device to update"),
      dtype: z.enum(["NIC", "DISK", "CDROM", "PCI", "DISPLAY", "RAW", "USB"]).optional().describe("Device type"),
      attributes: z.record(z.string(), z.unknown()).optional().describe("Device-specific attributes object"),
      order: z.number().optional().describe("Boot order for the device"),
      vm: z.number().optional().describe("VM ID to attach the device to"),
    },
    async ({ id, ...params }) => {
      const body: Record<string, unknown> = {};
      if (params.dtype !== undefined) body.dtype = params.dtype;
      if (params.attributes !== undefined) body.attributes = params.attributes;
      if (params.order !== undefined) body.order = params.order;
      if (params.vm !== undefined) body.vm = params.vm;
      const result = await client.call("vm.device.update", [id, body]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "vm_device_delete",
    "Delete a VM device by its ID. Optionally delete the associated zvol or raw file.",
    {
      id: z.number().describe("Numeric ID of the VM device to delete"),
      zvol: z.boolean().optional().default(false).describe("Also delete the associated zvol"),
      raw_file: z.boolean().optional().default(false).describe("Also delete the associated raw file"),
      force: z.boolean().optional().default(false).describe("Force deletion"),
    },
    async ({ id, zvol, raw_file, force }) => {
      const result = await client.call("vm.device.delete", [id, { zvol, raw_file, force }]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "vm_available_memory",
    "Get the amount of memory available for allocating to VMs, in bytes.",
    {},
    async () => {
      const result = await client.call("vm.get_available_memory");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "vm_display_uri",
    "Get the web display URI (VNC/SPICE) for a running VM. Useful for connecting to the VM console.",
    {
      id: z.number().describe("Numeric ID of the VM"),
      host: z.string().optional().describe("Host to use in the URI (defaults to system hostname)"),
      protocol: z.string().optional().describe("Protocol to use (http or https)"),
    },
    async ({ id, host, protocol }) => {
      const body: Record<string, unknown> = {};
      if (host !== undefined) body.host = host;
      if (protocol !== undefined) body.protocol = protocol;
      const result = await client.call("vm.get_display_web_uri", [id, body]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // Apps / Docker
  // ---------------------------------------------------------------------------

  server.tool(
    "app_list",
    "List all installed apps (Docker containers) on the TrueNAS system.",
    {},
    async () => {
      const result = await client.call("app.query");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "app_get",
    "Get detailed information about a specific installed app by its ID (app name).",
    {
      id: z.string().describe("App ID (name) of the installed app"),
    },
    async ({ id }) => {
      const result = await client.call("app.get_instance", [id]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "app_create",
    "Install a new app from the catalog. Provide the app_name (desired installation name), catalog_app (app from catalog), and optionally train, version, and configuration values.",
    {
      app_name: z.string().describe("Name for the installed app instance"),
      catalog_app: z.string().describe("Name of the app in the catalog"),
      train: z.string().optional().describe("Catalog train (e.g. 'stable', 'community')"),
      version: z.string().optional().describe("Specific version to install"),
      values: z.record(z.string(), z.unknown()).optional().describe("App-specific configuration values"),
    },
    async (params) => {
      const body: Record<string, unknown> = {
        app_name: params.app_name,
        catalog_app: params.catalog_app,
      };
      if (params.train !== undefined) body.train = params.train;
      if (params.version !== undefined) body.version = params.version;
      if (params.values !== undefined) body.values = params.values;
      const result = await client.call("app.create", [body]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "app_update",
    "Update an installed app's configuration values.",
    {
      id: z.string().describe("App ID (name) of the installed app"),
      values: z.record(z.string(), z.unknown()).describe("Updated configuration values"),
    },
    async ({ id, values }) => {
      const result = await client.call("app.update", [id, { values }]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "app_delete",
    "Delete/uninstall an app. This is a DESTRUCTIVE operation. The 'confirm' parameter must be true to proceed.",
    {
      id: z.string().describe("App ID (name) of the app to delete"),
      confirm: z.boolean().describe("Must be true to confirm deletion"),
    },
    async ({ id, confirm }) => {
      if (!confirm) {
        return {
          content: [{ type: "text", text: "App deletion aborted: 'confirm' must be set to true." }],
        };
      }
      const result = await client.call("app.delete", [id]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "app_start",
    "Start an installed app by its ID.",
    {
      id: z.string().describe("App ID (name) of the app to start"),
    },
    async ({ id }) => {
      const result = await client.call("app.start", [id]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "app_stop",
    "Stop a running app by its ID.",
    {
      id: z.string().describe("App ID (name) of the app to stop"),
    },
    async ({ id }) => {
      const result = await client.call("app.stop", [id]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "app_redeploy",
    "Redeploy an app, recreating its containers with the current configuration.",
    {
      id: z.string().describe("App ID (name) of the app to redeploy"),
    },
    async ({ id }) => {
      const result = await client.call("app.redeploy", [id]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "app_upgrade",
    "Upgrade an app to a newer version.",
    {
      id: z.string().describe("App ID (name) of the app to upgrade"),
      app_version: z.string().optional().describe("Target version to upgrade to (latest if omitted)"),
    },
    async ({ id, app_version }) => {
      const body: Record<string, unknown> = {};
      if (app_version !== undefined) body.app_version = app_version;
      const result = await client.call("app.upgrade", [id, body]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "app_rollback",
    "Rollback an app to a previous version. This is a DESTRUCTIVE operation. The 'confirm' parameter must be true to proceed.",
    {
      id: z.string().describe("App ID (name) of the app to rollback"),
      app_version: z.string().describe("Version to rollback to"),
      confirm: z.boolean().describe("Must be true to confirm rollback"),
    },
    async ({ id, app_version, confirm }) => {
      if (!confirm) {
        return {
          content: [{ type: "text", text: "App rollback aborted: 'confirm' must be set to true." }],
        };
      }
      const result = await client.call("app.rollback", [id, { app_version }]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "app_available",
    "List all available apps from the catalog. Returns apps that can be installed.",
    {},
    async () => {
      const result = await client.call("app.available");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "app_categories",
    "List all app categories available in the catalog.",
    {},
    async () => {
      const result = await client.call("app.categories");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "app_outdated_images",
    "List outdated Docker images used by installed apps.",
    {},
    async () => {
      const result = await client.call("app.outdated_docker_images");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "app_pull_images",
    "Pull the latest Docker images for a specific app.",
    {
      app_name: z.string().describe("Name of the app to pull images for"),
    },
    async ({ app_name }) => {
      const result = await client.call("app.pull_images", [{ app_name }]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // Docker Configuration
  // ---------------------------------------------------------------------------

  server.tool(
    "docker_config",
    "Get the current Docker/container runtime configuration, including pool and image update settings.",
    {},
    async () => {
      const result = await client.call("docker.config");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "docker_config_update",
    "Update Docker/container runtime configuration. All fields are optional — only provide what you want to change.",
    {
      pool: z.string().optional().describe("Storage pool to use for Docker"),
      enable_image_updates: z.boolean().optional().describe("Whether to automatically check for image updates"),
      address_pools: z
        .array(
          z.object({
            base: z.string().describe("Base CIDR for the address pool"),
            size: z.number().describe("Subnet size to allocate from the pool"),
          })
        )
        .optional()
        .describe("Docker address pools configuration"),
    },
    async (params) => {
      const body: Record<string, unknown> = {};
      if (params.pool !== undefined) body.pool = params.pool;
      if (params.enable_image_updates !== undefined) body.enable_image_updates = params.enable_image_updates;
      if (params.address_pools !== undefined) body.address_pools = params.address_pools;
      const result = await client.call("docker.update", [body]);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "docker_status",
    "Get the current status of the Docker/container runtime service.",
    {},
    async () => {
      const result = await client.call("docker.status");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );
}
