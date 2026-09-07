/**
 * ITEM 5 — A PERSON IN A PEOPLE LIST HAS TO BE CLICKABLE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The Auditor, 2026-09-07, on BOTH 75f14f80 and 0e30d46e: in "People You May
 * Know" the name and the avatar are not links at all — walking up from the name
 * text to the row container finds ZERO anchor tags, only Add Friend/Add and
 * Remove are interactive, and clicking the name leaves location.href unchanged.
 * Predates the four-item work; not a regression.
 *
 * The rows were never missing a wrapper. `ProfileLink` and `UserIdentityBlock`
 * have always been there — but neither can produce an <a> without a HANDLE,
 * because F-95 forbids /profile/<id> and `noProfileIdLinks.test.ts` enforces
 * that. Two different sources were failing to deliver one:
 *
 *   /discover      Discover.tsx never selected `custom_url` from
 *                  profiles_public_data, and DiscoverCard's own type made the
 *                  field OPTIONAL, so a page of dead names was a legal program.
 *   the sidebars   dashboard-init builds each suggestion as
 *                  { id, full_name, avatar_url, mutual_count } and each
 *                  milestone from a Q11 select that asks for no handle either.
 *
 * The pixel proof is `tools/uishot/profile-links-in-people-lists.mjs`: real
 * Chromium, both surfaces, zero anchors before and two per row after. This file
 * is the regression guard, and every assertion in it was shown failing against
 * the unfixed sources first.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "@/test-utils/sourceText";

const read = (p: string) => stripComments(readFileSync(join(process.cwd(), p), "utf8"));

const discoverPage = read("src/pages/Discover.tsx");
const discoverCard = read("src/components/discover/DiscoverCard.tsx");
const rightSidebar = read("src/components/FeedRightSidebar.tsx");
const leftSidebar = read("src/components/FeedLeftSidebar.tsx");
const feedSuggestions = read("src/components/feed/FeedFriendSuggestions.tsx");
const handlesHook = read("src/hooks/profile/useMemberHandles.ts");
const fixtures = read("src/uiharness/fixtures.ts");
/* Read, never written: supabase/** is not this lane's. */
const dashboardInit = read("supabase/functions/dashboard-init/index.ts");

describe("item 5a — /discover asks for the handle it renders", () => {
  it("the query selects custom_url", () => {
    const select = discoverPage.match(/\.select\("([^"]*full_name[^"]*)"\)/)?.[1];
    expect(select, "the Discover select moved — update this test").toBeTruthy();
    expect(select, `Discover.tsx selects ${select} — no handle, so every name is a dead span`)
      .toMatch(/\bcustom_url\b/);
  });

  it("the card's handle is REQUIRED, so forgetting it cannot typecheck", () => {
    // `custom_url?:` is what made a whole page of unlinked names legal.
    expect(discoverCard).not.toMatch(/custom_url\?\s*:/);
    expect(discoverCard).toMatch(/custom_url:\s*string \| null;/);
  });
});

describe("item 5b — the people widgets resolve a handle their source does not send", () => {
  it("useRowHandles asks ONLY about rows whose source sent nothing", () => {
    expect(handlesHook).toMatch(/export function useRowHandles/);
    // The whole reason this is not the "two mechanisms" the Auditor ruled out.
    expect(handlesHook).toMatch(/rows\.filter\(\(r\) => r\.custom_url === undefined\)/);
    // A row that DID carry a handle must be passed through untouched.
    expect(handlesHook).toMatch(/row\.custom_url !== undefined\s*\?\s*row\.custom_url/);
  });

  it("each widget passes the resolver, not the raw column", () => {
    for (const [name, src, sym] of [
      ["FeedRightSidebar", rightSidebar, "s"],
      ["FeedFriendSuggestions", feedSuggestions, "s"],
      ["FeedLeftSidebar (milestones)", leftSidebar, "m"],
    ] as const) {
      expect(src, `${name} does not use the resolver`).toMatch(/useRowHandles\(/);
      expect(src, `${name} still reads ${sym}.custom_url straight into a link`)
        .not.toMatch(new RegExp(`handle=\\{${sym}\\.custom_url\\}`));
    }
  });

  it("the birthday rows are left alone, because their source really does carry it", () => {
    // get_todays_birthdays was recreated with custom_url in this tree
    // (20260910_0020_f98c_birthdays_carry_handle_and_close.sql). Bridging them
    // too would be the second mechanism, for no gain.
    expect(leftSidebar).toMatch(/handle=\{u\.custom_url\}/);
  });
});

describe("item 5 — the harness fixture must be the shape the server sends", () => {
  /*
   * THIS IS THE CHECK THAT WOULD HAVE CAUGHT THE WHOLE ITEM.
   *
   * The fixture had been given a `custom_url` on `suggestions` and `milestones`
   * on the strength of a server change that is on staging and NOT on this
   * branch. So the harness rendered seven working links in a widget the
   * deployed build renders with none, and no scene, sweep or screenshot could
   * ever have shown the fault. A fixture that is more generous than the server
   * is not a safe fixture; it is a blindfold.
   *
   * So this asserts AGREEMENT rather than a fixed answer: whichever way the
   * server goes, the fixture has to follow. When D1 adds custom_url to Q11 and
   * the suggestions literal, this test is what tells the next person that the
   * fixture is now behind.
   */
  const serverSuggestionCarriesHandle = /suggestions = eligible|\{ id: p\.id, full_name: p\.full_name, avatar_url: p\.avatar_url, mutual_count: 0 \}/.test(dashboardInit)
    ? /mutual_count: 0,?\s*custom_url|custom_url[^\n]*mutual_count/.test(dashboardInit)
    : null;

  it("reads the server literal it is meant to mirror", () => {
    expect(serverSuggestionCarriesHandle, "the suggestions literal moved — update this test").not.toBeNull();
  });

  it("the suggestions fixture carries a handle if and only if the server does", () => {
    const fixtureBlock = fixtures.slice(fixtures.indexOf("suggestions: profiles"), fixtures.indexOf("suggestions: profiles") + 320);
    const fixtureCarries = /custom_url/.test(fixtureBlock);
    expect(
      fixtureCarries,
      serverSuggestionCarriesHandle
        ? "dashboard-init now sends custom_url on suggestions — the fixture is behind the server"
        : "dashboard-init does NOT send custom_url on suggestions — this fixture is more generous than production, which is what hid item 5",
    ).toBe(serverSuggestionCarriesHandle);
  });
});

describe("item 5 — the harness must honour the columns a page actually asked for", () => {
  const routes = read("src/uiharness/fixtureRoutes.ts");

  it("a table read is projected through its select", () => {
    /*
     * `narrow()` ignored `select` entirely and handed back the whole fixture
     * row, so /discover rendered two working links per row here while the
     * deployed build rendered none. The instrument could not have failed on the
     * fault it exists to catch — a C-34 failure of the instrument itself.
     */
    expect(routes).toMatch(/function project\(/);
    expect(routes).toMatch(/const select = params\.get\("select"\)/);
    // and it must stay conservative rather than approximate an embedded resource
    expect(routes).toMatch(/select\.includes\("\*"\) \|\| select\.includes\("\("\)/);
  });
});
