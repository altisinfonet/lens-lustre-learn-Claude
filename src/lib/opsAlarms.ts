// Pure helper for the Admin → Health alarm banner (20261103_0300_ops_alarms).

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
