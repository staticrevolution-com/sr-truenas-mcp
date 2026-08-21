import { describe, it, expect } from "vitest";
import { TrueNASClient } from "../client.js";
import { buildRegistry } from "../tools/index.js";
import {
  parseEpochSeconds,
  downsampleRows,
  shapeReportingResult,
  type ReportingRow,
} from "../reporting.js";

/**
 * Coverage for the two 2026-08-21 field-report fixes on `reporting_get_data`:
 *
 *  - `start`/`end` were unsatisfiable — the schema demanded a string while
 *    middlewared demanded an integer epoch, and the value was forwarded
 *    verbatim. These pin that all three accepted spellings reach the API as the
 *    same integer.
 *  - the response returned thousands of raw points per graph alongside the
 *    compact `aggregations` block that actually answers most questions. These
 *    pin the default down to the summary, and pin that downsampling keeps
 *    extremes rather than averaging them away.
 */

function makeSpyRegistry(returnValue: unknown = []) {
  const client = new TrueNASClient({ baseUrl: "http://stub", apiKey: "stub", verifySsl: true });
  const calls: Array<{ method: string; params: unknown[] }> = [];
  (client as unknown as { call: TrueNASClient["call"] }).call = (async (
    method: string,
    params: unknown[] = [],
  ) => {
    calls.push({ method, params });
    return returnValue;
  }) as TrueNASClient["call"];
  return { registry: buildRegistry(client), calls };
}

function textOf(result: unknown): string {
  return (result as { content: Array<{ text: string }> }).content[0].text;
}

function queryOf(calls: Array<{ method: string; params: unknown[] }>): Record<string, unknown> {
  return calls[0].params[1] as Record<string, unknown>;
}

/** A graph payload shaped like the real `reporting.get_data` response. */
function graphPayload(points: number): unknown[] {
  const data: ReportingRow[] = [];
  for (let i = 0; i < points; i++) {
    // A dip at 10% and a spike at 60% — the features a mean would erase.
    let value = 1_000_000;
    if (i === Math.floor(points * 0.1)) value = 5;
    if (i === Math.floor(points * 0.6)) value = 9_999_999;
    data.push([1_787_276_724 + i, value]);
  }
  return [
    {
      name: "memory",
      identifier: "memory",
      legend: ["time", "available"],
      start: 1_787_276_725,
      end: 1_787_276_725 + points,
      aggregations: { min: { available: 5 }, mean: { available: 1000 }, max: { available: 9_999_999 } },
      data,
    },
  ];
}

describe("parseEpochSeconds", () => {
  it("accepts a number", () => {
    expect(parseEpochSeconds(1_787_263_200)).toBe(1_787_263_200);
  });

  it("floors a fractional number", () => {
    expect(parseEpochSeconds(1_787_263_200.9)).toBe(1_787_263_200);
  });

  it("accepts epoch seconds as a string", () => {
    expect(parseEpochSeconds("1787263200")).toBe(1_787_263_200);
  });

  it("accepts an ISO 8601 timestamp", () => {
    expect(parseEpochSeconds("2026-08-20T22:00:00Z")).toBe(1_787_263_200);
  });

  it("agrees across all three spellings of the same instant", () => {
    const a = parseEpochSeconds(1_787_263_200);
    const b = parseEpochSeconds("1787263200");
    const c = parseEpochSeconds("2026-08-20T22:00:00Z");
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("does not mistake bare digits for a year", () => {
    // Date.parse("1787263200") is engine-dependent; the digit branch must win.
    expect(parseEpochSeconds("1787263200")).toBe(1_787_263_200);
  });

  it("returns null for junk, empty input, and non-finite numbers", () => {
    expect(parseEpochSeconds("not-a-time")).toBeNull();
    expect(parseEpochSeconds("")).toBeNull();
    expect(parseEpochSeconds("   ")).toBeNull();
    expect(parseEpochSeconds(Number.NaN)).toBeNull();
    expect(parseEpochSeconds(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("downsampleRows", () => {
  const rows: ReportingRow[] = Array.from({ length: 3601 }, (_, i) => [1000 + i, i === 500 ? -7 : i]);

  it("returns the input untouched when already small enough", () => {
    const small: ReportingRow[] = [[1, 2], [3, 4]];
    expect(downsampleRows(small, 120)).toBe(small);
  });

  it("reduces to roughly max_points rows", () => {
    const out = downsampleRows(rows, 120);
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out.length).toBeGreaterThan(0);
  });

  it("preserves the extreme values rather than averaging them away", () => {
    const out = downsampleRows(rows, 120);
    const values = out.map((r) => r[1]);
    expect(values).toContain(-7); // the trough
    expect(values).toContain(3600); // the peak
  });

  it("keeps rows in time order and preserves row shape", () => {
    const out = downsampleRows(rows, 120);
    const times = out.map((r) => r[0] as number);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    for (const row of out) expect(row).toHaveLength(2);
  });

  it("survives a bucket with no numeric samples", () => {
    const nulls: ReportingRow[] = Array.from({ length: 400 }, (_, i) => [i, null]);
    const out = downsampleRows(nulls, 20);
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(400);
  });

  it("returns nothing for a non-positive budget", () => {
    expect(downsampleRows(rows, 0)).toEqual([]);
  });
});

describe("shapeReportingResult", () => {
  it("summary drops data but keeps aggregations, legend and bounds", () => {
    const shaped = shapeReportingResult(graphPayload(3601), "summary", 120) as Array<
      Record<string, unknown>
    >;
    expect(shaped[0].data).toBeUndefined();
    expect(shaped[0].data_points).toBe(3601);
    expect(shaped[0].aggregations).toBeDefined();
    expect(shaped[0].legend).toEqual(["time", "available"]);
    expect(shaped[0].start).toBeDefined();
    expect(shaped[0].end).toBeDefined();
  });

  it("downsampled keeps a curve and flags that it was reduced", () => {
    const shaped = shapeReportingResult(graphPayload(3601), "downsampled", 120) as Array<
      Record<string, unknown>
    >;
    const data = shaped[0].data as ReportingRow[];
    expect(data.length).toBeLessThanOrEqual(120);
    expect(shaped[0].data_points).toBe(3601);
    expect(shaped[0].data_downsampled).toBe(true);
    // The dip and the spike both survive the reduction.
    const values = data.map((r) => r[1]);
    expect(values).toContain(5);
    expect(values).toContain(9_999_999);
  });

  it("raw is byte-for-byte the upstream payload", () => {
    const payload = graphPayload(50);
    expect(shapeReportingResult(payload, "raw", 120)).toBe(payload);
  });

  it("passes through anything that is not the expected shape", () => {
    expect(shapeReportingResult({ unexpected: true }, "summary", 120)).toEqual({ unexpected: true });
    expect(shapeReportingResult(null, "summary", 120)).toBeNull();
    expect(shapeReportingResult([1, 2, 3], "summary", 120)).toEqual([1, 2, 3]);
    expect(shapeReportingResult([{ name: "x" }], "summary", 120)).toEqual([{ name: "x" }]);
  });
});

describe("reporting_get_data through the registry", () => {
  it("coerces a numeric start/end to integer epoch seconds", async () => {
    const { registry, calls } = makeSpyRegistry();
    await registry.execute("reporting", "reporting_get_data", {
      graphs: [{ name: "memory" }],
      start: 1_787_263_200,
      end: 1_787_275_800,
    });
    const query = queryOf(calls);
    expect(query.start).toBe(1_787_263_200);
    expect(query.end).toBe(1_787_275_800);
    expect(Number.isInteger(query.start)).toBe(true);
  });

  it("coerces an epoch string — the form middlewared used to reject", async () => {
    const { registry, calls } = makeSpyRegistry();
    await registry.execute("reporting", "reporting_get_data", {
      graphs: [{ name: "memory" }],
      start: "1787263200",
      end: "1787275800",
    });
    const query = queryOf(calls);
    expect(query.start).toBe(1_787_263_200);
    expect(typeof query.start).toBe("number");
  });

  it("coerces an ISO 8601 string, which the description always promised", async () => {
    const { registry, calls } = makeSpyRegistry();
    await registry.execute("reporting", "reporting_get_data", {
      graphs: [{ name: "memory" }],
      start: "2026-08-20T22:00:00Z",
      end: "2026-08-21T01:30:00Z",
    });
    const query = queryOf(calls);
    expect(query.start).toBe(1_787_263_200);
    expect(query.end).toBe(1_787_275_800);
  });

  it("omits start/end entirely when not supplied", async () => {
    const { registry, calls } = makeSpyRegistry();
    await registry.execute("reporting", "reporting_get_data", { graphs: [{ name: "memory" }] });
    const query = queryOf(calls);
    expect("start" in query).toBe(false);
    expect("end" in query).toBe(false);
    expect(query.aggregate).toBe(true);
  });

  it("defaults to the summary shape instead of thousands of raw points", async () => {
    const { registry } = makeSpyRegistry(graphPayload(3601));
    const text = textOf(
      await registry.execute("reporting", "reporting_get_data", { graphs: [{ name: "memory" }] }),
    );
    const parsed = JSON.parse(text) as Array<Record<string, unknown>>;
    expect(parsed[0].data).toBeUndefined();
    expect(parsed[0].data_points).toBe(3601);
    expect(parsed[0].aggregations).toBeDefined();
    // The whole point: the response is small enough to read in-context.
    expect(text.length).toBeLessThan(2000);
  });

  it("detail='raw' still returns the full series for callers that want it", async () => {
    const { registry } = makeSpyRegistry(graphPayload(500));
    const text = textOf(
      await registry.execute("reporting", "reporting_get_data", {
        graphs: [{ name: "memory" }],
        detail: "raw",
      }),
    );
    const parsed = JSON.parse(text) as Array<Record<string, unknown>>;
    expect((parsed[0].data as ReportingRow[]).length).toBe(500);
  });

  it("detail='downsampled' honours max_points", async () => {
    const { registry } = makeSpyRegistry(graphPayload(3601));
    const text = textOf(
      await registry.execute("reporting", "reporting_get_data", {
        graphs: [{ name: "memory" }],
        detail: "downsampled",
        max_points: 40,
      }),
    );
    const parsed = JSON.parse(text) as Array<Record<string, unknown>>;
    expect((parsed[0].data as ReportingRow[]).length).toBeLessThanOrEqual(40);
  });

  it("rejects an inverted window instead of passing it upstream", async () => {
    // In-handler validation throws here, matching validateTrueNASPath and the
    // rest of the handler surface; Zod-layer failures return an error result.
    const { registry, calls } = makeSpyRegistry();
    await expect(
      registry.execute("reporting", "reporting_get_data", {
        graphs: [{ name: "memory" }],
        start: "2026-08-21T01:30:00Z",
        end: "2026-08-20T22:00:00Z",
      }),
    ).rejects.toThrow(/must be after/i);
    expect(calls).toHaveLength(0);
  });

  it("forwards unit and page — previously dropped before the call", async () => {
    // Verified against 26.0.0-BETA.1: the query schema accepts both, and
    // additionalProperties is false, so middleware would have rejected them
    // loudly. Silently discarding them was the only reason nobody noticed.
    const { registry, calls } = makeSpyRegistry();
    await registry.execute("reporting", "reporting_get_data", {
      graphs: [{ name: "memory" }],
      unit: "HOUR",
      page: 3,
    });
    const query = queryOf(calls);
    expect(query.unit).toBe("HOUR");
    expect(query.page).toBe(3);
    expect("start" in query).toBe(false);
  });

  it("rejects unit combined with start/end, which the API forbids", async () => {
    const { registry, calls } = makeSpyRegistry();
    await expect(
      registry.execute("reporting", "reporting_get_data", {
        graphs: [{ name: "memory" }],
        unit: "HOUR",
        start: "2026-08-20T22:00:00Z",
      }),
    ).rejects.toThrow(/mutually exclusive/i);
    expect(calls).toHaveLength(0);
  });

  it("rejects page without unit", async () => {
    const { registry, calls } = makeSpyRegistry();
    await expect(
      registry.execute("reporting", "reporting_get_data", {
        graphs: [{ name: "memory" }],
        page: 2,
      }),
    ).rejects.toThrow(/requires 'unit'/i);
    expect(calls).toHaveLength(0);
  });

  it("rejects an unknown unit rather than passing it upstream", async () => {
    const { registry, calls } = makeSpyRegistry();
    const result = await registry.execute("reporting", "reporting_get_data", {
      graphs: [{ name: "memory" }],
      unit: "FORTNIGHT",
    });
    expect(JSON.stringify(result)).toMatch(/unit/i);
    expect(calls).toHaveLength(0);
  });

  it("rejects an uninterpretable timestamp with a useful message", async () => {
    const { registry, calls } = makeSpyRegistry();
    const result = await registry.execute("reporting", "reporting_get_data", {
      graphs: [{ name: "memory" }],
      start: "last tuesday",
    });
    expect(JSON.stringify(result)).toMatch(/epoch seconds or an ISO 8601 timestamp/i);
    expect(calls).toHaveLength(0);
  });
});
