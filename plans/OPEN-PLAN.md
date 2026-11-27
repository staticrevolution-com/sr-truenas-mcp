# Open plan — sr-truenas-mcp

Work in progress or intended next. Markers: `[ ]` open, `[~]` in progress,
`[x]` done, `[-]` dropped. Each marker is set from current state — merged PRs,
`master`, and what the deployed backend is running — never from a plan file's
own status header.

- [ ] #27 `filesystem_put` has no content validation, and it is the action people patch live config with
- [ ] #29 `registry.ts` silently drops unknown parameters when validation SUCCEEDS — root cause of two shipped defects
- [ ] #30 Nine CRUD families still lack an `update` verb (its second half, the stale `COMPARISON.md` test count, is fixed)
- [ ] #28 `npm run build:binary` hangs locally — ⚠ its title overstates the release impact: v1.4.1, v1.4.2 and v1.4.3 all shipped the binary, its SHA256 and the SBOM; only v1.4.0 is missing them
- [ ] Release, so the corrections on `master` can reach production at all — in order: (1) tag a release here, (2) let CI publish the image and tarball, (3) move the gateway backend pin to the new digest. ⚠ This entry previously read "repoint the gateway backend", which is impossible as written: measured 2026-11-26, the registered digest is tagged both `v1.4.3` and `latest` and **is the newest published image**, so a pin move alone changes nothing. `master` is `ahead_by 8` of `v1.4.3` (released 2026-10-26) and no image has been published since, so every correction of the last month exists only on `master`. Step 1 is the decision and the only one that unblocks the rest; tagging and the pin move are both Warren's
- [ ] Re-derive [`docs/TOOL-SURFACE-EVALUATION.md`](../docs/TOOL-SURFACE-EVALUATION.md)'s recommendation against what the gateway's per-token RBAC enforces today; its all-or-nothing premise predates argument constraints
- [~] `dataset_delete`'s `recursive` trap — description and behaviour fixed together; PR open, not merged, and the deployed backend still carries the old handler
- [~] #58 No action could query a job: 24 actions return a job id that nothing accepted back, so every long-running job's outcome was unreachable. `job_get` / `job_list` added as one general tier-3 pair, with a field allowlist so a job's arguments and session credentials stay server-side. PR open, not merged; ships with the next release
- [ ] `listActions` truncates a parameter description at 97 characters, and in a single-dispatcher server that listing is the only channel for per-action params. 15 are currently cut mid-sentence, including live safety caveats on `snapshot_task_update`
- [ ] The two deferred follow-ups from the 2026-06-12 field report: the TrueNAS 26.0 compatibility sweep, and a job-method audit across every handler

## Done and dropped

- [x] [`PLAN-v1.0.0.md`](./PLAN-v1.0.0.md) — the pre-v1.0.0 hardening journey: REST → WebSocket migration, safety tiers, response filtering, validation
- [x] [`PLAN-bulletproofing-v1.0.1-v1.1.0.md`](./PLAN-bulletproofing-v1.0.1-v1.1.0.md) — Phase A (security + correctness) and Phase B (reliability + spec alignment) shipped; Phase C deferred with its forcing-functions recorded
- [x] The 2026-09-13 live defects — four fixed in 1.3.0/1.4.0, and `snapshot_task_run` confirmed working on TrueNAS 27.0 rather than fixed here
- [x] The 2026-08-21 reporting defects — all three released (1 and 3 in 1.2.0, 2 in 1.2.1); gaps 4 and 5 closed as not-implementable or redundant
- [x] Node 20 → 26 across CI, the image and the binary, with a gate so the five files naming a runtime cannot disagree
- [x] Gate the documentation counts, versions and category table against the code, rather than hand-maintaining them
