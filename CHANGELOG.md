# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- License changed from MIT to PolyForm Noncommercial 1.0.0 in
  preparation for the first public release. Upstream MIT attribution
  for `spranab/truenas-mcp` is preserved in `NOTICES`.

## [1.1.0] — 2026-04-29

Reliability and protocol-level spec alignment. See `PLAN.md` Phase B
for full context.

### Added

- `destructiveHint: true` annotation on the `truenas` MCP tool, plus
  per-action `destructive: true|false` markers in `listActions()` output
  for clients that consume the MCP `_meta` annotation surface.
- UUID request IDs in the WebSocket client (`crypto.randomUUID()`),
  replacing incrementing-integer IDs.
- Optional periodic keepalive ping (`TRUENAS_KEEPALIVE_INTERVAL_MS`,
  default `0` = disabled). Useful only for persistent-mode deploys;
  AgentGateway stateless mode tears down sessions per request.
- Structured stderr logging gated by `TRUENAS_LOG_LEVEL`
  (`error` | `warn` | `info` | `debug`). JSON-line format. Never logs
  parameters or response bodies.
- Pre-flight health check at startup — connects + authenticates +
  issues a trivial read before announcing MCP capabilities. Bypassable
  via `TRUENAS_SKIP_PREFLIGHT=1`.
- SBOM attached to GitHub releases (`sr-truenas-mcp-linux-x64.spdx.json`).
- `src/__tests__/doc-sync.test.ts` — CI gate that fails if `CLAUDE.md`
  numerical claims drift from the source.

### Changed

- `client.call()` honors per-method idempotency for reconnect retries.
  Read methods (`*.query`, `*.get_instance`, `*.config`, `core.get_jobs`)
  auto-retry on reconnect; everything else throws `ReconnectAborted`.
- Resource fan-out (`src/resources.ts`) uses `Promise.allSettled`. A
  single failed source no longer blackholes the resource read; failed
  sources surface in a `_errors` field on the response.
- `src/mcp-adapter.ts` is now the only runtime importer of
  `@modelcontextprotocol/sdk` symbols; every other file uses
  `import type`. Forward prep for SDK 2.0 migration.

### Fixed

- All 3 moderate transitive npm-audit vulnerabilities (`hono`,
  `@hono/node-server`, `postcss`) cleared via lockfile-only updates.
- Cosmetic: agentgateway image-mode now reports correct version stamp
  via injected `BUILD_VERSION` build-arg.

### Deferred

- Sigstore artifact attestations (`actions/attest-build-provenance`,
  `actions/attest-sbom`) require either a paid GitHub plan or a public
  repo. SBOM ships; attestations re-enable once the repo flips public.
  Re-enable instructions are commented in `release.yml`.

## [1.0.1] — 2026-04-25

Security and correctness pass. See `PLAN.md` Phase A for full context.

### Added

- **Layered response filter** in `src/filters.ts` — 57 exact key
  matches, 9 suffix patterns (`_password$`, `_token$`, `_secret$`,
  `_passphrase$`, `_seed$`, `_private_key$`, `_credentials$`, `_pin$`,
  `_passwd$`), 15-entry `NEVER_REDACT` allowlist for benign `*_key`
  identifiers and public-key material. 12+ previously unredacted
  sensitive fields now caught.
- **`validateDatasetName`** in `src/validation.ts` — charset
  `[a-zA-Z0-9._:/-]`, max 255 chars, no `..`, no null bytes. Applied
  at `dataset_create` and `replication_create` (source datasets +
  target dataset).
- Schema tightening on high-risk methods: `pool.create`,
  `pool.dataset.create`, `pool.dataset.update`, `replication.create`,
  `sharing.smb.create`, `vm.create`, `vm.device.create`,
  `interface.create`, `disk.wipe`, and `system.general.update`. Strict
  enums and patterns replace permissive `Record<string, unknown>`.
- `--version` / `-v` flag on the CLI. Build SHA injected at bundle
  time via esbuild `--define`. Output format:
  `<pkg.version>+<git-short-sha>[.dirty]`.
- `npm run audit:counts` — prints structural counts (filter sizes,
  per-tier action counts, validation call sites) for CI doc-sync.

### Changed

- WebSocket client (`src/client.ts`) hardened against three races:
  - **Late-response settlement guard.** Each pending request now
    carries a `settled` flag; both timer and message paths route
    through a single `settlePending()` state-transition function.
    Eliminates the unhandled-rejection on race between timer fire
    and message arrival.
  - **Send-error orphan fix.** `pending.set(id, req)` runs before
    `ws.send()`. Synchronous send errors are caught and routed
    through `settlePending(id, "reject", new WebSocketSendError(...))`.
  - **Reconnect cleanup preserves idempotent callers.** See "Added"
    under v1.1.0 for the idempotency policy that landed on top of
    this.
- Job polling (`waitForJob`) uses exponential backoff (1s ×1.5, cap
  15s) and skips polls while the WebSocket is disconnected.

### Fixed

- Path-validation gaps on `dataset_create` and `replication_create`
  closed.
- Integration test `expect 270` is now self-maintaining
  (`tools.size + BLOCKED.size === ACTION_TIERS.size`).

## [1.0.0] — 2026-04-15

Initial public-fork release.

### Added

- Full transport migration from TrueNAS REST API v2.0 to WebSocket
  JSON-RPC 2.0 (DDP protocol). 270 of 273 upstream actions mapped 1:1
  to WebSocket methods.
- Four-tier safety classification (`src/safety.ts`):
  - **Tier 0** (8 actions, never register): `system_reboot`,
    `system_shutdown`, `truenas_api_call`, `cronjob_create`,
    `cronjob_update`, `initshutdown_create`, `initshutdown_update`,
    `system_config_upload`.
  - **Tier 1** (20 actions, require `confirm: true` + `reason`):
    pool/disk/dataset destruction, system config download, network
    commit, boot environment changes, etc.
  - **Tier 2** (81 actions, require `confirm: true`): service
    stop/restart, share CRUD, user/group CRUD, certificate CRUD,
    cloud sync delete, etc.
  - **Tier 3** (169 actions, no gate): reads, queries, safe creates.
- Centralized safety enforcement in `src/registry.ts` — tier check +
  Zod validation + response filtering, fail-closed at registration.
- Path validation (`validateTrueNASPath`) — must start with `/mnt/`,
  no `..`, no null bytes. 23 call sites.
- Initial response filtering (exact-match only) — 30 sensitive field
  names redacted from handler returns.
- Per-connection TLS settings — no `process.env.NODE_TLS_REJECT_UNAUTHORIZED`
  mutation.
- Standalone Linux x64 binary build via esbuild + `@yao-pkg/pkg`.
- 65 tests at release time across registry, safety, validation,
  filters, and 8 tool modules.
- GitHub Actions CI for build + test on push/PR.
- 12 read-only MCP Resources for at-a-glance system state (pools,
  datasets, snapshots, shares, etc.).

### Removed

- Upstream `truenas_api_call` raw-REST escape hatch. With it present,
  every other safety gate becomes cosmetic.
- `api` category from the action namespace.

### Changed

- Forked from [`spranab/truenas-mcp`](https://github.com/spranab/truenas-mcp).
  Architecture and module layout under `src/tools/` are inherited;
  transport, safety surface, validation, filtering, tests, and CI
  were authored independently.

[Unreleased]: https://github.com/staticrevolution-com/sr-truenas-mcp/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/staticrevolution-com/sr-truenas-mcp/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/staticrevolution-com/sr-truenas-mcp/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/staticrevolution-com/sr-truenas-mcp/releases/tag/v1.0.0
