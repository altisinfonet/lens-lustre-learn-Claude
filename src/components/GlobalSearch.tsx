import { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/core/useAuth";
import { Search, Trophy, BookOpen, Newspaper, X, ArrowLeft, User, Layers, UserRound, MessageSquare, Clock, Hash } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
// `motion` only — AnimatePresence is deliberately NOT imported here, so the
// banned pattern cannot be reintroduced by autocomplete. See the block comment
// above the panel for why it froze the whole app.
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { useDismissOnRouteChange } from "@/hooks/core/useDismissOnRouteChange";
import { logger } from "@/lib/logger";

const FILE = "src/components/GlobalSearch.tsx";

interface SearchResult {
  id: string;
  title: string;
  type: "competition" | "course" | "article" | "person" | "post" | "hashtag";
  url: string;
  subtitle?: string;
  date?: string;
  category?: string;
  avatarUrl?: string;
  /** Instagram-format username (custom_url) — people only, may be absent. */
  handle?: string;
  /** Follower count from profile_stats — people only. */
  followers?: number;
}

/** A row saved in the device-local "Recent" list (Instagram behavior). */
interface RecentEntry {
  id: string;
  type: SearchResult["type"];
  title: string;
  url: string;
  avatarUrl?: string;
  handle?: string;
}

const RECENT_KEY = "gs_recent_v1";
const RECENT_MAX = 8;

const loadRecent = (): RecentEntry[] => {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
};

const saveRecent = (entries: RecentEntry[]) => {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(entries.slice(0, RECENT_MAX)));
  } catch {
    /* storage unavailable (private mode) — recents just don't persist */
  }
};

const typeConfig = {
  competition: { icon: Trophy, label: "Competition", color: "text-primary" },
  course: { icon: BookOpen, label: "Course", color: "text-accent" },
  article: { icon: Newspaper, label: "Journal", color: "text-secondary" },
  person: { icon: UserRound, label: "Person", color: "text-foreground" },
  post: { icon: MessageSquare, label: "Post", color: "text-muted-foreground" },
  hashtag: { icon: Hash, label: "Hashtag", color: "text-primary" },
};

type SectionFilter = "all" | "competition" | "course" | "article" | "person" | "post";

const GlobalSearch = () => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  // -1 = no row highlighted. Only the ArrowUp/ArrowDown keys set this; on
  // touch it must stay -1 or the first row looks permanently "selected"
  // AND the highlight re-render under the finger makes Android WebView drop
  // the tap's click event (the "tap does nothing / sheet stays open" bug).
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // md+ renders the anchored dropdown in place (unchanged, proven path).
  // Below md the sheet is PORTALED to document.body: the navbar carries
  // backdrop-filter, which in Chromium makes it the containing block for
  // position:fixed descendants — inside the nav, "fixed inset-0" collapses
  // to the navbar box and the sheet body gets clipped (the 1017 app bug).
  // document.body is verified transform/filter-free, so the portaled sheet
  // truly fills the screen.
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  // Monotonic request id — lets us drop stale/slow responses so a cleared
  // search can never be repopulated by an in-flight request, and a failed
  // request can never leave the spinner stuck.
  const seqRef = useRef(0);
  // Context-aware mode: on the feed the search behaves like FB/Insta —
  // people-first. Everywhere else it's full content search.
  const isFeed = location.pathname.startsWith("/feed");
  // Ids of people the current user follows (loaded once per panel-open);
  // used to rank friends first and tag them "Following".
  const followedIdsRef = useRef<Set<string>>(new Set());

  // Instagram-style tabs (replaces the old date/category advanced filters)
  const [sectionFilter, setSectionFilter] = useState<SectionFilter>("all");
  // Bumped when the follow list finishes loading so the initial
  // friends-suggestion search re-runs with the loaded ids.
  const [followsVersion, setFollowsVersion] = useState(0);

  // Cmd+K shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  // Click outside to close
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      // The panel may be portaled to document.body (mobile) — a tap inside
      // it must NOT count as "outside", or the sheet would close on any tap.
      if (wrapperRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const search = useCallback(async (q: string) => {
    const seq = ++seqRef.current;
    const term = q.trim();
    // Search from the FIRST character; an empty box shows nothing
    // (owner rule 2026-07-28: no auto-populated rows before typing).
    if (term.length < 1) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {

    // PREMIUM SEARCH (2026-07-29): ONE server round trip via the
    // global_search RPC — typo-tolerant (trigram similarity) and
    // relevance-ranked (exact > prefix > word-start > fuzzy) in Postgres.
    // Replaces the old 6-query client fan-out; follower counts come joined.
    const isHashtag = term.startsWith("#");
    const isUsername = term.startsWith("@");
    const bare = term.replace(/^[@#]/, "").trim();

    const [{ data: gs, error }, tagRes] = await Promise.all([
      (supabase.rpc as any)("global_search", {
        term: isHashtag ? bare : isUsername ? bare : term,
        section: isHashtag ? "post" : sectionFilter,
        username_only: isUsername,
      }),
      // Hashtag mode also asks for REAL tags used in public posts —
      // typo-tolerant, so "#50mmratina" still surfaces "#50mmretina".
      isHashtag && bare.length >= 1
        ? (supabase.rpc as any)("global_search_hashtags", { term: bare })
        : Promise.resolve({ data: [] }),
    ]);
    if (error) throw error;
    const tagSuggestions: { tag: string; uses: number }[] = (tagRes?.data || []) as any[];
    const g = (gs || {}) as {
      people?: any[]; competitions?: any[]; courses?: any[];
      articles?: any[]; posts?: any[];
    };

    const mapped: SearchResult[] = [
      // Hashtag mode: REAL tags from public posts first (typo-tolerant,
      // with usage counts); the literal typed tag is included only when it
      // isn't already among the real suggestions.
      ...(isHashtag && bare.length >= 1
        ? [
            ...tagSuggestions.map((t) => ({
              id: `tag-${t.tag}`,
              title: `#${t.tag}`,
              type: "hashtag" as const,
              url: `/hashtag/${encodeURIComponent(t.tag)}`,
              subtitle: `${t.uses} post${t.uses === 1 ? "" : "s"}`,
            })),
            ...(tagSuggestions.some((t) => t.tag === bare.toLowerCase())
              ? []
              : [{
                  id: `tag-${bare.toLowerCase()}`,
                  title: `#${bare.toLowerCase()}`,
                  type: "hashtag" as const,
                  url: `/hashtag/${encodeURIComponent(bare.toLowerCase())}`,
                  subtitle: "See all posts",
                }]),
          ]
        : []),
      ...(g.people || [])
        .map((p: any) => ({
          id: p.id,
          title: p.full_name || "Photographer",
          type: "person" as const,
          url: `/profile/${p.id}`,
          subtitle: followedIdsRef.current.has(p.id) ? "Following" : undefined,
          avatarUrl: p.avatar_url,
          handle: p.custom_url || undefined,
          followers: p.followers_count ?? 0,
        }))
        // Friends first — people you follow rank above everyone else.
        .sort(
          (a: any, b: any) =>
            (followedIdsRef.current.has(b.id) ? 1 : 0) -
            (followedIdsRef.current.has(a.id) ? 1 : 0)
        ),
      ...(g.competitions || []).map((c: any) => ({
        id: c.id,
        title: c.title,
        type: "competition" as const,
        url: `/competitions/${c.id}`,
        subtitle: `${c.category} · ${c.status}`,
        date: c.starts_at,
        category: c.category,
      })),
      ...(g.courses || []).map((c: any) => ({
        id: c.id,
        title: c.title,
        type: "course" as const,
        url: `/courses/${c.slug}`,
        subtitle: `${c.category} · ${c.difficulty}`,
        date: c.published_at,
        category: c.category,
      })),
      ...(g.articles || []).map((a: any) => ({
        id: a.id,
        title: a.title,
        type: "article" as const,
        url: `/journal/${a.slug}`,
        subtitle: a.excerpt || undefined,
        date: a.published_at,
      })),
      ...(g.posts || []).map((p: any) => ({
        id: p.id,
        title: (p.content || "").slice(0, 80) || "Post",
        type: "post" as const,
        // Open THE post (PostDetail route) — never just the feed, where a
        // tap while already on /feed looked like nothing happened.
        url: `/post/${p.id}`,
        subtitle: p.created_at ? `Posted ${format(new Date(p.created_at), "MMM d, yyyy")}` : undefined,
        date: p.created_at,
      })),
    ];

    // Stale response — a newer search (or a clear) superseded this one. Drop it.
    if (seq !== seqRef.current) return;

    setResults(mapped);
    setSelectedIndex(-1);
    setLoading(false);
    } catch (err) {
      logger.warn({
        code: "UI-8003",
        event: "GLOBAL_SEARCH_FAILED",
        fn: "runSearch",
        file: FILE,
        message: "The global search box could not fetch results.",
        reason: err instanceof Error ? err.message : String(err),
        expected: "A result set for the member's query",
        actual: "The search threw; the box shows nothing",
        nextStep:
          "On screen this reads as 'nothing found', not 'it broke' — the member will believe the site has no such content. The query itself is the member's words and is deliberately not logged; its length is enough to tell a stray keystroke from a real search.",
        // `q` is this call's argument, NOT the `query` state — inside an async
        // callback the state variable is whatever it was when the callback was
        // created, which is not necessarily the search that just failed.
        detail: { queryLength: q.trim().length },
      });
      if (seq === seqRef.current) {
        setResults([]);
        setLoading(false);
      }
    }
  }, [sectionFilter, followsVersion]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (open) search(query);
    }, 150);
    return () => clearTimeout(timeout);
  }, [query, search, open]);

  // Panel closed → invalidate in-flight searches and reset the spinner so a
  // slow response can never resurrect old results when the panel reopens.
  useEffect(() => {
    if (!open) {
      seqRef.current++;
      setLoading(false);
    }
  }, [open]);

  // Route changed → dismiss and reset the search entirely (Instagram
  // behavior: search never stays open on top of the destination page).
  // This is the safety net for the Android WebView bug where tapping a
  // result navigated but the row's click handler was not delivered, so the
  // panel survived navigation with its stale query still showing.
  // Keyed on the NAVIGATION, not the path: `location.pathname` does not change
  // when you navigate to the page you are already on, or on back/forward
  // between identical paths — and "search from /feed, tap a /feed result" is a
  // real action. useDismissOnRouteChange also runs before paint, so the panel
  // cannot flash on the destination route. Same hook as NotificationBell.
  useDismissOnRouteChange(() => {
    seqRef.current++; // drop any in-flight search
    setOpen(false);
    setQuery("");
    setResults([]);
    setLoading(false);
    setSelectedIndex(-1);
  });

  // On open: pick the context default — People on the feed, All elsewhere —
  // load the recent list, and (re)load the follow list so friends rank first.
  useEffect(() => {
    if (!open) return;
    // Always open on "All" — no pre-picked tab mode (owner feedback 2026-07-28).
    setSectionFilter("all");
    setRecent(loadRecent());
    if (user) {
      // Account-synced recents (2026-07-29): the member's recent searches
      // follow them across devices/logins, like preferred_language does.
      (supabase.from("search_recents" as any) as any)
        .select("item_type, item_id, title, url, avatar_url, handle")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(RECENT_MAX)
        .then(({ data }: { data: any[] | null }) => {
          if (!data) return;
          const rows: RecentEntry[] = data.map((r: any) => ({
            id: r.item_id,
            type: r.item_type,
            title: r.title,
            url: r.url,
            avatarUrl: r.avatar_url || undefined,
            handle: r.handle || undefined,
          }));
          setRecent(rows);
          saveRecent(rows); // keep the local cache warm for instant next open
        });
    }
    if (user) {
      supabase
        .from("follows")
        .select("following_id")
        .eq("follower_id", user.id)
        .limit(500)
        .then(({ data }) => {
          followedIdsRef.current = new Set((data || []).map((r: any) => r.following_id));
          setFollowsVersion((v) => v + 1);
        });
    } else {
      followedIdsRef.current = new Set();
    }
  }, [open, isFeed, user]);

  const rememberRecent = (entry: RecentEntry) => {
    const next = [entry, ...recent.filter((r) => !(r.type === entry.type && r.id === entry.id))].slice(0, RECENT_MAX);
    saveRecent(next);
    setRecent(next);
    if (user) {
      // Fire-and-forget account sync — a failure only costs cross-device sync.
      (supabase.from("search_recents" as any) as any)
        .upsert({
          user_id: user.id,
          item_type: entry.type,
          item_id: entry.id,
          title: entry.title,
          url: entry.url,
          avatar_url: entry.avatarUrl ?? null,
          handle: entry.handle ?? null,
          updated_at: new Date().toISOString(),
        })
        .then(() => {});
    }
  };

  const removeRecent = (entry: RecentEntry) => {
    const next = recent.filter((r) => !(r.type === entry.type && r.id === entry.id));
    saveRecent(next);
    setRecent(next);
    if (user) {
      (supabase.from("search_recents" as any) as any)
        .delete()
        .eq("user_id", user.id)
        .eq("item_type", entry.type)
        .eq("item_id", entry.id)
        .then(() => {});
    }
  };

  const clearRecent = () => {
    saveRecent([]);
    setRecent([]);
    if (user) {
      (supabase.from("search_recents" as any) as any)
        .delete()
        .eq("user_id", user.id)
        .then(() => {});
    }
  };

  const handleSelect = (result: SearchResult) => {
    rememberRecent({
      id: result.id,
      type: result.type,
      title: result.title,
      url: result.url,
      avatarUrl: result.avatarUrl,
      handle: result.handle,
    });
    setOpen(false);
    setQuery("");
    setResults([]);
    navigate(result.url);
  };

  const handleRecentSelect = (entry: RecentEntry) => {
    rememberRecent(entry); // moves it to the top, IG-style
    setOpen(false);
    setQuery("");
    setResults([]);
    navigate(entry.url);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      // With no keyboard-highlighted row (-1, the default), Enter opens the
      // first result — but never a phantom selection.
      const target = results[selectedIndex] ?? results[0];
      if (target) handleSelect(target);
    }
  };

  const highlightTitle = (title: string) => {
    const q = query.trim().replace(/^@/, "");
    if (!q) return title;
    const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    const parts = title.split(regex);
    return parts.map((part, i) =>
      regex.test(part) ? <mark key={i} className="bg-primary/20 text-primary rounded-sm px-0.5">{part}</mark> : part
    );
  };

  const formatFollowers = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "")}K` : `${n}`;

  const tabs: { key: SectionFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "person", label: "People" },
    { key: "competition", label: "Competitions" },
    { key: "course", label: "Courses" },
    { key: "article", label: "Journal" },
    { key: "post", label: "Posts" },
  ];

  const showRecent = query.trim().length === 0 && recent.length > 0;

  return (
    <div ref={wrapperRef} className="relative">
      {/* Search trigger — inline input style */}
      <button
        onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 50); }}
        className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors duration-300"
        aria-label="Search"
      >
        <Search className="h-4 w-4" />
        <span
          className="hidden lg:inline text-[10px] tracking-[0.15em] uppercase border border-border px-2 py-0.5 rounded text-muted-foreground"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          ⌘K
        </span>
      </button>

      {/* Panel — full-screen sheet on mobile (portaled to body, see comment
          at panelRef), anchored dropdown rendered in place on md+ */}
      {/* ═══════════════════════════════════════════════════════════════════
          NO <AnimatePresence>, NO `exit` — AND THIS IS LOAD-BEARING.

          OWNER REPORT, build 1058, 2026-08-09: "search on app still not
          working. entire app is freezing and hanging, even not a click or
          touch working." Restarting the app was the only cure.

          This is the SAME defect that was diagnosed and fixed in
          NotificationBell on 2026-08-01, and the reasoning there applies here
          word for word: AnimatePresence keeps an exiting child MOUNTED until
          its animation reports completion. On the Android webview that
          completion may never arrive — the panel stayed in the DOM at
          opacity 0 with the closing transform applied, an invisible rectangle
          that swallowed every tap until a full reload.

          NotificationBell's stranded panel was 304x456, in one corner. THIS
          panel is `fixed inset-0` — the whole screen. So the identical failure
          does not swallow some taps, it swallows ALL of them, which is exactly
          why the owner experienced it as the entire app freezing rather than
          as a search bug.

          It also explains why build 1058 did not fix it. The freeze was
          attributed to the image retry storm; images ARE fixed and the retry
          IS capped, and the freeze remained — because it never had anything to
          do with the network. It is an unmount that never happens.

          The panel is now removed by plain React reconciliation, which cannot
          fail to run. The ENTRANCE animation stays (it does not gate unmount);
          the 200ms fade-out is gone, and as recorded for NotificationBell that
          is the right price. GlobalSearchDismiss.test.tsx fails the build if
          AnimatePresence or an `exit` prop comes back.
          ═══════════════════════════════════════════════════════════════════ */}
      {(() => {
        const panel = (
      <>
        {open && (
          <motion.div
            ref={panelRef}
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="fixed inset-0 z-[80] flex flex-col bg-card overflow-hidden md:absolute md:inset-auto md:right-0 md:top-full md:mt-2 md:block md:w-[420px] md:max-w-[92vw] md:border md:border-border md:rounded-lg md:shadow-2xl"
          >
            {/* Search input row */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
              {/* Mobile back/close — the sheet covers the whole screen */}
              <button
                onClick={() => setOpen(false)}
                onPointerDown={(e) => { e.preventDefault(); setOpen(false); }}
                className="md:hidden text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Close search"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <Search className="hidden md:block h-4 w-4 text-muted-foreground shrink-0" />
              <input
                ref={inputRef}
                autoFocus
                type="search"
                inputMode="search"
                enterKeyHint="search"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isFeed && sectionFilter === "person" ? "Search friends & people…" : "Search…"}
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60 text-foreground"
                style={{ fontFamily: "var(--font-body)" }}
              />
              {query && (
                <button
                  onPointerDown={(e) => {
                    // pointerdown (not click): still fires when a stuck phone
                    // keyboard/IME state swallows synthesized clicks.
                    e.preventDefault();
                    seqRef.current++;
                    setQuery("");
                    setResults([]);
                    setLoading(false);
                    inputRef.current?.focus();
                  }}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Instagram-style tabs (replaces date/category filters) */}
            <div className="flex gap-1.5 px-3 py-2 border-b border-border overflow-x-auto shrink-0 [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: "none" }}>
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => {
                    // Clear the old list IMMEDIATELY — stale rows must never
                    // linger while the 300ms debounce re-searches the new tab.
                    setSectionFilter(tab.key);
                    setResults([]);
                    setSelectedIndex(-1);
                  }}
                  className={cn(
                    "shrink-0 text-[10px] tracking-[0.1em] uppercase px-3 py-1.5 border rounded-full transition-all duration-300",
                    sectionFilter === tab.key
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-foreground/30"
                  )}
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Results / recents */}
            <div className="flex-1 overflow-y-auto md:flex-none md:max-h-[50vh]">
              {/* Recent searches — empty query only (Instagram behavior) */}
              {!loading && showRecent && (
                <div className="py-1">
                  <div className="flex items-center justify-between px-4 pt-2 pb-1">
                    <span className="text-[9px] tracking-[0.25em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                      Recent
                    </span>
                    <button
                      onClick={clearRecent}
                      className="text-[10px] tracking-[0.1em] uppercase text-primary hover:underline"
                      style={{ fontFamily: "var(--font-heading)" }}
                    >
                      Clear all
                    </button>
                  </div>
                  <ul>
                    {recent.map((entry) => {
                      const config = typeConfig[entry.type];
                      const Icon = config.icon;
                      return (
                        <li key={`recent-${entry.type}-${entry.id}`} className="group flex items-center hover:bg-muted/50 transition-colors duration-150">
                          <button
                            onClick={() => handleRecentSelect(entry)}
                            className="flex-1 min-w-0 flex items-center gap-3 px-4 py-2.5 text-left"
                          >
                            {entry.type === "person" && entry.avatarUrl ? (
                              <img referrerPolicy="no-referrer" loading="lazy" decoding="async" src={entry.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                            ) : (
                              <span className="w-8 h-8 rounded-full border border-border flex items-center justify-center shrink-0 text-muted-foreground">
                                <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
                              </span>
                            )}
                            <span className="flex-1 min-w-0">
                              <span className="block text-sm font-light truncate text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                                {entry.type === "person" && entry.handle ? `@${entry.handle}` : entry.title}
                              </span>
                              {entry.type === "person" && entry.handle && (
                                <span className="block text-[10px] text-muted-foreground truncate" style={{ fontFamily: "var(--font-body)" }}>
                                  {entry.title}
                                </span>
                              )}
                            </span>
                            <Clock className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                          </button>
                          <button
                            onClick={() => removeRecent(entry)}
                            className="px-3 py-2.5 text-muted-foreground/50 hover:text-foreground transition-colors shrink-0"
                            aria-label={`Remove ${entry.title} from recent searches`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {loading && results.length === 0 && (
                <div className="px-4 py-6 text-center">
                  <span className="text-xs text-muted-foreground animate-pulse" style={{ fontFamily: "var(--font-heading)" }}>Searching…</span>
                </div>
              )}

              {!loading && query.trim().length >= 1 && results.length === 0 && (
                <div className="px-4 py-6 text-center">
                  <p className="text-xs text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
                    No results found for "<span className="text-foreground">{query}</span>"
                  </p>
                </div>
              )}


              {results.length > 0 && (
                <ul className="py-1">
                  {results.map((result, index) => {
                    const config = typeConfig[result.type];
                    const Icon = config.icon;
                    const isPerson = result.type === "person";
                    return (
                      <li key={`${result.type}-${result.id}`}>
                        <button
                          onClick={() => handleSelect(result)}
                          className={cn(
                            "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors duration-150",
                            index === selectedIndex ? "bg-muted" : "hover:bg-muted/50"
                          )}
                        >
                          {isPerson ? (
                            result.avatarUrl ? (
                              <img referrerPolicy="no-referrer" loading="lazy" decoding="async" src={result.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                            ) : (
                              <span className="w-8 h-8 rounded-full border border-border flex items-center justify-center shrink-0 text-muted-foreground">
                                <User className="h-3.5 w-3.5" strokeWidth={1.5} />
                              </span>
                            )
                          ) : (
                            <div className={`${config.color}`}>
                              <Icon className="h-4 w-4" strokeWidth={1.5} />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            {isPerson ? (
                              <>
                                {/* IG row: @handle (when claimed) + name + follower count */}
                                <p className="text-sm font-light truncate text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                                  {result.handle ? <>@{highlightTitle(result.handle)}</> : highlightTitle(result.title)}
                                </p>
                                <div className="flex items-center gap-2 mt-0.5 min-w-0">
                                  {result.handle && (
                                    <span className="text-[10px] text-muted-foreground truncate" style={{ fontFamily: "var(--font-body)" }}>
                                      {result.title}
                                    </span>
                                  )}
                                  <span className="text-[10px] text-muted-foreground shrink-0" style={{ fontFamily: "var(--font-body)" }}>
                                    {result.handle && <span className="text-muted-foreground/30 mr-2">·</span>}
                                    {formatFollowers(result.followers ?? 0)} follower{(result.followers ?? 0) === 1 ? "" : "s"}
                                  </span>
                                  {result.subtitle === "Following" && (
                                    <span className="text-[9px] tracking-[0.15em] uppercase text-primary shrink-0" style={{ fontFamily: "var(--font-heading)" }}>
                                      Following
                                    </span>
                                  )}
                                </div>
                              </>
                            ) : (
                              <>
                                <p className="text-sm font-light truncate text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                                  {highlightTitle(result.title)}
                                </p>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                                    {config.label}
                                  </span>
                                  {result.subtitle && (
                                    <>
                                      <span className="text-muted-foreground/30">·</span>
                                      <span className="text-[10px] text-muted-foreground truncate" style={{ fontFamily: "var(--font-body)" }}>
                                        {result.subtitle}
                                      </span>
                                    </>
                                  )}
                                  {result.date && (
                                    <>
                                      <span className="text-muted-foreground/30">·</span>
                                      <span className="text-[10px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
                                        {new Date(result.date).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                                      </span>
                                    </>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {!loading && query.trim().length === 0 && !showRecent && (
                <div className="px-4 py-6 text-center">
                  <p className="text-xs text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
                    Start typing to search people, competitions, courses and more
                  </p>
                </div>
              )}
            </div>

            {/* Keyboard footer — desktop only; useless on touch screens */}
            <div className="hidden md:flex border-t border-border px-4 py-2 items-center gap-4 text-[10px] text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 border border-border rounded text-[9px]">↑↓</kbd> Navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 border border-border rounded text-[9px]">↵</kbd> Select
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 border border-border rounded text-[9px]">Esc</kbd> Close
              </span>
            </div>
          </motion.div>
        )}
      </>
        );
        return isDesktop ? panel : createPortal(panel, document.body);
      })()}
    </div>
  );
};

export default GlobalSearch;
