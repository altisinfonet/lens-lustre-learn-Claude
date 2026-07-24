import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Compass, X, SlidersHorizontal } from "lucide-react";
import { useAuth } from "@/hooks/core/useAuth";
import { useIsAdmin } from "@/hooks/core/useIsAdmin";
import { supabase } from "@/integrations/supabase/client";
import { profilesPublic } from "@/lib/profilesPublic";
import DiscoverCard from "@/components/discover/DiscoverCard";
import InfiniteScrollSentinel from "@/components/InfiniteScrollSentinel";
import { motion, AnimatePresence } from "framer-motion";
import { useT } from "@/i18n/I18nContext";

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };
const displayFont = { fontFamily: "var(--font-display)" };

const PAGE_SIZE = 10;

const INTEREST_OPTIONS = [
  "Wildlife", "Street", "Portrait", "Aerial", "Documentary",
  "Landscape", "Architecture", "Macro", "Sports", "Fashion",
  "Underwater", "Astrophotography", "Food", "Travel", "Abstract",
];

type SortOption = "newest" | "name";

interface DiscoverProfile {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  photography_interests: string[] | null;
  created_at: string | null;
}


const Discover = () => {
  const t = useT();
  const { user, loading: authLoading } = useAuth();
  const { isAdmin } = useIsAdmin();
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState<DiscoverProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<SortOption>("newest");
  const [showFilters, setShowFilters] = useState(false);
  const [hiddenIds, setHiddenIds] = useState<string[] | null>(null); // null = not yet loaded
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const pageRef = useRef(0);
  const isFetchingRef = useRef(false);

  useEffect(() => {
    if (!authLoading && !user) navigate("/login");
  }, [user, authLoading, navigate]);

  // Fetch hidden (judge) IDs once
  useEffect(() => {
    const fetchHidden = async () => {
      // SECURITY DEFINER RPC — RLS on user_roles hides other users' rows from
      // regular authenticated callers, so a direct .eq("role","judge") returns []
      // and judges leak into Discover results (breaks judge-privacy contract).
      const { data } = await supabase.rpc("get_public_role_user_ids" as any, { _role: "judge" });
      const ids = (data as any[] | null || []).map((r: any) => (typeof r === "string" ? r : r.user_id ?? r));
      setHiddenIds([...new Set(ids)]);
    };
    fetchHidden();
  }, []);

  const buildQuery = useCallback((offset: number) => {
    // Wait until hiddenIds have loaded (null = pending)
    if (!user || hiddenIds === null) return null;

    let query = profilesPublic()
      .select("id, full_name, avatar_url, bio, photography_interests, created_at")
      .eq("is_suspended", false)
      .eq("is_banned", false) // BUG-088: banned users must not surface in Discover
      .neq("id", user.id);

    if (hiddenIds.length > 0) {
      query = query.not("id", "in", `(${hiddenIds.join(",")})`);
    }

    if (search.trim()) {
      query = query.ilike("full_name", `%${search.trim()}%`);
    }

    if (selectedInterests.length > 0) {
      query = query.overlaps("photography_interests", selectedInterests);
    }

    if (sortBy === "newest") {
      query = query.order("created_at", { ascending: false });
    } else {
      query = query.order("full_name", { ascending: true });
    }

    query = query.range(offset, offset + PAGE_SIZE - 1);

    return query;
  }, [user, hiddenIds, search, selectedInterests, sortBy]);

  // Initial fetch (resets on filter/search change)
  const fetchInitial = useCallback(async () => {
    const query = buildQuery(0);
    if (!query) return;

    setLoading(true);
    pageRef.current = 0;

    const { data } = await query;
    const results = (data as DiscoverProfile[] | null) || [];
    setProfiles(results);
    setHasMore(results.length === PAGE_SIZE);
    setLoading(false);
  }, [buildQuery]);

  // Load more (appends)
  const fetchMore = useCallback(async () => {
    if (isFetchingRef.current || !hasMore) return;
    isFetchingRef.current = true;

    const nextOffset = (pageRef.current + 1) * PAGE_SIZE;
    const query = buildQuery(nextOffset);
    if (!query) { isFetchingRef.current = false; return; }

    setLoadingMore(true);
    const { data } = await query;
    const results = (data as DiscoverProfile[] | null) || [];

    if (results.length > 0) {
      setProfiles((prev) => {
        const existingIds = new Set(prev.map((p) => p.id));
        const newProfiles = results.filter((p) => !existingIds.has(p.id));
        return [...prev, ...newProfiles];
      });
      pageRef.current += 1;
    }

    setHasMore(results.length === PAGE_SIZE);
    setLoadingMore(false);
    isFetchingRef.current = false;
  }, [buildQuery, hasMore]);

  // Debounce initial fetch on filter/search change
  useEffect(() => {
    const timeout = setTimeout(fetchInitial, 300);
    return () => clearTimeout(timeout);
  }, [fetchInitial]);

  // Infinite scroll handled by <InfiniteScrollSentinel /> below.

  const toggleInterest = (interest: string) => {
    setSelectedInterests((prev) =>
      prev.includes(interest) ? prev.filter((i) => i !== interest) : [...prev, interest]
    );
  };

  if (authLoading || !user) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <span className="text-xs tracking-[0.3em] uppercase text-muted-foreground animate-pulse" style={headingFont}>{t("common.loading")}</span>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto py-3 md:py-14 max-w-6xl">
{/* Header */}
        <div className="mb-4 md:mb-8 px-2 md:px-0">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-px bg-primary" />
            <span className="text-[9px] tracking-[0.3em] uppercase text-primary" style={headingFont}>
              <Compass className="h-3 w-3 inline mr-1.5" />Discover
            </span>
          </div>
          <h1 className="text-xl md:text-3xl font-light tracking-tight" style={displayFont}>
            {t("disc.discover")} <em className="text-primary">{t("disc.people")}</em>
          </h1>
          <p className="text-sm text-muted-foreground mt-2" style={bodyFont}>
            Find and connect with people from the community.
          </p>
        </div>

        {/* Search + Filter toggle */}
        <div className="flex gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("fr.searchByName")}
              className="w-full pl-10 pr-4 py-2.5 bg-transparent border border-border focus:border-primary outline-none text-sm transition-colors"
              style={bodyFont}
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`px-4 py-2.5 border text-[10px] tracking-[0.12em] uppercase transition-all duration-300 flex items-center gap-2 ${
              showFilters || selectedInterests.length > 0
                ? "border-primary text-primary"
                : "border-border text-muted-foreground hover:border-primary hover:text-primary"
            }`}
            style={headingFont}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            {t("disc.filters")}
            {selectedInterests.length > 0 && (
              <span className="ml-1 bg-primary text-primary-foreground px-1.5 py-0.5 text-[8px] rounded-sm">
                {selectedInterests.length}
              </span>
            )}
          </button>
        </div>

        {/* Filters panel */}
        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="overflow-hidden"
            >
              <div className="border border-border p-5 mb-6 space-y-4">
                {/* Interests */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground" style={headingFont}>
                      {t("disc.interests")}
                    </span>
                    {selectedInterests.length > 0 && (
                      <button onClick={() => setSelectedInterests([])} className="text-[9px] tracking-[0.1em] uppercase text-primary hover:underline" style={headingFont}>
                        {t("disc.clearAll")}
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {INTEREST_OPTIONS.map((interest) => (
                      <button
                        key={interest}
                        onClick={() => toggleInterest(interest)}
                        className={`text-[10px] tracking-[0.08em] uppercase px-3 py-1.5 border transition-all duration-300 ${
                          selectedInterests.includes(interest)
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                        }`}
                        style={headingFont}
                      >
                        {interest}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Sort */}
                <div>
                  <span className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground block mb-3" style={headingFont}>
                    {t("disc.sortBy")}
                  </span>
                  <div className="flex gap-2">
                    {[
                      { value: "newest" as SortOption, label: t("disc.newestMembers") },
                      { value: "name" as SortOption, label: t("disc.nameAZ") },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setSortBy(opt.value)}
                        className={`text-[10px] tracking-[0.08em] uppercase px-3 py-1.5 border transition-all duration-300 ${
                          sortBy === opt.value
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:border-primary/50"
                        }`}
                        style={headingFont}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Active filters chips */}
        {selectedInterests.length > 0 && !showFilters && (
          <div className="flex flex-wrap gap-2 mb-5">
            {selectedInterests.map((interest) => (
              <button
                key={interest}
                onClick={() => toggleInterest(interest)}
                className="inline-flex items-center gap-1.5 text-[9px] tracking-[0.1em] uppercase px-2.5 py-1 border border-primary/30 text-primary bg-primary/5 hover:bg-primary/10 transition-colors"
                style={headingFont}
              >
                {interest}
                <X className="h-2.5 w-2.5" />
              </button>
            ))}
          </div>
        )}

        {/* Results */}
        {loading ? (
          <div className="text-center py-16">
            <span className="text-xs tracking-[0.3em] uppercase text-muted-foreground animate-pulse" style={headingFont}>
              {t("disc.searching")}
            </span>
          </div>
        ) : profiles.length === 0 ? (
          <div className="border border-dashed border-border p-12 text-center">
            <Compass className="h-8 w-8 text-muted-foreground/20 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground" style={bodyFont}>
              {t("disc.noPeople")}
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1" style={bodyFont}>
              {t("disc.tryAdjusting")}
            </p>
          </div>
        ) : (
          <>
            <h2 className="text-base md:text-lg font-semibold mb-4 px-1" style={headingFont}>
              {t("dash.peopleYouMayKnow")}
            </h2>
            <div className="flex flex-col">
              <AnimatePresence mode="popLayout">
                {profiles.filter(p => !dismissedIds.has(p.id)).map((profile, i) => (
                  <motion.div
                    key={profile.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -60 }}
                    transition={{ duration: 0.25, delay: Math.min(i, 10) * 0.03 }}
                  >
                    <DiscoverCard
                      profile={profile}
                      onDismiss={(id) => setDismissedIds(prev => new Set(prev).add(id))}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            <InfiniteScrollSentinel
              onLoadMore={fetchMore}
              hasNextPage={hasMore}
              isFetching={loadingMore}
              rootMargin="400px"
              enabled={!loading}
              showEndMarker={profiles.length > PAGE_SIZE}
            />
          </>
        )}
      </div>
    </main>
  );
};

export default Discover;
