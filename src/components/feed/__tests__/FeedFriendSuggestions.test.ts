/**
 * FRIEND SUGGESTIONS IN THE FEED — APP ONLY, AFTER THE 10th POST.
 *
 * Owner request, 2026-08-04 (with an Instagram reference screenshot):
 * "friend suggestion will show only in App … after 10 feed post show this kind
 *  of left to right scrolled for friend suggestion."
 *
 * Why this needed building at all: suggestions live in the right sidebar, which
 * is `hidden xl:block` — desktop web only. App users had never been shown one.
 *
 * These pin the three things the owner actually specified (app-only, after 10
 * posts, horizontal scroll) plus the two policies this surface could quietly
 * break: the official account is follow-only, and no extra network call belongs
 * in the middle of the feed.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const strip = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const COMPONENT = "src/components/feed/FeedFriendSuggestions.tsx";
const raw = read(COMPONENT);
const body = strip(raw);
const feed = strip(read("src/pages/Feed.tsx"));
/** Everything from the first arrow onwards — asserted separately from the cards. */
const arrowsBlock = body.slice(body.indexOf("{canLeft && ("));

describe("it appears only in the installed app", () => {
  it("returns null on web", () => {
    expect(body).toMatch(/if \(!isNativeCapacitorApp\(\)\) return null;/);
  });

  it("decides that inside the component, not at the call site", () => {
    // If the caller owned the rule, the next place that renders this would have
    // to remember it. Same reasoning as RequireAuth and solidPillClass.
    expect(feed).toContain("<FeedFriendSuggestions />");
    expect(feed).not.toMatch(/isNativeCapacitorApp\(\)\s*&&\s*<FeedFriendSuggestions/);
  });
});

describe("it sits after the 10th post", () => {
  it("renders at zero-based index 9", () => {
    expect(feed).toMatch(/\{i === 9 && <FeedFriendSuggestions \/>\}/);
  });

  it("is inside the post loop, not outside it", () => {
    const at = feed.indexOf("i === 9 && <FeedFriendSuggestions");
    const loop = feed.indexOf("posts.map((post, i)");
    expect(loop).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(loop);
  });
});

describe("it scrolls left to right, like the reference", () => {
  it("is a horizontal rail, not a wrapping grid", () => {
    expect(body).toMatch(/overflow-x-auto/);
    expect(body).not.toMatch(/flex-wrap/);
  });

  it("snaps to card edges and does not drag the page sideways", () => {
    expect(body).toMatch(/snap-x/);
    expect(body).toMatch(/snap-start/);
    expect(body).toMatch(/overscroll-x-contain/);
  });

  it("cards keep their width inside the rail", () => {
    // Without shrink-0 the flex children would compress instead of scrolling.
    expect(body).toMatch(/shrink-0 w-\[\d+px\]/);
  });
});

describe("the member can SEE that there is more to the right (and to the left)", () => {
  /**
   * Owner, 2026-08-04, after seeing the first render:
   * "left to right scroller where? from right left too, mean a small arrow will
   *  make the user understand that there more will be seen."
   *
   * A rail that scrolls but shows no affordance reads as a row that just ends.
   * These pin the arrow in BOTH directions and — more importantly — pin the fact
   * that its visibility is MEASURED, not guessed from the number of cards.
   */
  it("has an arrow for each direction", () => {
    expect(body).toContain("ChevronLeft");
    expect(body).toContain("ChevronRight");
    expect(body).toMatch(/import \{[^}]*ChevronLeft[^}]*\} from "lucide-react"/);
  });

  it("shows each arrow only when the rail can actually move that way", () => {
    // Measured from the rail's own scroll geometry. A card-count rule would light
    // the right arrow on a wide phone where all the cards already fit.
    expect(body).toMatch(/setCanLeft\(el\.scrollLeft > EDGE_SLACK\)/);
    expect(body).toMatch(/setCanRight\(el\.scrollLeft \+ el\.clientWidth < el\.scrollWidth - EDGE_SLACK\)/);
    expect(body).toMatch(/\{canLeft && \(/);
    expect(body).toMatch(/\{canRight && \(/);
  });

  it("re-measures on every scroll and on resize", () => {
    // Without the scroll handler the arrows would be right once and wrong after.
    expect(body).toMatch(/onScroll=\{measure\}/);
    expect(body).toContain("ResizeObserver");
    expect(body).toMatch(/ro\.disconnect\(\)/);
  });

  it("measures before paint, so the arrow is there on the first frame", () => {
    expect(body).toContain("useLayoutEffect");
  });

  it("tolerates fractional scroll offsets at the end of the rail", () => {
    // scrollLeft + clientWidth is almost never exactly scrollWidth; without slack
    // the right arrow would stay lit forever on some devices.
    expect(body).toMatch(/const EDGE_SLACK = \d+;/);
  });

  it("a tap moves exactly one card, not an arbitrary distance", () => {
    expect(body).toMatch(/const CARD_STEP = 142;/); // 132px card + 10px gap
    expect(body).toMatch(/scrollBy\(\{ left: dir \* CARD_STEP, behavior: "smooth" \}\)/);
  });

  it("the arrows overlay the rail instead of taking space in it", () => {
    // If they were in the flow, showing or hiding one would shift every card.
    expect(arrowsBlock).toMatch(/absolute left-1 top-\[52px\]/);
    expect(arrowsBlock).toMatch(/absolute right-1 top-\[52px\]/);
  });

  it("sits over the photo, not over the name", () => {
    // Measured: the avatar's centre is 52px below the rail's top (4px rail
    // padding + 16px card padding + half of a 64px avatar). At the rail's
    // vertical midpoint the arrow covered the NAME — the one line on the card
    // that has to stay readable.
    expect(arrowsBlock).toMatch(/top-\[52px\] -translate-y-1\/2/);
    expect(arrowsBlock).not.toMatch(/top-1\/2 -translate-y-1\/2/);
  });

  it("the first card keeps its inset — snapping does not eat the padding", () => {
    // Measured without this: scrollLeft settled at 16 at rest, so the rail was
    // flush to the edge AND the left arrow lit up while sitting at the start.
    expect(body).toMatch(/scroll-px-4/);
  });

  it("the hidden arrow is unmounted, not just transparent", () => {
    // An invisible-but-present overlay would swallow the swipe it is meant to
    // advertise. `{canLeft && …}` removes it from the tree entirely.
    expect(arrowsBlock).not.toMatch(/opacity-0/);
    expect(arrowsBlock).not.toMatch(/invisible/);
  });

  it("the fade under the arrow cannot intercept a swipe", () => {
    expect(arrowsBlock).toMatch(/pointer-events-none absolute left-0/);
    expect(arrowsBlock).toMatch(/pointer-events-none absolute right-0/);
  });

  it("both arrows are labelled for screen readers", () => {
    expect(arrowsBlock).toMatch(/aria-label=\{t\("feedSuggest\.prev"/);
    expect(arrowsBlock).toMatch(/aria-label=\{t\("feedSuggest\.next"/);
  });
});

describe("policies this surface must not break", () => {
  it("never offers Add-friend for the official account", () => {
    // Standing owner rule: the official account is follow-only. A card for it
    // would be a button that can only fail.
    expect(body).toMatch(/adminIds\.has\(s\.id\)/);
  });

  it("goes through the shared mutation, not a raw insert", () => {
    // The mutation carries the follow-only policy and turns a duplicate request
    // into "Friend request already sent" instead of raw Postgres text.
    expect(body).toContain("useSendFriendRequest");
    expect(body).not.toMatch(/from\("friendships"\)\s*\.insert/);
  });

  it("adds no network call of its own", () => {
    // The feed was cut from 106 requests to 46 by removing duplicate reads;
    // this rail reuses the dashboard bootstrap payload.
    expect(body).toContain("useDashboardContext");
    expect(body).not.toMatch(/supabase\s*\.\s*from\(/);
  });

  it("renders nothing rather than an empty shell", () => {
    expect(body).toMatch(/people\.length === 0.*return null/s);
  });

  it("uses the shared identity block so badge rules apply here too", () => {
    expect(body).toContain("UserIdentityBlock");
  });

  it("shows the badge, on its own line, because the card is only 132px wide", () => {
    /**
     * Owner, 2026-08-04, with a screenshot: "Tanmay De and many others Badge is
     * not showing. Master formula was on each and every place Name with Badge
     * will show, here you missed."
     *
     * Inline, the badge row yields all spare width to the name (`shrink-[9999]`,
     * the fix for the name-overlap report) — and in a 132px card there is no
     * spare width, so the badge collapsed to nothing. Measured after stacking:
     * badge 70×17px, fully inside the card, 2px under the name.
     */
    const block = body.slice(body.indexOf("<UserIdentityBlock"), body.indexOf("/>", body.indexOf("<UserIdentityBlock")));
    expect(block).toMatch(/\bstack\b/);
    expect(block).toMatch(/align="center"/);
  });

  it("does not re-truncate the name — the identity block already does", () => {
    // Two `truncate` classes on the same text is harmless but hides which one
    // owns the behaviour; the block adds it itself.
    const block = body.slice(body.indexOf("<UserIdentityBlock"), body.indexOf("/>", body.indexOf("<UserIdentityBlock")));
    expect(block).not.toMatch(/nameClassName="[^"]*truncate/);
  });
});
