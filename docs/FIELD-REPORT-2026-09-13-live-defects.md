# Field report — 2026-09-13: five defects from a live session

**Target:** TrueNAS `26.0.0-BETA.1`, WebSocket JSON-RPC 2.0 (`wss://<host>:444/websocket`).
**Server:** `sr-truenas-mcp` 1.2.1 (defects found); fixes released in 1.3.0.
**Status:** four fixed here, one is upstream and cannot be fixed here.

Five problems surfaced in a single operator session. Individually each looked
small; together they turned a fifteen-minute task into an hour and briefly put a
`FULL_ADMIN` SMB credential on the table as a workaround. That last part is why
this is a security report as much as an ergonomics one: **when the supported
channel cannot do the job, the operator does not stop — they reach for a worse
channel.** Four of the five are the same shape: this server is read-rich and
write-poor.

## How to read the evidence column

Conclusions in this report are not all equally well-founded, and a document
strips that distinction by construction unless it is stated. So each defect
says which of these it rests on:

| | |
|---|---|
| **Reproduced live** | The failure was triggered against the running system and observed. |
| **Read from upstream source** | The cause was read in the TrueNAS middleware tree at `origin/release/26.0.0-BETA.1` — the exact branch this box runs — or in `truenas/zettarepl`. |
| **Inferred** | Concluded from observable behaviour without reading the authoritative record. Named as such, with the check that *would* settle it. |

**Where the live evidence stops, for `filesystem_get` / `filesystem_put`.** The
`core.download` handshake and the job lifecycle *were* exercised against the
running system: requesting a path that does not exist minted a real job and
surfaced its failure correctly —

```
getFileContent("/mnt/<nonexistent>/nope.txt")
  ->  Job 344225 failed: [EFAULT] /mnt/<nonexistent>/nope.txt is not a file
```

— which proves the call shape, the returned `[job_id, url]` handle, the job
poll, and error propagation. What is **not** exercised live is the HTTP leg
itself: no bytes were fetched from `/_download` and nothing was posted to
`/_upload`, because a write to production TrueNAS was outside this session's
authorisation and no scratch dataset was created. Those two paths rest on unit
tests plus a reading of the upstream handlers. The distinction should survive
into the release notes.

---

## 1. `snapshot_list` returned `[]` for datasets that have snapshots

**Evidence: reproduced live. Fixed.**

Reported as an intermittent middleware defect — and recorded as one in operator
notes, which told every consumer to enumerate unfiltered and filter client-side.
That diagnosis was wrong, and the bug was ours.

The middleware filter works:

```
pool.snapshot.query [[["dataset","=","<pool>/apps/<app>"]]] {"count": true}  ->  21
pool.snapshot.query [] {"count": true}                                      ->  2513
```

`snapshot_list` never sent it. It passed the caller's `limit` / `offset` to the
server and then filtered by `dataset` **client-side**, so the page was selected
from all 2513 snapshots and only afterwards narrowed:

```
snapshot_list dataset=<pool>/apps/<app> limit=50    ->  []        <- same dataset
snapshot_list dataset=<pool>/apps/<app> limit=3000  ->  21 rows   <- same filter
```

🔑 **That is the entire "intermittent".** It worked exactly when the dataset
happened to fall inside the fetched page. A defect that is *sometimes* right is
more dangerous than one that always fails, because it passes the spot check you
run before trusting it — and here the wrong answer was an empty list, which
reads as a clean negative. Any existence check built on it was unsound.

**Fix:** push the filter to the server. The dataset name goes through
`validateDatasetName` on the way. As a side effect the response drops from 2513
rows to 21.

**Generalisable part, and the reason this entry is longer than its fix:** *a
wrong diagnosis that points at someone else's component ends enquiry.* "The
middleware lies" produced a workaround, the workaround worked, and nobody looked
again for weeks — while the defect sat in a repository we own and could have
fixed in an afternoon. Before recording a defect as upstream, check the layer
you control.

---

## 2. `filesystem` could not read or write file content

**Evidence: middleware surface enumerated live (781 methods); `core.download` handshake and job lifecycle exercised live; HTTP leg read from upstream source only. Fixed (put/get). Delete is impossible.**

The category exposed `stat`, `listdir`, `mkdir`, `set_permissions`, `get_acl`,
`set_acl`, `chown` — everything *about* a file and nothing *in* it. Uploading an
11 KB file therefore required standing up an SMB share and authenticating over
CIFS, and deleting one file required the web shell by hand.

### What exists

`core.get_methods` reports 781 methods on this release. Under `filesystem.*`
there are 18, of which two carry content:

| Method | Shape |
|---|---|
| `filesystem.get(path)` | `@job`, output pipe |
| `filesystem.put(path, {append, mode})` | `@job`, input pipe |

Neither is callable over the WebSocket. Both move their payload through a
*pipe*, which middlewared exposes only as two HTTP routes (`main.py`):

- **`POST /_upload`** — `multipart/form-data`. The **first** part must be named
  `data` and carry `{"method": …, "params": […]}` as JSON; the **second** must be
  named `file` and carry the bytes. Any other order or naming is rejected with a
  405 that names the offending part. Auth is `Authorization: Bearer <api key>`.
  A 200 returns `{"job_id": N}` — **the enqueue, not the outcome.**
- **`GET /_download`** — the URL is minted by
  `core.download(method, args, filename, buffered)`, which returns
  `[job_id, "/_download/<id>?auth_token=…"]`. The token is **single-use**, lives
  **300 seconds**, and is **origin-matched** to the session that minted it.

So the server now speaks HTTPS to the same host and port alongside its
WebSocket (`src/file-transfer.ts`). `node:https` is used rather than `fetch`
because `TRUENAS_VERIFY_SSL=false` must keep working, and opting a `fetch` call
out of certificate verification needs an undici dispatcher — a new dependency
for something `node:https` does with one flag.

### New actions

| Action | Tier | Notes |
|---|---|---|
| `filesystem_get` | 3 (open) | Returns UTF-8 text when the bytes round-trip cleanly, base64 otherwise. Default cap 1 MiB, ceiling 16 MiB. |
| `filesystem_put` | 2 (confirm) | Exactly one of `content` / `content_base64`. Overwrites by default; `append` opts out. Optional octal `mode`. |

Three deliberate refusals rather than conveniences:

- **`auto` encoding decides by round-tripping**, not by sniffing. `toString("utf8")`
  on binary silently substitutes U+FFFD and would return corrupted content under
  a successful-looking response.
- **`content_base64` is validated before the write.** `Buffer.from(s, "base64")`
  discards invalid characters instead of throwing, so a mangled payload would
  otherwise become a short file reported as a complete one.
- **`filesystem_put` stats the file back.** This mirrors the `filesystem_mkdir`
  finding from the 2026-06-12 report: a write into an unmounted parent dataset
  reports success and leaves nothing on disk.

The 16 MiB ceiling is about the context window, not the NAS. It exists so that
"read me this disk image" fails immediately and cheaply.

### ⚠ There is no way to delete a file, and there is no point looking for one

**Not `filesystem.unlink`, not under any other name, anywhere in the 781.** The
whole method surface was enumerated and searched, not just `filesystem.*`. The
closest things are `pool.dataset.delete` (a whole dataset) and the web shell.

This is documented rather than worked around. The available routes would be a
shell exec — which this server deliberately does not have, and which would make
every other safety tier cosmetic — or truncating via `filesystem.put`, which
leaves a zero-byte file and calls it a deletion. Both are worse than the gap.
Recording the absence converts an hour of searching into thirty seconds of
reading, which is the whole value here.

If file deletion should exist, that is a design decision about giving this
server a channel it deliberately lacks. It is not a defect fix.

---

## 3. `user_create` rejected TrueNAS's own default home directory

**Evidence: reproduced live, confirmed against `user.create`'s schema. Fixed.**

```
user_create … {"home": "/var/empty", "home_create": false}
  ->  Path must start with /mnt/
user_create … (home omitted)
  ->  succeeds, and TrueNAS stores  "home": "/var/empty"
```

The server refused the exact value the product was about to use anyway.
`user.create`'s own schema declares `home` with `default: "/var/empty"`
(`DEFAULT_HOME_PATH`), the empty immutable directory used for service and
SMB-only accounts.

The `/mnt/` guard is correct for dataset and share paths. It was simply applied
one parameter too wide — a correct rule outside the scope that earned it.

**Fix:** `validateHomeDirectory`, mirroring the middleware's own
`validate_homedir_path`: accept `/var/empty`, or an absolute path under `/mnt/`
that is not the root of `/mnt`; reject colons; keep the traversal and NUL-byte
checks. Applied to `user_create` and `user_update`. `validateTrueNASPath` is
unchanged everywhere else.

---

## 4. `snapshot_task_run` is broken upstream — cannot be fixed here

**Evidence: reproduced live and read from upstream source. Not fixable; the error message is now useful.**

```
snapshot_task_run {"id": 14}
  ->  [EINVAL] 'PeriodicSnapshotTaskQueryResultItem' object is not subscriptable (code 22)
```

Task 14 was valid and `PENDING` immediately before and after. The `[EINVAL]`
reads like a caller mistake; it is a Python `TypeError` leaking through the
middleware. From `plugins/snapshot.py` on `origin/release/26.0.0-BETA.1`:

```python
task = await self.get_instance(id_)

if not task["enabled"]:                    # <- TypeError
    raise CallError("Task is not enabled")

await self.middleware.call("zettarepl.run_periodic_snapshot_task", task["id"])
```

`pool.snapshottask` is declared `CRUDService[PeriodicSnapshotTaskEntry]`, so
`get_instance` returns a **pydantic model**, not a dict. Fixed upstream in
commit **`b237df99` (NAS-140147, 27.0.0-BETA.1)**, which rewrote the body to
`task.enabled` / `task.id`. No argument makes the 26.0 call succeed. The task's
schedule keeps running normally — only run-it-now is broken.

### Is it a class? Yes — a class of exactly one

Worth stating how that was bounded, because the obvious instrument gives the
wrong answer. Grepping for "a `get_instance` result that is later subscripted"
finds **53 sites**. That over-collects badly: `get_instance` returns
`query(...)[0]`, and only services declared with a **generic type parameter**
return models — every other service still returns dicts, so 49 of those 53 are
correct code.

On this release exactly **four** services are generic-parameterised:

| Service | `run()`-style subscript? |
|---|---|
| `pool.snapshottask` | **yes — the bug** |
| `system.ntpserver` | no, attribute access throughout |
| `initshutdownscript` | no |
| `cronjob` | no |

The other five annotated methods on `pool.snapshottask` (`do_create`,
`do_update`, `do_delete`, `max_count`, `max_total_count`) use `old.dataset` /
`new.enabled`. The remaining subscripts in that file are on `replication_task`,
which comes from a dict-returning service.

### ⚠ The obvious workaround has a trap, so the error spells it out

`snapshot_create` reproduces the effect — but retention is **name-derived, not
creator-derived**. From `zettarepl/snapshot/task/snapshot_owner.py`, a task owns
a snapshot only when:

- the dataset is in the task's tree (`owns_dataset`), **and**
- the snapshot's name parses against the task's `naming_schema`, **and**
- `schedule.should_run(<the timestamp parsed out of that name>)` is true.

So a snapshot created by hand "now" — at a minute the schedule would not have
fired — is owned by **no** task and is **never pruned by any lifetime**. On a
NAS, a helpful automatic fallback would therefore fill the pool silently.

**Decision: no automatic fallback.** A fallback that quietly fills a pool is
worse than an error. Instead the action detects the failure and raises a
diagnosis naming the cause, the upstream fix version, the task's own
`dataset` / `recursive` / `naming_schema` / `schedule` (fetched best-effort), and
the retention constraint in full. Unrelated errors pass through untouched.

---

## 5. Nothing reported this server's own version

**Evidence: the deployed build is inferred, not read. Gate added.**

The premise this started from was that production ran a pinned `:v1.1.1` while
master was `1.2.1` — that shipped fixes were sitting undeployed and the release
path had rotted. Both halves are false:

- Release CI is green through `v1.2.1`; every artefact was built and pushed.
- The deployed backend, probed through the gateway, returns v1.2.0's
  summary-by-default reporting shape (aggregations plus `data_points`, not 3601
  raw points) **and** honours v1.2.1's `unit` / `page` (`page: 3` yields a
  three-hour window where `page: 1` yields one hour). Both present implies
  ≥ v1.2.1, which is master.

**Scope of that claim, stated because it matters:** this is *behavioural
inference through the tool plane, not a read of the backend's image pin.* The
authoritative check is `GET /api/v1/backends/truenas` on the gateway's admin
plane, which requires an admin credential this work did not have.

The real defect is that the question needed inferring at all. `BUILD_VERSION`
has always existed and `--version` prints it, but nothing exposed it over the
tool plane, so "what is actually deployed?" could only be answered by exec-ing
into a container — and was consequently answered from memory, and drifted. This
repository's own `CLAUDE.md` already carries a note that the recorded pin
drifted twice.

**Fix:** `system_mcp_version` (tier 3). One read-only call, answerable even when
the NAS is unreachable, which is exactly when you need it. A recorded fact with
nothing checking it decays into a claim; this is the check.

---

## Summary

| # | Defect | Evidence | Outcome |
|---|---|---|---|
| 1 | `snapshot_list` filtered client-side after server-side paging | reproduced live | fixed — filter pushed to the server |
| 2 | no file content read/write | surface enumerated live; HTTP contract from source; transfers not live-exercised | `filesystem_get` + `filesystem_put` added; **delete impossible, documented** |
| 3 | `/mnt/` guard applied to `home` | reproduced live | fixed — `validateHomeDirectory` |
| 4 | `snapshot_task_run` EINVAL | reproduced live + upstream source | upstream bug; actionable diagnosis added |
| 5 | own version unreportable | inferred | `system_mcp_version` added |

Three of the five were quiet failures — an empty list, a rejected-but-valid
value, and a version nobody could check. None of them errored in a way that
pointed at itself. That is the recurring shape worth remembering from this
session, more than any individual fix.
