# Configuration

All configuration is via environment variables. The server has no
config file — secrets and connection details belong in your MCP client
configuration, your shell environment, or a secrets manager.

## Required

### `TRUENAS_URL`

The TrueNAS WebSocket endpoint.

```
TRUENAS_URL=wss://truenas.local:444
```

Accepted forms:

| Form | Behavior |
|---|---|
| `wss://host:444` | WebSocket over TLS — preferred |
| `https://host` | Treated as `wss://host`, default port |
| `ws://host:444` | Plaintext WebSocket — accepted with a stderr warning |
| `http://host` | Treated as `ws://host` — accepted with a stderr warning |

The server always connects to `/websocket` on the host — do not
include the path in `TRUENAS_URL`.

Plaintext schemes (`ws://`, `http://`) emit a stderr warning at
startup:

```
Warning: Connecting over plaintext (no TLS). API key will be transmitted unencrypted.
```

The TrueNAS middleware itself revokes API keys used over unencrypted
connections, so plaintext does not work in practice — the warning is
defensive belt-and-suspenders.

The legacy variable `TRUENAS_HOST` is accepted as an alias for backward
compatibility with the upstream `spranab/truenas-mcp` configuration.
Prefer `TRUENAS_URL` for new deployments.

### `TRUENAS_API_KEY`

The API key generated in the TrueNAS UI under `My API Keys`.

```
TRUENAS_API_KEY=1-aBc...
```

The key inherits whatever permissions the user it's tied to has. For a
home admin this is typically full root scope; in a more locked-down
deployment, the API key user should have the minimum scope needed for
the actions you intend to call.

The key is never logged, never written to MCP responses, and never
transmitted via the MCP transport — only over the TrueNAS WebSocket
connection during initial authentication.

## Optional

### `TRUENAS_VERIFY_SSL`

Default: `true` (verify TLS certificates).

```
TRUENAS_VERIFY_SSL=false
```

Set to `false` for self-signed certificates. The server warns on
startup when verification is disabled. Per-connection setting only —
the server does not mutate
`process.env.NODE_TLS_REJECT_UNAUTHORIZED` (which would affect every
TLS connection in the process).

### `TRUENAS_LOG_LEVEL`

Default: `error`.

```
TRUENAS_LOG_LEVEL=info
```

Accepted values: `error`, `warn`, `info`, `debug`. Logs are JSON-line
formatted to stderr (stdout is reserved for MCP JSON-RPC traffic).

| Level | What's logged |
|---|---|
| `error` | Authentication failures, fatal connection errors only |
| `warn` | The above + reconnect attempts, send errors, timeouts |
| `info` | The above + per-call start/end with method name and duration |
| `debug` | The above + WebSocket lifecycle events (connect, auth, close) |

The logger never logs **method parameters** or **response bodies** —
both could contain secrets. If you need to inspect parameter values,
do so with the TrueNAS audit log on the server side, not here.

Sample output at `info`:

```json
{"ts":"2026-04-29T10:23:11.481Z","level":"info","reqId":"7a4d-...","method":"pool.query","durMs":42}
{"ts":"2026-04-29T10:23:12.103Z","level":"info","event":"ws.connect","url":"truenas.local:444"}
```

### `TRUENAS_KEEPALIVE_INTERVAL_MS`

Default: `0` (disabled).

```
TRUENAS_KEEPALIVE_INTERVAL_MS=30000
```

Milliseconds between idle `system.info` pings to the TrueNAS
WebSocket. Useful only for **persistent-mode deploys** where the
WebSocket lives across many MCP requests.

Whether it helps depends on how your gateway runs the backend. A
**stateless, per-request** gateway spawns a fresh backend (and a fresh
WebSocket) for each call and tears it down after, so keepalive is
pointless — hence the `0` default. A **persistent / supervised**
backend (e.g. an `sr-mcp-gateway` process- or container-strategy
backend) holds the WebSocket open across calls, so a positive value
(typically 30000–60000) can prevent idle disconnects. Set it only with
evidence of idle-disconnect issues in your topology.

The keepalive timer is `unref`'d so it never holds the process open
on its own.

### `TRUENAS_SKIP_PREFLIGHT`

Default: unset (preflight runs).

```
TRUENAS_SKIP_PREFLIGHT=1
```

Set to `1` to bypass the startup health check. The server normally
verifies that it can connect, authenticate, and execute a trivial
read against TrueNAS before announcing MCP capabilities — this
catches misconfigurations at startup rather than at the first MCP
call. Set this only when TrueNAS may legitimately be unreachable at
MCP startup (lab environments, intermittent VPN, etc.).

## Configuration via MCP client

The recommended pattern is to put environment variables into the MCP
client's server config rather than the shell environment. Example
Claude Code settings:

```json
{
  "mcpServers": {
    "truenas": {
      "command": "sr-truenas-mcp",
      "env": {
        "TRUENAS_URL": "wss://truenas.local:444",
        "TRUENAS_API_KEY": "1-your-key-here",
        "TRUENAS_VERIFY_SSL": "false",
        "TRUENAS_LOG_LEVEL": "info"
      }
    }
  }
}
```

The MCP client passes the `env` block to the spawned server process.
This keeps the API key out of your global shell environment and out
of any history files.

## Secret handling

The API key is the most sensitive value here. Some patterns that work
well:

- **Bitwarden / Vaultwarden**: store the key, retrieve at MCP-client
  start via a wrapper script that writes the env var.
- **macOS Keychain / Linux Secret Service**: use `secret-tool` or
  `security` to fetch at runtime.
- **A dedicated `.env` file with restrictive permissions** (`chmod 600`),
  loaded by a wrapper script. Less ideal, easy to leak via backups.
- **Direct in MCP client config**, accepting that the config file
  itself is now sensitive. Restrict the file's read permissions.

The MCP server itself does not read `.env` files — keep that handling
on the client side.

## API key rotation

When you rotate the TrueNAS API key:

1. Generate a new key in TrueNAS UI (`My API Keys` → `Add`).
2. Update the `TRUENAS_API_KEY` env value in your MCP client config.
3. Restart the MCP client (so it respawns the server with the new
   env).
4. After confirming the new key works, delete the old key in TrueNAS
   UI (`My API Keys` → `Delete`).

Keys do not have an expiration mechanism in the TrueNAS UI as of
SCALE 25.10 / 26.0 / 27.0 — rotation is operator-driven.

## Troubleshooting

If the preflight check fails at startup, the stderr output names the
exact failure mode (cannot connect, authentication rejected, trivial
call rejected). See [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) for
common cases and remediation.
