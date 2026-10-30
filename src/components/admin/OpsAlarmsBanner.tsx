import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { describeOpsAlarms, type OpsAlarmRow, type OpsBanner } from "@/lib/opsAlarms";

// Admin → Health banner for the in-database alarms (20261103_0300_ops_alarms).
// Shows every open alarm, and warns when the in-database monitor itself has
// stopped checking (no check for 20 minutes), so a silent monitor is visible.

type QueryResult<T> = { data: T[] | null; error: { code?: string; message: string } | null };
type Query<T> = PromiseLike<QueryResult<T>> & {
  is: (c: string, v: null) => Query<T>;
  order: (c: string, o: { ascending: boolean }) => Query<T>;
  limit: (n: number) => Query<T>;
};
type Untyped = { from: <T>(t: string) => { select: (cols: string) => Query<T> } };

const OpsAlarmsBanner = () => {
  const [banner, setBanner] = useState<OpsBanner>({ level: "none" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const db = supabase as unknown as Untyped;
      const [alarms, lastCheck] = await Promise.all([
        db.from<OpsAlarmRow>("ops_alarms").select("alarm_key, summary, opened_at").is("closed_at", null).order("opened_at", { ascending: false }),
        db.from<{ requested_at: string }>("ops_probe_requests").select("requested_at").order("requested_at", { ascending: false }).limit(1),
      ]);
      if (cancelled) return;
      const installed = !alarms.error || alarms.error.code !== "42P01";
      if (alarms.error && installed) {
        setBanner({ level: "unknown", lines: ["Could not read alarms: " + alarms.error.message] });
        return;
      }
      setBanner(describeOpsAlarms(alarms.data ?? [], lastCheck.data?.[0]?.requested_at ?? null, new Date(), installed));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (banner.level === "none") return null;
  const isAlarm = banner.level === "alarm";
  return (
    <div
      role={isAlarm ? "alert" : "status"}
      className={`border p-4 text-sm ${isAlarm ? "border-destructive bg-destructive/10 text-destructive" : "border-border bg-muted/40 text-muted-foreground"}`}
    >
      <div className="flex items-center gap-2 font-medium">
        <AlertTriangle className="h-4 w-4" aria-hidden="true" /> {isAlarm ? "ALARM" : "Alarms"}
      </div>
      <ul className="mt-2 list-disc pl-5 space-y-1">
        {banner.lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </div>
  );
};

export default OpsAlarmsBanner;
