import { useParams, Link } from "react-router-dom";
import { useEffect, useState, useCallback } from "react";
import { Hash, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchProfileMap } from "@/lib/profileMapCache";
import { useAuth } from "@/hooks/core/useAuth";
import RichContentRenderer from "@/components/RichContentRenderer";
import FacebookPhotoGrid from "@/components/FacebookPhotoGrid";
import { getAdminIds, resolveName, resolveBadges } from "@/lib/adminBrand";
import UserIdentityBlock from "@/components/UserIdentityBlock";
import PageSEO from "@/components/PageSEO";

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };

interface HashPost {
  id: string;
  user_id: string;
  content: string;
  image_url: string | null;
  image_urls: string[];
  created_at: string;
  author_name: string | null;
  author_avatar: string | null;
  author_badges: string[];
}

const HashtagFeed = () => {
  const { tag } = useParams<{ tag: string }>();
  const { user } = useAuth();
  const [posts, setPosts] = useState<HashPost[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPosts = useCallback(async () => {
    if (!tag) return;
    setLoading(true);

    // BUG-087: sanitize the URL-supplied tag to the hashtag charset — this both
    // prevents PostgREST .or() filter injection and normalizes matching. Use a
    // single parameterized ilike (value is not interpolated into filter syntax)
    // that catches the tag anywhere, not only when followed by a space/end.
    const safeTag = (tag || "").replace(/[^a-zA-Z0-9_]/g, "");
    if (!safeTag) {
      setPosts([]);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("posts")
      .select("*")
      .ilike("content", `%#${safeTag}%`)
      .eq("privacy", "public")
      .order("created_at", { ascending: false })
      .limit(50);

    if (!data || data.length === 0) {
      setPosts([]);
      setLoading(false);
      return;
    }

    const authorIds = [...new Set(data.map((p) => p.user_id))];
    const [profileMap, adminIds] = await Promise.all([
      fetchProfileMap(authorIds),
      getAdminIds(),
    ]);

    setPosts(
      data.map((p) => ({
        ...p,
        image_urls: (p as any).image_urls || (p.image_url ? [p.image_url] : []),
        author_name: resolveName(p.user_id, profileMap.get(p.user_id)?.full_name ?? null, adminIds),
        author_avatar: profileMap.get(p.user_id)?.avatar_url || null,
        author_badges: resolveBadges(p.user_id, profileMap.get(p.user_id)?.badges || [], adminIds),
      }))
    );
    setLoading(false);
  }, [tag]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d`;
    return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <div className="py-3 md:py-14 max-w-2xl mx-auto">
      <PageSEO
        title={`#${tag || "hashtag"}`}
        description={`Browse posts tagged #${tag || ""} on 50mm Retina World.`}
      />

      <div className="flex items-center gap-3 mb-4 md:mb-8">
        <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-primary/10 flex items-center justify-center">
          <Hash className="h-5 w-5 md:h-6 md:w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground" style={headingFont}>#{tag}</h1>
          <p className="text-xs md:text-sm text-muted-foreground" style={bodyFont}>
            {loading ? "Searching..." : `${posts.length} public post${posts.length !== 1 ? "s" : ""}`}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16">
          <span className="text-xs tracking-[0.3em] uppercase text-muted-foreground animate-pulse" style={headingFont}>
            Loading...
          </span>
        </div>
      ) : posts.length === 0 ? (
        <div className="border border-dashed border-border p-12 text-center rounded-lg">
          <Hash className="h-8 w-8 text-muted-foreground/20 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground" style={bodyFont}>No public posts found with #{tag}</p>
          <Link to="/feed" className="inline-flex items-center gap-1.5 mt-4 text-sm text-primary hover:underline">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to feed
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {posts.map((post) => (
            <div key={post.id} className="bg-card rounded-lg shadow-sm border border-border overflow-hidden">
              {/* Header */}
              <div className="flex items-center gap-3 p-4 pb-2">
                <Link to={`/profile/${post.user_id}`} className="shrink-0">
                  {post.author_avatar ? (
                    <img referrerPolicy="no-referrer" loading="lazy" decoding="async" src={post.author_avatar} alt="" className="w-10 h-10 rounded-full object-cover" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground">
                      {(post.author_name || "?")[0]?.toUpperCase()}
                    </div>
                  )}
                </Link>
                <div>
                  <UserIdentityBlock
                    userId={post.user_id}
                    name={post.author_name || "Photographer"}
                    linkTo={`/profile/${post.user_id}`}
                    nameClassName="text-sm font-semibold text-foreground hover:underline"
                  />
                  <span className="text-xs text-muted-foreground">{timeAgo(post.created_at)}</span>
                </div>
              </div>

              {/* Content */}
              {post.content && (
                <div className="px-4 pb-2">
                  <p className="text-[15px] leading-[1.4] whitespace-pre-wrap">
                    <RichContentRenderer content={post.content} />
                  </p>
                </div>
              )}

              {/* Images */}
              {post.image_urls.length > 0 && (
                <FacebookPhotoGrid urls={post.image_urls} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default HashtagFeed;
