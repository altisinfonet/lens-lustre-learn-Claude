/**
 * Admin → Video Feature → Video Conversion (CONVERTER-DESIGN.md v2 §8).
 *
 * Where a new video post or video ad is prepared for streaming: on the
 * member's device (today) or on our Oracle server. One switch, saved through
 * the admin settings write (src/lib/admin/videoConversion.ts — RLS admins
 * only, every change audited by the table's trigger), with what each choice
 * means in plain words and the history underneath, folded, like the other
 * Video Feature pages.
 *
 * The converter is best-effort and free (it can be away): the note under
 * "On our server" says what happens then, so the switch is only turned on
 * while it runs. The database enforces the choice; the app follows it within
 * a few minutes.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, Loader2, Server, Smartphone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { toast } from "@/hooks/core/use-toast";
import type { ConversionMode } from "@/lib/video/conversionMode";
import {
  CONVERSION_OPTIONS, conversionLabel, loadConversionHistory, loadConversionState, saveConversionMode,
  type ConversionChange, type ConversionState,
} from "@/lib/admin/videoConversion";
import { shortId } from "@/lib/admin/featureSwitches";

const ICON: Record<ConversionMode, typeof Server> = { device: Smartphone, server: Server };

function ModePill({ mode }: { mode: ConversionMode }) {
  const look = mode === "server" ? "bg-emerald-500/15 text-emerald-600 ring-emerald-500/30" : "bg-muted text-muted-foreground ring-border";
  return (
    <span data-testid="conversion-status" className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${look}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${mode === "server" ? "bg-current" : "bg-muted-foreground"}`} />
      {mode === "server" ? "On our server" : "On the member's device"}
    </span>
  );
}

export default function AdminVideoConversion() {
  const { user } = useAuth();
  const [saved, setSaved] = useState<ConversionState | null>(null);
  const [history, setHistory] = useState<ConversionChange[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [mode, setMode] = useState<ConversionMode>("device");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [state, changes] = await Promise.all([loadConversionState(), loadConversionHistory()]);
      setLoadError(null);
      setSaved(state);
      setMode(state.mode);
      setHistory(changes);
      const ids = new Set<string>(changes.map((c) => c.by).filter((x): x is string => !!x));
      if (state.updatedBy) ids.add(state.updatedBy);
      if (ids.size === 0) return;
      // F-98: a name never travels without its handle (as the other Video Feature pages read it).
      const { data: rows } = await supabase.from("profiles").select("id, full_name, custom_url").in("id", [...ids]);
      setNames(new Map(((rows ?? []) as Array<{ id: string; full_name: string | null }>).filter((r) => r.full_name).map((r) => [r.id, r.full_name as string])));
    } catch (e) {
      setLoadError((e as Error).message || "The setting could not be read.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loadError) return <p role="alert" className="text-sm text-destructive">{loadError}</p>;
  if (!saved) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  const who = (id: string | null) => (id ? names.get(id) ?? shortId(id) : "system");
  const dirty = mode !== saved.mode;
  const save = async () => {
    if (!user) return;
    setSaving(true); setError(null);
    try {
      await saveConversionMode(mode, user.id);
      toast({ title: `Video conversion: ${conversionLabel(mode)}` });
      await load();
    } catch (e) {
      setError((e as Error).message || "The setting could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const card = "rounded-lg border border-border bg-card p-4";
  const label = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

  return (
    <div className="mx-auto max-w-2xl space-y-4" data-testid="video-conversion">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Server className="h-5 w-5" /></div>
        {/* A 14rem basis: on a phone the status pill wraps under the title instead of squeezing it. */}
        <div className="min-w-0 flex-[1_1_14rem]">
          <h2 className="text-lg font-semibold leading-tight">Video Conversion</h2>
          <p className="text-xs text-muted-foreground">Where a new video post or video ad is prepared for streaming.</p>
        </div>
        <ModePill mode={saved.mode} />
      </header>

      <section aria-labelledby="conv-where" className={`${card} space-y-3`}>
        <h3 id="conv-where" className={label}>Where videos are prepared</h3>
        <fieldset className="space-y-2">
          <legend className="sr-only">Video conversion</legend>
          {CONVERSION_OPTIONS.map((o) => {
            const Icon = ICON[o.mode];
            const on = mode === o.mode;
            return (
              <label key={o.mode}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${on ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"}`}>
                <input type="radio" name="video-conversion" value={o.mode} checked={on} onChange={() => setMode(o.mode)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-primary" />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> {o.label}
                    {saved.mode === o.mode && <span className="text-[11px] font-normal text-muted-foreground">· current</span>}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{o.note}</span>
                </span>
              </label>
            );
          })}
        </fieldset>
        {mode === "server" && (
          <p role="note" className="flex items-start gap-1.5 rounded-md bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Choose this only while the converter is running. If it is away, new videos wait in its queue and are refused after 48 hours.
          </p>
        )}
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        <button type="button" onClick={() => void save()} disabled={!dirty || saving || !user}
          className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground disabled:opacity-40">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save
        </button>
        <p className="text-[11px] text-muted-foreground">
          Members&apos; apps follow a change within a few minutes. Videos already on their way finish the way they started.
          {saved.updatedAt && <> Last changed {new Date(saved.updatedAt).toLocaleString()}{saved.updatedBy ? ` by ${who(saved.updatedBy)}` : ""}.</>}
        </p>
      </section>

      <details className="group rounded-lg border border-border bg-card px-4">
        {/* The whole row is the tap target (44px), not just the words. */}
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground [&::-webkit-details-marker]:hidden">
          History ({history.length})
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        {history.length === 0 ? <p className="pb-4 text-xs text-muted-foreground">Nothing yet.</p> : (
          <ol className="mb-4 space-y-1.5 border-l border-border pl-3 text-xs">
            {history.map((h, i) => (
              <li key={`${h.at}-${i}`}>
                <time dateTime={h.at} className="text-muted-foreground">{new Date(h.at).toLocaleString()}</time>{" — "}
                {who(h.by)} chose {conversionLabel(h.to)}{h.from ? ` (was ${conversionLabel(h.from)})` : ""}
              </li>
            ))}
          </ol>
        )}
      </details>
    </div>
  );
}
