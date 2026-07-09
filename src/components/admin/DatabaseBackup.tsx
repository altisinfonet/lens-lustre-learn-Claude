import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import { Download, Loader2, Database, Clock, ShieldCheck } from "lucide-react";

export default function DatabaseBackup() {
  const [exporting, setExporting] = useState(false);
  const [lastBackup, setLastBackup] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("site_settings")
      .select("value")
      .eq("key", "last_db_backup")
      .maybeSingle()
      .then(({ data }) => {
        if (data?.value && typeof data.value === "object" && "timestamp" in (data.value as any)) {
          setLastBackup((data.value as any).timestamp);
        }
      });
  }, []);

  const exportDB = async () => {
    setExporting(true);

    try {
      // Use server-side edge function for secure export with audit logging
      const { data, error } = await supabase.functions.invoke("admin-export-db", {});

      if (error) throw error;

      // data is the SQL string
      const sqlContent = typeof data === "string" ? data : JSON.stringify(data);
      const blob = new Blob([sqlContent], { type: "application/sql" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `backup_${new Date().toISOString().slice(0, 10)}.sql`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setLastBackup(new Date().toISOString());
      toast({ title: "Backup downloaded", description: "Server-side export completed with audit trail." });
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    }

    setExporting(false);
  };

  return (
    <div className="border border-border rounded-sm overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-card/50">
        <Database className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-medium tracking-wide uppercase" style={{ fontFamily: "var(--font-heading)" }}>
          Database Backup
        </h3>
      </div>
      <div className="p-6 space-y-4">
        <p className="text-xs text-muted-foreground leading-relaxed" style={{ fontFamily: "var(--font-body)" }}>
          Export all database tables as a SQL file via secure server-side process. All exports are audit-logged with admin identity and timestamp.
        </p>

        <div className="flex items-center gap-2 text-[10px] text-primary" style={{ fontFamily: "var(--font-heading)" }}>
          <ShieldCheck className="h-3 w-3" />
          <span className="tracking-[0.15em] uppercase">Server-side export with audit trail</span>
        </div>

        <button
          onClick={exportDB}
          disabled={exporting}
          className="inline-flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase px-5 py-2.5 border border-primary bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          {exporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
          {exporting ? "Exporting..." : "Download SQL Backup"}
        </button>

        {lastBackup && (
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
            <Clock className="h-3 w-3" />
            <span>Last backup: {new Date(lastBackup).toLocaleString()}</span>
          </div>
        )}

        <p className="text-[10px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
          <strong className="text-foreground">Note:</strong> Exports up to 10,000 rows per table. All exports are verified server-side with admin authentication and logged to the audit trail.
        </p>
      </div>
    </div>
  );
}
