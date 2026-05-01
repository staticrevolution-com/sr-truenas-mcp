# Contributing

Issues and bug reports welcome. For feature work, please open an issue
first to discuss scope before starting on a PR — the action surface
and safety classifications are opinionated and a PR that doesn't fit
the design will be hard to merge regardless of code quality.

## Reporting bugs

Use the GitHub issue tracker. The bug-report template asks for:

- Version (`sr-truenas-mcp --version` output)
- TrueNAS SCALE version
- The MCP client used (Claude Code, Claude Desktop, VS Code, etc.)
- The specific action invoked, with parameters (redact secrets)
- Expected vs. actual behavior
- Relevant logs (set `TRUENAS_LOG_LEVEL=debug` for structured logs;
  output goes to stderr)

For security vulnerabilities, see [`SECURITY.md`](SECURITY.md). Don't
file security issues in public.

## Submitting a pull request

Before opening a PR:

1. **Discuss in an issue first** unless the change is a small,
   self-evident bug fix. Larger changes that don't fit the project's
   direction will be closed; a five-minute conversation up front
   saves an hour of work later.
2. Run the test suite locally — `npm test`. New code needs new tests.
3. Run `npm run audit:counts` and confirm the doc-sync test
   (`src/__tests__/doc-sync.test.ts`) still passes. If you change
   filter patterns, tier counts, or validation call sites, update
   `CLAUDE.md` to match in the same PR.
4. Run `npm run type-check` — clean tsc output.
5. **Sign your commits with DCO.** See below.

PRs from forks should target the `master` branch.

## Developer Certificate of Origin (DCO)

Every commit must be signed off with a Developer Certificate of Origin
(DCO) line:

```
Signed-off-by: Your Name <your.email@example.com>
```

Add it automatically with `git commit -s`. The DCO is a lightweight
contributor agreement — by signing off you certify that you wrote the
patch (or have the right to submit it under the project's license),
per the terms at <https://developercertificate.org>.

By signing off and submitting a contribution to this project, you agree
to license your contribution under the project's
[PolyForm Noncommercial 1.0.0 license](LICENSE). If your contribution
incorporates code from another project, that project's license must be
compatible — please flag this in the PR description.

## Coding standards

- TypeScript, ES modules, Node 20 LTS target.
- Tests live under `src/__tests__/`, mirroring the source structure.
  Vitest is the runner.
- New TrueNAS actions: add the handler to the appropriate
  `src/tools/*.ts` file, classify in `src/safety.ts`, add Zod schema
  for parameters, add a test in `src/__tests__/handlers.test.ts`.
- Avoid introducing new direct dependencies without discussion.
- Keep handler logic thin — the registry handles tier checks, schema
  validation, and response filtering. Handlers should call the
  TrueNAS client and return raw data.

## Adding a new TrueNAS action

The minimum diff for a new action:

1. **Classify it** in `src/safety.ts`. Decide tier 0–3. Tier-0
   means it does not register; only use this for actions that cannot
   be made safe within the MCP surface (arbitrary command execution,
   bypass mechanisms, irrecoverable system operations).
2. **Add the handler** in the appropriate `src/tools/*.ts`. Use a
   tight Zod schema — enums for known value sets, regex for naming
   conventions, length bounds for strings. Avoid `z.unknown()` and
   `z.record(z.string(), z.unknown())` — those are signals you need
   to read the TrueNAS docs more carefully.
3. **Add a path/dataset-name validation call** if the handler accepts
   filesystem paths or ZFS dataset names. See `src/validation.ts`.
4. **Add a test.** Cover at minimum: schema rejects invalid input;
   handler calls the right TrueNAS method with the right params;
   response is sanitized for any sensitive fields the response shape
   may contain.
5. **Update `CLAUDE.md`** if the action count, tier counts, or
   validation call site counts change. The doc-sync test will fail
   in CI if you don't.

## What I'm unlikely to merge

- Adding a raw-API escape hatch ("call any TrueNAS method with
  arbitrary params"). The upstream had one; it was the first thing
  removed for safety reasons. Don't reintroduce it.
- Loosening tier classifications (moving an action down a tier).
  Almost always the wrong direction; if a tier feels too strict in
  practice, the discussion is in an issue, not a PR.
- New transport layers (REST, gRPC, others). WebSocket is the
  long-term path; supporting multiple transports doubles the surface
  with no real benefit.
- Removing tests "to make the suite faster." If a test is genuinely
  redundant, that's an issue worth opening; targeted removal as part
  of an unrelated PR is not.

## Running locally

```bash
git clone https://github.com/staticrevolution-com/sr-truenas-mcp.git
cd sr-truenas-mcp
npm install
npm run build
npm test
```

For an end-to-end test against a real TrueNAS:

```bash
export TRUENAS_URL=wss://your-truenas.local:444
export TRUENAS_API_KEY=...
export TRUENAS_VERIFY_SSL=false
node dist/cli.js < /dev/null   # confirms preflight passes
```

The `< /dev/null` closes stdin so the MCP server exits after preflight.
For a live MCP session, attach a real client.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md)
version 2.1. Reports of unacceptable behavior go to
`admin@staticrevolution.com`.
