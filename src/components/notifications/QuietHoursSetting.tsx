/**
 * N7 · quiet hours (20261104_0180). Phone alerts stay silent between two
 * times in the member's own time zone; the notifications still land in the
 * bell. The centre reads the saved row (0110) and, for a group switched on,
 * push follows it (0170). Shown only with the centre screens on.
 *
 * - The control changes only after the server says yes; a failed save shows
 *   an alert and leaves things as they were.
 * - A failed LOAD is said out loud and the switch stays disabled, so a member
 *   who already has quiet hours can never overwrite them by accident.
 * - Times save when the member leaves the field, not on every keystroke.
 * - Old zone names that phones still report (Asia/Calcutta …) are sent under
 *   today's name, which the database knows.
 */
import { useEffect, useState } from "react";
import { Moon } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/i18n/I18nContext";

type Hours = { starts: string; ends: string };
type QuietRow = { starts?: string | null; ends?: string | null };

const DEFAULT_STARTS = "22:00";
const DEFAULT_ENDS = "07:00";
const hhmm = (t: string) => t.slice(0, 5);

/** Old IANA names some browsers still report → the current names. */
const OLD_ZONE_NAMES: Record<string, string> = {
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Dacca": "Asia/Dhaka",
  "Asia/Thimbu": "Asia/Thimphu",
  "Asia/Ulan_Bator": "Asia/Ulaanbaatar",
  "Europe/Kiev": "Europe/Kyiv",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Pacific/Truk": "Pacific/Chuuk",
  "Pacific/Ponape": "Pacific/Pohnpei",
};

export function canonicalZone(zone: string): string {
  if (!zone) return "UTC";
  return OLD_ZONE_NAMES[zone] ?? zone;
}

const phoneZone = () => {
  try {
    return canonicalZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "");
  } catch {
    return "UTC";
  }
};

export default function QuietHoursSetting() {
  const t = useT();
  const [state, setState] = useState<"loading" | "ready" | "load_failed">("loading");
  const [saved, setSaved] = useState<Hours | null>(null);
  const [draft, setDraft] = useState<Hours | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const zone = phoneZone();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase.rpc("notif_quiet_hours_get" as never);
        if (error) throw error;
        const rows = ((data ?? []) as unknown as QuietRow[]) ?? [];
        const row = rows[0];
        if (!alive) return;
        if (row?.starts && row?.ends) {
          const h = { starts: hhmm(row.starts), ends: hhmm(row.ends) };
          setSaved(h);
          setDraft(h);
        }
        setState("ready");
      } catch {
        if (alive) setState("load_failed");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const save = async (next: Hours | null) => {
    setBusy(true);
    setSaveFailed(false);
    try {
      const { error } = await supabase.rpc("notif_quiet_hours_set" as never, {
        _starts: next ? next.starts : null,
        _ends: next ? next.ends : null,
        _tz: next ? zone : null,
      } as never);
      if (error) throw error;
      setSaved(next);
      setDraft(next);
    } catch {
      setSaveFailed(true);
      setDraft(saved);                          // back to what is really saved
    } finally {
      setBusy(false);
    }
  };

  const commit = () => {
    if (!draft || !saved) return;
    if (!draft.starts || !draft.ends) return setDraft(saved);
    if (draft.starts !== saved.starts || draft.ends !== saved.ends) void save(draft);
  };

  const on = saved !== null;
  const label = t("notif.quiet.title", "Quiet hours");

  return (
    <section className="mt-6 rounded-lg border border-border/60 p-4" aria-labelledby="quiet-hours-title">
      <div className="flex items-start gap-3">
        <Moon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p id="quiet-hours-title" className="text-sm font-medium text-foreground">{label}</p>
          <p id="quiet-hours-desc" className="text-xs text-muted-foreground">
            {t("notif.quiet.desc", "No phone alerts between these times. They still appear in your notifications.")}{" "}
            {t("notif.quiet.zone", "Times are in your phone's time zone")} ({zone}).
          </p>
        </div>
        <Switch
          aria-label={label}
          aria-describedby="quiet-hours-desc"
          checked={on}
          disabled={state !== "ready" || busy}
          onCheckedChange={(v) => save(v ? { starts: DEFAULT_STARTS, ends: DEFAULT_ENDS } : null)}
        />
      </div>

      {on && draft && (
        <div className="mt-3 flex flex-wrap items-center gap-4 pl-7">
          <label className="flex items-center gap-2 text-sm text-foreground">
            {t("notif.quiet.from", "From")}
            <input
              type="time"
              value={draft.starts}
              onChange={(e) => setDraft({ ...draft, starts: e.target.value })}
              onBlur={commit}
              className="min-h-11 rounded-md border border-input bg-background px-2 py-1 text-base"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground">
            {t("notif.quiet.to", "To")}
            <input
              type="time"
              value={draft.ends}
              onChange={(e) => setDraft({ ...draft, ends: e.target.value })}
              onBlur={commit}
              className="min-h-11 rounded-md border border-input bg-background px-2 py-1 text-base"
            />
          </label>
        </div>
      )}

      {state === "load_failed" && (
        <p role="alert" className="mt-2 pl-7 text-xs text-destructive">
          {t("notif.quiet.load_failed", "Could not load quiet hours. Please try again later.")}
        </p>
      )}
      {saveFailed && (
        <p role="alert" className="mt-2 pl-7 text-xs text-destructive">
          {t("notif.quiet.failed", "Could not save quiet hours. Try again.")}
        </p>
      )}
    </section>
  );
}
