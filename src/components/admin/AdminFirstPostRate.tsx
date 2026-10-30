/**
 * ADMIN → HEALTH · "New members who posted within 7 days" (first-post nudge,
 * idea 7). One read of public.admin_first_post_rate(8) (20261102_0200,
 * admin-only): per sign-up week (Monday, UTC), the last 8 weeks — how many
 * members joined, how many made their first post within 7 days of joining,
 * and the percentage. A week whose 7-day windows have not all closed yet is
 * marked "still counting": its % can only go up.
 *
 * Read-only and always shown to admins, switch on or off: the Owner needs the
 * baseline (~40 %) BEFORE switching first_post_nudge on, to see it move.
 * On a lane without 0200 the read fails and this says so — nothing else on the
 * Health tab depends on it.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
const rpc: Rpc = (fn, args) => (supabase.rpc as unknown as Rpc)(fn, args);

export interface FirstPostWeek {
  week_start: string;
  members: number;
  posted_within_7d: number;
  pct: number | null;
  complete: boolean;
}

/** Shape guard: anything unexpected in a row drops that row, never the tab. */
export function parseFirstPostWeeks(data: unknown): FirstPostWeek[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((r) => {
    if (!r || typeof r !== "object") return [];
    const o = r as Record<string, unknown>;
    if (typeof o.week_start !== "string") return [];
    const members = Number(o.members);
    const posted = Number(o.posted_within_7d);
    if (!Number.isFinite(members) || !Number.isFinite(posted)) return [];
    const pct = o.pct === null || o.pct === undefined ? null : Number(o.pct);
    return [{ week_start: o.week_start, members, posted_within_7d: posted, pct: Number.isFinite(pct as number) ? (pct as number) : null, complete: o.complete === true }];
  });
}

export default function AdminFirstPostRate() {
  const [rows, setRows] = useState<FirstPostWeek[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const { data, error } = await rpc("admin_first_post_rate", { _weeks: 8 });
      if (error) setErr(error.message ?? "not available");
      else setRows(parseFirstPostWeeks(data));
    } catch {
      setErr("request failed");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="space-y-3 rounded-xl border border-border p-4" aria-labelledby="first-post-rate-title" data-testid="first-post-rate">
      <div>
        <h2 id="first-post-rate-title" className="text-lg font-semibold">New members who posted within 7 days</h2>
        <p className="text-xs text-muted-foreground">Per sign-up week (weeks start Monday, UTC). Last 8 weeks, newest first.</p>
      </div>
      {loading && !rows && <Loader2 className="h-4 w-4 animate-spin" aria-label="Loading" />}
      {err && <p className="text-sm text-muted-foreground">Not available on this database yet ({err}).</p>}
      {rows && rows.length > 0 && (
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="py-1 font-normal">Week of</th>
              <th className="py-1 font-normal text-right">Joined</th>
              <th className="py-1 font-normal text-right">Posted in 7 days</th>
              <th className="py-1 font-normal text-right">%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.week_start} className="border-t border-border" data-testid="first-post-rate-row">
                <td className="py-1">{r.week_start}</td>
                <td className="py-1 text-right">{r.members}</td>
                <td className="py-1 text-right">{r.posted_within_7d}</td>
                <td className="py-1 text-right">
                  {r.pct === null ? "—" : `${r.pct}%`}
                  {!r.complete && r.members > 0 && <span className="ml-1 text-xs text-muted-foreground">(still counting)</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
