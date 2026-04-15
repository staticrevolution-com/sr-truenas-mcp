# sr-truenas-mcp

Hardened MCP server for TrueNAS SCALE. Fork of `spranab/truenas-mcp`.

## Build & Test

```bash
npm install
npm run build    # tsc
npm test         # vitest run
npm run dev      # tsc --watch
```

## Architecture

Single MCP tool (`truenas`) with hierarchical discovery: 278 actions across 17 categories, exposed through 3 modes (list categories, list actions, execute).

### Key Files

- `src/index.ts` — MCP server setup, single `truenas` tool with 3 modes
- `src/registry.ts` — Tool registry, categorization, safety enforcement (Phase 1+)
- `src/client.ts` — TrueNAS API client (REST v2.0 now, WebSocket JSON-RPC 2.0 after Phase 2)
- `src/safety.ts` — Tier classification map (pure data, every action → tier)
- `src/tools/*.ts` — 8 tool modules registering 278 handlers
- `src/tools/index.ts` — `buildRegistry()` wiring
- `src/resources.ts` — 12 read-only MCP Resources

### Safety Tiers

| Tier | Gate | Count | Examples |
|------|------|-------|---------|
| 0 — Blocked | Never registered | 8 | `system_reboot`, `truenas_api_call`, `cronjob_create` |
| 1 — Confirm+Reason | `confirm: true` + `reason: "string"` | 14 | `pool_export`, `disk_wipe`, `dataset_delete` |
| 2 — Confirm | `confirm: true` | ~69 | `service_stop`, `user_delete`, `vm_delete` |
| 3 — Open | None | ~187 | All reads, safe creates, queries |

Full tier assignments in `src/safety.ts`.

### Hardening Phases

0. Repository foundation (CI, tests, safety tier data) — **current**
1. Safety enforcement in registry + escape hatch removal
2. WebSocket JSON-RPC 2.0 client rewrite
3. Tool handler migration (REST → WebSocket calls)
4. Path validation + response filtering
5. Integration tests + build config

## Environment Variables

| Var | Required | Description |
|-----|----------|-------------|
| `TRUENAS_URL` | Yes | TrueNAS instance URL (e.g., `https://192.168.1.235`) |
| `TRUENAS_API_KEY` | Yes | API key from TrueNAS UI |
| `TRUENAS_VERIFY_SSL` | No | Set `false` to skip TLS verification |

## MCP Config (Claude Code)

```json
{
  "mcpServers": {
    "truenas": {
      "command": "node",
      "args": ["D:/github-local/staticrevolution-com/sr-truenas-mcp/dist/cli.js"],
      "env": {
        "TRUENAS_URL": "https://192.168.1.235",
        "TRUENAS_API_KEY": "...",
        "TRUENAS_VERIFY_SSL": "false"
      }
    }
  }
}
```
