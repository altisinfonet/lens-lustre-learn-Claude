/**
 * STORIES v2.2 — "My Stories" (Owner, 7 Nov 2026: "My stories will be a
 * separate menu under My Content, all posts can be seen within 24 hours").
 *
 * The member's own live stories (the last 24 hours) as square tiles, newest
 * first, each with seen · likes · comments and the time left. Tapping one
 * opens the ONE StoryViewer on it (with Seen by / All comments / Highlight /
 * Delete). Data: the one story data layer (get_user_stories, own id).
 */
import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Eye, Heart, MessageCircle, Clock } from "lucide-react";
import PageSEO from "@/components/PageSEO";
import OptimizedImage from "@/components/OptimizedImage";
import { useAuth } from "@/hooks/core/useAuth";
import { useProfileCore } from "@/hooks/profile/useProfileData";
import { memberPhotoSrc } from "@/lib/photoProtection";
import { fetchUserStories, type StoryRow } from "@/lib/stories/storyData";

const StoryViewer = lazy(() => import("@/components/stories/StoryViewer"));
const headingFont = { fontFamily: "var(--font-heading)" };

/** "5h left" / "40m left" until the story goes. */
export function timeLeft(expiresAt: string, now = Date.now()): string {
  const m = Math.max(0, Math.round((new Date(expiresAt).getTime() - now) / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h left` : `${m}m left`;
}

export default function MyStories() {
  const { user } = useAuth();
  const { data: me } = useProfileCore(user?.id);
  const [stories, setStories] = useState<StoryRow[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try { setStories([...(await fetchUserStories(user.id))].reverse()); } catch { setStories([]); }
  }, [user]);
  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <PageSEO title="My Stories" description="Your stories from the last 24 hours" />
      <div className="max-w-5xl mx-auto py-6 px-4">
        <h1 className="text-xl font-bold" style={headingFont}>My Stories</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your stories from the last 24 hours.</p>

        {stories === null ? (
          <p className="mt-8 text-sm text-muted-foreground">Loading…</p>
        ) : stories.length === 0 ? (
          <div className="mt-8 rounded-xl border border-border p-6 text-center">
            <p className="text-sm text-muted-foreground">You have no stories in the last 24 hours.</p>
            <Link to="/feed" className="mt-3 inline-block text-sm font-semibold text-primary">Share one from the feed</Link>
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4" data-testid="my-stories-grid">
            {stories.map((s) => {
              const cover = s.thumbs[0] ?? s.media[0] ?? null;
              return (
                <button key={s.id} type="button" onClick={() => setOpenId(s.id)}
                  className="group relative aspect-[9/16] overflow-hidden rounded-[18px] bg-muted text-left">
                  {cover && (
                    <OptimizedImage src={memberPhotoSrc(cover, 600) ?? cover} alt="Story" className="absolute inset-0 h-full w-full object-cover" />
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 pt-10 text-white">
                    <span className="flex items-center gap-1 text-xs"><Clock className="h-3.5 w-3.5" />{timeLeft(s.expires_at)}</span>
                    <span className="mt-1.5 flex items-center gap-3 text-xs font-semibold">
                      <span className="flex items-center gap-1"><Eye className="h-3.5 w-3.5" />{s.view_count ?? 0}</span>
                      <span className="flex items-center gap-1"><Heart className="h-3.5 w-3.5" />{s.like_count}</span>
                      <span className="flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" />{s.comment_count}</span>
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {openId && user && (
        <Suspense fallback={null}>
          <StoryViewer
            people={[{ userId: user.id, name: "Your story", avatar: me?.avatar_url ?? null, cover: null, isOwn: true }]}
            startIndex={0}
            startStoryId={openId}
            viewerId={user.id}
            onClose={() => { setOpenId(null); void load(); }}
            onChanged={() => void load()}
          />
        </Suspense>
      )}
    </>
  );
}
