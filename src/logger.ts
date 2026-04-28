/**
 * Structured stderr logging (B3) — opt-in.
 *
 * Format: one JSON object per line, written to stderr (stdout is reserved
 * for the MCP JSON-RPC channel). Gated by `TRUENAS_LOG_LEVEL`, default
 * `error`. Levels: error > warn > info > debug.
 *
 * **Never logs params or response bodies** — those can contain secrets and
 * the response filter is a runtime control, not a logging boundary. The
 * logger only sees: method names, durations, error messages, reqIds, and
 * connection lifecycle events.
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 } as const;
type LevelName = keyof typeof LEVELS;

function parseLevel(raw: string | undefined): number {
  if (!raw) return LEVELS.error;
  const lower = raw.toLowerCase().trim();
  if (lower in LEVELS) return LEVELS[lower as LevelName];
  return LEVELS.error;
}

export interface LogEntry {
  ts: string;
  level: LevelName;
  msg: string;
  [field: string]: unknown;
}

export interface Logger {
  error(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  debug(msg: string, fields?: Record<string, unknown>): void;
  isEnabled(level: LevelName): boolean;
}

/**
 * Create a logger reading the threshold from `TRUENAS_LOG_LEVEL` (env) or
 * the explicit `level` arg. The `sink` is overridable for tests; defaults to
 * a stderr writer that emits one JSON line per event.
 */
export function createLogger(opts: {
  level?: LevelName;
  sink?: (line: string) => void;
} = {}): Logger {
  const threshold = opts.level !== undefined
    ? LEVELS[opts.level]
    : parseLevel(process.env.TRUENAS_LOG_LEVEL);
  const sink = opts.sink ?? ((line: string) => process.stderr.write(line + "\n"));

  function emit(level: LevelName, msg: string, fields?: Record<string, unknown>): void {
    if (LEVELS[level] > threshold) return;
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      msg,
      ...(fields ?? {}),
    };
    try {
      sink(JSON.stringify(entry));
    } catch {
      // Stringify can fail on circular structures; fall back to a minimal
      // line so the runtime never throws because of logging.
      sink(JSON.stringify({ ts: entry.ts, level, msg, _logErr: true }));
    }
  }

  return {
    error: (msg, fields) => emit("error", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    info: (msg, fields) => emit("info", msg, fields),
    debug: (msg, fields) => emit("debug", msg, fields),
    isEnabled: (level: LevelName) => LEVELS[level] <= threshold,
  };
}

/**
 * No-op logger — handy default for tests and for places where logging is
 * structurally optional (e.g. a TrueNASClient instantiated by a test that
 * doesn't care about logs).
 */
export const noopLogger: Logger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  isEnabled: () => false,
};
