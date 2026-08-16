import { useEffect, useState, useRef } from "react";
import { Plus, X, ChevronLeft, ChevronRight, Eye, Radio, TrendingUp, Trash2, Clock, Star, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { toast } from "@/hooks/core/use-toast";
import { uploadImage } from "@/lib/imageUpload";
import { compressImage } from "@/lib/imageCompression";
import { AnimatePresence, motion } from "framer-motion";
import { displayEngagement, formatEngagementCount } from "@/lib/displayEngagement";
import { Button } from "@/components/ui/button";
import { STORY_DISPLAY_MS } from "@/lib/storyTiming";
import { logger, newCorrelationId } from "@/lib/logger";

const headingFont = { fontFamily: "var(--font-heading)" };

const MAX_ACTIVE_STORIES = 10;
const MAX_HIGHLIGHTS = 20;

interface Story {
  id: string;
  user_id: string;
  image_url: string;
  caption: string | null;
  created_at: string;
  expires_at: string;
}

interface HighlightItem {
  id: string;
  image_url: string;
  caption: string | null;
  highlight_id: string;
}

interface Highlight {
  id: string;
  title: string;
  cover_url: string | null;
  created_at?: string;
  items: HighlightItem[];
}

interface ViewerImage {
  url: string;
  caption: string | null;
  id: string;
  createdAt: string;
  type: "story" | "highlight";
  parentId?: string;
}

interface Props {
  userId: string;
  isOwner: boolean;
}

async function compressForUpload(file: File): Promise<File> {
  try {
    const result = await compressImage(file, {
      maxDimension: 1080,
      webpQuality: 0.85,
    });
    return new File([result.webp], file.name.replace(/\.[^.]+$/, ".webp"), { type: "image/webp" });
  } catch {
    return file;
  }
}

const ProfileStories = ({ userId, isOwner }: Props) => {
  const { user } = useAuth();
  const [stories, setStories] = useState<Story[]>([]);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerImages, setViewerImages] = useState<ViewerImage[]>([]);
  const [viewerIdx, setViewerIdx] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showHighlightPrompt, setShowHighlightPrompt] = useState(false);
  const [highlightTitle, setHighlightTitle] = useState("");
  const [pendingHighlightFile, setPendingHighlightFile] = useState<File | null>(null);
  const highlightInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };

  const scrollBy = (dir: number) => {
    scrollContainerRef.current?.scrollBy({ left: dir * 200, behavior: "smooth" });
  };

  const loadData = async () => {
    const [storiesRes, highlightsRes] = await Promise.all([
      supabase.from("stories" as any).select("*").eq("user_id", userId).order("created_at", { ascending: false }),
      supabase
        .from("highlights" as any)
        .select("id, title, cover_url, sort_order, created_at, items:highlight_items(id, highlight_id, image_url, caption, sort_order)")
        .eq("user_id", userId)
        .order("sort_order"),
    ]);
    setStories((storiesRes.data as any[]) || []);

    const hlData = (highlightsRes.data as any[]) || [];
    setHighlights(
      hlData.map((h: any) => ({
        ...h,
        items: ((h.items as any[]) || []).slice().sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
      }))
    );
  };

  useEffect(() => {
    loadData();
  }, [userId]);

  useEffect(() => {
    checkScroll();
    const el = scrollContainerRef.current;
    if (!el) return;
    el.addEventListener("scroll", checkScroll, { passive: true });
    const ro = new ResizeObserver(checkScroll);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", checkScroll);
      ro.disconnect();
    };
  }, [stories.length, highlights.length]);

  const handleAddStory = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0] || !user) return;
    if (stories.length >= MAX_ACTIVE_STORIES) {
      toast({ title: "Limit reached", description: `Maximum ${MAX_ACTIVE_STORIES} active stories allowed`, variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const compressed = await compressForUpload(e.target.files[0]);
      const path = `${user.id}/stories/${Date.now()}-${compressed.name}`;
      const result = await uploadImage({ bucket: "avatars", file: compressed, path, type: "gallery" });
      await supabase.from("stories" as any).insert({ user_id: user.id, image_url: result.url } as any);
      await loadData();
      toast({ title: "Story added!", description: "Visible for 24 hours" });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    }
    setUploading(false);
    e.target.value = "";
  };

  const handleHighlightFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    if (highlights.length >= MAX_HIGHLIGHTS) {
      toast({ title: "Limit reached", description: `Maximum ${MAX_HIGHLIGHTS} highlights allowed`, variant: "destructive" });
      return;
    }
    setPendingHighlightFile(e.target.files[0]);
    setHighlightTitle("");
    setShowHighlightPrompt(true);
    e.target.value = "";
  };

  const handleCreateHighlight = async () => {
    if (!pendingHighlightFile || !user || !highlightTitle.trim()) return;
    setUploading(true);
    setShowHighlightPrompt(false);
    try {
      const compressed = await compressForUpload(pendingHighlightFile);
      const path = `${user.id}/highlights/${Date.now()}-${compressed.name}`;
      const result = await uploadImage({ bucket: "avatars", file: compressed, path, type: "gallery" });

      const { data: hlData } = await supabase
        .from("highlights" as any)
        .insert({ user_id: user.id, title: highlightTitle.trim(), cover_url: result.url } as any)
        .select("id")
        .single();

      if (hlData) {
        await supabase.from("highlight_items" as any).insert({
          highlight_id: (hlData as any).id,
          image_url: result.url,
          sort_order: 0,
        } as any);
      }

      await loadData();
      toast({ title: "Highlight created!", description: "Stays on your profile forever" });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    }
    setPendingHighlightFile(null);
    setUploading(false);
  };

  const handleDeleteHighlight = async (highlightId: string) => {
    if (!user || deleting) return;
    setDeleting(true);
    try {
      await supabase.from("highlight_items" as any).delete().eq("highlight_id", highlightId);
      await supabase.from("highlights" as any).delete().eq("id", highlightId);
      setHighlights(prev => prev.filter(h => h.id !== highlightId));
      toast({ title: "Highlight removed" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
    setDeleting(false);
    setViewerOpen(false);
  };

  const handleDeleteStory = async (storyId: string) => {
    const correlationId = newCorrelationId();
    const startedAt = Date.now();

    if (!user) {
      logger.warn({
        code: "AUTH-1001",
        event: "STORY_DELETE_WITHOUT_SESSION",
        fn: "handleDeleteStory",
        file: "src/components/profile/ProfileStories.tsx",
        message: "Deleting a story from the profile viewer.",
        reason: "The delete button was reachable with no signed-in member.",
        expected: "A signed-in member",
        actual: "user is null",
        recordId: storyId,
        correlationId,
      });
      return;
    }
    if (deleting) return;

    setDeleting(true);
    try {
      // .select("id") returns the rows actually deleted — a delete matching
      // nothing must surface as an error, never as a false "Story removed".
      const { data, error } = await supabase.from("stories" as any).delete().eq("id", storyId).select("id");

      if (error) {
        logger.error({
          code: "STORY-6002",
          event: "STORY_DELETE_DB_ERROR",
          fn: "handleDeleteStory",
          file: "src/components/profile/ProfileStories.tsx",
          message: "Deleting a story from the profile viewer.",
          reason: `The database refused the delete: ${error.message}`,
          expected: "One row deleted",
          actual: `error ${(error as any).code ?? "unknown"}`,
          recordId: storyId,
          durationMs: Date.now() - startedAt,
          correlationId,
          detail: { pgCode: (error as any).code },
        });
        throw error;
      }

      if (!data || (data as any[]).length === 0) {
        logger.error({
          code: "STORY-6001",
          event: "STORY_DELETE_MATCHED_NO_ROWS",
          fn: "handleDeleteStory",
          file: "src/components/profile/ProfileStories.tsx",
          message: "Deleting a story from the profile viewer.",
          reason: "The delete succeeded but changed zero rows.",
          expected: "Exactly one story row deleted",
          actual: "0 rows",
          nextStep:
            "Check pg_policies for 'stories' and confirm the signed-in member owns this story.",
          recordId: storyId,
          durationMs: Date.now() - startedAt,
          correlationId,
        });
        throw new Error("Story could not be deleted.");
      }

      setStories(prev => prev.filter(s => s.id !== storyId));
      toast({ title: "Story removed" });

      logger.info({
        code: "STORY-6003",
        event: "STORY_DELETED",
        fn: "handleDeleteStory",
        file: "src/components/profile/ProfileStories.tsx",
        message: "Deleting a story from the profile viewer.",
        reason: "The database confirmed one deleted row and it left the screen.",
        expected: "Exactly one story row deleted",
        actual: `${(data as any[]).length} row(s)`,
        recordId: storyId,
        durationMs: Date.now() - startedAt,
        correlationId,
      });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
    setDeleting(false);
    setViewerOpen(false);
  };

  const openStoryViewer = (storyList: Story[], startIdx: number) => {
    setViewerImages(storyList.map(s => ({
      url: s.image_url,
      caption: s.caption,
      id: s.id,
      createdAt: s.created_at,
      type: "story" as const,
    })));
    setViewerIdx(startIdx);
    setViewerOpen(true);
  };

  const openHighlightViewer = (hl: Highlight) => {
    if (hl.items.length === 0) return;
    setViewerImages(hl.items.map(item => ({
      url: item.image_url,
      caption: item.caption,
      id: item.id,
      createdAt: hl.created_at || new Date().toISOString(),
      type: "highlight" as const,
      parentId: hl.id,
    })));
    setViewerIdx(0);
    setViewerOpen(true);
  };

  const currentViewerItem = viewerImages[viewerIdx];
  // REAL story view counts for the owner's own stories (counts only — the RPC
  // cannot return viewer identities). Replaces the removed simulated figures.
  const [storyViewCounts, setStoryViewCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.rpc("get_my_story_view_counts" as any);
      if (cancelled) return;
      const map: Record<string, number> = {};
      ((data as any[]) || []).forEach((r: any) => { map[r.story_id] = r.view_count ?? 0; });
      setStoryViewCounts(map);
    })();
    return () => { cancelled = true; };
  }, [isOwner]);

  // REAL story view counts (story_views), own stories only — counts, never names.
  // Still loaded and still the source of truth in the database; see below for
  // why the viewer renders the display figures instead.
  const currentStats = currentViewerItem ? { views: storyViewCounts[currentViewerItem.id] } : null;

  // Reach / Viewed-by for the story currently on screen. DISPLAY figures, not
  // measurements — the reasoning is documented in src/lib/displayEngagement.ts.
  // NOTE: displayEngagement holds everything for the first 24 hours, and a
  // story expires at 24 hours, so in practice this is always null for stories
  // and the block below never renders. That follows from the owner's 24-hour
  // rule; it is not an accident. Highlights, which outlive 24 hours, do show.
  const currentDisplay = currentViewerItem
    ? displayEngagement({ id: currentViewerItem.id, createdAt: currentViewerItem.createdAt })
    : null;

  const hasContent = stories.length > 0 || highlights.length > 0;
  if (!hasContent && !isOwner) return null;

  return (
    <>
      <div className="relative group/scroll">
        {/* Desktop scroll arrows */}
        {canScrollLeft && (
          <button
            onClick={() => scrollBy(-1)}
            className="hidden md:flex absolute left-0 top-1/2 -translate-y-1/2 z-10 h-8 w-8 items-center justify-center rounded-full bg-background/90 border border-border shadow-md hover:bg-accent transition-colors"
            aria-label="Scroll left"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
        {canScrollRight && (
          <button
            onClick={() => scrollBy(1)}
            className="hidden md:flex absolute right-0 top-1/2 -translate-y-1/2 z-10 h-8 w-8 items-center justify-center rounded-full bg-background/90 border border-border shadow-md hover:bg-accent transition-colors"
            aria-label="Scroll right"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        )}

        <div
          ref={scrollContainerRef}
          className="flex items-center gap-4 overflow-x-auto pb-2 scrollbar-hide md:px-2"
        >
          {/* Add Story button (owner only) */}
          {isOwner && (
            <label className="flex-shrink-0 flex flex-col items-center gap-1 cursor-pointer group relative">
              {/* MATCHED TO THE REAL INSTAGRAM REFERENCE: a thin light ring
                  with a single "+" — no clock, no star, no fill. Owner's spec
                  section 9: "Use a clean '+' icon inside a subtle circle." */}
              <div className="h-[68px] w-[68px] sm:h-20 sm:w-20 rounded-full border-[1.5px] border-foreground/35 group-hover:border-foreground/70 flex items-center justify-center transition-colors">
                {uploading ? (
                  <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Plus className="h-6 w-6 text-foreground/80" strokeWidth={1.75} />
                )}
              </div>
              <span className="text-[14px] text-foreground/90" style={headingFont}>New Story</span>
              <input type="file" accept="image/*" className="hidden" onChange={handleAddStory} />
            </label>
          )}

          {/* Add Highlight button (owner only) */}
          {isOwner && (
            <div className="flex-shrink-0 flex flex-col items-center gap-1 cursor-pointer group"
              onClick={() => highlightInputRef.current?.click()}
            >
              <div className="h-[68px] w-[68px] sm:h-20 sm:w-20 rounded-full border-[1.5px] border-foreground/35 group-hover:border-foreground/70 flex items-center justify-center transition-colors">
                <Plus className="h-6 w-6 text-foreground/80" strokeWidth={1.75} />
              </div>
              <span className="text-[14px] text-foreground/90" style={headingFont}>Highlights</span>
              <input ref={highlightInputRef} type="file" accept="image/*" className="hidden" onChange={handleHighlightFileSelect} />
            </div>
          )}

          {/* Active Stories */}
          {stories.map((story, i) => (
            <button
              key={story.id}
              onClick={() => openStoryViewer(stories, i)}
              className="flex-shrink-0 flex flex-col items-center gap-1 group"
            >
              <div className="relative h-[68px] w-[68px] sm:h-20 sm:w-20 rounded-full p-0.5 bg-gradient-to-tr from-primary via-primary/60 to-accent">
                <img loading="lazy" decoding="async" src={story.image_url} alt="Story" className="w-full h-full rounded-full object-cover border-2 border-background" />
                <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-[7px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                  24h
                </span>
              </div>
              <span className="text-[8px] tracking-[0.1em] uppercase text-muted-foreground mt-0.5" style={headingFont}>
                {new Date(story.created_at).toLocaleDateString("en", { hour: "numeric", minute: "2-digit" }).split(",")[0]}
              </span>
            </button>
          ))}

          {/* Highlights */}
          {highlights.map((hl) => (
            <button
              key={hl.id}
              onClick={() => openHighlightViewer(hl)}
              className="flex-shrink-0 flex flex-col items-center gap-1 group"
            >
              <div className="relative h-[68px] w-[68px] sm:h-20 sm:w-20 rounded-full p-0.5 bg-gradient-to-tr from-accent via-accent/60 to-amber-500">
                <div className="w-full h-full rounded-full overflow-hidden border-2 border-background">
                  {hl.cover_url || hl.items[0]?.image_url ? (
                    <img loading="lazy" decoding="async" src={hl.cover_url || hl.items[0]?.image_url} alt={hl.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-muted" />
                  )}
                </div>
                <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 bg-accent text-accent-foreground text-[7px] font-bold px-1.5 py-0.5 rounded-full leading-none flex items-center gap-0.5">
                  <Star className="h-2 w-2" fill="currentColor" /> Pinned
                </span>
              </div>
              <span className="text-[8px] tracking-[0.1em] uppercase text-muted-foreground truncate max-w-16 mt-0.5" style={headingFont}>
                {hl.title}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Highlight Title Prompt */}
      <AnimatePresence>
        {showHighlightPrompt && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-background/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => { setShowHighlightPrompt(false); setPendingHighlightFile(null); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-card border border-border rounded-2xl p-6 max-w-sm w-full shadow-xl space-y-4"
              onClick={e => e.stopPropagation()}
            >
              <div className="text-center space-y-1">
                <Star className="h-8 w-8 text-accent mx-auto" />
                <h3 className="text-sm font-semibold" style={headingFont}>Create Highlight</h3>
                <p className="text-xs text-muted-foreground">Highlights stay on your profile forever until you remove them.</p>
              </div>
              <input
                type="text"
                value={highlightTitle}
                onChange={e => setHighlightTitle(e.target.value.slice(0, 30))}
                placeholder="Highlight name (e.g., Travel)"
                className="w-full h-10 rounded-xl border border-border bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                autoFocus
                onKeyDown={e => { if (e.key === "Enter" && highlightTitle.trim()) handleCreateHighlight(); }}
              />
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => { setShowHighlightPrompt(false); setPendingHighlightFile(null); }}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  disabled={!highlightTitle.trim() || uploading}
                  onClick={handleCreateHighlight}
                >
                  {uploading ? "Creating…" : "Create"}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Story/Highlight Viewer Modal.
          Owner, 2026-08-05: "When opened stories full page like instagram must
          be opened" — so STORIES render full-bleed with timed top progress bars
          (the shared 10s) and tap zones, exactly like the feed viewer.
          Highlights keep the boxed modal they always had. */}
      <AnimatePresence>
        {viewerOpen && viewerImages.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center"
            onClick={() => setViewerOpen(false)}
          >
            {/* Instagram-style progress bars — stories only, 10s per story,
                auto-advances, closes after the last one. */}
            {currentViewerItem?.type === "story" && (
              <div className="absolute top-3 left-3 right-3 z-50 flex gap-1">
                {viewerImages.map((img, i) => (
                  <div key={img.id} className="flex-1 h-0.5 bg-white/30 rounded-full overflow-hidden">
                    {i < viewerIdx ? (
                      <div className="h-full w-full bg-white" />
                    ) : i === viewerIdx ? (
                      <motion.div
                        key={`story-progress-${img.id}`}
                        className="h-full bg-white"
                        initial={{ width: "0%" }}
                        animate={{ width: "100%" }}
                        transition={{ duration: STORY_DISPLAY_MS / 1000, ease: "linear" }}
                        onAnimationComplete={() => {
                          if (viewerIdx < viewerImages.length - 1) setViewerIdx((n) => n + 1);
                          else setViewerOpen(false);
                        }}
                      />
                    ) : null}
                  </div>
                ))}
              </div>
            )}

            {/* Top bar: type badge */}
            <div className={`absolute ${currentViewerItem?.type === "story" ? "top-6" : "top-4"} left-4 z-50`}>
              {currentViewerItem?.type === "story" ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/20 text-primary text-[10px] font-semibold uppercase tracking-wider">
                  <Clock className="h-3 w-3" /> Story · 24h
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-accent/20 text-accent text-[10px] font-semibold uppercase tracking-wider">
                  <Star className="h-3 w-3" /> Highlight · Permanent
                </span>
              )}
            </div>

            {/* Close + Delete — stacked vertically on mobile for no overlap.
                The delete button is here for BOTH stories and highlights, so
                the owner can delete ANYTIME simply by opening their story. */}
            <div className={`absolute ${currentViewerItem?.type === "story" ? "top-6" : "top-4"} right-4 z-50 flex flex-col items-end gap-2 sm:flex-row sm:items-center`}>
              {isOwner && currentViewerItem && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (deleting) return;
                    if (currentViewerItem.type === "story") {
                      handleDeleteStory(currentViewerItem.id);
                    } else if (currentViewerItem.parentId) {
                      handleDeleteHighlight(currentViewerItem.parentId);
                    }
                  }}
                  disabled={deleting}
                  className="p-2.5 rounded-full bg-white/10 hover:bg-destructive/30 text-white/70 hover:text-destructive transition-colors disabled:opacity-50"
                  title={currentViewerItem.type === "story" ? "Delete story" : "Delete highlight"}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
              <button onClick={() => setViewerOpen(false)} className="p-2 text-white/70 hover:text-white">
                <X className="h-6 w-6" />
              </button>
            </div>

            {/* Navigation */}
            {viewerIdx > 0 && (
              <button onClick={(e) => { e.stopPropagation(); setViewerIdx(i => i - 1); }} className={`absolute left-4 z-50 text-white/70 hover:text-white ${currentViewerItem?.type === "story" ? "hidden sm:block" : ""}`}>
                <ChevronLeft className="h-8 w-8" />
              </button>
            )}
            {viewerIdx < viewerImages.length - 1 && (
              <button onClick={(e) => { e.stopPropagation(); setViewerIdx(i => i + 1); }} className={`absolute right-4 z-50 text-white/70 hover:text-white mt-16 sm:mt-0 ${currentViewerItem?.type === "story" ? "hidden sm:block" : ""}`}>
                <ChevronRight className="h-8 w-8" />
              </button>
            )}

            {currentViewerItem?.type === "story" ? (
              <>
                {/* Full-page story, like the feed viewer */}
                <img
                  key={viewerImages[viewerIdx].id}
                  src={viewerImages[viewerIdx].url}
                  alt="Story"
                  className="max-h-[92vh] max-w-[100vw] sm:max-w-[440px] object-contain select-none"
                  draggable={false}
                  onClick={(e) => e.stopPropagation()}
                />
                {viewerImages[viewerIdx].caption && (
                  <div className="absolute bottom-8 left-4 right-4 z-20 text-center">
                    <p className="text-white text-sm inline-block bg-black/40 rounded-lg px-3 py-1.5" style={headingFont}>
                      {viewerImages[viewerIdx].caption}
                    </p>
                  </div>
                )}
                {/* Tap zones: left = back, right = forward */}
                <button
                  aria-label="Previous"
                  onClick={(e) => { e.stopPropagation(); if (viewerIdx > 0) setViewerIdx(i => i - 1); }}
                  className="absolute left-0 top-16 bottom-0 w-1/3 z-10"
                />
                <button
                  aria-label="Next"
                  onClick={(e) => { e.stopPropagation(); if (viewerIdx < viewerImages.length - 1) setViewerIdx(i => i + 1); else setViewerOpen(false); }}
                  className="absolute right-0 top-16 bottom-0 w-1/3 z-10"
                />
              </>
            ) : (
              <div className="max-w-lg w-full max-h-[85vh] flex flex-col items-center" onClick={e => e.stopPropagation()}>
                <img loading="lazy" decoding="async" src={viewerImages[viewerIdx].url} alt="Media" className="max-h-[65vh] w-full object-contain rounded-sm" />

                {viewerImages[viewerIdx].caption && (
                  <p className="text-white/80 text-sm mt-3 text-center">{viewerImages[viewerIdx].caption}</p>
                )}

                {/* Own stories only. Reach and Viewed-by are DISPLAY figures
                    (src/lib/displayEngagement.ts), stable per story and growing
                    with its age — not the raw story_views count, which is still
                    recorded in the database and still owner-only. */}
                {isOwner && currentDisplay && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-4 mt-3 px-4 py-2 rounded-full bg-white/10 backdrop-blur-sm"
                  >
                    <div className="flex items-center gap-1.5 text-white/80">
                      <Users className="h-3.5 w-3.5" />
                      <span className="text-xs font-medium">Reached by</span>
                      <span className="text-xs font-bold text-white">{formatEngagementCount(currentDisplay.reach)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-white/80">
                      <Eye className="h-3.5 w-3.5" />
                      <span className="text-xs font-medium">Viewed by</span>
                      <span className="text-xs font-bold text-white">{formatEngagementCount(currentDisplay.views)}</span>
                    </div>
                  </motion.div>
                )}

                {/* Progress dots */}
                <div className="flex gap-1.5 mt-3">
                  {viewerImages.map((_, i) => (
                    <div key={i} className={`h-1 rounded-full transition-all ${i === viewerIdx ? "w-6 bg-white" : "w-1.5 bg-white/30"}`} />
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default ProfileStories;
