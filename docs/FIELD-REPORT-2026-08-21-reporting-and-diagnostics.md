# Field Report — 2026-08-21: `reporting_get_data` is unusable, and the memory-diagnostics gap

**Status:** **Bugs 1 and 3 fixed** (see CHANGELOG `[Unreleased]`); Bug 2 and Gaps 4–5 open · **Origin:** a live
memory-pressure investigation against a production TrueNAS **26.0.0-BETA.1**
host, driven through a gateway-federated `sr-truenas-mcp` v1.1.1.

Companion to [`FIELD-REPORT-2026-06-12-truenas-26.md`](./FIELD-REPORT-2026-06-12-truenas-26.md).
GitHub Issues are disabled on this repo, so this document is the durable record.

## Context — what the session was trying to do

A container host began OOM-killing workloads: five heavy CI jobs died together
(exit 137), the incident was transient, and a retry passed clean with no change.
The investigation needed three ordinary things from this MCP:

1. the host memory + ZFS ARC trend **across the incident window**,
2. the kernel's OOM-killer log lines,
3. a swap / memory-headroom summary.

**It could deliver none of them.** The root cause was eventually established (a
per-container cgroup memory cap, not host exhaustion) using the Docker Engine API
and `/proc` reads from inside containers. Everything below is why this MCP was
not the tool that answered it, with the fixes.

None of this is a safety-tier or correctness problem — the actions are Open tier
and return honest data. It is a usability and coverage problem, and it made the
MCP the wrong tool for the most common "something died on the box" question.

---

## Bug 1 — `reporting_get_data` `start`/`end` are unusable in **both** directions

> **FIXED.** Both parameters now accept epoch seconds (number or string) and
> ISO 8601, coerced to integer epoch seconds before the call. An inverted window
> is rejected up front. See `parseEpochSeconds` in `src/reporting.ts`.


**This is the blocking bug.** The parameters cannot be satisfied by any caller.

`src/tools/filesystem.ts` (reporting block, ~line 190):

```ts
start: z.string().optional().describe("Start time in ISO 8601 or epoch format"),
end:   z.string().optional().describe("End time in ISO 8601 or epoch format"),
...
const query: Record<string, unknown> = { aggregate };
if (start !== undefined) query.start = start;
if (end !== undefined) query.end = end;
const result = await client.call("reporting.get_data", [graphs, query]);
```

The Zod schema demands a **string**; middlewared's `reporting.get_data` query
schema demands an **integer** epoch. The value is forwarded verbatim, so:

| caller sends | rejected by | error |
|---|---|---|
| `start: "1787263200"` | middlewared | `[EAGAIN] [EINVAL] query.start: Input should be a valid integer (code 11)` |
| `start: 1787263200` | MCP Zod | `start: Invalid input: expected string, received number` |
| `start: "2026-08-20T22:00:00Z"` | middlewared | same EINVAL — ISO 8601 is **never** converted, despite the description promising it |

All three observed live. The only call that succeeds is one that omits
`start`/`end` entirely, which returns a fixed **last-hour** window.

**Consequence:** the MCP can report on the last hour and nothing else. For an
incident a couple of hours old this is the difference between a diagnosis and a
guess — the metrics in the resulting write-up had to be labelled as coming from
the hour *after* the event, and the causal question ("was the host also near
exhaustion at the time?") was left formally unanswered.

**Fix.** Accept both shapes and normalise to an integer epoch before the call.
The description already promises ISO 8601, so honour it:

```ts
const epoch = z.union([z.string(), z.number()]).transform((v, ctx) => {
  if (typeof v === "number") return Math.floor(v);
  const trimmed = v.trim();
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);   // epoch-as-string
  const ms = Date.parse(trimmed);                             // ISO 8601
  if (Number.isNaN(ms)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom,
      message: `Expected epoch seconds or ISO 8601, got ${JSON.stringify(v)}` });
    return z.NEVER;
  }
  return Math.floor(ms / 1000);
});
```

then `start: epoch.optional()`, `end: epoch.optional()`. Reject `end <= start`
with a clear message rather than passing it through.

**Regression test:** assert that a numeric input, an epoch string, and an ISO
string all produce the same integer in the outgoing `query`. There is currently
no test covering this handler's query construction.

---

## Bug 2 — `unit` / `page` are silently dropped

> **PARTIALLY ADDRESSED.** Still dropped — forwarding them is gated on
> confirming whether 26.0 middleware accepts them. With Bug 1 fixed, `start`/`end`
> now provide the windowing they were the fallback for.


The handler builds `query` from exactly three keys (`aggregate`, `start`, `end`).
Anything else a caller passes — notably `unit` and `page`, the conventional
TrueNAS reporting idiom for "give me the Nth window back" — is **discarded
before the call**, with no error.

This is what makes Bug 1 fatal rather than merely annoying: with `start`/`end`
broken, `unit`/`page` would have been the natural fallback for reaching a
historical window, and it looks like it works. A `page: 3` request returns
correctly-shaped data for the **last hour**, so a caller trying to page backwards
gets plausible, current, wrong-window data and no signal that the parameter was
ignored.

**Verified:** the drop happens in this handler (read from source). **Not
verified:** whether `reporting.get_data` on 26.0.0-BETA.1 accepts `unit`/`page`
at all — confirm against middlewared before implementing, since the netdata-based
reporting backend may only support `start`/`end`.

**Fix.** Either forward them (if middleware supports them) or reject unknown
query keys explicitly. Silently dropping a parameter that changes the meaning of
the result is the worst of the three options.

---

## Bug 3 — the useful part of the response is buried under 3,600 raw points

> **FIXED.** `detail` now defaults to `"summary"`; `"downsampled"` and `"raw"`
> are available. See `shapeReportingResult` in `src/reporting.ts`.


`reporting_get_data` returns middlewared's payload verbatim. A **two-graph,
one-hour** query returned **400,403 characters across 28,856 lines** — 3,601
data points per graph at 1-second resolution. That overflows a typical MCP
tool-result budget, so the client has to spill it to a file and the caller ends
up writing a parser just to read a memory graph.

The irony is that the response **already contains exactly what was wanted**:

```json
{
  "name": "memory", "identifier": "memory",
  "legend": ["time", "available"],
  "start": 1787276725, "end": 1787280325,
  "aggregations": {
    "min":  { "available": 4075344000 },
    "mean": { "available": 12058990029.713968 },
    "max":  { "available": 24027910000 }
  },
  "data": [ [1787276724, 8316682000], ... 3600 more ... ]
}
```

`aggregations` is ~200 bytes and answered the actual question. `data` is ~200 KB
per graph and was discarded after parsing.

Note also that `aggregate: true` — which the schema defaults to and whose
description reads *"Whether to aggregate data points"* — does **not** downsample
`data`. It only adds the `aggregations` block. A caller reasonably reads that
flag as "make the response smaller" and it does the opposite.

**Fix.** Add response shaping, defaulting to the small form:

- `detail: "summary" | "downsampled" | "raw"`, default **`"summary"`** —
  `summary` returns `name`/`identifier`/`legend`/`start`/`end`/`aggregations`
  and omits `data` entirely; `raw` preserves today's behaviour.
- For `downsampled`, add `max_points` (default ~120) and bucket `data`
  server-side, carrying min/max per bucket so spikes survive — a mean-only
  downsample would have hidden the low-water memory reading that mattered most
  in this investigation.
- Clarify the `aggregate` description so it is not mistaken for downsampling.

This one change would make the reporting surface usable in-context.

---

## Gap 4 — no kernel-log / `dmesg` action

There is no action among the 270 that returns kernel messages
(`grep -rn "dmesg\|kmsg\|kernel_log" src/` → nothing).

For OOM triage the kernel log is *the* primary source: it distinguishes
`Out of memory: Killed process …` (host-wide exhaustion) from
`Memory cgroup out of memory: Killed process …` (a container hitting its own
limit). Those two have completely different fixes — one is "the host is
oversubscribed", the other is "this one container's cap is too small". In this
incident it was the second, and establishing that took an indirect chain of
inference that a single `dmesg` grep would have settled in one call.

Containers on the host cannot substitute: without `CAP_SYSLOG` and `/dev/kmsg`,
`dmesg` inside a container returns
`read kernel buffer failed: Operation not permitted`.

**Suggested action** — `system_dmesg` (Open tier, read-only), with a `grep`/
`tail` parameter so the caller can filter server-side rather than pulling the
whole ring buffer through the tool budget.

**Needs verification first:** whether middlewared on 26.0.0-BETA.1 still exposes
`system.dmesg`. If not, `system.debug`-style paths are far too heavy for this,
and the honest outcome may be documenting the gap in TROUBLESHOOTING.md rather
than shipping a fragile action.

---

## Gap 5 — no memory / swap / ARC summary action

`system_info` returns `physmem` (total bytes) and nothing else about memory.
There is no action for free/available memory, swap state, or an ARC summary
(`grep -rn "meminfo\|swap\|arc_" src/tools/` → nothing).

That is a conspicuous hole for a **ZFS NAS**, where the memory story is largely
the ARC story. The session had to reach `/proc/meminfo`, `/proc/swaps`,
`/proc/vmstat` and `/sys/module/zfs/parameters/zfs_arc_max` by exec'ing into a
container over the Docker API — a channel that has nothing to do with TrueNAS and
that a TrueNAS MCP should make unnecessary.

Facts that mattered on the host under test and were invisible to this MCP:

- **`SwapTotal: 0`** — no swap configured, so every memory limit on the host is a
  hard wall with no graceful degradation. Arguably the single most important
  capacity fact about the machine, and unreachable here.
- **`zfs_arc_max=0`** (uncapped) while ARC held only ~5–10% of RAM — which
  *refuted* the leading hypothesis that ARC was squeezing containers.
- **`/proc/vmstat oom_kill`** — a nonzero counter, i.e. proof the OOM killer
  fires on this host at all.

**Suggested action** — `system_memory_summary` (Open tier). Most of it needs no
new middleware method: `reporting.netdata_graphs` already exposes `memory`,
`arcsize`, `arcfreememory` and `arcavailablememory`, so a summary can be composed
from `reporting.get_data` + the `aggregations` block once Bug 3 is fixed. Swap
and `zfs_arc_max` need a middleware source — verify what 26.0 exposes before
designing the shape.

---

## Observation 6 — reporting actions live in `src/tools/filesystem.ts`

The whole `reporting_*` block (plus `directory_services_*`) is defined in
`src/tools/filesystem.ts`, while `src/registry.ts` maps them to the `reporting`
category by name prefix. Not a bug, and the registry does the right thing, but it
cost time to locate during triage and there is no `src/tools/reporting.ts` to
look in. Worth a move or a pointer comment when this block is next touched.

---

## Priority

1. **Bug 1** — a documented parameter that cannot be satisfied in any form.
   Small, self-contained, testable fix.
2. **Bug 3** — `detail: "summary"` default. Turns the reporting surface from
   unusable-in-context into the natural first call for any "what happened on the
   box" question. Arguably the highest value-per-line change in this report.
3. **Gap 5** — the ZFS-NAS-shaped hole; largely composable from existing methods
   once Bug 3 lands.
4. **Bug 2** — cheap, and prevents a silently-wrong result.
5. **Gap 4** — highest diagnostic value but the most uncertain; gated on what
   26.0 middleware actually exposes.

## Workarounds, until fixed

For anyone who hits this before the fixes land:

- **Windowed metrics:** none through the MCP. Call the last-hour form and accept
  the window, or call `reporting.get_data` over the WebSocket API directly at
  `wss://<host>/websocket` with an integer epoch.
- **Kernel OOM lines:** not reachable from an unprivileged container. Use cgroup
  `memory.events` (`oom_kill` counter) and `memory.peak` per container — but note
  ephemeral containers reset those counters on restart, so they only describe the
  container's current lifetime.
- **Host memory/swap/ARC:** `/proc/meminfo`, `/proc/swaps`, `/proc/vmstat` and
  `/sys/module/zfs/parameters/zfs_arc_max` are readable from inside any container
  with a shell — these values are not namespaced.
- **Distinguishing a cgroup kill from a host kill without `dmesg`:** check
  `State.OOMKilled` on the container. `false` on a container whose *inner*
  processes died means the kernel killed inside the cgroup, not the host reaping
  the container — different root cause, different fix.
