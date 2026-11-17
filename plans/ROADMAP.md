# Roadmap — sr-truenas-mcp

Later work, nothing started. An entry moves to [`OPEN-PLAN.md`](./OPEN-PLAN.md)
when it does. Markers as in that file.

- [ ] Phase C-1: migrate to MCP SDK 2.0 — `src/mcp-adapter.ts` exists to keep that a one-file change
- [ ] Replace `@yao-pkg/pkg` with Node's own single-executable-application build, once a Linux-on-Linux build host is the only build path
- [ ] A memory/swap/ARC summary action, and a kernel-log read — the ZFS-NAS-shaped hole the 2026-08-21 investigation ran into
- [ ] Per-action MCP annotations, so a gateway can filter by read-only or destructive without parsing discovery output
- [ ] Revisit the single-dispatcher design if a measured RBAC or schema-granularity need appears; the current recommendation is to keep it
