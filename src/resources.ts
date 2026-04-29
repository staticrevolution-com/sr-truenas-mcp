import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TrueNASClient } from "./client.js";
import { filterSensitiveFields } from "./filters.js";

/**
 * Run a labelled set of TrueNAS calls in parallel and merge results. A
 * single failed call must not blackhole the whole resource read — fulfilled
 * calls populate their key, rejected calls populate `null` and append an
 * entry to `_errors`. The `_errors` field is only present when at least one
 * call rejected, so happy-path payloads stay clean.
 */
export async function gatherLabelled<L extends string>(
  entries: ReadonlyArray<readonly [L, Promise<unknown>]>,
): Promise<Record<L, unknown> & { _errors?: Array<{ source: L; error: string }> }> {
  const settled = await Promise.allSettled(entries.map(([, p]) => p));
  const out = {} as Record<L, unknown>;
  const errors: Array<{ source: L; error: string }> = [];
  settled.forEach((res, i) => {
    const [label] = entries[i];
    if (res.status === "fulfilled") {
      out[label] = res.value;
    } else {
      out[label] = null;
      const reason = res.reason;
      const message = reason instanceof Error ? reason.message : String(reason);
      errors.push({ source: label, error: message });
    }
  });
  if (errors.length > 0) {
    return { ...out, _errors: errors };
  }
  return out;
}

export function registerResources(server: McpServer, client: TrueNASClient): void {
  // System overview resource
  server.resource(
    "system-info",
    "truenas://system/info",
    { description: "TrueNAS system information — version, hostname, uptime, hardware" },
    async () => {
      const info = await client.call("system.info");
      return {
        contents: [
          {
            uri: "truenas://system/info",
            mimeType: "application/json",
            text: JSON.stringify(filterSensitiveFields(info), null, 2),
          },
        ],
      };
    }
  );

  // Pool overview resource
  server.resource(
    "pools",
    "truenas://storage/pools",
    { description: "All storage pools with status, capacity, and health" },
    async () => {
      const pools = await client.call("pool.query");
      return {
        contents: [
          {
            uri: "truenas://storage/pools",
            mimeType: "application/json",
            text: JSON.stringify(filterSensitiveFields(pools), null, 2),
          },
        ],
      };
    }
  );

  // Dataset overview resource
  server.resource(
    "datasets",
    "truenas://storage/datasets",
    { description: "All datasets with properties, usage, and encryption status" },
    async () => {
      const datasets = await client.call("pool.dataset.query");
      return {
        contents: [
          {
            uri: "truenas://storage/datasets",
            mimeType: "application/json",
            text: JSON.stringify(filterSensitiveFields(datasets), null, 2),
          },
        ],
      };
    }
  );

  // Services resource
  server.resource(
    "services",
    "truenas://services",
    { description: "All services with their running state and enabled-at-boot status" },
    async () => {
      const services = await client.call("service.query");
      return {
        contents: [
          {
            uri: "truenas://services",
            mimeType: "application/json",
            text: JSON.stringify(filterSensitiveFields(services), null, 2),
          },
        ],
      };
    }
  );

  // Alerts resource
  server.resource(
    "alerts",
    "truenas://alerts",
    { description: "Current system alerts and warnings" },
    async () => {
      const alerts = await client.call("alert.list");
      return {
        contents: [
          {
            uri: "truenas://alerts",
            mimeType: "application/json",
            text: JSON.stringify(filterSensitiveFields(alerts), null, 2),
          },
        ],
      };
    }
  );

  // Network overview resource
  server.resource(
    "network",
    "truenas://network/summary",
    { description: "Network configuration summary — interfaces, IPs, DNS, gateway" },
    async () => {
      const summary = await client.call("network.general.summary");
      return {
        contents: [
          {
            uri: "truenas://network/summary",
            mimeType: "application/json",
            text: JSON.stringify(filterSensitiveFields(summary), null, 2),
          },
        ],
      };
    }
  );

  // Shares resource — partial-failure tolerant. If any one query rejects,
  // the others still surface; rejected sources show up under `_errors`.
  server.resource(
    "shares",
    "truenas://sharing",
    { description: "All configured shares — SMB, NFS, and iSCSI" },
    async () => {
      const merged = await gatherLabelled([
        ["smb", client.call("sharing.smb.query")],
        ["nfs", client.call("sharing.nfs.query")],
        ["iscsi_targets", client.call("iscsi.target.query")],
      ]);
      return {
        contents: [
          {
            uri: "truenas://sharing",
            mimeType: "application/json",
            text: JSON.stringify(filterSensitiveFields(merged), null, 2),
          },
        ],
      };
    }
  );

  // VMs resource
  server.resource(
    "vms",
    "truenas://vms",
    { description: "All virtual machines with status" },
    async () => {
      const vms = await client.call("vm.query");
      return {
        contents: [
          {
            uri: "truenas://vms",
            mimeType: "application/json",
            text: JSON.stringify(filterSensitiveFields(vms), null, 2),
          },
        ],
      };
    }
  );

  // Apps resource
  server.resource(
    "apps",
    "truenas://apps",
    { description: "All installed applications with status" },
    async () => {
      const apps = await client.call("app.query");
      return {
        contents: [
          {
            uri: "truenas://apps",
            mimeType: "application/json",
            text: JSON.stringify(filterSensitiveFields(apps), null, 2),
          },
        ],
      };
    }
  );

  // Disks resource
  server.resource(
    "disks",
    "truenas://disks",
    { description: "All physical disks with model, serial, size, and pool assignment" },
    async () => {
      const disks = await client.call("disk.query");
      return {
        contents: [
          {
            uri: "truenas://disks",
            mimeType: "application/json",
            text: JSON.stringify(filterSensitiveFields(disks), null, 2),
          },
        ],
      };
    }
  );

  // Boot environments resource
  server.resource(
    "boot-environments",
    "truenas://boot/environments",
    { description: "Boot environments with activation status" },
    async () => {
      const bootenvs = await client.call("boot.environment.query");
      return {
        contents: [
          {
            uri: "truenas://boot/environments",
            mimeType: "application/json",
            text: JSON.stringify(filterSensitiveFields(bootenvs), null, 2),
          },
        ],
      };
    }
  );

  // Update status resource
  server.resource(
    "update-status",
    "truenas://system/update",
    { description: "System update configuration and available updates" },
    async () => {
      const config = await client.call("update.config");
      return {
        contents: [
          {
            uri: "truenas://system/update",
            mimeType: "application/json",
            text: JSON.stringify(filterSensitiveFields(config), null, 2),
          },
        ],
      };
    }
  );
}
