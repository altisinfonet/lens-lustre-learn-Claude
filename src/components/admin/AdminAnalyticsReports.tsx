/**
 * AdminAnalyticsReports — live Google Analytics 4 dashboard.
 *
 * Calls the admin-only `ga-report` edge function (which holds the GA service
 * account and queries the GA4 Data API server-side) and renders the result as
 * KPI tiles + charts styled to the admin design system.
 *
 * Charts follow single-hue-per-magnitude: every plot is one series, so identity
 * is never color-coded and no categorical palette is needed. Colors come from
 * the design tokens (primary / muted / border), so light & dark modes just work.
 */
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, RefreshCw, Users, MousePointerClick, Eye, Clock, TrendingUp, Radio } from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, Cell,
} from "recharts";

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };

interface GaPayload {
  ok: boolean;
  range: { startDate: string; endDate: string };
  generatedAt: string;
  kpis: {
    sessions: number; totalUsers: number; newUsers: number;
    pageViews: number; avgSessionDuration: number; engagementRate: number;
  };
  timeseries: { date: string; sessions: number; users: number }[];
  topPages: { path: string; views: number }[];
  channels: { channel: string; sessions: number }[];
  countries: { country: string; users: number }[];
  devices: { device: string; sessions: number }[];
  realtimeActiveUsers: number | null;
}

const RANGES = [
  { label: "7 days", startDate: "7daysAgo" },
  { label: "28 days", startDate: "28daysAgo" },
  { label: "90 days", startDate: "90daysAgo" },
];

function fmtNum(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k";
  return String(Math.round(n));
}
function fmtDuration(seconds: number): string {
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r}s`;
}
function fmtDateShort(iso: string): string {
  const [, mm, dd] = iso.split("-");
  return `${mm}/${dd}`;
}

const PRIMARY = "hsl(var(--primary))";

const AdminAnalyticsReports = () => {
  const [rangeIdx, setRangeIdx] = useState(1); // default 28 days
  const [data, setData] = useState<GaPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);

  const load = useCallback(async (idx: number) => {
    setLoading(true);
    setError(null);
    setNotConfigured(false);
    try {
      const { data: res, error: fnErr } = await supabase.functions.invoke("ga-report", {
        body: { startDate: RANGES[idx].startDate, endDate: "today" },
      });
      if (fnErr) throw new Error(fnErr.message);
      if (res?.error === "ga_not_configured") { setNotConfigured(true); setData(null); return; }
      if (res?.error) throw new Error(res.detail || res.error);
      setData(res as GaPayload);
    } catch (e: any) {
      setError(e?.message || "Failed to load analytics");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(rangeIdx); }, [rangeIdx, load]);

  const kpiTiles = data ? [
    { icon: MousePointerClick, label: "Sessions", value: fmtNum(data.kpis.sessions) },
    { icon: Users, label: "Users", value: fmtNum(data.kpis.totalUsers) },
    { icon: TrendingUp, label: "New Users", value: fmtNum(data.kpis.newUsers) },
    { icon: Eye, label: "Page Views", value: fmtNum(data.kpis.pageViews) },
    { icon: Clock, label: "Avg. Session", value: fmtDuration(data.kpis.avgSessionDuration) },
    { icon: TrendingUp, label: "Engagement", value: `${Math.round(data.kpis.engagementRate * 100)}%` },
  ] : [];

  return (
    <div className="space-y-5">
      {/* Header: range selector + refresh + realtime */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          {RANGES.map((r, i) => (
            <button
              key={r.startDate}
              onClick={() => setRangeIdx(i)}
              className={`text-[10px] tracking-[0.12em] uppercase px-3 py-1.5 rounded-sm border transition-colors ${
                i === rangeIdx
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-transparent text-muted-foreground border-border hover:border-primary/50"
              }`}
              style={headingFont}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {data?.realtimeActiveUsers != null && (
            <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground" style={bodyFont}>
              <Radio className="h-3 w-3 text-emerald-500 animate-pulse" />
              <strong className="text-foreground">{data.realtimeActiveUsers}</strong> active now
            </span>
          )}
          <button
            onClick={() => load(rangeIdx)}
            disabled={loading}
            className="flex items-center gap-1.5 text-[10px] tracking-[0.12em] uppercase text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
            style={headingFont}
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      {/* States */}
      {loading && !data && (
        <div className="flex items-center justify-center py-16 text-muted-foreground text-xs gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading Google Analytics…
        </div>
      )}

      {notConfigured && (
        <div className="border border-dashed border-border rounded-sm p-8 text-center space-y-2">
          <p className="text-sm text-foreground" style={headingFont}>Google Analytics not connected yet</p>
          <p className="text-[11px] text-muted-foreground max-w-md mx-auto" style={bodyFont}>
            Once the GA4 service-account credentials are set on the server, live reports appear here automatically — sessions, users, top pages, sources, countries and devices.
          </p>
        </div>
      )}

      {error && !notConfigured && (
        <div className="border border-destructive/30 bg-destructive/5 rounded-sm p-4">
          <p className="text-[11px] text-destructive" style={bodyFont}>Couldn't load analytics: {error}</p>
        </div>
      )}

      {data && (
        <>
          {/* KPI tiles */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            {kpiTiles.map((k) => (
              <div key={k.label} className="border border-border rounded-sm p-3 bg-muted/10">
                <div className="flex items-center gap-1.5 mb-2">
                  <k.icon className="h-3 w-3 text-primary" />
                  <span className="text-[8px] tracking-[0.12em] uppercase text-muted-foreground" style={headingFont}>{k.label}</span>
                </div>
                <div className="text-lg font-bold text-foreground tabular-nums" style={headingFont}>{k.value}</div>
              </div>
            ))}
          </div>

          {/* Sessions over time — single series, area */}
          <div className="border border-border rounded-sm p-4">
            <h3 className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground mb-3" style={headingFont}>Sessions over time</h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.timeseries} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gaSessions" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={PRIMARY} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={PRIMARY} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.4} vertical={false} />
                  <XAxis dataKey="date" tickFormatter={fmtDateShort} tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={40} tickFormatter={fmtNum} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 4, fontSize: 11 }}
                    labelStyle={{ color: "hsl(var(--muted-foreground))" }}
                    formatter={(v: number) => [v.toLocaleString(), "Sessions"]}
                  />
                  <Area type="monotone" dataKey="sessions" stroke={PRIMARY} strokeWidth={2} fill="url(#gaSessions)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Breakdowns: top pages + channels */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <HBarCard title="Top pages" data={data.topPages.map((p) => ({ name: p.path, value: p.views }))} unit="views" />
            <HBarCard title="Traffic sources" data={data.channels.map((c) => ({ name: c.channel, value: c.sessions }))} unit="sessions" />
          </div>

          {/* Countries + devices */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <HBarCard title="Top countries" data={data.countries.map((c) => ({ name: c.country, value: c.users }))} unit="users" />
            <HBarCard title="Devices" data={data.devices.map((d) => ({ name: d.device, value: d.sessions }))} unit="sessions" />
          </div>

          <p className="text-[9px] text-muted-foreground/60 text-right" style={bodyFont}>
            Data from Google Analytics 4 · {new Date(data.generatedAt).toLocaleString()}
          </p>
        </>
      )}
    </div>
  );
};

/* Horizontal single-hue magnitude bars with direct value labels. */
const HBarCard = ({ title, data, unit }: { title: string; data: { name: string; value: number }[]; unit: string }) => {
  const rowH = 28;
  const height = Math.max(data.length * rowH, 60);
  return (
    <div className="border border-border rounded-sm p-4">
      <h3 className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground mb-3" style={headingFont}>{title}</h3>
      {data.length === 0 ? (
        <p className="text-[11px] text-muted-foreground py-6 text-center" style={bodyFont}>No data yet</p>
      ) : (
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 40, left: 0, bottom: 0 }} barCategoryGap={4}>
              <XAxis type="number" hide />
              <YAxis
                type="category" dataKey="name" width={130}
                tick={{ fontSize: 9, fill: "hsl(var(--foreground))" }} tickLine={false} axisLine={false}
                tickFormatter={(s: string) => (s.length > 20 ? s.slice(0, 19) + "…" : s)}
              />
              <Tooltip
                cursor={{ fill: "hsl(var(--muted))", fillOpacity: 0.3 }}
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 4, fontSize: 11 }}
                formatter={(v: number) => [v.toLocaleString(), unit]}
              />
              <Bar dataKey="value" fill={PRIMARY} radius={[0, 3, 3, 0]} label={{ position: "right", fontSize: 9, fill: "hsl(var(--muted-foreground))", formatter: (v: number) => v.toLocaleString() }}>
                {data.map((_, i) => <Cell key={i} fillOpacity={1 - i * 0.06} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

export default AdminAnalyticsReports;
