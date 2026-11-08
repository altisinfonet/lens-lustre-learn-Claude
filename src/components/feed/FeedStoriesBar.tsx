import { memberPhotoSrc } from "@/lib/photoProtection";
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Plus } from "lucide-react";
import { useAuth } from "@/hooks/core/useAuth";
import { toast } from "@/hooks/core/use-toast";
import { useProfileCore } from "@/hooks/profile/useProfileData";
import { timedRpc } from "@/lib/logger";
import OptimizedImage from "@/components/OptimizedImage";
import { StoryTile, STORY_TILE_LABEL } from "@/components/stories/StoryTile";
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
 * a blue → gold border while unseen and grey once seen. The member's own tile
 * first, with a + to add a photo story. Tapping opens the one StoryViewer.
 *
 * Approved screen: _control/out/OWNER/stories-sample/approved-2026-11-06/new-1-feed-phone.png
 * — sizes and spacing are copied from it; change them only with a new yes.
 * Owner, 7 Nov 2026: no "Your Story" name and no "Share a story…" line under
 * the own tile; border "blue gold". A story has its own address,
 * /<handle>/stories/<id> (and /stories/<id> from the bell), which opens it here.
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
  // /<handle>/stories/<id> or /stories/<id> (route) — or the older /feed?story=<id>
  const { storyId: routeStory } = useParams<{ storyId?: string }>();
  const navigate = useNavigate();
  const linkedStory = routeStory ?? params.get("story");
  /** Leave a story address for the plain feed once the linked story is closed or gone. */
  const clearLink = useCallback(() => {
    if (routeStory) navigate("/feed", { replace: true });
    else setParams((p) => { p.delete("story"); return p; }, { replace: true });
  }, [routeStory, navigate, setParams]);
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
        clearLink();
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
    if (linkedStory) clearLink();
    void loadBar(); // seen state, deletes
  }, [loadBar, linkedStory, clearLink]);

  // Always render (the own tile is a persistent entry point)
  if (!user) return null;

  return (
    <>
      <div className="md:mb-6">
        {/* items-start: the own tile has no name under it (Owner 7 Nov), so the
            squares line up along their top edge, not their middles. */}
        <div className="flex items-start gap-3.5 overflow-x-auto pb-1 md:pb-2 scrollbar-hide px-1">
          <button onClick={openOwn} aria-label="Your story" className="flex-shrink-0 flex flex-col items-center gap-1.5 group">
            <StoryTile
              ring={ownStories.length > 0 ? "unseen" : "none"}
              dashed={ownStories.length === 0}
              cover={!uploading && ownCover ? (memberPhotoSrc(ownCover, 320) ?? ownCover) : null}
              alt="Your story"
              center={uploading
                ? <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                : <Plus className="h-5 w-5 text-primary/70 group-hover:text-primary" />}
              corner={ownStories.length > 0 && (
                <span
                  onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                  className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center border-2 border-background cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                </span>
              )}
            />
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAddStory} />
          </button>

          {bar.map((b, i) => (
            <button
              key={b.user_id}
              onClick={() => setOpen({ people, start: i })}
              className="flex-shrink-0 flex flex-col items-center gap-1.5 group"
            >
              <StoryTile
                ring={b.has_unseen ? "unseen" : "seen"}
                cover={memberPhotoSrc(b.cover_url, 320) ?? b.avatar_url}
                alt={b.full_name || "Story"}
                corner={b.avatar_url && <OptimizedImage src={b.avatar_url} alt="" className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full border-2 border-background object-cover" />}
              />
              <span className={STORY_TILE_LABEL} style={headingFont}>
                {b.is_official ? "50mm Retina" : (b.full_name || "Photographer")}
              </span>
            </button>
          ))}
        </div>
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
