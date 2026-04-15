# sr-truenas-mcp

Hardened MCP server for TrueNAS SCALE. Fork of `spranab/truenas-mcp`.

## Build & Test

```bash
npm install
npm run build       # tsc
npm test            # vitest run
npm run type-check  # tsc --noEmit
npm run dev         # tsc --watch
```

## Architecture

Single MCP tool (`truenas`) with hierarchical discovery: 270 active actions across 17 categories, exposed through 3 modes (list categories, list actions, execute).

**Transport**: WebSocket JSON-RPC 2.0 (DDP protocol) — connects to `wss://{host}/websocket`. Replaced REST API v2.0 (deprecated, undocumented in TrueNAS 25.10.2+).

**Safety enforcement** is centralized in `src/registry.ts`:
- Tier 0 actions silently dropped at registration (never discoverable)
- Tier 1/2 confirm gates checked before handler dispatch
- Runtime Zod validation wraps every handler
- Response filtering (sensitive field redaction) on every handler return
- Path validation on all filesystem operations

### Key Files

- `src/index.ts` — MCP server setup, single `truenas` tool with 3 modes
- `src/registry.ts` — Tool registry, categorization, centralized safety enforcement
- `src/client.ts` — WebSocket JSON-RPC 2.0 client (DDP handshake, request multiplexing, auto-reconnect)
- `src/safety.ts` — Tier classification map (pure data, every action -> tier)
- `src/validation.ts` — Path validation (`/mnt/` prefix, no traversal)
- `src/filters.ts` — Response filtering (sensitive field redaction)
- `src/tools/*.ts` — 8 tool modules registering handlers
- `src/tools/index.ts` — `buildRegistry()` wiring
- `src/resources.ts` — 12 read-only MCP Resources

### Safety Tiers

| Tier | Gate | Count | Examples |
|------|------|-------|---------|
| 0 — Blocked | Never registered | 8 | `system_reboot`, `truenas_api_call`, `cronjob_create` |
| 1 — Confirm+Reason | `confirm: true` + `reason: "string"` | 14 | `pool_export`, `disk_wipe`, `dataset_delete` |
| 2 — Confirm | `confirm: true` | 69 | `service_stop`, `user_delete`, `vm_delete` |
| 3 — Open | None | 187 | All reads, safe creates, queries |

Full tier assignments in `src/safety.ts`.

### Response Filtering

All handler responses pass through `filterSensitiveFields()` which redacts: `password`, `privatekey`, `private_key`, `pass`, `passwd`, `monpwd`, `encryption_key`, `secret`, `secretseed`, `secret_seed`, `v3_password`, `v3_privpassphrase`.

### Path Validation

All 7 filesystem handlers validate paths via `validateTrueNASPath()`: must start with `/mnt/`, no `..`, no null bytes.

## Environment Variables

| Var | Required | Description |
|-----|----------|-------------|
| `TRUENAS_URL` | Yes | TrueNAS instance URL (e.g., `https://192.168.1.235`) |
| `TRUENAS_API_KEY` | Yes | API key from TrueNAS UI |
| `TRUENAS_VERIFY_SSL` | No | Set `false` to skip TLS verification |

## MCP Config (Claude Code)

```json
{
  "mcpServers": {
    "truenas": {
      "command": "node",
      "args": ["D:/github-local/staticrevolution-com/sr-truenas-mcp/dist/cli.js"],
      "env": {
        "TRUENAS_URL": "wss://192.168.1.235",
        "TRUENAS_API_KEY": "...",
        "TRUENAS_VERIFY_SSL": "false"
      }
    }
  }
}
```

## WebSocket Protocol

TrueNAS uses DDP (Distributed Data Protocol) over WebSocket at `/websocket`:
1. Connect: `{"msg":"connect","version":"1","support":["1"]}`
2. Auth: `auth.login_with_api_key` with API key as string param
3. Calls: `{"id":"N","msg":"method","method":"pool.query","params":[]}`
4. Responses: `{"id":"N","msg":"result","result":[...]}`

Method mapping: `pool.query`, `pool.get_instance`, `pool.create`, `pool.update`, `pool.delete`, etc. Filter syntax: `[["field","op","value"]]`. Job polling: `core.get_jobs` with `[["id","=",jobId]]`.

### Namespace Differences from REST API

All method names verified against TrueNAS v25.10.2 official API docs. Key namespace differences from the REST API:

| REST v2.0 | WebSocket JSON-RPC |
|-----------|-------------------|
| `/zfs/snapshot/*` | `pool.snapshot.*` |
| `/service/start`, `/stop`, `/restart` | `service.control` with verb `"START"`, `"STOP"`, `"RESTART"` |
| `/bootenv/*` | `boot.environment.*` (query, clone, activate, destroy, keep) |
| `/pool/id/{id}/replace` | `pool.replace` |
| `/pool/dataset/id/{id}/permission` | `filesystem.setperm` |
| `/update/check_available` | `update.available_versions` |
| `/update` (GET config) | `update.config` |
| `/update/update` (apply) | `update.run` |
| `/smart/test/*` | Not available — SMART namespace doesn't exist in WebSocket API |
| `/disk/id/{id}` | `disk.query` with filter (no `disk.get_instance`) |
| `/system/config/download` | `config.save` |

## Known Issues

- `npm audit` shows 2 moderate vulnerabilities in transitive hono dependencies (not exploitable in stdio transport — hono's HTTP server is not used)
- SMART test initiation (`disk_smart_test_run`) is not available via the TrueNAS WebSocket API. SMART test results are available through `disk.query` response data. Use the TrueNAS web UI to initiate SMART tests.
- `dataset_set_permissions` uses `filesystem.setperm` as a substitute since `pool.dataset.permission` doesn't exist in the WebSocket API. The dataset ID is passed as the path — may need `/mnt/` prefix for mounted datasets during live testing.
