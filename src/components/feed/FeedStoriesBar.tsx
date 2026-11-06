import { memberPhotoSrc } from "@/lib/photoProtection";
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Plus } from "lucide-react";
import { useAuth } from "@/hooks/core/useAuth";
import { toast } from "@/hooks/core/use-toast";
import { useProfileCore } from "@/hooks/profile/useProfileData";
import { timedRpc } from "@/lib/logger";
import OptimizedImage from "@/components/OptimizedImage";
import { fetchProfileMap } from "@/lib/profileMapCache";
import {
  addPhotoStory, fetchStoryBar, fetchUserStories, type StoryBarUser, type StoryPerson, type StoryRow,
} from "@/lib/stories/storyData";

/**
 * STORIES v2 — the feed's story row (Owner, 6 Nov 2026: "No Round … Make it
 * square corner rounded but show image category don't hide that").
 *
 * Under the category tabs (unchanged), one SQUARE tile with rounded corners
 * per person: the newest story's PHOTO, the person's face small in the corner,
 * a coloured border while unseen and grey once seen. "Your Story" first, with
 * a + to add a photo story. Tapping opens the one StoryViewer.
 *
 * Approved screen: _control/out/OWNER/stories-sample/approved-2026-11-06/new-1-feed-phone.png
 * — sizes and spacing are copied from it; change them only with a new yes.
 */
const headingFont = { fontFamily: "var(--font-heading)" };

// The viewer loads only when a story is opened (P13 entry-bundle ceiling).
const StoryViewer = lazy(() => import("@/components/stories/StoryViewer"));

const FeedStoriesBar = () => {
  const { user } = useAuth();
  const { data: me } = useProfileCore(user?.id);
  const [bar, setBar] = useState<StoryBarUser[]>([]);
  const [ownStories, setOwnStories] = useState<StoryRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [open, setOpen] = useState<{ people: StoryPerson[]; start: number; storyId?: string } | null>(null);
  const [params, setParams] = useSearchParams();
  const linkedStory = params.get("story");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadBar = useCallback(async () => {
    if (!user) return;
    const [b, own] = await Promise.all([
      timedRpc("rpc.get_feed_stories_bar", "src/components/feed/FeedStoriesBar.tsx", () => fetchStoryBar()).catch(() => []),
      fetchUserStories(user.id).catch(() => []),
    ]);
    setBar(b);
    setOwnStories(own);
  }, [user]);

  useEffect(() => {
    void loadBar();
  }, [loadBar]);

  // A bell / push link: /feed?story=<id> opens that story in the viewer.
  useEffect(() => {
    if (!user || !linkedStory) return;
    let gone = false;
    void (async () => {
      const { data } = await supabase.from("stories" as never).select("user_id").eq("id", linkedStory).maybeSingle();
      const owner = (data as { user_id: string } | null)?.user_id;
      if (gone) return;
      if (!owner) {
        toast({ title: "This story has ended", description: "Stories stay for 24 hours." });
        setParams((p) => { p.delete("story"); return p; }, { replace: true });
        return;
      }
      const isOwn = owner === user.id;
      let name = "Photographer";
      let avatar: string | null = null;
      if (isOwn) { name = "Your story"; avatar = me?.avatar_url ?? null; }
      else {
        // the shared profile cache (name + face + handle, usually already loaded)
        const pr = (await fetchProfileMap([owner])).get(owner);
        name = pr?.full_name || name;
        avatar = pr?.avatar_url ?? null;
      }
      if (!gone) setOpen({ people: [{ userId: owner, name, avatar, cover: null, isOwn }], start: 0, storyId: linkedStory });
    })();
    return () => { gone = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, linkedStory]);

  const handleAddStory = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploading(true);
    try {
      await addPhotoStory(user.id, file);
      await loadBar();
      toast({ title: "Story added!", description: "Visible for 24 hours" });
    } catch (err) {
      toast({ title: "Upload failed", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
    }
    setUploading(false);
    e.target.value = "";
  };

  const people: StoryPerson[] = bar.map((b) => ({
    userId: b.user_id,
    name: b.is_official ? "50mm Retina World" : (b.full_name || "Photographer"),
    avatar: b.avatar_url,
    cover: b.cover_url,
    isOwn: false,
  }));

  const ownCover = ownStories.length > 0
    ? (ownStories[0].thumbs[0] ?? ownStories[0].media[0] ?? null)
    : null;

  const openOwn = () => {
    if (!user) return;
    if (ownStories.length === 0) { fileInputRef.current?.click(); return; }
    setOpen({ people: [{ userId: user.id, name: "Your story", avatar: me?.avatar_url ?? null, cover: ownCover, isOwn: true }], start: 0 });
  };

  const closeViewer = useCallback(() => {
    setOpen(null);
    if (linkedStory) setParams((p) => { p.delete("story"); return p; }, { replace: true });
    void loadBar(); // seen state, deletes
  }, [loadBar, linkedStory, setParams]);

  const hasAnything = ownStories.length > 0 || bar.length > 0;
  // Always render (the "Your Story" add tile is a persistent entry point)
  if (!user) return null;

  return (
    <>
      <div className="mb-4 md:mb-6">
        <div className="flex items-center gap-3.5 overflow-x-auto pb-2 scrollbar-hide px-1">
          <button onClick={openOwn} className="flex-shrink-0 flex flex-col items-center gap-1.5 group">
            <div className={`relative h-[88px] w-[88px] rounded-[18px] p-[3px] ${ownStories.length > 0 ? "bg-gradient-to-tr from-primary via-primary/60 to-accent" : "bg-transparent"}`}>
              <div className={`w-full h-full rounded-[15px] overflow-hidden border-2 border-background bg-muted flex items-center justify-center ${ownStories.length > 0 ? "" : "border-dashed border-primary/40 group-hover:border-primary"}`}>
                {uploading ? (
                  <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                ) : ownCover ? (
                  <OptimizedImage src={memberPhotoSrc(ownCover, 320) ?? ownCover} alt="Your story" className="w-full h-full object-cover" />
                ) : (
                  <Plus className="h-5 w-5 text-primary/70 group-hover:text-primary" />
                )}
              </div>
              {ownStories.length > 0 && (
                <span
                  onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                  className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center border-2 border-background cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                </span>
              )}
            </div>
            <span className="text-[10px] tracking-[0.05em] text-muted-foreground truncate max-w-[80px]" style={headingFont}>Your Story</span>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAddStory} />
          </button>

          {bar.map((b, i) => (
            <button
              key={b.user_id}
              onClick={() => setOpen({ people, start: i })}
              className="flex-shrink-0 flex flex-col items-center gap-1.5 group"
            >
              <div className={`relative h-[88px] w-[88px] rounded-[18px] p-[3px] ${b.has_unseen ? "bg-gradient-to-tr from-primary via-accent to-amber-500" : "bg-muted-foreground/25"}`}>
                <div className="w-full h-full rounded-[15px] overflow-hidden border-2 border-background bg-muted">
                  {(b.cover_url || b.avatar_url) && (
                    <OptimizedImage src={memberPhotoSrc(b.cover_url, 320) ?? b.avatar_url ?? ""} alt={b.full_name || "Story"} className="w-full h-full object-cover" />
                  )}
                </div>
                {b.avatar_url && <OptimizedImage src={b.avatar_url} alt="" className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full border-2 border-background object-cover" />}
              </div>
              <span className="text-[10px] tracking-[0.05em] text-muted-foreground truncate max-w-[80px]" style={headingFont}>
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

      {open && (
        <Suspense fallback={null}>
          <StoryViewer people={open.people} startIndex={open.start} startStoryId={open.storyId} viewerId={user.id} onClose={closeViewer} onChanged={() => void loadBar()} />
        </Suspense>
      )}
    </>
  );
};

export default FeedStoriesBar;
