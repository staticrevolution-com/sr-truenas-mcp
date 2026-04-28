# sr-truenas-mcp Hardening Plan

## Context

**Repo**: `staticrevolution-com/sr-truenas-mcp` (fork of `spranab/truenas-mcp`)
**Local**: `D:\github-local\staticrevolution-com\sr-truenas-mcp`
**Goal**: Transform a comprehensive but unguarded TrueNAS MCP server into a production-safe tool for Claude Code sessions, primarily for ZFS dataset reorganization work.

**Why this change is needed**: The upstream codebase (278 actions, 15 days old, 2 commits, zero tests) has critical security gaps (raw API escape hatch, process-wide TLS disable, no runtime validation, ~40 destructive actions missing confirmation gates, unfiltered sensitive data in responses) AND is built on TrueNAS REST API v2.0, which is deprecated and being removed.

**Critical API finding (confirmed from official TrueNAS docs)**: REST API v2.0 is not even documented in TrueNAS 25.10.2 — the official docs are 100% WebSocket JSON-RPC 2.0. The API has 841 methods across 92 namespaces. All 273 of spranab's REST actions map cleanly to WebSocket methods (270 clear 1:1 mappings). The API is extremely stable across versions: only 1 method removed from 25.10→27.0, 65 added. v26 adds Incus container management (25 new methods).

**Design decision**: Build on WebSocket JSON-RPC 2.0. The safety hardening (tiers, validation, filtering) is transport-agnostic — it lives in the registry layer, not the client. The client rewrite and handler migration are separate phases.

**API evolution (from downloaded docs)**:
| Version | Methods | Events | Key Additions |
|---------|---------|--------|---------------|
| 25.10.2 | 841 | 77 | Baseline — pool (84), system (55), vm (52), iscsi (46) |
| 26.0.0 | 920 (+62) | 77 | Incus containers (25), ZFS resource snapshots (12), web sharing (6), SED disk support |
| 27.0.0 | 923 (+3) | 77 | disk.get_instance, nvmet.global.sessions, reporting.graphs |

**Removed across all versions**: Only `pool.ddt_prefetch` (v25→v26). Zero methods removed v26→v27.

---

## Architecture

### What stays from upstream (transport-agnostic)
- `src/registry.ts` — Tool registry, categorization, hierarchical discovery (enhanced with safety enforcement)
- `src/index.ts` — MCP server setup, single "truenas" tool with 3 modes
- `src/resources.ts` — 12 read-only MCP Resources (client calls change, structure stays)
- `src/tools/*.ts` — 8 tool modules, 278 actions (handler logic stays, client calls change)
- `src/types.ts` — Type definitions
- Hierarchical tool design (1 MCP tool, ~200 tokens)

### What changes
- `src/client.ts` — Full rewrite: REST HTTP → WebSocket JSON-RPC 2.0
- Tool handler calls: `client.get("/pool")` → `client.call("pool.query")`
- New `src/safety.ts` — Tiered action classification
- New `src/validation.ts` — Path validation
- New `src/filters.ts` — Response filtering
- Enhanced `src/registry.ts` — Centralized safety enforcement

### Centralized enforcement in registry.ts
All safety enforcement lives in the registry, not scattered across 278 handlers:
- Blocked actions silently dropped at registration time
- Tier 1/2 confirm gates checked before handler dispatch
- Runtime Zod validation wraps every handler without touching handler code
- Response filtering applies to every handler return value
- The 8 tool files only change for client call migration, not safety logic

---

## Phase 0: Repository Foundation

**Goal**: Build tooling, test framework, CI, safety tier data file. No functional changes.

### New Files

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Project context (architecture, tiers, build/test, WebSocket notes) |
| `src/safety.ts` | Tier classification map — every action name → tier (pure data, no logic) |
| `vitest.config.ts` | Test runner config (vitest, TypeScript ESM, zero-config) |
| `.github/workflows/ci.yml` | CI: npm ci, build, test on push/PR |
| `renovate.json` | Extends `github>staticrevolution-com/renovate-config` |
| `src/__tests__/safety.test.ts` | Verify tier completeness and correctness |

### Modified Files

| File | Change |
|------|--------|
| `package.json` | Name → `sr-truenas-mcp`, add vitest + ws + json-rpc-2.0, update scripts/metadata |
| `.gitignore` | Add `coverage/`, `.env.local` |

### Safety Tier Assignments

**Tier 0 — Blocked** (8 actions, hard reject, not registered):
- `system_reboot`, `system_shutdown`, `system_config_upload` — system-level danger
- `truenas_api_call` — bypass that renders all other gates cosmetic
- `cronjob_create`, `cronjob_update` — arbitrary shell command execution on TrueNAS
- `initshutdown_create`, `initshutdown_update` — arbitrary shell command execution on TrueNAS

**Tier 1 — Confirm + Reason** (~14 actions, must pass `confirm: true` AND `reason: "string"`):
- `pool_create`, `pool_export`, `pool_replace_disk` — pool-level data operations
- `disk_wipe` — irreversible hardware-level destruction
- `dataset_delete` — recursive data deletion
- `snapshot_rollback` — overwrites current state
- `update_apply` — system update with potential reboot
- `bootenv_activate`, `bootenv_delete` — boot environment changes
- `boot_attach_disk`, `boot_detach_disk` — boot pool disk operations
- `directory_services_leave` — breaks auth for domain users
- `system_config_download` — response contains secret seed + encryption keys
- `network_commit_changes` — applies staged network changes, could lock out access

**Tier 2 — Confirm** (~55 actions, must pass `confirm: true`):
All existing confirm-gated actions not in tier 0/1, PLUS newly gated:
- Services: `service_stop`, `service_restart`, `service_update`
- Network: `network_config_update`, `network_interface_create/update/delete`
- Account: `user_create`, `user_update`, `user_set_password`, `user_delete`, `group_create`, `group_update`, `group_delete`
- Credentials: `api_key_create`, `api_key_delete`, `keychaincredential_create`, `keychaincredential_delete`
- Service configs: `ssh_config_update`, `ftp_config_update`, `snmp_config_update`, `ups_config_update`
- Tunables: `tunable_create`, `tunable_update`, `tunable_delete`
- Filesystem: `filesystem_mkdir`, `filesystem_set_permissions`, `filesystem_chown`, `filesystem_set_acl`
- Storage: `dataset_lock`, `dataset_set_permissions`, `dataset_set_quota`, `dataset_promote`
- Sharing configs: `smb_config_update`, `nfs_config_update`, `iscsi_global_config_update`
- VMs: `vm_stop`, `vm_restart`, `vm_delete`, `vm_device_delete`
- Apps: `app_delete`, `app_rollback`, `docker_config_update`
- Certs: `certificate_create`, `certificate_delete`, `acme_dns_authenticator_create/delete`
- Data protection: `replication_create`, `replication_delete`, `cloudsync_create`, `cloudsync_delete`, `rsync_task_create`
- Other: `audit_config_update`, `privilege_create/update/delete`, `alertservice_create/delete`
- Updates: `update_config_set`, `update_download`
- Mail/Directory: `mail_update`, `directory_services_update`
- Shares: `smb_share_delete`, `nfs_share_delete`, `iscsi_target_delete`, `iscsi_extent_delete`, `iscsi_portal_delete`, `iscsi_initiator_delete`, `iscsi_targetextent_delete`

**Tier 3 — Open** (remaining ~200 actions):
All reads, safe creates, non-destructive updates, queries.

### Tests
- Every action name in tier map must match a real registered action (no typos)
- Every registered action must have a tier assignment (no defaults/gaps)
- Tier 0 contains exactly the 8 blocked actions
- Tier 1 and 2 counts match expected ranges

---

## Phase 1: Safety Enforcement + Escape Hatch Removal

**Goal**: Highest-impact security phase. Works with existing REST client — transport-agnostic. After this phase, every action is properly gated and parameters are validated.

### Modified Files

**`src/tools/filesystem.ts`** (lines 694-736):
- Delete `truenas_api_call` tool registration block entirely

**`src/registry.ts`** — Core enforcement changes:
1. Import safety tier map from `src/safety.ts`
2. **`tool()` method**: On registration, check tier → skip tier 0 actions (never registered)
3. **`execute()` method**: Before calling handler:
   - Look up action tier
   - Tier 1: require `confirm === true` AND non-empty `reason` string, else return error
   - Tier 2: require `confirm === true`, else return error
   - Tier 3: no gate
   - Then: construct `z.object(schema).passthrough().safeParse(params)` → if fail, return Zod validation errors; if pass, call handler with validated data
4. **`listActions()` method**: Annotate tier 1/2 actions in discovery output
5. **`listCategories()` method**: Remove `api` category
6. **`CATEGORIES` constant**: Remove `api` entry

**`src/index.ts`**:
- Add `reason` as optional string param on the `truenas` tool schema
- Remove `api` from category list in tool description

### Why No Handler Changes Needed
The registry intercepts both registration and execution. Safety checks at these two points cover the entire 278-action surface. Existing `if (!confirm)` checks in handlers remain as defense-in-depth.

### Tests (`src/__tests__/registry.test.ts`, `src/__tests__/safety-completeness.test.ts`)
- Tier 0 actions not discoverable or executable
- Tier 1 rejects without confirm; rejects with confirm but no reason; accepts with both
- Tier 2 rejects without confirm; accepts with confirm
- Tier 3 executes without gates
- Zod validation catches type mismatches (string where number expected)
- `truenas_api_call` absent from all category listings and action lists
- Build real registry with mock client → every registered action has a tier assignment

---

## Phase 2: WebSocket Client

**Goal**: Replace the REST HTTP client with WebSocket JSON-RPC 2.0. This is the transport migration.

### New Dependencies (added in Phase 0's package.json)
- `ws` — WebSocket client for Node.js
- `json-rpc-2.0` — JSON-RPC 2.0 protocol implementation

### Rewritten File

**`src/client.ts`** — Full rewrite (~200-250 lines):

**Connection lifecycle** (from TrueNAS core WebSocket API docs + Go reference):

The protocol is **DDP (Distributed Data Protocol)**, a Meteor framework protocol — NOT pure JSON-RPC 2.0. The official core docs at `truenas.com/docs/api/core_websocket_api.html` and the Go reference implementation both use DDP format. The downloaded v25.10.2 docs describe a JSON-RPC 2.0 format — this may be a newer overlay or documentation discrepancy. **Must verify against live TrueNAS 25.10.1.**

```
1. Connect: ws(s)://{host}/websocket
2. Handshake:
   → {"msg": "connect", "version": "1", "support": ["1"]}
   ← {"msg": "connected", "session": "uuid"} (or {"msg": "failed"})
3. Auth:
   → {"id": "uuid", "msg": "method", "method": "auth.login_with_api_key", "params": ["api-key"]}
   ← {"id": "uuid", "msg": "result", "result": true}
4. Requests:
   → {"id": "uuid", "msg": "method", "method": "pool.query", "params": []}
   ← {"id": "uuid", "msg": "result", "result": [...]}
```

Key: `msg: "method"` for requests, `msg: "result"` for responses. Session-based auth persists for connection lifetime. No batch requests supported. IDs are strings (UUIDs), not incrementing integers.

The client implementation should detect which format the server uses (DDP vs JSON-RPC 2.0) based on the initial handshake response and adapt accordingly.

**Core interface**:
```typescript
class TrueNASClient {
  constructor(config: { url: string; apiKey: string; verifySsl?: boolean })
  async connect(): Promise<void>
  async call(method: string, params?: unknown[]): Promise<unknown>
  async waitForJob(jobId: number, timeoutMs?: number): Promise<JobResult>
  async ping(): Promise<boolean>
  close(): void
}
```

**Key implementation details** (patterns from Go reference):
- Request multiplexing via UUID IDs + pending response map (DDP uses string UUIDs, not integers)
- Per-request timeout via AbortController (30s default, 300s for jobs)
- TLS: Use `ws` library's `rejectUnauthorized` option (per-connection, not global). No `process.env` mutation.
- Auto-reconnect with 1 retry on connection loss
- Clean shutdown on process exit

**REST → WebSocket method mapping patterns** (verified against v25.10.2 docs, 270/273 clear mappings):
| REST Pattern | WebSocket Method | Params |
|---|---|---|
| `GET /resource` | `resource.query` | `[filters?, options?]` |
| `GET /resource/id/{id}` | `resource.get_instance` | `[id]` |
| `POST /resource` | `resource.create` | `[body]` |
| `PUT /resource/id/{id}` | `resource.update` | `[id, body]` |
| `DELETE /resource/id/{id}` | `resource.delete` | `[id]` |
| `POST /resource/id/{id}/action` | `resource.action` | `[id, body?]` |
| `GET /resource/config` | `resource.get_instance` | `[]` |
| `PUT /resource/config` | `resource.update` | `[body]` |

Filter syntax: `[[field, op, value]]` — ops: `=`, `!=`, `>`, `>=`, `<`, `<=`, `~`, `in`, `nin`, `OR`
Job methods: return job ID, poll via `core.get_jobs` with `[["id","=",jobId]]`

### Tests (`src/__tests__/client.test.ts`)
- Mock WebSocket connection (vitest mock of `ws` module)
- Verify connect handshake sequence
- Verify auth call with API key
- Verify `call()` sends JSON-RPC 2.0 format with incrementing IDs
- Verify response routing (correct response matched to correct request via ID)
- Verify timeout triggers AbortError
- Verify `process.env.NODE_TLS_REJECT_UNAUTHORIZED` is NOT modified
- Verify reconnect on connection loss

---

## Phase 3: Tool Handler Migration

**Goal**: Translate all 270 active tool handlers from REST calls to WebSocket JSON-RPC calls. Mechanical — all 270 have verified 1:1 mappings.

### Translation Pattern (verified against official TrueNAS v25.10.2 docs)

Each handler changes from:
```typescript
// Before (REST)
const result = await client.get("/pool");
const result = await client.get(`/pool/dataset/id/${encodeURIComponent(id)}`);
const result = await client.post("/pool/dataset", body);
const result = await client.put(`/pool/dataset/id/${encodeURIComponent(id)}`, body);
const result = await client.delete(`/pool/id/${id}/export`, body);
```

To:
```typescript
// After (WebSocket JSON-RPC)
const result = await client.call("pool.query");
const result = await client.call("pool.dataset.get_instance", [id]);
const result = await client.call("pool.dataset.create", [body]);
const result = await client.call("pool.dataset.update", [id, body]);
const result = await client.call("pool.export", [id, body]);
```

### URL Encoding Issue Eliminated
WebSocket JSON-RPC passes IDs as method parameters, not URL path segments. The entire class of URL-encoding bugs disappears.

### Modified Files (all 8 tool modules + resources)

| File | Handlers | Change Type |
|------|----------|-------------|
| `src/tools/storage.ts` | ~32 | REST → WebSocket calls |
| `src/tools/filesystem.ts` | ~35 | REST → WebSocket calls |
| `src/tools/network.ts` | ~50 | REST → WebSocket calls |
| `src/tools/replication.ts` | ~40 | REST → WebSocket calls |
| `src/tools/sharing.ts` | ~36 | REST → WebSocket calls |
| `src/tools/vm.ts` | ~35 | REST → WebSocket calls |
| `src/tools/alert.ts` | ~28 | REST → WebSocket calls |
| `src/tools/system.ts` | ~24 | REST → WebSocket calls |
| `src/resources.ts` | 12 | REST → WebSocket calls |

### Verified Mapping Reference (from v25.10.2 docs, 270/273 clear)

Namespace patterns confirmed against `docs/truenas-v25.10.2-docs/`:

| Category | WebSocket Namespaces |
|----------|---------------------|
| Storage | `pool.*`, `pool.dataset.*`, `pool.snapshot.*`, `pool.snapshottask.*` |
| Filesystem | `filesystem.*` (stat, listdir, mkdir, setperm, getacl, setacl, chown) |
| Sharing | `sharing.smb.*`, `sharing.nfs.*`, `iscsi.target/extent/portal/initiator.*` |
| VMs/Apps | `vm.*`, `vm.device.*`, `app.*`, `docker.*` |
| System | `system.*`, `service.*`, `mail.*`, `api_key.*` |
| Data protection | `replication.*`, `cloudsync.*`, `cloud_backup.*`, `cronjob.*`, `rsynctask.*` |
| Network | `interface.*`, `network.configuration.*`, `staticroute.*` |
| Account | `user.*`, `group.*`, `privilege.*` |
| Config | `ssh.*`, `ftp.*`, `snmp.*`, `ups.*`, `tunable.*` |

Standard CRUD pattern: `.query`, `.get_instance`, `.create`, `.update`, `.delete`
Filter syntax: `[[field, op, value]]` — ops: `=`, `!=`, `>`, `>=`, `<`, `<=`, `~`, `in`, `nin`, `OR`
Job polling: `core.get_jobs` with `[["id","=",jobId]]` filter

### Tests (`src/__tests__/handlers.test.ts`)
- For each category, test 2-3 representative handlers with mock client:
  - A read action (verify correct WebSocket method name and params format)
  - A write action (verify correct method name and body format)
  - A filtered query (verify filter syntax `[[field, op, value]]`)
- Total: ~20-30 targeted handler tests covering all 8 modules

---

## Phase 4: Path Validation + Response Filtering

**Goal**: Address filesystem path traversal and sensitive data leakage.

### New Files

**`src/validation.ts`**:
- `validateTrueNASPath(path: string): string` — Must start with `/mnt/`, no `..`, no null bytes. Returns normalized path or throws.

**`src/filters.ts`**:
- `filterSensitiveFields(data: unknown): unknown` — Deep recursive redaction of: `privatekey`, `private_key`, `pass`, `password`, `passwd`, `monpwd`, `encryption_key`, `secret`, `secretseed`, `secret_seed`, `v3_password`, `v3_privpassphrase`. Replaces values with `"[REDACTED]"`.

### Modified Files

**`src/tools/filesystem.ts`**:
- Add `validateTrueNASPath(path)` to 7 handlers: `filesystem_stat`, `filesystem_listdir`, `filesystem_mkdir`, `filesystem_set_permissions`, `filesystem_get_acl`, `filesystem_set_acl`, `filesystem_chown`

**`src/registry.ts`**:
- In `execute()`, wrap handler return value through `filterSensitiveFields()` before returning

### Tests
- `src/__tests__/validation.test.ts`: `/mnt/tank/data` passes, `../../etc/passwd` fails, `/etc/shadow` fails, null bytes fail
- `src/__tests__/filters.test.ts`: Sensitive fields redacted, non-sensitive preserved, nested objects handled, primitives pass through

---

## Phase 5: Integration Tests + Build Config

**Goal**: End-to-end pipeline verification. Claude Code MCP configuration.

### New Files

**`src/__tests__/integration.test.ts`**:
- Build real registry with mock client
- Verify total tool count (278 minus 8 blocked = 270)
- Verify all categories present (minus `api`)
- Verify blocked actions absent from all listings
- Verify tier enforcement through full pipeline (discover → execute)
- Verify Zod validation through full pipeline
- Verify response filtering through full pipeline
- Verify path validation through filesystem handlers

### Modified Files

**`CLAUDE.md`** — Final comprehensive content:
- Architecture overview (WebSocket JSON-RPC 2.0, safety tiers, centralized enforcement)
- Safety tier reference table (all 270 actions classified)
- Build commands: `npm install`, `npm run build`, `npm test`
- Claude Code MCP config example:
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
- REST API deprecation context and migration rationale
- TrueNAS WebSocket API reference links

**`package.json`**: Add `"type-check": "tsc --noEmit"` script

---

## Phase 6: Polish (optional, deferrable)

1. **Audit query validation**: Validate `query_filters` structure in `audit_query` handler
2. **Payload size limit**: Reject params where `JSON.stringify(params).length > 50000`
3. **Startup health check**: `client.ping()` in `cli.ts` before starting, print diagnostic
4. **npm audit**: Document transitive hono vulnerabilities (not exploitable in stdio) in CLAUDE.md
5. **Connection health**: Periodic WebSocket ping/pong to detect dead connections

---

## Phase Dependency Graph

```
Phase 0 (foundation) ─── no dependencies
   │
   ├── Phase 1 (safety enforcement) ─── depends on Phase 0
   │
   └── Phase 2 (WebSocket client) ─── depends on Phase 0 (parallel with Phase 1)
          │
          Phase 3 (handler migration) ─── depends on Phases 1 + 2
             │
             Phase 4 (validation + filtering) ─── depends on Phase 3
                │
                Phase 5 (integration tests) ─── depends on Phase 4
                   │
                   Phase 6 (polish) ─── deferrable
```

**Phases 1 and 2 can be developed in parallel** — Phase 1 modifies registry.ts, Phase 2 rewrites client.ts. They touch different files.

**The server is testable after Phase 1** (safety enforcement works with REST client). It becomes WebSocket-native after Phase 3.

---

## File Change Summary

| Phase | New Files | Modified Files |
|-------|-----------|---------------|
| 0 | `CLAUDE.md`, `src/safety.ts`, `vitest.config.ts`, `.github/workflows/ci.yml`, `renovate.json`, `src/__tests__/safety.test.ts` | `package.json`, `.gitignore` |
| 1 | `src/__tests__/registry.test.ts`, `src/__tests__/safety-completeness.test.ts` | `src/registry.ts`, `src/tools/filesystem.ts`, `src/index.ts` |
| 2 | `src/__tests__/client.test.ts` | `src/client.ts` (full rewrite) |
| 3 | `src/__tests__/handlers.test.ts` | All 8 `src/tools/*.ts` files, `src/resources.ts` |
| 4 | `src/validation.ts`, `src/filters.ts`, `src/__tests__/validation.test.ts`, `src/__tests__/filters.test.ts` | `src/tools/filesystem.ts`, `src/registry.ts` |
| 5 | `src/__tests__/integration.test.ts` | `CLAUDE.md`, `package.json` |

---

## Testing Strategy

- **Framework**: vitest (zero-config TypeScript ESM, fast, excellent mocking)
- **No live TrueNAS calls**: All tests mock `TrueNASClient` or `ws` WebSocket
- **Non-invasive**: Tests verify safety logic and call patterns, not TrueNAS behavior
- **Mock patterns**:
  - Client: `vi.fn().mockResolvedValue({})` for `call()`, `waitForJob()`, `ping()`
  - WebSocket: Mock `ws` module to verify connect/auth/call sequences
- **Completeness tests**: Programmatically verify every action has a tier assignment
- **Handler tests**: Verify correct WebSocket method names and param formats per category

---

## Verification (after all phases)

1. `npm run build` — TypeScript compiles cleanly
2. `npm test` — All tests pass
3. `npm run type-check` — No type errors
4. Configure in Claude Code MCP settings, run `truenas()` — see category listing
5. Verify blocked actions return hard errors
6. Verify tier 1 actions require confirm + reason
7. Run `truenas({ category: "storage", action: "pool_list" })` — get live data from TrueNAS
8. Verify sensitive fields in responses are redacted
9. Verify filesystem path traversal attempts are rejected
