/**
 * Helpers for the `reporting_*` actions.
 *
 * Two problems live here, both found in the field against 26.0.0-BETA.1
 * (docs/FIELD-REPORT-2026-08-21-reporting-and-diagnostics.md):
 *
 *  1. `reporting.get_data`'s query wants `start`/`end` as **integer** epoch
 *     seconds. The tool schema advertised ISO 8601 *or* epoch and forwarded the
 *     value verbatim, so a string was rejected by middlewared and a number was
 *     rejected by the schema — the parameter could not be satisfied at all.
 *     `parseEpochSeconds` is the coercion that makes the advertised contract
 *     true.
 *
 *  2. The response carries the answer twice: a compact `aggregations` block and
 *     a raw `data` array that runs to thousands of points per graph (3,601 for
 *     a one-hour window at 1s resolution — ~200 KB per graph). Callers over MCP
 *     have a token budget, so the default response now omits `data` and keeps
 *     the summary. `shapeReportingResult` does that, with a downsample in
 *     between for callers that want a curve.
 */

/** One time-series row: `[epochSeconds, ...values]`, values nullable. */
export type ReportingRow = Array<number | null>;

/** A single graph object as returned by `reporting.get_data`. */
export interface ReportingGraph {
  name?: string;
  identifier?: string | null;
  legend?: string[];
  start?: number;
  end?: number;
  aggregations?: unknown;
  data?: ReportingRow[];
  [key: string]: unknown;
}

export type ReportingDetail = "summary" | "downsampled" | "raw";

/**
 * Coerce an epoch-seconds number, an epoch-seconds string, or an ISO 8601
 * timestamp into integer epoch seconds.
 *
 * Returns `null` when the input cannot be interpreted, so callers (a Zod
 * transform, in practice) can raise an issue with their own context rather than
 * this throwing mid-parse.
 */
export function parseEpochSeconds(value: string | number): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.floor(value) : null;
  }

  const trimmed = value.trim();
  if (trimmed === "") return null;

  // Bare digits are epoch seconds. Date.parse() would misread these
  // (e.g. "1787263200" parses as a year in some engines), so check first.
  if (/^-?\d+$/.test(trimmed)) {
    const asInt = Number.parseInt(trimmed, 10);
    return Number.isFinite(asInt) ? asInt : null;
  }

  const ms = Date.parse(trimmed);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

/**
 * Reduce `rows` to at most `maxPoints` entries, preserving extremes.
 *
 * Buckets the series by time order and emits the minimum and maximum row of
 * each bucket (by the first value column), in time order. A mean-based
 * downsample would flatten exactly the spikes and troughs these graphs are
 * consulted for — a memory low-water mark disappears into the average.
 *
 * Row shape is preserved, so `legend` still describes the columns.
 */
export function downsampleRows(rows: ReportingRow[], maxPoints: number): ReportingRow[] {
  if (maxPoints <= 0) return [];
  if (rows.length <= maxPoints) return rows;

  // Two rows emitted per bucket (min + max), so aim for half as many buckets.
  const bucketCount = Math.max(1, Math.floor(maxPoints / 2));
  const bucketSize = Math.ceil(rows.length / bucketCount);
  const out: ReportingRow[] = [];

  for (let i = 0; i < rows.length; i += bucketSize) {
    const bucket = rows.slice(i, i + bucketSize);
    let lo: ReportingRow | undefined;
    let hi: ReportingRow | undefined;

    for (const row of bucket) {
      const v = row[1];
      if (typeof v !== "number") continue;
      if (lo === undefined || v < (lo[1] as number)) lo = row;
      if (hi === undefined || v > (hi[1] as number)) hi = row;
    }

    // A bucket with no numeric samples still deserves representation.
    if (lo === undefined || hi === undefined) {
      if (bucket.length > 0) out.push(bucket[0]);
      continue;
    }

    if (lo === hi) {
      out.push(lo);
    } else {
      const loTime = typeof lo[0] === "number" ? lo[0] : 0;
      const hiTime = typeof hi[0] === "number" ? hi[0] : 0;
      out.push(...(loTime <= hiTime ? [lo, hi] : [hi, lo]));
    }
  }

  return out;
}

/**
 * Shape a `reporting.get_data` response for an MCP caller.
 *
 * - `raw` — untouched, the pre-2026-08-21 behaviour.
 * - `downsampled` — `data` reduced to ~`maxPoints` rows via {@link downsampleRows}.
 * - `summary` — `data` dropped entirely, replaced by `data_points` (the count
 *   that was elided) so the caller can tell an empty series from a trimmed one.
 *   `aggregations`, `legend`, `start` and `end` are always kept: that block is
 *   what most diagnostic queries actually want.
 *
 * Anything that is not the expected array-of-graphs shape is returned
 * unchanged — this must never be the reason a response fails to come back.
 */
export function shapeReportingResult(
  result: unknown,
  detail: ReportingDetail,
  maxPoints: number,
): unknown {
  if (detail === "raw" || !Array.isArray(result)) return result;

  return result.map((entry) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return entry;

    const graph = entry as ReportingGraph;
    if (!Array.isArray(graph.data)) return entry;

    const { data, ...rest } = graph;

    if (detail === "summary") {
      return { ...rest, data_points: data.length };
    }

    const downsampled = downsampleRows(data, maxPoints);
    return {
      ...rest,
      data: downsampled,
      data_points: data.length,
      data_downsampled: downsampled.length < data.length,
    };
  });
}
