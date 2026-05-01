# Installation

This guide assumes the reader is a TrueNAS administrator. Familiarity
with shell, environment variables, and the TrueNAS web UI is expected;
Node.js development experience is not.

If you're already familiar with MCP servers, the
[Quick install](../README.md#quick-install) section in the README is
the fastest path. This document covers the longer details.

## Before you start

You will need:

1. **A TrueNAS SCALE installation** with the WebSocket middleware
   reachable. By default, this is on TCP port 444 over TLS (`wss://`).
   Verify with `curl -kI https://your-truenas:444/api/docs` — a
   200 response means the middleware is reachable.
2. **A TrueNAS API key.** In the TrueNAS UI: top-right user menu →
   `My API Keys` → `Add` → name it (e.g., `sr-truenas-mcp`) → choose
   the username it inherits permissions from (typically the admin
   user) → `Save`. **Copy the key immediately** — TrueNAS will not
   show it again.
3. **One of**: the prebuilt Linux binary, Docker, Node.js 18+, or the
   ability to run `npm install` from source.

## Installation paths

### 1. Standalone Linux binary (recommended for most users)

```bash
# Download the latest release tarball
curl -L \
  https://github.com/staticrevolution-com/sr-truenas-mcp/releases/latest/download/sr-truenas-mcp-linux-x64.tar.gz \
  | tar xz

# Verify
chmod +x sr-truenas-mcp
./sr-truenas-mcp --version
# Expected: 1.1.0+<git-sha>

# Move into PATH (optional)
sudo mv sr-truenas-mcp /usr/local/bin/
```

Verify the SHA256 against the release page:

```bash
curl -L \
  https://github.com/staticrevolution-com/sr-truenas-mcp/releases/latest/download/sr-truenas-mcp-linux-x64.tar.gz.sha256 \
  | sha256sum --check
```

The binary embeds Node.js 20 and is self-contained. Linux x64 only.

### 2. Docker

```bash
docker pull ghcr.io/staticrevolution-com/sr-truenas-mcp:latest

docker run -i --rm \
  -e TRUENAS_URL=wss://truenas.local:444 \
  -e TRUENAS_API_KEY=$(cat ~/.truenas-key) \
  -e TRUENAS_VERIFY_SSL=false \
  ghcr.io/staticrevolution-com/sr-truenas-mcp:latest
```

Pin to a specific version with `:v1.1.0` instead of `:latest` for
reproducible deploys.

### 3. From npm (Node.js 18+)

```bash
npm install -g sr-truenas-mcp     # global
sr-truenas-mcp --version

# OR per-project
npm install sr-truenas-mcp        # local
npx sr-truenas-mcp --version
```

### 4. From source

```bash
git clone https://github.com/staticrevolution-com/sr-truenas-mcp.git
cd sr-truenas-mcp
npm install
npm run build
node dist/cli.js --version
```

Run the test suite to confirm a clean build:

```bash
npm test
```

Expect `211 passed`.

## MCP client integration

### Claude Code

Edit your Claude Code settings — typically at `~/.claude/settings.json`
or `~/.config/claude/settings.json`. Add an entry to `mcpServers`:

```json
{
  "mcpServers": {
    "truenas": {
      "command": "sr-truenas-mcp",
      "env": {
        "TRUENAS_URL": "wss://truenas.local:444",
        "TRUENAS_API_KEY": "1-your-key-here",
        "TRUENAS_VERIFY_SSL": "false"
      }
    }
  }
}
```

Restart Claude Code. The `truenas` tool should appear in `/mcp`. If
the binary is not on `PATH`, replace `"command": "sr-truenas-mcp"`
with the absolute path:

```json
"command": "/usr/local/bin/sr-truenas-mcp"
```

For the from-source / npm-local path:

```json
{
  "mcpServers": {
    "truenas": {
      "command": "node",
      "args": ["/path/to/sr-truenas-mcp/dist/cli.js"],
      "env": { "TRUENAS_URL": "wss://...", "TRUENAS_API_KEY": "...", "TRUENAS_VERIFY_SSL": "false" }
    }
  }
}
```

### Claude Desktop

Edit `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "truenas": {
      "command": "sr-truenas-mcp",
      "env": {
        "TRUENAS_URL": "wss://truenas.local:444",
        "TRUENAS_API_KEY": "1-your-key-here",
        "TRUENAS_VERIFY_SSL": "false"
      }
    }
  }
}
```

Restart Claude Desktop. Look for the connection icon (bottom-right
of the message input) — clicking it should list `truenas` among the
connected MCP servers.

### VS Code (with MCP extension)

Add to `.vscode/mcp.json` (per-project) or your user MCP config:

```json
{
  "servers": {
    "truenas": {
      "command": "sr-truenas-mcp",
      "env": {
        "TRUENAS_URL": "wss://truenas.local:444",
        "TRUENAS_API_KEY": "1-your-key-here",
        "TRUENAS_VERIFY_SSL": "false"
      }
    }
  }
}
```

### AgentGateway (or other MCP gateway)

Add as a stdio target. Example AgentGateway `config.yaml` snippet:

```yaml
backends:
  - mcp:
      targets:
        - name: truenas
          stdio:
            cmd: /usr/local/bin/sr-truenas-mcp
            env:
              TRUENAS_URL: "${TRUENAS_URL}"
              TRUENAS_API_KEY: "${TRUENAS_API_KEY}"
              TRUENAS_VERIFY_SSL: "${TRUENAS_VERIFY_SSL}"
```

## TLS and certificate handling

If your TrueNAS uses a properly issued certificate (Let's Encrypt or
similar), leave `TRUENAS_VERIFY_SSL` unset or `true`.

If your TrueNAS uses a self-signed cert (the default for most home
installs), set `TRUENAS_VERIFY_SSL=false`. The server emits a stderr
warning every startup so the security trade-off is visible:

```
Warning: TLS certificate verification is disabled (TRUENAS_VERIFY_SSL=false)
```

This is acceptable on a trusted LAN. Avoid it across an untrusted
network — use a real cert or tunnel through Tailscale / Wireguard.

## Smoke test

After installation, with the env vars set, run:

```bash
sr-truenas-mcp < /dev/null
```

The server runs the preflight check (connect, authenticate, single
read), prints the result to stderr, and exits because stdin is closed.
A successful preflight looks like:

```
sr-truenas-mcp 1.1.0+abc1234 — preflight OK
```

A failed preflight prints the connection details and the underlying
error. See [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) for common cases.

## Updating

Binary: re-run the curl install. The `--version` output will reflect
the new build.

Docker: `docker pull ghcr.io/staticrevolution-com/sr-truenas-mcp:latest`,
then restart your MCP client (or the gateway hosting it).

npm: `npm update -g sr-truenas-mcp`.

Source: `git pull && npm install && npm run build`.

## Uninstalling

Remove the entry from your MCP client's config, then:

```bash
sudo rm /usr/local/bin/sr-truenas-mcp        # binary path
npm uninstall -g sr-truenas-mcp              # npm global
docker rmi ghcr.io/staticrevolution-com/sr-truenas-mcp  # image
```

Revoke the TrueNAS API key via the TrueNAS UI (`My API Keys` →
`Delete`) when you're done with it. Even if the binary is gone, the
key remains active until revoked.
