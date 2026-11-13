import { memberPhotoSrc } from "@/lib/photoProtection";
import { Suspense, lazy, useEffect, useState, useRef } from "react";
import { Plus, ChevronLeft, ChevronRight, Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { toast } from "@/hooks/core/use-toast";
import { uploadImage } from "@/lib/imageUpload";
import { storageSafeFileName } from "@/lib/storageSafeName";
import { compressImage } from "@/lib/imageCompression";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { logger, newCorrelationId } from "@/lib/logger";
import { addPhotoStory, fetchUserStories, STORY_RULES, type StoryPerson, type StorySlide } from "@/lib/stories/storyData";
import { useProfileCore } from "@/hooks/profile/useProfileData";
import { StoryTile, STORY_TILE_LABEL } from "@/components/stories/StoryTile";
import { displayName } from "@/lib/displayName";

const headingFont = { fontFamily: "var(--font-heading)" };

// The viewer loads only when a story is opened (P13 entry-bundle ceiling).
const StoryViewer = lazy(() => import("@/components/stories/StoryViewer"));

const MAX_ACTIVE_STORIES = 10;
const MAX_HIGHLIGHTS = 20;

interface Story {
  id: string;
  image_url: string;
  created_at: string;
}

interface HighlightItem {
  id: string;
  image_url: string;
  caption: string | null;
  highlight_id: string;
  story_id: string | null;
}

interface Highlight {
  id: string;
  title: string;
  cover_url: string | null;
  created_at?: string;
  items: HighlightItem[];
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

/** A highlight's photos as viewer slides (one photo each, the story timing). */
function highlightSlides(hl: Highlight, ownerId: string): StorySlide[] {
  return hl.items.map((item) => ({
    key: `${hl.id}:${item.id}`,
    kind: "photo" as const,
    src: item.image_url,
    video: null,
    durationMs: STORY_RULES.photoMs,
    story: {
      // a highlighted story keeps its own id, so its comments come with it
      id: item.story_id ?? item.id,
      user_id: ownerId,
      created_at: hl.created_at || new Date().toISOString(),
      expires_at: "",
      post_id: null,
      caption: item.caption,
      media: [item.image_url],
      thumbs: [],
      is_video: false,
      like_count: 0,
      comment_count: 0,
      i_liked: false,
      view_count: null,
    },
  }));
}

/**
 * The profile's stories and highlights (Owner, 7 Nov 2026: "no circle anywhere
 * more" — stories and highlights are the feed's rounded squares, profile
 * pictures stay round). Every tile is the one StoryTile; every story and every
 * highlight opens in the one StoryViewer.
 */
const ProfileStories = ({ userId, isOwner }: Props) => {
  const { user } = useAuth();
  const [stories, setStories] = useState<Story[]>([]);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [uploading, setUploading] = useState(false);
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
      // Stories v2: the same visibility rule as everywhere (get_user_stories)
      fetchUserStories(userId).then((rows) => ({ data: rows.slice().reverse().map((r) => ({
        id: r.id, image_url: r.thumbs[0] ?? r.media[0] ?? "", created_at: r.created_at,
      })) }), () => ({ data: [] })),
      supabase
        .from("highlights" as any)
        .select("id, title, cover_url, sort_order, created_at, items:highlight_items(id, highlight_id, image_url, caption, sort_order, story_id)")
        .eq("user_id", userId)
        .order("sort_order"),
    ]);
    setStories((storiesRes.data as Story[]) || []);

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
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (stories.length >= MAX_ACTIVE_STORIES) {
      toast({ title: "Limit reached", description: `Maximum ${MAX_ACTIVE_STORIES} active stories allowed`, variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      // the one story upload (storyData), same as the feed row's "+"
      await addPhotoStory(user.id, file);
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
      const path = `${user.id}/highlights/${Date.now()}-${storageSafeFileName(compressed.name, "highlight")}`;
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
    if (!user) return;
    const correlationId = newCorrelationId();
    try {
      const items = await supabase.from("highlight_items" as any).delete().eq("highlight_id", highlightId);
      if (items.error) throw new Error(items.error.message);
      const { data, error } = await supabase.from("highlights" as any).delete().eq("id", highlightId).select("id");
      if (error) throw new Error(error.message);
      if (!data || (data as unknown[]).length === 0) throw new Error("Highlight could not be deleted.");
      setHighlights(prev => prev.filter(h => h.id !== highlightId));
      toast({ title: "Highlight removed" });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.error({
        code: "STORY-6006",
        event: "HIGHLIGHT_DELETE_FAILED",
        fn: "handleDeleteHighlight",
        file: "src/components/profile/ProfileStories.tsx",
        message: "Deleting a highlight from the story viewer.",
        reason,
        expected: "The highlight and its items deleted",
        actual: reason === "Highlight could not be deleted." ? "0 rows" : "database error",
        nextStep: "Check pg_policies for 'highlights' / 'highlight_items' and confirm the caller owns the row.",
        recordId: highlightId,
        correlationId,
      });
      toast({ title: "Could not delete", description: "Please try again.", variant: "destructive" });
    }
  };

  // Stories v2: stories AND highlights open in the ONE StoryViewer (feed, profile, bell).
  const { data: owner } = useProfileCore(userId);
  const [storyOpenId, setStoryOpenId] = useState<string | null>(null);
  const [highlightOpen, setHighlightOpen] = useState<Highlight | null>(null);
  const person: StoryPerson = {
    userId, name: displayName(owner?.full_name), avatar: owner?.avatar_url ?? null, cover: null, isOwn: isOwner,
  };

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
          className="flex items-start gap-3.5 overflow-x-auto pb-2 scrollbar-hide px-1 md:px-2"
        >
          {/* Add Story (owner only) */}
          {isOwner && (
            <label className="flex-shrink-0 flex flex-col items-center gap-1.5 cursor-pointer group relative">
              <StoryTile
                ring="none"
                dashed
                center={uploading
                  ? <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  : <Plus className="h-5 w-5 text-primary/70 group-hover:text-primary" />}
              />
              <span className={STORY_TILE_LABEL} style={headingFont}>New Story</span>
              <input type="file" accept="image/*" className="hidden" onChange={handleAddStory} />
            </label>
          )}

          {/* Add Highlight (owner only) */}
          {isOwner && (
            <div className="flex-shrink-0 flex flex-col items-center gap-1.5 cursor-pointer group"
              onClick={() => highlightInputRef.current?.click()}
            >
              <StoryTile ring="none" dashed center={<Plus className="h-5 w-5 text-primary/70 group-hover:text-primary" />} />
              <span className={STORY_TILE_LABEL} style={headingFont}>Highlights</span>
              <input ref={highlightInputRef} type="file" accept="image/*" className="hidden" onChange={handleHighlightFileSelect} />
            </div>
          )}

          {/* Active stories */}
          {stories.map((story) => (
            <button
              key={story.id}
              onClick={() => setStoryOpenId(story.id)}
              className="flex-shrink-0 flex flex-col items-center gap-1.5 group"
            >
              <StoryTile ring="unseen" cover={memberPhotoSrc(story.image_url, 320)} alt="Story" />
              <span className={STORY_TILE_LABEL} style={headingFont}>
                {new Date(story.created_at).toLocaleDateString("en", { hour: "numeric", minute: "2-digit" }).split(",")[0]}
              </span>
            </button>
          ))}

          {/* Highlights */}
          {highlights.map((hl) => (
            <button
              key={hl.id}
              onClick={() => { if (hl.items.length > 0) setHighlightOpen(hl); }}
              className="flex-shrink-0 flex flex-col items-center gap-1.5 group"
            >
              <StoryTile
                ring="seen"
                cover={memberPhotoSrc(hl.cover_url || hl.items[0]?.image_url, 320)}
                alt={hl.title}
                corner={
                  <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 bg-accent text-accent-foreground text-[8px] font-bold px-1.5 py-0.5 rounded-md leading-none flex items-center gap-0.5 border-2 border-background">
                    <Star className="h-2 w-2" fill="currentColor" /> Pinned
                  </span>
                }
              />
              <span className={STORY_TILE_LABEL} style={headingFont}>{hl.title}</span>
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

      {storyOpenId && (
        <Suspense fallback={null}>
          <StoryViewer
            people={[person]}
            startIndex={0}
            startStoryId={storyOpenId}
            viewerId={user?.id ?? null}
            onClose={() => { setStoryOpenId(null); void loadData(); }}
            onChanged={() => void loadData()}
          />
        </Suspense>
      )}

      {highlightOpen && (
        <Suspense fallback={null}>
          <StoryViewer
            people={[person]}
            startIndex={0}
            viewerId={user?.id ?? null}
            loadSlides={async () => highlightSlides(highlightOpen, userId)}
            highlight={{ title: highlightOpen.title, onDelete: () => handleDeleteHighlight(highlightOpen.id) }}
            onClose={() => setHighlightOpen(null)}
          />
        </Suspense>
      )}
    </>
  );
};

export default ProfileStories;
