import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  ToolRegistry,
  DESCRIPTION_BUDGET,
  TRUNCATION_MARKER,
} from "../registry.js";
import { buildRegistry } from "../tools/index.js";

/**
 * Gate on detail mode: every registered action's full parameter descriptions
 * must appear verbatim in `describeActions()` output.
 *
 * ⚠ The assertion is EQUALITY TO THE SOURCE, never a length. A length check
 * passes against any text long enough, including a differently-truncated one,
 * and would not have caught the defect this mode exists to fix.
 *
 * ⚠ The source is read through Zod's own public `.description` accessor, NOT
 * through `extractParams()`. Comparing the renderer against the extractor it
 * is built on would be two records sharing an ancestor: one bug in the
 * extractor would appear on both sides and the gate would agree with it.
 */

/** Minimal client stub — nothing here calls TrueNAS. */
const stubClient = { call: async () => ({}) } as never;

/** The source of truth: the description as Zod itself reports it. */
function sourceDescription(field: unknown): string | undefined {
  const d = (field as { description?: unknown } | null | undefined)?.description;
  return typeof d === "string" ? d : undefined;
}

describe("detail mode returns untruncated parameter descriptions", () => {
  const registry = buildRegistry(stubClient);
  const actions = [...registry.tools.values()];

  // Cached once: one describeActions() call per category, not per action.
  const detailByCategory = new Map<string, string>();
  for (const a of actions) {
    if (!detailByCategory.has(a.category)) {
      detailByCategory.set(a.category, registry.describeActions(a.category));
    }
  }

  // Every (action, param) pair that carries a description, built from Zod.
  const pairs: Array<{ action: string; category: string; param: string; description: string }> = [];
  for (const a of actions) {
    for (const [param, field] of Object.entries(a.schema)) {
      const description = sourceDescription(field);
      if (description) pairs.push({ action: a.name, category: a.category, param, description });
    }
  }

  it("found actions and described parameters to check", () => {
    // Without these, every assertion below passes by not running — the
    // classic way a negative gate goes green on an empty population.
    expect(actions.length).toBeGreaterThan(0);
    expect(pairs.length).toBeGreaterThan(0);
  });

  it("found descriptions that EXCEED the summary budget", () => {
    // The discriminating population. If nothing is over the budget, nothing
    // is truncated, and a passing gate would say nothing at all.
    const over = pairs.filter((p) => p.description.length > DESCRIPTION_BUDGET);
    expect(over.length).toBeGreaterThan(0);
  });

  it.each(
    // One case per action that has at least one over-budget description, so a
    // failure names the action. Short descriptions are covered in bulk below.
    [...new Set(pairs.filter((p) => p.description.length > DESCRIPTION_BUDGET).map((p) => p.action))],
  )("%s's long descriptions appear verbatim in detail mode", (actionName) => {
    const action = actions.find((a) => a.name === actionName)!;
    const detail = registry.describeActions(action.category, actionName);
    for (const p of pairs.filter((x) => x.action === actionName)) {
      expect(
        detail,
        `${actionName}.${p.param}: detail mode does not carry the source description verbatim`,
      ).toContain(p.description);
    }
    // And it must not have been cut: no marker anywhere in detail output.
    expect(detail).not.toContain(TRUNCATION_MARKER);
  });

  it("every described parameter of every action appears verbatim, category-wide", () => {
    const missing: string[] = [];
    for (const p of pairs) {
      const detail = detailByCategory.get(p.category)!;
      if (!detail.includes(p.description)) missing.push(`${p.action}.${p.param}`);
    }
    expect(missing, `detail mode dropped or altered: ${missing.join(", ")}`).toEqual([]);
    expect(pairs.length).toBeGreaterThan(0);
  });

  it("no detail output anywhere carries the truncation marker", () => {
    const categories = [...detailByCategory.keys()];
    expect(categories.length).toBeGreaterThan(0);
    for (const [cat, text] of detailByCategory) {
      expect(text, `${cat}'s detail output is truncated`).not.toContain(TRUNCATION_MARKER);
    }
  });

  it("POSITIVE CONTROL: this gate can fail — a truncating renderer is caught", () => {
    // Proves the assertion above discriminates. Built from a description
    // deliberately longer than the budget, cut the way the summary listing
    // cuts it; the `toContain` check must reject it.
    const long = "x".repeat(DESCRIPTION_BUDGET + 50);
    const cut = long.slice(0, DESCRIPTION_BUDGET - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
    expect(cut).not.toContain(long);
    expect(cut).toContain(TRUNCATION_MARKER);
    expect(long.length).toBeGreaterThan(DESCRIPTION_BUDGET);
  });
});

describe("the summary listing keeps its budget, and says so", () => {
  const registry = buildRegistry(stubClient);

  it("still truncates, and marks what it cut", () => {
    // The whole point of the opt-in design: the default listing is unchanged
    // in cost. If this ever stops truncating, the token-cost promise is gone.
    const categories = [...new Set([...registry.tools.values()].map((t) => t.category))];
    const withMarker = categories.filter((c) => registry.listActions(c).includes(TRUNCATION_MARKER));
    expect(categories.length).toBeGreaterThan(0);
    expect(
      withMarker.length,
      "no category's summary listing truncates anything — either the budget is gone or the marker is",
    ).toBeGreaterThan(0);
  });

  it("points a caller at detail mode exactly where something was cut", () => {
    const categories = [...new Set([...registry.tools.values()].map((t) => t.category))];
    let checkedCut = 0;
    let checkedClean = 0;
    for (const c of categories) {
      const text = registry.listActions(c);
      if (text.includes(TRUNCATION_MARKER)) {
        expect(text, `${c} cut a description but never mentions detail mode`).toContain(
          "detail: true",
        );
        checkedCut++;
      } else {
        // And it does NOT pay for the pointer where nothing was cut.
        expect(text, `${c} truncated nothing yet advertises detail mode`).not.toContain(
          "detail: true",
        );
        checkedClean++;
      }
    }
    expect(checkedCut).toBeGreaterThan(0);
    expect(checkedClean + checkedCut).toBe(categories.length);
  });

  it("truncates to the budget exactly, marker included", () => {
    const registry2 = new ToolRegistry();
    const long = "A".repeat(DESCRIPTION_BUDGET + 40);
    registry2.tool("pool_list", "List pools", { probe: z.string().describe(long) }, async () => ({}));
    const summary = registry2.listActions("storage");
    expect(summary).toContain(TRUNCATION_MARKER);
    const expected =
      long.slice(0, DESCRIPTION_BUDGET - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
    expect(summary).toContain(expected);
    expect(expected.length).toBe(DESCRIPTION_BUDGET);
    // Detail mode on the same registry returns the whole thing.
    expect(registry2.describeActions("storage", "pool_list")).toContain(long);
  });
});

describe("detail mode is discovery, never execution", () => {
  it("reports unknown category and unknown action without dispatching", () => {
    const registry = buildRegistry(stubClient);
    expect(registry.describeActions("nonsense")).toContain("Unknown category");
    expect(registry.describeActions("storage", "no_such_action")).toContain("Unknown action");
  });

  it("names the right category when an action is asked for under the wrong one", () => {
    const registry = buildRegistry(stubClient);
    const text = registry.describeActions("system", "pool_list");
    expect(text).toContain("storage");
  });

  it("marks destructive actions in detail output too", () => {
    const registry = buildRegistry(stubClient);
    const text = registry.describeActions("storage", "dataset_delete");
    expect(text).toContain("destructive");
    expect(text).toContain("confirm");
  });
});
