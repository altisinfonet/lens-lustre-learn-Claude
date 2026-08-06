/**
 * STRUCTURED LOGGING — the one logger. No console.log anywhere else.
 *
 * OWNER DIRECTIVE, 2026-08-06 (verbatim, so the rules stay attached to the
 * code that implements them):
 *
 *   "Every log must answer: What operation is executing? Which function?
 *    Which file? Which user? Which record? What input was received? What
 *    condition was evaluated? Expected value. Actual value. Why this branch
 *    executed. Why the operation failed. Recommended next investigation."
 *   "Never write console.log(...)"
 *   "Never log secrets, passwords, tokens, private keys, or sensitive
 *    personal data."
 *   "Add timing around important operations to identify slow code paths."
 *   "Include the code in every log."
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE THREE RULES THIS FILE EXISTS TO ENFORCE — read before changing anything.
 *
 * 1. THE LOGGER NEVER BECOMES THE INCIDENT.
 *    Every path here is wrapped so that a logging failure cannot throw into
 *    the caller, cannot block it, and cannot show a member anything. The
 *    persist call is fire-and-forget and its rejection is swallowed. This is
 *    the same rule already recorded in reportClientError.ts, and it is not
 *    negotiable: a logger that raises inside a failure path turns one broken
 *    thing into two.
 *
 * 2. THIS RUNS ON MEMBERS' PHONES, NOT ON A SERVER.
 *    Google and Stripe ship every level to a log sink because the code runs in
 *    their data centre. Ours runs in 84 members' browsers over mobile data,
 *    against a free-tier database. So: ERROR/FATAL/WARN are persisted;
 *    INFO/DEBUG/TRACE go to the console only, and DEBUG/TRACE only outside
 *    production. Persisting every entry/exit line from every member would cost
 *    the members' data, the app's speed and the database's quota, and would
 *    bury the failures that matter under a million successes. The level policy
 *    IS the professional answer, not a shortcut.
 *
 * 3. NOTHING SENSITIVE LEAVES THE DEVICE.
 *    redact() runs over every field of every log before it is printed or sent.
 *    It removes anything key-named like a secret (password, token, jwt, key,
 *    secret, otp, auth, cookie, session), and masks e-mail addresses found in
 *    free text. A member id is NOT sensitive here — it is the whole point of
 *    the log — but an e-mail is, and so is anything that could sign in.
 * ───────────────────────────────────────────────────────────────────────────
 */
import { supabase } from "@/integrations/supabase/client";
import { isNativeCapacitorApp } from "@/lib/native/authDeepLink";
import { CODE_PATTERN, getErrorCode, type Severity } from "@/lib/errorCodes";

export type { Severity };

/** Ordered weakest → strongest, so a threshold comparison is a number compare. */
const LEVEL_WEIGHT: Record<Severity, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/** At and above this level, the event is written to the database. */
const PERSIST_FROM: Severity = "warn";

/** Below this level nothing is even printed in production. */
const PRINT_FROM_IN_PROD: Severity = "info";

const isProd = (() => {
  try {
    return Boolean((import.meta as any)?.env?.PROD);
  } catch {
    return true; // if we cannot tell, assume production and stay quiet
  }
})();

/**
 * What every log line carries. `code` and `event` are mandatory — a log
 * without a code cannot be grouped, and the owner's standard is built on
 * being able to quote a code.
 */
export interface LogFields {
  /** Catalog code, e.g. "DB-3002". Must exist in src/lib/errorCodes.ts. */
  code: string;
  /** SCREAMING_SNAKE name of what happened. */
  event: string;
  /** Function that emitted this. */
  fn: string;
  /** File that emitted this. */
  file: string;
  /** One sentence: what operation was executing. */
  message: string;
  /** Why this branch executed / why it failed. */
  reason?: string;
  /** What the code expected to be true. */
  expected?: string;
  /** What was actually observed. */
  actual?: string;
  /** Recommended next investigation. Defaults to the catalog's resolution. */
  nextStep?: string;
  /** Member this concerns, when known. */
  userId?: string | null;
  /** The record this concerns (post id, story id, …). */
  recordId?: string | null;
  /** Measured duration of the operation. */
  durationMs?: number;
  /** Ties every line of one user action together. */
  correlationId?: string;
  /** Anything else worth keeping. Redacted before it leaves the device. */
  detail?: Record<string, unknown>;
}

/* ── Redaction ───────────────────────────────────────────────────────────── */

const SECRET_KEY = /pass|pwd|token|jwt|secret|api[-_]?key|private|cookie|session|otp|auth|bearer|credential/i;
const EMAIL_IN_TEXT = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/** Mask an e-mail so it is still recognisable but not usable: `n***@gmail.com`. */
function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "[redacted]";
  return `${email[0]}***${email.slice(at)}`;
}

/** Strip e-mails out of any free text we are about to log. */
function scrubText(value: string): string {
  return value.replace(EMAIL_IN_TEXT, (m) => maskEmail(m));
}

/**
 * Deep-clean a value: secret-looking KEYS are dropped entirely, e-mails inside
 * strings are masked, and the walk is depth- and size-bounded so a circular or
 * enormous object cannot hang the logger (rule 1).
 */
export function redact(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (depth > 4) return "[depth-limit]";

  if (typeof value === "string") return scrubText(value.slice(0, 500));
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: scrubText(String(value.message).slice(0, 300)) };
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((v) => redact(v, depth + 1));
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    let n = 0;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (n++ >= 30) {
        out["…"] = "[field-limit]";
        break;
      }
      if (SECRET_KEY.test(k)) {
        out[k] = "[redacted]";
        continue;
      }
      out[k] = redact(v, depth + 1);
    }
    return out;
  }

  return "[unloggable]";
}

/* ── Correlation ─────────────────────────────────────────────────────────── */

/**
 * A short id tying every log line of ONE user action together — "show me
 * everything that happened when this post failed".
 *
 * Deliberately per-action and NOT stored: it is not a session id, not a device
 * id, and cannot be used to follow a member around.
 */
export function newCorrelationId(): string {
  try {
    const c: any = (globalThis as any).crypto;
    if (c?.randomUUID) return String(c.randomUUID()).slice(0, 8);
    if (c?.getRandomValues) {
      const a = new Uint32Array(2);
      c.getRandomValues(a);
      return Array.from(a, (n) => n.toString(36)).join("").slice(0, 8);
    }
  } catch {
    /* fall through */
  }
  return Math.random().toString(36).slice(2, 10);
}

/* ── Ambient context ─────────────────────────────────────────────────────── */

let ambientUserId: string | null = null;

/**
 * Record who is signed in, so every later log carries the member without each
 * call site having to pass it. Called from the auth hook.
 */
export function setLogUser(userId: string | null): void {
  ambientUserId = userId ?? null;
}

function appBuild(): string | null {
  try {
    return (window as any).__APP_BUILD ?? null;
  } catch {
    return null;
  }
}

function currentPath(): string | null {
  try {
    return typeof location !== "undefined" ? location.pathname : null;
  } catch {
    return null;
  }
}

function platform(): "app" | "web" {
  try {
    return isNativeCapacitorApp() ? "app" : "web";
  } catch {
    return "web";
  }
}

/* ── Emit ────────────────────────────────────────────────────────────────── */

function shouldPrint(level: Severity): boolean {
  if (!isProd) return true;
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[PRINT_FROM_IN_PROD];
}

function shouldPersist(level: Severity): boolean {
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[PERSIST_FROM];
}

/**
 * Print one line as structured JSON.
 *
 * `console.error` / `console.warn` / `console.info` are used deliberately —
 * they are the browser's transport, not a "generic log". The banned thing is
 * an unstructured `console.log("something")`, and the tests in
 * src/lib/__tests__/loggingStandard.test.ts enforce its absence.
 */
function print(level: Severity, payload: Record<string, unknown>): void {
  try {
    const line = JSON.stringify(payload);
    // eslint-disable-next-line no-console -- the console IS the transport here
    if (level === "error" || level === "fatal") console.error(line);
    // eslint-disable-next-line no-console
    else if (level === "warn") console.warn(line);
    // eslint-disable-next-line no-console
    else console.info(line);
  } catch {
    /* rule 1 */
  }
}

/**
 * Write the event to the database.
 *
 * IT TAKES THE ALREADY-SCRUBBED `payload`, NOT THE RAW `fields`. That
 * distinction is the whole of rule 3 and it is easy to get wrong: an earlier
 * version of this file scrubbed only the line it PRINTED and sent the raw
 * message to the database, so an e-mail address inside a message would have
 * been stored permanently while looking masked in the console. The test
 * "masks e-mails in the message itself, not just in detail" exists because it
 * caught exactly that, and it will catch it again.
 */
function persist(level: Severity, f: LogFields, payload: Record<string, unknown>): void {
  try {
    void (supabase.rpc as any)("log_app_event", {
      _code: f.code,
      _event: f.event,
      _severity: level,
      _message: (payload.message as string) ?? f.message,
      _fn: f.fn,
      _file: f.file,
      _reason: (payload.reason as string) ?? null,
      _expected: (payload.expected as string) ?? null,
      _actual: (payload.actual as string) ?? null,
      _next_step: f.nextStep ?? getErrorCode(f.code)?.resolution ?? null,
      _duration_ms: typeof f.durationMs === "number" ? Math.round(f.durationMs) : null,
      _correlation_id: f.correlationId ?? null,
      _detail: (payload.detail ?? null) as any,
      _platform: platform(),
      _app_build: appBuild(),
      _url: currentPath(),
    }).then(
      () => undefined,
      () => undefined, // rule 1: a failed log is not an error
    );
  } catch {
    /* rule 1 */
  }
}

function emit(level: Severity, fields: LogFields): void {
  try {
    // An unknown or malformed code is a programming mistake, and it would be
    // dropped by the database anyway. Say so loudly in development, and still
    // emit the line (losing the log entirely would be worse) — but outside
    // development never let this become noise.
    if (!CODE_PATTERN.test(fields.code) || !getErrorCode(fields.code)) {
      if (!isProd) {
        // eslint-disable-next-line no-console -- developer-only guard rail
        console.warn(
          JSON.stringify({
            code: "SYS-9001",
            event: "LOG_CODE_NOT_IN_CATALOG",
            severity: "warn",
            fn: "emit",
            file: "src/lib/logger.ts",
            message: "A log used a code that is not in the catalog.",
            actual: fields.code,
            expected: "A code present in src/lib/errorCodes.ts",
            nextStep: "Add the code to ERROR_CATALOG and regenerate docs/error-codes.md.",
          }),
        );
      }
    }

    const payload: Record<string, unknown> = {
      ts: new Date().toISOString(),
      severity: level,
      code: fields.code,
      event: fields.event,
      fn: fields.fn,
      file: fields.file,
      message: scrubText(fields.message),
      reason: fields.reason ? scrubText(fields.reason) : undefined,
      expected: fields.expected ? scrubText(fields.expected) : undefined,
      actual: fields.actual ? scrubText(fields.actual) : undefined,
      nextStep: fields.nextStep ?? getErrorCode(fields.code)?.resolution,
      userId: fields.userId ?? ambientUserId ?? undefined,
      recordId: fields.recordId ?? undefined,
      durationMs: fields.durationMs,
      correlationId: fields.correlationId,
      platform: platform(),
      appBuild: appBuild(),
      url: currentPath(),
      detail: fields.detail ? (redact(fields.detail) as Record<string, unknown>) : undefined,
    };

    for (const k of Object.keys(payload)) {
      if (payload[k] === undefined) delete payload[k];
    }

    if (shouldPrint(level)) print(level, payload);
    if (shouldPersist(level)) persist(level, fields, payload);
  } catch {
    /* rule 1 — nothing here may reach the member */
  }
}

/* ── The public surface ──────────────────────────────────────────────────── */

export const logger = {
  trace: (f: LogFields) => emit("trace", f),
  debug: (f: LogFields) => emit("debug", f),
  info: (f: LogFields) => emit("info", f),
  warn: (f: LogFields) => emit("warn", f),
  error: (f: LogFields) => emit("error", f),
  fatal: (f: LogFields) => emit("fatal", f),
};

/**
 * Time an operation and log how long it took — the owner's "add timing around
 * important operations to identify slow code paths".
 *
 * Success logs at `info` with the duration; failure logs at `error` with the
 * duration AND the reason, then RE-THROWS. The logger never swallows a real
 * error: the caller's own error handling must still run.
 */
export async function timed<T>(
  fields: Omit<LogFields, "durationMs">,
  operation: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  try {
    const result = await operation();
    emit("info", {
      ...fields,
      durationMs: Date.now() - started,
      actual: fields.actual ?? "completed",
    });
    return result;
  } catch (err) {
    emit("error", {
      ...fields,
      durationMs: Date.now() - started,
      reason: err instanceof Error ? err.message : String(err),
      actual: "threw",
    });
    throw err;
  }
}

export default logger;
