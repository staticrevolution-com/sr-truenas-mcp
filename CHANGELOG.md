# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **The confirm gate is satisfiable again for create/update actions.** The
  safety wrapper read `confirm` from `params` to clear a tier-1/tier-2 gate
  but only stripped `reason` before dispatch — `confirm` was forwarded into
  the upstream call. Handlers that build their payload from named fields
  (the delete family, `user_create`, `filesystem_chown`/`setacl`) were
  unaffected, but handlers that forward the whole params object
  (`smb_share_create`/`_update`, `nfs_share_*`, the `*_config_update` family,
  `user_update`, and peers) leaked `confirm` into a strict middleware model
  and failed with `[EINVAL] data.confirm: Extra inputs are not permitted` —
  leaving no invocation that both cleared the gate and produced a valid
  payload. `registry.ts` now strips `confirm` before dispatch *unless* the
  handler declares it in its own schema (the delete family that consumes it
  as in-handler defense-in-depth still receives it).

### Added

- **`confirm` is now a first-class top-level dispatcher field**, mirroring
  `reason`, so the safety flag has a clean control channel instead of being
  buried in `params`. Supplying it inside `params` still works and is still
  correct; the top-level field is preferred and overrides a nested value.
- **Four pipeline tests** pin the strip: `confirm` removed from the
  `smb_share_create` body, `confirm` + `reason` removed from the spread-style
  `user_update` body, `confirm` preserved for the declaring `smb_share_delete`
  handler, and the gate still firing with no upstream call when `confirm` is
  absent. 230 tests total.

## [1.1.1] — 2026-06-13

Bug-fix release carrying the TrueNAS 26.0.0-BETA.1 field-report fixes
(identical code to the withdrawn 1.0.1 below). No new actions, no schema
changes, no breaking changes. Triage record in
[`docs/FIELD-REPORT-2026-06-12-truenas-26.md`](./docs/FIELD-REPORT-2026-06-12-truenas-26.md).

**Version note.** This is numbered 1.1.1, not 1.0.1, to sit above the
`1.1.0` image still running in production. Backstory: the 2026-05-01
history rewrite consolidated the old internal `1.0.0`/`1.0.1`/`1.1.0`
tags into the single public `1.0.0`, but the old GHCR images outlived
their git tags — the production gateway was still pinned to an orphaned
`:1.1.0` (pre-fix code, same 270-action / 17-category surface as current
`master`). A patch cut from `master` as `1.0.1` would therefore have been
numerically *below* what was deployed. `1.1.1` is the same fixes
renumbered to a clean monotonic bump over the deployed `1.1.0`; current
`master` is a superset of that orphaned `1.1.0` (its full feature surface
plus these fixes), so deploying `1.1.1` adds the fixes with zero surface
loss. The `1.0.1` tag/release is withdrawn (see below).

### Fixed

- **API errors no longer collapse to "API call failed."** middlewared's
  DDP error payload carries `errname` + a multiline `reason` + an errno,
  not the generic `message`/`code` shape the client expected — so every
  middleware error rendered as the bare fallback string (a live
  `EZFS_EXISTS` was lost this way). New `formatDDPError()` in
  `src/client.ts` surfaces `errname` + the first line of `reason`; the
  legacy `message`/`code` shape still works.
- **Filesystem write handlers no longer report false success.**
  `filesystem.chown`, `filesystem.setperm`, and `filesystem.setacl` are
  `@job` methods; the handlers returned the enqueued job id as success
  without waiting, so a failed job was invisible. They now wait for the
  job (`waitForJob`) and surface its terminal state — a FAILED/ABORTED
  job is an error, not a success.
- **`filesystem_mkdir` verifies the directory exists after creating it**
  (`filesystem.stat` back), and errors with a post-write-verification
  message when it is absent — the case where a write "succeeds" against
  an unmounted parent dataset and lands nowhere.
- **`dataset_create` warns when the new dataset is left unmounted.**
  26.0.0-BETA.1 was observed creating the ZFS dataset, then failing
  before mount; the handler now stats the returned mountpoint and appends
  an explicit created-but-unmounted warning instead of a clean success.
- **Discovery errors no longer render an empty action list.** `execute()`
  with an unknown category produced `Available: ` with nothing after it.
  Unknown categories now list the valid categories; unknown actions in a
  valid category list that category's actions.

### Changed

- **Category-list discovery output points callers at `system_version`,**
  since TrueNAS API behavior differs across major versions.
- **226 tests** (was 211) across 13 test files — adds
  `handler-verification.test.ts` (job-wait + post-write verification) and
  `formatDDPError` / execute-mode discovery-error coverage.

[1.1.1]: https://github.com/staticrevolution-com/sr-truenas-mcp/releases/tag/v1.1.1

## [1.0.1] — 2026-06-13 — *withdrawn, superseded by [1.1.1]*

Originally cut as the field-report bug-fix release before it was
discovered that production was running an orphaned `1.1.0` image (see the
1.1.1 version note above). Re-released unchanged as **1.1.1** so the
version sorts above the deployed `1.1.0`. Do not deploy `1.0.1` — it is
numerically below production and exists only as historical record. The
code is identical to 1.1.1.

[1.0.1]: https://github.com/staticrevolution-com/sr-truenas-mcp/releases/tag/v1.0.1

## [1.0.0] — 2026-05-01

First public release. Forked from
[`spranab/truenas-mcp`](https://github.com/spranab/truenas-mcp); transport
migrated from TrueNAS REST API v2.0 to WebSocket JSON-RPC 2.0 (DDP); safety
surface, response filtering, validation, tests, and CI authored
independently for this repository. Architecture and module layout under
`src/tools/` are inherited from upstream.

The development log of the work that became this release is preserved in
[`PLAN-v1.0.0.md`](./PLAN-v1.0.0.md) (initial hardening) and
[`PLAN-bulletproofing-v1.0.1-v1.1.0.md`](./PLAN-bulletproofing-v1.0.1-v1.1.0.md)
(reliability + spec-alignment phases). Internal pre-release tags
`v1.0.0`, `v1.0.1`, and `v1.1.0` were consolidated into this single public
release on 2026-05-01.

### Added

- **Transport.** Full migration from TrueNAS REST API v2.0 to WebSocket
  JSON-RPC 2.0 (DDP protocol). 270 of 273 upstream actions mapped 1:1 to
  WebSocket methods.
- **Four-tier safety classification** (`src/safety.ts`):
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
- **Centralized safety enforcement** in `src/registry.ts` — tier check +
  Zod validation + response filtering, fail-closed at registration.
- **Layered response filter** in `src/filters.ts` — 57 exact key matches,
  9 suffix patterns (`_password$`, `_token$`, `_secret$`, `_passphrase$`,
  `_seed$`, `_private_key$`, `_credentials$`, `_pin$`, `_passwd$`),
  15-entry `NEVER_REDACT` allowlist for benign `*_key` identifiers and
  public-key material.
- **Path validation** (`validateTrueNASPath`) — must start with `/mnt/`,
  no `..`, no null bytes. 23 call sites.
- **Dataset-name validation** (`validateDatasetName`) — charset
  `[a-zA-Z0-9._:/-]`, max 255 chars, no `..`, no null bytes. Applied at
  `dataset_create` and `replication_create` (source datasets + target
  dataset).
- **Schema tightening** on high-risk methods: `pool.create`,
  `pool.dataset.create`, `pool.dataset.update`, `replication.create`,
  `sharing.smb.create`, `vm.create`, `vm.device.create`,
  `interface.create`, `disk.wipe`, `system.general.update`. Strict enums
  and patterns replace permissive `Record<string, unknown>`.
- **Per-connection TLS settings** — no `process.env.NODE_TLS_REJECT_UNAUTHORIZED`
  mutation.
- **`destructiveHint: true`** annotation on the `truenas` MCP tool, plus
  per-action `destructive: true|false` markers in `listActions()` output
  for clients that consume the MCP `_meta` annotation surface.
- **UUID request IDs** in the WebSocket client (`crypto.randomUUID()`),
  replacing incrementing-integer IDs.
- **Optional periodic keepalive ping** (`TRUENAS_KEEPALIVE_INTERVAL_MS`,
  default `0` = disabled). Useful only for persistent-mode deploys;
  AgentGateway stateless mode tears down sessions per request.
- **Structured stderr logging** gated by `TRUENAS_LOG_LEVEL`
  (`error` | `warn` | `info` | `debug`). JSON-line format. Never logs
  parameters or response bodies.
- **Pre-flight health check at startup** — connects + authenticates +
  issues a trivial read before announcing MCP capabilities. Bypassable
  via `TRUENAS_SKIP_PREFLIGHT=1`.
- **CLI flags** — `--version`/`-v` (with build SHA injected at bundle
  time via esbuild `--define`; output format
  `<pkg.version>+<git-short-sha>[.dirty]`) and `--help`/`-h`.
- **Standalone Linux x64 binary** build via esbuild + `@yao-pkg/pkg`.
- **MCP Resources** — 12 read-only resources for at-a-glance system state
  (pools, datasets, snapshots, shares, etc.).
- **CI** — build + test + audit on push/PR; release workflow attaches
  binary tarball, SHA-256, SBOM, and npm package.
- **`npm run audit:counts`** — prints structural counts (filter sizes,
  per-tier action counts, validation call sites) for CI doc-sync.
- **`src/__tests__/doc-sync.test.ts`** — CI gate that fails if
  `CLAUDE.md` numerical claims drift from the source.
- **211 tests** across 12 test files (registry, safety, validation,
  filters, client, resources, preflight, doc-sync, integration, etc.).

### Changed

- **License**: PolyForm Noncommercial 1.0.0 (source-available; free for
  personal, educational, governmental, and research use; commercial use
  requires a paid commercial license). Upstream MIT attribution
  preserved in [`NOTICES`](./NOTICES).
- **WebSocket client** (`src/client.ts`) hardened against three races:
  - **Late-response settlement guard.** Each pending request carries a
    `settled` flag; both timer and message paths route through a single
    `settlePending()` state-transition function.
  - **Send-error orphan fix.** `pending.set(id, req)` runs before
    `ws.send()`. Synchronous send errors are caught and routed through
    `settlePending(id, "reject", new WebSocketSendError(...))`.
  - **Reconnect cleanup preserves idempotent callers.** `client.call()`
    honors per-method idempotency for reconnect retries: read methods
    (`*.query`, `*.get_instance`, `*.config`, `core.get_jobs`) auto-retry
    on reconnect; everything else throws `ReconnectAborted`.
- **Job polling** (`waitForJob`) uses exponential backoff (1 s ×1.5,
  cap 15 s) and skips polls while the WebSocket is disconnected.
- **Resource fan-out** (`src/resources.ts`) uses `Promise.allSettled`. A
  single failed source no longer blackholes the resource read; failed
  sources surface in a `_errors` field on the response.
- **`src/mcp-adapter.ts`** is now the only runtime importer of
  `@modelcontextprotocol/sdk` symbols; every other file uses
  `import type`. Forward prep for SDK 2.0 migration.

### Removed

- **Upstream `truenas_api_call` raw-REST escape hatch.** With it present,
  every other safety gate becomes cosmetic.
- `api` category from the action namespace.

### Fixed

- All 3 moderate transitive npm-audit vulnerabilities (`hono`,
  `@hono/node-server`, `postcss`) cleared via lockfile-only updates.
- Path-validation gaps on `dataset_create` and `replication_create`
  closed.
- Integration tool-count assertion is self-maintaining
  (`tools.size + BLOCKED.size === ACTION_TIERS.size`).
- Cosmetic: agentgateway image-mode reports correct version stamp via
  injected `BUILD_VERSION` build-arg.

### Deferred

- **Sigstore artifact attestations** (`actions/attest-build-provenance`,
  `actions/attest-sbom`) require either a paid GitHub plan or a public
  repo. SBOM ships; attestations re-enable once the repo flips public.
  Re-enable instructions are commented in `release.yml`.

[1.0.0]: https://github.com/staticrevolution-com/sr-truenas-mcp/releases/tag/v1.0.0
