import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * THE TAG MODAL MUST FIT ON THE SCREEN.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OWNER REPORT, 2026-08-09: *"Tag is not working on web and App on any post."*
 *
 * MEASURED on the live site on 2026-08-10 — a photo attached, the photo tapped,
 * Chrome at a 710px viewport:
 *
 *   viewport height                710
 *   dialog height                 1020
 *   dialog top                    -155   above the top of the screen
 *   dialog bottom                  865   below the bottom of the screen
 *   "Search friends" input top     755   45px BELOW the screen edge
 *   computed overflow-y         hidden
 *   computed max-height           none
 *
 * Nothing was broken in the tagging logic. The picker opened exactly as
 * written — off the bottom of the screen, in a dialog that could not scroll.
 * Tapping the photo looked like it did nothing, on every laptop and every
 * phone, which is precisely "on web and App on any post".
 *
 * The corroborating negative: in 30 days the production Error Log holds ZERO
 * `POST-2005` (POST_TAGS_INSERT_FAILED) rows. Nothing was ever refused —
 * nobody could get far enough to save a tag. A theory that this was an RLS
 * block was wrong, and this is the measurement that killed it.
 *
 * WHY THESE READ THE SOURCE INSTEAD OF RENDERING:
 * jsdom performs no layout. `max-height`, flexbox and viewport units all
 * resolve to nothing there, so a rendering test would pass just as happily
 * against the broken version. What has to hold is the SHAPE of the styles, so
 * that is what is asserted — and each assertion below is tied to the specific
 * way the bug comes back.
 */
const SRC = fs.readFileSync(
  path.resolve(process.cwd(), "src/components/post/TagPeopleModal.tsx"),
  "utf8",
);

/** Comments explain the rules; they must never satisfy them. */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** The one line that carries the dialog's own classes. */
const dialogContentClasses = (): string => {
  const m = CODE.match(/<DialogContent\s+className="([^"]*)"/);
  expect(m, "<DialogContent> must carry a className").not.toBeNull();
  return m![1];
};

describe("the tag modal cannot grow taller than the screen", () => {
  it("caps the dialog height — the base DialogContent ships max-height: none", () => {
    expect(dialogContentClasses()).toMatch(/\bmax-h-\[\d+v[hw]\]/);
  });

  it("uses vh, never dvh — dvh needs Chromium 108 and these members are older", () => {
    // An unsupported unit is dropped silently: max-height falls back to `none`
    // and the bug returns on exactly the old Android WebViews that suffer most
    // (the same ones missing crypto.randomUUID — see src/lib/safeUuid.ts).
    expect(CODE).not.toMatch(/\b(max-h|h|max-w|w)-\[\d+dvh\]/);
  });

  it("lays the dialog out as a column so the body can be given the leftover space", () => {
    const c = dialogContentClasses();
    expect(c).toContain("flex");
    expect(c).toContain("flex-col");
  });

  it("gives the body its own scroll — anything that still overflows stays reachable", () => {
    expect(CODE).toMatch(/className="flex-1 min-h-0 overflow-y-auto/);
  });

  it("keeps min-h-0 on that body — without it the flex child refuses to shrink", () => {
    // This is the subtle one. A flex child defaults to min-height:auto, keeps
    // its full content height, and pushes the picker back off the screen —
    // silently recreating the exact bug while every other class looks right.
    const body = CODE.match(/className="flex-1([^"]*)"/);
    expect(body, "the scrollable body wrapper must exist").not.toBeNull();
    expect(body![1]).toContain("min-h-0");
  });

  it("bounds the photo box by height so the picker is reachable without scrolling", () => {
    expect(CODE).toMatch(/ref=\{photoRef\}[\s\S]{0,220}?max-w-\[\d+vh\]/);
  });
});

describe("the fix does not move anybody's pins", () => {
  it("the photo box is still square", () => {
    // A pin is stored as a percentage of THIS box. Change its aspect and every
    // pin moves relative to the photo, including tags already saved.
    expect(CODE).toMatch(/ref=\{photoRef\}[\s\S]{0,220}?aspect-square/);
  });

  it("coordinates are still measured from the box, as percentages", () => {
    expect(CODE).toContain("photoRef.current.getBoundingClientRect()");
    expect(CODE).toMatch(/\(\(e\.clientX - rect\.left\) \/ rect\.width\) \* 100/);
    expect(CODE).toMatch(/\(\(e\.clientY - rect\.top\) \/ rect\.height\) \* 100/);
  });

  it("tapping the photo still opens the picker", () => {
    expect(CODE).toMatch(/onClick=\{handlePhotoClick\}/);
    expect(CODE).toContain("setSearchOpen(true)");
  });

  it("the picker is anchored to the pin, not parked at the bottom of the dialog", () => {
    // Owner, 2026-08-10: "dont open the search box below of it, open the search
    // box small (now tooo big) but exactly where pointer marked". The old
    // full-width panel slid up from the dialog's foot — far from the pin, and
    // tall enough to push the dialog off the screen again.
    expect(CODE).toMatch(/left: `clamp\([^`]*\$\{pendingPin\.x\}%/);
    expect(CODE).toMatch(/top: `\$\{pendingPin\.y\}%`/);
  });

  it("clamps the picker inside the photo so an edge tap cannot push it off", () => {
    expect(CODE).toMatch(/clamp\(120px, .*calc\(100% - 120px\)\)/);
  });

  it("flips upward for a pin low in the frame", () => {
    expect(CODE).toMatch(/pendingPin\.y > 58/);
    expect(CODE).toMatch(/translate\(-50%, calc\(-100% - 16px\)\)/);
  });

  it("stops clicks inside the picker from moving the pin out from under you", () => {
    // Without this, every tap in the popover also reaches the photo's own
    // click handler and re-pins.
    expect(CODE).toMatch(/onClick=\{\(e\) => e\.stopPropagation\(\)\}\s*\n\s*className="absolute z-30 w-\[230px\]/);
  });
});

/**
 * ANYONE MAY TAG ANYONE — owner decision, 2026-08-10:
 * *"anyone tag anyone. not block it by ONLY friends"*.
 *
 * The danger in a change like this is deleting the consent step along with the
 * friendship requirement. These pin the two halves separately: the picker must
 * offer every member, AND the database must still refuse to publish a tag the
 * tagged person has not approved.
 */
describe("the picker offers every member, not only friends", () => {
  it("searches profiles, not the friendships table", () => {
    expect(CODE).toContain('.from("profiles_public_data")');
    expect(CODE).not.toContain('.from("friendships")');
    expect(CODE).not.toMatch(/\.eq\("status", "accepted"\)/);
  });

  it("never offers you yourself", () => {
    // post_tags_no_self_tag would refuse it anyway; failing in the picker is
    // kinder than failing after the member has pressed Done.
    expect(CODE).toMatch(/\.neq\("id", user\.id\)/);
  });

  it("filters server-side and bounds the result set", () => {
    // The member list only grows; shipping all of it to every phone does not.
    expect(CODE).toMatch(/\.ilike\("full_name", `%\$\{q\}%`\)/);
    expect(CODE).toMatch(/\.limit\(\d+\)/);
  });
});

describe("consent survived the change — the database still gates publication", () => {
  const SQL = fs.readFileSync(
    path.resolve(
      process.cwd(),
      "supabase/migrations/20260810120000_tag_anyone_not_only_friends.sql",
    ),
    "utf8",
  );
  /** Comments quote the rule being removed; they must not count as code. */
  const STATEMENTS = SQL.replace(/^\s*--.*$/gm, "");

  it("drops the friendship requirement", () => {
    expect(STATEMENTS).not.toMatch(/are_friends/);
    expect(STATEMENTS).not.toMatch(/You can only tag accepted friends/);
  });

  it("keeps the permanent decline — the anti-harassment rule", () => {
    // This matters MORE once any member may tag any other, not less.
    expect(STATEMENTS).toMatch(/status = 'declined'/);
    expect(STATEMENTS).toMatch(/previously declined your tag/);
  });

  it("keeps tag-as-yourself-only and the 20-per-post cap", () => {
    expect(STATEMENTS).toMatch(/new\.tagger_id <> auth\.uid\(\)/);
    expect(STATEMENTS).toMatch(/_tag_count >= 20/);
  });

  it("does not touch any SELECT policy — pending tags stay private", () => {
    // "Anyone views approved tags" is what keeps an unapproved tag invisible.
    // If a future edit drops or rewrites it, tagging becomes publishing.
    expect(STATEMENTS).not.toMatch(/policy[\s\S]{0,80}for select/i);
    expect(STATEMENTS).not.toMatch(/Anyone views approved tags/);
  });

  it("runs as one transaction so the insert path is never left half-defined", () => {
    expect(STATEMENTS).toMatch(/^begin;/m);
    expect(STATEMENTS).toMatch(/^commit;/m);
  });
});
