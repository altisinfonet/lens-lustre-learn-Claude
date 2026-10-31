/**
 * Admin → Video · the member search (Owner 2026-10-12: "advance modern search").
 *
 *   • results as you type (from 2 characters, 300 ms after the last key — one
 *     request per pause, never one per key), up to 50;
 *   • name, @username or email; each row shows the photo (or initials), the
 *     name, @username, email and the member's roles;
 *   • keyboard: ↑ / ↓ move, Enter adds the highlighted member, Esc clears;
 *   • tick several and "Add N selected" adds them in one go;
 *   • on Video ads, only admins can be added (the server would refuse anyone
 *     else an ad video anyway — video_begin_upload), and the row says why.
 *
 * The search itself is the admin-only feature_member_search RPC (VID-7); roles
 * come from user_roles, which admins may read ("Admins can view all roles").
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, Loader2, Search, UserPlus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SEARCH_MIN, shortId, type FeatureKey } from "@/lib/admin/featureSwitches";
import { MemberAvatar, RoleBadges } from "./memberBits";

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
const rpc: Rpc = (fn, args) => (supabase.rpc as unknown as Rpc)(fn, args);

export interface FoundMember { user_id: string; full_name: string | null; username: string | null; avatar_url: string | null; email: string | null }

export const SEARCH_DEBOUNCE_MS = 300;
export const SEARCH_LIMIT = 50;

async function rolesOf(ids: string[]): Promise<Map<string, string[]>> {
  if (ids.length === 0) return new Map();
  try {
    const { data } = await (supabase.from("user_roles" as never) as unknown as {
      select(c: string): { in(c: string, v: string[]): PromiseLike<{ data: Array<{ user_id: string; role: string }> | null }> };
    }).select("user_id, role").in("user_id", ids);
    const m = new Map<string, string[]>();
    for (const r of data ?? []) m.set(r.user_id, [...(m.get(r.user_id) ?? []), r.role]);
    return m;
  } catch {
    return new Map();
  }
}

export default function MemberSearch({ feature, memberIds, onAdd, busy }: {
  feature: FeatureKey;
  memberIds: ReadonlySet<string>;
  /** add these members (one audited RPC each); resolves when done */
  onAdd: (ids: string[]) => Promise<void>;
  busy: boolean;
}) {
  const listId = useId();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<FoundMember[] | null>(null);
  const [roles, setRoles] = useState<Map<string, string[]>>(new Map());
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const seq = useRef(0);

  const term = q.trim().replace(/^@/, "");
  // As you type: one request per pause (300 ms), and only the newest answer is shown.
  useEffect(() => {
    if (term.length < SEARCH_MIN) { setFound(null); setSearching(false); return; }
    const my = ++seq.current;
    setSearching(true);
    const t = setTimeout(async () => {
      const { data, error: e } = await rpc("feature_member_search", { _q: q.trim(), _limit: SEARCH_LIMIT });
      if (my !== seq.current) return;
      if (e) { setError(e.message ?? "Search failed"); setSearching(false); return; }
      const list = Array.isArray(data) ? (data as FoundMember[]) : [];
      setError(null);
      setFound(list);
      setActive(0);
      setPicked(new Set());
      setRoles(await rolesOf(list.map((f) => f.user_id)));
      if (my === seq.current) setSearching(false);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q, term]);

  const isAdmin = (id: string) => (roles.get(id) ?? []).includes("admin");
  const canAdd = (f: FoundMember) => !memberIds.has(f.user_id) && (feature !== "video_ads" || isAdmin(f.user_id));
  const addable = useMemo(() => (found ?? []).filter(canAdd), [found, memberIds, roles, feature]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickedAddable = [...picked].filter((id) => addable.some((f) => f.user_id === id));

  const add = async (ids: string[]) => {
    if (ids.length === 0 || busy) return;
    await onAdd(ids);
    setPicked(new Set());
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!found?.length) { if (e.key === "Escape") setQ(""); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(found.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); const f = found[active]; if (f && canAdd(f)) void add([f.user_id]); }
    else if (e.key === "Escape") { setQ(""); setFound(null); }
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          inputMode="search"
          role="combobox"
          aria-expanded={!!found?.length}
          aria-controls={listId}
          aria-activedescendant={found?.length ? `${listId}-${active}` : undefined}
          aria-label="Search members by name, @username or email"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          placeholder="Search name, @username or email"
          className="h-9 w-full rounded-md border border-border bg-background pl-8 pr-8 text-sm outline-none focus:border-primary"
        />
        {searching
          ? <Loader2 className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-label="Searching" />
          : q && (
            <button type="button" aria-label="Clear search" onClick={() => { setQ(""); setFound(null); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
      </div>
      {term.length > 0 && term.length < SEARCH_MIN && <p className="text-xs text-muted-foreground">Type at least {SEARCH_MIN} characters.</p>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}

      {found && (found.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">No one matches “{q.trim()}”.</p>
      ) : (
        <div className="overflow-hidden rounded-md border border-border">
          <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
            <span>{found.length}{found.length === SEARCH_LIMIT ? "+" : ""} found · ↑↓ to move, Enter to add</span>
            {pickedAddable.length > 0 && (
              <button type="button" disabled={busy} onClick={() => void add(pickedAddable)}
                className="inline-flex items-center gap-1 rounded bg-primary px-2 py-0.5 font-medium text-primary-foreground disabled:opacity-50">
                <UserPlus className="h-3 w-3" /> Add {pickedAddable.length} selected
              </button>
            )}
          </div>
          <ul id={listId} role="listbox" aria-label="Search results" className="max-h-72 divide-y divide-border overflow-y-auto">
            {found.map((f, i) => {
              const added = memberIds.has(f.user_id);
              const blocked = !added && feature === "video_ads" && !isAdmin(f.user_id);
              return (
                <li key={f.user_id} id={`${listId}-${i}`} role="option" aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  className={`flex items-center gap-2.5 px-3 py-2 text-sm ${i === active ? "bg-muted/60" : ""}`}>
                  <input type="checkbox" aria-label={`Select ${f.full_name || f.username || shortId(f.user_id)}`}
                    disabled={!canAdd(f)} checked={picked.has(f.user_id)}
                    onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(f.user_id); else n.delete(f.user_id); return n; })}
                    className="h-3.5 w-3.5 accent-primary" />
                  <MemberAvatar m={f} size="row" />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-medium">{f.full_name || f.username || shortId(f.user_id)}</span>
                      {f.username && <span className="truncate text-xs text-muted-foreground">@{f.username}</span>}
                      <RoleBadges roles={roles.get(f.user_id) ?? []} />
                    </div>
                    {f.email && <div className="truncate text-xs text-muted-foreground">{f.email}</div>}
                  </div>
                  {added ? (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><Check className="h-3 w-3" /> Added</span>
                  ) : blocked ? (
                    <span className="text-xs text-muted-foreground" title="Only admins can add a video to an ad">Admins only</span>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => void add([f.user_id])}
                      className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-primary hover:text-primary-foreground disabled:opacity-50">
                      Add
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
