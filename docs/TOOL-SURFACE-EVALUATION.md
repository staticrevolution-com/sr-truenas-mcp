# Tool Surface Evaluation — Dispatcher vs Flat Tools

**Status:** Evaluation / not scheduled · **Opened:** 2026-05-18 · **Origin:** `sr-mcp-gateway` planning

A tracking note (GitHub Issues are disabled on this repo). Records a design question raised while
planning `sr-mcp-gateway` — the standalone MCP gateway that has since replaced `sr-agentgateway`
in production. No change is committed here; this is the analysis and the recommended position.

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
category + tier metadata cleanly machine-readable for a consuming gateway.

**Verified 2026-05-18 (current state):** the discovery modes return **formatted text, not
structured data**. `Registry.listCategories()` and `Registry.listActions()` in `src/registry.ts`
build human/LLM-readable strings; per-action destructiveness is surfaced as inline `[destructive:
…]` text tags (see the tool description in `src/mcp-adapter.ts`). The `category` and `tier`
information is all present, but a consuming gateway would have to **parse prose** to extract it.

### Follow-up item — structured discovery output (deferred)

A small, additive, non-breaking enhancement: give the discovery modes a structured form so a
consuming gateway can enumerate the constraint vocabulary without scraping text. Concretely, one
of:

- a `format: "json"` (or similar) option on the `truenas` tool's discovery modes that returns,
  per action, `{ name, category, tier, destructive, params }`; or
- an additional structured MCP Resource listing every action with its `category` and `tier`.

**Why it matters:** `sr-mcp-gateway` (the agentgateway replacement) implements *argument-scoped
RBAC grants* — a token can be granted the `truenas` tool restricted to e.g. `category ∈
{storage, reporting}` or to read-only (tier-3) actions. Building and validating those constraints
is far cleaner against structured metadata than against parsed prose.

**When to do it:** not now, and not blocking. It becomes relevant at **`sr-mcp-gateway` Phase C
(Auth & RBAC)**. Fold it into that Phase C work — at which point the exact shape the gateway
wants is known. Until then the gateway can be handed the category/tier vocabulary manually. A
per-category tool split (~17 tools) remains the heavier middle-ground option if finer
protocol-level schemas are ever genuinely needed; it is not justified now.

## Decision

Keep the dispatcher design as-is — no tool-surface redesign. One follow-up is on record (above):
add a structured discovery output for category/tier metadata, deferred to `sr-mcp-gateway`
Phase C. There is **no mandatory work** in this repo arising from this evaluation.
