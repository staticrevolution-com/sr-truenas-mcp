# Open plan — sr-truenas-mcp

Work in progress or intended next. Markers: `[ ]` open, `[~]` in progress,
`[x]` done, `[-]` dropped. Each marker is set from current state — merged PRs,
`master`, and what the deployed backend is running — never from a plan file's
own status header.

- [ ] #27 `filesystem_put` has no content validation, and it is the action people patch live config with
- [ ] #29 `registry.ts` silently drops unknown parameters when validation SUCCEEDS — root cause of two shipped defects
- [ ] #30 Nine CRUD families still lack an `update` verb (its second half, the stale `COMPARISON.md` test count, is fixed)
- [ ] #28 `npm run build:binary` hangs locally — ⚠ its title overstates the release impact: v1.4.1, v1.4.2 and v1.4.3 all shipped the binary, its SHA256 and the SBOM; only v1.4.0 is missing them
- [ ] Repoint the gateway backend so the deployed image carries the post-v1.4.3 corrections — a gateway-backend change, Warren's to make, and the reason a merged fix here is not a deployed one
- [ ] Re-derive [`docs/TOOL-SURFACE-EVALUATION.md`](../docs/TOOL-SURFACE-EVALUATION.md)'s recommendation against what the gateway's per-token RBAC enforces today; its all-or-nothing premise predates argument constraints
- [ ] The two deferred follow-ups from the 2026-06-12 field report: the TrueNAS 26.0 compatibility sweep, and a job-method audit across every handler

## Done and dropped

- [x] [`PLAN-v1.0.0.md`](./PLAN-v1.0.0.md) — the pre-v1.0.0 hardening journey: REST → WebSocket migration, safety tiers, response filtering, validation
- [x] [`PLAN-bulletproofing-v1.0.1-v1.1.0.md`](./PLAN-bulletproofing-v1.0.1-v1.1.0.md) — Phase A (security + correctness) and Phase B (reliability + spec alignment) shipped; Phase C deferred with its forcing-functions recorded
- [x] The 2026-09-13 live defects — four fixed in 1.3.0/1.4.0, and `snapshot_task_run` confirmed working on TrueNAS 27.0 rather than fixed here
- [x] The 2026-08-21 reporting defects — all three released (1 and 3 in 1.2.0, 2 in 1.2.1); gaps 4 and 5 closed as not-implementable or redundant
- [x] Node 20 → 26 across CI, the image and the binary, with a gate so the five files naming a runtime cannot disagree
- [x] Gate the documentation counts, versions and category table against the code, rather than hand-maintaining them
