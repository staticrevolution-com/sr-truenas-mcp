# sr-truenas-mcp

A hardened [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server for [TrueNAS SCALE](https://www.truenas.com/truenas-scale/). Provides **270 safety-tiered actions across 17 categories** over WebSocket JSON-RPC 2.0, exposed through a single hierarchical tool designed for efficient LLM interaction.

Forked from [spranab/truenas-mcp](https://github.com/spranab/truenas-mcp) with comprehensive security hardening, a full transport migration from REST to WebSocket, and production safety features.

## Table of Contents

- [Installation](#installation)
- [Deployment](#deployment)
- [Configuration](#configuration)
- [Usage](#usage)
- [Safety Tiers](#safety-tiers)
- [Categories & Actions](#categories--actions)
- [MCP Resources](#mcp-resources)
- [Architecture](#architecture)
- [API Reference](#api-reference)
- [Development](#development)
- [Changes from Upstream](#changes-from-upstream)
- [License](#license)

## Installation

### npm (from GitHub Release)

```bash
# Install from release tarball
npm install -g https://github.com/staticrevolution-com/sr-truenas-mcp/releases/download/v1.0.0/sr-truenas-mcp-1.0.0.tgz
sr-truenas-mcp
```

Or install directly from the repo:

```bash
npm install -g github:staticrevolution-com/sr-truenas-mcp
sr-truenas-mcp
```

### Docker

```bash
docker run -i --rm \
  -e TRUENAS_URL=wss://truenas.local:444 \
  -e TRUENAS_API_KEY=your-key \
  -e TRUENAS_VERIFY_SSL=false \
  ghcr.io/staticrevolution-com/sr-truenas-mcp:latest
```

### Standalone Binary

Download from [GitHub Releases](https://github.com/staticrevolution-com/sr-truenas-mcp/releases):

```bash
wget -qO- https://github.com/staticrevolution-com/sr-truenas-mcp/releases/download/v1.0.0/sr-truenas-mcp-linux-x64.tar.gz | tar xzf -
chmod +x sr-truenas-mcp
TRUENAS_URL=wss://truenas.local:444 TRUENAS_API_KEY=... ./sr-truenas-mcp
```

### From Source

```bash
git clone https://github.com/staticrevolution-com/sr-truenas-mcp.git
cd sr-truenas-mcp
npm install && npm run build
node dist/cli.js
```

Requires Node.js 18+.

## Deployment

### Claude Code

```json
{
  "mcpServers": {
    "truenas": {
      "command": "sr-truenas-mcp",
      "env": {
        "TRUENAS_URL": "wss://truenas.local:444",
        "TRUENAS_API_KEY": "your-key",
        "TRUENAS_VERIFY_SSL": "false"
      }
    }
  }
}
```

Or with Docker:

```json
{
  "mcpServers": {
    "truenas": {
      "command": "docker",
      "args": ["run", "-i", "--rm",
        "-e", "TRUENAS_URL=wss://truenas.local:444",
        "-e", "TRUENAS_API_KEY=your-key",
        "-e", "TRUENAS_VERIFY_SSL=false",
        "ghcr.io/staticrevolution-com/sr-truenas-mcp:latest"
      ]
    }
  }
}
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "truenas": {
      "command": "sr-truenas-mcp",
      "env": {
        "TRUENAS_URL": "wss://truenas.local:444",
        "TRUENAS_API_KEY": "your-key",
        "TRUENAS_VERIFY_SSL": "false"
      }
    }
  }
}
```

### VS Code

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "truenas": {
      "command": "sr-truenas-mcp",
      "env": {
        "TRUENAS_URL": "wss://truenas.local:444",
        "TRUENAS_API_KEY": "your-key",
        "TRUENAS_VERIFY_SSL": "false"
      }
    }
  }
}
```

### AgentGateway (stdio backend)

Deploy as a stdio backend alongside other MCP servers using the standalone binary.

**Init container** (downloads binary on first start):
```yaml
truenas-mcp-init:
  image: busybox:1.37
  command:
    - sh
    - -c
    - |
      if [ -f /bin-vol/sr-truenas-mcp ]; then exit 0; fi
      wget -qO- "https://github.com/staticrevolution-com/sr-truenas-mcp/releases/download/v1.0.0/sr-truenas-mcp-linux-x64.tar.gz" | tar xzf - -C /bin-vol &&
      chmod +x /bin-vol/sr-truenas-mcp
  volumes:
    - /path/to/agentgateway/bin:/bin-vol
```

**AgentGateway config.yaml:**
```yaml
- name: truenas
  stdio:
    cmd: /opt/mcp-bin/sr-truenas-mcp
    env:
      TRUENAS_URL: "${TRUENAS_URL}"
      TRUENAS_API_KEY: "${TRUENAS_API_KEY}"
      TRUENAS_VERIFY_SSL: "${TRUENAS_VERIFY_SSL}"
```

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TRUENAS_URL` | Yes | TrueNAS instance URL (e.g., `https://192.168.1.235` or `wss://truenas.local`) |
| `TRUENAS_API_KEY` | Yes | API key generated in TrueNAS UI: **Credentials > API Keys > Add** |
| `TRUENAS_VERIFY_SSL` | No | Set to `false` to accept self-signed certificates (default: `true`) |

The server accepts `http://`, `https://`, `ws://`, or `wss://` URLs and converts them to the appropriate WebSocket scheme automatically.

### Claude Code

Add to your MCP settings (`settings.json` or project-level `.mcp.json`):

```json
{
  "mcpServers": {
    "truenas": {
      "command": "node",
      "args": ["path/to/sr-truenas-mcp/dist/cli.js"],
      "env": {
        "TRUENAS_URL": "wss://192.168.1.235",
        "TRUENAS_API_KEY": "1-your-api-key-here",
        "TRUENAS_VERIFY_SSL": "false"
      }
    }
  }
}
```

### Claude Desktop

Add to your `claude_desktop_config.json`:

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

## Usage

The server exposes one MCP tool called `truenas` with three interaction modes:

### 1. Discover Categories

```
truenas()
```

Returns all 17 categories with descriptions and action counts.

### 2. Explore a Category

```
truenas({ category: "storage" })
```

Returns all actions in that category with their parameters and safety tier annotations.

### 3. Execute an Action

```
truenas({ category: "storage", action: "pool_list" })
```

For destructive operations (tier 1 or 2):

```
truenas({
  category: "storage",
  action: "dataset_delete",
  params: { id: "tank/old-data" },
  confirm: true,
  reason: "Removing decommissioned dataset after data migration"
})
```

This hierarchical design keeps the LLM's tool context to ~200 tokens instead of the 30,000+ tokens that 270 individual tools would require.

## Safety Tiers

Every action is classified into one of four safety tiers. Enforcement is centralized in the tool registry with a two-call confirmation pattern for destructive operations.

| Tier | Gate | Count | Description |
|------|------|-------|-------------|
| **0 — Blocked** | Never registered | 8 | Dangerous operations that should never be available via MCP |
| **1 — Confirm + Reason** | `confirm: true` + `reason: "..."` | 20 | Irreversible, high-blast-radius, or privilege-escalation operations |
| **2 — Confirm** | `confirm: true` | 81 | Destructive writes, config changes, share creation |
| **3 — Open** | None | 169 | Reads, safe queries |

### Confirmation Flow

When a tier 1 or 2 action is called without `confirm: true`, the server returns a detailed warning instead of executing:

```
⚠ DESTRUCTIVE OPERATION: service_stop

Stop a running service by name (e.g. 'ssh', 'smb', 'nfs').

Parameters:
  service: "ssh"

This action modifies system state and may not be easily reversible.
To proceed, the user must explicitly approve. Then call again with:
  confirm: true
```

The LLM presents this warning to the user and only proceeds after explicit approval. Tier 1 actions additionally require a `reason` string explaining why the operation is needed.

### Blocked Actions (Tier 0)

These actions are never registered and cannot be discovered or executed:

- `system_reboot`, `system_shutdown` — system-level danger
- `system_config_upload` — replaces entire system configuration
- `truenas_api_call` — raw API escape hatch that bypasses all safety gates
- `cronjob_create`, `cronjob_update` — arbitrary shell command execution
- `initshutdown_create`, `initshutdown_update` — arbitrary shell command execution

### High-Risk Actions (Tier 1)

Require both `confirm: true` and a `reason` string. Includes privilege escalation vectors:

`pool_create`, `pool_export`, `pool_replace_disk`, `disk_wipe`, `dataset_delete`, `snapshot_rollback`, `update_apply`, `bootenv_activate`, `bootenv_delete`, `boot_attach_disk`, `boot_detach_disk`, `directory_services_leave`, `system_config_download`, `network_commit_changes`, `user_create`, `user_update`, `group_update`, `privilege_create`, `privilege_update`, `ssh_config_update`

### Additional Safety Features

- **Fail-closed registration**: Unclassified actions are rejected — no action can bypass tier assignment
- **Response filtering**: All tool and resource responses pass through a 36-pattern sensitive field filter (passwords, keys, tokens, hashes, secrets)
- **Path validation**: All 22 filesystem-touching handlers validate paths start with `/mnt/`, reject `..` traversal and null bytes
- **Per-connection TLS**: SSL verification configured per WebSocket connection, not via `process.env` mutation
- **Runtime validation**: All handler parameters validated through Zod schemas before execution
- **Defense-in-depth**: 32 handlers have in-handler `confirm` checks in addition to registry-level enforcement

## Categories & Actions

| Category | Actions | Covers |
|----------|---------|--------|
| `system` | 22 | System info, general/advanced config, services, mail, API keys, NTP |
| `storage` | 43 | Pools, datasets, snapshots, snapshot tasks, rsync tasks, init/shutdown scripts, SSH credentials |
| `sharing` | 36 | SMB/CIFS shares & config, NFS shares & config, iSCSI targets/extents/portals/initiators |
| `network` | 15 | Interfaces, global config, static routes, IPMI, staged change commit/rollback |
| `account` | 12 | Users, groups, privilege/role management |
| `disk` | 7 | Physical disks, SMART data, temperatures |
| `vm` | 16 | Virtual machines, VM devices (disk, NIC, display, PCI passthrough) |
| `app` | 14 | Docker applications, container runtime configuration |
| `update` | 12 | System updates, boot environments, boot pool management |
| `certificate` | 8 | TLS certificates, ACME/Let's Encrypt, DNS authenticators |
| `alert` | 10 | System alerts, notification services (Slack, email, PagerDuty, etc.) |
| `data_protection` | 42 | Replication, cloud sync, cloud backup, cron jobs, rsync tasks, SSH credentials |
| `filesystem` | 7 | stat, listdir, mkdir, permissions, ACLs, chown |
| `reporting` | 3 | Metrics configuration, available graphs, time-series data |
| `directory` | 8 | Active Directory, LDAP, Kerberos |
| `service_config` | 12 | SSH, FTP, SNMP, UPS configuration, system tunables |
| `audit` | 3 | Audit logs and configuration |

## MCP Resources

Twelve read-only resources are available for dashboard-style access without tool calls:

| Resource | URI | Description |
|----------|-----|-------------|
| System Info | `truenas://system/info` | Version, hostname, uptime, hardware |
| Pools | `truenas://storage/pools` | All pools with capacity and health |
| Datasets | `truenas://storage/datasets` | All datasets with properties and usage |
| Services | `truenas://services` | Service running state and boot status |
| Alerts | `truenas://alerts` | Current system alerts and warnings |
| Network | `truenas://network/summary` | Interfaces, IPs, DNS, gateway |
| Shares | `truenas://sharing` | All SMB, NFS, and iSCSI shares |
| VMs | `truenas://vms` | Virtual machines with status |
| Apps | `truenas://apps` | Installed applications with status |
| Disks | `truenas://disks` | Physical disks with model, serial, size |
| Boot Envs | `truenas://boot/environments` | Boot environments with activation status |
| Update | `truenas://system/update` | Update configuration and status |

## Architecture

### Transport: WebSocket JSON-RPC 2.0 (DDP)

The server communicates with TrueNAS over WebSocket using the DDP (Distributed Data Protocol) format at `wss://{host}/websocket`. This replaces the upstream's REST API v2.0, which is deprecated and undocumented in TrueNAS 25.10.2+.

The migration was informed by:
- [TrueNAS WebSocket API documentation](https://www.truenas.com/docs/api/) (v25.10.2, v26.0.0, v27.0.0)
- The [truenas-mcp Go reference implementation](https://github.com/dariusbakunas/truenas-mcp) for DDP protocol patterns

**Connection lifecycle:**
1. WebSocket connect to `wss://{host}/websocket`
2. DDP handshake: `{"msg":"connect","version":"1","support":["1"]}`
3. Authentication: `auth.login_with_api_key` with API key
4. Method calls: `{"id":"N","msg":"method","method":"pool.query","params":[]}`
5. Responses: `{"id":"N","msg":"result","result":[...]}`

**Key implementation details:**
- Request multiplexing via pending response map with string IDs
- Per-request timeouts (30s default, 300s for jobs)
- Auto-reconnect with 1 retry on connection errors
- Job polling via `core.get_jobs` with filter syntax

### REST-to-WebSocket Namespace Mapping

Several namespaces changed between the REST API and WebSocket API:

| REST v2.0 Path | WebSocket Method |
|----------------|-----------------|
| `GET /pool/snapshot` | `pool.snapshot.query` |
| `POST /service/start` | `service.control` with verb `"START"` |
| `GET /bootenv` | `boot.environment.query` |
| `POST /bootenv` | `boot.environment.clone` |
| `DELETE /bootenv/id/{id}` | `boot.environment.destroy` |
| `POST /pool/id/{id}/replace` | `pool.replace` |
| `POST /update/check_available` | `update.available_versions` |
| `GET /update` | `update.config` |
| `POST /update/update` | `update.run` |
| `GET /system/config/download` | `config.save` |

Standard CRUD patterns follow: `{namespace}.query`, `{namespace}.get_instance`, `{namespace}.create`, `{namespace}.update`, `{namespace}.delete`.

Filter syntax: `[["field", "op", "value"]]` with operators `=`, `!=`, `>`, `>=`, `<`, `<=`, `~`, `in`, `nin`.

### Centralized Safety Enforcement

All safety logic lives in `src/registry.ts`, not in individual handlers:

1. **Registration**: Tier 0 actions are silently dropped — they never enter the registry
2. **Discovery**: Tier annotations appear in action listings (`[requires confirm + reason]`)
3. **Execution**: Tier gates are checked before handler dispatch, Zod validates params, response filtering runs on handler return values
4. **Path validation**: Applied within filesystem handler code before API calls

## Development

```bash
npm install
npm run build       # TypeScript compilation
npm test            # 65 tests via vitest
npm run type-check  # tsc --noEmit
npm run dev         # Watch mode
```

### Project Structure

```
src/
  index.ts           # MCP server setup, truenas tool definition
  cli.ts             # CLI entry point, env var parsing
  client.ts          # WebSocket JSON-RPC 2.0 client (DDP protocol)
  registry.ts        # Tool registry with centralized safety enforcement
  safety.ts          # Tier classification map (pure data)
  validation.ts      # Filesystem path validation
  filters.ts         # Sensitive field redaction
  resources.ts       # 12 read-only MCP resources
  types.ts           # Type definitions
  tools/
    index.ts         # Registry builder
    system.ts        # System, services, mail, API keys
    storage.ts       # Pools, datasets, snapshots
    sharing.ts       # SMB, NFS, iSCSI
    network.ts       # Interfaces, users, groups, disks, audit
    vm.ts            # VMs, apps, Docker
    alert.ts         # Alerts, certs, updates, boot environments
    replication.ts   # Replication, cloud sync, cron, rsync
    filesystem.ts    # Filesystem ops, reporting, directory services, tunables
  __tests__/
    safety.test.ts       # Tier map completeness and correctness
    registry.test.ts     # Safety enforcement logic
    client.test.ts       # WebSocket client protocol
    validation.test.ts   # Path validation
    filters.test.ts      # Response filtering
    integration.test.ts  # End-to-end pipeline verification
```

### Test Coverage

- **Safety**: Every action has a tier assignment, no typos, blocked count exact
- **Registry**: Tier 0 blocking, tier 1/2 gate enforcement, Zod validation, discovery annotations
- **Client**: DDP handshake, auth, request multiplexing, timeout, reconnect, TLS safety
- **Validation**: Path traversal rejection, `/mnt/` prefix enforcement, null byte rejection
- **Filtering**: Sensitive field redaction at all nesting levels, primitives pass through
- **Integration**: Full pipeline — tool count, category listing, tier enforcement, filtering, path validation

### Known Limitations

- **SMART test initiation** is not available in the TrueNAS WebSocket API. The `disk_smart_test_run` action returns an informational message directing users to the TrueNAS web UI. SMART test results are available through `disk.query` response data.
- **`dataset_set_permissions`** uses `filesystem.setperm` as a substitute since `pool.dataset.permission` does not exist in the WebSocket API. Dataset IDs are passed as the path parameter.

## Changes from Upstream

| Area | Upstream (spranab/truenas-mcp) | sr-truenas-mcp |
|------|-------------------------------|----------------|
| Transport | REST API v2.0 (deprecated) | WebSocket JSON-RPC 2.0 (DDP) |
| Safety model | `confirm: true` on some actions | 4-tier system with centralized enforcement |
| Blocked actions | 0 | 8 (reboot, shutdown, API escape hatch, cron/init script creation) |
| API escape hatch | `truenas_api_call` (raw HTTP to any endpoint) | Removed |
| TLS handling | `process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"` | Per-connection `rejectUnauthorized` |
| Path validation | None | `/mnt/` prefix required, traversal rejected |
| Response filtering | None | Sensitive fields redacted |
| Tests | 0 | 65 |
| CI | None | GitHub Actions |
| Dependency management | None | Renovate |

## Acknowledgments

- Original [truenas-mcp](https://github.com/spranab/truenas-mcp) by [spranab](https://github.com/spranab) — the comprehensive tool registry and hierarchical discovery design
- [TrueNAS WebSocket API documentation](https://www.truenas.com/docs/api/) — method name verification (v25.10.2, v26.0.0, v27.0.0)
- [truenas-mcp Go implementation](https://github.com/dariusbakunas/truenas-mcp) — DDP protocol reference patterns
- Development assisted by [Claude Code](https://claude.ai/claude-code)

## License

[MIT](LICENSE) — see LICENSE file for full terms.

Original work copyright (c) 2026 spranab. Modifications copyright (c) 2026 Static Revolution.
