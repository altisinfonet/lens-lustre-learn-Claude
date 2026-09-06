/**
 * THE BLUE TICK SHOWS WHEREVER THE NAME SHOWS — INCLUDING WHEN NOTHING CARRIES IT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE STANDING RULE, AND HOW IT WAS BEING BROKEN
 *
 * Owner, standing and restated 2026-08-28: *"Rule was Blue badge will show with
 * name everywhere, where the name is showing... Now Badge is not coming in
 * comment, profile section but some section is showing"*.
 *
 * The admin account has NO ROW AT ALL in public.user_badges — checked against
 * staging: zero rows for the only admin. Its blue tick is INJECTED by
 * `resolveBadges()`, which adds "verified" for any id in the admin set. Every
 * data path in the app does that: the feed query, the profile query, the
 * competition detail query, the comment adapters.
 *
 * `AutoBadge` — the render-time fallback UserIdentityBlock uses whenever the
 * caller has no badges to hand — did not. It read the raw user_badges rows,
 * found none, and drew nothing. So the tick appeared exactly where a caller
 * happened to pass pre-resolved badges (the post header, since 2026-08-14) and
 * nowhere else: not in a comment, not in the user menu, not on the profile
 * sheet, not in a sidebar. One rule, applied in nine places and missing from
 * the tenth — the one that serves everywhere the other nine don't reach.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE TEST IS AT THIS LEVEL
 *
 * Asserting that a particular screen passes `badges` would only ever cover the
 * screens someone remembered to list. What makes the rule hold is that the
 * FALLBACK obeys it, so a surface nobody has thought of yet still gets the
 * tick. That is what these render.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";

const ADMIN_ID = "25d4916c-d399-4c5d-87ad-84dd5e4fa071";
const MEMBER_ID = "aaaaaaaa-1111-2222-3333-444444444444";

/**
 * The profile map returns what the DATABASE holds — and for the admin that is
 * an empty badge list. If this fixture ever grows a "verified" for the admin it
 * stops testing anything: the whole point is that the row does not exist.
 */
vi.mock("@/hooks/profile/useProfileMap", () => ({
  useProfileMap: () => ({
    profileMap: {
      [ADMIN_ID]: { full_name: "50mm Retina World", avatar_url: null, badges: [], last_active_at: null },
      [MEMBER_ID]: { full_name: "An Ordinary Member", avatar_url: null, badges: [], last_active_at: null },
    },
    isLoading: false,
  }),
}));

vi.mock("@/lib/adminBrand", async (importOriginal) => {
  // resolveBadges is the rule under test — keep the REAL one. Only the lookup
  // of who is an admin is faked, because that is a network call.
  const actual = await importOriginal<typeof import("@/lib/adminBrand")>();
  return { ...actual, getAdminIds: async () => new Set([ADMIN_ID]) };
});

vi.mock("@/hooks/profile/useBadgeDefinitions", () => ({ useBadgeDefinitions: () => new Map() }));
vi.mock("@/components/AutoRole", () => ({ default: () => null }));

import UserIdentityBlock from "@/components/UserIdentityBlock";

/**
 * ⚠ THE TooltipProvider IS NOT DECORATION. UserBadgeInline wraps the tick in a
 * Radix Tooltip, which throws without a provider above it — and
 * UserIdentityBlock's SafeRender boundary catches that and renders NOTHING.
 * Omit it here and every assertion below fails for a reason that has nothing to
 * do with badges, which is exactly the kind of test that teaches the wrong
 * lesson. The app mounts one globally.
 */
const draw = (ui: React.ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <TooltipProvider>{ui}</TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe("a name with no badges of its own still gets the brand tick", () => {
  it("draws the tick for the admin, whose user_badges row does not exist", async () => {
    draw(<UserIdentityBlock userId={ADMIN_ID} name="50mm Retina World" handle={null} /* these assert badges, not links */ />);
    expect(screen.getByText("50mm Retina World")).toBeInTheDocument();
    // The tick arrives with the admin-id lookup, which is a query.
    await waitFor(() => expect(screen.getByLabelText("Verified")).toBeInTheDocument());
  });

  it("does NOT invent a tick for an ordinary member", async () => {
    draw(<UserIdentityBlock userId={MEMBER_ID} name="An Ordinary Member" handle={null} /* these assert badges, not links */ />);
    expect(screen.getByText("An Ordinary Member")).toBeInTheDocument();
    // Give the same lookup the same chance to resolve before concluding.
    await waitFor(() => expect(screen.queryByLabelText("Verified")).toBeNull());
  });

  it("draws it in the stacked layout too, where the tick stays on the name's line", async () => {
    draw(<UserIdentityBlock userId={ADMIN_ID} name="50mm Retina World" stack align="center" handle={null} /* these assert badges, not links */ />);
    await waitFor(() => expect(screen.getAllByLabelText("Verified")).toHaveLength(1));
  });
});

describe("a caller that already has the badges does not wait for a lookup", () => {
  it("renders the tick from carried badges, synchronously", () => {
    draw(<UserIdentityBlock userId={MEMBER_ID} name="Carried" badges={["verified"]} handle={null} /* these assert badges, not links */ />);
    // No waitFor: carried badges must not depend on any query resolving.
    expect(screen.getByLabelText("Verified")).toBeInTheDocument();
  });
});

/**
 * Carrying is still better than looking up wherever the caller has them, and
 * both comment surfaces resolve `author_badges` already. Dropping them on the
 * floor — which is what the shared thread did until 2026-08-28 — makes the tick
 * depend on a second per-name request that can arrive late or not at all.
 */
describe("the comment surfaces hand over the badges they resolved", () => {
  it("the shared thread passes them to the identity block", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(process.cwd(), "src/components/comments/CommentThread.tsx"), "utf8");
    expect(src).toContain("badges={comment.author_badges}");
  });

  it("both adapters run their authors through resolveBadges", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    for (const f of [
      "src/components/PostCommentsSection.tsx",
      "src/components/ads/AdComments.tsx",
    ]) {
      expect(readFileSync(join(process.cwd(), f), "utf8"), f).toContain("resolveBadges(");
    }
  });
});
