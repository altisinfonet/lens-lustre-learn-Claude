import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { User } from "@supabase/supabase-js";
import { Activity, HardDrive, AlertTriangle, Clock, CheckCircle2, XCircle, RefreshCw, Search, FileWarning, Download } from "lucide-react";
// JudgingInvariantsAudit moved to /admin/competition_health
// JudgingDriftAudit moved to /admin/competition_health
// AwardsIntegrityAudit moved to /admin/competition_health
import WalletReconciliationAudit from "@/components/admin/WalletReconciliationAudit";
import WalletReconciliationLogAudit from "@/components/admin/WalletReconciliationLogAudit";
import WalletLedgerV2DiffAudit from "@/components/admin/WalletLedgerV2DiffAudit";
// CollusionAudit moved to /admin/competition_health
// CertificateDriftAudit moved to /admin/competition_health
// UnjudgedParityAudit moved to /admin/competition_health
// JudgeUIvsDBGateAudit moved to /admin/competition_health
import NotificationsHealthAudit from "@/components/admin/NotificationsHealthAudit";
import CacheBusterControl from "@/components/admin/CacheBusterControl";

interface OrphanReport {
  scan_timestamp: string;
  summary: {
    buckets_scanned: number;
    db_references_found: number;
    total_orphan_files: number;
    total_orphan_size_bytes: number;
    total_orphan_size_mb: number;
  };
  bucket_stats: Record<string, { total: number; orphans: number; orphanSize: number }>;
  orphan_files: { bucket: string; path: string; fullPath: string; size: number; created_at: string; age_days: number }[];
  note: string;
}

interface HealthData {
  dbConnected: boolean;
  authConnected: boolean;
  storageConnected: boolean;
  tableCounts: Record<string, number>;
  storageBuckets: { name: string; public: boolean }[];
  recentErrors: number;
  lastChecked: string;
}

const CORE_TABLES = [
  "profiles", "competitions", "competition_entries", "courses", "journal_articles",
  "posts", "portfolio_images", "certificates", "wallets", "friendships",
] as const;

const AdminHealth = ({ user }: { user: User | null }) => {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageMetrics, setPageMetrics] = useState<{ lcp: number | null; fcp: number | null; ttfb: number | null }>({ lcp: null, fcp: null, ttfb: null });
  const [orphanReport, setOrphanReport] = useState<OrphanReport | null>(null);
  const [orphanLoading, setOrphanLoading] = useState(false);
  const [orphanError, setOrphanError] = useState<string | null>(null);
  const [backfillRunning, setBackfillRunning] = useState(false);
  const [backfillResults, setBackfillResults] = useState<Record<string, any> | null>(null);
  const [backfillError, setBackfillError] = useState<string | null>(null);
  const [cacheRunning, setCacheRunning] = useState(false);
  const [cacheResults, setCacheResults] = useState<Record<string, any> | null>(null);
  const [cacheError, setCacheError] = useState<string | null>(null);

  const runBackfill = async (target: string, force = false) => {
    setBackfillRunning(true);
    setBackfillError(null);
    try {
      const { data, error } = await supabase.functions.invoke("backfill-thumbnails", {
        body: { target, limit: 50, force },
      });
      if (error) throw error;
      setBackfillResults(data?.results || {});
    } catch (e: any) {
      setBackfillError(e?.message || "Backfill failed");
    }
    setBackfillRunning(false);
  };

  const runCacheFix = async () => {
    setCacheRunning(true);
    setCacheError(null);
    try {
      const { data, error } = await supabase.functions.invoke("fix-cache-headers", {
        body: { limit: 200 },
      });
      if (error) throw error;
      setCacheResults(data?.results || {});
    } catch (e: any) {
      setCacheError(e?.message || "Cache fix failed");
    }
    setCacheRunning(false);
  };

  const runCheck = async () => {
    setLoading(true);
    const result: HealthData = {
      dbConnected: false,
      authConnected: false,
      storageConnected: false,
      tableCounts: {},
      storageBuckets: [],
      recentErrors: 0,
      lastChecked: new Date().toISOString(),
    };

    // DB connectivity + table counts
    try {
      const counts = await Promise.all(
        CORE_TABLES.map(async (table) => {
          const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
          return { table, count: error ? -1 : (count ?? 0) };
        })
      );
      result.dbConnected = counts.some((c) => c.count >= 0);
      counts.forEach((c) => { result.tableCounts[c.table] = c.count; });
    } catch (err) { console.error("[AdminHealth] DB check failed:", err); result.dbConnected = false; }

    // Auth check
    try {
      const { data } = await supabase.auth.getSession();
      result.authConnected = !!data;
    } catch (err) { console.error("[AdminHealth] Auth check failed:", err); result.authConnected = false; }

    // Storage check
    try {
      const { data } = await supabase.storage.listBuckets();
      if (data) {
        result.storageConnected = true;
        result.storageBuckets = data.map((b) => ({ name: b.name, public: b.public }));
      }
    } catch (err) { console.error("[AdminHealth] Storage check failed:", err); result.storageConnected = false; }

    setHealth(result);
    setLoading(false);
  };

  useEffect(() => {
    runCheck();
    // Gather web vitals from current page
    try {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      if (nav) {
        setPageMetrics((p) => ({ ...p, ttfb: Math.round(nav.responseStart - nav.requestStart) }));
      }
      const paints = performance.getEntriesByType("paint");
      const fcp = paints.find((e) => e.name === "first-contentful-paint");
      if (fcp) setPageMetrics((p) => ({ ...p, fcp: Math.round(fcp.startTime) }));

      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1] as any;
        if (last?.startTime) setPageMetrics((p) => ({ ...p, lcp: Math.round(last.startTime) }));
      });
      observer.observe({ type: "largest-contentful-paint", buffered: true });
      return () => observer.disconnect();
    } catch { /* not supported */ }
  }, []);

  const StatusDot = ({ ok }: { ok: boolean }) => (
    <span className={`inline-block h-2.5 w-2.5 rounded-full ${ok ? "bg-green-500" : "bg-destructive"}`} />
  );

  const MetricCard = ({ label, value, unit, icon: Icon, status }: { label: string; value: string | number | null; unit?: string; icon: any; status?: "good" | "warn" | "bad" }) => (
    <div className="border border-border p-5 space-y-2">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span className="text-[10px] tracking-[0.2em] uppercase" style={{ fontFamily: "var(--font-heading)" }}>{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className={`text-2xl font-light ${status === "good" ? "text-green-500" : status === "warn" ? "text-yellow-500" : status === "bad" ? "text-destructive" : "text-foreground"}`} style={{ fontFamily: "var(--font-display)" }}>
          {value ?? "—"}
        </span>
        {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
      </div>
    </div>
  );

  const getMetricStatus = (val: number | null, good: number, warn: number): "good" | "warn" | "bad" | undefined => {
    if (val === null) return undefined;
    if (val <= good) return "good";
    if (val <= warn) return "warn";
    return "bad";
  };

  const runOrphanScan = async () => {
    setOrphanLoading(true);
    setOrphanError(null);
    try {
      const { data, error } = await supabase.functions.invoke("detect-orphan-files");
      if (error) throw error;
      setOrphanReport(data as OrphanReport);
    } catch (err: any) {
      setOrphanError(err.message || "Scan failed");
    } finally {
      setOrphanLoading(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const exportOrphanCsv = () => {
    if (!orphanReport) return;
    const header = "Bucket,Path,Size (bytes),Created At,Age (days)\n";
    const rows = orphanReport.orphan_files.map(f =>
      `"${f.bucket}","${f.path}",${f.size},"${f.created_at}",${f.age_days}`
    ).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `orphan-files-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-light" style={{ fontFamily: "var(--font-display)" }}>
            Site <em className="italic text-primary">Health</em>
          </h2>
          <p className="text-xs text-muted-foreground mt-1">Real-time system status and performance metrics</p>
        </div>
        <button
          onClick={runCheck}
          disabled={loading}
          className="inline-flex items-center gap-2 text-xs tracking-[0.15em] uppercase px-5 py-2.5 bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {/* Orphan File Detection */}
      <div className="border-2 border-primary/40 rounded-lg p-5 bg-primary/5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2" style={{ fontFamily: "var(--font-heading)" }}>
            <FileWarning className="h-3.5 w-3.5 inline mr-2" />
            Storage Orphan Detection
          </h3>
          <div className="flex gap-2">
            {orphanReport && (
              <button
                onClick={exportOrphanCsv}
                className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.1em] uppercase px-3 py-1.5 border border-border hover:bg-muted transition-colors"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                <Download className="h-3 w-3" /> Export CSV
              </button>
            )}
            <button
              onClick={runOrphanScan}
              disabled={orphanLoading}
              className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.1em] uppercase px-3 py-1.5 bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              <Search className={`h-3 w-3 ${orphanLoading ? "animate-spin" : ""}`} />
              {orphanLoading ? "Scanning…" : "Run Scan"}
            </button>
          </div>
        </div>

        {orphanError && (
          <div className="border border-destructive/30 bg-destructive/5 p-3 mb-3">
            <p className="text-xs text-destructive flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5" /> {orphanError}
            </p>
          </div>
        )}

        {!orphanReport && !orphanLoading && !orphanError && (
          <div className="border border-border p-6 text-center">
            <FileWarning className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">Click "Run Scan" to detect unreferenced files in storage buckets.</p>
            <p className="text-[10px] text-muted-foreground mt-1">Read-only — no files will be deleted.</p>
          </div>
        )}

        {orphanReport && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="border border-border p-4 text-center">
                <p className="text-xl font-light" style={{ fontFamily: "var(--font-display)" }}>{orphanReport.summary.buckets_scanned}</p>
                <p className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground mt-1" style={{ fontFamily: "var(--font-heading)" }}>Buckets Scanned</p>
              </div>
              <div className="border border-border p-4 text-center">
                <p className="text-xl font-light" style={{ fontFamily: "var(--font-display)" }}>{orphanReport.summary.db_references_found.toLocaleString()}</p>
                <p className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground mt-1" style={{ fontFamily: "var(--font-heading)" }}>DB References</p>
              </div>
              <div className="border border-border p-4 text-center">
                <p className={`text-xl font-light ${orphanReport.summary.total_orphan_files > 0 ? "text-yellow-500" : "text-green-500"}`} style={{ fontFamily: "var(--font-display)" }}>
                  {orphanReport.summary.total_orphan_files.toLocaleString()}
                </p>
                <p className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground mt-1" style={{ fontFamily: "var(--font-heading)" }}>Orphan Files</p>
              </div>
              <div className="border border-border p-4 text-center">
                <p className="text-xl font-light" style={{ fontFamily: "var(--font-display)" }}>{orphanReport.summary.total_orphan_size_mb} MB</p>
                <p className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground mt-1" style={{ fontFamily: "var(--font-heading)" }}>Orphan Size</p>
              </div>
            </div>

            <div>
              <h4 className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2" style={{ fontFamily: "var(--font-heading)" }}>Per-Bucket Breakdown</h4>
              <div className="border border-border divide-y divide-border">
                {Object.entries(orphanReport.bucket_stats).map(([bucket, stats]) => (
                  <div key={bucket} className="flex items-center justify-between p-3 text-sm">
                    <div className="flex items-center gap-2">
                      <HardDrive className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>{bucket}</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>{stats.total} files</span>
                      <span className={stats.orphans > 0 ? "text-yellow-500" : "text-green-500"}>
                        {stats.orphans} orphans
                      </span>
                      {stats.orphanSize > 0 && <span>{formatBytes(stats.orphanSize)}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {orphanReport.orphan_files.length > 0 && (
              <div>
                <h4 className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2" style={{ fontFamily: "var(--font-heading)" }}>
                  Orphan Files (Top {Math.min(orphanReport.orphan_files.length, 500)} by size)
                </h4>
                <div className="border border-border max-h-80 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted">
                      <tr>
                        <th className="text-left p-2 font-medium">Bucket</th>
                        <th className="text-left p-2 font-medium">Path</th>
                        <th className="text-right p-2 font-medium">Size</th>
                        <th className="text-right p-2 font-medium">Age</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {orphanReport.orphan_files.map((file, i) => (
                        <tr key={i} className="hover:bg-muted/50">
                          <td className="p-2 text-muted-foreground">{file.bucket}</td>
                          <td className="p-2 font-mono text-[10px] break-all max-w-[300px]">{file.path}</td>
                          <td className="p-2 text-right text-muted-foreground whitespace-nowrap">{formatBytes(file.size)}</td>
                          <td className="p-2 text-right text-muted-foreground whitespace-nowrap">{file.age_days}d</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-muted-foreground mt-2 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> {orphanReport.note}
                </p>
              </div>
            )}

            <p className="text-[10px] text-muted-foreground">
              Scanned at: {new Date(orphanReport.scan_timestamp).toLocaleString()}
            </p>
          </div>
        )}
      </div>

      {/* Thumbnail Backfill */}
      <div className="border-2 border-primary/40 rounded-lg p-5 bg-primary/5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2" style={{ fontFamily: "var(--font-heading)" }}>
            <HardDrive className="h-3.5 w-3.5 inline mr-2" />
            Thumbnail Backfill
          </h3>
          <div className="flex gap-2 flex-wrap">
            {["all", "hero_banners", "photo_of_the_day", "posts", "competition_entries", "featured_photos"].map((t) => (
              <button
                key={t}
                onClick={() => runBackfill(t)}
                disabled={backfillRunning}
                className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.1em] uppercase px-3 py-1.5 border border-border hover:bg-muted transition-colors disabled:opacity-50"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                <RefreshCw className={`h-3 w-3 ${backfillRunning ? "animate-spin" : ""}`} />
                {t.replace(/_/g, " ")}
              </button>
            ))}
            <button
              onClick={() => runBackfill("all", true)}
              disabled={backfillRunning}
              className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.1em] uppercase px-3 py-1.5 bg-destructive text-destructive-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
              style={{ fontFamily: "var(--font-heading)" }}
              title="Re-encode legacy thumbnails that aren't true WebP"
            >
              <RefreshCw className={`h-3 w-3 ${backfillRunning ? "animate-spin" : ""}`} />
              Force WebP
            </button>
          </div>
        </div>
        {backfillError && (
          <div className="border border-destructive/30 bg-destructive/5 p-3 mb-3">
            <p className="text-xs text-destructive flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5" /> {backfillError}
            </p>
          </div>
        )}
        {!backfillResults && !backfillRunning && !backfillError && (
          <p className="text-xs text-muted-foreground">Generates 600px JPEG thumbnails for legacy rows missing thumbnail data. Processes 50 rows per click — re-click until done.</p>
        )}
        {backfillResults && (
          <div className="border border-border divide-y divide-border">
            {Object.entries(backfillResults).map(([table, stats]: [string, any]) => (
              <div key={table} className="p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{table}</span>
                  {stats.error ? (
                    <span className="text-destructive">{stats.error}</span>
                  ) : (
                    <span className="text-muted-foreground">
                      {stats.succeeded}/{stats.processed} ok · {stats.failed} failed
                    </span>
                  )}
                </div>
                {stats.errors?.length > 0 && (
                  <ul className="mt-1 text-[10px] text-destructive/70 list-disc pl-4">
                    {stats.errors.map((e: string, i: number) => <li key={i}>{e}</li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Moved to Competitions → Competition Health */}

      {/* Moved to Competitions → Competition Health */}

      {/* Moved to Competitions → Competition Health */}

      {/* Wallet Phase 2.3 — Gift + Referral Reconciliation Audit (global) */}
      <WalletReconciliationAudit />

      {/* Phase-1A Step B — Wallet Ledger v2 Hourly Diff Monitor (DRY-RUN) */}
      <WalletLedgerV2DiffAudit />

      {/* Phase 1 — Minimal recon visibility: latest 25 wallet_reconciliation_log rows */}
      <WalletReconciliationLogAudit />


      {/* Moved to Competitions → Competition Health */}

      {/* Moved to Competitions → Competition Health */}

      {/* Moved to Competitions → Competition Health */}

      {/* Moved to Competitions → Competition Health */}

      {/* Phase 4 — Notification Health (compact card → full page) */}
      <NotificationsHealthAudit compact />

      {/* Dev/Test — Global Cache-Buster Toggle */}
      <CacheBusterControl />

      {/* Cache-Control Header Fix */}
      <div className="border-2 border-primary/40 rounded-lg p-5 bg-primary/5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2" style={{ fontFamily: "var(--font-heading)" }}>
            <HardDrive className="h-3.5 w-3.5 inline mr-2" />
            Cache-Control Repair (Re-Upload)
          </h3>
          <button
            onClick={runCacheFix}
            disabled={cacheRunning}
            className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.1em] uppercase px-3 py-1.5 bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            <RefreshCw className={`h-3 w-3 ${cacheRunning ? "animate-spin" : ""}`} />
            {cacheRunning ? "Re-uploading…" : "Fix Cache Headers"}
          </button>
        </div>
        {cacheError && (
          <div className="border border-destructive/30 bg-destructive/5 p-3 mb-3">
            <p className="text-xs text-destructive flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5" /> {cacheError}
            </p>
          </div>
        )}
        {!cacheResults && !cacheRunning && !cacheError && (
          <p className="text-xs text-muted-foreground">
            Re-uploads existing storage files with <code className="text-primary">cacheControl: 31536000</code> so the public CDN endpoint serves <code>max-age=31536000</code> instead of <code>no-cache</code>. Processes up to 200 files per bucket per click — re-click to continue. Files already correctly cached are skipped.
          </p>
        )}
        {cacheResults && (
          <div className="border border-border divide-y divide-border">
            {Object.entries(cacheResults).map(([bucket, stats]: [string, any]) => (
              <div key={bucket} className="p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{bucket}</span>
                  <span className="text-muted-foreground">
                    {stats.fixed} fixed · {stats.skipped} ok · {stats.failed} failed · {stats.listed} scanned
                  </span>
                </div>
                {stats.errors?.length > 0 && (
                  <ul className="mt-1 text-[10px] text-destructive/70 list-disc pl-4">
                    {stats.errors.map((e: string, i: number) => <li key={i}>{e}</li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground mb-3" style={{ fontFamily: "var(--font-heading)" }}>
          Service Status
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { label: "Database", ok: health?.dbConnected },
            { label: "Authentication", ok: health?.authConnected },
            { label: "File Storage", ok: health?.storageConnected },
          ].map((s) => (
            <div key={s.label} className="border border-border p-4 flex items-center gap-3">
              {loading ? (
                <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : s.ok ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : (
                <XCircle className="h-4 w-4 text-destructive" />
              )}
              <div>
                <p className="text-sm">{s.label}</p>
                <p className="text-[10px] text-muted-foreground">{loading ? "Checking…" : s.ok ? "Operational" : "Unreachable"}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Page Performance */}
      <div>
        <h3 className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground mb-3" style={{ fontFamily: "var(--font-heading)" }}>
          Page Performance (This Page)
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <MetricCard label="LCP" value={pageMetrics.lcp} unit="ms" icon={Clock} status={getMetricStatus(pageMetrics.lcp, 2500, 4000)} />
          <MetricCard label="FCP" value={pageMetrics.fcp} unit="ms" icon={Activity} status={getMetricStatus(pageMetrics.fcp, 1800, 3000)} />
          <MetricCard label="TTFB" value={pageMetrics.ttfb} unit="ms" icon={Activity} status={getMetricStatus(pageMetrics.ttfb, 800, 1800)} />
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">Green ≤ good threshold · Yellow = needs improvement · Red = poor</p>
      </div>

      {/* Storage Buckets */}
      {health && health.storageBuckets.length > 0 && (
        <div>
          <h3 className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground mb-3" style={{ fontFamily: "var(--font-heading)" }}>
            Storage Buckets ({health.storageBuckets.length})
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {health.storageBuckets.map((b) => (
              <div key={b.name} className="border border-border p-4 flex items-center gap-3">
                <HardDrive className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm truncate">{b.name}</p>
                  <p className="text-[10px] text-muted-foreground">{b.public ? "Public" : "Private"}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Data Overview */}
      {health && Object.keys(health.tableCounts).length > 0 && (
        <div>
          <h3 className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground mb-3" style={{ fontFamily: "var(--font-heading)" }}>
            Data Overview
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {Object.entries(health.tableCounts)
              .filter(([, v]) => v >= 0)
              .map(([table, count]) => (
                <div key={table} className="border border-border p-4 text-center">
                  <p className="text-xl font-light" style={{ fontFamily: "var(--font-display)" }}>{count.toLocaleString()}</p>
                  <p className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground mt-1" style={{ fontFamily: "var(--font-heading)" }}>
                    {table.replace(/_/g, " ")}
                  </p>
                </div>
              ))}
          </div>
        </div>
      )}

      {health && (
        <p className="text-[10px] text-muted-foreground">
          Last checked: {new Date(health.lastChecked).toLocaleString()}
        </p>
      )}
    </div>
  );
};

export default AdminHealth;
