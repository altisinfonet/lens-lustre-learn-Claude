import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

// Admin → Health banner for the in-database alarms (20261103_0300_ops_alarms).
// Shows every open alarm, and warns when the in-database monitor itself has
// stopped checking (no check for 20 minutes), so a silent monitor is visible.

export interface OpsAlarmRow {
  alarm_key: string;
  summary: string;
  opened_at: string;
}

export type OpsBanner =
  | { level: "none" }
  | { level: "unknown"; lines: string[] }
  | { level: "alarm"; lines: string[] };

export const MONITOR_STALE_MINUTES = 20;

export function describeOpsAlarms(
  alarms: OpsAlarmRow[] | null,
  lastCheckAt: string | null,
  now: Date,
  installed: boolean,
): OpsBanner {
  if (!installed) return { level: "unknown", lines: ["In-database alarms are not installed on this lane yet."] };
  const lines = (alarms ?? []).map((a) => `${a.summary} (since ${new Date(a.opened_at).toISOString().slice(0, 16).replace("T", " ")} UTC)`);
  const staleMs = MONITOR_STALE_MINUTES * 60_000;
  if (!lastCheckAt || now.getTime() - new Date(lastCheckAt).getTime() > staleMs) {
    lines.push(
      lastCheckAt
        ? `The in-database monitor has not run since ${new Date(lastCheckAt).toISOString().slice(0, 16).replace("T", " ")} UTC — alarms may be missed.`
        : "The in-database monitor has never run — alarms may be missed.",
    );
  }
  return lines.length ? { level: "alarm", lines } : { level: "none" };
}

type Untyped = { from: (t: string) => any };

const OpsAlarmsBanner = () => {
  const [banner, setBanner] = useState<OpsBanner>({ level: "none" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const db = supabase as unknown as Untyped;
      const [alarms, lastCheck] = await Promise.all([
        db.from("ops_alarms").select("alarm_key, summary, opened_at").is("closed_at", null).order("opened_at", { ascending: false }),
        db.from("ops_probe_requests").select("requested_at").order("requested_at", { ascending: false }).limit(1),
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
