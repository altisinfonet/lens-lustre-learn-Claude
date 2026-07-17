import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Trophy, BookOpen, Newspaper, X, SlidersHorizontal, Calendar as CalendarIcon, Tag, User, Layers, UserRound, MessageSquare } from "lucide-react";
import { profilesPublic } from "@/lib/profilesPublic";
import { supabase } from "@/integrations/supabase/client";
import { AnimatePresence, motion } from "framer-motion";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
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
}

const typeConfig = {
  competition: { icon: Trophy, label: "Competition", color: "text-primary" },
  course: { icon: BookOpen, label: "Course", color: "text-accent" },
  article: { icon: Newspaper, label: "Journal", color: "text-secondary" },
  person: { icon: UserRound, label: "Person", color: "text-foreground" },
  post: { icon: MessageSquare, label: "Post", color: "text-muted-foreground" },
};

type SectionFilter = "all" | "competition" | "course" | "article" | "person" | "post";

const GlobalSearch = () => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const navigate = useNavigate();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Advanced filters
  const [sectionFilter, setSectionFilter] = useState<SectionFilter>("all");
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
  const [categoryFilter, setCategoryFilter] = useState("");
  const [authorFilter, setAuthorFilter] = useState("");

  const hasActiveFilters = sectionFilter !== "all" || !!dateFrom || !!dateTo || !!categoryFilter || !!authorFilter;

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
    if (q.trim().length < 2 && !hasActiveFilters) {
      setResults([]);
      return;
    }
    setLoading(true);
    const searchTerm = q.trim().length >= 2 ? `%${q.trim()}%` : "%";

    const shouldSearchComps = sectionFilter === "all" || sectionFilter === "competition";
    const shouldSearchCourses = sectionFilter === "all" || sectionFilter === "course";
    const shouldSearchArticles = sectionFilter === "all" || sectionFilter === "article";
    const shouldSearchPeople = sectionFilter === "all" || sectionFilter === "person";
    const shouldSearchPosts = sectionFilter === "all" || sectionFilter === "post";

    const [comps, courses, articles, people, posts] = await Promise.all([
      shouldSearchComps
        ? (() => {
            let qb = supabase.from("competitions").select("id, title, category, status, starts_at");
            if (q.trim().length >= 2) qb = qb.ilike("title", searchTerm);
            if (categoryFilter) qb = qb.ilike("category", `%${categoryFilter}%`);
            if (dateFrom) qb = qb.gte("starts_at", dateFrom.toISOString());
            if (dateTo) qb = qb.lte("starts_at", dateTo.toISOString());
            return qb.limit(8);
          })()
        : Promise.resolve({ data: [] }),
      shouldSearchCourses
        ? (() => {
            let qb = supabase.from("courses").select("id, title, slug, category, difficulty, published_at").eq("status", "published");
            if (q.trim().length >= 2) qb = qb.ilike("title", searchTerm);
            if (categoryFilter) qb = qb.ilike("category", `%${categoryFilter}%`);
            if (dateFrom) qb = qb.gte("published_at", dateFrom.toISOString());
            if (dateTo) qb = qb.lte("published_at", dateTo.toISOString());
            return qb.limit(8);
          })()
        : Promise.resolve({ data: [] }),
      shouldSearchArticles
        ? (() => {
            let qb = supabase.from("journal_articles").select("id, title, slug, excerpt, published_at, tags").eq("status", "published");
            if (q.trim().length >= 2) qb = qb.ilike("title", searchTerm);
            if (dateFrom) qb = qb.gte("published_at", dateFrom.toISOString());
            if (dateTo) qb = qb.lte("published_at", dateTo.toISOString());
            return qb.limit(8);
          })()
        : Promise.resolve({ data: [] }),
      shouldSearchPeople && q.trim().length >= 2
        ? (() => {
            let qb = profilesPublic()
              .select("id, full_name, avatar_url, bio")
              .eq("is_suspended", false)
              .ilike("full_name", searchTerm);
            return qb.limit(8);
          })()
        : Promise.resolve({ data: [] }),
      shouldSearchPosts && q.trim().length >= 2
        ? (() => {
            let qb = supabase.from("posts").select("id, content, user_id, created_at")
              .eq("privacy", "public")
              .ilike("content", searchTerm)
              .order("created_at", { ascending: false });
            if (dateFrom) qb = qb.gte("created_at", dateFrom.toISOString());
            if (dateTo) qb = qb.lte("created_at", dateTo.toISOString());
            return qb.limit(8);
          })()
        : Promise.resolve({ data: [] }),
    ]);

    const mapped: SearchResult[] = [
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
      ...(people.data || []).map((p: any) => ({
        id: p.id,
        title: p.full_name || "Photographer",
        type: "person" as const,
        url: `/profile/${p.id}`,
        subtitle: p.bio?.slice(0, 60) || undefined,
        avatarUrl: p.avatar_url,
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

    // Filter by author name client-side if set (would need profile join for server-side)
    setResults(mapped);
    setSelectedIndex(0);
    setLoading(false);
  }, [sectionFilter, dateFrom, dateTo, categoryFilter, authorFilter, hasActiveFilters]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (open) search(query);
    }, 300);
    return () => clearTimeout(timeout);
  }, [query, search, open]);

  const handleSelect = (result: SearchResult) => {
    setOpen(false);
    setQuery("");
    setResults([]);
    navigate(result.url);
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

  const clearFilters = () => {
    setSectionFilter("all");
    setDateFrom(undefined);
    setDateTo(undefined);
    setCategoryFilter("");
    setAuthorFilter("");
  };

  const highlightTitle = (title: string) => {
    const q = query.trim();
    if (!q) return title;
    const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    const parts = title.split(regex);
    return parts.map((part, i) =>
      regex.test(part) ? <mark key={i} className="bg-primary/20 text-primary rounded-sm px-0.5">{part}</mark> : part
    );
  };

  const sections: { key: SectionFilter; label: string; icon: typeof Search }[] = [
    { key: "all", label: "All", icon: Layers },
    { key: "competition", label: "Competitions", icon: Trophy },
    { key: "course", label: "Courses", icon: BookOpen },
    { key: "article", label: "Journal", icon: Newspaper },
    { key: "person", label: "People", icon: UserRound },
  ];

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

      {/* Dropdown panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="absolute right-0 top-full mt-2 w-[420px] max-w-[92vw] bg-card border border-border rounded-lg shadow-2xl overflow-hidden z-[80]"
          >
            {/* Search input row */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
              <Search className="h-4 w-4 text-muted-foreground shrink-0" />
              <input
                ref={inputRef}
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search…"
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60 text-foreground"
                style={{ fontFamily: "var(--font-body)" }}
              />
              {query && (
                <button onClick={() => { setQuery(""); setResults([]); }} className="text-muted-foreground hover:text-foreground transition-colors">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              {/* Advanced toggle */}
              <button
                onClick={() => setAdvancedOpen(!advancedOpen)}
                className={cn(
                  "p-1.5 rounded transition-all duration-300 border",
                  advancedOpen || hasActiveFilters
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
                title="Toggle advanced search"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Advanced filters panel */}
            <AnimatePresence>
              {advancedOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="overflow-hidden border-b border-border"
                >
                  <div className="px-4 py-3 space-y-3 bg-muted/30">
                    {/* Section filter */}
                    <div>
                      <span className="text-[9px] tracking-[0.25em] uppercase text-muted-foreground block mb-2" style={{ fontFamily: "var(--font-heading)" }}>
                        Section
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {sections.map((s) => {
                          const Icon = s.icon;
                          return (
                            <button
                              key={s.key}
                              onClick={() => setSectionFilter(s.key)}
                              className={cn(
                                "inline-flex items-center gap-1.5 text-[10px] tracking-[0.1em] uppercase px-3 py-1.5 border rounded-sm transition-all duration-300",
                                sectionFilter === s.key
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border text-muted-foreground hover:border-foreground/30"
                              )}
                              style={{ fontFamily: "var(--font-heading)" }}
                            >
                              <Icon className="h-3 w-3" />
                              {s.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Date range */}
                    <div className="flex gap-3">
                      <div className="flex-1">
                        <span className="text-[9px] tracking-[0.25em] uppercase text-muted-foreground block mb-2" style={{ fontFamily: "var(--font-heading)" }}>
                          From
                        </span>
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              className={cn(
                                "w-full flex items-center gap-2 text-[11px] px-3 py-2 border border-border rounded-sm transition-colors",
                                dateFrom ? "text-foreground" : "text-muted-foreground"
                              )}
                              style={{ fontFamily: "var(--font-body)" }}
                            >
                              <CalendarIcon className="h-3 w-3" />
                              {dateFrom ? format(dateFrom, "MMM d, yyyy") : "Any date"}
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0 z-[90]" align="start">
                            <Calendar
                              mode="single"
                              selected={dateFrom}
                              onSelect={setDateFrom}
                              initialFocus
                              className={cn("p-3 pointer-events-auto")}
                            />
                          </PopoverContent>
                        </Popover>
                      </div>
                      <div className="flex-1">
                        <span className="text-[9px] tracking-[0.25em] uppercase text-muted-foreground block mb-2" style={{ fontFamily: "var(--font-heading)" }}>
                          To
                        </span>
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              className={cn(
                                "w-full flex items-center gap-2 text-[11px] px-3 py-2 border border-border rounded-sm transition-colors",
                                dateTo ? "text-foreground" : "text-muted-foreground"
                              )}
                              style={{ fontFamily: "var(--font-body)" }}
                            >
                              <CalendarIcon className="h-3 w-3" />
                              {dateTo ? format(dateTo, "MMM d, yyyy") : "Any date"}
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0 z-[90]" align="start">
                            <Calendar
                              mode="single"
                              selected={dateTo}
                              onSelect={setDateTo}
                              initialFocus
                              className={cn("p-3 pointer-events-auto")}
                            />
                          </PopoverContent>
                        </Popover>
                      </div>
                    </div>

                    {/* Category */}
                    <div>
                      <span className="text-[9px] tracking-[0.25em] uppercase text-muted-foreground block mb-2" style={{ fontFamily: "var(--font-heading)" }}>
                        Category
                      </span>
                      <div className="relative">
                        <Tag className="absolute left-3 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                        <input
                          value={categoryFilter}
                          onChange={(e) => setCategoryFilter(e.target.value)}
                          placeholder="e.g. Wildlife, Portrait…"
                          className="w-full bg-transparent text-[11px] pl-8 pr-3 py-2 border border-border rounded-sm outline-none placeholder:text-muted-foreground/50 text-foreground"
                          style={{ fontFamily: "var(--font-body)" }}
                        />
                      </div>
                    </div>

                    {/* Clear filters */}
                    {hasActiveFilters && (
                      <button
                        onClick={clearFilters}
                        className="text-[10px] tracking-[0.15em] uppercase text-primary hover:underline"
                        style={{ fontFamily: "var(--font-heading)" }}
                      >
                        Clear all filters
                      </button>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Results */}
            <div className="max-h-[50vh] overflow-y-auto">
              {loading && (
                <div className="px-4 py-6 text-center">
                  <span className="text-xs text-muted-foreground animate-pulse" style={{ fontFamily: "var(--font-heading)" }}>Searching…</span>
                </div>
              )}

              {!loading && (query.length >= 2 || hasActiveFilters) && results.length === 0 && (
                <div className="px-4 py-6 text-center">
                  <p className="text-xs text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
                    No results found{query ? <> for "<span className="text-foreground">{query}</span>"</> : ""}
                    {hasActiveFilters && " with current filters"}
                  </p>
                </div>
              )}

              {!loading && results.length > 0 && (
                <ul className="py-1">
                  {results.map((result, index) => {
                    const config = typeConfig[result.type];
                    const Icon = config.icon;
                    return (
                      <li key={`${result.type}-${result.id}`}>
                        <button
                          onClick={() => handleSelect(result)}
                          onMouseEnter={() => setSelectedIndex(index)}
                          className={cn(
                            "w-full flex items-start gap-3 px-4 py-2.5 text-left transition-colors duration-150",
                            index === selectedIndex ? "bg-muted" : "hover:bg-muted/50"
                          )}
                        >
                          {result.type === "person" && result.avatarUrl ? (
                            <img referrerPolicy="no-referrer" loading="lazy" decoding="async" src={result.avatarUrl} alt="" className="w-5 h-5 rounded-full object-cover mt-0.5 shrink-0" />
                          ) : (
                            <div className={`mt-0.5 ${config.color}`}>
                              <Icon className="h-4 w-4" strokeWidth={1.5} />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
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
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {!loading && query.length < 2 && !hasActiveFilters && (
                <div className="px-4 py-6 text-center">
                  <p className="text-xs text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
                    Type to search or use <span className="text-primary cursor-pointer" onClick={() => setAdvancedOpen(true)}>advanced filters</span>
                  </p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-border px-4 py-2 flex items-center gap-4 text-[10px] text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 border border-border rounded text-[9px]">↑↓</kbd> Navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 border border-border rounded text-[9px]">↵</kbd> Select
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 border border-border rounded text-[9px]">Esc</kbd> Close
              </span>
              {hasActiveFilters && (
                <span className="ml-auto text-primary">{results.length} result{results.length !== 1 ? "s" : ""}</span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default GlobalSearch;
