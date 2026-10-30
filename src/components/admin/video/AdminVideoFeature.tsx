/**
 * Admin → Video → one feature page (Owner 2026-10-12: "a separate main menu,
 * Video Feature — Copyright music check, Video ads, Video posts", "design more
 * compact, nicely spaced").
 *
 * Replaces the single Marketing → Features page (VID-7). Same server: the
 * admin-only feature_* RPCs, each write one audited row in the same
 * transaction; changes reach members within 60 s (useFeatureAllowed). Members
 * are kept when the mode changes, so "All members" → "Selected members" brings
 * the same people back.
 *
 * Layout: a header (icon, title, status pill) and a few live numbers; then two
 * columns — WHO CAN USE IT (Off / Selected members / All members, a note, Save)
 * and MEMBERS (the search, and the selected members with their own filter and
 * bulk remove); the history last, folded.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clapperboard, CloudUpload, Film, KeyRound, Loader2, Music2, Sparkles, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import {
  FEATURE_INFO, FEATURE_MODES, NOTE_MAX, describeHistory, featureErrorMessage, isDirty, modeSelectable,
  parseFeatureState, shortId, type FeatureKey, type FeatureMode, type FeatureState,
} from "@/lib/admin/featureSwitches";
import MemberSearch from "./MemberSearch";
import { MemberAvatar, StatusPill } from "./memberBits";

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
const rpc: Rpc = (fn, args) => (supabase.rpc as unknown as Rpc)(fn, args);

const ICON: Record<FeatureKey, typeof Film> = { video_posts: Film, video_ads: Clapperboard, copyright_music_check: Music2, personal_feed: Sparkles, media_ladder_feed: Sparkles, media_private_photos: Sparkles, photo_upload_resume: CloudUpload };
const MEMBERS_PAGE = 25;

/** A few live numbers for the page (admins read videos/post_videos/ad_videos through RLS). Silent on any error. */
function useNumbers(feature: FeatureKey): Array<{ label: string; value: number }> | null {
  const [nums, setNums] = useState<Array<{ label: string; value: number }> | null>(null);
  useEffect(() => {
    let live = true;
    const count = async (table: string, f?: (q: any) => any): Promise<number | null> => { // eslint-disable-line @typescript-eslint/no-explicit-any
      try {
        let q = (supabase.from as unknown as (t: string) => any)(table).select("*", { count: "exact", head: true }); // eslint-disable-line @typescript-eslint/no-explicit-any
        if (f) q = f(q);
        const { count: c, error } = await q;
        return error ? null : (c ?? 0);
      } catch { return null; }
    };
    (async () => {
      const rows: Array<[string, Promise<number | null>]> = feature === "video_posts"
        ? [["Video posts", count("post_videos")], ["Ready videos", count("videos", (q) => q.eq("purpose", "post").eq("state", "ready"))],
           ["Being prepared", count("videos", (q) => q.eq("purpose", "post").in("state", ["uploading", "checking"]))]]
        : feature === "video_ads"
          ? [["Ads with a video", count("ad_videos")], ["Ready ad videos", count("videos", (q) => q.eq("purpose", "ad").eq("state", "ready"))]]
          : feature === "copyright_music_check"
            ? [["Music checks run", count("video_music_checks")]]
            : [];
      const values = await Promise.all(rows.map(([, p]) => p));
      if (!live) return;
      const out = rows.map(([label], i) => ({ label, value: values[i] })).filter((r): r is { label: string; value: number } => r.value !== null);
      setNums(out.length ? out : null);
    })();
    return () => { live = false; };
  }, [feature]);
  return nums;
}

export default function AdminVideoFeature({ feature }: { feature: FeatureKey }) {
  const info = FEATURE_INFO[feature];
  const Icon = ICON[feature];
  const [s, setS] = useState<FeatureState | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<FeatureMode>("off");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(MEMBERS_PAGE);
  const numbers = useNumbers(feature);
  /** The server values the form was last set from (to reset it only when THEY change). */
  const lastServer = useRef<{ mode: FeatureMode; note: string | null } | null>(null);

  const load = useCallback(async () => {
    const { data, error: e } = await rpc("feature_admin_state");
    if (e) { setLoadError(featureErrorMessage(e)); return; }
    setLoadError(null);
    const mine = parseFeatureState(data).find((c) => c.feature === feature) ?? null;
    // The form follows the SERVER only when the server's value changes (first load, after Save,
    // another admin) — set here, in the same update as the state. A useEffect did this after the
    // render, and on a slow machine ran AFTER the admin's first click and undid it.
    if (mine && (!lastServer.current || lastServer.current.mode !== mine.mode || lastServer.current.note !== mine.note)) {
      lastServer.current = { mode: mine.mode, note: mine.note };
      setMode(mine.mode);
      setNote(mine.note ?? "");
    }
    setS(mine);
    if (!mine) return;
    const ids = new Set<string>();
    for (const h of mine.history) { if (h.actor) ids.add(h.actor); if (h.user_id) ids.add(h.user_id); }
    if (ids.size === 0) return;
    const { data: rows } = await supabase.from("profiles").select("id, full_name, custom_url").in("id", [...ids]);
    setNames(new Map(((rows ?? []) as Array<{ id: string; full_name: string | null }>).filter((r) => r.full_name).map((r) => [r.id, r.full_name as string])));
  }, [feature]);

  useEffect(() => { void load(); }, [load]);

  const memberIds = useMemo(() => new Set((s?.members ?? []).map((m) => m.user_id)), [s?.members]);
  const visibleMembers = useMemo(() => {
    const t = filter.trim().toLowerCase().replace(/^@/, "");
    return (s?.members ?? []).filter((m) => !t || (m.full_name ?? "").toLowerCase().includes(t) || (m.username ?? "").toLowerCase().includes(t));
  }, [s?.members, filter]);
  const who = useCallback((id: string | null) => (id ? names.get(id) ?? shortId(id) : "system"), [names]);

  if (loadError) return <p role="alert" className="text-sm text-destructive">{loadError}</p>;
  if (!s) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  const dirty = isDirty(s, mode, note);
  const save = async () => {
    setSaving(true); setError(null);
    const { error: e } = await rpc("feature_set_mode", { _feature: feature, _mode: mode, _note: note.trim() || null });
    setSaving(false);
    if (e) { setError(featureErrorMessage(e)); return; }
    toast({ title: `${info.title}: ${FEATURE_MODES.find((m) => m.mode === mode)?.label}` });
    void load();
  };
  const change = async (fn: "feature_add_member" | "feature_remove_member", ids: string[]) => {
    setBusy(true); setError(null);
    let failed = 0;
    for (const id of ids) {
      const { error: e } = await rpc(fn, { _feature: feature, _user: id, _note: null });
      if (e) { failed++; setError(featureErrorMessage(e)); }
    }
    setBusy(false);
    setPicked(new Set());
    if (ids.length > 1 && failed === 0) toast({ title: `${fn === "feature_add_member" ? "Added" : "Removed"} ${ids.length} members` });
    void load();
  };

  const card = "rounded-lg border border-border bg-card p-4";
  const label = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

  return (
    <div className="mx-auto max-w-5xl space-y-4" data-testid={`feature-${feature}`}>
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <h2 id={`feat-${feature}`} className="text-lg font-semibold leading-tight">{info.title}</h2>
          <p className="text-xs text-muted-foreground">{info.blurb}</p>
        </div>
        <StatusPill mode={s.mode} members={s.members.length} />
      </header>

      {numbers && (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {numbers.map((n) => (
            <div key={n.label} className="rounded-lg border border-border bg-card px-3 py-2">
              <dt className="text-[11px] text-muted-foreground">{n.label}</dt>
              <dd className="text-lg font-semibold tabular-nums">{n.value.toLocaleString()}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
        {/* WHO CAN USE IT */}
        <section aria-labelledby={`who-${feature}`} className={`${card} space-y-3 self-start`}>
          <h3 id={`who-${feature}`} className={label}>Who can use it</h3>
          <fieldset>
            <legend className="sr-only">{info.title} — who can use it</legend>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
              {FEATURE_MODES.map(({ mode: m, label: l }) => {
                const ok = modeSelectable(feature, m, s.key_configured);
                return (
                  <label key={m} className={`relative cursor-pointer rounded-md px-1 py-1.5 text-center text-xs font-medium transition-colors ${mode === m ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"} ${ok ? "" : "cursor-not-allowed opacity-40"}`}>
                    <input type="radio" className="sr-only" name={`mode-${feature}`} value={m} checked={mode === m} disabled={!ok} onChange={() => setMode(m)} />
                    {m === "selected" ? "Selected" : m === "everyone" ? "All" : "Off"}
                    <span className="sr-only">{l}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <p className="text-xs text-muted-foreground">
            {mode === "off" ? "Nobody can use it." : mode === "everyone" ? "Every member can use it." : `Only the ${s.members.length} member${s.members.length === 1 ? "" : "s"} listed under Members.`}
          </p>
          {feature === "copyright_music_check" && s.key_configured !== true && (
            <p role="note" className="flex items-start gap-1.5 rounded-md bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
              <KeyRound className="mt-px h-3.5 w-3.5 shrink-0" /> The music-API key isn't set, so this can't be switched on.
            </p>
          )}
          <div>
            <label htmlFor={`note-${feature}`} className="text-xs font-medium">Note <span className="text-muted-foreground">(optional)</span></label>
            <textarea id={`note-${feature}`} value={note} maxLength={NOTE_MAX} rows={2} onChange={(e) => setNote(e.target.value)}
              placeholder="Why — kept in the history"
              className="mt-1 w-full resize-none rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary" />
            <p className="text-right text-[10px] text-muted-foreground">{note.length}/{NOTE_MAX}</p>
          </div>
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          <button type="button" onClick={() => void save()} disabled={!dirty || saving}
            className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground disabled:opacity-40">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save
          </button>
        </section>

        {/* MEMBERS */}
        <section aria-labelledby={`members-${feature}`} className={`${card} space-y-3`}>
          <div className="flex items-center justify-between gap-2">
            <h3 id={`members-${feature}`} className={label}>Members</h3>
            {mode !== "selected" && <span className="text-[11px] text-muted-foreground">Used when “Selected” is on</span>}
          </div>
          <MemberSearch feature={feature} memberIds={memberIds} busy={busy} onAdd={(ids) => change("feature_add_member", ids)} />

          <div className="rounded-md border border-border">
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5">
              <span className="text-xs font-medium">Selected members ({s.members.length})</span>
              {s.members.length > 5 && (
                <input type="search" aria-label="Filter selected members" value={filter} onChange={(e) => { setFilter(e.target.value); setShown(MEMBERS_PAGE); }}
                  placeholder="Filter…" className="ml-auto h-7 w-36 rounded border border-border bg-background px-2 text-xs outline-none focus:border-primary" />
              )}
              {picked.size > 0 && (
                <button type="button" disabled={busy} onClick={() => void change("feature_remove_member", [...picked])}
                  className={`${s.members.length > 5 ? "" : "ml-auto"} inline-flex items-center gap-1 rounded bg-destructive px-2 py-0.5 text-xs font-medium text-destructive-foreground disabled:opacity-50`}>
                  <Trash2 className="h-3 w-3" /> Remove {picked.size}
                </button>
              )}
            </div>
            {s.members.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">No one yet — search above to add members.</p>
            ) : visibleMembers.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">No selected member matches “{filter}”.</p>
            ) : (
              <ul aria-label="Members added" className="divide-y divide-border">
                {visibleMembers.slice(0, shown).map((m) => {
                  const name = m.full_name || m.username || shortId(m.user_id);
                  return (
                    <li key={m.user_id} className="flex items-center gap-2.5 px-3 py-1.5 text-sm">
                      <input type="checkbox" aria-label={`Select ${name} to remove`} checked={picked.has(m.user_id)}
                        onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(m.user_id); else n.delete(m.user_id); return n; })}
                        className="h-3.5 w-3.5 accent-primary" />
                      <MemberAvatar m={m} size="chip" />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium">{name}</span>
                        {m.username && <span className="text-xs text-muted-foreground"> @{m.username}</span>}
                      </span>
                      <time dateTime={m.added_at} className="hidden text-[11px] text-muted-foreground sm:inline">added {new Date(m.added_at).toLocaleDateString()}</time>
                      <button type="button" aria-label={`Remove ${name}`} disabled={busy} onClick={() => void change("feature_remove_member", [m.user_id])}
                        className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {visibleMembers.length > shown && (
              <button type="button" onClick={() => setShown((n) => n + MEMBERS_PAGE)}
                className="w-full border-t border-border py-1.5 text-xs text-primary hover:bg-muted/40">
                Show {Math.min(MEMBERS_PAGE, visibleMembers.length - shown)} more
              </button>
            )}
          </div>
        </section>
      </div>

      <details className={card}>
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-muted-foreground">History ({s.history.length})</summary>
        {s.history.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">Nothing yet.</p> : (
          <ol className="mt-3 space-y-1.5 border-l border-border pl-3 text-xs">
            {s.history.map((h, i) => (
              <li key={`${h.at}-${i}`}>
                <time dateTime={h.at} className="text-muted-foreground">{new Date(h.at).toLocaleString()}</time>{" — "}
                {describeHistory(h, who)}{h.note ? ` — “${h.note}”` : ""}
              </li>
            ))}
          </ol>
        )}
      </details>
    </div>
  );
}
