import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import { Loader2, ArrowRightLeft, CheckCircle, XCircle, FolderSync, AlertTriangle } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";

const ALL_BUCKETS = [
  "competition-photos",
  "journal-images",
  "course-images",
  "portfolio-images",
  "avatars",
  "post-images",
  "national-ids",
  "support-attachments",
];

interface MigrationLog {
  bucket: string;
  message: string;
  status: "ok" | "error" | "info";
}

export default function StorageMigrationPanel() {
  const [scanning, setScanning] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [bucketCounts, setBucketCounts] = useState<Record<string, number>>({});
  const [selectedBuckets, setSelectedBuckets] = useState<string[]>([]);
  const [logs, setLogs] = useState<MigrationLog[]>([]);
  const [progress, setProgress] = useState(0);
  const [totalFiles, setTotalFiles] = useState(0);
  const [migratedCount, setMigratedCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const abortRef = useRef(false);

  const scanBuckets = async () => {
    setScanning(true);
    setBucketCounts({});
    setLogs([]);
    try {
      const { data, error } = await supabase.functions.invoke("migrate-storage", {
        body: { action: "list", buckets: ALL_BUCKETS },
      });
      if (error) throw error;
      if (data?.counts) {
        setBucketCounts(data.counts);
        // Auto-select buckets with files
        setSelectedBuckets(Object.entries(data.counts).filter(([, c]) => (c as number) > 0).map(([b]) => b));
      }
    } catch (err: any) {
      toast({ title: "Scan failed", description: err.message, variant: "destructive" });
    }
    setScanning(false);
  };

  const toggleBucket = (b: string) => {
    setSelectedBuckets((prev) => prev.includes(b) ? prev.filter((x) => x !== b) : [...prev, b]);
  };

  const addLog = (log: MigrationLog) => {
    setLogs((prev) => [...prev, log]);
  };

  /** Recursively discover all folders in a bucket via lightweight per-level calls */
  const discoverFolders = async (bucket: string, parent: string = ""): Promise<string[]> => {
    const { data, error } = await supabase.functions.invoke("migrate-storage", {
      body: { action: "list-folders", bucket, folder: parent },
    });
    if (error || !data) return [];
    const directFolders: string[] = data.folders || [];
    // Recurse into each discovered subfolder
    const nested: string[] = [];
    for (const folder of directFolders) {
      if (abortRef.current) break;
      const sub = await discoverFolders(bucket, folder);
      nested.push(...sub);
    }
    return [...directFolders, ...nested];
  };

  const migrateBucket = async (bucket: string): Promise<{ migrated: number; failed: number }> => {
    // Discover all folders recursively via client-side orchestration
    addLog({ bucket, message: "Discovering folders…", status: "info" });
    const allFolders = await discoverFolders(bucket);
    
    // Check for root files
    const { data: rootData } = await supabase.functions.invoke("migrate-storage", {
      body: { action: "list-folders", bucket, folder: "" },
    });
    const hasRootFiles = (rootData?.rootFiles || 0) > 0;

    let totalMigrated = 0;
    let totalFailed = 0;

    // Helper to migrate a single folder
    const migrateFolder = async (folder: string) => {
      let offset = 0;
      let hasMore = true;
      while (hasMore && !abortRef.current) {
        const { data, error } = await supabase.functions.invoke("migrate-storage", {
          body: { action: "migrate", bucket, folder, limit: 50, offset },
        });
        if (error) {
          addLog({ bucket, message: `Error migrating ${folder || "root"}: ${error.message}`, status: "error" });
          break;
        }
        totalMigrated += data.migrated || 0;
        totalFailed += data.failed || 0;
        setMigratedCount((p) => p + (data.migrated || 0));
        setFailedCount((p) => p + (data.failed || 0));

        if (data.failedFiles?.length) {
          for (const f of data.failedFiles) {
            addLog({ bucket, message: `Failed: ${folder ? folder + "/" : ""}${f.name} — ${f.error}`, status: "error" });
          }
        }
        if (data.migrated > 0) {
          addLog({ bucket, message: `Migrated ${data.migrated} files from ${folder || "root"} (batch offset ${offset})`, status: "ok" });
        }

        hasMore = data.hasMore;
        offset = data.nextOffset;
      }
    };

    // Migrate root files
    if (hasRootFiles) {
      await migrateFolder("");
    }

    // Migrate each discovered folder
    for (const folder of allFolders) {
      if (abortRef.current) break;
      await migrateFolder(folder);
    }

    return { migrated: totalMigrated, failed: totalFailed };
  };

  const startMigration = async () => {
    if (selectedBuckets.length === 0) {
      toast({ title: "Select at least one bucket", variant: "destructive" });
      return;
    }

    setMigrating(true);
    setLogs([]);
    setMigratedCount(0);
    setFailedCount(0);
    setProgress(0);
    abortRef.current = false;

    const total = selectedBuckets.reduce((sum, b) => sum + (bucketCounts[b] || 0), 0);
    setTotalFiles(total);

    let grandMigrated = 0;
    let grandFailed = 0;

    for (let i = 0; i < selectedBuckets.length; i++) {
      if (abortRef.current) break;
      const bucket = selectedBuckets[i];
      addLog({ bucket, message: `Starting migration for ${bucket}…`, status: "info" });

      const result = await migrateBucket(bucket);
      grandMigrated += result.migrated;
      grandFailed += result.failed;

      addLog({ bucket, message: `Completed: ${result.migrated} migrated, ${result.failed} failed`, status: result.failed > 0 ? "error" : "ok" });
      setProgress(Math.round(((i + 1) / selectedBuckets.length) * 100));
    }

    setProgress(100);
    setMigrating(false);

    if (abortRef.current) {
      toast({ title: "Migration aborted", description: `Migrated ${grandMigrated} files before stopping.` });
    } else {
      toast({
        title: "Migration complete",
        description: `${grandMigrated} files migrated, ${grandFailed} failed.`,
        variant: grandFailed > 0 ? "destructive" : "default",
      });
    }
  };

  const labelClass = "text-[10px] tracking-[0.2em] uppercase text-muted-foreground block mb-1.5";
  const totalScanned = Object.values(bucketCounts).reduce((s, c) => s + c, 0);

  return (
    <div className="border-t border-border pt-5 mt-5">
      <div className="flex items-center gap-2 mb-3">
        <FolderSync className="h-3.5 w-3.5 text-primary" />
        <span className="text-[10px] tracking-[0.2em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>
          Bulk Storage Migration
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground mb-4" style={{ fontFamily: "var(--font-body)" }}>
        Copy existing files from default storage to your configured external storage provider. Original files are preserved.
      </p>

      {/* Step 1: Scan */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={scanBuckets}
          disabled={scanning || migrating}
          className="inline-flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase px-4 py-2.5 border border-border bg-muted/30 text-foreground hover:bg-muted/60 transition-colors disabled:opacity-50 rounded-sm"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          {scanning ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRightLeft className="h-3 w-3" />}
          Scan Buckets
        </button>
        {totalScanned > 0 && !scanning && (
          <span className="text-[10px] text-muted-foreground">
            {totalScanned} total files found across {Object.values(bucketCounts).filter(c => c > 0).length} buckets
          </span>
        )}
      </div>

      {/* Step 2: Bucket selection */}
      {Object.keys(bucketCounts).length > 0 && (
        <div className="mb-4">
          <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>Select Buckets to Migrate</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            {ALL_BUCKETS.map((b) => {
              const count = bucketCounts[b] || 0;
              const selected = selectedBuckets.includes(b);
              return (
                <button
                  key={b}
                  type="button"
                  disabled={count === 0 || migrating}
                  onClick={() => toggleBucket(b)}
                  className={`text-[9px] tracking-[0.1em] uppercase px-3 py-2.5 border rounded-sm transition-colors text-left ${
                    selected
                      ? "border-primary bg-primary/10 text-primary"
                      : count === 0
                        ? "border-border/50 text-muted-foreground/40 cursor-not-allowed"
                        : "border-border text-muted-foreground hover:border-primary/50"
                  }`}
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  {b}
                  <span className="block text-[8px] mt-0.5 opacity-70">{count} files</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Step 3: Migrate */}
      {selectedBuckets.length > 0 && !migrating && Object.keys(bucketCounts).length > 0 && (
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={startMigration}
            className="inline-flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase px-5 py-2.5 bg-primary text-primary-foreground hover:opacity-90 transition-opacity rounded-sm"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            <FolderSync className="h-3 w-3" />
            Start Migration ({selectedBuckets.length} buckets)
          </button>
          <div className="border border-border/50 rounded-sm px-3 py-1.5 bg-muted/20">
            <span className="text-[9px] text-muted-foreground flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3 text-yellow-500" />
              This may take several minutes for large collections
            </span>
          </div>
        </div>
      )}

      {/* Progress */}
      {migrating && (
        <div className="space-y-3 mb-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
              Migrating… {migratedCount} done, {failedCount} failed
            </span>
            <button
              onClick={() => { abortRef.current = true; }}
              className="text-[9px] uppercase tracking-wider text-destructive hover:underline"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Abort
            </button>
          </div>
          <Progress value={progress} className="h-1.5" />
        </div>
      )}

      {/* Completed summary */}
      {!migrating && progress === 100 && (
        <div className={`flex items-center gap-2 px-4 py-3 border rounded-sm text-xs mb-4 ${
          failedCount > 0
            ? "border-destructive/40 bg-destructive/5 text-destructive"
            : "border-primary/40 bg-primary/5 text-primary"
        }`} style={{ fontFamily: "var(--font-body)" }}>
          {failedCount > 0 ? <XCircle className="h-3.5 w-3.5 shrink-0" /> : <CheckCircle className="h-3.5 w-3.5 shrink-0" />}
          <span>Migration complete: {migratedCount} files migrated, {failedCount} failed</span>
        </div>
      )}

      {/* Logs */}
      {logs.length > 0 && (
        <div className="border border-border rounded-sm overflow-hidden bg-card">
          <div className="px-4 py-2 border-b border-border bg-muted/30 flex items-center justify-between">
            <span className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
              Migration Log
            </span>
            <span className="text-[10px] text-muted-foreground font-mono">
              {logs.filter(l => l.status === "ok").length} ok · {logs.filter(l => l.status === "error").length} errors
            </span>
          </div>
          <ScrollArea className="max-h-60">
            <div className="divide-y divide-border/50">
              {logs.map((entry, i) => (
                <div key={i} className="px-4 py-2 flex items-start gap-3 text-xs hover:bg-muted/20 transition-colors">
                  {entry.status === "ok" ? <CheckCircle className="h-3 w-3 text-green-500 shrink-0 mt-0.5" /> :
                   entry.status === "error" ? <XCircle className="h-3 w-3 text-destructive shrink-0 mt-0.5" /> :
                   <ArrowRightLeft className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />}
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-foreground text-[10px] uppercase tracking-wider" style={{ fontFamily: "var(--font-heading)" }}>
                      {entry.bucket}
                    </span>
                    <p className="text-muted-foreground break-all leading-relaxed" style={{ fontFamily: "var(--font-body)" }}>
                      {entry.message}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
