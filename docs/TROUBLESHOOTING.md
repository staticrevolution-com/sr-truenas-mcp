# Troubleshooting

If something is broken, start by running the preflight check:

```bash
sr-truenas-mcp < /dev/null
```

That closes stdin, so the server exits after preflight. The stderr
output identifies the failure mode.

If preflight passes but actual MCP calls fail, set
`TRUENAS_LOG_LEVEL=debug` and inspect the structured logs.

## Connection failures

### `Error: connect ECONNREFUSED <ip>:444`

TrueNAS WebSocket port is not reachable. Check:

1. **Is TrueNAS up?** `ping <truenas-host>` or load the web UI.
2. **Is the port right?** TrueNAS typically uses TCP 444 for the
   WebSocket middleware. Check `System Settings → General → GUI`
   for `HTTPS Port`. Append it to `TRUENAS_URL`:
   `wss://truenas.local:444`.
3. **Is there a firewall in the way?** `nc -vz truenas.local 444`
   should succeed.
4. **Did you put the path on the URL?** `TRUENAS_URL` should be just
   the host (and port). The server appends `/websocket` itself. A
   value like `wss://truenas.local:444/api` will not work.

### `Error: unable to verify the first certificate`

TrueNAS is using a self-signed certificate (default for most home
installs) and `TRUENAS_VERIFY_SSL` is true (the default).

Set `TRUENAS_VERIFY_SSL=false` to skip verification. Acceptable on a
trusted LAN; avoid on untrusted networks. The startup warning is the
visible signal that this is happening.

For a proper fix, install a real cert in TrueNAS (`Credentials →
Certificates`) or front the TrueNAS UI with a reverse proxy that
terminates TLS with a real cert.

### `WebSocket was closed before the connection was established`

The TLS handshake failed before the WebSocket upgrade. Common causes:

- **TLS version mismatch.** TrueNAS SCALE 25.10+ enforces TLS 1.2+.
  Older Node.js versions or middleboxes that downgrade may fail here.
- **Proxy / VPN interference.** Some corporate proxies inspect TLS
  traffic and break WebSocket upgrades. Bypass the proxy or terminate
  the upgrade outside the proxy.
- **Hostname mismatch.** Connecting via IP to a cert that requires a
  hostname (Subject Alternative Name) → this fails verification.
  Either use the hostname or set `TRUENAS_VERIFY_SSL=false`.

## Authentication failures

### `Authentication failed`

The TrueNAS API key was rejected. Check:

1. **Is the key still valid?** TrueNAS UI → `My API Keys`. If the key
   isn't listed, it was deleted; create a new one.
2. **Was the key created over a plaintext connection?** TrueNAS revokes
   API keys used over `ws://` or `http://`. If you recently tried a
   plaintext connection, the key may have been auto-revoked.
3. **Does the key have permissions?** Keys inherit the user's
   permissions. If the key is tied to a non-admin user, it will work
   for whatever that user can do, but actions outside that scope will
   fail later (not at auth).
4. **Is the key being read correctly?** If you set
   `TRUENAS_API_KEY=$(cat ~/.truenas-key)` and the file has trailing
   whitespace, the key won't match. Try
   `TRUENAS_API_KEY=$(cat ~/.truenas-key | tr -d '[:space:]')`.

### `Method ... access denied`

Authentication succeeded but the user the API key inherits from
doesn't have permission for this method. Either grant the user the
needed permission in TrueNAS UI, or rotate to a key tied to an admin
user.

This often shows up on `service.*`, `pool.*` write operations, and
audit log queries — actions that require higher privilege than basic
NAS operation.

## Action errors

### `Error: missing 'confirm: true'`

The action is tier 1 or tier 2 — destructive. The first call returns
a warning describing what will happen; the second call must include
`confirm: true` (and `reason` for tier 1):

```js
// First call — returns warning
truenas({ category: "system", action: "service_stop", service: "ssh" })

// Second call — actually runs
truenas({ category: "system", action: "service_stop", service: "ssh",
         confirm: true })
```

This is by design — see README → Architecture → Why a 4-tier safety
classification.

### `Error: missing 'reason' (tier 1)`

Tier 1 actions require both `confirm: true` and a `reason` string.
Reason is logged by your MCP client and helps post-incident review:

```js
truenas({ category: "storage", action: "dataset_delete",
          id: "tank/old", confirm: true,
          reason: "Cleanup of dataset that was migrated to tank/new in 2026-04" })
```

### `Error: action 'X' not found`

The action name is wrong, or the action is tier 0 (never registered).
Discovery flow:

```js
truenas({ mode: "list_categories" })
truenas({ mode: "list_actions", category: "storage" })
```

Tier 0 actions (8 of them: `system_reboot`, `system_shutdown`,
`truenas_api_call`, `cronjob_create`, `cronjob_update`,
`initshutdown_create`, `initshutdown_update`, `system_config_upload`)
are never exposed. Use the TrueNAS UI directly for these.

### `Error: path validation failed`

A handler that accepts a filesystem path got a value that does not
start with `/mnt/`, contains `..`, or contains a null byte. This
is a guardrail to prevent the LLM from being tricked into accessing
arbitrary host paths. Use a path under `/mnt/<pool>/...`.

### `Error: invalid dataset name`

A handler that accepts a ZFS dataset name got a value with an
invalid character or pattern. Dataset names match
`[a-zA-Z0-9._:/-]+`, max 255 characters, no `..`, no null bytes.

## Connection lifecycle issues

### Repeated `Streamable HTTP error: invalid session ID header`

You're running behind AgentGateway and the gateway is in **stateful
mode**. AgentGateway v1.1 has no session GC, returns HTTP 400
instead of 404 on stale sessions, and the MCP client cannot recover
gracefully.

Fix: set `statefulMode: stateless` on the agentgateway MCP backend.
Per-call session creation; stale-session class disappears entirely.

This is a deployment-side fix, not a sr-truenas-mcp issue.

### Long latency on first call after idle

If your deployment uses stateless mode (recommended), every MCP call
spawns a fresh WebSocket connection and authenticates. Cold-start
overhead is typically 100–300ms. This is the expected trade-off.

If you genuinely need persistent connections (specific deployment),
use `TRUENAS_KEEPALIVE_INTERVAL_MS=30000` to keep the connection
warm. Note: this only helps if the connection actually persists; in
stateless gateway mode it has no effect.

## Diagnostic commands

```bash
# Version + build SHA
sr-truenas-mcp --version

# Help / env var reference
sr-truenas-mcp --help

# Preflight only (exit after handshake)
sr-truenas-mcp < /dev/null

# Full debug logging
TRUENAS_LOG_LEVEL=debug sr-truenas-mcp < /dev/null 2>&1 | tee preflight.log

# Verify SHA256 of installed binary
sha256sum $(which sr-truenas-mcp)
```

## Known limitations

These are documented in the README but worth restating:

- **SMART test initiation** is not exposed — the TrueNAS WebSocket
  API doesn't expose it directly. Read SMART results via
  `disk_query`, kick off tests via the TrueNAS UI.
- **`config.save`** (system config download) returns an informational
  message rather than the binary blob — the WebSocket API uses a
  pipe-based mechanism that doesn't fit the JSON-RPC response shape.
  Use the TrueNAS UI for system-config exports.
- **`dataset_set_permissions`** uses `filesystem.setperm` under the
  hood — `pool.dataset.permission` doesn't exist in the WebSocket
  API. Pass the dataset name (e.g., `tank/data`) and the handler
  resolves it to the on-disk path.

## When to file a bug

If preflight passes, your auth works against the TrueNAS UI, and an
action still fails in a way that doesn't match anything above —
that's likely a bug. File at
[github.com/staticrevolution-com/sr-truenas-mcp/issues](https://github.com/staticrevolution-com/sr-truenas-mcp/issues)
with debug logs (`TRUENAS_LOG_LEVEL=debug`) attached. The bug-report
template asks for the right context.
