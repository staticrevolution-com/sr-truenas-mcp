# sr-truenas-mcp

Hardened MCP server for TrueNAS SCALE. Fork of `spranab/truenas-mcp`.

## Build & Test

```bash
npm install
npm run build          # tsc
npm test               # vitest run (65 tests)
npm run type-check     # tsc --noEmit
npm run dev            # tsc --watch
npm run build:binary   # tsc + esbuild + pkg → dist/sr-truenas-mcp (Linux x64 binary)
```

### Standalone Binary

`npm run build:binary` produces a self-contained Linux x64 ELF binary at `dist/sr-truenas-mcp` (~55MB). Embeds Node.js 20 runtime via esbuild bundling + @yao-pkg/pkg. Used for AgentGateway stdio deployment.

GitHub releases include pre-built `sr-truenas-mcp-linux-x64.tar.gz` with SHA256 checksums.

## Architecture

Single MCP tool (`truenas`) with hierarchical discovery: 270 active actions across 17 categories, exposed through 3 modes (list categories, list actions, execute).

**Transport**: WebSocket JSON-RPC 2.0 (DDP protocol) at `wss://{host}/websocket`.

**Safety enforcement** is centralized in `src/registry.ts`:
- Tier 0 actions silently dropped at registration (never discoverable)
- Tier 1/2 return detailed warnings with two-call confirmation flow
- Fail-closed: unclassified actions rejected at registration
- Runtime Zod validation wraps every handler
- Response filtering (36-pattern sensitive field redaction) on all returns
- Path validation on all 22 filesystem-touching handlers

### Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | MCP server setup, single `truenas` tool with 3 modes |
| `src/registry.ts` | Tool registry, categorization, centralized safety enforcement |
| `src/client.ts` | WebSocket JSON-RPC 2.0 client (DDP handshake, multiplexing, reconnect) |
| `src/safety.ts` | Tier classification map (pure data, every action -> tier) |
| `src/validation.ts` | Path validation (`/mnt/` prefix, no traversal) |
| `src/filters.ts` | Response filtering (36 sensitive field patterns) |
| `src/tools/*.ts` | 8 tool modules registering handlers |
| `src/tools/index.ts` | `buildRegistry()` wiring |
| `src/resources.ts` | 12 read-only MCP Resources (filtered) |

### Safety Tiers

| Tier | Gate | Count | Examples |
|------|------|-------|---------|
| 0 — Blocked | Never registered | 8 | `system_reboot`, `truenas_api_call`, `cronjob_create` |
| 1 — Confirm+Reason | `confirm: true` + `reason: "string"` | 20 | `pool_export`, `disk_wipe`, `dataset_delete`, `user_create`, `ssh_config_update` |
| 2 — Confirm | `confirm: true` | 81 | `service_stop`, `snapshot_delete`, `smb_share_create`, `cloudsync_update` |
| 3 — Open | None | 169 | All reads, safe queries |

Full tier assignments in `src/safety.ts`. 32 handlers also have in-handler `confirm` checks as defense-in-depth.

### Confirmation Flow

Tier 1/2 actions use a two-call confirmation pattern:

1. **First call** (without `confirm`) — returns a detailed warning as MCP content:
   ```
   ⚠ DESTRUCTIVE OPERATION: service_stop
   
   Stop a running service by name...
   
   Parameters:
     service: "ssh"
   
   This action modifies system state and may not be easily reversible.
   To proceed, the user must explicitly approve. Then call again with:
     confirm: true
   ```

2. **Second call** (with `confirm: true`, and `reason` for tier 1) — executes the action.

The LLM receives the warning as a normal tool response, presents it to the user, and only proceeds after explicit approval.

### Response Filtering

All handler and resource responses pass through `filterSensitiveFields()` which redacts 36 field patterns including: `password`, `privatekey`, `secret`, `api_key`, `token`, `community`, `unixhash`, `passphrase`, and more.

### Path Validation

22 handlers across filesystem.ts, sharing.ts, replication.ts, and network.ts validate paths via `validateTrueNASPath()`: must start with `/mnt/`, no `..`, no null bytes.

## WebSocket Protocol

TrueNAS uses DDP (Distributed Data Protocol) over WebSocket at `/websocket`:
1. Connect: `{"msg":"connect","version":"1","support":["1"]}`
2. Auth: `auth.login_with_api_key` with API key as string param
3. Calls: `{"id":"N","msg":"method","method":"pool.query","params":[]}`
4. Responses: `{"id":"N","msg":"result","result":[...]}`

Standard CRUD: `{ns}.query`, `{ns}.get_instance`, `{ns}.create`, `{ns}.update`, `{ns}.delete`.
Filter syntax: `[["field","op","value"]]`. Job polling: `core.get_jobs` with `[["id","=",jobId]]`.

### Key Namespace Differences from REST API

| REST v2.0 | WebSocket JSON-RPC |
|-----------|-------------------|
| `/zfs/snapshot/*` | `pool.snapshot.*` |
| `/service/start`, `/stop`, `/restart` | `service.control` with verb `"START"` / `"STOP"` / `"RESTART"` |
| `/bootenv/*` | `boot.environment.*` (query, clone, activate, destroy, keep) |
| `/pool/id/{id}/replace` | `pool.replace` |
| `/pool/dataset/id/{id}/permission` | `filesystem.setperm` |
| `/update/check_available` | `update.available_versions` |
| `/update` (GET config) | `update.config` |
| `/update/update` (apply) | `update.run` |
| `/disk/id/{id}` | `disk.query` with filter (no `disk.get_instance`) |
| `/smart/test/*` | Not available in WebSocket API |
| `/system/config/download` | `config.save` (pipe-based, returns info message) |
| `/pool/id/{id}/scrub` | `pool.scrub.scrub` (takes pool name, not ID) |

## Deployment

### Claude Code (direct node)
```json
{
  "mcpServers": {
    "truenas": {
      "command": "node",
      "args": ["D:/github-local/staticrevolution-com/sr-truenas-mcp/dist/cli.js"],
      "env": {
        "TRUENAS_URL": "wss://192.168.1.235:444",
        "TRUENAS_API_KEY": "...",
        "TRUENAS_VERIFY_SSL": "false"
      }
    }
  }
}
```

### AgentGateway (stdio binary)

Binary at `/mnt/data-pool/apps/agentgateway/bin/sr-truenas-mcp`. Config target in `config.yaml`:
```yaml
- name: truenas
  stdio:
    cmd: /opt/mcp-bin/sr-truenas-mcp
    env:
      TRUENAS_URL: "${TRUENAS_URL}"
      TRUENAS_API_KEY: "${TRUENAS_API_KEY}"
      TRUENAS_VERIFY_SSL: "${TRUENAS_VERIFY_SSL}"
```

Update binary: SCP to `/tmp/sr-truenas-mcp` on TrueNAS, redeploy stack (init copies from /tmp).

## Environment Variables

| Var | Required | Description |
|-----|----------|-------------|
| `TRUENAS_URL` | Yes | TrueNAS URL (e.g., `wss://192.168.1.235:444`) |
| `TRUENAS_API_KEY` | Yes | API key from TrueNAS UI |
| `TRUENAS_VERIFY_SSL` | No | Set `false` to skip TLS verification (warns on stderr) |

## Known Limitations

- SMART test initiation not available via WebSocket API. Results available through `disk.query`.
- `dataset_set_permissions` uses `filesystem.setperm` since `pool.dataset.permission` doesn't exist in WebSocket API.
- `config.save` requires a binary pipe — handler returns informational message directing to TrueNAS web UI.
- `npm audit` shows transitive hono vulnerabilities (not exploitable in stdio transport).
