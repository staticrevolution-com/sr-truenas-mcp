# sr-truenas-mcp

Hardened MCP server for TrueNAS SCALE. Fork of `spranab/truenas-mcp`.

## Roadmap

Current state and intended next work live in [`plans/OPEN-PLAN.md`](./plans/OPEN-PLAN.md); later work with nothing started lives in [`plans/ROADMAP.md`](./plans/ROADMAP.md). Those two files are the source of truth for what is open — read them rather than inferring status from a plan document's own header, which is what it believed when it was written.

Two historical plan documents preserve the development log, both complete:

- [`plans/PLAN-v1.0.0.md`](./plans/PLAN-v1.0.0.md) — initial hardening journey (REST → WebSocket migration, safety tiers, response filtering, validation).
- [`plans/PLAN-bulletproofing-v1.0.1-v1.1.0.md`](./plans/PLAN-bulletproofing-v1.0.1-v1.1.0.md) — reliability + spec-alignment phases (formerly `PLAN.md`). Phase A and B shipped; Phase C is deferred with its forcing-functions recorded.

One open evaluation (no scheduled work): [`docs/TOOL-SURFACE-EVALUATION.md`](./docs/TOOL-SURFACE-EVALUATION.md) — dispatcher-vs-flat-tools, raised during `sr-mcp-gateway` planning. ⚠ It is a **dated** document: its counts are from 2026-05-18, and its central RBAC premise predates the gateway's argument constraints. Re-check before citing it.

Live-deploy findings from TrueNAS 26.0.0-BETA.1 (2026-06-12): [`docs/FIELD-REPORT-2026-06-12-truenas-26.md`](./docs/FIELD-REPORT-2026-06-12-truenas-26.md) — three bugs (middlewared error-detail propagation, job-wait on filesystem write handlers, execute-mode discovery errors), fixed and shipped in **v1.1.1**, deployed to production 2026-06-13. Remaining deferred follow-ups: the 26.0 compatibility sweep and a job-method audit across all handlers.

Field findings from a 2026-08-21 memory-pressure investigation (same box, still 26.0.0-BETA.1): [`docs/FIELD-REPORT-2026-08-21-reporting-and-diagnostics.md`](./docs/FIELD-REPORT-2026-08-21-reporting-and-diagnostics.md) — **all three bugs fixed and released**: `reporting_get_data`'s unsatisfiable `start`/`end` and the ~3,600-raw-point response in **1.2.0**, the silently dropped `unit`/`page` in **1.2.1**. This line said "open, no fixes landed" for three months after they shipped. Two coverage gaps remain open and are tracked in `plans/ROADMAP.md`: no kernel-log/`dmesg` action, and no memory/swap/ARC summary — the ZFS-NAS-shaped hole.

Five defects hit live on 2026-09-13 (same box, still 26.0.0-BETA.1): [`docs/FIELD-REPORT-2026-09-13-live-defects.md`](./docs/FIELD-REPORT-2026-09-13-live-defects.md) — **four fixed, one upstream.** `snapshot_list` silently returned `[]` for populated datasets; `filesystem` could not read or write file content; `user_create` rejected TrueNAS's own default home; nothing reported the server's own version. `snapshot_task_run` is broken by a middleware bug fixed upstream in 27.0.0-BETA.1 and was not fixable here — **and that fix is now confirmed live**: the action works on 27.0.0-RC.1 as of 2026-10-27. The report states, per defect, whether the evidence is reproduced live, read from upstream source, or inferred.

**Production deployment (current).** This server federates through `sr-mcp-gateway` (which replaced the decommissioned `sr-agentgateway`) as a **container-strategy backend** running a pinned `ghcr.io/staticrevolution-com/sr-truenas-mcp` tag. **The live pin is deliberately not recorded here** — read it from the gateway's own `GET /api/v1/backends/truenas`. This line previously named a version and drifted twice (it claimed `:v1.1.1` while the backend was actually on `:v1.1.2`), which is the failure mode naming it at all invites. Version-numbering note: v1.1.1 sits above an orphaned `:v1.1.0` image — a pre-2026-05-01-history-rewrite artifact with no backing git tag that production was previously pinned to. The field-report fixes were first cut as v1.0.1, then renumbered to v1.1.1 to sort above it; v1.0.1 is withdrawn. Full backstory in CHANGELOG `[1.1.1]`. The orphaned `:v1.1.0` and `:v1.0.1` GHCR image tags were deleted 2026-06-13. ⚠ **The tag list is not recorded here**, for the same reason the live pin is not: the sentence that used to end this paragraph enumerated what was tagged *on 2026-06-13* and read as current for five months of releases. Read the tags from GHCR, and the releases from the [releases page](https://github.com/staticrevolution-com/sr-truenas-mcp/releases).

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
npm test               # vitest run
npm run type-check     # tsc --noEmit
npm run dev            # tsc --watch
npm run build:binary   # tsc + esbuild + pkg → dist/sr-truenas-mcp (Linux x64 binary)
npm run audit:counts   # print structural counts (filter, tiers, validation surface)
```

### Standalone Binary

`npm run build:binary` produces a self-contained Linux x64 ELF binary at `dist/sr-truenas-mcp` (~78MB). Embeds Node.js 26 runtime via esbuild bundling + @yao-pkg/pkg. Used as the stdio backend for an MCP gateway (the `sr-mcp-gateway` process-strategy backend) — see Deployment.

The bundle step (`scripts/build-bundle.mjs`) injects `__BUILD_VERSION__` (`<pkg.version>+<git-short-sha>[.dirty]`) via esbuild `--define`. The binary then exposes it through `--version`/`-v`, so the deployed artifact identifies itself without sha256-detective work. Direct `node dist/cli.js` (no bundle step) reports `dev`.

GitHub releases include pre-built `sr-truenas-mcp-linux-x64.tar.gz` with SHA256 checksums.

## Architecture

Single MCP tool (`truenas`) with hierarchical discovery: 278 active actions across 17 categories, exposed through 4 modes (list categories, list actions, describe actions in full via `detail: true`, execute).

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
| `src/index.ts` | MCP server setup, single `truenas` tool with 4 modes |
| `src/registry.ts` | Tool registry, categorization, centralized safety enforcement |
| `src/client.ts` | WebSocket JSON-RPC 2.0 client (DDP handshake, multiplexing, reconnect) |
| `src/safety.ts` | Tier classification map (pure data, every action -> tier) |
| `src/validation.ts` | Path validation (`/mnt/` prefix, no traversal) + dataset-name validation (`validateDatasetName`) |
| `src/filters.ts` | Response filtering (layered: 57 exact + 9 suffix + 15 allowlist) |
| `src/tools/*.ts` | 9 tool modules registering handlers |
| `src/tools/jobs.ts` | `job_get` / `job_list` — and `JOB_FIELD_ALLOWLIST`, the control that keeps a job's own arguments and session credentials out of the response |
| `src/tools/index.ts` | `buildRegistry()` wiring |
| `src/resources.ts` | 12 read-only MCP Resources (filtered) |

### Safety Tiers

| Tier | Gate | Count | Examples |
|------|------|-------|---------|
| 0 — Blocked | Never registered | 8 | `system_reboot`, `truenas_api_call`, `cronjob_create` |
| 1 — Confirm+Reason | `confirm: true` + `reason: "string"` | 20 | `pool_export`, `disk_wipe`, `dataset_delete`, `user_create`, `ssh_config_update` |
| 2 — Confirm | `confirm: true` | 95 | `service_stop`, `snapshot_delete`, `smb_share_create`, `iscsi_extent_create`, `replication_run` |
| 3 — Open | None | 163 | All reads, safe queries |

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

- **`validateTrueNASPath(path)`** — for filesystem paths. Must start with `/mnt/`, no `..`, no null bytes. 25 call sites across `filesystem.ts`, `sharing.ts` (smb/nfs share `path`, iscsi extent file `path`), `replication.ts` (cloudsync/cloud_backup/rsync `path`), `network.ts` (user `home`), and `storage.ts` (`dataset_set_permissions` mountpoint).
- **`validateDatasetName(name)`** — for ZFS dataset names (e.g. `tank/data`). Charset `[a-zA-Z0-9._:/-]`, max 255 chars, no `..`, no null bytes. 7 call sites: `dataset_create`, `snapshot_list` and `dataset_delete` (`storage.ts`), `replication_create` (`source_datasets[]` + `target_dataset`), and `replication_restore` (`target_dataset`). `dataset_create` additionally routes `/mnt/`-prefixed input through `validateTrueNASPath` for defense in depth.

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

Unlike the old agentgateway (which baked backends into a combined image at build time), `sr-mcp-gateway` treats backends as **runtime data**: a backend is registered through the gateway's admin API/GUI and supervised as a long-lived **process** or **container** child, with its env (`TRUENAS_URL`, `TRUENAS_API_KEY`, `TRUENAS_VERIFY_SSL`) stored encrypted-at-rest in the gateway. This repo ships both artifacts a backend needs — the standalone Linux binary (process strategy) and the GHCR Docker image (container strategy); pick whichever the gateway backend is configured for. The exact registration (strategy, command/image, env) lives in `sr-mcp-gateway`'s own config and docs, not here. ⚠ Those were linked as `../sr-mcp-gateway/docs/*.md`, which resolves only in a local sibling checkout and 404s for every reader of this public repo; the gateway repository is private, so there is no public URL to point at.

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

- **`listActions` caps every parameter description at 100 characters.** A description cut by the cap ends `[+]`, and the listing says once that `detail: true` returns the full text. Parameter descriptions registry-wide are over the cap, several of them safety caveats — the gate in `src/__tests__/detail-mode-untruncated.test.ts` asserts the population is non-empty rather than pinning a count no one would re-derive — so **do not act on a `[+]` description without re-reading it in detail mode**. The cap is deliberate (it is what keeps discovery cheap) and `detail: true` is the uncapped channel beside it, covering every action with no per-action opt-in. ⚠ Action descriptions are **not** capped; that is why the `dataset_delete` warning below lives in the action description rather than in `recursive`'s. ⚠ `detail: true` combined with `params`, `confirm` or `reason` is **refused** — it never dispatches, and it never returns a description as though the action had run. The check precedes the tier gates, so its error is about `detail`, not about a missing confirmation.
- **A job id returned by an asynchronous action is queryable with `job_get`.** 24 actions start a middlewared `@job` and deliberately do not await it (`describeAsyncJob` in `src/job-utils.ts`), because awaiting a replication run or a scrub would block the call for minutes to hours. Until `job_get` / `job_list` existed, **no registered action accepted a job id back**, so those 24 ids were receipts for work whose outcome was unreachable. ⚠ `pool.dataset.delete` is `"job": false`, so polling for it waits on a record that never exists — a job id is not evidence that a method is a job.
- **`job_get` / `job_list` return job metadata only, by allowlist.** Measured on 27.0: a `core.get_jobs` record carries `arguments` (the call arguments verbatim — a `user.create` job's password), `credentials` (the authenticating credential record for the session that started it, the same exposure class as the plaintext-API-key audit log), `exc_info` / `exception` (tracebacks that can embed those arguments), and `logs_excerpt` / `logs_path`. None of these is returned. ⚠ It is an **allowlist**, so a field a later TrueNAS release adds is excluded by default — do not convert it to a denylist, and do not widen it on the strength of a sample of jobs that happened to carry nothing sensitive.
- **SMART test initiation is not available via the WebSocket API**, and `disk_smart_test_run` is nonetheless registered: it starts nothing and returns an explanation naming the web UI. Its description says so, so discovery does not promise a test run. Results are available through `disk_smart_test_list` and `disk.query`.
- **`dataset_delete`'s `recursive` flag does not mean "delete child datasets" on a nested dataset.** Measured on 26.0-BETA.1: it destroys every snapshot of the target, unmounts the filesystem, **leaves the dataset and all of its bytes**, and returns `true`. The documented "destroy children, leave the root intact" semantics are for a **pool root**. The action now refuses `recursive: true` on a nested dataset that has snapshots, reports the count, and requires `acknowledge_snapshot_destruction: true`. ⚠ The middleware's own non-recursive `[ENOTEMPTY]` error recommends `recursive=True` **by name** — so an operator who meets the honest failure is handed consent for the damaging path. Neither our refusal text nor this file repeats that recommendation.
- `dataset_set_permissions` uses `filesystem.setperm` since `pool.dataset.permission` doesn't exist in WebSocket API.
- `config.save` requires a binary pipe — handler returns informational message directing to TrueNAS web UI.
- **There is no way to delete a file.** Not a gap in this server — the middleware has no unlink-equivalent at all. Verified by enumerating every method `core.get_methods` reports on TrueNAS 26.0.0-BETA.1 (781 of them): nothing removes a single file. `dataset_delete` destroys a whole dataset, and the web shell is the only other route. Don't go looking for the method; it isn't there.
- File content transfer (`filesystem_get` / `filesystem_put`) does not travel over the WebSocket. Both underlying methods are pipe-based `@job`s, so the server also speaks HTTPS to `/_upload` and `/_download` on the same host and port — see `src/file-transfer.ts`. A deployment that reaches the WebSocket but not port 444 over HTTPS will find these two actions failing while everything else works.
- Single transfers are capped at 16 MiB in either direction, with `filesystem_get` defaulting to 1 MiB. The limit is the context window, not the NAS.
- **`dataset_get` / `dataset_list` do not see internal datasets.** Upstream `pool.dataset.query` omits `<pool>/ix-apps` and its children — including the apps/Docker root — while listing `.ix-virt`, so it is not a dot-prefix rule. Use `dataset_zfs_query` to reach such a subtree — explicitly, by name. ⚠ **`dataset_get` deliberately does NOT fall back to the ZFS namespace, and its ENOENT means ABSENT.** That is a cross-repo contract: `sr-charm`'s dataset-conversion plan uses `dataset_get` ENOENT as one of three independent absence proofs when verifying `pool.dataset.delete`. Softening it would make charm report a destroyed dataset as still present.
- **`filesystem_disk_usage` is bounded, not exhaustive.** A subtree exceeding its entry/time budget returns `recursive_allocation: null` with an entry count rather than a partial sum. Authoritative dataset totals come from `dataset_zfs_query`, not from summing a walk.
- `filesystem_put` **creates missing parent directories** — `filesystem.put` calls `os.makedirs()` upstream, so a typo in a path silently produces a new directory tree rather than an error. Combined with the absence of any file-delete method (above), a mistyped path is not cleanly undoable: the unit of cleanup is the dataset.
- `filesystem_put`'s post-write `stat` confirms that something landed at the path. It does **not** detect a write beneath an **unmounted** dataset — the bytes go to the underlying filesystem at the same path, `stat` succeeds, and the file vanishes when the dataset mounts. Catching that needs a `mount_id` comparison against the dataset; not implemented.
- `snapshot_task_run` **works on TrueNAS 27.0** — verified against 27.0.0-RC.1 on 2026-10-27 (a periodic snapshot task was run on demand and produced its snapshot; the call returns `null` on success, which is normal for this middleware method). It **cannot** work on 26.0, where an upstream middleware bug makes every call fail; there the action returns a diagnosis rather than a bare `[EINVAL]`. See the 2026-09-13 field report.
- Dependency advisories are **checked by CI, not asserted here** — `.github/workflows/ci.yml` runs `npm audit --omit=dev --audit-level=high` as a blocking job and reports the full tree as an advisory summary. A count in this file would be a recorded fact with nothing checking it; the job is the check. (This line previously claimed "0 vulnerabilities" and was, by 2026-09-25, wrong by 16 including 2 critical — see CHANGELOG 1.3.1.)


---

## Portainer stack safety

Docker stack lifecycle goes through Portainer's stack endpoints, never `dockerProxy`.
This is an operator convention for the environment this server is deployed into, not a
constraint of this codebase.
