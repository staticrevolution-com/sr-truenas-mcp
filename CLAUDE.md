# sr-truenas-mcp

Hardened MCP server for TrueNAS SCALE. Fork of `spranab/truenas-mcp`.

## Roadmap

No active roadmap — all the development work that became the v1.0.0 public release is shipped. Two historical plan documents preserve the development log:

- [`PLAN-v1.0.0.md`](./PLAN-v1.0.0.md) — initial hardening journey (REST → WebSocket migration, safety tiers, response filtering, validation).
- [`PLAN-bulletproofing-v1.0.1-v1.1.0.md`](./PLAN-bulletproofing-v1.0.1-v1.1.0.md) — reliability + spec-alignment phases (formerly `PLAN.md`). Phase A and B are ✅ shipped; Phase C deferred items are documented with their forcing-functions for future revisitation.

One open evaluation (no scheduled work): [`docs/TOOL-SURFACE-EVALUATION.md`](./docs/TOOL-SURFACE-EVALUATION.md) — dispatcher-vs-flat-tools, raised during `sr-mcp-gateway` planning; recommended position is to keep the current single-tool design.

Live-deploy findings from TrueNAS 26.0.0-BETA.1 (2026-06-12): [`docs/FIELD-REPORT-2026-06-12-truenas-26.md`](./docs/FIELD-REPORT-2026-06-12-truenas-26.md) — three bugs (middlewared error-detail propagation, job-wait on filesystem write handlers, execute-mode discovery errors), fixed and shipped in **v1.1.1**, deployed to production 2026-06-13. Remaining deferred follow-ups: the 26.0 compatibility sweep and a job-method audit across all handlers.

Field findings from a 2026-08-21 memory-pressure investigation (same box, still 26.0.0-BETA.1): [`docs/FIELD-REPORT-2026-08-21-reporting-and-diagnostics.md`](./docs/FIELD-REPORT-2026-08-21-reporting-and-diagnostics.md) — **open, no fixes landed**. `reporting_get_data`'s `start`/`end` cannot be satisfied in any form (Zod wants a string, middlewared wants an integer epoch, ISO 8601 is never converted), so the action only ever returns the last hour; `unit`/`page` are silently dropped; and the response returns ~3,600 raw points per graph when the `aggregations` block it already carries is what callers actually want. Two coverage gaps sit behind them: no kernel-log/`dmesg` action and no memory/swap/ARC summary — the ZFS-NAS-shaped hole. Ranked fixes and workarounds are in the report.

**Production deployment (current).** This server federates through `sr-mcp-gateway` (which replaced the decommissioned `sr-agentgateway`) as a **container-strategy backend** running `ghcr.io/staticrevolution-com/sr-truenas-mcp:v1.2.0` (deployed 2026-08-21). Note this line previously claimed `:v1.1.1`; the backend was in fact pinned to `:v1.1.2` before the 1.2.0 swap — verify the pin against the gateway's own `GET /api/v1/backends/truenas` rather than this file, which has drifted before. Version-numbering note: v1.1.1 sits above an orphaned `:v1.1.0` image — a pre-2026-05-01-history-rewrite artifact with no backing git tag that production was previously pinned to. The field-report fixes were first cut as v1.0.1, then renumbered to v1.1.1 to sort above it; v1.0.1 is withdrawn. Full backstory in CHANGELOG `[1.1.1]`. The orphaned `:v1.1.0` and `:v1.0.1` GHCR image tags were deleted 2026-06-13; only `:v1.1.1`/`latest` and `:v1.0.0` remain tagged (plus untagged attestation/SBOM manifests).

## Conventions for AI-tooling sessions

This repo is maintained by Warren Kelly. AI tooling (Claude Code) is used as part of the development workflow; attribution of that use is handled in the README's "Development approach" section, not in individual commits or PRs.

- Commits: author and committer are the human. No `Co-Authored-By` trailer for Claude. No "Generated with" footer.
- PR descriptions and issue comments: no AI-tool self-attribution.
- Code comments: do not annotate code as AI-generated.
- README, CHANGELOG, release notes: AI-tooling framing is the maintainer's call, not the tool's. Do not insert it unprompted.

## Build & Test

```bash
npm install
npm run build          # tsc
npm test               # vitest run (272 tests)
npm run type-check     # tsc --noEmit
npm run dev            # tsc --watch
npm run build:binary   # tsc + esbuild + pkg → dist/sr-truenas-mcp (Linux x64 binary)
npm run audit:counts   # print structural counts (filter, tiers, validation surface)
```

### Standalone Binary

`npm run build:binary` produces a self-contained Linux x64 ELF binary at `dist/sr-truenas-mcp` (~55MB). Embeds Node.js 20 runtime via esbuild bundling + @yao-pkg/pkg. Used as the stdio backend for an MCP gateway (the `sr-mcp-gateway` process-strategy backend) — see Deployment.

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
| 2 — Confirm | `confirm: true` | 93 | `service_stop`, `snapshot_delete`, `smb_share_create`, `iscsi_extent_create`, `replication_run` |
| 3 — Open | None | 157 | All reads, safe queries |

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

Handlers serialize their payload into `content[].text` *before* the registry sees it, so the registry's `filterToolResult` re-parses each JSON text block, runs `filterSensitiveFields` over the parsed data, and re-serializes (non-JSON text — confirm-gate warnings — passes through). Resource handlers filter the raw data before stringifying, so they redact directly.

### Path & Dataset-Name Validation

Two validators in `src/validation.ts`:

- **`validateTrueNASPath(path)`** — for filesystem paths. Must start with `/mnt/`, no `..`, no null bytes. 24 call sites across `filesystem.ts`, `sharing.ts` (smb/nfs share `path`, iscsi extent file `path`), `replication.ts` (cloudsync/cloud_backup/rsync `path`), `network.ts` (user `home`), and `storage.ts` (`dataset_set_permissions` mountpoint).
- **`validateDatasetName(name)`** — for ZFS dataset names (e.g. `tank/data`). Charset `[a-zA-Z0-9._:/-]`, max 255 chars, no `..`, no null bytes. 4 call sites: `dataset_create` (`storage.ts`), `replication_create` (`source_datasets[]` + `target_dataset`), and `replication_restore` (`target_dataset`). `dataset_create` additionally routes `/mnt/`-prefixed input through `validateTrueNASPath` for defense in depth.

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

**Production federates this MCP behind `sr-mcp-gateway`** (Static Revolution's own MCP gateway, now in production — it replaced `sr-agentgateway`, which has been decommissioned). The "direct node" path is a developer convenience for testing the MCP locally against a TrueNAS — not a production deployment.

Production endpoint specifics (UI/API ports, websocket URL, API-key location) live in the private homelab docs, not in this public repo. Note that TrueNAS 26.0 removes REST v2 entirely (`/api/v2.0/*` 404s) — the WebSocket JSON-RPC API is the only API surface there.

### sr-mcp-gateway — production

Unlike the old agentgateway (which baked backends into a combined image at build time), `sr-mcp-gateway` treats backends as **runtime data**: a backend is registered through the gateway's admin API/GUI and supervised as a long-lived **process** or **container** child, with its env (`TRUENAS_URL`, `TRUENAS_API_KEY`, `TRUENAS_VERIFY_SSL`) stored encrypted-at-rest in the gateway. This repo ships both artifacts a backend needs — the standalone Linux binary (process strategy) and the GHCR Docker image (container strategy); pick whichever the gateway backend is configured for. The exact registration (strategy, command/image, env) lives in `sr-mcp-gateway`'s config and its [`docs/CONFIGURATION.md`](../sr-mcp-gateway/docs/CONFIGURATION.md) / [`docs/ADMINISTRATION.md`](../sr-mcp-gateway/docs/ADMINISTRATION.md), not here.

Because the backend is supervised long-lived rather than spawned per request (as agentgateway's stateless stdio mode did), the WebSocket to TrueNAS persists across calls — so the persistent-mode `TRUENAS_KEEPALIVE_INTERVAL_MS` knob can be worth enabling here, where under agentgateway it was dead weight.

Update: publish a new tagged release (CI builds the binary tarball + GHCR image), then point the gateway backend at the new version and let the supervisor restart it. After deploy, verify the running version with `sr-truenas-mcp --version` (process strategy: exec in the gateway host/container; container strategy: `dockerProxy → exec` against the backend container).

### Claude Code (direct node) — dev only
```json
{
  "mcpServers": {
    "truenas": {
      "command": "node",
      "args": ["/path/to/sr-truenas-mcp/dist/cli.js"],
      "env": {
        "TRUENAS_URL": "wss://truenas.local:444",
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
| `TRUENAS_URL` | Yes | TrueNAS URL (e.g., `wss://truenas.local:444`) |
| `TRUENAS_API_KEY` | Yes | API key from TrueNAS UI |
| `TRUENAS_VERIFY_SSL` | No | Set `false` to skip TLS verification (warns on stderr) |
| `TRUENAS_SKIP_PREFLIGHT` | No | Set `1` to bypass the startup health check (default: preflight runs, fails-fast on misconfig) |
| `TRUENAS_LOG_LEVEL` | No | `error` (default) / `warn` / `info` / `debug`. Emits JSON-line structured logs to stderr. Never includes params or response bodies. |
| `TRUENAS_KEEPALIVE_INTERVAL_MS` | No | Milliseconds between idle `system.info` pings (default `0` = disabled). Useful for persistent-mode deploys where the backend (and its WebSocket) is held open across calls — e.g. an `sr-mcp-gateway` supervised backend. A stateless per-request gateway spawn tears the session down anyway, making it dead weight there. |

## Known Limitations

- SMART test initiation not available via WebSocket API. Results available through `disk.query`.
- `dataset_set_permissions` uses `filesystem.setperm` since `pool.dataset.permission` doesn't exist in WebSocket API.
- `config.save` requires a binary pipe — handler returns informational message directing to TrueNAS web UI.
- `npm audit` reports 0 vulnerabilities as of B6 (transitive `hono`/`postcss` bumps via `npm audit fix`; lockfile only).


---

## Portainer stack safety

Docker stack lifecycle goes through Portainer endpoints, never `dockerProxy`. Full rule: `~/.claude/rules/portainer-safety.md`.
