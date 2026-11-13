/**
 * TRENDING THIS WEEK — THE ONE CARD (Owner 13 Nov 2026: "Web and App will be
 * same card showing"). Every place that shows Trending draws THIS component:
 *
 *   variant "sidebar"  the computer's left column (≥ 1280 px, 256 px wide)
 *   variant "feed"     the phone, the app and narrow screens: one card in the
 *                      feed (FEED_INSERTS.trending), the full width of a post —
 *                      edge to edge below 768 px (bleed-phone), the 590 px
 *                      column above
 *
 * Content is decided by the database (get_trending_week, 20261113_0600): the
 * ONE admin-marked video (the feed's own player: sound off, on loop, pauses
 * off screen / under a full screen), else EXACTLY 4 photos, else nothing.
 * Only sizes differ between the variants; what is shown never does.
 */
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp } from "lucide-react";
import { memberPhotoSrc } from "@/lib/photoProtection";
import { postPath } from "@/lib/posts/postPath";
import { postMedia } from "@/lib/posts/subjectMedia";
import { fetchPostVideoMap } from "@/lib/video/postVideoRead";
import FeedVideoCard from "@/components/video/FeedVideoCard";
import { useT } from "@/i18n/I18nContext";
import type { TrendingWeek } from "@/hooks/feed/useTrendingWeek";

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };

type Variant = "sidebar" | "feed";

function TrendingVideo({ postId, variant }: { postId: string; variant: Variant }) {
  const { data: video } = useQuery({
    queryKey: ["trending-week-video", postId],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const v = (await fetchPostVideoMap([postId])).get(postId);
      return v && v !== "hidden" ? v : null;
    },
  });
  // the one media decision every video surface takes (subjectMedia)
  const media = postMedia({ video: video ?? null, image_urls: [] });
  return (
    <div className={variant === "sidebar" ? "p-2" : ""} data-testid="trending-video">
      <div className={`relative aspect-[4/5] overflow-hidden bg-black ${variant === "sidebar" ? "rounded-sm" : ""}`}>
        {media.video && <FeedVideoCard video={media.video} fillParent className="h-full w-full" startMuted />}
      </div>
      <Link to={postPath(postId)}
        className={`inline-flex items-center text-primary hover:underline ${variant === "sidebar" ? "mt-1.5 min-h-[24px] text-[10px]" : "min-h-[44px] px-3 text-sm font-semibold"}`}>
        Open post →
      </Link>
    </div>
  );
}

export function TrendingWeekCard({ variant, data, loading }: { variant: Variant; data: TrendingWeek | null; loading: boolean }) {
  const t = useT();
  const video = data?.video ?? null;
  const photos = data?.photos ?? [];
  // the feed never shows an empty card: nothing to show = no card at all
  if (variant === "feed" && !video && photos.length !== 4) return null;
  const side = variant === "sidebar";
  const gap = side ? "gap-1 p-2" : "gap-0.5";

  return (
    <section
      aria-label={t("sidebar.trending")}
      data-testid={`trending-card-${variant}`}
      className={side ? "border border-border bg-card/50 rounded-sm" : "bleed-phone overflow-hidden bg-card md:rounded-lg md:border md:border-border mb-4"}
    >
      <div className={side ? "px-4 py-3 border-b border-border" : "px-3 py-2.5"}>
        <span className={`uppercase text-primary flex items-center gap-1.5 ${side ? "text-[9px] tracking-[0.3em]" : "text-xs tracking-[0.2em] font-semibold"}`} style={headingFont}>
          <TrendingUp className={side ? "h-3 w-3" : "h-4 w-4"} />
          {t("sidebar.trending")}
        </span>
      </div>
      {video ? (
        <TrendingVideo postId={video.post_id} variant={variant} />
      ) : photos.length === 4 ? (
        <div className={`grid grid-cols-2 ${gap}`} data-testid="trending-photos">
          {photos.map((photo) => (
            <Link
              key={photo.id}
              to={postPath(photo.id)}
              aria-label={photo.title ? `Open ${photo.title}` : "Open trending photograph"}
              className={`relative group aspect-square overflow-hidden block focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${side ? "rounded-sm" : ""}`}
            >
              <img src={memberPhotoSrc(photo.image_url, side ? 320 : 600) ?? undefined} alt={photo.title || "Trending photograph"}
                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" loading="lazy" decoding="async" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="absolute bottom-1 left-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <p className="text-[8px] text-white truncate" style={headingFont}>{photo.title}</p>
                <span className="text-[7px] text-white/70" style={bodyFont}>❤️ {photo.reaction_count}</span>
              </div>
            </Link>
          ))}
        </div>
      ) : loading ? (
        <div className={`grid grid-cols-2 ${gap}`} aria-hidden="true">
          {[0, 1, 2, 3].map((i) => <div key={i} className="aspect-square rounded-sm bg-muted animate-pulse" />)}
        </div>
      ) : (
        <div className="p-4 text-center">
          <p className="text-[10px] text-muted-foreground" style={bodyFont}>No trending photos this week</p>
        </div>
      )}
    </section>
  );
}
