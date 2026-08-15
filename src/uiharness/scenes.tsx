/**
 * The scene list. Each entry mounts ONE piece of UI with fixed, invented data.
 *
 * RULES FOR A SCENE, learned the moment the first one was written:
 *  • No network, no auth, no Supabase. A scene that needs data gets it from a
 *    literal in this file.
 *  • No `Math.random()`, no `new Date()` without a fixed argument. Two runs of
 *    the same scene must produce the same pixels, or the screenshots cannot be
 *    compared to each other.
 *  • Cover the states that actually break, not just the happy one: empty, one
 *    item, many items, a very long caption, a missing image. Those are the
 *    screenshots worth looking at.
 */

import { useState, type JSX } from "react";
import ProfilePostGrid from "@/components/profile/ProfilePostGrid";
import WallViewToggle, { type WallView } from "@/components/profile/WallViewToggle";
import type { UnifiedPost } from "@/types/post";

/** A deterministic stand-in image, so a scene never depends on the network. */
export function swatch(seed: number, label = ""): string {
  const hue = (seed * 37) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="hsl(${hue} 30% 32%)"/>
      <stop offset="100%" stop-color="hsl(${(hue + 40) % 360} 26% 18%)"/>
    </linearGradient></defs>
    <rect width="600" height="600" fill="url(#g)"/>
    ${label ? `<text x="300" y="320" font-family="sans-serif" font-size="72" font-weight="700"
        fill="rgba(255,255,255,.55)" text-anchor="middle">${label}</text>` : ""}
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * A wall post shaped exactly like the real one, with only the fields the grid
 * reads filled in honestly. `overrides` is where each scene states the ONE
 * thing it is testing, so a reader can see the difference rather than diff two
 * literals.
 */
function post(i: number, overrides: Partial<UnifiedPost> = {}): UnifiedPost {
  const url = swatch(i, String(i + 1));
  return {
    id: `post-${i}`,
    user_id: "u1",
    content: "",
    image_url: url,
    image_urls: [url],
    thumbnail_urls: [url],
    privacy: "public",
    created_at: "2026-08-01T09:00:00.000Z",
    author_name: "Avijit Sheel",
    author_avatar: null,
    like_count: 0,
    comment_count: 3,
    share_count: 0,
    is_liked: false,
    user_reaction: null,
    top_reactions: [],
    reaction_counts: { like: 12 },
    ...overrides,
  };
}

/**
 * Fixtures with REAL, different aspect ratios, because the whole question the
 * showcase raises is what happens to a photograph that is not 3:2. `swatch()`
 * above is always square, so a scene built only from swatches would never ask
 * that question at all.
 *
 * The dimensions in the filenames are a leftover convention from the feed
 * card's frame rule and are harmless here — the band is a fixed 3:2 and reads
 * nothing from the name. They are kept only because they say, at a glance,
 * what shape each fixture is.
 *
 * Referenced as literal dev-server paths rather than imported: an import would
 * put them in the module graph, and these must stay as un-shippable as the rest
 * of src/uiharness. If a path is ever wrong the image simply fails to render,
 * which the capture sweep reports — so this cannot rot silently.
 */
const FIX = "/src/uiharness/fixtures";
/** 3:2 — the ONE shape that fills the band edge to edge, with no bars at all. */
const LAND = `${FIX}/land-w1500h1000.svg`;
/** 4:5 portrait — taller than the band, so bars at the left and right. */
const PORT = `${FIX}/port-w1000h1250.svg`;
/** 6:1 panorama — wider than the band, so bars at the top and bottom. */
const PANO = `${FIX}/pano-w6000h1000.svg`;
/** 9:16 — the tallest a phone shoots. Wide bars at the sides; the hard case. */
const TALL = `${FIX}/tall-w900h1600.svg`;

/**
 * Twenty-one posts: two complete blocks (nine squares + a band, twice) plus the
 * start of a third, so the rhythm can be SEEN repeating rather than inferred.
 * The awkward states measured on production are seeded among the squares.
 */
const GRID_POSTS: UnifiedPost[] = [
  post(0),
  post(1),
  post(2),
  post(3),
  // 24 of 210 production posts hold more than one photograph — the tile must
  // say so, or a quarter of the work is invisible.
  post(4, { image_urls: [swatch(4, "5"), swatch(30), swatch(31), swatch(32), swatch(33), swatch(34)] }),
  // 9 production posts predate the thumbnail writer: no thumbnail at all.
  post(5, { thumbnail_urls: null }),
  // A thumbnail address that 404s. The tile must fall back to the original,
  // ALONE — one bad tile must never blank the other eight.
  post(6, { thumbnail_urls: ["/harness-this-thumbnail-does-not-exist.jpg"] }),
  // No photograph at all. Rare, but a hole in the grid is a visible bug.
  post(7, { image_urls: [], image_url: null, thumbnail_urls: null }),
  // The longest caption on production is far shorter than this; the caption is
  // the tile's accessible label, and a runaway label must not affect layout.
  post(8, { content: "Morning mist over the Teesta, shot on a 50mm at f/1.8 — ".repeat(6) }),
  // ── index 9: SHOWCASE. A 3:2 photograph — the one shape that fills the band
  //    edge to edge with no bars at all.
  post(9, { image_urls: [LAND], thumbnail_urls: [LAND] }),

  post(10), post(11), post(12), post(13), post(14), post(15), post(16), post(17),
  post(18),
  // ── index 19: SHOWCASE. A 6:1 panorama — wider than the band, so it sits
  //    letterboxed inside it. Whole, never cropped.
  post(19, { image_urls: [PANO], thumbnail_urls: [PANO] }),

  post(20),
];

/**
 * The two HARD shapes in showcase position — a 4:5 portrait and a 9:16 phone
 * shot. These are the ones that leave the most blurred bar in a 3:2 band, and
 * so the ones worth looking at before anybody ships this. The two easy shapes
 * (3:2 and the panorama) are in `profile-grid`.
 */
const SHAPE_POSTS: UnifiedPost[] = [
  ...Array.from({ length: 9 }, (_, i) => post(40 + i)),
  post(49, { image_urls: [PORT], thumbnail_urls: [PORT], content: "4:5 portrait — whole, bars at the sides" }),
  ...Array.from({ length: 9 }, (_, i) => post(50 + i)),
  post(59, { image_urls: [TALL], thumbnail_urls: [TALL], content: "9:16 — whole, bars at the sides" }),
];

export const SCENES: Record<string, () => JSX.Element> = {
  /**
   * Twenty-one posts = two full blocks and a bit, so the nine-then-one rhythm
   * can be seen repeating rather than reasoned about.
   */
  "profile-grid": () => (
    <div className="min-h-screen bg-background">
      <ProfilePostGrid posts={GRID_POSTS} />
    </div>
  ),

  /**
   * The two hardest shapes in showcase position: a 4:5 portrait and a 9:16
   * phone shot, both shown WHOLE inside a 3:2 band.
   */
  "profile-grid-shapes": () => (
    <div className="min-h-screen bg-background">
      <ProfilePostGrid posts={SHAPE_POSTS} />
    </div>
  ),

  /**
   * Ten posts exactly — the shortest wall that reaches a showcase. Checks that
   * the block completes cleanly: three whole rows, then the band, with no gap
   * where a row ended.
   */
  "profile-grid-one-block": () => (
    <div className="min-h-screen bg-background">
      <ProfilePostGrid posts={GRID_POSTS.slice(0, 10)} />
    </div>
  ),

  /** One photograph. A three-column grid with one item is where naive grid CSS
   *  stretches the single tile across the full width. */
  "profile-grid-single": () => (
    <div className="min-h-screen bg-background">
      <ProfilePostGrid posts={[post(3)]} />
    </div>
  ),

  /** Two tiles — an incomplete final row, the other common stretch bug. */
  "profile-grid-partial-row": () => (
    <div className="min-h-screen bg-background">
      <ProfilePostGrid posts={[post(1), post(2)]} />
    </div>
  ),

  /**
   * Nine posts — one post SHORT of a band. The wall must end on a clean row
   * rather than reserving an empty band slot.
   */
  "profile-grid-no-band-yet": () => (
    <div className="min-h-screen bg-background">
      <ProfilePostGrid posts={GRID_POSTS.slice(0, 9)} />
    </div>
  ),

  /** The switch itself, in both positions, driven for real. */
  "wall-view-toggle": () => {
    const Demo = () => {
      const [view, setView] = useState<WallView>("grid");
      return (
        <div className="min-h-screen bg-background">
          <WallViewToggle value={view} onChange={setView} />
          <p className="p-4 text-sm text-muted-foreground">Selected: {view}</p>
          <WallViewToggle value="feed" onChange={() => {}} />
        </div>
      );
    };
    return <Demo />;
  },

  /**
   * Proves the harness itself renders the app's real styling — Tailwind
   * tokens, the dark theme, the font — rather than a bare white page that
   * would make every later screenshot meaningless.
   */
  "harness-selftest": () => (
    <div className="min-h-screen bg-background p-5 text-foreground">
      <p className="mb-3 text-xs uppercase tracking-widest text-primary">Self test</p>
      <h2 className="mb-2 text-xl font-bold">Theme tokens are loading</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        If this block is dark with a blue label, index.css and the design tokens
        reached the harness and a screenshot of any other scene is trustworthy.
      </p>
      <div className="grid grid-cols-3 gap-[2px]">
        {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <img key={i} src={swatch(i, String(i + 1))} alt="" className="aspect-square w-full object-cover" />
        ))}
      </div>
      {/* min-h-11 = 44px. The first capture run flagged this button at 36px
          tall — below the tap-target floor — which is exactly the class of
          defect the sweep exists to catch, and it caught it on itself. */}
      <button className="mt-4 min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
        Primary button
      </button>
    </div>
  ),
};
