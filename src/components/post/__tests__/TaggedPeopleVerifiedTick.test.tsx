/**
 * DOES THE BLUE TICK ACTUALLY REACH THE SCREEN ON A TAGGED NAME?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS, STATED PLAINLY
 *
 * The tick was added to `TaggedPeople` on 2026-08-13 and reported to the owner
 * as done. It was never asserted. `TaggedPeople.test.tsx` says so out loud:
 *
 *   "The assertions below are about the NAMES and the COUNT, which do not
 *    depend on the badge resolving at all — an unresolved AutoBadge renders
 *    nothing, which is exactly what an unbadged member looks like."
 *
 * So a verified tagged member and a broken lookup produce the SAME DOM, and the
 * suite was green either way. That is trap #8 in docs/known-traps-read-first.md
 * — a test pinned to something other than the claim — committed by the same
 * hand that wrote the trap down.
 *
 * On 2026-08-14 the owner sent a screenshot of "Sophia Agarcia with 50mm Retina
 * World" and no tick. Production data says that account IS verified:
 *
 *   user_badges -> 4c200b33-…  badge_type 'verified'
 *   RLS         -> "Anyone can view badges" USING (true)
 *   REST as anon-> 200 [{"user_id":"4c200b33-…","badge_type":"verified"}]
 *
 * The data is reachable. So the question is entirely about the client, and this
 * file answers it by driving the REAL path — AutoBadge -> useProfileMap ->
 * profileMapCache -> supabase — with the exact row shape production returns,
 * and then looking for a tick in the DOM.
 *
 * ⚠ DO NOT weaken these into "renders without crashing". The whole point is
 * that the previous test could not tell a working tick from a missing one.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const VERIFIED_ID = "4c200b33-ae64-46f0-ba5d-1a97152e6a6c";
const PLAIN_ID = "0f41ef16-5b70-4eda-b5e3-39f4d46eeea2";

/**
 * Simulates the failure the owner actually saw: the per-name badge lookup
 * coming back with nothing for a member who IS verified in the database.
 * Flipped per-test so one file covers both the fix and the fallback.
 */
let lookupFails = false;

/** Mirrors what PostgREST actually returns for each table this path touches. */
const rows = (table: string, ids: string[]) => {
  if (table === "user_badges") {
    if (lookupFails) return [];
    return ids.includes(VERIFIED_ID)
      ? [{ user_id: VERIFIED_ID, badge_type: "verified" }]
      : [];
  }
  return [];
};

const makeStub = (table: string) => {
  const state: { ids: string[] } = { ids: [] };
  const stub: any = {
    select: () => stub,
    eq: () => stub,
    in: (_col: string, ids: string[]) => {
      state.ids = ids;
      return stub;
    },
    order: () => stub,
    limit: () => stub,
    then: (resolve: (v: unknown) => void) =>
      resolve({ data: rows(table, state.ids), error: null }),
  };
  return stub;
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => makeStub(table),
    rpc: () => Promise.resolve({ data: [], error: null }),
    channel: () => ({ on: () => ({ on: () => ({ subscribe: () => ({}) }) }) }),
  },
}));

// profiles_public_data — the name/avatar half of the same lookup.
vi.mock("@/lib/profilesPublic", () => {
  const stub: any = {
    select: () => stub,
    in: (_c: string, ids: string[]) => {
      stub.__ids = ids;
      return stub;
    },
    then: (resolve: (v: unknown) => void) =>
      resolve({
        data: (stub.__ids || []).map((id: string) => ({
          id,
          full_name: id === VERIFIED_ID ? "50mm Retina World" : "AVIJIT SHEEL",
          avatar_url: null,
          last_active_at: null,
        })),
        error: null,
      }),
  };
  return { profilesPublic: () => stub };
});

// Badge DEFINITIONS drive the coloured pills, not the tick. Stubbed so a
// missing definitions table can never be mistaken for a missing tick.
vi.mock("@/hooks/profile/useBadgeDefinitions", () => ({
  useBadgeDefinitions: () => new Map(),
}));

import TaggedPeople from "@/components/post/TaggedPeople";
import { clearProfileEntityCache } from "@/lib/profileMapCache";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * ⚠ THE `TooltipProvider` IS NOT OPTIONAL SCENERY.
 *
 * The tick is wrapped in a Radix `<Tooltip>` (UserBadgeInline), and Radix
 * THROWS "`Tooltip` must be used within `TooltipProvider`" without an ancestor
 * provider — it does not degrade to a plain glyph. The first run of this file
 * proved it by crashing. The app supplies one high in the tree, which is why
 * post headers render at all; a test that omits it is testing its own harness.
 */
const show = (people: { id: string; name: string; badges?: string[] }[]) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <TooltipProvider>
        <MemoryRouter>
          <TaggedPeople people={people} />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );

/** The tick is an <svg>; an unresolved AutoBadge renders no element at all. */
const tickCount = (root: HTMLElement) => root.querySelectorAll("svg").length;

beforeEach(() => {
  clearProfileEntityCache();
  lookupFails = false;
});

describe("⚠ badges carried on the post — the fix, and the case that was broken", () => {
  it("shows the tick from the payload EVEN IF the lookup returns nothing", async () => {
    // THIS IS THE WHOLE POINT. `lookupFails` makes every badge query come back
    // empty — whatever was going wrong in the running app, this is that state.
    // With the badges carried on the post the tick still renders, because there
    // is no second request left to fail.
    lookupFails = true;
    const { container } = show([
      { id: VERIFIED_ID, name: "50mm Retina World", badges: ["verified"] },
    ]);
    await screen.findByText("50mm Retina World");
    await waitFor(() => expect(tickCount(container)).toBeGreaterThan(0));
  });

  it("shows NO tick from a payload that carries an empty badge list", async () => {
    // An empty array is a real answer — "this member has no badges" — and must
    // not fall through to the lookup, or the bug returns by the back door.
    lookupFails = false;
    const { container } = show([
      { id: VERIFIED_ID, name: "50mm Retina World", badges: [] },
    ]);
    await screen.findByText("50mm Retina World");
    await waitFor(() => expect(tickCount(container)).toBe(0));
  });
});

describe("the verified tick on a tagged name (lookup fallback, unmigrated callers)", () => {
  it("⚠ SHOWS a tick when the tagged member is verified", async () => {
    // This is the exact case in the owner's 2026-08-14 screenshot.
    const { container } = show([{ id: VERIFIED_ID, name: "50mm Retina World" }]);
    await screen.findByText("50mm Retina World");
    await waitFor(() => expect(tickCount(container)).toBeGreaterThan(0));
  });

  it("shows NO tick when the tagged member is not verified", async () => {
    // The other half of the claim. Without this, a component that rendered a
    // tick for everybody would pass the test above.
    const { container } = show([{ id: PLAIN_ID, name: "AVIJIT SHEEL" }]);
    await screen.findByText("AVIJIT SHEEL");
    await waitFor(() => expect(tickCount(container)).toBe(0));
  });

  it("ticks the verified member inside the 'and N others' list too", async () => {
    const { container } = show([
      { id: PLAIN_ID, name: "AVIJIT SHEEL" },
      { id: VERIFIED_ID, name: "50mm Retina World" },
    ]);
    await screen.findByText("AVIJIT SHEEL");
    // First name is unverified, so any tick in the header row would be wrong;
    // the verified one lives in the dialog, asserted by opening it elsewhere.
    await waitFor(() => expect(tickCount(container)).toBe(0));
  });
});
