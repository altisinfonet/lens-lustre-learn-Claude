import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/**
 * S2-C · APP HEALTH — the Owner's read-only view of the S2 numbers.
 *
 * Gate: "Owner can read, without an editor: feed p95 yesterday, upload
 * failure %, crash rate per build, egress/1k views".
 *
 * Two independent sources:
 *   1. public.admin_health_daily (20261028_0001) — what members' devices
 *      measured (S2-A telemetry). Admin only; the database refuses anyone else.
 *   2. latest.json on the `d2-synthetic-data` branch — what GitHub's runners
 *      measured from outside every 15 min (S2-B, .github/workflows/d2-synthetic.yml).
 *      It keeps working when Supabase does not.
 */

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
const rpc: Rpc = (fn, args) => (supabase.rpc as unknown as Rpc)(fn, args);

export const SYNTHETIC_URL =
  "https://raw.githubusercontent.com/altisinfonet/lens-lustre-learn-Claude/d2-synthetic-data/latest.json";
const FEED_METRICS = ["rpc.get_broadcast_feed", "rpc.get_personal_feed"];

interface Timing { day: string; metric: string; n: number; p50: number; p95: number; p99: number; fail_pct: number }
interface Build { day: string; platform: string; app_build: string; starts: number; errors: number; errors_per_100_starts: number | null }
interface Rate { day: string; attempts: number; failures: number; fail_pct: number }
export interface Daily { days: number; timings: Timing[]; builds: Build[]; realtime: Rate[]; uploads: Rate[] }
interface SynProbe { ok: boolean; status: number; ttfb: number | null; p95: number | null }
interface Synthetic {
  at: string;
  window: number;
  problems: string[];
  lanes: Record<string, { probes: Record<string, SynProbe>; est_egress_per_1k_feed_views_mb: number; feed_page_images: number }>;
}

/** Yesterday in UTC, as the database groups days. */
export function yesterdayUtc(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  return d.toISOString().slice(0, 10);
}

/** Per build over the whole window: app starts, errors, errors per 100 starts. */
export function buildsOverWindow(builds: Build[]) {
  const m = new Map<string, { platform: string; app_build: string; starts: number; errors: number }>();
  for (const b of builds) {
    const k = `${b.platform}|${b.app_build}`;
    const cur = m.get(k) ?? { platform: b.platform, app_build: b.app_build, starts: 0, errors: 0 };
    cur.starts += Number(b.starts) || 0;
    cur.errors += Number(b.errors) || 0;
    m.set(k, cur);
  }
  return [...m.values()]
    .map((b) => ({ ...b, rate: b.starts > 0 ? Math.round((10000 * b.errors) / b.starts) / 100 : null }))
    .sort((a, b) => b.starts - a.starts);
}

const fmt = (v: number | null | undefined, unit = "") => (v == null ? "—" : `${v}${unit}`);

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

export default function AdminAppHealth() {
  const [daily, setDaily] = useState<Daily | null>(null);
  const [dailyErr, setDailyErr] = useState<string | null>(null);
  const [syn, setSyn] = useState<Synthetic | null>(null);
  const [synErr, setSynErr] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setDailyErr(null);
    setSynErr(false);
    const [d, s] = await Promise.allSettled([
      rpc("admin_health_daily", { _days: 7 }),
      fetch(SYNTHETIC_URL, { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
    ]);
    if (d.status === "fulfilled" && !d.value.error && d.value.data && typeof d.value.data === "object") {
      // Shape guard: a partial payload must not take down the Health tab.
      const v = d.value.data as Partial<Daily>;
      const arr = <T,>(x: T[] | undefined) => (Array.isArray(x) ? x : []);
      setDaily({ days: Number(v.days) || 7, timings: arr(v.timings), builds: arr(v.builds), realtime: arr(v.realtime), uploads: arr(v.uploads) });
    }
    else setDailyErr(d.status === "fulfilled" ? d.value.error?.message ?? "no data" : "request failed");
    const sv = s.status === "fulfilled" ? (s.value as Partial<Synthetic> | null) : null;
    if (sv && typeof sv === "object" && sv.lanes && typeof sv.lanes === "object") {
      const lanes: Synthetic["lanes"] = {};
      for (const [k, l] of Object.entries(sv.lanes)) {
        if (l && typeof l === "object") lanes[k] = { probes: l.probes && typeof l.probes === "object" ? l.probes : {}, est_egress_per_1k_feed_views_mb: Number(l.est_egress_per_1k_feed_views_mb) || 0, feed_page_images: Number(l.feed_page_images) || 0 };
      }
      setSyn({ at: String(sv.at ?? ""), window: Number(sv.window) || 0, problems: Array.isArray(sv.problems) ? sv.problems.map(String) : [], lanes });
    }
    else setSynErr(true);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const y = yesterdayUtc();
  const feed = (daily?.timings ?? []).filter((t) => t.day === y && FEED_METRICS.includes(t.metric));
  const upY = (daily?.uploads ?? []).find((u) => u.day === y);
  const rtY = (daily?.realtime ?? []).find((r) => r.day === y);
  const builds = buildsOverWindow(daily?.builds ?? []);
  const other = (daily?.timings ?? []).filter((t) => t.day === y && !FEED_METRICS.includes(t.metric));

  return (
    <section className="space-y-4 rounded-xl border border-border p-4" aria-labelledby="app-health-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="app-health-title" className="text-lg font-semibold">App health (members' devices + outside monitor)</h2>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1 text-sm underline" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
        </button>
      </div>
      <p className="text-xs text-muted-foreground">Days are UTC. "Yesterday" = {y}.</p>

      {dailyErr ? (
        <p className="text-sm text-destructive">Device telemetry unavailable ({dailyErr}).</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {feed.length === 0 ? (
            <Tile label="Feed p95 yesterday" value="—" sub="no feed timings yet" />
          ) : (
            feed.map((f) => (
              <Tile key={f.metric} label={`Feed p95 yesterday (${f.metric.replace("rpc.get_", "").replace("_feed", "")})`} value={`${f.p95} ms`} sub={`p50 ${f.p50} · p99 ${f.p99} · n ${f.n} · fail ${f.fail_pct} %`} />
            ))
          )}
          <Tile label="Upload failure % yesterday" value={fmt(upY?.fail_pct, " %")} sub={upY ? `${upY.failures} of ${upY.attempts} (photo + video)` : "no uploads yet"} />
          <Tile label="Realtime subscribe failure % yesterday" value={fmt(rtY?.fail_pct, " %")} sub={rtY ? `${rtY.failures} of ${rtY.attempts}` : "no subscribes yet"} />
        </div>
      )}

      {!dailyErr && (
        <div className="overflow-x-auto">
          <h3 className="text-sm font-semibold mb-1">Crash rate per build (last {daily?.days ?? 7} days)</h3>
          <p className="text-xs text-muted-foreground mb-2">
            Uncaught errors (window.onerror + unhandled promise rejections) per 100 app starts. Native crashes are not in this number.
          </p>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted-foreground"><th>Platform</th><th>Build</th><th className="text-right">Starts</th><th className="text-right">Errors</th><th className="text-right">Per 100 starts</th></tr></thead>
            <tbody>
              {builds.length === 0 ? <tr><td colSpan={5} className="text-muted-foreground">No data yet.</td></tr> : builds.map((b) => (
                <tr key={`${b.platform}|${b.app_build}`}><td>{b.platform}</td><td className="font-mono">{b.app_build}</td><td className="text-right">{b.starts}</td><td className="text-right">{b.errors}</td><td className="text-right">{fmt(b.rate)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!dailyErr && other.length > 0 && (
        <div className="overflow-x-auto">
          <h3 className="text-sm font-semibold mb-1">Other timings yesterday</h3>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted-foreground"><th>Metric</th><th className="text-right">n</th><th className="text-right">p50</th><th className="text-right">p95</th><th className="text-right">p99</th><th className="text-right">fail %</th></tr></thead>
            <tbody>{other.map((t) => (
              <tr key={t.metric}><td className="font-mono">{t.metric}</td><td className="text-right">{t.n}</td><td className="text-right">{t.p50}</td><td className="text-right">{t.p95}</td><td className="text-right">{t.p99}</td><td className="text-right">{t.fail_pct}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}

      <div className="overflow-x-auto">
        <h3 className="text-sm font-semibold mb-1">Outside monitor (GitHub, every 15 min)</h3>
        {synErr || !syn ? (
          <p className="text-sm text-muted-foreground">Latest synthetic numbers unavailable. See the "D2 synthetic monitor" runs in GitHub Actions.</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground mb-2">
              Measured {syn.at ? new Date(syn.at).toLocaleString() : "—"} · p95 over the last {syn.window} runs ·{" "}
              {syn.problems.length ? <span className="text-destructive">{syn.problems.join("; ")}</span> : "all up, under thresholds"}
            </p>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted-foreground"><th>Lane</th><th>Probe</th><th>Status</th><th className="text-right">TTFB ms</th><th className="text-right">p95 ms</th></tr></thead>
              <tbody>
                {Object.entries(syn.lanes).flatMap(([lane, l]) => Object.entries(l.probes).map(([k, p]) => (
                  <tr key={`${lane}-${k}`}><td>{lane}</td><td>{k}</td><td>{p.ok ? "up" : `DOWN ${p.status}`}</td><td className="text-right">{fmt(p.ttfb)}</td><td className="text-right">{fmt(p.p95)}</td></tr>
                )))}
              </tbody>
            </table>
            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              {Object.entries(syn.lanes).map(([lane, l]) => (
                <Tile key={lane} label={`Egress per 1,000 feed views — ${lane} (estimated)`} value={`${l.est_egress_per_1k_feed_views_mb} MB`} sub={`${l.feed_page_images} images on the first feed page`} />
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              How the estimate is computed: the outside monitor loads the newest 10 public posts (the first feed page), downloads each
              image from the CDN at 640 px wide, adds up the bytes, and multiplies by 1,000. Not included: video, avatars, later pages,
              and the browser cache (which lowers real egress).
            </p>
          </>
        )}
      </div>
    </section>
  );
}
