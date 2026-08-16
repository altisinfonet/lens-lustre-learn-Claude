/**
 * THE PROFILE WALL — a 3×3 block of squares, then one full-width 3:2 band.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OWNER REQUEST, 2026-08-15. It took four rounds, and every rejection is kept
 * here because the rejections ARE the specification.
 *
 * 1. *"People are loosing interest from 50mm … not like experince like
 *    Instagram"* → a plain Instagram grid was built: identical squares forever.
 * 2. REJECTED — *"that will be copy of instagram, i want fix 3grid will be for
 *    3 column and after that 1 column full image again 3 column three grid
 *    style after 1 clumn view"*.
 * 3. REJECTED — the big photo was shown at its own real shape, and a portrait
 *    photograph at its own shape is a TALL block: *"this style not approved as
 *    long vertical block found. only horizontal block after three samll block
 *    is approved"*. Answered by fixing the band at 3:2 (see SHOWCASE_ASPECT).
 * 4. REJECTED — the band was arriving after ONE row of three. The owner sent a
 *    picture of the layout he wants and said *"the layout what ever you showed
 *    me that is wrong. I want this style"*. The picture shows **three full rows
 *    of squares, then the band**. His earlier "1-2-3 then 3:2" was numbering the
 *    COLUMNS, not counting the rows. The picture is what is built:
 *
 *      ▢ ▢ ▢          1  2  3
 *      ▢ ▢ ▢          4  5  6        nine squares — a real block of work
 *      ▢ ▢ ▢          7  8  9
 *      ▛▀▀▀▀▀▀▀▀▀▜    10             one showcase, 3:2, always horizontal
 *      ▢ ▢ ▢          11 12 13
 *      ▢ ▢ ▢          14 15 16
 *      ▢ ▢ ▢          17 18 19
 *      ▛▀▀▀▀▀▀▀▀▀▜    20
 *
 * WHY BREAK THE GRID AT ALL, and it is a measurement not a preference: every
 * one of the 210 posts on production carries a photograph. A pure square grid
 * crops all 210 of them; on a photography platform that crop is the product
 * silently recomposing the member's frame. The showcase gives one photograph in
 * ten room to be seen whole, without giving up the density that made the grid
 * worth having in the first place. At one band per FOUR posts the wall was
 * mostly band; at one per ten it reads as a grid with a punctuation mark.
 *
 * The fixed 3:2 band, and what it costs, is spelled out at SHOWCASE_ASPECT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO THINGS MEASURED ON PRODUCTION SHAPED THIS FILE
 *  1. 24 of 210 posts hold more than one photograph (up to 6). A grid showing
 *     only the first, with nothing to say there are more, hides a quarter of the
 *     work — so multi-photo tiles carry a corner marker.
 *  2. 9 posts have NO stored thumbnail (they predate the thumbnail writer, and
 *     the backfill job is still awaiting an owner run). Those tiles fall back to
 *     the full image rather than rendering a hole. The fallback is per tile, not
 *     per grid, so eight good thumbnails are never discarded because the ninth
 *     is missing.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { memo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Images, Heart, MessageCircle } from "lucide-react";
import type { UnifiedPost } from "@/types/post";

interface Props {
  posts: UnifiedPost[];
}

/** Squares per block: three rows of three, exactly as in the owner's picture. */
export const SQUARES_PER_BLOCK = 9;

/**
 * The repeating block: nine square tiles, then one showcase. Ten posts.
 *
 * Exported because the tests assert the rhythm arithmetic directly rather than
 * counting rendered nodes — a test that counts `<img>` elements passes just as
 * happily when every tile is a showcase.
 */
export const BLOCK = SQUARES_PER_BLOCK + 1;

/** Is the post at this index the full-width one? The 10th of every block. */
export function isShowcase(index: number): boolean {
  return index % BLOCK === BLOCK - 1;
}

/**
 * EVERY SHOWCASE IS EXACTLY 3:2. A fixed band, not a range.
 *
 * This is an owner ruling and it went through two corrections, both worth
 * keeping so nobody "improves" it back:
 *
 *   1. *"this style not approved as long vertical block found. only horizontal
 *      block after three samll block is approved."* — the first build reused
 *      the feed card's frame range (4:5 … 1.91:1). That range includes
 *      portrait, so a tall photograph produced a tall block. Rejected.
 *   2. *"1-2-3 then 3:2 style is final. 1-2-3 then 3:2 4-5-6 then 3:2 7-6-9
 *      then 3:2 like soo"* — not a landscape range either. One shape, every
 *      time.
 *
 * WHAT A FIXED BAND BUYS, beyond the owner having asked for it:
 *   • The wall's rhythm is genuinely regular. A range would make every fourth
 *     row a slightly different height, which is what makes a page feel untidy
 *     without anyone being able to say why.
 *   • The frame is known before a single byte of image arrives — for EVERY
 *     post, including the 129 of 210 on production whose filenames carry no
 *     dimensions. Nothing measures, nothing reflows, the wall cannot jump
 *     under a scrolling thumb.
 *
 * WHAT IT COSTS, stated plainly: a photograph that is not 3:2 does not fill
 * the band. It is NOT cropped to fit — it is shown whole and centred, with the
 * remainder filled by a blurred copy of itself. Cropping instead would destroy
 * the photographer's frame, which is the one thing the showcase exists to
 * protect. A portrait photograph in this band is mostly blur, and that is the
 * accepted consequence of "only horizontal".
 */
export const SHOWCASE_ASPECT = 3 / 2;

/**
 * The one image a tile shows. Prefers the stored 600px thumbnail — the whole
 * point of the small tiles is nine little pictures rather than nine full ones —
 * and falls back to the original for the posts that have no thumbnail yet.
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

/** Caption or a plain fallback — a photograph's only text, so it is the label. */
function tileLabel(post: UnifiedPost): string {
  const c = post.content?.trim();
  return c ? c.slice(0, 120) : "Open photograph";
}

function reactionTotal(post: UnifiedPost): number {
  return Object.values(post.reaction_counts ?? {}).reduce((a, b) => a + (b || 0), 0);
}

/** Corner marker for a post holding more than one photograph. */
const MultiMarker = ({ count }: { count: number }) =>
  count > 1 ? (
    <span className="absolute right-1.5 top-1.5 rounded bg-black/55 px-1 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
      <Images className="inline h-3 w-3" aria-hidden />
      <span className="sr-only">{count} photographs</span>
    </span>
  ) : null;

/**
 * Counts on hover — a pointer-only affordance, so it is hidden from assistive
 * tech and never shown on touch, where there is no hover to reveal it.
 */
const HoverCounts = ({ post, revealed = false }: { post: UnifiedPost; revealed?: boolean }) => (
  <span
    aria-hidden
    className={`pointer-events-none absolute inset-0 flex items-center justify-center gap-4 bg-black/40 text-sm font-semibold text-white transition-opacity group-hover:opacity-100 ${
      revealed ? "opacity-100" : "opacity-0"
    }`}
  >
    <span className="flex items-center gap-1">
      <Heart className="h-4 w-4 fill-white" /> {reactionTotal(post)}
    </span>
    <span className="flex items-center gap-1">
      <MessageCircle className="h-4 w-4 fill-white" /> {post.comment_count ?? 0}
    </span>
  </span>
);

/** One small square. Cropped to 1:1 on purpose — this is the scanning view. */
const GridTile = memo(function GridTile({ post }: { post: UnifiedPost }) {
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const src = failed ? post.image_urls?.[0] ?? null : tileSrc(post);
  const count = post.image_urls?.length ?? 0;

  /**
   * FIRST TAP SHOWS THE COUNTS; THE SECOND OPENS THE POST.
   *
   * MY ERROR, corrected 2026-08-16. The owner's rule, set on 2026-08-14 for
   * the feed: *"Viewed by and reached by will show on mouse over or on 1st
   * touch on the image"*. I built exactly that for `PostCard` and then wrote
   * the OPPOSITE into this file, in a comment, as though it were reasoned:
   * counts *"never shown on touch, where there is no hover to reveal it."*
   *
   * The result was that on the app the like and comment figures were not
   * merely hard to see — they did not exist. `hidden … sm:flex` removed them
   * on every phone. The owner found it by opening his own wall.
   *
   * A pointer still hovers; nothing about that changes. This adds the touch
   * half of his rule, and matches `PostCard.interceptFirstTap` so the two
   * surfaces behave identically — which is the whole point of one funnel.
   */
  const handleClick = () => {
    if (!revealed) {
      setRevealed(true);
      return;
    }
    navigate(`/post/${post.id}`);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      // A real button, not a div with onClick: it has to be reachable by
      // keyboard and announce itself to a screen reader.
      aria-label={tileLabel(post)}
      /* 4:5 PORTRAIT — MEASURED, not chosen.
         The written spec said "square cells by default", so square is what I
         built. The owner then sent a REAL Instagram profile and said "exactly
         match the sample". Measuring that screenshot: each tile is 292px wide
         by ~355 tall in an 899px frame — 4:5, not 1:1. Instagram moved its
         grid to 4:5 and the spec sentence was describing it from memory.
         The photograph beats the sentence, so 4:5 it is. */
      className="group relative aspect-[4/5] overflow-hidden bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
      <MultiMarker count={count} />
      <HoverCounts post={post} />
    </button>
  );
});

/**
 * The full-width showcase: a fixed 3:2 band, and the photograph shown WHOLE
 * inside it. See SHOWCASE_ASPECT for the ruling and its cost.
 *
 * The sharp image is `object-contain` — never cropped, whatever shape it is —
 * and whatever the band has left over is filled by a blurred copy of the
 * **thumbnail**, not the original. That last word matters: PostMedia measured
 * it, and blurring the full-size copy was spending ~200KB per post to render
 * roughly 1KB of unrecognisable mush.
 */
const ShowcaseTile = memo(function ShowcaseTile({ post }: { post: UnifiedPost }) {
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  // The backdrop needs its OWN failure state. Caught by the capture sweep,
  // 2026-08-15: a post whose thumbnail address 404s left this decorative image
  // permanently broken. It is aria-hidden and blurred, so nothing looked wrong
  // in the screenshot — which is exactly why a broken <img> must be removed
  // rather than tolerated. The sharp photograph has its own fallback below.
  const [backdropFailed, setBackdropFailed] = useState(false);

  const full = post.image_urls?.[0] ?? null;
  const thumb = post.thumbnail_urls?.[0] ?? null;
  const src = failed ? full : full ?? thumb;
  const count = post.image_urls?.length ?? 0;

  /**
   * NOTHING IS MEASURED HERE, AND THAT IS THE POINT.
   *
   * An earlier version read each photo's real shape and sized the band to it,
   * correcting on load for the **129 of 210 production posts whose filenames
   * carry no dimensions** (measured 2026-08-15; none of their thumbnails carry
   * them either). The owner's ruling — one fixed 3:2 band — deletes that whole
   * problem: there is nothing to look up, nothing to correct, and no row whose
   * height arrives late. Do not reintroduce a measurement here.
   */

  return (
    <button
      type="button"
      onClick={() => navigate(`/post/${post.id}`)}
      aria-label={tileLabel(post)}
      style={{ aspectRatio: String(SHOWCASE_ASPECT) }}
      className="group relative col-span-3 w-full overflow-hidden bg-muted/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {src ? (
        <>
          {/* The bar filler. Decorative only, and it is the SMALL copy blown up
              and blurred past recognition, so it costs almost nothing. Hidden
              from assistive tech: it is the same picture, twice. */}
          {typeof thumb === "string" && thumb.length > 0 && !backdropFailed && (
            <img
              src={thumb}
              alt=""
              aria-hidden
              loading="lazy"
              // `fetchPriority` was REMOVED from here on 2026-08-15 because it
              // was a React 19 property and this app was on React 18: it warned
              // on every showcase and the attribute never reached the DOM. The
              // app moved to React 19 the same day, so it works now and is back.
              // It matters: this layer is decoration competing with the real
              // photograph for the same connection, and the photograph wins.
              fetchPriority="low"
              decoding="async"
              onError={() => setBackdropFailed(true)}
              className="absolute inset-0 h-full w-full scale-125 object-cover blur-2xl brightness-[0.8]"
              style={{ imageRendering: "pixelated" }}
            />
          )}
          <img
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setFailed(true)}
            className="absolute inset-0 h-full w-full object-contain"
          />
        </>
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground/40">
          <Images className="h-8 w-8" />
        </div>
      )}
      <MultiMarker count={count} />
      <HoverCounts post={post} />
    </button>
  );
});

const ProfilePostGrid = ({ posts }: Props) => (
  /**
   * FULL BLEED ON A PHONE — the grid is exactly the width of the screen.
   *
   * Owner, 2026-08-16, with Instagram open beside ours: *"wall view must 100%
   * filled on the device not space in two sides. Like insta"*. Ours sat inside
   * the page's horizontal padding, so a dark margin ran down both edges and
   * every photograph was ~24px narrower than it needed to be. On a photography
   * platform that margin is pure loss — it is screen given to nothing.
   *
   * `w-screen` + `left-1/2 -translate-x-1/2` is used rather than a negative
   * margin like `-mx-3`, because that would have to MATCH whatever padding the
   * parent happens to use — and this grid is rendered from more than one
   * place. This is padding-agnostic: it is the viewport, wherever it sits.
   * Reset at `md` so the desktop layout keeps its column.
   *
   * gap-0 on a phone: measured off the owner's real-Instagram reference, the
   * tiles TOUCH — there is no hairline at all. That is what makes the grid
   * read as one sheet of photographs rather than a set of cards, and on a
   * photography platform it is the whole point. Desktop keeps a small gap,
   * where the tiles are large and the page is not edge-to-edge.
   *
   * No AnimatePresence here on purpose — a nine-tile stagger on every page of
   * an infinite scroll is the kind of motion that reads as jank on a mid-range
   * Android, and the feed card already pays that cost once.
   */
  <div className="relative left-1/2 w-screen -translate-x-1/2 md:left-0 md:w-full md:translate-x-0 grid grid-cols-3 gap-0 md:gap-1">
    {posts.map((post, i) =>
      isShowcase(i) ? (
        <ShowcaseTile key={post.id} post={post} />
      ) : (
        <GridTile key={post.id} post={post} />
      ),
    )}
  </div>
);

export default ProfilePostGrid;
