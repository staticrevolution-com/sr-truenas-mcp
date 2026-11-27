# Open plan — sr-truenas-mcp

Work in progress or intended next. Markers: `[ ]` open, `[~]` in progress,
`[x]` done, `[-]` dropped. Each marker is set from current state — merged PRs,
`master`, and what the deployed backend is running — never from a plan file's
own status header.

- [ ] #27 `filesystem_put` has no content validation, and it is the action people patch live config with
- [ ] #29 `registry.ts` silently drops unknown parameters when validation SUCCEEDS — root cause of two shipped defects
- [ ] #30 Nine CRUD families still lack an `update` verb (its second half, the stale `COMPARISON.md` test count, is fixed)
- [ ] #28 `npm run build:binary` hangs locally — ⚠ its title overstates the release impact: v1.4.1, v1.4.2 and v1.4.3 all shipped the binary, its SHA256 and the SBOM; only v1.4.0 is missing them
- [ ] Re-derive [`docs/TOOL-SURFACE-EVALUATION.md`](../docs/TOOL-SURFACE-EVALUATION.md)'s recommendation against what the gateway's per-token RBAC enforces today; its all-or-nothing premise predates argument constraints
- [ ] The two deferred follow-ups from the 2026-06-12 field report: the TrueNAS 26.0 compatibility sweep, and a job-method audit across every handler

- [ ] The 24 `describeAsyncJob` call sites still describe a job id as a receipt rather than naming `job_get`, which now resolves it — a wording-only change across `src/tools/*.ts`, deliberately held out of v1.6.0 and intended for the release after
- [~] Release v1.6.0, covering #61, #62 and #63 — version bumped and gated; the tag, the published image and the gateway pin follow the bump merge. Flip this to `[x]` once the release is published and the deployed backend reports `1.6.0+<sha>` back

## Done and dropped

- [x] `job_get`'s `result` could return a ZFS dataset encryption key — a scalar has no field name, so the response filter could not redact it. Withheld by a shape rule rather than a method list, because only 3 of 105 `@job` methods return a bare string today and `core.job_wait`'s return schema is untyped. Merged in #63 (`e8a7e1b`). ⚠ One residual is recorded beside the rule in `src/tools/jobs.ts` and deliberately not fixed: a string nested under a field name the filter does not recognise still passes through
- [x] #58 No action could query a job: 24 actions return a job id that nothing accepted back, so every long-running job's outcome was unreachable. `job_get` / `job_list` added as one general tier-3 pair, with a field allowlist so a job's arguments and session credentials stay server-side. Merged in #62 (`010af41`)
- [x] `listActions`'s parameter-description cap — Warren's decision was to keep the cheap listing and add an opt-in `detail: true` mode returning the full text, with a `[+]` marker on what was cut and the detail/execute combination refused rather than reinterpreted. Merged in #61 (`90aaad4`); not yet released
- [x] Release v1.5.0 — tagged, CI published the image and the tarball, and the deployment pin was moved; verified by the running backend reporting its own version and build commit back, which is the check that settles it. ⚠ The pin itself is deliberately not recorded here, for the reason `CLAUDE.md` gives: a version named in a file drifts, and has twice
- [x] `dataset_delete`'s `recursive` trap — description and behaviour fixed together in #59, released in v1.5.0 and live on the deployed backend
- [x] [`PLAN-v1.0.0.md`](./PLAN-v1.0.0.md) — the pre-v1.0.0 hardening journey: REST → WebSocket migration, safety tiers, response filtering, validation
- [x] [`PLAN-bulletproofing-v1.0.1-v1.1.0.md`](./PLAN-bulletproofing-v1.0.1-v1.1.0.md) — Phase A (security + correctness) and Phase B (reliability + spec alignment) shipped; Phase C deferred with its forcing-functions recorded
- [x] The 2026-09-13 live defects — four fixed in 1.3.0/1.4.0, and `snapshot_task_run` confirmed working on TrueNAS 27.0 rather than fixed here
- [x] The 2026-08-21 reporting defects — all three released (1 and 3 in 1.2.0, 2 in 1.2.1); gaps 4 and 5 closed as not-implementable or redundant
- [x] Node 20 → 26 across CI, the image and the binary, with a gate so the five files naming a runtime cannot disagree
- [x] Gate the documentation counts, versions and category table against the code, rather than hand-maintaining them
