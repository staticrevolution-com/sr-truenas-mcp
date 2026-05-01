# sr-truenas-mcp

A hardened [Model Context Protocol](https://modelcontextprotocol.io/) server
for [TrueNAS SCALE](https://www.truenas.com/truenas-scale/). 270
safety-tiered actions across 17 categories of TrueNAS surface, exposed
through a single hierarchical MCP tool over WebSocket JSON-RPC 2.0.

[![CI](https://github.com/staticrevolution-com/sr-truenas-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/staticrevolution-com/sr-truenas-mcp/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/staticrevolution-com/sr-truenas-mcp?display_name=tag&sort=semver)](https://github.com/staticrevolution-com/sr-truenas-mcp/releases)
[![License: PolyForm-NC 1.0](https://img.shields.io/badge/license-PolyForm--NC--1.0.0-blue)](LICENSE)

> **Free for non-commercial use.** Personal, hobbyist, educational,
> charitable, governmental, and research use is covered by the included
> PolyForm Noncommercial 1.0.0 license. Commercial use requires a separate
> paid license — contact `admin@staticrevolution.com`.

---

## Disclaimer

This software is provided as-is, with no warranty. By design it performs
destructive operations on a TrueNAS system — deleting datasets, modifying
shares, wiping disks, applying updates — and it does so on behalf of an
LLM acting as a privileged operator. Warren Kelly and Static Revolution
LLC accept no liability for data loss, downtime, or other damages
resulting from its use. Read the safety-tier system in
[Architecture](#architecture) and test against a non-production TrueNAS
before pointing it at anything you care about.

---

## Why this exists

I built this to give Claude Code and OpenClaw (an n8n-driven agent
framework) a way to actually manage my TrueNAS server — not just read
status, but reorganize ZFS datasets, manage shares, configure replication,
and the rest of the surface a NAS admin uses day to day. The two existing
options at the time didn't fit:

- The **upstream `spranab/truenas-mcp`** project covered most of the API but
  ran on TrueNAS's REST API v2.0 (which doesn't appear in the current
  TrueNAS docs at all — the canonical transport is WebSocket JSON-RPC 2.0)
  and had no safety surface beyond per-handler `confirm: true` checks. No
  tests. No CI. Two commits. Treating an LLM as a privileged operator on
  this kind of surface needed more than that.
- The **official `truenas/truenas-mcp`** from iXsystems is well built but
  intentionally narrow — 52 tools, with ZFS dataset management limited to
  `create_dataset` and `query_datasets`. No delete, no update, no snapshot
  CRUD, no replication, no iSCSI, no certificates. Marked "Research
  Preview, not for production use." For my use case that wasn't workable.

So I forked spranab's project, migrated the transport to WebSocket, added
a four-tier safety classification with centralized enforcement at the
registry layer, added response filtering for sensitive fields, added path
and dataset-name validation, and wrote a test suite. See
[COMPARISON.md](COMPARISON.md) for the full breakdown.

---

## What it does

270 actions across 17 categories. The full surface (with safety tiers)
is documented at runtime via the `truenas` tool's discovery modes; the
short version:

| Category | Coverage |
|---|---|
| **Storage** | Pool create/destroy/import/export/replace/scrub. Dataset CRUD, snapshot CRUD, snapshot tasks, encryption (lock/unlock/key), quotas, permissions, promote |
| **Sharing** | SMB / NFS / iSCSI shares — full CRUD on shares, targets, extents, portals, initiators, target-extent mappings |
| **Filesystem** | `stat`, `listdir`, `mkdir`, `chown`, set-permissions (POSIX), set-ACL (NFSv4), get-ACL |
| **System** | Service start/stop/restart/control, `system.info`, system_general config, NTP, mail, API keys, boot environments |
| **Network** | Interface CRUD, static routes, network configuration, commit/rollback staged changes |
| **Account** | User CRUD, group CRUD, privilege CRUD, set-password |
| **Apps** | Install / start / stop / upgrade / delete, app catalog, Docker config |
| **VMs** | VM CRUD, device CRUD, start/stop/restart |
| **Replication** | Replication tasks, cloud sync, cloud backup, rsync tasks |
| **Data protection** | Periodic snapshot tasks |
| **Disks** | Query, wipe, SMART results (initiation not exposed via WS API) |
| **Certificates** | Certificate CRUD, ACME, DNS authenticators |
| **Directory services** | Status, configure, leave, refresh cache |
| **Reporting** | System / network / disk / ARC metrics |
| **Update** | Check, download, apply system updates |
| **Alerts** | Query, dismiss, restore alerts; alert-service CRUD |
| **Audit** | Query audit logs |

Compare against [`docs/full-features.md` in `truenas/truenas-mcp`](https://github.com/truenas/truenas-mcp/blob/main/docs/full-features.md)
for the official Research Preview's narrower surface.

---

## What makes it different

Three things, in roughly the order they matter:

**Single hierarchical tool.** The MCP server registers one tool — `truenas` —
not 270. The model spends prompt budget on one tool definition (~200
tokens) instead of 270 separate JSON Schemas. Action discovery is a
runtime call (`truenas({ mode: "list_categories" })` →
`truenas({ category: "storage" })` → `truenas({ category: "storage",
action: "dataset_create", ... })`). For a session that uses ten different
TrueNAS actions, the prompt cost is roughly the same as one. This is
inherited from spranab's design and is the single biggest reason
hierarchical works as a pattern at this surface size.

**Centralized safety at the registry layer, not per-handler.** Every
action has a tier in `src/safety.ts` — a pure data file. The registry
checks the tier before dispatching to the handler. Tier 0 actions never
register, so they're not even discoverable. Tier 1 requires `confirm:
true` AND a `reason` string. Tier 2 requires `confirm: true`. Tier 3 is
open. New actions ship unable to register if they're not in the tier
map — which is the property I wanted: a contributor cannot add an
action without making a classification decision.

**Centralized response filtering.** Every handler return value passes
through `filterSensitiveFields` in `src/filters.ts` before reaching the
MCP transport. Three layers: 57 exact key matches (`password`,
`privatekey`, `unixhash`, `salt`, …), 9 suffix patterns (`_password$`,
`_token$`, `_secret$`, …), and a 15-entry allowlist that protects
benign `*_key` identifiers (`id_key`, `pool_key`, `vdev_key`),
password-policy descriptors, and public-key material. The allowlist
matters — without it, suffix matching would redact things like
`pool_key` (a TrueNAS internal identifier) and break legitimate reads.

Everything else — path validation, dataset-name validation, schema
tightening on high-risk methods, structured logging, the standalone
binary build, CI — falls out of those three decisions.

---

## Quick install

The fastest path:

```bash
# Download the binary from the latest release
curl -L https://github.com/staticrevolution-com/sr-truenas-mcp/releases/latest/download/sr-truenas-mcp-linux-x64.tar.gz | tar xz
chmod +x sr-truenas-mcp

# Verify
./sr-truenas-mcp --version

# Run
TRUENAS_URL=wss://truenas.local:444 \
TRUENAS_API_KEY=$(cat ~/.truenas-key) \
TRUENAS_VERIFY_SSL=false \
./sr-truenas-mcp
```

Linux x64 only for the binary distribution. Other platforms run from
source via `npm install && npm run build && node dist/cli.js`.

For Docker, Claude Code / Claude Desktop / VS Code MCP integration,
see [`docs/INSTALL.md`](docs/INSTALL.md).

---

## Configuration

Three required environment variables:

| Variable | Example | Notes |
|---|---|---|
| `TRUENAS_URL` | `wss://truenas.local:444` | Must be `wss://`. The TrueNAS middleware revokes API keys used over `ws://` |
| `TRUENAS_API_KEY` | `1-...` | Generated in TrueNAS UI: User → API Keys → Add. Key needs admin scope for the actions you intend to run |
| `TRUENAS_VERIFY_SSL` | `false` | Set `false` for self-signed certs (most home installs); leave unset/true for properly issued certs |

Optional: `TRUENAS_LOG_LEVEL`, `TRUENAS_KEEPALIVE_INTERVAL_MS`,
`TRUENAS_SKIP_PREFLIGHT`. Full reference at
[`docs/CONFIGURATION.md`](docs/CONFIGURATION.md).

---

## Architecture

The server is a single MCP tool exposed over stdio, backed by a
WebSocket JSON-RPC 2.0 client to TrueNAS's middleware. The registry
between them enforces safety, schema validation, and response
filtering.

```
                ┌────────────────────────────────────────┐
LLM client ───► │  MCP tool: truenas                     │
(stdio/SSE)     │                                        │
                │  modes:                                │
                │    "list_categories" → 17 categories   │
                │    "list_actions"    → tier-tagged     │
                │    "execute"         → handler         │
                └─────────────┬──────────────────────────┘
                              │
                ┌─────────────▼──────────────────────────┐
                │  ToolRegistry (src/registry.ts)        │
                │   1. Tier check (0=blocked,            │
                │                  1=confirm+reason,     │
                │                  2=confirm,            │
                │                  3=open)               │
                │   2. Zod schema validation             │
                │   3. Handler dispatch                  │
                │   4. filterSensitiveFields()           │
                └─────────────┬──────────────────────────┘
                              │
                ┌─────────────▼──────────────────────────┐
                │  TrueNASClient (src/client.ts)         │
                │  WebSocket DDP / JSON-RPC 2.0          │
                │  request multiplexing, reconnect,      │
                │  job polling with exponential backoff  │
                └─────────────┬──────────────────────────┘
                              │
                              ▼
                       wss://truenas/websocket
```

### Why WebSocket and not REST

Modern TrueNAS docs are 100% WebSocket JSON-RPC 2.0 — the REST API v2.0
that spranab's project used isn't documented in the current TrueNAS
manual. The official `truenas/truenas-mcp` from iXsystems is also
WebSocket-only and explicitly refuses unencrypted `ws://`. That's the
direction signal. REST will work for some time but is on borrowed time.

The migration also eliminated a class of bugs: REST passed dataset and
pool IDs as URL path segments, which require URL-encoding. WebSocket
passes them as method parameters. The encoding-bug class disappeared
entirely on the transport switch.

### Why a 4-tier safety classification

A binary "destructive: yes/no" gate doesn't fit TrueNAS's surface.
`service_stop` is recoverable; `disk_wipe` is not. `dataset_delete`
needs an explicit human reason because mistakes are not recoverable
within the session. Most reads need no gate at all. The four tiers
map cleanly:

- **Tier 0 — never register.** 8 actions: reboot, shutdown, the raw-API
  escape hatch, cron and init/shutdown script creation. These cannot
  be made safe within an MCP session and the only correct answer is
  "do this through TrueNAS directly."
- **Tier 1 — confirm + reason.** 20 actions. `pool_export`,
  `disk_wipe`, `dataset_delete`, `snapshot_rollback`, `update_apply`,
  `bootenv_activate`, `system_config_download` (returns secret seed +
  encryption keys), `network_commit_changes` (could lock you out of
  the box). Two-call confirmation: first call returns a structured
  warning describing exactly what's about to happen; second call with
  `confirm: true` and a `reason` string actually runs it.
- **Tier 2 — confirm.** 81 actions. Service stop/restart, snapshot
  delete, share create/delete, user/group CRUD, certificate CRUD,
  cloud sync delete, etc. Recoverable but should not happen by
  accident.
- **Tier 3 — open.** 169 actions. All reads, all queries, safe creates
  (e.g. read-only `query_filters` operations).

The data lives in `src/safety.ts` and is enforced at registration. An
action with no tier assignment fails to register; the test suite
verifies the tier map matches the registered set on every CI run.

### Why centralized enforcement, not per-handler

Spranab's design puts `if (!confirm) return error` checks inside each
handler that wants confirmation. That works until someone adds a new
handler and forgets the check. There's no compile-time or test-time
signal that something was missed.

The registry approach is fail-closed: a new action ships in the
codebase, but if it's not in `ACTION_TIERS`, it doesn't register, and
the test suite (`safety-completeness.test.ts`) flags the missing
classification as a CI failure. The 32 in-handler `confirm` checks
that survived from upstream remain as defense in depth, but they are
not the primary gate.

### Why the API escape hatch was removed

Spranab's upstream had a `truenas_api_call` action that let the LLM
call any TrueNAS REST endpoint with arbitrary parameters. With that
present, every other safety gate becomes cosmetic — the LLM can route
around them by going to the raw API. Removed entirely; not even a
tier 0 entry. If you need to call a method this server doesn't expose,
add it deliberately and classify it.

### Why response filtering is post-call, not pre-call

The redaction is about what reaches the LLM context, not what reaches
TrueNAS. A pre-call filter would need to know every method's
parameter shape; a post-call filter only needs to know field names,
which is a much smaller surface. The filter is recursive (handles
nested objects and arrays), and the layered matcher (exact + suffix +
allowlist) emerged because exact-only matching missed flat names like
`certificate_private_key`, while pure suffix matching over-redacted
benign identifiers like `pool_key`.

For full architecture detail, see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Security posture

The threat model assumes the LLM operator is not malicious but **is** a
privileged operator who will execute whatever the model decides to
execute, and the model is fallible. Guardrails are sized to that
assumption, not to "the model is adversarial" (which is a different and
much harder problem).

Concretely:

- **Destructive actions are gated** at the registry layer — see safety
  tiers above. The two-call confirmation flow forces an explicit
  acknowledgment from the calling agent before tier 1 or tier 2
  actions execute.
- **Path validation** runs at the handler boundary on every
  filesystem-touching action (23 sites): paths must start with
  `/mnt/`, no `..` traversal, no null bytes. ZFS dataset names go
  through a separate validator (3 sites): a restricted character set,
  no `..`, no null bytes, max length 255.
- **Schema validation** wraps every handler. Zod schemas reject
  malformed parameters before any TrueNAS call is made. High-risk
  methods (`pool.create`, `system.general.update`, `replication.create`,
  `vm.create`, `interface.create`, `disk.wipe`) have tightened enums
  and patterns instead of permissive `Record<string, unknown>`.
- **Response filtering** strips passwords, private keys, tokens,
  recovery codes, salts, and similar fields from every handler return
  before it reaches the LLM. The allowlist preserves public-key
  material (which is access-control-relevant but not secret) so
  `user.query` reads still surface SSH public keys.
- **Per-connection TLS settings.** No `process.env.NODE_TLS_REJECT_UNAUTHORIZED`
  mutation. The `verifySsl` flag is a per-connection option on the
  WebSocket library, scoped to this server's connections only.
- **No raw-API escape hatch.** Removed from the upstream surface.

For full threat model, supported versions, and vulnerability disclosure
process, see [`SECURITY.md`](SECURITY.md).

---

## Comparison to alternatives

Short version (full detail in [`COMPARISON.md`](COMPARISON.md)):

| | sr-truenas-mcp | spranab/truenas-mcp | truenas/truenas-mcp |
|---|---|---|---|
| **Transport** | WebSocket | REST | WebSocket |
| **Action coverage** | 270 (17 categories) | ~278 (18 categories) | 52 flat tools |
| **ZFS dataset ops** | Full CRUD + snapshots | Full CRUD + snapshots | `create_dataset` and `query_datasets` only |
| **Safety model** | 4-tier, centralized | Per-handler `confirm` | Dry-run preview |
| **Response filtering** | Centralized 3-layer | None | Per-handler hand-crafted masking |
| **Tests / CI** | 211 / yes | 0 / no | 27 / yes |
| **License** | PolyForm-NC 1.0.0 | MIT | GPL-3.0 |
| **Status** | v1.0.0 | Single-shot publication (2 commits) | "Research Preview" |

Each project optimizes for different things. The official version has
better wizard-style UX and ships cross-platform binaries (macOS / Windows
/ Linux); sr-truenas-mcp ships Linux-only and trades that for breadth +
safety surface. If `create_dataset` is all you need, the official one is
the right choice.

---

## Development approach

### Requirements I set, and the patterns that satisfied them

Two kinds of decisions shaped this codebase: requirements I brought
to the project as a sysadmin, and the specific architectural patterns
that satisfied those requirements. The distinction matters because
the patterns were developed collaboratively with AI tooling
(Claude Code); the requirements are mine and predate the
implementation.

**Strategic: fork rather than upstream contribution.** Spranab's repo
is two commits on a single day in March 2026, no tests, no CI, no
ongoing maintenance. The changes the project needed (transport rewrite,
safety classification, validation, response filtering, test suite)
were too large to land as a series of PRs into a project with no
review process. A fork preserves the inherited architecture (which is
good) while letting the safety surface evolve at the pace of an active
development cycle.

**Strategic: WebSocket transport over REST.** REST API v2.0 isn't in
the current TrueNAS docs; the iXsystems-published MCP server is
wss-only with active rejection of unencrypted `ws://`. That's the
direction signal; staying on REST would have been swimming against
it. The migration also eliminated a whole class of URL-encoding bugs.

**Requirement: destructive actions must be classified by remediation
cost, not by a binary destructive/non-destructive flag.** `service_stop`
(recoverable in 30 seconds) and `disk_wipe` (no recovery) should not
trigger the same confirmation. Most reads need no gate at all. The
**four-tier scheme** (`src/safety.ts`) that satisfies this requirement
was developed collaboratively — three or five tiers were also viable;
four was the resolution.

**Requirement: the safety gate must fail closed.** A new action
shipping without a classification must not silently become callable.
Per-handler `if (!confirm)` checks (the upstream pattern) don't have
this property — a handler can be added without the check and nothing
catches it. The **registry-layer enforcement pattern** that satisfies
this — gate sits at registration, unclassified actions throw,
`safety-completeness` test asserts no drift on every CI run — was
developed collaboratively. Middleware, decorator, and
configuration-driven approaches were also considered.

**Requirement: no escape hatch the LLM can route around.** The
upstream `truenas_api_call` action let the model call any TrueNAS
endpoint with arbitrary params. With it present, every other safety
gate becomes cosmetic. Non-negotiable: it had to be removed
entirely — not gated, not env-flagged, not even a tier 0 entry. The
implementation is straightforward (delete the action and its
namespace); the requirement is the load-bearing piece.

**Requirement: secrets must not reach the LLM context, and the
filter must not over-redact benign identifiers.** Pre-call parameter
filtering doesn't address response-side leakage, which is the
dominant concern. Per-handler hand-crafted masking (the iXsystems
approach) has the same fail-closed problem as per-handler
`confirm` — a new handler ships with no masking. The
**post-call layered matcher** (exact keys + suffix patterns +
`NEVER_REDACT` allowlist) in `src/filters.ts` was the pattern that
emerged from collaboration. The layering specifically resolves two
real bugs: pure exact matching missed `certificate_private_key` (and
similar flat names), and pure suffix matching like `_key$`
over-redacted benign identifiers like `pool_key`, `id_key`,
`vdev_key`. The allowlist won't be obvious until you hit the
over-redaction; it took an audit pass to discover.

### Things that came out of the audit pass

A few specific issues caught during a pre-release audit, illustrative
of the kind of bugs that ship in MCP servers when nobody is looking.
The bugs were found and fixed during the collaborative implementation
work, not by line-by-line code review on my part:

- **Late-response race in the WebSocket client.** A request times out;
  the caller's promise rejects via the timer. Then the server response
  arrives. The message handler called `resolve()` on a settled promise,
  which produced an unhandled rejection. Fixed by adding a `settled`
  flag on each pending request and routing both timer and message
  paths through a single `settlePending()` state-transition function.
- **Send-error orphan.** `ws.send` runs the error callback async; the
  pending Map entry was being added after the send call, so an
  immediate send error fired the callback before the pending entry
  existed. Fixed by adding to the Map first, sending second, with
  `try/catch` around synchronous send errors.
- **Reconnect dropped idempotent callers needlessly.** Original
  reconnect logic rejected every in-flight request on disconnect. Read
  methods (`*.query`, `*.get_instance`, `*.config`, `core.get_jobs`)
  are idempotent and could safely retry post-reconnect; only writes
  needed to fail. Now that's an explicit policy with a typed
  `ReconnectAborted` error for the non-retryable cases.
- **`system.general.update` schema was `Record<string, unknown>`.**
  Strict object schema with `.strict()` rejects unknown keys. TrueNAS
  occasionally adds undocumented fields between releases; better to
  fail visibly and update the schema than to silently accept.
- **Filter audit found 12+ missing sensitive field names** that
  upstream had been quietly leaking — `auth_token`, `reconnect_token`,
  `host_key`, `bind_password`, `recovery_codes`, plus the suffix
  matcher catch-all for the `*_private_key` family.

### Doc-source-of-truth gate

`src/__tests__/doc-sync.test.ts` reads the numerical claims in the
project's CLAUDE.md (filter pattern counts, per-tier action counts,
validate-call-site counts) and asserts they match what's actually in
the source. CI fails if anyone edits `src/filters.ts` without updating
the docs. `npm run audit:counts` produces the same numbers manually
when developing. The requirement was "stale documentation is one of
the most common failure modes in homelab tooling and I want a forcing
function rather than discipline"; the specific test-driven
implementation of that forcing function was developed collaboratively.

### How the work was actually done

Project requirements and safety non-negotiables — destructive actions
must be classified and gated, the system must fail closed, no escape
hatches that route around the gates, secrets must not reach the LLM
context — were set by me from a sysadmin's perspective. The specific
architectural patterns that satisfy those requirements (the four-tier
classification, registry-layer enforcement, post-call layered response
filter) were developed collaboratively with AI tooling (Claude Code).
Code was reviewed at the architectural and behavioral level rather
than line-by-line; the test suite (211 tests across 12 files), the
fail-closed registration gate, and the doc-sync CI gate exist partly
to compensate for that review model. Architectural and behavioral
correctness has been verified; mechanical line-level review of every
diff has not, and that's a deliberate trade-off — the project shipped
in 16 days instead of six months.

The outcome of this trade-off is auditable: the test suite is in
`src/__tests__/`, the safety classification is a pure data file at
`src/safety.ts`, the response filter is a 169-line pure function at
`src/filters.ts`, and the CI gates are in `.github/workflows/`. None
of those are hidden behind abstractions; a reviewer who wants to
verify any architectural claim in this README can do so against the
source in minutes.

---

## Contributing

Issues and bug reports welcome via [GitHub Issues](https://github.com/staticrevolution-com/sr-truenas-mcp/issues).
For feature work, please open an issue first to discuss scope before
sending a PR — the action surface and safety classifications are
opinionated and I want to make sure proposed changes fit.

Contributors agree to license their contributions under the project's
PolyForm Noncommercial 1.0.0 license. By submitting a PR you confirm
you have the right to do so. See [`CONTRIBUTING.md`](CONTRIBUTING.md)
for details.

---

## License

[**PolyForm Noncommercial 1.0.0**](LICENSE) — a source-available license
that permits free use for personal, hobbyist, educational, charitable,
governmental, and research purposes. It is not OSI-approved open source;
that is intentional.

Commercial use — including use in for-profit business operations, in a
commercial product or service, or use that produces revenue — requires a
separate paid commercial license. Email **admin@staticrevolution.com**.

`NOTICES` preserves the upstream MIT attribution from
[spranab/truenas-mcp](https://github.com/spranab/truenas-mcp), which is
required for distributions of this project.

---

## About the author

[Warren Kelly](https://www.linkedin.com/in/warren-kelly-18258479/) /
[Static Revolution](https://staticrevolution.com) — senior systems
administrator with a background in MDM, SSO, IAM, infrastructure, and
automation. This project came out of needing a tool good enough to let
agents I trust manage a NAS I rely on, and not finding one that fit.

GitHub: [whasamatau](https://github.com/whasamatau) ·
Email: `admin@staticrevolution.com`

---

## Acknowledgments

Forked from [spranab/truenas-mcp](https://github.com/spranab/truenas-mcp).
Hardening, the WebSocket JSON-RPC migration, and ongoing development was
done with assistance from Anthropic's Claude.
