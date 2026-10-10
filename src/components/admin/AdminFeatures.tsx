/**
 * Admin → Features (VID-7, R-103).
 *
 * One card per feature. Each has a three-way switch — "Off" / "Selected members"
 * / "All members" — a note, Save, the selected members as removable chips (with
 * a search to add more), and the history of who changed what.
 *
 * Changes reach members within 60 s with no app release (useFeatureAllowed).
 * Every write is one admin-only RPC that writes one audit row in the same
 * transaction; this page decides nothing the server does not re-check. The
 * member list is kept when the mode changes, so switching "All members" back to
 * "Selected members" brings the same people back.
 *
 * Search runs on Enter / the Search button, not on a timer.
 *
 * Avatars (F-AUD-6, MASTER §3s R-103: results "with avatar + name + username"):
 * every search result and every chip shows the member's photo, or their
 * initials when they have none — two people called "Asha" are told apart by
 * face before the admin presses Add. alt="" because the name is printed beside
 * it; reading it twice to a screen reader helps nobody.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  FEATURE_INFO, FEATURE_MODES, NOTE_MAX, SEARCH_MIN, describeHistory, featureErrorMessage, isDirty, modeSelectable,
  memberInitials, parseFeatureState, shortId, type FeatureKey, type FeatureMode, type FeatureState,
} from "@/lib/admin/featureSwitches";

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
const rpc: Rpc = (fn, args) => (supabase.rpc as unknown as Rpc)(fn, args);

interface Found { user_id: string; full_name: string | null; username: string | null; avatar_url: string | null; email: string | null }

function MemberAvatar({ m, size }: { m: { full_name: string | null; username: string | null; avatar_url: string | null }; size: "chip" | "row" }) {
  return (
    <Avatar className={size === "chip" ? "h-5 w-5" : "h-8 w-8"}>
      {m.avatar_url ? <AvatarImage src={m.avatar_url} alt="" /> : null}
      <AvatarFallback className={size === "chip" ? "text-[9px]" : "text-xs"}>{memberInitials(m)}</AvatarFallback>
    </Avatar>
  );
}

function FeatureCard({ s, names, onChanged }: { s: FeatureState; names: Map<string, string>; onChanged: () => void }) {
  const info = FEATURE_INFO[s.feature];
  const [mode, setMode] = useState<FeatureMode>(s.mode);
  const [note, setNote] = useState(s.note ?? "");
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busyUser, setBusyUser] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The server's truth wins whenever it changes (after Save, or another admin).
  useEffect(() => { setMode(s.mode); setNote(s.note ?? ""); }, [s.mode, s.note]);

  const who = useCallback((id: string | null) => (id ? names.get(id) ?? shortId(id) : "system"), [names]);
  const memberIds = useMemo(() => new Set(s.members.map((m) => m.user_id)), [s.members]);
  const dirty = isDirty(s, mode, note);

  const save = async () => {
    setSaving(true); setError(null);
    const { error: e } = await rpc("feature_set_mode", { _feature: s.feature, _mode: mode, _note: note.trim() || null });
    setSaving(false);
    if (e) { setError(featureErrorMessage(e)); return; }
    toast({ title: `${info.title}: ${FEATURE_MODES.find((m) => m.mode === mode)?.label}` });
    onChanged();
  };

  const search = async () => {
    if (q.trim().replace(/^@/, "").length < SEARCH_MIN) { setFound(null); return; }
    setSearching(true); setError(null);
    const { data, error: e } = await rpc("feature_member_search", { _q: q, _limit: 20 });
    setSearching(false);
    if (e) { setError(featureErrorMessage(e)); return; }
    setFound(Array.isArray(data) ? (data as Found[]) : []);
  };

  const change = async (fn: "feature_add_member" | "feature_remove_member", userId: string) => {
    setBusyUser(userId); setError(null);
    const { error: e } = await rpc(fn, { _feature: s.feature, _user: userId, _note: null });
    setBusyUser(null);
    if (e) { setError(featureErrorMessage(e)); return; }
    onChanged();
  };

  return (
    <section aria-labelledby={`feat-${s.feature}`} data-testid={`feature-${s.feature}`} className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div>
        <h3 id={`feat-${s.feature}`} className="text-base font-semibold">{info.title}</h3>
        <p className="text-sm text-muted-foreground">{info.blurb}</p>
      </div>

      <fieldset className="space-y-2">
        <legend className="sr-only">{info.title} — who can use it</legend>
        {FEATURE_MODES.map(({ mode: m, label }) => {
          const ok = modeSelectable(s.feature, m, s.key_configured);
          return (
            <label key={m} className={`flex items-center gap-2 text-sm ${ok ? "" : "opacity-50"}`}>
              <input type="radio" name={`mode-${s.feature}`} value={m} checked={mode === m} disabled={!ok} onChange={() => setMode(m)} />
              {label}
            </label>
          );
        })}
        {s.feature === "copyright_music_check" && s.key_configured !== true && (
          <p role="note" className="text-xs text-amber-600">The music-API key isn't set, so this can't be switched on.</p>
        )}
      </fieldset>

      {mode === "selected" && (
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">Selected members ({s.members.length})</p>
            {s.members.length === 0 ? (
              <p className="text-xs text-muted-foreground">No one yet — nobody can use this until you add someone.</p>
            ) : (
              <ul aria-label="Members added" className="mt-2 flex flex-wrap gap-2">
                {s.members.map((m) => (
                  <li key={m.user_id} className="inline-flex items-center gap-1 rounded-full bg-muted py-1 pl-1 pr-3 text-xs">
                    <MemberAvatar m={m} size="chip" />
                    <span>{m.full_name || m.username || shortId(m.user_id)}{m.username ? ` @${m.username}` : ""}</span>
                    <button type="button" aria-label={`Remove ${m.full_name || m.username || shortId(m.user_id)}`} disabled={busyUser === m.user_id}
                      onClick={() => void change("feature_remove_member", m.user_id)} className="rounded-full p-0.5 hover:bg-background">
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void search(); }}>
            <label className="sr-only" htmlFor={`q-${s.feature}`}>Search members by name, @username or email</label>
            <input id={`q-${s.feature}`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, @username or email"
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm" />
            <button type="submit" disabled={searching} className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-sm">
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Search
            </button>
          </form>
          {found && (
            found.length === 0 ? <p className="text-xs text-muted-foreground">No one found.</p> : (
              <ul aria-label="Search results" className="divide-y divide-border rounded-md border border-border">
                {found.map((f) => (
                  <li key={f.user_id} className="flex items-center justify-between gap-2 p-2 text-sm">
                    <MemberAvatar m={f} size="row" />
                    <span className="min-w-0 flex-1 truncate">{f.full_name || f.username || shortId(f.user_id)}{f.username ? ` @${f.username}` : ""}{f.email ? ` · ${f.email}` : ""}</span>
                    {memberIds.has(f.user_id)
                      ? <span className="text-xs text-muted-foreground">Added</span>
                      : <button type="button" disabled={busyUser === f.user_id} onClick={() => void change("feature_add_member", f.user_id)}
                          className="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground">Add</button>}
                  </li>
                ))}
              </ul>
            )
          )}
        </div>
      )}
      {mode !== "selected" && s.members.length > 0 && (
        <p className="text-xs text-muted-foreground">{s.members.length} selected member{s.members.length === 1 ? " is" : "s are"} kept for when you choose "Selected members" again.</p>
      )}

      <div>
        <label htmlFor={`note-${s.feature}`} className="text-sm font-medium">Note (optional)</label>
        <textarea id={`note-${s.feature}`} value={note} maxLength={NOTE_MAX} rows={2} onChange={(e) => setNote(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
        <p className="text-right text-xs text-muted-foreground">{note.length}/{NOTE_MAX}</p>
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <button type="button" onClick={() => void save()} disabled={!dirty || saving}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">
        {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save
      </button>

      <details>
        <summary className="cursor-pointer text-sm font-medium">History ({s.history.length})</summary>
        {s.history.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">Nothing yet.</p> : (
          <ol className="mt-2 space-y-1 text-xs">
            {s.history.map((h, i) => (
              <li key={`${h.at}-${i}`}>
                <time dateTime={h.at} className="text-muted-foreground">{new Date(h.at).toLocaleString()}</time>{" — "}
                {describeHistory(h, who)}{h.note ? ` — “${h.note}”` : ""}
              </li>
            ))}
          </ol>
        )}
      </details>
    </section>
  );
}

export default function AdminFeatures() {
  const [cards, setCards] = useState<FeatureState[] | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await rpc("feature_admin_state");
    if (error) { setLoadError(featureErrorMessage(error)); return; }
    setLoadError(null);
    const parsed = parseFeatureState(data);
    setCards(parsed);
    const ids = new Set<string>();
    for (const c of parsed) for (const h of c.history) { if (h.actor) ids.add(h.actor); if (h.user_id) ids.add(h.user_id); }
    if (ids.size === 0) return;
    const { data: rows } = await supabase.from("profiles").select("id, full_name, custom_url").in("id", [...ids]);
    setNames(new Map(((rows ?? []) as Array<{ id: string; full_name: string | null }>).filter((r) => r.full_name).map((r) => [r.id, r.full_name as string])));
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Features</h2>
        <p className="text-sm text-muted-foreground">Switch a feature off, on for selected members, or on for all members. Changes reach members within a minute — no app release.</p>
      </div>
      {loadError && <p role="alert" className="text-sm text-destructive">{loadError}</p>}
      {!cards && !loadError && <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
      {cards?.map((c) => <FeatureCard key={c.feature} s={c} names={names} onChanged={() => void load()} />)}
    </div>
  );
}

export type { FeatureKey };
