/**
 * ADS BUG 2 — "On no network ad is not showing" (Owner, latest Android app,
 * 2026-10-29).
 *
 * The ad flag, config and picture library were never kept on the phone, so
 * with no network the zone had nothing and drew nothing. They are one React
 * Query entry now (["ad-zone", zone], src/lib/ads/adZoneData.ts), on the same
 * OFF-1 allow-list the feed uses (src/lib/offline/queryPersistence.ts).
 *
 * Runs the REAL AdZone, the REAL device-store bridge (hydrateFromDevice) and
 * React Query offline. Any network call fails the test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";

const net = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => { net.calls++; throw new Error("no network in this test"); },
    rpc: async () => { net.calls++; throw new Error("no network in this test"); },
  },
}));
vi.mock("@/lib/ads/adTrackV2", () => ({ trackZoneEvent: () => {}, detectDevice: () => "mobile" }));
vi.mock("@/components/video/FeedVideoCard", () => ({ default: () => <div data-testid="feed-video">video</div> }));
vi.mock("@/hooks/core/useSiteLogo", () => ({ useSiteLogo: () => "/logo.png" }));
vi.mock("@/hooks/core/useIsAdmin", () => ({ useIsAdmin: () => ({ isAdmin: false }) }));
vi.mock("@/hooks/core/useAuth", () => ({ useAuth: () => ({ user: { id: "me" }, loading: false }) }));
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
import { defaultZoneConfig } from "@/lib/ads/adZonesV2";
import { adZoneQueryKey, type AdZoneData } from "@/lib/ads/adZoneData";
import { memoryBackend, putRecord, setBackend } from "@/lib/offline/deviceStore";
import { hydrateFromDevice, isPersisted } from "@/lib/offline/queryPersistence";

const LIBRARY = "https://cdn.example.com/library-picture.webp";
const saved: AdZoneData = {
  enabled: true,
  config: { ...defaultZoneConfig("story-card"), mode: "own", devices: ["desktop", "mobile", "tablet"] },
  creatives: [{
    id: "df204c88-74ec-4c05-be2f-ef1e179581a2", zone: "story-card", image_url: LIBRARY, click_url: "", alt_text: "",
    headline: "", subtext: "", cta: "", advertiser_name: "", advertiser_logo_url: "", sort_order: 1, video: null,
  }],
  publisherId: "",
};

class NoIntersection { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver ??= NoIntersection;

beforeEach(() => { cleanup(); net.calls = 0; setBackend(memoryBackend()); });
afterEach(() => { onlineManager.setOnline(true); setBackend(undefined); });

describe("ads bug 2 — the feed's ad is kept on the phone", () => {
  it("the ad zone's data is on the OFF-1 allow-list (per member, like the feed)", () => {
    expect(isPersisted(adZoneQueryKey("story-card") as unknown as unknown[], "me")).toBe(true);
    expect(isPersisted(adZoneQueryKey("story-card") as unknown as unknown[], null)).toBe(false);
  });

  it("with NO network, the ad seen earlier is drawn from the phone — with Like and Comment, and no request", async () => {
    await putRecord("me", adZoneQueryKey("story-card") as unknown as unknown[], saved);
    onlineManager.setOnline(false);
    const qc = new QueryClient();
    await hydrateFromDevice(qc, "me");
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <CommentsOverlayProvider>
            <div data-testid="card"><AdZone zone="story-card" slotIndex={0} /></div>
          </CommentsOverlayProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const card = screen.getByTestId("card");
    await waitFor(() => expect([...card.querySelectorAll("img")].map((i) => i.getAttribute("src"))).toContain(LIBRARY));
    expect(within(card).getByRole("button", { name: "Comment" })).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Like" })).toBeTruthy();
    expect(net.calls, "a request was made with no network").toBe(0);
  });
});
