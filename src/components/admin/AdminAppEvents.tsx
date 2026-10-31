/**
 * AdminAppEvents — READ THE STRUCTURED LOGS.
 *
 * OWNER DIRECTIVE, 2026-08-06:
 *
 *   "Now when someone reports 'I'm getting DB-3002' your team immediately
 *    knows which subsystem, what failed, and where to start investigating."
 *
 * This screen is the half of that sentence the database cannot do on its own.
 * Without it the logs exist but can only be read by someone willing to open a
 * SQL console, which in practice means they are never read — and a fix that
 * cannot be SEEN is no fix (WORKING_RULES).
 *
 * WHAT IT SHOWS, IN THE ORDER A REAL INVESTIGATION NEEDS IT:
 *
 *   1. Codes by frequency — "what is failing most right now", so attention
 *      goes to the thing hurting the most members rather than the thing
 *      reported loudest.
 *   2. The individual events — every field the standard requires, with the
 *      expected/actual pair and the recommended next step visible without
 *      clicking anything.
 *   3. One tap on a correlation id — every log line of that ONE user action,
 *      in order. This is how "posting failed for me at 01:14" becomes a
 *      readable story: started → uploaded photo 1 → uploaded photo 2 →
 *      insert refused, with the Postgres code and the duration of each step.
 *
 * DATA COMES FROM TWO ADMIN-ONLY FUNCTIONS, never from the table directly:
 *   get_app_event_counts_admin(hours)
 *   get_app_events_admin(hours, code, severity, limit)
 * Both raise 'admin only' for anyone else. The table itself has RLS enabled
 * with no policies, so there is no other way in.
 *
 * MEMBER IDS ARE SHOWN, E-MAILS ARE NOT — logs are redacted client-side before
 * they are ever written (src/lib/logger.ts), so there is nothing sensitive
 * here to leak onto an admin's screen.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertTriangle,
  RefreshCw,
  Search,
  Clock,
  Smartphone,
  Globe,
  Link2,
  X,
  ChevronRight,
} from "lucide-react";
import { ERROR_CATALOG, getErrorCode } from "@/lib/errorCodes";

interface CountRow {
  code: string;
  event: string | null;
  severity: string | null;
  occurrences: number;
  members: number;
  last_seen: string;
  sample: string | null;
}

interface EventRow {
  id: string;
  created_at: string;
  code: string;
  event: string | null;
  severity: string | null;
  message: string | null;
  fn: string | null;
  src_file: string | null;
  reason: string | null;
  expected: string | null;
  actual: string | null;
  next_step: string | null;
  duration_ms: number | null;
  correlation_id: string | null;
  user_id: string | null;
  platform: string | null;
  app_build: string | null;
  url: string | null;
  detail: Record<string, unknown> | null;
}

const labelCls = "text-[8px] tracking-[0.15em] uppercase text-muted-foreground/70";

/** Colour by how much it should worry you. Fatal and error read as red. */
const severityClass = (s: string | null): string => {
  switch ((s ?? "").toLowerCase()) {
    case "fatal":
      return "bg-destructive text-destructive-foreground";
    case "error":
      return "bg-destructive/15 text-destructive";
    case "warn":
      return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
    case "info":
      return "bg-primary/10 text-primary";
    default:
      return "bg-muted text-muted-foreground";
  }
};

const shortTime = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { day: "2-digit", month: "short" })} ${d.toLocaleTimeString(
    undefined,
    { hour: "2-digit", minute: "2-digit", second: "2-digit" },
  )}`;
};

const AdminAppEvents = () => {
  const [hours, setHours] = useState(24);
  const [code, setCode] = useState<string>("");
  const [severity, setSeverity] = useState<string>("");
  const [counts, setCounts] = useState<CountRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** When set, the list is narrowed to one user action rather than one code. */
  const [correlation, setCorrelation] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, e] = await Promise.all([
        supabase.rpc("get_app_event_counts_admin" as any, { _hours: hours }),
        supabase.rpc("get_app_events_admin" as any, {
          _hours: hours,
          _code: code || null,
          _severity: severity || null,
          _limit: 200,
        }),
      ]);
      if (c.error) throw c.error;
      if (e.error) throw e.error;
      setCounts((c.data as CountRow[]) ?? []);
      setEvents((e.data as EventRow[]) ?? []);
    } catch (err: any) {
      // An admin screen that fails silently is the same disease this whole
      // feature exists to cure, so say exactly what happened.
      setError(err?.message ?? "Could not load application events.");
    } finally {
      setLoading(false);
    }
  }, [hours, code, severity]);

  useEffect(() => {
    load();
  }, [load]);

  const shown = correlation
    ? events.filter((r) => r.correlation_id === correlation)
    : events;

  const totalErrors = counts
    .filter((r) => ["error", "fatal"].includes((r.severity ?? "").toLowerCase()))
    .reduce((acc, r) => acc + Number(r.occurrences ?? 0), 0);

  return (
    <div className="space-y-4">
      {/* ── Controls ── */}
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <div className={labelCls}>Window</div>
          <select
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            className="mt-1 h-8 rounded-md border border-border bg-background px-2 text-xs"
          >
            <option value={1}>Last hour</option>
            <option value={24}>Last 24 hours</option>
            <option value={72}>Last 3 days</option>
            <option value={168}>Last 7 days</option>
            <option value={720}>Last 30 days</option>
          </select>
        </div>

        <div>
          <div className={labelCls}>Code</div>
          <select
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setCorrelation(null);
            }}
            className="mt-1 h-8 rounded-md border border-border bg-background px-2 text-xs min-w-[150px]"
          >
            <option value="">All codes</option>
            {ERROR_CATALOG.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div className={labelCls}>Severity</div>
          <select
            value={severity}
            onChange={(e) => {
              setSeverity(e.target.value);
              setCorrelation(null);
            }}
            className="mt-1 h-8 rounded-md border border-border bg-background px-2 text-xs"
          >
            <option value="">All</option>
            <option value="fatal">Fatal</option>
            <option value="error">Error</option>
            <option value="warn">Warn</option>
            <option value="info">Info</option>
          </select>
        </div>

        <button
          onClick={load}
          disabled={loading}
          className="h-8 inline-flex items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium hover:bg-muted/50 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>

        {(code || severity || correlation) && (
          <button
            onClick={() => {
              setCode("");
              setSeverity("");
              setCorrelation(null);
            }}
            className="h-8 inline-flex items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
            Clear filters
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div>
            <div className="font-semibold">Could not load the logs.</div>
            <div className="mt-0.5 opacity-90">{error}</div>
            <div className="mt-1 opacity-75">
              If this says “admin only”, the signed-in account does not hold the admin role.
            </div>
          </div>
        </div>
      )}

      {/* ── What is failing most ── */}
      <section>
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold" style={{ fontFamily: "var(--font-heading)" }}>
            What is failing
          </h3>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {totalErrors} error{totalErrors === 1 ? "" : "s"} in this window
          </span>
        </div>

        {counts.length === 0 && !loading ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Nothing recorded in this window. On a healthy day that is exactly what this should say.
          </p>
        ) : (
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {counts.map((row) => {
              const entry = getErrorCode(row.code);
              return (
                <button
                  key={row.code}
                  onClick={() => {
                    setCode(row.code);
                    setCorrelation(null);
                  }}
                  className={`text-left rounded-md border p-2.5 transition-colors hover:bg-muted/40 ${
                    code === row.code ? "border-primary bg-primary/5" : "border-border"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold">{row.code}</span>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase ${severityClass(
                        row.severity,
                      )}`}
                    >
                      {row.severity ?? "—"}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground line-clamp-2">
                    {entry?.description ?? row.event ?? "—"}
                  </div>
                  <div className="mt-1.5 flex items-center gap-3 text-[10px] text-muted-foreground tabular-nums">
                    <span>
                      <strong className="text-foreground">{row.occurrences}</strong>×
                    </span>
                    <span>
                      {row.members} member{row.members === 1 ? "" : "s"}
                    </span>
                    <span className="ml-auto">{shortTime(row.last_seen)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* ── The events themselves ── */}
      <section>
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold" style={{ fontFamily: "var(--font-heading)" }}>
            {correlation ? "One member action, in order" : "Events"}
          </h3>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {shown.length} shown{events.length >= 200 ? " (capped at 200)" : ""}
          </span>
        </div>

        {correlation && (
          <button
            onClick={() => setCorrelation(null)}
            className="mt-1 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            <X className="h-3 w-3" />
            Back to all events
          </button>
        )}

        <div className="mt-2 space-y-1.5">
          {shown.length === 0 && !loading && (
            <p className="text-xs text-muted-foreground">No events match these filters.</p>
          )}

          {shown.map((row) => {
            const entry = getErrorCode(row.code);
            return (
              <article key={row.id} className="rounded-md border border-border p-2.5">
                <header className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase ${severityClass(
                      row.severity,
                    )}`}
                  >
                    {row.severity ?? "—"}
                  </span>
                  <span className="font-mono text-xs font-semibold">{row.code}</span>
                  <span className="text-[11px] text-muted-foreground">{row.event}</span>

                  <span className="ml-auto flex items-center gap-2 text-[10px] text-muted-foreground tabular-nums">
                    {row.platform === "app" ? (
                      <Smartphone className="h-3 w-3" />
                    ) : (
                      <Globe className="h-3 w-3" />
                    )}
                    {row.app_build && <span>{row.app_build}</span>}
                    {typeof row.duration_ms === "number" && (
                      <span className="inline-flex items-center gap-0.5">
                        <Clock className="h-3 w-3" />
                        {row.duration_ms}ms
                      </span>
                    )}
                    <span>{shortTime(row.created_at)}</span>
                  </span>
                </header>

                {row.message && <p className="mt-1.5 text-xs">{row.message}</p>}

                {row.reason && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    <span className={labelCls}>Why </span>
                    {row.reason}
                  </p>
                )}

                {(row.expected || row.actual) && (
                  <div className="mt-1 grid gap-1 sm:grid-cols-2">
                    {row.expected && (
                      <div className="text-[11px]">
                        <div className={labelCls}>Expected</div>
                        <div className="text-muted-foreground">{row.expected}</div>
                      </div>
                    )}
                    {row.actual && (
                      <div className="text-[11px]">
                        <div className={labelCls}>Actual</div>
                        <div className="text-foreground">{row.actual}</div>
                      </div>
                    )}
                  </div>
                )}

                {/* The recommended next investigation — the field that turns a
                    report into a starting point. Falls back to the catalog's
                    resolution when the log did not override it. */}
                {(row.next_step || entry?.resolution) && (
                  <p className="mt-1.5 flex items-start gap-1 text-[11px] text-primary">
                    <ChevronRight className="h-3 w-3 mt-0.5 flex-shrink-0" />
                    <span>{row.next_step || entry?.resolution}</span>
                  </p>
                )}

                <footer className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                  {row.fn && (
                    <span className="font-mono">
                      {row.fn}
                      {row.src_file ? ` · ${row.src_file.split("/").pop()}` : ""}
                    </span>
                  )}
                  {row.url && <span>{row.url}</span>}
                  {row.user_id && <span className="font-mono">member {row.user_id.slice(0, 8)}</span>}
                  {row.correlation_id && (
                    <button
                      onClick={() => setCorrelation(row.correlation_id)}
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                      title="Show every log line from this one member action"
                    >
                      <Link2 className="h-3 w-3" />
                      {row.correlation_id}
                    </button>
                  )}
                </footer>

                {row.detail && Object.keys(row.detail).length > 0 && (
                  <details className="mt-1.5">
                    <summary className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground">
                      Detail
                    </summary>
                    <pre className="mt-1 overflow-x-auto rounded bg-muted/50 p-2 text-[10px] leading-relaxed">
                      {JSON.stringify(row.detail, null, 2)}
                    </pre>
                  </details>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <p className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
        <Search className="h-3 w-3 mt-0.5 flex-shrink-0" />
        <span>
          Errors and warnings are recorded; routine info and debug lines stay in the browser console
          so they cannot bury the failures. Every code is explained in docs/error-codes.md. Rows are
          removed automatically after 30 days.
        </span>
      </p>
    </div>
  );
};

export default AdminAppEvents;
