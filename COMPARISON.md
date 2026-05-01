# sr-truenas-mcp — Comparison to alternatives

This document compares **sr-truenas-mcp** to other publicly available MCP servers
for TrueNAS SCALE. It exists so users can decide which project fits their needs,
and so the trade-offs in sr-truenas-mcp's design are visible.

The two alternatives evaluated:

- **[spranab/truenas-mcp](https://github.com/spranab/truenas-mcp)** — the upstream
  project that sr-truenas-mcp was forked from (MIT, TypeScript, REST transport).
- **[truenas/truenas-mcp](https://github.com/truenas/truenas-mcp)** — the
  first-party MCP server published by iXsystems (GPL-3.0, Go, WebSocket transport),
  flagged as a Research Preview in its README.

> **Note on a third project sometimes mentioned in this space.**
> `dariusbakunas/truenas-mcp` does not exist. The author maintains a
> [TrueNAS Go SDK](https://github.com/dariusbakunas/truenas-go-sdk) and a
> [Terraform provider for TrueNAS](https://github.com/dariusbakunas/terraform-provider-truenas);
> neither is an MCP server. The Go-language MCP server in this ecosystem is the
> official iXsystems one above.

All findings below were derived from the public GitHub repositories on
**2026-04-29** without cloning or running any project. Every claim links to a
URL or commit hash. Anything that could not be confirmed from public sources is
flagged **VERIFY** so a future reader (and the author) can re-check before
relying on it.

---

## Summary

<!-- README-LIFT-START -->

A short version suitable for the README:

| | sr-truenas-mcp | spranab/truenas-mcp | truenas/truenas-mcp |
|---|---|---|---|
| **Language / runtime** | TypeScript (Node.js 20, ~55MB single-file Linux binary) | TypeScript (Node.js) | Go (cross-platform binaries) |
| **Transport** | WebSocket (`wss://`, JSON-RPC 2.0 / DDP) | REST (`https://`, Bearer token) | WebSocket (`wss://` only — `ws://` revokes the API key) |
| **Action coverage** | 270 actions, 17 categories | ~278 actions, 18 categories | 52 tools, flat |
| **MCP tool model** | Single hierarchical `truenas` tool with discovery modes | Single hierarchical `truenas` tool with discovery modes | 52 separate MCP tools (flat `tools/list`) |
| **ZFS dataset ops** | Create, delete, update, snapshot CRUD, rollback, set-properties, permissions, ACLs | Create, delete, update, snapshot CRUD, rollback (verify per-action) | `create_dataset` and `query_datasets` only |
| **Replication / cloud sync / cloud backup** | Yes | Yes | None |
| **iSCSI / certificates / users / groups / cron** | Yes | Yes | None |
| **Destructive-action safety** | 4-tier classification, two-phase confirm, fail-closed registration | Per-handler `if (!confirm)` checks | Dry-run mode (preview before execute) |
| **Response filtering for secrets** | Centralized 3-layer filter (57 exact + 9 suffix + 15-entry allowlist) | None | Per-handler hand-crafted masking |
| **Path & dataset-name validation** | Centralized validators on every filesystem and ZFS-side handler | None | None visible at the helper level |
| **Tests** | 211 (Vitest), 12 test files | None | 27 (Go test), 6 test files |
| **CI** | Yes (build + test + audit) | None | Yes (build + test + cross-platform release) |
| **License** | PolyForm Noncommercial 1.0.0 (source-available, free for non-commercial use) | MIT | GPL-3.0 |
| **Status** | Released — v1.0.0 | Single-shot publication (2 commits, 2026-03-31) | "Research Preview — not recommended for production use" |

**When to choose which:**

- **sr-truenas-mcp** if you want the broadest TrueNAS coverage *and* the safety
  surface to expose it to an LLM (tier-gated destructive actions, secret
  redaction, path validation) — and the licensing terms work for you.
- **spranab/truenas-mcp** if you want comparable breadth on REST and don't need
  the safety surface, the test suite, or ongoing maintenance.
- **truenas/truenas-mcp** if you want the first-party implementation and your
  workflows fit the 52 wizard-shaped tools (apps, capacity planning, basic
  share creation). Their dataset/share/replication coverage is intentionally
  narrow.

<!-- README-LIFT-END -->

---

## Method

What was compared:

- README content
- LICENSE file
- Source files (selected — registry, transport client, tool modules)
- `package.json` / `go.mod`
- GitHub commit history, release tags, issue/PR counts via the GitHub REST API
- CI workflow files (`.github/workflows/*.yml`)

What was **not** done:

- No project was cloned, built, or run.
- No prompt-token measurements were taken (the "single tool vs flat list"
  trade-off is described architecturally; the order-of-magnitude saving is real,
  but no benchmark numbers in this document came from running anything).
- No formal test-coverage measurements (test count comes from
  `npx vitest run` for sr-truenas-mcp and from counting `func Test*` in the
  official Go repo).

For sr-truenas-mcp's own numbers, the source-of-truth command is
`npm run audit:counts`, which prints structural counts pulled from the live
source files and is wired into CI.

---

## sr-truenas-mcp vs spranab/truenas-mcp (upstream fork lineage)

sr-truenas-mcp is a fork of [spranab/truenas-mcp](https://github.com/spranab/truenas-mcp).
The architecture (single hierarchical `truenas` MCP tool with three discovery
modes — list categories, list actions, execute) and the module layout
(`alert/filesystem/network/replication/sharing/storage/system/vm`) are
inherited directly. The differentiation is in transport, safety surface,
test coverage, and ongoing maintenance.

### What was inherited

- Single-tool / hierarchical-discovery architecture. The `tools/list` MCP
  response contains one entry, not 270+. Action discovery happens at runtime
  via the `truenas` tool's `mode: "list"` calls. This avoids loading the full
  schema surface into the model's context on every turn.
- Module structure under `src/tools/`.

### What was changed

#### Transport: REST → WebSocket

Spranab uses [`fetch()` against the TrueNAS REST API v2.0 with
`Authorization: Bearer ${apiKey}`](https://github.com/spranab/truenas-mcp/blob/master/src/client.ts).
sr-truenas-mcp connects to `wss://{host}/websocket` using TrueNAS's
DDP-over-WebSocket protocol and authenticates via `auth.login_with_api_key`.

The motivation: WebSocket is the canonical transport on modern TrueNAS SCALE
middleware. The official iXsystems MCP server is wss-only and explicitly
[refuses to allow `ws://`, with the API key being revoked if used over an
unencrypted connection](https://github.com/truenas/truenas-mcp/blob/main/README.md).
That is a strong signal about which transport is the long-term path.

#### Safety surface

Spranab has per-handler `if (!confirm) return error` checks scattered across
individual tool handlers — for example, in
[`src/tools/system.ts:42-46`](https://github.com/spranab/truenas-mcp/blob/master/src/tools/system.ts).
There is no centralized list of which actions are destructive, no tier
classification, no secret redaction, no path validation. A new contributor
adding an action could omit the `confirm` check silently — there's nothing to
fail-close on at registration.

sr-truenas-mcp adds:

- **`src/safety.ts`** — pure data file mapping every action to a tier
  (0 = blocked, 1 = confirm + reason, 2 = confirm, 3 = open). Unclassified
  actions are rejected at registration. Source for the counts:
  `npm run audit:counts`.
- **Two-phase confirmation flow** for tier 1/2 — the first call returns a
  detailed warning as MCP content describing what will be executed; the second
  call with `confirm: true` (and `reason` for tier 1) actually runs.
- **`src/filters.ts`** — centralized 3-layer secret redaction: 57 exact key
  matches (e.g. `password`, `privatekey`, `unixhash`, `salt`, `bindpw`,
  `recovery_codes`), 9 suffix patterns (`_password$`, `_token$`, `_secret$`,
  …), and a 15-entry `NEVER_REDACT` allowlist that preserves benign `*_key`
  identifiers like `id_key`, `pool_key`, `vdev_key`. Applied to every handler
  return and every MCP Resource.
- **`src/validation.ts`** — `validateTrueNASPath` (every filesystem-touching
  handler — must start with `/mnt/`, no `..`, no null bytes) and
  `validateDatasetName` (every ZFS-side handler — charset
  `[a-zA-Z0-9._:/-]`, max 255 chars, no `..`, no null bytes).
- **Runtime Zod validation** wrapping every handler.

The audit tool (`npm run audit:counts`) prints the current numbers.

#### Test coverage

Spranab's repo has no test files, no `test` script in `package.json`, and no
test-framework dependency
([repo root listing](https://github.com/spranab/truenas-mcp)).

sr-truenas-mcp ships **211 tests across 12 test files** (Vitest). CI runs the
full suite plus `tsc --noEmit` and `npm audit` on every push.

#### Maintenance state

Spranab's repo has 2 commits, both on 2026-03-31, and no commits since. The
GitHub metadata shows 0 issues, 0 PRs ever. No CI workflow files. Effectively
a single-shot publication.

### Lineage and license

sr-truenas-mcp's release license is **PolyForm Noncommercial 1.0.0**.
spranab/truenas-mcp is **MIT**, which permits the relicensing of derivative
works under stricter terms but requires the original copyright notice and
license text to be preserved. sr-truenas-mcp ships a `NOTICES` file
reproducing spranab's MIT license text and copyright in full, alongside the
PolyForm Noncommercial `LICENSE`. Section 2 of the public-release plan
covers this.

---

## sr-truenas-mcp vs truenas/truenas-mcp (official iXsystems)

The official version is a small, opinionated MCP server from iXsystems,
written in Go and published as a "Research Preview." It is the right starting
point for many users — it has a real CI/release pipeline, cross-platform
binaries, and excellent UX in the areas it covers. The two projects are
optimizing for different things.

The data below is from
[truenas/truenas-mcp on `main`](https://github.com/truenas/truenas-mcp) as of
2026-04-29 (last commit
[`fc9fded`](https://github.com/truenas/truenas-mcp/commit/fc9fded), 2026-03-06).

### What's IN the official implementation

These are real strengths and worth knowing about — sr-truenas-mcp does not
attempt to claim differentiation in any of these areas:

- **Wizard-style tool descriptions.** The `create_dataset` and
  `create_smb_share` tool descriptions in
  [`tools/registry.go`](https://github.com/truenas/truenas-mcp/blob/main/tools/registry.go)
  are extensive (>1500 words each) and walk the LLM through a structured Q&A
  flow (Pool Selection → Dataset Name → Share Type → Encryption → Compression).
  A user who asks Claude "create me an SMB share with Time Machine support"
  gets a guided, opinionated experience.
- **Dry-run mode.** The
  [`tools/dryrun.go`](https://github.com/truenas/truenas-mcp/blob/main/tools/dryrun.go)
  `DryRunnable` interface produces a structured preview (`PlannedActions`,
  `Warnings`, `Requirements`, `EstimatedTime`) when the caller passes
  `dry_run: true`. This is a different shape of safety from sr-truenas-mcp's
  two-phase confirm and is complementary, not competing.
- **MCP Tasks specification** for long-running operations
  ([`tasks/manager.go`](https://github.com/truenas/truenas-mcp/blob/main/tasks/manager.go),
  `poller.go`, `store.go`). Returns `task_id` immediately; client polls
  `tasks_get`. This is more async-native than sr-truenas-mcp's synchronous
  job polling and aligns with current MCP spec direction.
- **Capacity planning analytics** (`analyze_capacity`) — historical-trend +
  projection analysis with thresholds (70/85% warning/critical), trend
  detection, growth projections.
- **App installation wizard** with strict opinions: "ALWAYS uses host-path
  volumes (NEVER ix-volumes), enforces structured dataset layout
  `/mnt/<pool>/apps/<appname>/<volume>`."
- **Cross-platform binary distribution** — macOS arm64/amd64, Linux amd64,
  Windows amd64. sr-truenas-mcp ships Linux x64 only. This is a real
  differentiator for users who want to run the MCP on their workstation
  rather than on the TrueNAS itself.
- **Real CI/release pipeline.**
  [`.github/workflows/build.yml`](https://github.com/truenas/truenas-mcp/blob/main/.github/workflows/build.yml)
  runs lint and test on push/PR;
  [`.github/workflows/release.yml`](https://github.com/truenas/truenas-mcp/blob/main/.github/workflows/release.yml)
  builds cross-platform binaries, packages tar.gz/zip, and generates
  checksums on tag push.

### What's NOT in the official implementation that sr-truenas-mcp covers

Verified absent from the
[`tools/registry.go`](https://github.com/truenas/truenas-mcp/blob/main/tools/registry.go)
tool enumeration:

- **ZFS dataset operations.** Only `create_dataset` and `query_datasets`. No
  delete, update, rename, set-properties, mount/unmount, promote, or any
  snapshot operations (no create / delete / clone / rollback / hold).
- **Pool lifecycle.** Only query + capacity-details + scrub. No create,
  destroy, import, export, replace, offline, online, clear, attach, detach.
- **iSCSI.** Zero coverage. No targets, extents, portals, initiators, or
  groups.
- **User and group management.** Directory service join (AD/LDAP) is supported,
  but no local user/group CRUD.
- **Certificate management.** No `certificate.*`, no ACME, no DNS authenticators.
- **Replication, cloud sync, cloud backup, rsync tasks, periodic snapshot tasks.**
- **SSH credentials, init/shutdown scripts, tunables, cron jobs.**
- **Filesystem permission / ACL setting.** No `setperm`, `setacl`, `chown`.
- **Service-specific configs** beyond directory services — no SSH, FTP, SNMP,
  UPS configuration tools.
- **Network interface management.** No interface, route, IPMI, or global
  config tools.
- **Audit log access** and **API-key management.**
- **Share update or deletion.** Only `create_smb_share` and `create_nfs_share`;
  no edit or delete.

This is a 52-vs-270 functional-coverage delta. The official version is
intentionally narrow ("we picked the things you most often ask Claude to help
with"); sr-truenas-mcp is intentionally exhaustive and adds the safety surface
to make exhaustiveness manageable.

### Differences in safety architecture

Both projects take safety seriously, just differently:

| Concern | truenas/truenas-mcp | sr-truenas-mcp |
|---|---|---|
| Preview before destructive action | `dry_run: true` returns structured preview from the same call | Two-phase: first call returns warning text; second call with `confirm: true` (+ `reason` for tier 1) executes |
| Action classification | None centralized; each tool decides whether to support dry-run | 4-tier map in `src/safety.ts`; tier 0 actions never registered, tier 1 require `reason`, tier 2 require `confirm`, tier 3 open |
| Secret redaction | Per-handler hand-crafted masking (e.g. `query_directory_services` masks passwords/keytabs, `query_vms` excludes "display passwords") | Centralized `filterSensitiveFields` applied to every return — handlers cannot forget |
| Path validation | No central helper visible at the file structure level **VERIFY** | `validateTrueNASPath` enforced on every filesystem-touching handler; `validateDatasetName` enforced on every ZFS-side handler |
| Failure mode for new handlers | New tool with no masking ships with no masking; no enforcement | New action with no tier ships unable to register; CI runs `npm run audit:counts` to keep numbers honest |

Neither approach is strictly better. Dry-run is simpler and gives the LLM
immediate insight without a second round-trip; two-phase confirm forces an
explicit human acknowledgment, which is the property the sr-truenas-mcp
threat model required.

### License compatibility

The official version is GPL-3.0. sr-truenas-mcp is PolyForm Noncommercial 1.0.0.
The two are not source-compatible — code cannot be moved between them in
either direction. **No code from `truenas/truenas-mcp` is or has been
incorporated into sr-truenas-mcp**: the projects are in different languages,
the architectures are different (flat vs hierarchical), and the safety surface
was authored independently. API-shape inspiration is fine; no IP risk.

---

## Items flagged for verification before publication

These items are based on author claims or limited code reads. None are
suspected to be wrong, but they should be re-checked before public release:

- **TrueNAS SCALE compatibility ranges.** All three projects make
  README-level claims about which SCALE versions they support; none ship a
  test matrix. Cite their claims verbatim, or run a compat test pass
  before publishing a stronger statement.
- **"No central path validation in truenas/truenas-mcp."** Based on the
  absence of a `validation.go` or equivalent file in the repo and the
  per-handler nature of the masking they do have. Not exhaustively grepped
  across all 183 KB of `tools/registry.go`.
- **"No central response filter in truenas/truenas-mcp."** Same caveat —
  evidence is the absence of a `filters.go` / `redact.go` and the presence
  of inline mask comments per tool. High confidence, not exhaustive.
- **The "single hierarchical tool saves prompt tokens vs a flat 50-tool
  list" claim.** The architectural difference is real and verifiable from
  the source. The actual token-count saving has not been measured in this
  document. If a number is needed for marketing, capture an actual MCP
  `tools/list` response from each project and compare.
- **`sr-truenas-mcp` `package.json` license field still says `MIT`.**
  Section 2 of the release plan switches it to PolyForm Noncommercial 1.0.0.
  Until that lands, this document's references to the target license are
  forward-looking.
- **Cosmetic drift.** `src/index.ts:36-37` describes the server as
  "278 tools behind a single hierarchical interface." The effective
  discoverable count is 270 (tier 0 actions are silently dropped at
  registration). Worth aligning before public release.
