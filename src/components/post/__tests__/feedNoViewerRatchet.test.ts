/**
 * RATCHET — NO FEED SURFACE RE-ADDS A TAP-TO-OPEN VIEWER (Owner, 4 Nov 2026).
 *
 * "Exactly like Instagram": a feed photograph never opens a viewer, page or
 * lightbox on a tap/click. Pinch (in place) and double-tap-to-like live in ONE
 * shared hook, useFeedPhotoGestures, used by both PostMedia renderers. Every
 * screen that shows feed cards renders them through PostCard → PostMedia, so
 * these source checks are where a re-added viewer would have to pass.
 *
 * If you are here because this went red: the Owner removed the viewer on
 * purpose. Do not bring it back on a feed surface; ask him first.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, "../../../..", p), "utf8");

/** Every file a feed card is assembled from or listed in. */
const FEED_SURFACES = [
  "src/components/post/PostMedia.tsx",
  "src/components/post/PostCard.tsx",
  "src/components/feed/FeedCardWindow.tsx",
  "src/pages/Feed.tsx",
  "src/pages/HashtagFeed.tsx",
  "src/components/post/PostPageMore.tsx",
];

/** Photo viewers that exist elsewhere in the product (competition, profile, admin). */
const VIEWER_IMPORTS = [
  "@/components/media/ZoomableImage",
  "@/components/Lightbox",
  "@/components/CompetitionLightbox",
  "@/components/VotingLightbox",
  "@/components/FacebookPhotoGrid",
];

describe("no feed surface imports a photo viewer", () => {
  for (const surface of FEED_SURFACES) {
    it(surface, () => {
      const src = read(surface);
      for (const v of VIEWER_IMPORTS) expect(src, `${surface} imports ${v}`).not.toContain(`from "${v}"`);
    });
  }
});

describe("PostMedia carries no viewer of its own", () => {
  const MEDIA = read("src/components/post/PostMedia.tsx");
  it("no dialog, no lightbox state, no portal, no zoom cursor", () => {
    expect(MEDIA).not.toMatch(/role="dialog"/);
    expect(MEDIA).not.toMatch(/Lightbox/);
    expect(MEDIA).not.toMatch(/setLightboxOpen|lightboxOpen/);
    expect(MEDIA).not.toMatch(/createPortal/);
    expect(MEDIA).not.toMatch(/cursor-zoom-in/);
    expect(MEDIA).not.toMatch(/Close photo viewer/);
  });
  it("both renderers (single photo and album) use the ONE shared gesture hook", () => {
    expect(MEDIA).toContain('from "@/components/post/useFeedPhotoGestures"');
    expect((MEDIA.match(/useFeedPhotoGestures\(/g) ?? []).length).toBe(2);
    // No second, private tap/double-tap/pinch implementation beside it.
    expect(MEDIA).not.toMatch(/function useTapOrDoubleTap|onTouchStart|onTouchMove|addEventListener\("touch/);
  });
});

describe("double-tap uses the like button's own action", () => {
  const CARD = read("src/components/post/PostCard.tsx");
  it("PostCard's double-tap calls onReact(post.id, \"like\") — the same prop the action row's like button calls — and never un-likes", () => {
    const at = CARD.indexOf("onDoubleTapLike=");
    expect(at).toBeGreaterThan(-1);
    const fn = CARD.slice(at, at + 300);
    expect(fn).toMatch(/onReact\(post\.id, "like"\)/);
    expect(fn).toMatch(/!post\.user_reaction/);
    expect(fn).not.toMatch(/onUnreact/);
    expect(CARD).toMatch(/onReact=\{\(type\) => onReact\(post\.id, type\)\}/);
  });
});

describe("the gesture hook keeps one-finger scrolling", () => {
  const HOOK = read("src/components/post/useFeedPhotoGestures.tsx");
  it("touch listeners that may cancel scrolling only cancel with two fingers down", () => {
    expect(HOOK).toMatch(/passive: false/);
    for (const m of HOOK.matchAll(/preventDefault\(\)/g)) {
      const before = HOOK.slice(Math.max(0, (m.index ?? 0) - 200), m.index);
      expect(before, "a preventDefault() not behind a two-finger/pinch check").toMatch(/touches\.length >= 2|pinchRef\.current/);
    }
  });
});
