import { useEffect, useState } from "react";
import { Search, X, User as UserIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface ProfileRow {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
}

interface Props {
  value: string | null;
  onChange: (profile: ProfileRow | null) => void;
  label?: string;
}

/**
 * Admin-only typeahead. Uses SECURITY DEFINER RPCs that gate on has_role(admin).
 * Searches profiles by full_name OR auth.users.email.
 */
export default function ProfileTypeaheadPicker({ value, onChange, label = "Link Author Profile" }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ProfileRow | null>(null);

  // Hydrate selected profile when value is set externally (edit mode)
  useEffect(() => {
    let cancelled = false;
    if (!value) { setSelected(null); return; }
    if (selected?.id === value) return;
    (async () => {
      const { data } = await supabase.rpc("get_profile_admin", { _id: value });
      if (cancelled) return;
      const row = (data as any[] | null)?.[0];
      if (row) setSelected({ id: row.id, full_name: row.full_name, email: row.email, avatar_url: row.avatar_url });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Debounced search
  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) { setResults([]); return; }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc("search_profiles_admin", { q: query.trim() });
      if (cancelled) return;
      setResults(((data as any[]) || []) as ProfileRow[]);
      setLoading(false);
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);

  const pick = (p: ProfileRow) => {
    setSelected(p);
    onChange(p);
    setQuery("");
    setResults([]);
    setOpen(false);
  };

  const clear = () => {
    setSelected(null);
    onChange(null);
    setQuery("");
  };

  return (
    <div className="relative">
      <label
        className="block text-[10px] tracking-[0.15em] uppercase text-muted-foreground mb-1.5"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        {label}
      </label>

      {selected ? (
        <div className="flex items-center gap-3 border border-primary/40 bg-primary/5 rounded-sm px-3 py-2">
          {selected.avatar_url ? (
            <img src={selected.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover" />
          ) : (
            <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center">
              <UserIcon className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-sm truncate" style={{ fontFamily: "var(--font-body)" }}>
              {selected.full_name || "Unnamed"}
            </div>
            <div className="text-[10px] text-muted-foreground truncate">{selected.email}</div>
          </div>
          <button type="button" onClick={clear} className="p-1 text-muted-foreground hover:text-destructive">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder="Search by name or email…"
            className="w-full h-9 border border-input bg-background pl-8 pr-3 text-sm rounded-sm focus:ring-1 focus:ring-ring"
          />
          {open && (results.length > 0 || loading || query.length >= 2) && (
            <div className="absolute z-20 top-full left-0 right-0 mt-1 border border-border bg-popover rounded-sm shadow-lg max-h-72 overflow-y-auto">
              {loading && <div className="px-3 py-2 text-xs text-muted-foreground">Searching…</div>}
              {!loading && results.length === 0 && query.length >= 2 && (
                <div className="px-3 py-2 text-xs text-muted-foreground">No profiles match "{query}"</div>
              )}
              {results.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => pick(p)}
                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted/60 text-left transition-colors"
                >
                  {p.avatar_url ? (
                    <img src={p.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover" />
                  ) : (
                    <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center">
                      <UserIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{p.full_name || "Unnamed"}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{p.email}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <p className="text-[10px] text-muted-foreground/70 mt-1.5">
        Optional. When linked, the public page pulls name, avatar, and bio from this user's profile. The fields below act as fallback.
      </p>
    </div>
  );
}
