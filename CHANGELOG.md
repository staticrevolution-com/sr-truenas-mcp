# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] — filesystem_listdir

⚠ **Version unassigned; several PRs are in flight off `master`.** This carries a
**breaking response-shape change** and warrants a minor.

### Fixed

- **`filesystem_listdir` silently returned a partial directory listing.** It
  applied a default `limit: 100` and hardcoded the middleware filter slot to
  `[]`. **Measured 2026-09-26** on a 231-entry directory: it returned exactly
  100 entries, **in readdir order rather than sorted**, with nothing in the
  response indicating anything had been withheld. Because the action declared
  no filter parameter, any `query_filters` a caller supplied were dropped by the
  registry's `.strip()` before reaching the handler.

  🔑 **This is the `snapshot_list` defect in a different organ: correct iff what
  you wanted happened to fall inside the first 100 entries.** It is worse here,
  because the natural next step after listing a directory is to conclude
  something is **not there** — and a short answer reads as an answer, with no
  error to notice. A caller deciding whether to create, delete or skip got a
  confident wrong answer, and `filesystem_stat` on an entry missing from the
  listing returns a real directory.

  Both halves were **ours**, confirmed by reading `src/tools/filesystem.ts`
  before blaming middleware — the lesson from `snapshot_list`. Middleware
  honours filters correctly (verified: a server-side filter on the same
  directory returns 2 of 231).

### Changed — BREAKING

- **`filesystem_listdir` now returns an envelope**, not a bare array:
  `{ path, count, truncated, next_offset, warning?, entries }`.

  A silent partial answer cannot be made safe while the response shape has
  nowhere to say so. Truncation is detected by over-fetching exactly one entry
  beyond the caller's limit, so `truncated` is a measurement rather than a
  guess, and `next_offset` advertises the continuation.

  ⚠ Note this is a deliberately *different* decision from leaving
  `dataset_get`'s default shape alone in the sibling PR. That was a **response
  size** problem — a usability cost. This is a **correctness** problem: a wrong
  answer that reads as a right one. Breaking the shape is justified for the
  second and not the first.

- **`query_filters` is now a parameter**, applied server-side by middlewared
  *before* the limit — so filtering is not defeated by truncation.

### Verified live

Against the 231-entry directory that produced the report:

```
default          count=100 truncated=true  next_offset=100
limit=1000       count=231 truncated=false
server filter    count=2
paged via next_offset  231 rows, 231 unique, matches full listing
negative control count=0  truncated=false   (instrument discriminates)
```

### The danger, demonstrated

On the same directory, listing the Docker volume set — 14 compose-scoped
`gh-runners_runner-data-*` volumes among 231 entries:

```
default (100-entry) listing : 9 of 14 visible
full listing                : 14 of 14
INVISIBLE to the default    : homelab-1, sr-7, sr-3, homelab-2, sr-4
order                       : NOT sorted — readdir order
```

⚠ **`filesystem_stat` on one of the invisible five returns a real DIRECTORY.**
That is the whole defect in one line: the listing said a volume was not there,
and it was. Five of fourteen runners were unlistable, in an arbitrary order
that made the gap look like a complete answer.

### Note on the original report

Three of the four reported symptoms reproduce exactly — the 100-entry
truncation, the dropped filter, and the readdir-order gap (the reporter named
`sr-3`, `sr-4` and `sr-7` as missing from between `sr-2` and `sr-5`; all three
are in the invisible set above).

**The fourth — "`limit: 300` was also ignored" — does not reproduce.** An
explicit limit is honoured, then and now (`limit: 300` → 231 entries). The most
likely explanation is that the limit never reached the handler — a string
instead of a number, or nested where the registry's `.strip()` discarded it
silently. ⚠ **That is the same failure as the dropped filter, one parameter
over**, which makes the mechanism general rather than filter-specific: any
parameter an action does not declare, or declares with a different type, is
dropped without a word. Worth knowing beyond this action.

⚠ **Version deliberately unassigned.** Three PRs are in flight off `master`,
each of which would otherwise claim a number and conflict. This is
behaviour-changing across 36 actions and warrants a **minor**; assign it when
cutting the release.

### Fixed

- **36 actions reported an enqueue as an outcome.** A `@job` middleware method
  returns a job id — a bare integer — not a result. Handlers that returned it
  unchanged meant a **FAILED operation read as success**: `dataset_unlock` with
  a wrong passphrase, `certificate_create`, `tunable_create`, `app_delete` and
  32 more all answered with a number that looked like an id and meant nothing
  about whether the work succeeded.

  This defect was found and fixed for the filesystem handlers in **v1.1.1**. The
  wider sweep was recorded as a deferred follow-up in the 2026-06-12 field
  report and never run. Running it found 36 more call sites — 49 job calls
  exist in `src/tools/`, 10 were already correct, and 3 sit inside Tier-0
  blocked actions that are never registered.

  **The worst was not a destructive action but a read.**
  `dataset_encryption_summary` is a job whose *result is the answer*, so it
  returned an integer where a summary belonged. Verified live before and after:
  it now returns the real `{name, valid_key, locked, unlock_error, …}` record.

  Classification, and why it is not uniform:
  - **18 → `awaitJobResult`** — bounded work where the outcome is the point
    (`dataset_lock`/`unlock`/`encryption_summary`, `service_start`/`stop`/
    `restart`, the `tunable_*` and `certificate_*` pairs, `mail_send`,
    `vm_restart`, `app_start`/`stop`/`delete`,
    `directory_services_update`/`leave`).
  - **18 → `describeAsyncJob`** — genuinely long work (`pool_create`/`export`/
    `replace_disk`/`update`, `boot_scrub`/`attach_disk`, `update_download`,
    `cronjob_run`, `rsync_task_run`, the five image-pulling `app_*` actions,
    `directory_services_cache_refresh`, plus the two below).

  ⚠ **`docker_config_update` and `vm_stop` were reclassified from await to
  handle during review, on measurements this repo did not have.**
  `docker.update` re-initialises the apps pool and restarts the Docker daemon —
  against a store measured at **998.1 GB with 122 containers and 48,544
  overlay2 directories**, where anything that walks the tree is slow enough that
  `/system/df` times out. 300 s is not a safe bound there, and the false-failure
  case is the worst available: an operator reads "failed" on a pool migration
  that is still running, and retries it. `vm.stop` with `force: false` waits on
  **ACPI guest shutdown, which has no upper bound** — a hung guest never
  completes. Returning a handle for a long job is never wrong; awaiting one is
  wrong exactly when it matters most.

  ⚠ **Ambiguous cases default to `describeAsyncJob`, because the failure modes
  are asymmetric.** `awaitJobResult` uses `waitForJob`'s 300 s default, which
  does not merely block — it then **throws a false failure for a job that is
  still running and will very likely succeed**. On a `pool_update` topology
  change that is about the worst place to manufacture an error report.
  Mis-classifying fast work as async only costs verbosity. `pool_update` and
  `directory_services_cache_refresh` were moved to async on exactly that
  reasoning.

### Added

- **`src/job-methods.ts`** — the 101 `@job` methods published by TrueNAS
  26.0.0-BETA.1, captured from `core.get_methods`. This is the one fact here
  that cannot be re-derived offline, since job-ness belongs to the running
  middleware. Flagged in the file as decay-prone and due for re-capture against
  a new TrueNAS major.

- **`src/__tests__/job-wrapping.test.ts`** — gates the half that *is*
  derivable: every call to a method in that set must be wrapped. It also
  asserts `awaitJobResult` is always awaited and `describeAsyncJob` never is,
  derives the Tier-0 exclusion from `safety.ts` rather than hardcoding three
  names, and carries a positive control on its own scanner so a broken regex
  cannot make it pass vacuously. Mutation-verified against both failure modes.

### Known limitation

`describeAsyncJob` hands back a `job_id`, and **no registered action can poll
it** — nothing exposes `core.get_jobs`. That is unchanged by this release and
is still an improvement over a bare integer, but the handle is not yet usable
from this server.

A `job_get`/`job_list` action was designed and **deliberately not shipped**. A
job record embeds the calling credential, the *arguments* of the original call,
and free-text `error` / `exc_info` / `progress.description` fields in which
middlewared routinely includes the `repr()` of those arguments. The response
filter is a key-based denylist and cannot see a secret inside a string, so a
pass-through action would leak. `core.get_jobs` is also cross-principal — every
credential's jobs, not the caller's. Adding it safely means a field allowlist
projected in the handler, gated by a test asserting the projection is closed.
Recorded rather than quietly attempted.

## [1.4.0] — 2026-09-24

Five findings raised from an ep11 outage investigation (apps pool hit zero
bytes), plus one found while measuring them. Two new actions take the registered
surface from 273 to 275.

Evidence is stated per item, because these were not equally well-founded:
**measured** means reproduced against a live TrueNAS 26.0.0-BETA.1 host,
**indicated** means strongly suggested but not confirmed.

### Added

- **`filesystem_disk_usage` (tier 3)** — bounded directory-tree measurement, and
  deliberately **not** a recursive `du`. Every level costs a `filesystem.listdir`
  round-trip, and the directories worth asking about are exactly the ones big
  enough to make that intractable: `/mnt/.ix-apps/docker/overlay2` was **measured
  at 48,544 entries**, where counting them flat took 10.4 s and five paged calls
  and a full recursive walk is ~10⁵ round-trips. An action promising a recursive
  total would hang, or return a partial sum indistinguishable from a real one, on
  the one directory the caller most needs.

  So it spends a fixed entry/time budget and reports what it did not finish:
  `{ entries: 48544, recursive_allocation: null, truncated: true }`. That
  localises usage without pretending to size it. `stopped_because` separates
  "ran out of budget" from "hit the depth cap".

  ⚠ **The budget is per child, not global.** With a shared budget the largest
  subtree consumed all of it and every sibling afterwards returned
  `entries: 0, truncated: true` — including one that really held 231 entries.
  Zeroes for non-empty trees is precisely the failure this action exists to
  prevent, so one oversized subtree must never starve the siblings it is being
  compared against.

  Authoritative totals should come from ZFS, not from summing a walk — one
  source of truth beats two that can disagree.

- **`dataset_zfs_query` (tier 3)** — query ZFS resources directly, including
  datasets the `pool.dataset` API does not surface, with real on-disk accounting
  (`used`, `usedbydataset`, `usedbychildren`, `usedbysnapshots`, `available`).

### Fixed

- **`quota` vs `refquota` descriptions corrected.** Both said only "quota in
  bytes". `refquota` bounds **referenced data only** — it does not count
  snapshots or child datasets, so it does **not** bound what a dataset can take
  from the pool, and on a busy dataset it can return ENOSPC to the application
  while the pool still has free space. A reader reaching for a usage cap would
  have picked the wrong one; the descriptions now say which is which.

- **Hidden datasets are reachable, but only when you ask.** **Measured:**
  `pool.dataset.query` omits `data-pool/ix-apps` and its twelve children
  entirely — including the Docker root for every container on the host, holding
  ~998 GB — while `zfs.resource.query` returns them in full. An explicit
  `[["id","=",…]]` predicate returns `[]` and `get_instance` returns `[ENOENT]`.
  This is **upstream TrueNAS behaviour, not a gap in this server**: confirmed by
  first checking that this server does no filtering of its own, then going under
  the MCP straight to middleware. A dot-prefix rule is ruled out — `.ix-virt`
  *is* listed.

  ⚠ **`dataset_get` behaviour is deliberately UNCHANGED.** An earlier revision
  of this branch made it fall back to the ZFS namespace on ENOENT. That was
  re-scoped on review, for two reasons:

  1. Hidden-by-default is the operator's stated preference — internal datasets
     should not appear in ordinary enumeration.
  2. **ENOENT from `dataset_get` is a cross-repo contract.** sr-charm's
     dataset-conversion plan uses it as one of *three* independent absence
     proofs when verifying `pool.dataset.delete`, specifically below ~1 GB where
     pool-space deltas are noise. Softening it would make charm report a
     destroyed dataset as still present, and an operator would conclude a
     destroy had failed. The new `dataset_zfs_query` removes that coupling
     entirely rather than documenting around it.

- **Parameter errors name the key that was rejected, not just the one missing.**
  `dataset_get {"dataset": …}` reported only `id: expected string, received
  undefined`; Zod's `.strip()` had silently discarded `dataset`, so the actual
  mistake was invisible. Errors now list the ignored keys and the accepted ones.

- **`filesystem_listdir`'s `limit` is bounded client-side** at the server's
  maximum of 10,000. **Measured:** `limit: 200000` returned `[EAGAIN] [EINVAL]
  query_options: Value error, Options limit must be between 1 and 10000` — an
  opaque server error for a client-checkable mistake. Found while investigating
  the above.

### Documented

- **The sparse-file trap, on every action returning either field.** `size` is
  apparent length; `allocation_size` is bytes on disk. **Measured** under a
  Docker root: `metadata_v2.db` 320 MB apparent against 69 MB allocated, with
  ~1.1 GB apparent for ~175 MB real across three buildkit databases — an
  overstatement of up to **23x**, with nothing signalling it. A session nearly
  concluded buildkit metadata was material on that basis.

- **`dataset_get` can return an enormous response**, and now offers `fields` and
  `include_children` to avoid it. **Measured:** 571,342 characters for a parent
  with many children, roughly 4,000x what a caller wanting `used` and
  `available` needs; the `children` array dominates. **The default is
  unchanged** — narrowing it would silently alter the shape existing consumers
  read, and the consumer set is not known from this repo. Changing the default
  is a deliberate non-decision left to the operator.

### Fixed after independent review

- **`max_entries` did not bound the work it claimed to bound.** The per-child
  budget carried a `Math.max(1_000, …)` floor, so many children multiplied the
  cap instead of dividing it — **measured at 45x** (50 children, `max_entries:
  1000`, `entries_scanned: 45,050`), with the response reporting the
  honoured-looking limit and the overrun in the same object. Worse, clamping
  the floor alone was not enough: a budget of 19 still pulled a whole page, so
  the page size is now clamped to the remaining budget too — **the budget must
  bound the request, not merely gate whether one is made.** Children reached
  after exhaustion are recorded as unmeasured rather than walked anyway.
  Gated by an `entries_scanned <= max_entries` assertion, which is the
  assertion whose absence let this through.
- **An unreadable subtree reported `stopped_because: "budget"`**, telling the
  operator to raise a limit that would never help. EACCES, a vanished path and
  a transport error now report `"error"`.
- **A non-array response was treated as an empty, complete directory** — the
  emptiness-is-not-health shape this module exists to avoid. Now truncated.
- **`CLAUDE.md` said `dataset_get` falls back to the ZFS namespace** and that
  its ENOENT means "not surfaced, not necessarily absent" — the exact opposite
  of the re-scoped code, the CHANGELOG and the test, in the file every session
  reads first, contradicting a cross-repo contract the rest of the PR protects.
  Leftover text from the earlier revision.
- **The cross-repo-contract test could go vacuous** — its source slice would be
  empty if the two tools were reordered in `storage.ts`, silently passing the
  one test guarding a destructive verification in another repo.

### Verified

All of the above exercised against a live 26.0.0-BETA.1 host. `dataset_get`
returned the ZFS record for the hidden dataset in 0.7 s; `dataset_zfs_query`
enumerated 13 resources; `filesystem_disk_usage` on the Docker root completed
`containers` (1,194 entries, 1,464 MB) and `buildkit` (463 entries, **181.7 MB**
— independently corroborating the sparse-file finding from the allocation side)
while correctly truncating `overlay2`, `image` and `volumes`.

⚠ **Not established:** that the 48,544 overlay2 directories are *orphaned* layers.
That is **indicated, not measured** — entry counts are not sizes, and the bytes
are not attributed between `overlay2` and `volumes`. A layer-to-image
reconciliation would confirm it.

## [1.3.1] — 2026-09-25

Dependency security. No action-surface change; no behaviour change to any
TrueNAS call.

### Fixed

- **Renovate had opened zero PRs on this repository, ever.** `renovate.json`
  extended `github>staticrevolution-com/renovate-config`, which is **private**
  while this repository is **public** — the hosted Renovate app will not read a
  private preset for a public consumer, so it halted "as a precaution" on
  2026-08-21 and stayed silent (issue #14).

  ⚠ It fails toward the reassuring answer: **no PRs looks exactly like nothing
  to update.** Five weeks later the tree carried 16 advisories.

  The decisive control: the *identical* preset string resolves fine in the
  org's private repos, which received Renovate PRs on 2026-09-15 and
  2026-09-23 — after the failure here. Repository visibility is the only
  variable that differs. Granting the app access to the preset repo is
  therefore not the fix; it already has it.

  The preset is now **inlined**, scoped to npm and GitHub Actions. That is
  smaller *and* more correct than what it replaces: the shared preset is
  overwhelmingly Docker-datasource rules and this repository has no compose
  files. Publishing the preset instead was rejected — its descriptions name
  internal services and incident documents.

- **16 advisories → 2.** Both criticals and all seven highs cleared by
  `npm audit fix` (no `--force`, no code change):
  - **`ws` 8.20.0 → 8.21.3** — the WebSocket transport under *every* TrueNAS
    call. The blocking advisory is the memory-exhaustion DoS
    (`GHSA-96hv-2xvq-fx4p`, fixed 8.21.0), not the uninitialized-memory
    disclosure, which is moderate and was already fixed in 8.20.1. A minor
    bump inside the existing `^8.18.0` range; `src/client.ts` uses only stable
    8.x API and the suite passes unchanged.
  - **`vitest` 3.2.4 → 3.2.7** — clears the critical UI-server file read.

  The two remaining advisories are one dev-only moderate requiring a vitest
  major. Left deliberately: a major bump of the test runner to clear a
  build-host advisory is a worse trade than the advisory.

### Added

- **A dependency-audit job in CI, which is the actual fix.** Blocking on
  `npm audit --omit=dev --audit-level=high` — the runtime tree, i.e. what
  ships in the npm package and the GHCR image — plus a non-blocking full-tree
  report in the run summary.

  Scoped to the runtime tree on purpose: gating on devDependency advisories
  fails the build for a test-runner CVE that cannot reach production, and a
  gate that cries wolf is one somebody adds `continue-on-error` to.

  ⚠ If a genuinely unreachable advisory ever blocks a release, **do not relax
  the level to `critical`** — that silently drops the whole `high` class,
  including the `ws` advisory this job exists for. Add a dated `overrides`
  entry so the exception stays visible. There is a test asserting this.

- **A weekly schedule on CI.** A push-triggered audit cannot see an advisory
  published against unchanged code, which is how most of this risk arrives.

- **`npm run type-check` in CI.** It was never there despite being documented.

- **`src/__tests__/ci-claims.test.ts`** — gates the claims the docs make about
  CI, by re-deriving them from `ci.yml`. Mutation-verified: relaxing the audit
  threshold to `critical` trips two assertions.

### Fixed after independent review

- **`maxFragments: 0` pinned on the WebSocket client.** ws 8.21 introduced a
  *new client-side* `maxFragments` default of **16,384** — `maxPayload` bounds
  total size, this bounds how many frames one message may arrive in, and we
  never opted into it. Measured across both versions: 16,384 fragments pass on
  8.20.0 and 8.21.3; **16,385 passes on 8.20.0 and throws
  `WS_ERR_TOO_MANY_BUFFERED_PARTS` on 8.21.3**. A 9.4 MB unfragmented message
  is unaffected either way.

  TrueNAS would have to split one response into >16,384 frames to hit it, which
  was not observed — but the failure mode is the worst kind to diagnose: a
  socket error trips `failAllPending`, tears the connection, and surfaces as
  *intermittent failures across every action category*, looking like a network
  or TrueNAS fault rather than a dependency default. Cheap insurance.

- **The CI gate now asserts the audit step carries no `continue-on-error`.**
  The step's own comment predicted that bypass while nothing checked for it —
  gating the command text and leaving the neutering flag unguarded gates the
  wrong half.

### Scope of the dependency change, stated plainly

The PR table names two bumps; the lockfile carries **66 version changes, 61
removals, 3 additions**. Most are transitive under `@modelcontextprotocol/sdk`
(itself unchanged) in the express/hono HTTP transport stack, which this server
never imports — `mcp-adapter.ts` takes only `StdioServerTransport`, verified by
grep. But two are worth naming because they change the **shipped artifact**:
**`@yao-pkg/pkg` 6.15.0 → 6.22.0** and **`@yao-pkg/pkg-fetch` 3.5.33 → 3.6.5**,
and pkg-fetch supplies the **Node runtime embedded in the released standalone
binary**. ⚠ `npm run build:binary` was not exercised in review; the effect on
that artifact is inferred from the lockfile, not built.

⚠ Note the blocking audit is `--omit=dev`, which deliberately excludes the
toolchain that *builds* what ships — `esbuild` produces the Docker entrypoint
bundle and pkg-fetch the embedded runtime. That is not an argument for gating
on devDependencies; it is a limitation worth stating rather than discovering.

### Documented

- **`CLAUDE.md` no longer asserts a vulnerability count.** It claimed "0
  vulnerabilities" and was wrong by 16, including 2 critical, for an unknown
  period. It now points at the CI job, which re-derives the number. A count in
  prose is a recorded fact with nothing checking it — the whole failure this
  release is about.

## [1.3.0] — 2026-09-13

Five defects hit in a single live operator session against TrueNAS
26.0.0-BETA.1 — four fixed here, one upstream. Full write-up, including which
findings were reproduced live versus read from upstream source versus inferred:
`docs/FIELD-REPORT-2026-09-13-live-defects.md`.

Minor rather than patch: three actions are added
(`filesystem_get`, `filesystem_put`, `system_mcp_version`), taking the
registered surface from 270 to 273. No existing call's behaviour changes except
`snapshot_list`, which now returns the rows it should always have returned.

### Added

- **`filesystem_get` (tier 3) and `filesystem_put` (tier 2).** The category
  could describe a file but never read or write its contents, which pushed
  operators onto SMB with admin credentials and onto the web shell — an
  ergonomic gap with a security outcome. `filesystem.get` / `filesystem.put`
  are pipe-based `@job` methods and are therefore not callable over the
  WebSocket, so the server now also speaks HTTPS to middlewared's `/_upload`
  and `/_download` endpoints (`src/file-transfer.ts`). Transfers are capped at
  16 MiB, with `filesystem_get` defaulting to 1 MiB; the binding limit is the
  context window, not the NAS.

  `filesystem_get` returns UTF-8 text only when the bytes round-trip cleanly and
  base64 otherwise, so binary content is never silently mangled into U+FFFD.
  `filesystem_put` validates `content_base64` before writing (Node discards
  invalid base64 characters rather than throwing, which would produce a
  truncated file reported as complete) and stats the file back afterwards, the
  same post-write verification `filesystem_mkdir` gained in 1.1.1.

- **`system_mcp_version` (tier 3)** reports *this server's* build, as distinct
  from `system_version`, which reports the NAS. `BUILD_VERSION` was already
  embedded and printed by `--version`, but nothing exposed it over the tool
  plane, so "which build is actually deployed?" could only be answered by
  exec-ing into the backend container — and was therefore answered from memory,
  and drifted twice. Answerable even when TrueNAS is unreachable, which is
  when it is most needed.

### Fixed

- **`snapshot_list` sent no dataset filter to the server.** It applied the
  caller's `limit`/`offset` server-side and *then* filtered by dataset in the
  client, so the page was drawn from every snapshot on the pool and only
  afterwards narrowed. On a pool holding 2513 snapshots, `limit: 50` returned
  `[]` for a dataset with 21 — and returned rows whenever that dataset happened
  to fall inside the fetched page, which is the entire reported "intermittency".
  An empty result reads as a clean negative, so any existence check built on
  this action was unsound. The filter now goes to the server, where it has
  always worked; responses shrink accordingly.

  This had been recorded as a middleware defect. It was not: the middleware
  filter is correct and always was.

- **`user_create` / `user_update` rejected `/var/empty`,** the home directory
  TrueNAS itself assigns when `home` is omitted, and the value it uses for
  service and SMB-only accounts. The `/mnt/` guard is right for dataset and
  share paths and was applied one parameter too wide. `validateHomeDirectory`
  now mirrors the middleware's own rule — `/var/empty`, or an absolute path
  under `/mnt/` that is not the root of `/mnt` — while keeping the traversal,
  NUL-byte and colon checks. `validateTrueNASPath` is unchanged elsewhere.

- **`snapshot_task_run` now explains why it cannot work** instead of surfacing
  a bare `[EINVAL] 'PeriodicSnapshotTaskQueryResultItem' object is not
  subscriptable`, which reads like a caller mistake. It is an upstream Python
  `TypeError`: `pool.snapshottask.run` subscripts a value that is a pydantic
  model on this release. Fixed upstream in middleware commit `b237df99`
  (NAS-140147, 27.0.0-BETA.1); nothing here can make the 26.0 call succeed. The
  action now raises a diagnosis naming the cause, the upstream fix version, the
  task's own configuration, and — critically — the constraint on the manual
  workaround.

  No automatic fallback to `snapshot_create` was added, deliberately. Retention
  is name-derived, not creator-derived: zettarepl owns a snapshot only if its
  name parses against the task's `naming_schema` *and* the encoded timestamp
  falls on a slot the schedule would have fired. A snapshot created "now" is
  owned by no task and is pruned by no lifetime, so a helpful fallback would
  silently fill the pool. A fallback that fills a pool is worse than an error.

### Documented

- **File deletion is impossible through this API**, and that is now stated
  rather than left as an apparent gap in this server. All 781 methods
  `core.get_methods` reports on 26.0.0-BETA.1 were enumerated and searched:
  there is no unlink-equivalent under any name. `dataset_delete` destroys a
  whole dataset; the web shell is the only other route. A shell-exec workaround
  would render every other safety tier cosmetic and was rejected.

### Also fixed — found only by the live exercise

- **`waitForJob` could spin until timeout without ever connecting.** Its
  not-connected branch skipped the reconnect and deferred to "the next
  `call()`", which assumes some later caller issues one. On the upload path
  nobody does: `putFileContent` reaches middlewared over HTTP (`/_upload`), so a
  client whose WebSocket had never been opened sat in that branch for the whole
  timeout — **reporting failure for writes that had already succeeded on disk.**
  Measured against 26.0.0-BETA.1: three uploads, three correct files, three
  `SUCCESS` job records, three reported timeouts.

  `waitForJob` now reconnects itself after the backoff sleep (the sleep, not the
  deferral, is what prevents reconnect storms), and `putFileContent` opens the
  WebSocket before sending any bytes, which also fails fast on bad credentials.

  Every pre-existing `waitForJob` test began with `await client.connect()`, and
  the new actions' unit tests stub the client entirely — so the one precondition
  that mattered, *nothing has connected yet*, was the one no test established.
  The regression gate omits `connect()` deliberately, and was confirmed to fail
  against the unfixed client before being kept.

### Corrections the live exercise forced

Two claims in the first draft of this release were asserted from reading the
upstream code rather than measured, and were wrong:

- **`filesystem_put` creates missing parent directories.** `filesystem.put`
  calls `os.makedirs()`, so a mistyped path silently produces a directory tree
  instead of an error — and with no file-delete method available, the only clean
  undo is destroying the dataset.
- **The post-write `stat` does not detect a write beneath an unmounted
  dataset.** The bytes land on the underlying filesystem at the same path, so
  `stat` succeeds and the file vanishes when the dataset mounts. Detecting that
  needs a `mount_id` comparison against the dataset; not implemented, and now
  documented as a limitation rather than implied to be covered.

### Verified against a live system

Every fix in this release was reproduced against TrueNAS 26.0.0-BETA.1.
`filesystem_get` / `filesystem_put` were exercised end-to-end against a
purpose-made scratch dataset (created and destroyed for the test): nine checks
passing — UTF-8 round-trip with non-ASCII, append, overwrite, a 256-byte binary
round-trip covering every byte value, octal `mode`, the `max_bytes` abort plus a
larger cap succeeding, parent auto-creation, and the confirm gate refusing an
unconfirmed write.

The deployed backend pin was also confirmed from the gateway admin API as
`ghcr.io/staticrevolution-com/sr-truenas-mcp:v1.2.1`, i.e. master — the
`:v1.1.1` premise this work started from was false.

## [1.2.1] — 2026-08-21

Patch: completes the 2026-08-21 field report. Additive parameters only — no
action surface change, no change to existing call behaviour.

### Fixed

- **`reporting_get_data` forwards `unit` and `page`.** Both were discarded
  before the call, so a caller paging backwards received correctly-shaped data
  for the *last hour* with no indication the parameters were ignored. Verified
  against 26.0.0-BETA.1: the query schema accepts both, and its
  `additionalProperties` is `false`, so middleware would have rejected them
  loudly — silently dropping them was the only reason it went unnoticed.

  Note `page` is **not** an index: `unit: "HOUR", page: 3` returns the last
  *three hours*, not the third hour back. `unit` and `start`/`end` are mutually
  exclusive (the API rejects the combination), and `page` requires `unit`; both
  are now rejected client-side with a clear message.

### Documented

- **Kernel log access is not possible** and the gap is now recorded in
  TROUBLESHOOTING.md rather than left as a future action. Enumerated against
  26.0.0-BETA.1: of 781 middleware methods, none expose the kernel ring buffer.
  The cgroup `memory.events` / `State.OOMKilled` substitute is documented in its
  place.
- **No memory/swap/ARC summary action will be added.** Memory and ARC compose
  from `reporting_get_data` in a single call — cheap now that `detail` defaults
  to `"summary"` — so a dedicated action would be redundant surface. Swap has no
  middleware source at all; read `/proc/swaps` from a container instead.

## [1.2.0] — 2026-08-21

Fixes the two `reporting_get_data` defects from the 2026-08-21 field report
(`docs/FIELD-REPORT-2026-08-21-reporting-and-diagnostics.md`). No action surface
change — tier counts and the 270 registered actions are unchanged. Minor rather
than major despite the default response shape moving: the change is additive
(`detail`, `max_points`) with a documented opt-out, and it follows the
precedent of 1.1.2, which altered the content of every response (secret
redaction) as a patch. Verified against TrueNAS-26.0.0-BETA.1.

### Fixed

- **`reporting_get_data`'s `start`/`end` are satisfiable again.** They could not
  be supplied in any form: the Zod schema demanded a `string`, middlewared's
  query schema demands an **integer** epoch, and the value was forwarded
  verbatim — so a string returned
  `[EINVAL] query.start: Input should be a valid integer` and a number was
  rejected by the schema before the call. ISO 8601 was never converted despite
  the parameter description promising it. The only call that worked omitted both
  and returned a fixed last-hour window, which put any older incident out of
  reach. Both parameters now accept epoch seconds (number *or* string) and ISO
  8601, and coerce to integer epoch seconds before the call
  (`parseEpochSeconds` in `src/reporting.ts`). An inverted window is rejected up
  front instead of being passed upstream.

### Changed

- **`reporting_get_data` now returns a summary by default rather than the full
  series.** A two-graph, one-hour query returned 400,403 characters — 3,601
  points per graph at 1s resolution — while the `aggregations` block the
  response already carries is ~200 bytes and answers most diagnostic questions.
  The new `detail` parameter defaults to `"summary"`, which keeps
  `aggregations`, `legend`, `start` and `end`, drops `data`, and reports the
  elided row count as `data_points`.

  **This changes the default response shape.** Callers that parse `data` must
  pass `detail: "raw"` to restore the previous behaviour. `detail:
  "downsampled"` returns roughly `max_points` rows (default 120), bucketed to
  preserve per-bucket minima and maxima — a mean-based reduction would erase
  exactly the spikes and troughs these graphs get consulted for.

- `aggregate`'s description now states that it adds the `aggregations` block and
  does **not** reduce the size of `data`; the previous wording ("whether to
  aggregate data points") read as a downsampling control, which it never was.

## [1.1.2] — 2026-06-17

Bug-fix + hardening release. Closes a response-filter bypass that leaked
secrets in tool-call responses, makes the `confirm` gate satisfiable for
create/update actions, corrects `vm_device` `dtype` nesting and several other
forwarding bugs (incl. a broken `dataset_set_permissions`), and tightens safety
tiers and unknown-key handling. No removed actions; tier counts shift to 93
tier-2 / 157 tier-3. Verified against TrueNAS-26.0.0-BETA.1.

### Security

- **Sensitive fields are now redacted from action (tool-call) responses.** The
  response filter ran over the MCP envelope, but every action handler
  serialized its payload into `content[].text` with `JSON.stringify` *before*
  the registry filtered it — so sensitive keys sat inside an opaque string and
  shipped through unredacted (a VM display `password` was observed in cleartext
  via a live `vm_list` against production). `registry.execute` now re-parses
  each JSON text block, filters it, and re-serializes; non-JSON text (e.g.
  confirm-gate warnings) is untouched. Resource reads were already filtered
  correctly. Adds end-to-end pipeline coverage (`response-filter-pipeline.test.ts`)
  — the prior filter tests only exercised the matcher in isolation, which is
  why the bypass went unnoticed.

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
- **`vm_device_create` / `vm_device_update` now build the device payload the
  current TrueNAS middleware expects.** The handlers forwarded the device type
  as a top-level `dtype`, but the API folds `dtype` into the `attributes`
  object: it rejects a top-level copy
  (`[EINVAL] vm_device_create.dtype: Extra inputs are not permitted`) while
  requiring `attributes.dtype` (`...attributes.dtype: Field required`) — so no
  invocation succeeded. `dtype` stays the ergonomic top-level MCP field; the
  handler folds it into `attributes` (it wins over any stray nested copy) and
  sends no top-level `dtype`. Confirmed against TrueNAS-26.0.0-BETA.1.
- **`vm_create` / `vm_update` tolerate the underscore `cpu_mode` spelling.**
  The TrueNAS enum is hyphenated (`HOST-MODEL` / `HOST-PASSTHROUGH`); callers
  copying `HOST_MODEL` from older docs hit `[EINVAL] cpu_mode: ...`. The
  handlers now normalize `_`→`-` (and upper-case) before the call, and the
  field description shows the hyphenated values.
- **`dataset_set_permissions` works again.** It routed to `filesystem.setperm`
  (an `@job` method) but sent the bare dataset name `tank/data` as `path`
  (setperm needs the on-disk `/mnt/tank/data`), forwarded `user`/`group`/`acl`
  fields the strict model rejects, never validated the path, and didn't await
  the job — so a failure read as success. It now mirrors
  `filesystem_set_permissions`: resolve the mountpoint, validate, send only
  `{path, mode, uid, gid, options}`, and await the job. (The 2026-06-12
  field-report job-wait fix had missed this second `filesystem.setperm` site.)
- **`replication_restore` validates `target_dataset`** via `validateDatasetName`
  like every other dataset-bearing handler (it was the one gap).
- **`vm_display_uri` no longer builds a dead options object** or sends
  `{ protocol: undefined }`; it passes a clean options object.
- **`alertservice_test` strips the server-managed `id`** from the fetched
  service before calling the strict `alertservice.test` (which rejects it).

### Added

- **`confirm` is now a first-class top-level dispatcher field**, mirroring
  `reason`, so the safety flag has a clean control channel instead of being
  buried in `params`. Supplying it inside `params` still works and is still
  correct; the top-level field is preferred and overrides a nested value.

### Changed

- **`vm_create` / `vm_update` validate the VM name locally.** TrueNAS allows
  only letters, digits, and underscores in a VM name (a hyphenated name failed
  with a server-side `[EINVAL]`; an existing VM with underscores confirms the
  real charset is broader than the "alphanumeric only" message). A name regex
  now rejects disallowed characters before the round-trip with a clear message.
- **`vm_device_create` discovery lists complete per-dtype attributes,**
  including the DISK create-a-zvol fields (`create_zvol`, `zvol_name`,
  `zvol_volsize`) and noting that `dtype` is supplied top-level, not inside
  `attributes`.
- **`vm_update` mirrors `vm_create`'s constraints** on `vcpus`/`cores`/
  `threads`/`memory` (`.int().min(...)`), so zero/negative/fractional values
  are caught at the client boundary instead of upstream.
- **Long-running `@job` actions return a structured descriptor**, not a bare
  job-id number: `replication_run`, `cloudsync_run`, `cloud_backup_run`,
  `update_apply`, `disk_wipe`, and `pool_scrub` (START) now return
  `{ job_id, state, note }` (via `describeAsyncJob`) so the asynchronous,
  outcome-not-yet-known nature is explicit. Quick `@job` writes still await.
- **Unknown params are dropped centrally.** Registry validation switched from
  `.passthrough()` to `.strip()`, so any key not in a handler's schema is
  removed before dispatch — generalizing the `confirm`/`reason` strip to the
  whole stray-key class (which otherwise reaches strict pydantic models as
  `[EINVAL] ... Extra inputs are not permitted`). The now-redundant
  `system_general_update` field allowlist (a `.passthrough()` workaround) was
  removed.
- **Safety-tier consistency.** iSCSI `*_create`/`*_update` are now tier-2
  (confirm) like SMB/NFS share creates (an extent provisions block storage),
  and the `*_run` family is uniformly tier-2 (`replication_run`,
  `cloud_backup_run`, `rsync_task_run`, `snapshot_task_run` joined
  `cloudsync_run`/`cronjob_run`). Tier counts: 93 tier-2 / 157 tier-3.
- **`awaitJobResult` / `describeAsyncJob` extracted** to `src/job-utils.ts`
  (shared by `filesystem.ts`, `storage.ts`, `replication.ts`, `network.ts`,
  `alert.ts`).
- **Tests**: confirm-strip + unknown-key strip pipeline tests
  (`integration.test.ts`), nine VM payload-shaping tests
  (`vm-payload-shaping.test.ts`), and end-to-end response-filter tests
  (`response-filter-pipeline.test.ts`). 242 tests total.

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

[1.1.2]: https://github.com/staticrevolution-com/sr-truenas-mcp/releases/tag/v1.1.2
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
