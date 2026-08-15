/**
 * THE PROFILE GRID — three across, square, tight.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OWNER REQUEST, 2026-08-15: an Instagram-style profile grid, because
 * "People are loosing interest from 50mm for multiple loop whole and not like
 * experince like Instagram". Re-asked on the same day: "3 column like insta on
 * Profle / my wall".
 *
 * WHY GRID IS THE DEFAULT, and it is a measurement not a preference:
 * every one of the 210 posts on production carries at least one photograph —
 * text-only posts: 0. On a platform where a post IS a photograph, the feed card
 * spends most of a phone screen on the frame around the picture: avatar, name,
 * timestamp, caption, reaction bar. A visitor judging whether a photographer is
 * worth following has to scroll once per photograph to see three of them. The
 * grid shows nine.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * It does not replace the feed card, and the toggle is not decoration. The card
 * is where a photograph is discussed — reactions, comments, tags, sharing. The
 * grid is for scanning a body of work. Instagram keeps both for the same
 * reason, and a member who prefers reading the wall as a feed keeps that.
 *
 * TWO THINGS MEASURED ON PRODUCTION SHAPED THIS FILE
 *  1. 24 of 210 posts hold more than one photograph (up to 6). A grid that
 *     shows only the first, with nothing to say there are more, hides a quarter
 *     of the work — so multi-photo tiles carry a corner marker.
 *  2. 9 posts have NO stored thumbnail (they predate the thumbnail writer, and
 *     the backfill job is still awaiting an owner run). Those tiles fall back
 *     to the full image rather than rendering a hole. The fallback is per tile,
 *     not per grid, so eight good thumbnails are never discarded because the
 *     ninth is missing.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { memo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Images, Heart, MessageCircle } from "lucide-react";
import type { UnifiedPost } from "@/types/post";

interface Props {
  posts: UnifiedPost[];
}

/**
 * The one image a tile shows. Prefers the stored 600px thumbnail — the whole
 * point of the grid is nine small pictures rather than nine full ones — and
 * falls back to the original for the posts that have no thumbnail yet.
 *
 * NEVER derive a thumbnail address by string rule. See the note on
 * `thumbnail_urls` in src/types/post.ts: originals live on the CDN and old
 * thumbnails live on Supabase storage, and guessing broke many posts on
 * 2026-08-07.
 */
export function tileSrc(post: UnifiedPost): string | null {
  const thumb = post.thumbnail_urls?.[0];
  if (typeof thumb === "string" && thumb.length > 0) return thumb;
  return post.image_urls?.[0] ?? null;
}

const GridTile = memo(function GridTile({ post }: { post: UnifiedPost }) {
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  const src = failed ? post.image_urls?.[0] ?? null : tileSrc(post);
  const count = post.image_urls?.length ?? 0;
  const reactions = Object.values(post.reaction_counts ?? {}).reduce((a, b) => a + (b || 0), 0);

  return (
    <button
      type="button"
      onClick={() => navigate(`/post/${post.id}`)}
      // A tile is a real button, not a div with onClick: it has to be reachable
      // by keyboard and announce itself to a screen reader. The caption is the
      // only text a photograph carries, so it is the label.
      aria-label={post.content?.trim() ? post.content.trim().slice(0, 120) : "Open photograph"}
      className="group relative aspect-square overflow-hidden bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          // Per-tile fallback: one missing thumbnail must not blank the tile.
          onError={() => setFailed(true)}
          className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground/40">
          <Images className="h-6 w-6" />
        </div>
      )}

      {/* 24 of 210 posts carry more than one photograph — say so. */}
      {count > 1 && (
        <span className="absolute right-1.5 top-1.5 rounded bg-black/55 px-1 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
          <Images className="inline h-3 w-3" aria-hidden />
          <span className="sr-only">{count} photographs</span>
        </span>
      )}

      {/* Counts on hover — a pointer-only affordance, so it is hidden from
          assistive tech and never shown on touch, where there is no hover. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 hidden items-center justify-center gap-4 bg-black/40 text-sm font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100 sm:flex"
      >
        <span className="flex items-center gap-1">
          <Heart className="h-4 w-4 fill-white" /> {reactions}
        </span>
        <span className="flex items-center gap-1">
          <MessageCircle className="h-4 w-4 fill-white" /> {post.comment_count ?? 0}
        </span>
      </span>
    </button>
  );
});

const ProfilePostGrid = ({ posts }: Props) => (
  // gap-[2px] rather than a rounded card grid: the photographs are the content
  // and the gaps are only there so two dark images do not merge.
  // No AnimatePresence here on purpose — a nine-tile stagger on every page of
  // an infinite scroll is the kind of motion that reads as jank on a mid-range
  // Android, and the feed card already pays that cost once.
  <div className="grid grid-cols-3 gap-[2px] md:gap-1">
    {posts.map((post) => (
      <GridTile key={post.id} post={post} />
    ))}
  </div>
);

export default ProfilePostGrid;
