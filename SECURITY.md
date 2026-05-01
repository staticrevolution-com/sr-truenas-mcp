# Security Policy

## Reporting a vulnerability

Please **do not** report security vulnerabilities via public GitHub issues,
discussions, or pull requests. Reports filed publicly leave the affected
TrueNAS deployments exposed for the time it takes to coordinate a fix.

Email vulnerability reports to **admin@staticrevolution.com** with the
subject line `sr-truenas-mcp security report: <short summary>`.

If possible, include:

- A description of the issue and the affected component
  (`src/registry.ts`, `src/client.ts`, etc.)
- Steps to reproduce, or a proof-of-concept
- The version (or commit) you tested against — `sr-truenas-mcp --version`
  prints the version + build SHA
- Your TrueNAS SCALE version, if relevant
- Any thoughts on severity, exploitability, or remediation

Encryption of the report is welcome but not required. If you would like
to use PGP, request a key in your initial unencrypted email and I will
respond with a key fingerprint over a side channel before you send the
sensitive content.

## Scope

In scope:

- Bypass of the safety-tier confirmation gates (tier 0 actions becoming
  callable, tier 1/2 actions executing without `confirm`/`reason`)
- Information leakage in MCP responses — secrets, keys, tokens, hashes,
  recovery codes, or other sensitive fields not redacted by
  `filterSensitiveFields`
- Path traversal or sandbox escape via filesystem-touching handlers
- Authentication bypass against TrueNAS (e.g., API key being misused)
- Code injection via crafted MCP tool parameters
- Denial of service against the MCP server itself (handler crashes,
  infinite loops, resource exhaustion that affects more than the
  current MCP call)
- Supply chain concerns specific to this project (compromised release
  artifacts, unintended dependencies)

Out of scope:

- Vulnerabilities in TrueNAS SCALE itself — please report those to
  iXsystems via [their security policy](https://www.truenas.com/docs/solutions/security/)
- Vulnerabilities in upstream npm dependencies that are not exploitable
  through this project — please report those to the relevant project
  (we will adopt fixes via dependency updates)
- Vulnerabilities in the upstream `spranab/truenas-mcp` codebase as it
  exists today (this is a fork; the differences are documented in
  `COMPARISON.md`)
- LLM-prompt-injection attacks against the calling agent itself, where
  the attack is not made worse by anything specific to this server
- Issues that require physical access to the TrueNAS host or the
  workstation running the MCP client

## Response timeline

For a solo-maintained project this is what I commit to. If a real
report comes in and I'm going to miss one of these targets, I will
email you with a status update — silence is not an acceptable response.

| Stage | Target |
|---|---|
| Acknowledgment of receipt | Within **7 days** of report |
| Triage and severity assessment | Within **14 days** of report |
| Fix or documented workaround for High/Critical | Within **30 days** of report |
| Public disclosure (coordinated) | At the earlier of: fix shipped, or **90 days** from initial report |

Severity is assessed using CVSS 3.1 plus context — the same vulnerability
in a tier-1-gated handler vs. a tier-3 read has different real-world
risk and may produce different priority in practice.

## Disclosure

I follow coordinated disclosure. The standard flow:

1. You report. I acknowledge.
2. I confirm the issue and develop a fix.
3. We agree on a disclosure date — typically the day a fix release ships.
4. The fix is released as a tagged version. The release notes describe
   the issue at a level that helps users decide whether to upgrade,
   without serving as a how-to.
5. Optionally, a CVE is requested. If you would like CVE attribution
   under your name or handle, say so when you report.

If a vulnerability is being actively exploited in the wild, the
timeline collapses — fix and public advisory ship the same day,
without a coordination window.

## Supported versions

| Version | Supported |
|---|---|
| 1.0.x | ✅ Active |
| < 1.0 | ❌ Pre-release; not supported |

`1.0.x` is the first public release line and is actively maintained.
When a future minor version (`1.1.x`, `1.2.x`, …) ships, the prior
minor will receive security fixes only on a best-effort basis, and
only if the fix is reasonably backportable. This table will be
updated when that happens.

## Architectural notes for security researchers

A few things that may save you time:

- The threat model assumes the LLM operator is non-malicious but
  fallible. Findings that require an adversarial LLM specifically
  attacking the server are less interesting than findings that
  compromise a well-meaning LLM through an unsafe surface.
- All destructive-action gating is centralized in `src/registry.ts`,
  enforced at registration and execution time. Bugs in the gate
  itself are higher severity than bugs in any individual handler.
- Path validation is in `src/validation.ts` (`validateTrueNASPath`,
  `validateDatasetName`); response filtering is in `src/filters.ts`
  (`filterSensitiveFields`). Test fixtures for both live in
  `src/__tests__/`.
- Secret redaction is post-call (filter applies to handler return
  values). Pre-call redaction would not address response-side leakage,
  which is the dominant concern.
- The TrueNAS API key has whatever scope the user grants it. If the
  key has admin scope, every action this server exposes can be
  executed by it — the server's safety surface protects against
  accidental misuse, not against an attacker who has obtained the
  key. API key handling and rotation is the operator's responsibility.

Thanks for taking the time to look.
