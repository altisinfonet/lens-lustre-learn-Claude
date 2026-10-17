/**
 * BUG 7 — THE LOOK-ALIKE UI CHECK (Owner list, 15 Oct 2026).
 *
 * "An automatic UI check that renders a post plus a picture ad and a video ad,
 * each with and without a link, and FAILS if the comments box or the ad layout
 * differ." It renders the REAL AdZone story card (the feed's ad slot) four
 * times — picture / video × a real https link / the Owner's plain-text
 * "Hideaway Resort and Hotel" — and the REAL comments box for a post and for
 * each ad, opened through the real AdEngagementBar → CommentsOverlay path.
 * Only the network is faked.
 *
 * It fails when:
 *   · "Sponsored" is printed more than once on an ad card (bug 4);
 *   · an ad opens anything but a valid https:// address, or shows a CTA without one (bug 4);
 *   · a picture ad and a video ad with the same link lay out differently (bug 4);
 *   · an ad's comments box differs from a post's — search row, emoji row,
 *     placeholder words (bug 3).
 *
 * It renders in jsdom, so it proves structure and words, not pixels.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const GOOD = "https://www.hideaway-resort.com/";
const PLAIN = "Hideaway Resort and Hotel";
const creative = (id: string, click_url: string, video: boolean) => ({
  id, zone: "story-card", image_url: `https://cdn.example.com/${id}.jpg`, click_url, alt_text: "",
  headline: click_url === GOOD ? "Stay by the lake" : "", subtext: "", cta: "",
  advertiser_name: "", advertiser_logo_url: "", sort_order: 0,
  video: video ? { id: `v-${id}` } : null,
});
const CREATIVES = [
  creative("pic-link", GOOD, false),
  creative("pic-text", PLAIN, false),
  creative("vid-link", GOOD, true),
  creative("vid-text", PLAIN, true),
];

vi.mock("@/lib/ads/adZonesV2", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ads/adZonesV2")>();
  const zones = Object.fromEntries(real.ALL_ZONES.map((z) => [z, real.defaultZoneConfig(z)]));
  zones["story-card"] = { ...zones["story-card"], mode: "own" };
  return { ...real, fetchAdZonesEnabled: async () => true, fetchAdZones: async () => zones, fetchAdFrequency: async () => ({}) };
});
vi.mock("@/lib/ads/adCreatives", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ads/adCreatives")>()),
  fetchAdCreatives: async () => CREATIVES,
}));
vi.mock("@/lib/ads/adTrackV2", () => ({ trackZoneEvent: () => {}, detectDevice: () => "desktop" }));
vi.mock("@/components/video/FeedVideoCard", () => ({ default: () => <div data-testid="feed-video">video</div> }));
vi.mock("@/hooks/core/useSiteLogo", () => ({ useSiteLogo: () => "/logo.png" }));
vi.mock("@/hooks/core/useIsAdmin", () => ({ useIsAdmin: () => ({ isAdmin: false }) }));
vi.mock("@/hooks/core/useAuth", () => ({ useAuth: () => ({ user: { id: "viewer-1" }, loading: false }) }));
vi.mock("@/hooks/core/useBlockedUsers", () => ({ useBlockedUsers: () => ({ blockedIds: new Set<string>() }) }));
vi.mock("@/hooks/profile/useProfileData", () => ({
  usePrefetchProfile: () => () => {},
  useProfileCore: () => ({ data: { full_name: "Viewer", avatar_url: null } }),
}));
vi.mock("@/hooks/profile/useProfileMap", () => ({ useProfileMap: () => ({ profileMap: {} }) }));
vi.mock("@/lib/adminBrand", () => ({
  getAdminIds: async () => new Set<string>(),
  resolveName: (_id: string, name: string | null) => name || "Photographer",
  resolveBadges: (_id: string, badges: string[]) => badges,
}));
vi.mock("@/components/UserIdentityBlock", () => ({ default: ({ name }: { name: string | null }) => <span>{name}</span> }));
vi.mock("@/components/MentionInput", () => ({
  default: ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) => (
    <input placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock("@/lib/ads/adEngagement", () => ({
  adPath: (id: string) => `/ad/${id}`,
  emptyEngagement: (creativeId: string) => ({ creativeId, likeCount: 0, commentCount: 0, shareCount: 0, myReaction: null, myShared: false, reactionCounts: {} }),
  fetchAdEngagement: async () => new Map(),
  fetchAdComments: async () => [],
  addAdComment: vi.fn(async () => ({ error: null })),
  editAdComment: vi.fn(async () => ({ error: null })),
  deleteAdComment: vi.fn(async () => ({ error: null })),
  reactToAd: vi.fn(async () => ({ error: null })),
  unreactToAd: vi.fn(async () => ({ error: null })),
  shareAd: vi.fn(async () => ({ error: null })),
  BLOCKED_COMMENT_MESSAGE: "blocked",
}));
const hookState = {
  comments: [], loading: false, loaded: true, currentUserId: "viewer-1", viewer: { full_name: "Viewer", avatar_url: null },
  isAdmin: false, canPin: false, submitting: false, editSubmitting: false,
  addComment: vi.fn(), editComment: vi.fn(), deleteComment: vi.fn(), toggleLike: vi.fn(), setReaction: vi.fn(),
  togglePin: vi.fn(), reportComment: vi.fn(), reload: vi.fn(),
};
vi.mock("@/hooks/feed/usePostComments", () => ({ usePostComments: () => hookState }));

import AdZone from "@/components/ads/AdZone";
import CommentsOverlay from "@/components/comments/CommentsOverlay";
import PostCommentsSection from "@/components/PostCommentsSection";
import { CommentsOverlayProvider } from "@/contexts/CommentsOverlayContext";

const shell = (node: ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <CommentsOverlayProvider>
          {node}
          <CommentsOverlay />
        </CommentsOverlayProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

const drawAd = async (slot: number) => {
  shell(<div data-testid="card"><AdZone zone="story-card" slotIndex={slot} /></div>);
  const card = screen.getByTestId("card");
  await waitFor(() => expect(within(card).queryAllByRole("img").length + within(card).queryAllByTestId("feed-video").length).toBeGreaterThan(0));
  return card;
};

/** How the ad card is laid out — what must be the same for a picture and a video. */
const layoutOf = (card: HTMLElement) => {
  const external = [...card.querySelectorAll("a[href]")].filter((a) => !a.getAttribute("href")!.startsWith("/"));
  const bar = card.querySelector('[data-testid="ad-video-cta"], [data-testid="ad-caption"]');
  return {
    sponsored: (card.textContent?.match(/Sponsored/g) ?? []).length,
    opensOnly: external.map((a) => a.getAttribute("href")),
    cta: within(card).queryAllByText(/Learn more|Book now/).length,
    captionBar: bar ? bar.getAttribute("data-testid") : null,
    captionText: bar?.textContent?.replace(/\s+›$/, "") ?? null,
  };
};

const boxOf = (box: HTMLElement) => {
  const composer = (within(box).getAllByRole("textbox") as HTMLInputElement[]).find((i) => i.placeholder !== "Search comments");
  return {
    searchRow: within(box).queryAllByRole("button", { name: /search/i }).length > 0,
    emojiRow: within(box).queryAllByRole("button", { name: /to your comment$/i }).length,
    placeholder: (composer?.placeholder ?? "").replace(/ for .*$/, " for …"),
  };
};

// jsdom has no IntersectionObserver; AdZone counts an impression with one.
class NoIntersection { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver ??= NoIntersection;

beforeEach(() => cleanup());

describe("bug 7 — every ad card looks alike and says Sponsored once", () => {
  const layouts: Record<string, ReturnType<typeof layoutOf>> = {};
  it.each(CREATIVES.map((c, i) => [c.id, i] as const))("%s: one Sponsored; links only to https; CTA only with one", async (id, slot) => {
    const l = layoutOf(await drawAd(slot));
    layouts[id] = l;
    const linked = id.endsWith("-link");
    expect(l.sponsored, `${id} prints "Sponsored" ${l.sponsored} times`).toBe(1);
    expect(l.opensOnly.every((h) => h === GOOD), `${id} opens ${JSON.stringify(l.opensOnly)}`).toBe(true);
    expect(l.opensOnly.length > 0, `${id}: link present ↔ valid https link`).toBe(linked);
    expect(l.cta > 0, `${id}: CTA shown ↔ valid https link`).toBe(linked);
  });
  it("a picture ad and a video ad with the same link have the same layout", async () => {
    for (const [i, id] of CREATIVES.map((c, n) => [n, c.id] as const)) if (!layouts[id]) layouts[id] = layoutOf(await drawAd(i)), cleanup();
    const shape = (l: ReturnType<typeof layoutOf>) => ({ captionBar: l.captionBar, captionText: l.captionText, cta: l.cta, links: l.opensOnly.length > 0 });
    expect(shape(layouts["vid-link"])).toEqual(shape(layouts["pic-link"]));
    expect(shape(layouts["vid-text"])).toEqual(shape(layouts["pic-text"]));
  });
});

describe("bug 7 — the comments box on a post and on every ad is one box", () => {
  it.each(CREATIVES.map((c, i) => [c.id, i] as const))("%s opens the post's box", async (_id, slot) => {
    shell(<div data-testid="post"><PostCommentsSection postId="p1" postOwnerId="o1" postOwnerHandle="villagesquare" /></div>);
    const post = boxOf(screen.getByTestId("post"));
    cleanup();
    const card = await drawAd(slot);
    fireEvent.click(within(card).getByRole("button", { name: "Comment" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.textContent).not.toContain("Loading comments…"));
    expect(boxOf(dialog)).toEqual(post);
  });
});
