/**
 * N7 · quiet hours (20261104_0180). Phone alerts stay silent between two
 * times in the member's own time zone; the notifications still land in the
 * bell. The centre reads the saved row (0110) and, for a group switched on,
 * push follows it (0170). Shown only with the centre screens on.
 *
 * Saving is optimistic only after the server says yes: a failed save shows an
 * alert and leaves the control as it was.
 */
import { useEffect, useState } from "react";
import { Moon } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/i18n/I18nContext";

type Saved = { starts: string; ends: string } | null;

const DEFAULT_STARTS = "22:00";
const DEFAULT_ENDS = "07:00";
const hhmm = (t: string) => t.slice(0, 5);
const phoneZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

export default function QuietHoursSetting() {
  const t = useT();
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState<Saved>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.rpc("notif_quiet_hours_get" as never);
        const row = Array.isArray(data) ? (data[0] as { starts?: string; ends?: string } | undefined) : undefined;
        if (alive && row?.starts && row?.ends) setSaved({ starts: hhmm(row.starts), ends: hhmm(row.ends) });
      } catch {
        /* nothing saved is the safe reading */
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const save = async (next: Saved) => {
    setBusy(true);
    setFailed(false);
    try {
      const { error } = await supabase.rpc("notif_quiet_hours_set" as never, {
        _starts: next ? next.starts : null,
        _ends: next ? next.ends : null,
        _tz: next ? phoneZone() : null,
      } as never);
      if (error) throw error;
      setSaved(next);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
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
            {t("notif.quiet.desc", "No phone alerts between these times. They still appear in your notifications.")}
          </p>
        </div>
        <Switch
          aria-label={label}
          aria-describedby="quiet-hours-desc"
          checked={on}
          disabled={!loaded || busy}
          onCheckedChange={(v) => save(v ? { starts: DEFAULT_STARTS, ends: DEFAULT_ENDS } : null)}
        />
      </div>

      {on && (
        <div className="mt-3 flex flex-wrap items-center gap-4 pl-7">
          <label className="flex items-center gap-2 text-xs text-foreground">
            {t("notif.quiet.from", "From")}
            <input
              type="time"
              value={saved.starts}
              disabled={busy}
              onChange={(e) => e.target.value && save({ starts: e.target.value, ends: saved.ends })}
              className="rounded-md border border-input bg-background px-2 py-1 text-xs"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-foreground">
            {t("notif.quiet.to", "To")}
            <input
              type="time"
              value={saved.ends}
              disabled={busy}
              onChange={(e) => e.target.value && save({ starts: saved.starts, ends: e.target.value })}
              className="rounded-md border border-input bg-background px-2 py-1 text-xs"
            />
          </label>
        </div>
      )}

      {failed && (
        <p role="alert" className="mt-2 pl-7 text-xs text-destructive">
          {t("notif.quiet.failed", "Could not save quiet hours. Try again.")}
        </p>
      )}
    </section>
  );
}
