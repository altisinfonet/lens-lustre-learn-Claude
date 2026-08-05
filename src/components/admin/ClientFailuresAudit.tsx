import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, RefreshCw, CheckCircle2 } from "lucide-react";

/**
 * CLIENT FAILURES — the answer to "next time how to measure?".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Owner, 2026-08-05, after a day of members unable to post:
 *   "in entire day many of members unable to post complaining and you are just
 *    escaping?? Next time happened soo how to measure??"
 *   "what tracking you are follwoing, just i cant check is not the soltuion"
 *
 * The second sentence is the one that shaped this file. Recording failures into
 * a table he cannot open would have been the same failure wearing a new coat —
 * and it would have broken the standing rule that a fix which cannot be SEEN is
 * indistinguishable from no fix. So the log gets a screen, here, in the place
 * he already opens when something looks wrong.
 *
 * WHAT HE SHOULD SEE WHEN THINGS ARE FINE: "No client failures recorded." That
 * sentence is the useful one — it means the members complaining are not hitting
 * a client-side error, and the search moves elsewhere. An empty screen would
 * have said nothing at all.
 * ─────────────────────────────────────────────────────────────────────────────
 */

interface Row {
  hour_bucket: string;
  kind: string;
  platform: string | null;
  app_build: string | null;
  occurrences: number;
  members: number;
  sample: string | null;
}

/** Plain words. "post_create" is our name for it, not his. */
const KIND_LABEL: Record<string, string> = {
  post_create: "Could not post",
  reply: "Could not reply",
  upload: "Photo upload failed",
  blank_page: "Blank page / crash",
};

const WINDOWS = [
  { label: "24 hours", hours: 24 },
  { label: "7 days", hours: 168 },
  { label: "30 days", hours: 720 },
];

const ClientFailuresAudit = () => {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [hours, setHours] = useState(24);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (h: number) => {
    setLoading(true);
    setError(null);
    // The generated Supabase types are a snapshot and do not know a function
    // added by a later migration; the names below must match the SQL exactly.
    const { data, error: err } = await (supabase.rpc as any)("get_client_error_stats_admin", { _hours: h });
    if (err) setError(err.message || "Could not load");
    setRows((data as Row[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(hours); }, [hours, load]);

  const total = (rows ?? []).reduce((n, r) => n + Number(r.occurrences || 0), 0);

  return (
    <div className="border border-border p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <h3
          className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground flex items-center gap-2"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          Client failures
        </h3>
        <div className="flex items-center gap-2">
          {WINDOWS.map((w) => (
            <button
              key={w.hours}
              type="button"
              onClick={() => setHours(w.hours)}
              className={`text-[9px] tracking-[0.15em] uppercase px-2.5 py-1 border transition-colors ${
                hours === w.hours
                  ? "border-primary text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {w.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void load(hours)}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Refresh"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {error && (
        <p className="text-[11px] text-destructive" style={{ fontFamily: "var(--font-body)" }}>
          {error}
        </p>
      )}

      {!error && rows !== null && rows.length === 0 && (
        // Deliberately a sentence, not an empty box — "nothing is failing" is a
        // real answer and it is the one that redirects the search.
        <p className="text-[11px] text-muted-foreground flex items-center gap-2" style={{ fontFamily: "var(--font-body)" }}>
          <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
          No client failures recorded in the last {WINDOWS.find((w) => w.hours === hours)?.label}.
        </p>
      )}

      {!error && rows !== null && rows.length > 0 && (
        <>
          <p className="text-[11px] text-muted-foreground mb-2" style={{ fontFamily: "var(--font-body)" }}>
            {total} failure{total === 1 ? "" : "s"} recorded.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]" style={{ fontFamily: "var(--font-body)" }}>
              <thead>
                <tr className="text-muted-foreground text-left">
                  <th className="py-1 pr-3 font-normal">When</th>
                  <th className="py-1 pr-3 font-normal">What</th>
                  <th className="py-1 pr-3 font-normal">Where</th>
                  <th className="py-1 pr-3 font-normal text-right">Times</th>
                  <th className="py-1 pr-3 font-normal text-right">Members</th>
                  <th className="py-1 font-normal">Message</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-border align-top">
                    <td className="py-1.5 pr-3 whitespace-nowrap text-muted-foreground">
                      {new Date(r.hour_bucket).toLocaleString()}
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{KIND_LABEL[r.kind] ?? r.kind}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap text-muted-foreground">
                      {(r.platform ?? "?") + (r.app_build ? ` · ${r.app_build}` : "")}
                    </td>
                    <td className="py-1.5 pr-3 text-right">{r.occurrences}</td>
                    <td className="py-1.5 pr-3 text-right">{r.members}</td>
                    {/* The real sentence the member's browser threw — this is
                        the whole reason the table exists. */}
                    <td className="py-1.5 text-muted-foreground break-words">{r.sample}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

export default ClientFailuresAudit;
