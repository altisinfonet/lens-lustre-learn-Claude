/**
 * ADS BUG 1 — "From Feed ad comment and like section vanished" (Owner, latest
 * Android app, 2026-10-29).
 *
 * The feed's sponsored card draws its like / comment bar only for a picture
 * from the ad library (an ad_creatives row). When the library read FAILED —
 * no network, a timeout on a weak link — fetchAdCreatives answered `[]`, which
 * means "this zone has no library", so the card fell back to the zone's single
 * picture (no row, so no bar) and the mounted card never asked again.
 *
 * Renders the REAL AdZone with the REAL adCreatives / adZoneData reads; only
 * the Supabase client is faked. Fails on the code before the fix: the single
 * picture is drawn without the bar, and the bar never arrives.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { SINGLE } = vi.hoisted(() => ({ SINGLE: "https://cdn.example.com/zone-single-picture.webp" }));
const LIBRARY = "https://cdn.example.com/library-picture.webp";
const libraryRow = {
  id: "df204c88-74ec-4c05-be2f-ef1e179581a2", zone: "story-card", image_url: LIBRARY, click_url: "", alt_text: "",
  headline: "", subtext: "", cta: "", advertiser_name: null, advertiser_logo_url: null, sort_order: 1,
};

/** What each ad_creatives read answers, in order; the last one repeats. */
type Answer = { data: unknown; error: { message: string; code?: string } | null };
const reads = vi.hoisted(() => ({ answers: [] as unknown[], count: 0 }));
const setAnswers = (a: Answer[]) => { reads.answers = a; };
const OFFLINE = { data: null, error: { message: "TypeError: Failed to fetch", code: "" } };

vi.mock("@/integrations/supabase/client", () => {
  const thenable = (answer: () => unknown) => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "in"]) chain[m] = () => chain;
    chain.maybeSingle = async () => ({ data: null, error: null });
    chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(answer()).then(ok, bad);
    return chain;
  };
  return {
    supabase: {
      from: (table: string) => {
        if (table === "ad_creatives") {
          return thenable(() => {
            const a = reads.answers[Math.min(reads.count, reads.answers.length - 1)];
            reads.count++;
            return a;
          });
        }
        return thenable(() => ({ data: [], error: null }));
      },
      rpc: async () => ({ data: [], error: null }),
    },
  };
});
vi.mock("@/lib/ads/adZonesV2", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ads/adZonesV2")>();
  const zones = Object.fromEntries(real.ALL_ZONES.map((z) => [z, real.defaultZoneConfig(z)]));
  // Production today: the zone ALSO has a single picture (uploaded 2026-10-29).
  zones["story-card"] = { ...zones["story-card"], mode: "own", own: { ...zones["story-card"].own, image_url: SINGLE } };
  return { ...real, fetchAdZonesEnabled: async () => true, fetchAdZones: async () => zones, fetchAdFrequency: async () => ({}) };
});
vi.mock("@/lib/ads/adTrackV2", () => ({ trackZoneEvent: () => {}, detectDevice: () => "mobile" }));
vi.mock("@/components/video/FeedVideoCard", () => ({ default: () => <div data-testid="feed-video">video</div> }));
vi.mock("@/hooks/core/useSiteLogo", () => ({ useSiteLogo: () => "/logo.png" }));
vi.mock("@/hooks/core/useIsAdmin", () => ({ useIsAdmin: () => ({ isAdmin: false }) }));
vi.mock("@/hooks/core/useAuth", () => ({ useAuth: () => ({ user: { id: "viewer-1" }, loading: false }) }));
vi.mock("@/lib/ads/adEngagement", () => ({
  adPath: (id: string) => `/ad/${id}`,
  emptyEngagement: (creativeId: string) => ({ creativeId, likeCount: 0, commentCount: 0, shareCount: 0, myReaction: null, myShared: false, reactionCounts: {} }),
  fetchAdEngagement: async () => new Map(),
  reactToAd: async () => ({ error: null }),
  unreactToAd: async () => ({ error: null }),
  shareAd: async () => ({ error: null }),
}));

import AdZone from "@/components/ads/AdZone";
import { CommentsOverlayProvider } from "@/contexts/CommentsOverlayContext";
import { fetchAdCreatives, invalidateAdCreatives } from "@/lib/ads/adCreatives";

class NoIntersection { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver ??= NoIntersection;

const drawFeedAd = () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <CommentsOverlayProvider>
          <div data-testid="card"><AdZone zone="story-card" slotIndex={0} /></div>
        </CommentsOverlayProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return screen.getByTestId("card");
};
const pictures = (card: HTMLElement) => [...card.querySelectorAll("img")].map((i) => i.getAttribute("src"));
const hasBar = (card: HTMLElement) =>
  within(card).queryAllByRole("button", { name: "Comment" }).length === 1 &&
  within(card).queryAllByRole("button", { name: "Like" }).length === 1;

beforeEach(() => {
  cleanup();
  invalidateAdCreatives();
  reads.count = 0;
});

describe("ads bug 1 — a sponsored card never shows without its like and comment bar", () => {
  it("a failed library read does not draw the single picture without a bar; the card arrives WITH the bar", async () => {
    setAnswers([OFFLINE, { data: [libraryRow], error: null }]);
    const card = drawFeedAd();

    await waitFor(() => expect(reads.count).toBeGreaterThanOrEqual(1));
    await new Promise((r) => setTimeout(r, 300));
    expect(pictures(card), "the zone's single picture (no like / comment) was drawn after a failed read").not.toContain(SINGLE);

    await waitFor(() => expect(pictures(card)).toContain(LIBRARY), { timeout: 5000 });
    expect(hasBar(card), "the library picture is drawn without its like / comment bar").toBe(true);
    expect(pictures(card)).not.toContain(SINGLE);
  }, 15_000); // real timers: the first retry waits ~1 s (retryPolicy.retryDelay)

  it("the library is read with the bar when the read works the first time", async () => {
    setAnswers([{ data: [libraryRow], error: null }]);
    const card = drawFeedAd();
    await waitFor(() => expect(pictures(card)).toContain(LIBRARY));
    expect(hasBar(card)).toBe(true);
  });

  it("a library KNOWN to be empty still falls back to the zone's single picture (the documented single-image path)", async () => {
    setAnswers([{ data: [], error: null }]);
    const card = drawFeedAd();
    await waitFor(() => expect(pictures(card)).toContain(SINGLE));
  });
});

describe("fetchAdCreatives — a failed read is not an empty library", () => {
  it("answers null (unknown) on a failed read, and does not remember it", async () => {
    setAnswers([OFFLINE, { data: [libraryRow], error: null }]);
    expect(await fetchAdCreatives("story-card")).toBeNull();
    const rows = await fetchAdCreatives("story-card");
    expect(rows?.map((r) => r.id)).toEqual([libraryRow.id]);
  });

  it("a lane without the table (migration not run) really has no library", async () => {
    setAnswers([{ data: null, error: { message: "relation does not exist", code: "42P01" } }]);
    expect(await fetchAdCreatives("story-card")).toEqual([]);
  });
});
