# sr-truenas-mcp — Bulletproofing Plan (v1.0.1 → v1.1.0)

> **This is the active plan.** Historical record of the original v1.0.0 hardening journey is preserved at [`PLAN-v1.0.0.md`](./PLAN-v1.0.0.md).

## Implementation Status

Phase A targets v1.0.1 (security + correctness + governance). Phase B targets v1.1.0 (reliability + spec alignment). Phase C is deferred / decision-pending.

| ID | Item | Status | Notes |
|---|---|---|---|
| A1 | Hybrid response filter (exact + suffix + allowlist) | ✅ done | `src/filters.ts` — 57 exact + 9 suffix + 15 allowlist |
| A2 | Path validation gaps + `validateDatasetName` | ✅ done | dataset_create + replication_create. (Audit was stale on smb/nfs — those already validated.) |
| A3 | Schema tightening (high-risk methods) | ✅ done | pool/dataset/replication/vm/network/sharing/system tightened; system_general_update unknown-key allowlist enforced at handler |
| A4a/b | WebSocket settle-once + send-error fix | ✅ done | `src/client.ts` — `settled` flag + `settlePending()` helper + `WebSocketSendError` + sync-throw try/catch |
| A4c | Reconnect cleanup preserves idempotent callers | ✅ done | `client.call()` honours idempotency: query/get_instance/config/core.get_jobs auto-retry; everything else throws `ReconnectAborted`. Replay-queue state machine deferred — overkill for stateless-gateway mode. |
| A4d | Job polling: backoff + ws-state aware | ✅ done | `waitForJob` rewrite — exponential backoff (1s ×1.5, cap 15s), skips polls while ws disconnected. Pure `nextPollDelay` exported for tests. |
| A5 | Test/doc accuracy + `audit:counts` script | ✅ done | Integration tool-count is now `registry.size + BLOCKED.size == ACTION_TIERS.size`; added `npm run audit:counts` (`scripts/audit-counts.mjs`) printing filter/tier/validation counts; CLAUDE.md test count + path-validation site counts refreshed against actuals (23 path + 3 dataset call sites, 167 tests). |
| A6 | Resources fan-out: `Promise.allSettled` | ✅ done | `gatherLabelled()` helper in `src/resources.ts`; shares resource now tolerates per-source failures (rejected sources → `null` + `_errors` entry). 5 new tests. |
| A7 | Memory cleanup (stale `disk_temperatures` entry) | ✅ done | Verified obsolete in deployed binary |
| A9 | `--version` flag with embedded build SHA | ✅ done | `src/version.ts` + `src/cli.ts` `--version`/`-v` and `--help`/`-h`. `scripts/build-bundle.mjs` injects `__BUILD_VERSION__` (`<pkg.version>+<git-short-sha>[.dirty]`) via esbuild `--define`. Unbundled fallback is `"dev"`. |
| A8 | Cut v1.0.1, deploy, drop /tmp shortcut | ✅ done | v1.0.1 tagged, GitHub release published (binary SHA `9114b23b…`). Deployed via /tmp → init → /bin-vol; /tmp wiped; subsequent restart fell through to /bin-vol cache cleanly. **Finding: GitHub-release fallback in agentgateway init is non-functional** — repo is private, init's anonymous `wget` 404s. Cache path covers normal flow, but disaster recovery (both /tmp + cache empty) needs B8. |
| B1 | `destructiveHint` annotation | ✅ done | `TRUENAS_TOOL_ANNOTATIONS` exported from `src/index.ts` (`destructiveHint: true`, `readOnlyHint: false`, `openWorldHint: true`, `title`); passed as `annotations` arg to `server.tool()`. `listActions()` tier tags now read `[destructive: requires confirm + reason]` / `[destructive: requires confirm]` so the per-action destructive marker is explicit alongside the tool-level hint. 5 new annotation tests. |
| B2 | UUID request IDs + opt-in keepalive | ⬜ pending | Phase B |
| B3 | Structured stderr logging (opt-in) | ✅ done | `src/logger.ts` — JSON-line logger gated by `TRUENAS_LOG_LEVEL` (default `error`). Wired into `TrueNASClient` (rpc start/end timings, ws connect/close/auth/error events). Never logs params or response bodies. Threaded through `cli.ts` → `startStdio` → `TrueNASClient`. 11 tests covering levels, env-driven threshold, JSON format, circular-structure failsafe, isEnabled. |
| B4 | CI: SBOM + Sigstore artifact attestation | ⬜ pending | Phase B |
| B5 | Pre-flight health check (optional) | ✅ done | `src/preflight.ts` exposes a tested `preflight(client, timeoutMs)` and `formatPreflightFailure()`. `src/cli.ts` runs it before `startStdio` (gated by `TRUENAS_SKIP_PREFLIGHT=1`). Hard race-timeout prevents hung connect() from stalling startup. 8 tests covering success, connect/auth/call failures, timeout, non-Error rejections; 3 more for the failure-message formatter. |
| B6 | `npm audit` cleanup pass | ✅ done | `npm audit fix` resolved all 3 moderate transitive vulns (`hono`, `@hono/node-server`, `postcss`) within existing semver constraints — lockfile-only change, no `package.json` movement. Now reports 0 vulns. |
| B7 | Filter doc-sync drift gate | ✅ done | `src/__tests__/doc-sync.test.ts` — 11 tests asserting CLAUDE.md numerical claims (filter exact/suffix/allowlist, per-tier action counts, registered-tool count, in-handler `!confirm` count, validate{Path,DatasetName} call sites) match what's in source. Verified: drift detection works (flip a count → red). Counting logic mirrors `scripts/audit-counts.mjs`. |
| B8 | Bake sr-truenas-mcp into the combined agentgateway image | ✅ done | Merged in [staticrevolution-com/sr-agentgateway#3](https://github.com/staticrevolution-com/sr-agentgateway/pull/3). New combined image SHA `daed0d0b5e15f…`; deployed agentgateway running with `/opt/sr-truenas-mcp/dist/cli.js` baked in via ghcr build stage. End-to-end MCP truenas call verified. One residual: stopped orphan `sr-agentgateway-truenas-init` container (`redeployStackGit prune:true` 500'd, same Portainer behavior as A8); cosmetic, will clean up naturally with B8b. |
| B8b | Bake portainer-mcp into the combined agentgateway image | ⬜ pending | Mirror B8 for portainer-mcp; final state drops the `/mnt/data-pool/apps/agentgateway/bin` shared volume entirely. Same Dockerfile pattern, separate PAT (or — if portainer-mcp-enhanced is a public release — no PAT). Track separately so B8 can land first and soak. |
| B8c | Inject `BUILD_VERSION` in image-mode entrypoint | ⬜ pending | sr-truenas-mcp's own Dockerfile uses plain `tsc` (no esbuild bundle), so `dist/cli.js --version` reports `"dev"` instead of `1.0.1+<sha>`. A9's stamp injection only happens in the bundled-binary path. Fix: have the image's build stage also run `scripts/build-bundle.mjs` and `ENTRYPOINT ["node", "dist/bundle.cjs"]`, OR thread the version stamp through `tsc` somehow. Trivial sr-truenas-mcp Dockerfile change. Surfaced during B8 verification. |

Update this table as items land. ⬜ = pending, ▶ = in progress, ✅ = done, ⏭ = skipped, 🚧 = blocked.

## Context

`sr-truenas-mcp` has been running successfully in production as a stdio child of AgentGateway on TrueNAS endpoint 11. Operational health is **green** (zero panics, zero session-staleness, zero WebSocket connection errors over the last 24h log window). The work in this plan is *polish*, not rescue.

Three Phase-1 audits surfaced concrete issues across three categories:

1. **Source-code findings** — race conditions in the WebSocket pending-promise map, schema validation gaps on high-risk methods (`pool.create`, `system.general.update`, `replication.create`), missing path validation on three handlers, response-filter coverage gaps (~12 missing field names), and a few brittle test/doc assertions.
2. **Operational governance** — the deployed binary on TrueNAS is `fa0ce982…` (built post-v1.0.0 from master), but **no GitHub release tag exists for what's actually running**. The agentgateway init container's GitHub-release fallback still pins `v1.0.0`, so a `/tmp` clear (TrueNAS reboot, tmpfs eviction) silently regresses production.
3. **Spec/ecosystem alignment (April 2026)** — the MCP `destructiveHint` annotation has become the protocol-level standard for marking destructive tools (we don't emit it yet); an official `truenas/truenas-mcp` (Go research preview) now exists with patterns worth knowing about; Zod v4 + MCP SDK 2.0-alpha are live but not yet stable.

Strategic choices confirmed at plan time:

- **Sequence**: v1.0.1 fast (security + correctness), then v1.1.0 (reliability + spec alignment).
- **Filter strategy**: hybrid exact-match + suffix regex with allowlist.
- **WebSocket lifecycle**: keep per-request, harden the path. (Reconsider only if we leave `statefulMode: stateless`.)
- **Spec alignment**: add `destructiveHint` now, defer SDK 2.0 until stable.

The intended outcome is a tagged, signed, reproducible v1.0.1 release with no known security gaps, then a v1.1.0 that adds protocol-level confirmations, hardened client semantics, and proper release governance — closing the production-drift loop.

## Findings summary (verified)

| # | Category | Where | Severity |
|---|---|---|---|
| 1 | WebSocket client: late-response-after-timeout race | `src/client.ts:234-237` | Critical |
| 2 | WebSocket client: send-error orphans pending entry | `src/client.ts:242-248` | Critical |
| 3 | WebSocket client: cleanup() during reconnect fails callers prematurely | `src/client.ts:88-89` | High |
| 4 | Job polling: no backoff, ignores ws state | `src/client.ts:256-281` | Medium |
| 5 | Filter: 12+ missing sensitive field names | `src/filters.ts:6-47` | High |
| 6 | Filter: exact-match only, misses flat names like `certificate_private_key` | `src/filters.ts:64-66` | High |
| 7 | Path validation: `pool.dataset.create`, `sharing.smb.create`, `sharing.nfs.create` | `src/tools/storage.ts`, `src/tools/sharing.ts` | High |
| 8 | Schema: `system.general.update` accepts `Record<string, unknown>` | `src/tools/system.ts` | High |
| 9 | Schema: `pool.create`, `pool.dataset.create`, `replication.create` enum gaps | `src/tools/storage.ts`, `src/tools/replication.ts` | High |
| 10 | Schema: `vm.create`, `interface.create`, `disk.wipe` enum/regex gaps | `src/tools/vm.ts`, `src/tools/network.ts` | Medium |
| 11 | Test: integration test hardcodes `expect 270` | `src/__tests__/integration.test.ts:26` | Low |
| 12 | Doc: PLAN.md method counts wrong (actual 859→921→924) | `PLAN-v1.0.0.md` | Low |
| 13 | Doc: CLAUDE.md claims "36 patterns" — actual is 30 | `CLAUDE.md` | Low |
| 14 | Doc: claims "22 path-validating handlers" unverified | `CLAUDE.md` | Low |
| 15 | Resources: `Promise.all` instead of `Promise.allSettled` in shares fan-out | `src/resources.ts` | Low |
| 16 | Memory: stale `disk_temperatures` known-bug entry | `memory/project_known_bugs.md` | resolved |
| 17 | Governance: deployed binary is unreleased | TrueNAS host `/tmp/sr-truenas-mcp` | High |
| 18 | Governance: agentgateway compose pins fallback `v1.0.0` | `sr-agentgateway/docker-compose.yaml` | High |
| 19 | Spec: `destructiveHint` annotation absent on tier-1/2 tools | `src/index.ts`, `src/registry.ts` | Medium |

Findings 1–13, 15, 19 land in code. 14 is a doc audit. 16 is cleared. 17–18 are deployment governance.

---

## Phase A — v1.0.1 (security, correctness, governance)

**Goal**: Close every High/Critical finding in source, ship a tagged release, and end the unreleased-binary-in-prod situation. **One week target.** No architectural change.

### A1 — Response filter: hybrid matcher

**File**: `src/filters.ts`

Replace the exact-match-only `SENSITIVE_KEYS` Set with a layered matcher:

1. **Tier 1 — exact key set** (case-insensitive). Keep the existing 30 + add the missing ones identified by research:
   ```
   auth_token, reconnect_token, otp_token, peersecret, passkey,
   stored_key, application_credential_secret, access_key_id,
   host_key, client_key, server_key, oauth_client_secret,
   bind_password (if not already covered), client_secret, mfa_secret,
   recovery_code, recovery_codes, salt, iv, nonce, signature
   ```
   Net: ~50 exact keys. Keep `key` (the bare name) only if doc audit confirms it's never a benign identifier; otherwise remove it (the bare `key` exact match already exists and is too coarse).

2. **Tier 2 — suffix regex set** (case-insensitive, anchored at end of key, with leading underscore to avoid `_key` over-match):
   ```ts
   const SUFFIX_PATTERNS = [
     /_password$/i,
     /_passwd$/i,
     /_passphrase$/i,
     /_token$/i,
     /_secret$/i,
     /_seed$/i,
     /_private_key$/i,    // catches certificate_private_key, ssh_private_key
     /_credentials$/i,
     /_pin$/i,
     /^pass$/i,            // bare 'pass'
   ];
   ```
   Deliberately **NOT** including `_key$` as a generic rule — too high false-positive risk on `id_key`, `pool_key`, `vdev_key`, etc.

3. **Tier 3 — allowlist** (never redact, even if matched above):
   ```ts
   const NEVER_REDACT = new Set([
     "id_key", "pool_key", "vdev_key", "device_key",
     "password_disabled", "password_history",
     "min_password_length", "max_password_age",
     "last_password_change", "ssh_password_enabled",
     "public_key", "sshpubkey", "authorized_keys",  // public material
   ]);
   ```
   Public-key material is access-control-relevant but not secret; keeping it visible avoids breaking legitimate `user.query` / `sshkey` reads. Document the rationale in a comment.

4. **Order**: NEVER_REDACT > exact > suffix.

**Tests** (extend `src/__tests__/filters.test.ts`):
- Each new exact key redacts.
- `certificate_private_key`, `ssh_private_key`, `oauth_token`, `recovery_codes` redact via suffix.
- `id_key`, `pool_key`, `password_history`, `public_key` pass through unredacted.
- Nested objects: redaction applies recursively (existing assertion).
- Arrays of objects: redaction applies element-wise.
- Real fixture: load a sample `user.query` response from `docs/truenas-v27.0.0-docs/` and assert no `*_password|*_token|*_secret|*_passphrase` field remains visible after filtering.

### A2 — Path validation gaps

**Files**: `src/tools/storage.ts`, `src/tools/sharing.ts`, `src/tools/replication.ts`

Add `validateTrueNASPath(path)` calls to:

- `dataset_create` — validate `name` if it appears to be a path (starts with `/mnt/`); for relative dataset names, validate they don't contain `..` or null bytes.
- `smb_share_create`, `smb_share_update` — validate `path`.
- `nfs_share_create`, `nfs_share_update` — validate `path`.
- `replication_create` — validate `source_datasets[]` and `target_dataset` for `..`/null bytes (these are dataset names, not filesystem paths, so add a lighter validator: `validateDatasetName`).

**New**: `src/validation.ts` gains `validateDatasetName(name: string): string` — alphanumerics, `_`, `-`, `:`, `.`, `/`; no `..`; max length 255.

**Tests**: extend `src/__tests__/validation.test.ts` for the new helper, plus per-handler tests asserting validation runs before client.call().

### A3 — Schema tightening for high-risk methods

**Files**: `src/tools/storage.ts`, `src/tools/system.ts`, `src/tools/replication.ts`, `src/tools/vm.ts`, `src/tools/network.ts`

Apply the enums and constraints below. The exact field names and values are pulled from `docs/truenas-v27.0.0-docs/`.

| Method | Field | New constraint |
|---|---|---|
| `pool.create` | `name` | `z.string().min(1).max(255).regex(/^[a-zA-Z][a-zA-Z0-9._-]*$/)` |
| `pool.create` | `topology.*.type` | `z.enum(["STRIPE","MIRROR","RAIDZ1","RAIDZ2","RAIDZ3","DRAID1","DRAID2","DRAID3"])` |
| `pool.create` | `encryption_options.algorithm` | `z.enum(["AES-128-CCM","AES-192-CCM","AES-256-CCM","AES-128-GCM","AES-192-GCM","AES-256-GCM"])` |
| `pool.create` | `encryption_options.passphrase` | `z.string().min(8).optional()` |
| `pool.dataset.create` | `type` | `z.enum(["FILESYSTEM","VOLUME"])` |
| `pool.dataset.create` | `name` | `z.string().min(1).max(255).regex(/^[a-zA-Z0-9._:-][a-zA-Z0-9._:/-]*$/)`; reject `..` |
| `pool.dataset.update` | `acltype` | `z.enum(["POSIX1E","NFS4"]).optional()` |
| `replication.create` | `direction` | `z.enum(["PUSH","PULL"])` *(verify present)* |
| `replication.create` | `transport` | `z.enum(["SSH","SSH+NETCAT","LOCAL","LEGACY"])` |
| `replication.create` | `lifetime_unit` | `z.enum(["HOUR","DAY","WEEK","MONTH","YEAR"]).optional()` |
| `replication.create` | `name` | `z.string().min(1).max(150)` |
| `cloudsync.create` | `transfer_mode` | confirmed enum present |
| `sharing.smb.create` | `purpose` | `z.enum(["NO_PRESET","DEFAULT_SHARE","ENHANCED_TIMEMACHINE","PRIVATE_DATASETS","TIMEMACHINE","MULTI_PROTOCOL","WORM_DROPBOX","READ_ONLY","TIME_LOCKED","BACKUP_TARGET","PRESET","LEGACY_SHARE"])` *(verify list against doc)* |
| `sharing.smb.create` | `name` | `z.string().min(1).max(80).regex(/^[a-zA-Z0-9._-]+$/)` |
| `vm.create` | `bootloader` | `z.enum(["UEFI","UEFI_CSM","BIOS"])` |
| `vm.create` | `vcpus` | `z.number().int().min(1).max(64)` |
| `vm.create` | `memory` | `z.number().int().min(256_000_000)` |
| `vm.device.create` | `dtype` | `z.enum(["NIC","DISK","RAW","CDROM","PCI","DISPLAY","USB"])` |
| `interface.create` | `type` | `z.enum(["PHYSICAL","BRIDGE","VLAN","LAG","FAILOVER"])` |
| `interface.create` | `name` | `z.string().regex(/^[a-z0-9]+([-._][a-z0-9]+)*$/)` |
| `disk.wipe` | `mode` | `z.enum(["QUICK","FULL","SECURE"])` |
| `system.general.update` | (whole body) | Replace `z.record(z.string(), z.unknown())` with strict object schema covering only documented fields: `language, kbdmap, timezone, ui_address, ui_v6address, ui_port, ui_httpsport, ui_httpsprotocols, ui_httpsredirect, ui_consolemsg, ui_x_frame_options, crash_reporting, usage_collection, ds_auth, ui_certificate, birthday`. Use `.strict()` to reject unknown keys. *(Verify exact field list against `system.general.update` doc page.)* |

**Tests** (extend `src/__tests__/handlers.test.ts`):
- For each tightened schema, add 2 cases: valid input passes, an invalid value (wrong enum, too-short string, wrong type) is rejected before `client.call()` is invoked.
- One end-to-end through registry pipeline: `system_general_update` with an unknown field is rejected at registry validation, not at API.

### A4 — WebSocket client races (the three Critical/High items)

**File**: `src/client.ts`

#### A4a — Late-response settlement guard

Add `settled: boolean` to `PendingRequest`. Both timeout path and message path check + flip the flag atomically before calling resolve/reject. Eliminates the unhandled-rejection on race between timer fire and message arrival.

```ts
interface PendingRequest {
  id: string;
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
  settled: boolean;
}

// In timeout handler and message handler:
if (req.settled) return;
req.settled = true;
clearTimeout(req.timer);
this.pending.delete(req.id);
req.resolve(...) /* or reject */;
```

#### A4b — Send-error orphan fix

Move `this.pending.set(id, req)` to *before* `ws.send(...)`. In the send error callback (or `try/catch` if synchronous), settle the pending entry with a typed `WebSocketSendError` so callers see the error promptly:

```ts
this.pending.set(id, req);
try {
  this.ws.send(JSON.stringify(payload), (err) => {
    if (err) this.settlePending(id, "reject", new WebSocketSendError(err.message));
  });
} catch (e) {
  this.settlePending(id, "reject", new WebSocketSendError(String(e)));
}
```

`settlePending(id, mode, payload)` becomes the single state-transition function; both happy-path message handler and timer/error paths go through it.

#### A4c — Reconnect cleanup preserves callers

In `doConnect()`, change `cleanup()` to `cleanupTransientWithoutFailing()` when called from a reconnect path. Move pending callers into a `reconnecting` queue; if reconnect succeeds, *retry idempotent* requests (read-only methods only) and reject the rest with a typed `ReconnectAborted` error. If reconnect fails (max attempts), drain the queue with reject.

Idempotency policy: the registry is the only place that knows which methods are safe to retry. Pass an idempotency hint from registry → client → pending request, defaulting to `false` for any method whose name doesn't match `*.query|*.get_instance|*.config|core.get_jobs`.

#### A4d — Job polling: backoff + ws-state awareness

Replace fixed 2s poll with exponential backoff capped at 15s, skip polls when ws is disconnected (wait for reconnect), and respect overall job timeout. New helper `pollJob(jobId, totalTimeoutMs)`:

```ts
let delay = 1000;
while (now - start < totalTimeoutMs) {
  if (this.state !== "connected") { await this.waitForConnect(5_000); continue; }
  const jobs = await this.call("core.get_jobs", [[["id","=",jobId]]]);
  if (jobs[0]?.state === "SUCCESS" || jobs[0]?.state === "FAILED") return jobs[0];
  await sleep(delay);
  delay = Math.min(delay * 1.5, 15_000);
}
```

**Tests** (`src/__tests__/client.test.ts`):
- Race fixture: simulate timer fire + message arrival on same id → no unhandled rejection.
- Send-error fixture: synchronous throw in `ws.send` → caller's promise rejects with `WebSocketSendError`.
- Reconnect fixture: read-only call survives one disconnect; write-call rejects with `ReconnectAborted`.
- Job-poll fixture: state-machine driven, asserts increasing intervals + skip on disconnect.

### A5 — Test/doc accuracy

- `src/__tests__/integration.test.ts` — replace hardcoded `expect 270` with `expect(registry.tools.size + BLOCKED_ACTIONS.size).toBe(Object.keys(ACTION_TIERS).length)`. Becomes self-maintaining.
- `CLAUDE.md` — recount filter patterns (now ~50), recount tool count, recount path-validating handlers (script: grep `validateTrueNASPath\|validateDatasetName` under `src/tools/`).
- Add `npm run audit:counts` script that programmatically prints the counts CLAUDE.md claims, for future drift detection.

### A6 — Resources fan-out: Promise.allSettled

**File**: `src/resources.ts`

Switch the `shares` resource and any other `Promise.all` aggregator to `Promise.allSettled`. On per-share failure, return the partial result + a `_errors: []` field listing which calls failed and why. Keeps a single failed query from blackholing the whole resource read.

### A7 — Memory cleanup ✅ done

Stale `disk_temperatures` known-bug memory cleared (verified: deployed binary already contains the fix from commit 723980e).

### A8 — Release governance: cut and re-deploy v1.0.1

Order matters. Land all of A1–A7, A9 on master first, then:

1. **Tag** `v1.0.1` from master.
2. **CI**: confirm release workflow produces `sr-truenas-mcp-linux-x64.tar.gz` with SHA256.
3. **Deploy**:
   - Rebuild on workstation: `npm run build:binary`.
   - SCP new binary to TrueNAS `/tmp/sr-truenas-mcp` (via the existing manual path, since this is the immediate-replace channel).
   - Trigger AgentGateway redeploy (Portainer webhook on stack 1183) so the init container picks up the new `/tmp` binary.
4. **Bump fallback pin**: in `staticrevolution-com/sr-agentgateway/docker-compose.yaml`, change `TRUENAS_MCP_VERSION:-v1.0.0` → `:-v1.0.1`. Commit + push (GitOps redeploys).
5. **Now wipe `/tmp` shortcut**: SSH to TrueNAS *only* with explicit user authorization, `rm /tmp/sr-truenas-mcp`. Trigger a redeploy. The init container should now pull from GitHub release v1.0.1 and run that binary. Verify SHA256 against the release asset.

After step 5, the `/tmp` shortcut is no longer load-bearing. Future updates flow exclusively through tag → release → init-container pull.

### A9 — `--version` flag

**Files**: `src/cli.ts`, build pipeline (`scripts/build-binary.ts` or equivalent)

Inject the git short SHA + tag at build time via esbuild `define`:

```ts
// build script
define: {
  __BUILD_VERSION__: JSON.stringify(`${pkg.version}+${gitShortSha}`),
}

// cli.ts
if (process.argv.includes("--version")) {
  console.log(__BUILD_VERSION__);
  process.exit(0);
}
```

This eliminates the sha256-detective-work currently needed to identify what's deployed.

---

## Phase B — v1.1.0 (reliability & spec alignment)

**Goal**: Add protocol-level destructive annotations, ship release-engineering hardening (SBOM, attestations, signed builds), and add observability. **2-3 weeks after v1.0.1 ships.**

### B1 — `destructiveHint` annotation

**Files**: `src/index.ts`, `src/registry.ts`, possibly `src/tools/*.ts` (to emit per-action annotations)

The single `truenas` tool registers as one MCP tool. Annotations apply at the tool level — but our destructive surface is per-*action*, not per-tool. Two options:

1. **Annotate the truenas tool with `destructiveHint: true`** unconditionally. Simple; clients gain a coarse "this tool can do destructive things" marker. Existing per-action two-call confirm flow remains.
2. **Surface action-level metadata** through tool description and through a new `truenas({ mode: "describe", action: "..." })` response that includes `destructive: true` when the action is tier-1/2. Clients with hints integration can read this.

Adopt **both**: the tool gets `destructiveHint: true`, and `listActions()` output includes the existing tier annotation plus a structured `destructive` boolean. Update `src/registry.ts` to format that into the action listing. Existing two-call confirm flow stays — annotation is *additive*.

**Tests**: assert tool registration emits the annotation; assert `listActions()` includes per-tier markers.

### B2 — UUID request IDs + active keepalive

**File**: `src/client.ts`

- Replace incrementing-integer ids with `crypto.randomUUID()`. Easier to debug in logs, eliminates accidental id collisions across reconnects.
- Add optional periodic ping when idle (`system.info` call every 30s if no traffic). Configurable via `TRUENAS_KEEPALIVE_INTERVAL_MS` env var, default `0` (disabled — stateless gateway mode doesn't keep us alive long enough to matter; useful only for future persistent-mode deploy). Keeps the option without paying its cost.

### B3 — Structured stderr logging (opt-in)

Add minimal structured logger writing to **stderr only** (stdout is reserved for MCP JSON-RPC). Format: `{"ts":"...","level":"info","reqId":"...","method":"...","durMs":12}`. Gated by `TRUENAS_LOG_LEVEL` env var, default `error`.

Log: every `client.call()` start/end with duration and result code; reconnect attempts; auth failures; pending-map state on cleanup. **Never log params** (would leak secrets) or response bodies.

### B4 — CI: SBOM + artifact attestation

**File**: `.github/workflows/release.yml`

After binary build:
1. `anchore/sbom-action@v0` → SPDX SBOM.
2. `actions/attest-build-provenance@v1` and `actions/attest-sbom@v1` → Sigstore-signed attestations.
3. Release upload includes binary, `.sha256`, `.sbom.spdx.json`, attestation bundle.

The agentgateway init container can verify with `gh attestation verify <binary>` if we wire that in (Phase C work, not blocker).

### B5 — Pre-flight health check (optional)

In `src/cli.ts`, before announcing MCP capabilities, attempt one `client.connect() + client.call("system.info")` round-trip with 5s timeout. On failure, emit a structured stderr error explaining what env vars/connectivity are wrong. On success, proceed silently. Helps diagnose misconfigurations at agent-spawn time instead of first-call time.

Disable via `TRUENAS_SKIP_PREFLIGHT=1` for environments where TrueNAS may legitimately be unreachable at MCP startup.

### B6 — `npm audit` cleanup

The current "transitive hono vulnerabilities (not exploitable in stdio)" footnote in CLAUDE.md is fine, but worth one cycle of attempting to upgrade away from them. If the dep tree can be pruned (e.g., by switching `@modelcontextprotocol/sdk` minor version, or replacing a small dependency that pulls hono), do so; if not, leave the note.

### B7 — Filter doc-sync drift gate

Add `src/__tests__/filter-doc-sync.test.ts` that:
- Reads `CLAUDE.md`, extracts the claimed pattern count.
- Counts actual exact keys + suffix patterns in `src/filters.ts`.
- Asserts they match.

Same idea for "X path-validating handlers" claim — count `validateTrueNASPath`/`validateDatasetName` call sites and assert match. Drift becomes a CI failure.

### B8 — Bake sr-truenas-mcp into the combined agentgateway image

**Repo affected**: `staticrevolution-com/sr-agentgateway` (this is *not* a `sr-truenas-mcp` source change). Captured here because the gap was surfaced during A8 verification of this project's release flow.

> **Implementation pivot (post-spec):** the PR landing this work consumes the existing `ghcr.io/staticrevolution-com/sr-truenas-mcp:v1.0.1` package as a Docker build stage (mirroring `cr.agentgateway.dev/agentgateway:v1.1.0 AS agentgateway-src`), authenticated by the auto-injected `GITHUB_TOKEN` via the existing `docker/login-action` step. No PAT, no rotation. Pre-merge requirement reduces to a single one-time UI action: granting `sr-agentgateway` Read access in the package's "Manage Actions access" settings. The PAT-based design described below is preserved as historical context — read it for the analysis-of-options narrative; the actual implementation lives in [staticrevolution-com/sr-agentgateway#3](https://github.com/staticrevolution-com/sr-agentgateway/pull/3).

#### Why option 3 over the alternatives

| | Pros | Cons |
|---|---|---|
| 1. PAT in stack env, authenticated `wget` | Smallest delta. Sidecar architecture preserved. | Still a runtime download — image is fine but the gateway can't start if GitHub is unreachable. Adds a credential to manage and rotate. |
| 2. Mirror the binary on internal HTTP | No new credential. | Adds infra (a host serving the file), and a release-time copy step. Failure mode shifts but doesn't shrink. |
| **3. Bake into combined image** | **No runtime download. Sidecar disappears. Mirrors the existing `cr.agentgateway.dev/agentgateway:vX.Y.Z` stage and `npm install -g @bitwarden/mcp-server` pattern. Image-pull failure is the only failure mode and it's already observable via Portainer.** | Couples agentgateway image rebuilds to truenas-mcp tagged releases (need a 2-line Dockerfile bump per release). Loses the `/tmp` "swap a fresh build in without a release" dev shortcut. |

The repo going public later doesn't change the math — option 3 still wins on simplicity and on eliminating the runtime fetch.

#### Concrete edits (single PR against `staticrevolution-com/sr-agentgateway`)

**1. `Dockerfile`** — add a fetch stage and a copy. Mirrors the existing `agentgateway-src` stage:

```dockerfile
FROM cr.agentgateway.dev/agentgateway:v1.1.0 AS agentgateway-src

# New: pull sr-truenas-mcp release tarball, extract binary
ARG TRUENAS_MCP_VERSION=v1.0.1
FROM curlimages/curl:8.11.0 AS truenas-mcp-src
ARG TRUENAS_MCP_VERSION
RUN --mount=type=secret,id=gh_token,required=true \
    GH_TOKEN="$(cat /run/secrets/gh_token)" \
 && curl -fsSL \
      -H "Authorization: Bearer ${GH_TOKEN}" \
      -H "Accept: application/octet-stream" \
      "https://api.github.com/repos/staticrevolution-com/sr-truenas-mcp/releases/tags/${TRUENAS_MCP_VERSION}" \
    | sh -c 'jq -r ".assets[] | select(.name == \"sr-truenas-mcp-linux-x64.tar.gz\") | .url"' \
    | xargs -I {} curl -fsSL -H "Authorization: Bearer ${GH_TOKEN}" -H "Accept: application/octet-stream" -o /tmp/truenas-mcp.tar.gz {} \
 && tar xzf /tmp/truenas-mcp.tar.gz -C /tmp \
 && /tmp/sr-truenas-mcp --version

FROM node:24-trixie-slim
RUN npm install -g \
      @bitwarden/mcp-server@2026.2.0 \
      @bitwarden/cli@2026.2.0 \
 && npm cache clean --force
COPY --from=agentgateway-src /app/agentgateway /app/agentgateway
COPY --from=truenas-mcp-src /tmp/sr-truenas-mcp /usr/local/bin/sr-truenas-mcp
ENV NODE_ENV=production
ENTRYPOINT ["/app/agentgateway"]
CMD ["-f", "/config.yaml"]
```

Notes on path choice: **bake to `/usr/local/bin/sr-truenas-mcp`, not `/opt/mcp-bin/`.** The compose still bind-mounts `/mnt/data-pool/apps/agentgateway/bin:/opt/mcp-bin:ro` for portainer-mcp, and that mount shadows whatever the image had at `/opt/mcp-bin`. A different path keeps both binaries reachable. The `--version` line in the fetch stage is a build-time smoke that fails the build if the binary is broken.

The exact `curl | jq | curl` sequence above is the GitHub API path that works with private repos via fine-grained PAT. Cleaner alternative: `gh release download` inside the build stage (requires installing `gh` first). Pick whichever is simpler in review.

**2. `.github/workflows/build.yaml`** — add the BuildKit secret. Two changes:

```yaml
- uses: docker/build-push-action@10e90e3645eae34f1e60eeb005ba3a3d33f178e8 # v6
  with:
    context: .
    file: Dockerfile
    push: true
    secrets: |
      gh_token=${{ secrets.TRUENAS_MCP_RELEASE_TOKEN }}
    build-args: |
      TRUENAS_MCP_VERSION=v1.0.1
    tags: |
      ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:latest
      ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}
    cache-from: type=gha
    cache-to: type=gha,mode=max
```

Rotating versions: bump the `TRUENAS_MCP_VERSION` build-arg in this workflow (one-line PR). For a future ergonomics improvement, add a `repository_dispatch` listener so a `sr-truenas-mcp` release fires a build here automatically — out of scope for B8.

**3. `docker-compose.yaml`** — drop the sidecar and the env var:

```diff
   agentgateway:
     image: ghcr.io/staticrevolution-com/sr-agentgateway-combined:latest
     ...
     depends_on:
       portainer-mcp-init:
         condition: service_completed_successfully
-      truenas-mcp-init:
-        condition: service_completed_successfully

-  # Installs sr-truenas-mcp binary to shared volume
-  # Sources: existing binary > host /tmp > GitHub release download
-  truenas-mcp-init:
-    image: busybox:1.37
-    container_name: sr-agentgateway-truenas-init
-    command:
-      - sh
-      - -c
-      - |
-        ...
-    environment:
-      - TRUENAS_MCP_VERSION=${TRUENAS_MCP_VERSION:-v1.0.1}
-    volumes:
-      - /mnt/data-pool/apps/agentgateway/bin:/bin-vol
-      - /tmp:/host-tmp:ro
-    restart: "no"
```

The `/mnt/data-pool/apps/agentgateway/bin:/opt/mcp-bin:ro` volume on the agentgateway service stays as-is (still serves portainer-mcp).

**4. `config.yaml`** — change the `truenas` backend `cmd` path:

```diff
       - name: truenas
         stdio:
-          cmd: /opt/mcp-bin/sr-truenas-mcp
+          cmd: /usr/local/bin/sr-truenas-mcp
```

#### Repo-level setup (one-time, before merging the PR)

1. **Create a fine-grained PAT** with `Contents: Read` scoped to `staticrevolution-com/sr-truenas-mcp` only. No other scopes. Owner: a service identity if available, otherwise the user.
2. **Add it to `staticrevolution-com/sr-agentgateway` repo secrets** as `TRUENAS_MCP_RELEASE_TOKEN`.
3. **Set an expiry reminder** for the PAT — fine-grained PATs have a max 1-year lifetime. Track in calendar / a B-row in PLAN.md if we add one for credential rotation.
4. **Verify Portainer stack 1183 has no `TRUENAS_MCP_VERSION` stack-level env var** that would interfere. (The compose default goes away with this PR; if Portainer has it set explicitly, that value would be passed to a service that no longer reads it, which is harmless but confusing.) Inspect via Portainer API and clean up if present.

#### Rollout sequencing

1. Repo-level setup above.
2. Open PR with the four file changes. CI build will fail without the secret/PAT — that's the intended forcing function.
3. After CI green: merge to `main`.
4. `build.yaml` workflow rebuilds `ghcr.io/...sr-agentgateway-combined:latest`. Verify in CI logs that the build-time `--version` smoke prints the expected `1.0.1+<sha>`.
5. Portainer redeploy stack 1183 with `pullImage: true`. The agentgateway service comes up with the baked binary at `/usr/local/bin/sr-truenas-mcp`; the `truenas-mcp-init` service is gone (Portainer's `pullImage`-with-removed-service path may leave an orphan container — see `portainer-safety.md` note about manually removing orphans via dockerProxy `DELETE /containers/<orphan>` after compose-level service removal).
6. Verify via Portainer dockerProxy exec: `sh -c "/usr/local/bin/sr-truenas-mcp --version; ls -la /opt/mcp-bin/"`. Expect `1.0.1+<sha>` and `portainer-mcp` only in `/opt/mcp-bin`.
7. Optional cleanup: `rm /mnt/data-pool/apps/agentgateway/bin/sr-truenas-mcp` on the host. The volume becomes a portainer-mcp-only directory. **This step needs explicit per-incident SSH authorization** (see `production-safety.md` and `authorization-scope.md`).

#### Verification

- Image build CI logs show `--version` printing `1.0.1+<sha>` from inside the fetch stage.
- Image SHA in `ghcr.io/...sr-agentgateway-combined:latest` updated; previous SHA available as the per-commit tag for rollback.
- Post-deploy: agentgateway container running, `/usr/local/bin/sr-truenas-mcp --version` returns expected stamp, MCP truenas tool calls succeed.
- `truenas-mcp-init` container absent from `docker ps -a` (or removed manually as orphan if Portainer left it).
- Stack restart cycle works without `/tmp/sr-truenas-mcp` and without `/bin-vol/sr-truenas-mcp`.

#### Rollback

The previous `sr-agentgateway-combined:<old-sha>` image is still on ghcr.io. Portainer redeploy with the image tag pinned to the previous commit SHA reverts. The compose stays the same (the truenas-mcp-init service is gone in both old and new compose); the only thing changing is which image the agentgateway service pulls. Old image still has `/opt/mcp-bin/sr-truenas-mcp` resolution intact via the volume mount, but if `/bin-vol` is empty, rollback would still need a binary in place. Document this caveat — recommend keeping a known-good `/bin-vol/sr-truenas-mcp` until B8 has soaked.

#### What this does NOT do (scope discipline)

- **Does not bake `portainer-mcp`.** Same fix applies and is worth doing — track as **B8b** (or fold into the same PR if the user wants). For now, portainer-mcp continues to use the busybox init + shared volume.
- **Does not change `sr-truenas-mcp` source code or release process.** The `sr-truenas-mcp` GitHub release workflow stays exactly as it is. B8 only consumes those releases differently.
- **Does not add release-event automation across repos.** A truenas-mcp release does NOT auto-trigger a sr-agentgateway image rebuild; the version bump is a manual one-line PR. That's a deliberate choice — small coordination cost, large reduction in moving parts.

#### Open decisions for the user before implementation

1. PAT lifetime — 90 days, 6 months, 1 year? (Trade rotation friction against blast radius if the PAT leaks.)
2. Should B8 fold in B8b (bake portainer-mcp at the same time)? Same Dockerfile pattern, same kind of secret; doubles the test surface but eliminates the bin volume entirely.
3. After B8 ships, do we keep `/tmp/sr-truenas-mcp` as a documented dev override path (manual restore + restart)? Or is the "tagged release every time" discipline enough?

---

## Phase C — v1.2.0+ (deferred / decision-pending)

Captured here for visibility, not committed:

- **MCP SDK 2.0 + Standard Schema migration** when SDK 2.0 stabilizes (post-June 2026 per research).
- **Zod v4 migration** — 6.5× faster, but `.passthrough()/.strict()/.strip()` semantics change. Pair with SDK 2.0 work.
- **Node SEA build path** (`--build-sea` on Node 22+). Replaces `@yao-pkg/pkg`. Smaller binary, no third-party packer, but currently requires Linux-on-Linux build (no cross-compile from Windows workstation). Decide once GitHub Actions Linux build is the only build path.
- **Optional dry-run mode** (mirror official truenas/truenas-mcp). Adds `dryRun: true` parameter to tier-1/2 actions; returns "what would happen" without executing. Significant scope; revisit when there's user demand.
- **Persistent WebSocket connection** — only meaningful if we leave `statefulMode: stateless` on the gateway. Keep as known-future-work, no action required now.

---

## Cross-cutting

### Critical files (Phase A + B)

| File | Phase | Reuse / pattern |
|---|---|---|
| `src/filters.ts` | A1, B7 | Keep `filterSensitiveFields()` signature; add layered `isSensitiveKey()` helper |
| `src/validation.ts` | A2 | Existing `validateTrueNASPath`; add `validateDatasetName` |
| `src/tools/storage.ts` | A2, A3 | Pattern: import schemas from a new `src/schemas/storage.ts` for testability |
| `src/tools/sharing.ts` | A2, A3 | Same |
| `src/tools/replication.ts` | A2, A3 | Same |
| `src/tools/system.ts` | A3 | Strict schema replaces `z.record` |
| `src/tools/vm.ts` | A3 | Enum tightening |
| `src/tools/network.ts` | A3 | Enum tightening |
| `src/client.ts` | A4, B2 | Single `settlePending()` state-transition function |
| `src/registry.ts` | A5, B1 | Add `idempotencyHint` plumbing (A4c); annotation emission (B1) |
| `src/resources.ts` | A6 | `Promise.allSettled` |
| `src/cli.ts` | A9, B5 | `--version` flag, optional pre-flight |
| `src/index.ts` | B1 | Tool annotations |
| `src/__tests__/*.test.ts` | A1–A6, B1–B7 | Co-located with each change |
| `CLAUDE.md`, `PLAN.md` | A5 | Doc sync |
| `.github/workflows/release.yml` | A8, B4 | SBOM + attestation |
| `staticrevolution-com/sr-agentgateway/docker-compose.yaml` | A8 | Bump `TRUENAS_MCP_VERSION` |

### Verification plan

**Per change** (during Phase A/B development):
- `npm run type-check` clean.
- `npm test` clean. Each new finding has a regression test.
- `npm run build:binary` produces a runnable binary; `--version` reports tag+SHA.

**Pre-tag checks before v1.0.1**:
1. Run full test suite on both Node 20 LTS and Node 22 LTS.
2. Manual smoke test against the live TrueNAS dev instance (192.168.1.235:444):
   - `truenas({ mode: "list_categories" })` returns 17 categories minus `api`.
   - `truenas({ category: "storage", action: "pool_list" })` returns live data, no sensitive fields visible.
   - `truenas({ category: "system", action: "service_stop", service: "ssh" })` (without `confirm`) returns the new detailed warning text.
   - `truenas({ category: "system", action: "service_stop", service: "ssh", confirm: true })` would actually stop SSH — **do not run** in normal flow; only in maintenance window if needed.
   - `truenas({ category: "network", action: "disk_temperatures" })` (no `names` param) returns all disks (regression check for the v1.0.0 bug).
3. Test path validation: send `{path: "/etc/passwd"}` to `filesystem_stat` → assert rejected with the path-validation error, not an API call.
4. Test filter: trigger `user.query` → assert response has no `unixhash`, no `password*`, no `*_token`. Pick one user with SSH keys; assert `sshpubkey` IS present (allowlist working).
5. Test schema: `system_general_update({ settings: { malicious_field: "x" } })` → assert rejected at registry, not at API.

**Post-deploy verification (after A8)**:
1. Read deployed binary's `--version` output via Portainer dockerProxy `exec` → confirm `v1.0.1+<sha>`.
2. AgentGateway logs grep for `truenas` over 24h → zero panics, zero new error patterns.
3. Live MCP call to `truenas_truenas` from this Claude Code session → expected output, response time within historical norms (~100-500ms cold-start).
4. SHA256 of deployed binary matches GitHub release asset SHA256.
5. After /tmp wipe (step A8.5): redeploy, verify deployed binary still matches release (init pulled from GitHub successfully).

**Post-tag for v1.1.0**:
1. New stderr log lines visible (when `TRUENAS_LOG_LEVEL=info` set).
2. SBOM downloadable from GitHub release.
3. `gh attestation verify` succeeds against the release binary.
4. MCP client that supports `destructiveHint` (Claude Desktop, current Claude Code) shows the annotation in tool listing — manual visual check.
5. Filter-doc-sync test (B7) passes; CI fails if anyone edits `src/filters.ts` without updating `CLAUDE.md`.

### Risks and how we close them

| Risk | Mitigation |
|---|---|
| Suffix-regex false positive redacts a needed field | NEVER_REDACT allowlist; doc-fixture test; visible in code review |
| Schema enum miss breaks a method we don't have a test for | Run live smoke against TrueNAS dev — A3 verification step |
| Reconnect-retry idempotency wrong, double-creates a resource | Idempotency hint defaults to `false`; only `*.query|*.get_instance|*.config` retry automatically |
| `system.general.update` strict schema rejects a field TrueNAS quietly added | Schema check is at registry layer — keep schema + log permissive on unknown-field reject; add `_unknown_keys_seen` telemetry to the audit-counts script. |
| `/tmp` wipe before fallback-pin update silently regresses to v1.0.0 | A8 step ordering enforces: pin-bump first, then wipe |
| MCP SDK 2.0 alpha lurches the ecosystem mid-flight | Stay on 1.x for v1.0.1 and v1.1.0 — Phase C is the migration window |

---

## Open decisions (none required to start Phase A)

These can be made between v1.0.1 and v1.1.0 ships:

1. Whether to expose `--describe-action <name>` on the binary (for CI doc-sync gates).
2. Whether to publish the npm package as well as the GitHub binary release.
3. Whether to add a `truenas_dryrun_*` command set in v1.1.0 vs deferring to v1.2.0.

---

## Deployed-binary state (post-A8, 2026-04-28)

- Path: `/opt/mcp-bin/sr-truenas-mcp` inside the `sr-agentgateway` container on TrueNAS endpoint 11.
- SHA256: `9114b23b4d83dfc515d4b36f8a7f83a5156200b23202b15937b7f517c2027b40` (matches GitHub release v1.0.1).
- Size: 57,708,032 bytes.
- `--version`: `1.0.1+7f19f82` (built from commit `7f19f82`).
- Source path on host: `/mnt/data-pool/apps/agentgateway/bin/sr-truenas-mcp` (the volume mount); `/tmp/sr-truenas-mcp` no longer exists.
- Operational health: agentgateway reset cleanly through stop/start; init logged "binary already exists"; first MCP exec inside container returned the new version stamp.

A8 also surfaced **B8** (GitHub-release fallback for the init container is broken — repo is private, anonymous `wget` 404s). Normal-flow updates remain unaffected; only disaster recovery from a fully-empty `/bin-vol` is currently impossible.

## What lands first

Phase A, in this order: A1 → A2 → A3 → A4 (in three commits: A4a/b together, A4c, A4d) → A5 → A6 → A7 → A9 → A8. Each is a separate PR. Tests land with each change. Tag cut after A9 verification. Phase B follows in a single milestone.
