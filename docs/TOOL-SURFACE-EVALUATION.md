# Tool Surface Evaluation — Dispatcher vs Flat Tools

**Status:** Evaluation / not scheduled · **Opened:** 2026-05-18 · **Origin:** `sr-mcp-gateway` planning

A tracking note (GitHub Issues are disabled on this repo). Records a design question raised while
planning `sr-mcp-gateway` — the standalone MCP gateway being built to replace `sr-agentgateway`.
No change is committed here; this is the analysis and the recommended position.

## The question

`sr-truenas-mcp` exposes **one** MCP tool — `truenas` — a dispatcher whose `category` / `action` /
`params` schema covers **270 actions across 17 categories**, surfaced through 3 modes (list
categories, list actions, execute). The question: does collapsing 270 operations behind one tool
work against MCP's purpose of letting an LLM select and call tools efficiently — and should the
tool surface be redesigned?

## Analysis

Separate the kinds of "efficiency":

- **Runtime call cost** — no difference. A `tools/call` on the dispatcher is one JSON-RPC
  round-trip, identical to a call on a flat tool.
- **Context-window cost** — the dispatcher is the *efficient* choice. Every entry in `tools/list`
  carries its name, description, and full input schema into the model's context every turn. 270
  flat tools would be tens of thousands of tokens of schema; one dispatcher is a single schema.
- **Tool-selection accuracy** — the dispatcher wins. LLM tool-selection degrades sharply across
  hundreds of flat tools; the comfortable range is dozens. The 3-mode hierarchical discovery
  (categories → actions → execute) is a sound mitigation.

The dispatcher design is therefore **deliberate and defensible** — it is the standard answer to
MCP's large-surface scaling problem, not a defeat of MCP's purpose.

Two genuine costs remain:

1. **Per-action input schema is not exposed.** 270 real tools would each carry a precise schema;
   the dispatcher's `params` is a looser object the model populates from descriptions. Mitigated
   by the discovery modes, but it is a real difference in protocol-level guidance and validation.
2. **RBAC granularity in a federated gateway.** `sr-mcp-gateway` enforces a per-token tool
   allowlist. With one `truenas` tool, a token gets **all 270 actions or none** — no "read-only"
   or "storage-category-only" grant is expressible by tool name alone.

## Where this is being solved

Cost (2) is being addressed in `sr-mcp-gateway`, **not here**: its RBAC design now includes
*argument-scoped grants* — a grant of the `truenas` tool can be constrained by argument, e.g.
`category ∈ {storage, reporting}` or to read-only (tier-3) actions. This keeps the dispatcher's
context-window win while restoring per-operation access control. See the `sr-mcp-gateway` design
plan §6.

Crucially, the metadata that feature needs **already exists in this repo**: `src/safety.ts`
classifies every action into tiers 0–3, and the registry groups actions into 17 categories. A
gateway can build argument constraints from `category` and tier today.

## Recommended position

**No tool-surface redesign.** Exploding `truenas` into 270 flat tools — or even ~17 per-category
tools — trades a solvable RBAC gap for a worse context-window and selection-accuracy problem, and
the RBAC gap is being closed in the gateway anyway.

The only concrete, low-cost improvement worth considering **in this repo** is to make the
category + tier metadata cleanly machine-readable for a consuming gateway:

- Confirm the `list categories` / `list actions` discovery modes return each action's `category`
  and safety `tier` in a stable, structured shape (not just prose) — so a gateway can enumerate
  the constrainable vocabulary without scraping descriptions.
- If they do not already, treat that as a small, additive enhancement (no breaking change).

If a future need genuinely calls for finer protocol-level schemas, a per-category tool split
(~17 tools) is the middle ground to revisit then — but it is not justified now.

## Decision

Leave the dispatcher design as-is. Revisit only if the discovery modes turn out **not** to expose
`category`/`tier` structurally — in which case open a small additive enhancement to do so.
