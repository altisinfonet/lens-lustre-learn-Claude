import { useEffect, useState, useRef, useCallback } from "react";
import { Plus, X, ChevronLeft, ChevronRight, Trash2, Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { toast } from "@/hooks/core/use-toast";
import { uploadImage } from "@/lib/imageUpload";
import { compressImage } from "@/lib/imageCompression";
import { AnimatePresence, motion } from "framer-motion";

const headingFont = { fontFamily: "var(--font-heading)" };
const STORY_MS = 5000;

interface BarUser {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  is_official: boolean;
  latest_story_at: string;
  story_count: number;
  has_unseen: boolean;
}

interface Story {
  id: string;
  user_id: string;
  image_url: string;
  caption: string | null;
  created_at: string;
  expires_at: string;
}

interface ViewerGroup {
  userId: string;
  name: string;
  avatar: string | null;
  isOfficial: boolean;
  isOwn: boolean;
}

async function compressForUpload(file: File): Promise<File> {
  try {
    const result = await compressImage(file, { maxDimension: 1080, webpQuality: 0.85 });
    return new File([result.webp], file.name.replace(/\.[^.]+$/, ".webp"), { type: "image/webp" });
  } catch {
    return file;
  }
}

const FeedStoriesBar = () => {
  const { user } = useAuth();
  const [bar, setBar] = useState<BarUser[]>([]);
  const [ownStories, setOwnStories] = useState<Story[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Viewer state
  const [viewerOpen, setViewerOpen] = useState(false);
  const [groups, setGroups] = useState<ViewerGroup[]>([]);
  const [groupIdx, setGroupIdx] = useState(0);
  const [groupStories, setGroupStories] = useState<Story[]>([]);
  const [storyIdx, setStoryIdx] = useState(0);
  const [deleting, setDeleting] = useState(false);

  const nowIso = () => new Date().toISOString();

  const loadBar = useCallback(async () => {
    if (!user) return;
    const [{ data: barData }, { data: own }] = await Promise.all([
      supabase.rpc("get_feed_stories_bar" as any),
      supabase
        .from("stories" as any)
        .select("id, user_id, image_url, caption, created_at, expires_at")
        .eq("user_id", user.id)
        .gt("expires_at", nowIso())
        .order("created_at", { ascending: true }),
    ]);
    setBar(((barData as any[]) || []) as BarUser[]);
    setOwnStories(((own as any[]) || []) as Story[]);
  }, [user]);

  useEffect(() => {
    loadBar();
  }, [loadBar]);

  const handleAddStory = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0] || !user) return;
    setUploading(true);
    try {
      const compressed = await compressForUpload(e.target.files[0]);
      const path = `${user.id}/stories/${Date.now()}-${compressed.name}`;
      const result = await uploadImage({ bucket: "avatars", file: compressed, path, type: "gallery" });
      await supabase.from("stories" as any).insert({ user_id: user.id, image_url: result.url } as any);
      await loadBar();
      toast({ title: "Story added!", description: "Visible for 24 hours" });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    }
    setUploading(false);
    e.target.value = "";
  };

  // Fetch a single user's active stories (oldest → newest for playback)
  const fetchStories = async (userId: string): Promise<Story[]> => {
    const { data } = await supabase
      .from("stories" as any)
      .select("id, user_id, image_url, caption, created_at, expires_at")
      .eq("user_id", userId)
      .gt("expires_at", nowIso())
      .order("created_at", { ascending: true });
    return ((data as any[]) || []) as Story[];
  };

  const markViewed = async (storyId: string, isOwn: boolean) => {
    if (!user || isOwn) return;
    await supabase
      .from("story_views" as any)
      .upsert({ story_id: storyId, viewer_id: user.id } as any, { onConflict: "story_id,viewer_id", ignoreDuplicates: true });
  };

  const openViewer = async (allGroups: ViewerGroup[], startIdx: number) => {
    if (allGroups.length === 0) return;
    setGroups(allGroups);
    setGroupIdx(startIdx);
    const stories = await fetchStories(allGroups[startIdx].userId);
    if (stories.length === 0) return;
    setGroupStories(stories);
    setStoryIdx(0);
    setViewerOpen(true);
  };

  // Load stories whenever the active group changes (after the first open)
  useEffect(() => {
    if (!viewerOpen) return;
    const g = groups[groupIdx];
    if (!g) return;
    let cancelled = false;
    fetchStories(g.userId).then((s) => {
      if (cancelled) return;
      if (s.length === 0) {
        // no active stories for this group — skip forward
        if (groupIdx < groups.length - 1) setGroupIdx((i) => i + 1);
        else setViewerOpen(false);
        return;
      }
      setGroupStories(s);
      setStoryIdx(0);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupIdx]);

  const currentGroup = groups[groupIdx];
  const currentStory = groupStories[storyIdx];

  // Mark current story viewed as it displays
  useEffect(() => {
    if (viewerOpen && currentStory && currentGroup) {
      markViewed(currentStory.id, currentGroup.isOwn);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerOpen, currentStory?.id]);

  const closeViewer = useCallback(() => {
    setViewerOpen(false);
    setGroups([]);
    setGroupStories([]);
    setGroupIdx(0);
    setStoryIdx(0);
    loadBar(); // refresh rings (seen state)
  }, [loadBar]);

  const advance = useCallback(() => {
    if (storyIdx < groupStories.length - 1) {
      setStoryIdx((i) => i + 1);
    } else if (groupIdx < groups.length - 1) {
      setGroupIdx((i) => i + 1);
    } else {
      closeViewer();
    }
  }, [storyIdx, groupStories.length, groupIdx, groups.length, closeViewer]);

  const goBack = useCallback(() => {
    if (storyIdx > 0) {
      setStoryIdx((i) => i - 1);
    } else if (groupIdx > 0) {
      setGroupIdx((i) => i - 1);
    }
  }, [storyIdx, groupIdx]);

  const handleDeleteOwn = async () => {
    if (!user || deleting || !currentStory) return;
    setDeleting(true);
    try {
      await supabase.from("stories" as any).delete().eq("id", currentStory.id);
      toast({ title: "Story removed" });
      closeViewer();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
    setDeleting(false);
  };

  // Build the ordered list of "other" groups from the bar (for continuous playback)
  const barGroups: ViewerGroup[] = bar.map((b) => ({
    userId: b.user_id,
    name: b.is_official ? "50mm Retina World" : (b.full_name || "Photographer"),
    avatar: b.avatar_url,
    isOfficial: b.is_official,
    isOwn: false,
  }));

  const openOwn = () => {
    if (ownStories.length === 0) { fileInputRef.current?.click(); return; }
    openViewer([{ userId: user!.id, name: "Your Story", avatar: null, isOfficial: false, isOwn: true }], 0);
  };

  const hasAnything = ownStories.length > 0 || bar.length > 0;
  // Always render (the "Your Story" add bubble is a persistent entry point)
  if (!user) return null;

  return (
    <>
      <div className="mb-4 md:mb-6">
        <div className="flex items-center gap-3.5 overflow-x-auto pb-2 scrollbar-hide px-1">
          {/* Your Story */}
          <button onClick={openOwn} className="flex-shrink-0 flex flex-col items-center gap-1.5 group">
            <div className={`relative h-16 w-16 sm:h-[72px] sm:w-[72px] rounded-full p-0.5 ${ownStories.length > 0 ? "bg-gradient-to-tr from-primary via-primary/60 to-accent" : "bg-transparent"}`}>
              <div className={`w-full h-full rounded-full overflow-hidden border-2 border-background bg-muted flex items-center justify-center ${ownStories.length > 0 ? "" : "border-dashed border-primary/40 group-hover:border-primary"}`}>
                {uploading ? (
                  <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                ) : ownStories.length > 0 ? (
                  <img loading="lazy" decoding="async" src={ownStories[0].image_url} alt="Your story" className="w-full h-full object-cover" />
                ) : (
                  <Plus className="h-5 w-5 text-primary/70 group-hover:text-primary" />
                )}
              </div>
              {ownStories.length > 0 && (
                <span
                  onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                  className="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center border-2 border-background cursor-pointer"
                >
                  <Plus className="h-3 w-3" />
                </span>
              )}
            </div>
            <span className="text-[9px] tracking-[0.05em] text-muted-foreground truncate max-w-[64px]" style={headingFont}>Your Story</span>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAddStory} />
          </button>

          {/* Official + followed users with active stories */}
          {bar.map((b, i) => (
            <button
              key={b.user_id}
              onClick={() => openViewer(barGroups, i)}
              className="flex-shrink-0 flex flex-col items-center gap-1.5 group"
            >
              <div className={`relative h-16 w-16 sm:h-[72px] sm:w-[72px] rounded-full p-0.5 ${b.has_unseen ? "bg-gradient-to-tr from-primary via-accent to-amber-500" : "bg-muted-foreground/25"}`}>
                <div className="w-full h-full rounded-full overflow-hidden border-2 border-background bg-muted">
                  {b.avatar_url ? (
                    <img loading="lazy" decoding="async" src={b.avatar_url} alt={b.full_name || "Story"} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-muted" />
                  )}
                </div>
                {b.is_official && (
                  <span className="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center border-2 border-background">
                    <Star className="h-2.5 w-2.5" fill="currentColor" />
                  </span>
                )}
              </div>
              <span className="text-[9px] tracking-[0.05em] text-muted-foreground truncate max-w-[64px]" style={headingFont}>
                {b.is_official ? "50mm Retina" : (b.full_name || "Photographer")}
              </span>
            </button>
          ))}
        </div>
        {!hasAnything && (
          <p className="text-[10px] text-muted-foreground/60 px-1 -mt-1" style={headingFont}>
            Share a story — it stays visible for 24 hours.
          </p>
        )}
      </div>

      {/* ── Full-screen story viewer ── */}
      <AnimatePresence>
        {viewerOpen && currentStory && currentGroup && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-black/95 flex items-center justify-center"
          >
            {/* Progress bars */}
            <div className="absolute top-3 left-3 right-3 z-20 flex gap-1">
              {groupStories.map((s, i) => (
                <div key={s.id} className="flex-1 h-0.5 bg-white/30 rounded-full overflow-hidden">
                  {i < storyIdx ? (
                    <div className="h-full w-full bg-white" />
                  ) : i === storyIdx ? (
                    <motion.div
                      key={`${currentGroup.userId}-${s.id}`}
                      className="h-full bg-white"
                      initial={{ width: "0%" }}
                      animate={{ width: "100%" }}
                      transition={{ duration: STORY_MS / 1000, ease: "linear" }}
                      onAnimationComplete={advance}
                    />
                  ) : null}
                </div>
              ))}
            </div>

            {/* Header */}
            <div className="absolute top-6 left-3 right-3 z-20 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full overflow-hidden border border-white/40 bg-muted">
                  {currentGroup.avatar ? (
                    <img src={currentGroup.avatar} alt={currentGroup.name} className="w-full h-full object-cover" />
                  ) : <div className="w-full h-full bg-muted" />}
                </div>
                <span className="text-white text-xs font-medium flex items-center gap-1" style={headingFont}>
                  {currentGroup.name}
                  {currentGroup.isOfficial && <Star className="h-3 w-3 text-primary" fill="currentColor" />}
                </span>
                <span className="text-white/50 text-[10px]">
                  {new Date(currentStory.created_at).toLocaleDateString("en", { hour: "numeric", minute: "2-digit" }).split(",").slice(-1)[0]}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {currentGroup.isOwn && (
                  <button onClick={handleDeleteOwn} disabled={deleting} className="text-white/80 hover:text-red-400">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
                <button onClick={closeViewer} className="text-white/80 hover:text-white">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Image */}
            <img
              key={currentStory.id}
              src={currentStory.image_url}
              alt="Story"
              className="max-h-[92vh] max-w-[100vw] sm:max-w-[440px] object-contain select-none"
              draggable={false}
            />

            {/* Caption */}
            {currentStory.caption && (
              <div className="absolute bottom-8 left-4 right-4 z-20 text-center">
                <p className="text-white text-sm inline-block bg-black/40 rounded-lg px-3 py-1.5" style={headingFont}>
                  {currentStory.caption}
                </p>
              </div>
            )}

            {/* Tap zones: left = back, right = forward */}
            <button aria-label="Previous" onClick={goBack} className="absolute left-0 top-0 bottom-0 w-1/3 z-10" />
            <button aria-label="Next" onClick={advance} className="absolute right-0 top-0 bottom-0 w-1/3 z-10" />

            {/* Desktop arrows */}
            <button onClick={goBack} className="hidden sm:flex absolute left-4 top-1/2 -translate-y-1/2 z-20 h-9 w-9 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button onClick={advance} className="hidden sm:flex absolute right-4 top-1/2 -translate-y-1/2 z-20 h-9 w-9 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white">
              <ChevronRight className="h-5 w-5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default FeedStoriesBar;
