# sr-truenas-mcp

Hardened MCP server for TrueNAS SCALE. Fork of `spranab/truenas-mcp`.

## Active Roadmap

**Current plan: [`PLAN.md`](./PLAN.md)** — Bulletproofing v1.0.1 → v1.1.0. Implementation status table at the top of the file. Historical record of the v1.0.0 hardening journey is at [`PLAN-v1.0.0.md`](./PLAN-v1.0.0.md).

The deployed binary on TrueNAS is post-v1.0.0 master (sha256 `fa0ce982…`, mtime Apr 16) — not the v1.0.0 GitHub release. Closing that governance gap is plan item **A8**.

## Build & Test

```bash
npm install
npm run build          # tsc
npm test               # vitest run (208 tests)
npm run type-check     # tsc --noEmit
npm run dev            # tsc --watch
npm run build:binary   # tsc + esbuild + pkg → dist/sr-truenas-mcp (Linux x64 binary)
npm run audit:counts   # print structural counts (filter, tiers, validation surface)
```

### Standalone Binary

`npm run build:binary` produces a self-contained Linux x64 ELF binary at `dist/sr-truenas-mcp` (~55MB). Embeds Node.js 20 runtime via esbuild bundling + @yao-pkg/pkg. Used for AgentGateway stdio deployment.

The bundle step (`scripts/build-bundle.mjs`) injects `__BUILD_VERSION__` (`<pkg.version>+<git-short-sha>[.dirty]`) via esbuild `--define`. The binary then exposes it through `--version`/`-v`, so the deployed artifact identifies itself without sha256-detective work. Direct `node dist/cli.js` (no bundle step) reports `dev`.

GitHub releases include pre-built `sr-truenas-mcp-linux-x64.tar.gz` with SHA256 checksums.

## Architecture

Single MCP tool (`truenas`) with hierarchical discovery: 270 active actions across 17 categories, exposed through 3 modes (list categories, list actions, execute).

**Transport**: WebSocket JSON-RPC 2.0 (DDP protocol) at `wss://{host}/websocket`.

**Safety enforcement** is centralized in `src/registry.ts`:
- Tier 0 actions silently dropped at registration (never discoverable)
- Tier 1/2 return detailed warnings with two-call confirmation flow
- Fail-closed: unclassified actions rejected at registration
- Runtime Zod validation wraps every handler
- Response filtering (layered matcher: 57 exact keys + 9 suffix patterns + 15-entry NEVER_REDACT allowlist; see `src/filters.ts`) on all returns
- Path validation on every filesystem-touching handler (`validateTrueNASPath` enforces `/mnt/` prefix, no `..`, no null bytes) and dataset-name validation on every ZFS-side handler (`validateDatasetName`: charset `[a-zA-Z0-9._:/-]`, max 255, no `..`, no null bytes)

### Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | MCP server setup, single `truenas` tool with 3 modes |
| `src/registry.ts` | Tool registry, categorization, centralized safety enforcement |
| `src/client.ts` | WebSocket JSON-RPC 2.0 client (DDP handshake, multiplexing, reconnect) |
| `src/safety.ts` | Tier classification map (pure data, every action -> tier) |
| `src/validation.ts` | Path validation (`/mnt/` prefix, no traversal) + dataset-name validation (`validateDatasetName`) |
| `src/filters.ts` | Response filtering (layered: 57 exact + 9 suffix + 15 allowlist) |
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

All handler and resource responses pass through `filterSensitiveFields()`, a 3-tier matcher: 57 exact keys (e.g. `password`, `privatekey`, `unixhash`, `salt`, `bindpw`, `recovery_codes`), 9 suffix patterns (`_password$`, `_token$`, `_secret$`, `_passphrase$`, `_seed$`, `_private_key$`, `_credentials$`, `_pin$`, `_passwd$`), and a 15-entry `NEVER_REDACT` allowlist that preserves benign `*_key` identifiers (`id_key`, `pool_key`, `vdev_key`, `device_key`), password-policy descriptors (`password_disabled`, `last_password_change`, `ssh_password_enabled`, …), and public-key material (`public_key`, `sshpubkey`, `authorized_keys`). Allowlist wins over both exact and suffix.

### Path & Dataset-Name Validation

Two validators in `src/validation.ts`:

- **`validateTrueNASPath(path)`** — for filesystem paths. Must start with `/mnt/`, no `..`, no null bytes. 23 call sites across `filesystem.ts`, `sharing.ts` (smb/nfs share `path`, iscsi extent file `path`), `replication.ts` (cloudsync/cloud_backup/rsync `path`), and `network.ts` (user `home`).
- **`validateDatasetName(name)`** — for ZFS dataset names (e.g. `tank/data`). Charset `[a-zA-Z0-9._:/-]`, max 255 chars, no `..`, no null bytes. 3 call sites: `dataset_create` (`storage.ts`) and `replication_create` (`source_datasets[]` + `target_dataset`). `dataset_create` additionally routes `/mnt/`-prefixed input through `validateTrueNASPath` for defense in depth.

Run `npm run audit:counts` to verify these numbers against the source.

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

**Production runs only as a stdio child of AgentGateway** (see "AgentGateway (stdio binary)" below). The "direct node" path is a developer convenience for testing the MCP locally against a TrueNAS — not a production deployment.

### AgentGateway (stdio binary) — production

Binary at `/mnt/data-pool/apps/agentgateway/bin/sr-truenas-mcp`, mounted into the agentgateway container at `/opt/mcp-bin/sr-truenas-mcp`. Config target in `config.yaml`:
```yaml
- name: truenas
  stdio:
    cmd: /opt/mcp-bin/sr-truenas-mcp
    env:
      TRUENAS_URL: "${TRUENAS_URL}"
      TRUENAS_API_KEY: "${TRUENAS_API_KEY}"
      TRUENAS_VERIFY_SSL: "${TRUENAS_VERIFY_SSL}"
```

Binary install pipeline lives in `staticrevolution-com/sr-agentgateway/docker-compose.yaml` (`truenas-mcp-init`). Source priority on stack restart: host `/tmp/sr-truenas-mcp` → existing `/bin-vol` cache → GitHub release tarball pinned to `${TRUENAS_MCP_VERSION:-v1.0.0}`. The `/tmp` shortcut is the immediate-replace channel during dev; tagged releases are the canonical production version.

Update binary: SCP to `/tmp/sr-truenas-mcp` on TrueNAS, redeploy stack (init copies from `/tmp`). After deploy, verify via `dockerProxy → exec sr-truenas-mcp --version` against the agentgateway container.

### Claude Code (direct node) — dev only
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

## Environment Variables

| Var | Required | Description |
|-----|----------|-------------|
| `TRUENAS_URL` | Yes | TrueNAS URL (e.g., `wss://192.168.1.235:444`) |
| `TRUENAS_API_KEY` | Yes | API key from TrueNAS UI |
| `TRUENAS_VERIFY_SSL` | No | Set `false` to skip TLS verification (warns on stderr) |
| `TRUENAS_SKIP_PREFLIGHT` | No | Set `1` to bypass the startup health check (default: preflight runs, fails-fast on misconfig) |
| `TRUENAS_LOG_LEVEL` | No | `error` (default) / `warn` / `info` / `debug`. Emits JSON-line structured logs to stderr. Never includes params or response bodies. |

## Known Limitations

- SMART test initiation not available via WebSocket API. Results available through `disk.query`.
- `dataset_set_permissions` uses `filesystem.setperm` since `pool.dataset.permission` doesn't exist in WebSocket API.
- `config.save` requires a binary pipe — handler returns informational message directing to TrueNAS web UI.
- `npm audit` shows transitive hono vulnerabilities (not exploitable in stdio transport).


---

<!-- portainer-safety-ref -->
## Portainer stack safety (global rule)

Stack lifecycle (create/remove containers, networks, volumes) MUST flow through Portainer stack endpoints — NEVER via `dockerProxy`. Allowed `dockerProxy` ops: GETs, `/images/create` pulls, `restart`/`start`/`stop` on existing containers, `exec`, `prune`. Lifecycle routes: `redeployStackGit`, `startStack`, `stopStack`, GitOps webhook, `POST /stacks/create/standalone/repository`. See `~/.claude/rules/portainer-safety.md`. Enforced by PreToolUse hook `portainer-guard.py`.
