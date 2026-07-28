import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/core/useAuth";
import { Search, Trophy, BookOpen, Newspaper, X, ArrowLeft, User, Layers, UserRound, MessageSquare, Clock } from "lucide-react";
import { profilesPublic } from "@/lib/profilesPublic";
import { supabase } from "@/integrations/supabase/client";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface SearchResult {
  id: string;
  title: string;
  type: "competition" | "course" | "article" | "person" | "post";
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
};

type SectionFilter = "all" | "competition" | "course" | "article" | "person" | "post";

/** Strip characters that would break a PostgREST .or() expression. */
const sanitizeForOr = (s: string) => s.replace(/[,()]/g, " ").trim();

const GlobalSearch = () => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
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
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const search = useCallback(async (q: string) => {
    const seq = ++seqRef.current;
    const term = q.trim();
    // Instagram behavior: search from the FIRST character.
    if (term.length < 1 && sectionFilter !== "person") {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const searchTerm = term.length >= 1 ? `%${term}%` : "%";
    try {

    const shouldSearchComps = sectionFilter === "all" || sectionFilter === "competition";
    const shouldSearchCourses = sectionFilter === "all" || sectionFilter === "course";
    const shouldSearchArticles = sectionFilter === "all" || sectionFilter === "article";
    const shouldSearchPeople = sectionFilter === "all" || sectionFilter === "person";
    const shouldSearchPosts = sectionFilter === "all" || sectionFilter === "post";

    const [comps, courses, articles, people, posts] = await Promise.all([
      shouldSearchComps && term.length >= 1
        ? supabase.from("competitions").select("id, title, category, status, starts_at").ilike("title", searchTerm).limit(8)
        : Promise.resolve({ data: [] }),
      shouldSearchCourses && term.length >= 1
        ? supabase.from("courses").select("id, title, slug, category, difficulty, published_at").eq("status", "published").ilike("title", searchTerm).limit(8)
        : Promise.resolve({ data: [] }),
      shouldSearchArticles && term.length >= 1
        ? supabase.from("journal_articles").select("id, title, slug, excerpt, published_at, tags").eq("status", "published").ilike("title", searchTerm).limit(8)
        : Promise.resolve({ data: [] }),
      shouldSearchPeople && term.length >= 1
        ? (() => {
            // Match name OR @username. A leading @ means username-only.
            const bare = sanitizeForOr(term.replace(/^@/, ""));
            const pattern = `%${bare}%`;
            let qb = profilesPublic()
              .select("id, full_name, avatar_url, bio, custom_url")
              .eq("is_suspended", false);
            qb = term.startsWith("@")
              ? qb.ilike("custom_url", pattern)
              : qb.or(`full_name.ilike.${pattern},custom_url.ilike.${pattern}`);
            return qb.limit(sectionFilter === "person" ? 15 : 8);
          })()
        : shouldSearchPeople && sectionFilter === "person" && followedIdsRef.current.size > 0
        ? (() => {
            // People-mode with empty query (feed default): suggest the
            // people you follow, like Instagram's search sheet.
            const ids = Array.from(followedIdsRef.current).slice(0, 25);
            return profilesPublic()
              .select("id, full_name, avatar_url, bio, custom_url")
              .eq("is_suspended", false)
              .in("id", ids)
              .limit(12);
          })()
        : Promise.resolve({ data: [] }),
      shouldSearchPosts && term.length >= 1
        ? supabase.from("posts").select("id, content, user_id, created_at")
            .eq("privacy", "public")
            .ilike("content", searchTerm)
            .order("created_at", { ascending: false })
            .limit(8)
        : Promise.resolve({ data: [] }),
    ]);

    // Follower counts for the people rows (stored counts in profile_stats).
    const peopleIds = (people.data || []).map((p: any) => p.id);
    const followerCounts = new Map<string, number>();
    if (peopleIds.length > 0) {
      // profile_stats is newer than the generated Supabase types — cast like
      // profilesPublic() does for profiles_public_data.
      const { data: stats } = await (supabase.from("profile_stats" as any) as any)
        .select("user_id, followers_count")
        .in("user_id", peopleIds);
      for (const s of (stats || []) as { user_id: string; followers_count: number }[]) {
        followerCounts.set(s.user_id, s.followers_count);
      }
    }

    const mapped: SearchResult[] = [
      ...(people.data || [])
        .map((p: any) => ({
          id: p.id,
          title: p.full_name || "Photographer",
          type: "person" as const,
          url: `/profile/${p.id}`,
          subtitle: followedIdsRef.current.has(p.id) ? "Following" : undefined,
          avatarUrl: p.avatar_url,
          handle: p.custom_url || undefined,
          followers: followerCounts.get(p.id) ?? 0,
        }))
        // Friends first — people you follow rank above everyone else.
        .sort(
          (a: any, b: any) =>
            (followedIdsRef.current.has(b.id) ? 1 : 0) -
            (followedIdsRef.current.has(a.id) ? 1 : 0)
        ),
      ...(comps.data || []).map((c: any) => ({
        id: c.id,
        title: c.title,
        type: "competition" as const,
        url: `/competitions/${c.id}`,
        subtitle: `${c.category} · ${c.status}`,
        date: c.starts_at,
        category: c.category,
      })),
      ...(courses.data || []).map((c: any) => ({
        id: c.id,
        title: c.title,
        type: "course" as const,
        url: `/courses/${c.slug}`,
        subtitle: `${c.category} · ${c.difficulty}`,
        date: c.published_at,
        category: c.category,
      })),
      ...(articles.data || []).map((a: any) => ({
        id: a.id,
        title: a.title,
        type: "article" as const,
        url: `/journal/${a.slug}`,
        subtitle: a.excerpt?.slice(0, 60) || undefined,
        date: a.published_at,
      })),
      ...(posts.data || []).map((p: any) => ({
        id: p.id,
        title: (p.content || "").slice(0, 80) || "Post",
        type: "post" as const,
        url: `/feed`,
        subtitle: p.created_at ? `Posted ${format(new Date(p.created_at), "MMM d, yyyy")}` : undefined,
        date: p.created_at,
      })),
    ];

    // Stale response — a newer search (or a clear) superseded this one. Drop it.
    if (seq !== seqRef.current) return;

    setResults(mapped);
    setSelectedIndex(0);
    setLoading(false);
    } catch (err) {
      console.error("[GlobalSearch] search failed:", err);
      if (seq === seqRef.current) {
        setResults([]);
        setLoading(false);
      }
    }
  }, [sectionFilter, followsVersion]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (open) search(query);
    }, 300);
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
  useEffect(() => {
    seqRef.current++; // drop any in-flight search
    setOpen(false);
    setQuery("");
    setResults([]);
    setLoading(false);
    setSelectedIndex(0);
  }, [location.pathname]);

  // On open: pick the context default — People on the feed, All elsewhere —
  // load the recent list, and (re)load the follow list so friends rank first.
  useEffect(() => {
    if (!open) return;
    setSectionFilter(isFeed ? "person" : "all");
    setRecent(loadRecent());
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
    const next = [entry, ...loadRecent().filter((r) => !(r.type === entry.type && r.id === entry.id))].slice(0, RECENT_MAX);
    saveRecent(next);
    setRecent(next);
  };

  const removeRecent = (entry: RecentEntry) => {
    const next = loadRecent().filter((r) => !(r.type === entry.type && r.id === entry.id));
    saveRecent(next);
    setRecent(next);
  };

  const clearRecent = () => {
    saveRecent([]);
    setRecent([]);
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
    } else if (e.key === "Enter" && results[selectedIndex]) {
      handleSelect(results[selectedIndex]);
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

      {/* Panel — full-screen sheet on mobile, anchored dropdown on md+ */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="fixed inset-0 z-[80] flex flex-col bg-card overflow-hidden md:absolute md:inset-auto md:right-0 md:top-full md:mt-2 md:block md:w-[420px] md:max-w-[92vw] md:border md:border-border md:rounded-lg md:shadow-2xl"
          >
            {/* Search input row */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
              {/* Mobile back/close — the sheet covers the whole screen */}
              <button
                onClick={() => setOpen(false)}
                className="md:hidden text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Close search"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <Search className="hidden md:block h-4 w-4 text-muted-foreground shrink-0" />
              <input
                ref={inputRef}
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isFeed && sectionFilter === "person" ? "Search friends & people…" : "Search…"}
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60 text-foreground"
                style={{ fontFamily: "var(--font-body)" }}
              />
              {query && (
                <button
                  onClick={() => {
                    // Invalidate any in-flight search so it can't repopulate results
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
                  onClick={() => setSectionFilter(tab.key)}
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

              {loading && (
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

              {!loading && sectionFilter === "person" && query.trim().length === 0 && results.length === 0 && !showRecent && (
                <div className="px-4 py-6 text-center">
                  <p className="text-xs text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
                    Follow photographers to see them here — or type a name to find people.
                  </p>
                </div>
              )}

              {!loading && results.length > 0 && (
                <ul className="py-1">
                  {results.map((result, index) => {
                    const config = typeConfig[result.type];
                    const Icon = config.icon;
                    const isPerson = result.type === "person";
                    return (
                      <li key={`${result.type}-${result.id}`}>
                        <button
                          onClick={() => handleSelect(result)}
                          onMouseEnter={() => setSelectedIndex(index)}
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

              {!loading && query.trim().length === 0 && !showRecent && sectionFilter !== "person" && (
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
      </AnimatePresence>
    </div>
  );
};

export default GlobalSearch;
