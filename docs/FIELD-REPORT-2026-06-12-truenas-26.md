# Field Report — 2026-06-12 live deploy against TrueNAS 26.0.0-BETA.1

**Status:** triaged; fixes landed (see below) · **Origin:** live service-deploy session, 2026-06-12

During a service deploy, an agent session drove the deployed `sr-truenas-mcp` (federated
via AgentGateway) against a production box now running **TrueNAS 26.0.0-BETA.1**. REST v2
is fully removed in 26.0 (`/api/v2.0/*` 404s); the WebSocket JSON-RPC API is the only API
surface. Three bugs surfaced; each was triaged against the source and root-caused. This
document is the durable record. (GitHub Issues were disabled on this repo when
this was written; they were enabled 2026-08-21.)

## Bug 1 — API errors swallowed into "API call failed"

**Observed:** `storage / dataset_create` for a new `pool/apps/<service>` dataset returned
`Error: TrueNAS API error: API call failed` with no detail — across several parameter
variations. The dataset actually existed afterward but was unmounted; a direct websocket
retry of `pool.dataset.create` returned `[EZFS_EXISTS] … dataset already exists`, which the
MCP had discarded.

**Root cause:** `src/client.ts` built error messages from `msg.error?.message`, but
middlewared's DDP error payload has no `message` field — it carries `errname` (e.g.
`EZFS_EXISTS`), a multiline `reason`, and the errno in `error`. Every middleware error
therefore fell through to the generic fallback string.

**Fix:** `formatDDPError()` in `src/client.ts` — prefers `errname` + first line of `reason`,
falls back to the legacy `message`/`code` shape, and only renders "API call failed" when the
payload is genuinely empty.

**Not fixed (server-side):** the half-provisioned dataset itself. `pool.dataset.create` on
26.0.0-BETA.1 created the ZFS dataset, then failed before mounting it — that atomicity break
is middlewared's, not this client's. Mitigation landed instead: `dataset_create` now stats
the returned mountpoint after create and appends an explicit *created-but-unmounted* warning
when it is absent (see Bug 2's verification theme). Recovery for the live incident was
delete + recreate.

## Bug 2 — filesystem writes reported success without effect

**Observed:** `filesystem_mkdir` and `filesystem_chown` both reported OK for a
subdirectory of the dataset from Bug 1, but `filesystem.stat` immediately after returned
ENOENT. A later `filesystem_chown` in the same session instead returned "API call failed"
while the equivalent direct websocket call worked — an inconsistent failure mode.

**Root cause (chown/setperm/setacl):** `filesystem.chown`, `filesystem.setperm`, and
`filesystem.setacl` are `@job` methods in middlewared — the immediate return value is a job
id. The handlers returned that id as success without waiting; a job that later failed (e.g.
target path missing because the parent dataset was unmounted, per Bug 1) was invisible. The
inconsistency is explained by the two paths: synchronous rejection at call time → swallowed
error (Bug 1); accepted call → job id → false success regardless of job outcome.

**Root cause (mkdir):** `filesystem.mkdir` is synchronous, and middleware genuinely reported
success — most plausibly the directory landed on (or was hidden by) the wrong filesystem
because of the parent dataset's mount state. The MCP relayed the server truthfully but
verified nothing.

**Fix:** handlers for `filesystem_chown`, `filesystem_set_permissions`, and
`filesystem_set_acl` now wait for the job via `client.waitForJob()` and surface its terminal
state; a FAILED/ABORTED job is an error, not a success. `filesystem_mkdir` stats the path
back after create and errors with a *post-write verification failed* message if it is
absent. `dataset_create` stats the new dataset's mountpoint and warns when unmounted.

## Bug 3 — discovery error rendered an empty action list

**Observed:** calling with an unknown action in category `pool` (a plausible guess, but not
a category — pool actions live under `storage`) and in `zzz` (bogus) both returned
`Unknown action "…" in category "…". Available: ` with nothing after "Available:".

**Root cause:** `ToolRegistry.execute()` built the "Available:" list by filtering registered
tools on the given category without first checking that the category exists. An unknown
category matched nothing → empty list. `listActions()` (mode 2) already handled unknown
categories correctly; only the execute path didn't.

**Fix:** `execute()` now distinguishes the cases — unknown category lists the valid
categories; unknown action in a valid category lists that category's actions; the empty
"Available:" rendering is gone.

## Polish items from the same session

- **Version awareness:** the category-list discovery output now points callers at
  `system_version` (category `system`), since API behavior differs across TrueNAS majors.
- **Endpoint documentation:** the production endpoint reference was recorded in the
  private homelab docs (deliberately not in this public repo); `CLAUDE.md` § Deployment
  points there.

## Deferred follow-ups

1. **TrueNAS 26.0 compatibility sweep.** The box is on 26.0.0-BETA.1. This server is
   websocket-only, so the REST removal itself is harmless, but 25.x → 26.x JSON-RPC schema
   renames/removals have not been audited. Forcing function: first 26.0-specific call
   failure, or 26.0 GA landing on the production box.
2. **Job-method audit across all handlers.** Bug 2's fix covers the three filesystem job
   methods. Other handlers call `@job` methods too (e.g. `disk_wipe` and SMART tests, which
   deliberately document "returns a job ID"). Audit all 270 actions and decide per action
   whether to wait, poll, or keep returning the id — the deliberate cases should say so in
   their descriptions.
3. **Deploy the fixes (v1.0.1).** These fixes exist in source only; the deployed binary
   predates them. Ship via the normal channel: cut the `v1.0.1` tagged release (CI builds
   the binary tarball + GHCR image), then point the `sr-mcp-gateway` truenas backend at the
   new version and let the supervisor restart it. (Production now federates via
   `sr-mcp-gateway`, which replaced the decommissioned `sr-agentgateway` — backends are
   runtime-registered, not baked into a combined image.) Verify with `sr-truenas-mcp
   --version` after deploy.

Structured discovery output (machine-readable category/tier metadata) remains tracked
separately in [`TOOL-SURFACE-EVALUATION.md`](./TOOL-SURFACE-EVALUATION.md) — deferred to
`sr-mcp-gateway` Phase C.
