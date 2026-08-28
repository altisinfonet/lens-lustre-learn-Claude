/**
 * THE AD CARD NAMES THE PEOPLE WHO REACTED, LIKE THE FEED DOES.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE REPORT
 *
 * Owner, 2026-08-28, after the comment fix shipped: *"Comment is showing but
 * Reactions name of the person like Feed right side not showing"*.
 *
 * On a post the row carries the reaction break-up on its right — an emoji and a
 * count per reaction — and tapping either that or the total opens a Reactions
 * dialog listing every member who left one. The sponsored story card showed
 * neither. It had the data all along: get_ad_engagement returns `reaction_counts`
 * in the same shape a post row carries, and ad_creative_reactions holds the
 * user_ids.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT WAS MISSING — WHICH IS THE PART WORTH A TEST
 *
 * When the ad card was moved onto PostCard's shared row, the reactions panel
 * and the break-up were left behind as OPTIONAL SLOTS that only PostCard
 * filled, on the reasoning that what a post's number opens is a post's
 * business. That is the same reasoning that produced the hand-copied row in the
 * first place, and it failed the same way: the surface that passed nothing
 * silently drew nothing. Both are required props on the row now, and
 * ReactionSummaryTooltip takes a `source` saying which table to read.
 *
 * So this file asserts the BEHAVIOUR, not the wiring: render the ad card, and
 * the person who reacted must be nameable.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const CREATIVE_ID = "933bf711-ee95-4414-b399-5ca8c33e85e5";
const REACTOR_ID = "cccccccc-dddd-eeee-ffff-000000000000";

/** Captures which table the panel read, so "it found names" cannot pass by luck. */
const selectedFrom: string[] = [];
const eqCalls: [string, unknown][] = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      selectedFrom.push(table);
      return {
        select: () => ({
          eq: (column: string, value: unknown) => {
            eqCalls.push([column, value]);
            return Promise.resolve({
              data:
                table === "ad_creative_reactions"
                  ? [{ user_id: REACTOR_ID, reaction_type: "like" }]
                  : [],
              error: null,
            });
          },
        }),
      };
    },
  },
}));

vi.mock("@/lib/profileMapCache", () => ({
  fetchProfileMap: async () =>
    new Map([[REACTOR_ID, { full_name: "Reacting Member", avatar_url: null }]]),
}));

vi.mock("@/lib/ads/adEngagement", () => ({
  adPath: (id: string) => `/ad/${id}`,
  emptyEngagement: (creativeId: string) => ({
    creativeId,
    likeCount: 0,
    commentCount: 0,
    shareCount: 0,
    myReaction: null,
    myShared: false,
    reactionCounts: {},
  }),
  fetchAdEngagement: async () =>
    new Map([
      [
        CREATIVE_ID,
        {
          creativeId: CREATIVE_ID,
          likeCount: 3,
          commentCount: 1,
          shareCount: 0,
          myReaction: null,
          myShared: false,
          // The break-up the feed shows on its right: two kinds, not just 'like'.
          reactionCounts: { like: 2, love: 1 },
        },
      ],
    ]),
  fetchAdComments: async () => [],
  addAdComment: vi.fn(),
  editAdComment: vi.fn(),
  deleteAdComment: vi.fn(),
  reactToAd: vi.fn(),
  unreactToAd: vi.fn(),
  shareAd: vi.fn(),
  BLOCKED_COMMENT_MESSAGE: "blocked",
}));

vi.mock("@/hooks/core/useAuth", () => ({
  useAuth: () => ({ user: { id: "viewer-1" }, loading: false }),
}));
vi.mock("@/hooks/core/useIsAdmin", () => ({ useIsAdmin: () => ({ isAdmin: false }) }));
vi.mock("@/components/ReactorFriendAction", () => ({ default: () => null }));
vi.mock("@/components/UserIdentityBlock", () => ({
  default: ({ name }: { name: string | null }) => <span>{name}</span>,
}));

import AdEngagementBar from "@/components/ads/AdEngagementBar";

const drawStoryCard = async () => {
  render(
    <MemoryRouter>
      <AdEngagementBar creativeId={CREATIVE_ID} />
    </MemoryRouter>,
  );
  // The counts arrive from the engagement RPC, so wait for the row to have them.
  await screen.findByText("3");
};

describe("the reaction break-up is on the ad card's row", () => {
  it("draws an emoji and a count for each reaction received", async () => {
    await drawStoryCard();
    // 👍 2 and ❤️ 1 — the counts beside the total of 3.
    expect(screen.getAllByTitle("like").length).toBeGreaterThan(0);
    expect(screen.getAllByTitle("love").length).toBeGreaterThan(0);
  });

  it("does not draw a reaction nobody chose", async () => {
    await drawStoryCard();
    expect(screen.queryByTitle("angry")).toBeNull();
    expect(screen.queryByTitle("wow")).toBeNull();
  });
});

describe("tapping the count names the people, from the AD's own table", () => {
  it("opens the Reactions dialog and lists the member", async () => {
    await drawStoryCard();
    fireEvent.click(screen.getByText("3"));

    expect(await screen.findByText("Reactions")).toBeInTheDocument();
    expect(await screen.findByText("Reacting Member")).toBeInTheDocument();
  });

  it("reads ad_creative_reactions, keyed by creative_id — never post_reactions", async () => {
    selectedFrom.length = 0;
    eqCalls.length = 0;
    await drawStoryCard();
    fireEvent.click(screen.getByText("3"));
    await screen.findByText("Reacting Member");

    expect(selectedFrom).toContain("ad_creative_reactions");
    expect(selectedFrom, "an ad has no row in post_reactions").not.toContain("post_reactions");
    expect(eqCalls).toContainEqual(["creative_id", CREATIVE_ID]);
  });
});
