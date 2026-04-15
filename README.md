# sr-truenas-mcp

Hardened MCP server for TrueNAS SCALE. **270 safety-tiered actions across 17 categories** over WebSocket JSON-RPC 2.0 — behind a **single hierarchical tool** that won't bloat your LLM's context window.

Fork of [spranab/truenas-mcp](https://github.com/spranab/truenas-mcp) with comprehensive security hardening, transport migration, and production safety features.

## What Changed from Upstream

| | Upstream | sr-truenas-mcp |
|---|---|---|
| **Transport** | REST API v2.0 (deprecated) | WebSocket JSON-RPC 2.0 (DDP) |
| **Safety** | `confirm: true` on some actions | 4-tier system: blocked, confirm+reason, confirm, open |
| **Blocked actions** | None | 8 (reboot, shutdown, API escape hatch, cron/init scripts) |
| **Raw API escape hatch** | Yes (`truenas_api_call`) | Removed |
| **TLS handling** | Mutates `process.env.NODE_TLS_REJECT_UNAUTHORIZED` | Per-connection `rejectUnauthorized` |
| **Path validation** | None | All filesystem ops validate `/mnt/` prefix, reject traversal |
| **Response filtering** | None | Sensitive fields redacted (passwords, keys, secrets) |
| **Tests** | 0 | 65 |
| **CI** | None | GitHub Actions |

## Quick Start

```bash
git clone https://github.com/staticrevolution-com/sr-truenas-mcp
cd sr-truenas-mcp
npm install
npm run build
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TRUENAS_URL` | Yes | TrueNAS instance URL (e.g. `https://truenas.local`) |
| `TRUENAS_API_KEY` | Yes | API key from TrueNAS UI: **Settings > API Keys > Add** |
| `TRUENAS_VERIFY_SSL` | No | Set to `false` to skip SSL verification (self-signed certs) |

### Claude Code MCP Configuration

```json
{
  "mcpServers": {
    "truenas": {
      "command": "node",
      "args": ["path/to/sr-truenas-mcp/dist/cli.js"],
      "env": {
        "TRUENAS_URL": "wss://truenas.local",
        "TRUENAS_API_KEY": "1-your-api-key-here",
        "TRUENAS_VERIFY_SSL": "false"
      }
    }
  }
}
```

## How It Works

One tool called `truenas` with three usage modes:

**Discover categories:**
```
truenas()
```

**Explore a category:**
```
truenas({ category: "storage" })
```

**Execute an action:**
```
truenas({ category: "storage", action: "pool_list" })
truenas({ category: "storage", action: "dataset_delete", params: { id: "tank/old" }, confirm: true, reason: "Removing unused dataset" })
```

## Safety Tiers

| Tier | Gate | Count | Examples |
|------|------|-------|---------|
| 0 — Blocked | Never registered | 8 | `system_reboot`, `system_shutdown`, `truenas_api_call`, `cronjob_create` |
| 1 — Confirm+Reason | `confirm: true` + `reason` | 14 | `pool_export`, `disk_wipe`, `dataset_delete`, `snapshot_rollback` |
| 2 — Confirm | `confirm: true` | 69 | `service_stop`, `user_delete`, `vm_delete`, `nfs_share_delete` |
| 3 — Open | None | 187 | All reads, safe creates, queries |

Actions marked with their tier in discovery output: `pool_export [requires confirm + reason]`.

## Categories

| Category | Actions | Covers |
|----------|---------|--------|
| `system` | 22 | System info, config, services, mail, API keys, NTP |
| `storage` | 43 | Pools, datasets, snapshots, periodic snapshot tasks |
| `sharing` | 36 | SMB/CIFS, NFS exports, iSCSI targets/extents/portals/initiators |
| `network` | 15 | Interfaces, global config, static routes, IPMI, staged changes |
| `account` | 12 | Users, groups, privileges/roles |
| `disk` | 7 | Physical disks, SMART data, temperatures |
| `vm` | 16 | Virtual machines, VM devices (disk, NIC, display, PCI) |
| `app` | 14 | Docker apps, container runtime config |
| `update` | 12 | System updates, boot environments, boot pool |
| `certificate` | 8 | TLS certs, ACME/Let's Encrypt, DNS authenticators |
| `alert` | 10 | Alerts, notification services (Slack, email, PagerDuty) |
| `data_protection` | 42 | Replication, cloud sync, cloud backup, cron, rsync, SSH keys |
| `filesystem` | 7 | stat, listdir, mkdir, permissions, ACLs, chown |
| `reporting` | 3 | Metrics config, graphs, time-series data |
| `directory` | 8 | Active Directory, LDAP, Kerberos |
| `service_config` | 12 | SSH, FTP, SNMP, UPS, system tunables |
| `audit` | 3 | Audit logs, audit configuration |

## MCP Resources (12)

Read-only resources for dashboards — no tool call needed:

| Resource | URI | Description |
|----------|-----|-------------|
| System Info | `truenas://system/info` | Version, hostname, uptime, hardware |
| Pools | `truenas://storage/pools` | All pools with capacity and health |
| Datasets | `truenas://storage/datasets` | All datasets with properties |
| Services | `truenas://services` | Service status overview |
| Alerts | `truenas://alerts` | Current system alerts |
| Network | `truenas://network/summary` | Interfaces, IPs, DNS, gateway |
| Shares | `truenas://sharing` | All SMB, NFS, and iSCSI shares |
| VMs | `truenas://vms` | Virtual machines with status |
| Apps | `truenas://apps` | Installed applications |
| Disks | `truenas://disks` | Physical disks info |
| Boot Envs | `truenas://boot/environments` | Boot environments |
| Update | `truenas://system/update` | Update configuration |

## Development

```bash
npm install
npm run build       # tsc
npm test            # vitest run (65 tests)
npm run type-check  # tsc --noEmit
npm run dev         # tsc --watch
```

## API Compatibility

Built for **TrueNAS SCALE** WebSocket API (DDP protocol). Method names verified against TrueNAS v25.10.2 official API documentation. Compatible with TrueNAS SCALE 25.10.x+.

## License

MIT
