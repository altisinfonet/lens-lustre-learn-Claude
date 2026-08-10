/**
 * THE CHROME AROUND THE FEED IS INSTAGRAM'S: NO TITLE, NO BOXES, NO CAPTIONS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Four separate instructions from the owner on 2026-08-10, each after looking
 * at the previous build on his phone. They are guarded together because they
 * are one idea — everything that framed a post as a "card in a page" is gone —
 * and because each of them is a one-line revert away from coming back.
 *
 * 1. "Dont Wrote News feed, your feed etc on the Top, refresh icon It must be
 *    like Instagram", and when asked whether he meant the app: "Dont show it
 *    anywhere neither on Web nor in App."
 *
 *    Removing the refresh BUTTON loses nothing: the feed is already wrapped in
 *    <PullToRefresh onRefresh={refetch}>, which is how Instagram refreshes.
 *    That wrapper is asserted below, because deleting the button would only be
 *    safe while it exists.
 *
 * 2. "I told No border anything to anywhere, example like Instagram, didnt do
 *    it it." PostCard had been made full-bleed; the two OTHER things the feed
 *    renders between posts had not, so they sat inset inside `.container`'s 90%
 *    with their own border and rounded corners. Those are the inset panels in
 *    his screenshot.
 *
 * 3. "Spoensored Ads are coming lower size, that not fixed. For this update
 *    required in the Admin Ad section too, mention correct size there... show
 *    it fullview without border."
 *
 *    The ad looked smaller than the posts for exactly the reason above, and the
 *    admin guidance said "tall (like a phone photo)", which invites 1080 × 1920
 *    into a box that crops to 4:5 and loses a third of the picture.
 *
 * 4. The bottom bar's words. Offered the choice, he took Instagram's: icons
 *    only. The words were 9px uppercase, which the 12px readability floor he
 *    asked for earlier the same day was raising to 12px.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Comments stripped: several of these files EXPLAIN what was removed. */
const code = (p: string) =>
  readFileSync(join(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const feed = code("src/pages/Feed.tsx");
const nav = code("src/components/MobileBottomNav.tsx");
const adZone = code("src/components/ads/AdZone.tsx");
const suggestions = code("src/components/feed/FeedFriendSuggestions.tsx");
const adminAds = code("src/components/admin/ads/AdminAdsV2.tsx");

describe("the feed starts at the first post", () => {
  it("renders no title above the posts", () => {
    expect(feed, "the 'News Feed' eyebrow is back").not.toContain("feed.newsFeed");
    expect(feed, "the 'Your Feed' heading is back").not.toContain("feed.yourFeed");
    expect(feed, "a heading element above the feed is back").not.toMatch(/<h1[\s>]/);
  });

  it("renders no refresh button", () => {
    expect(feed).not.toContain("RefreshCw");
  });

  it("still refreshes by pulling down, which is what replaces the button", () => {
    // Deleting the button is only safe while this exists. If PullToRefresh ever
    // goes, a member has no way to refresh at all.
    expect(feed).toMatch(/<PullToRefresh onRefresh=\{async \(\) => \{ await refetch\(\); \}\}>/);
  });

  it("refreshes on a COMPUTER too, where there is no finger to pull with", () => {
    // The mistake this pins: PullToRefresh listened to onTouchStart/Move/End and
    // nothing else, so on a desktop it did nothing at all. That was invisible
    // while the feed still had a refresh button — and when the button was
    // removed, a desktop member was left with no way to refresh but reloading
    // the page. Overscrolling upward with the wheel is the desktop equivalent
    // and adds no control to the screen, which is what the owner asked for.
    const ptr = code("src/components/PullToRefresh.tsx");
    expect(ptr, "the wheel handler is gone — desktop cannot refresh again").toContain("onWheel={handleWheel}");
    expect(ptr).toContain("WHEEL_THRESHOLD");
    // It may only arm at the very top, and only while scrolling UP.
    expect(ptr).toContain("window.scrollY > 0");
    expect(ptr).toContain("e.deltaY >= 0");
    // Nothing may preventDefault: the page must scroll and select exactly as
    // before, and the worst case of a false trigger is one extra fetch.
    expect(ptr, "preventDefault here would break normal scrolling").not.toContain("preventDefault");
  });
});

describe("nothing in the feed is drawn as an inset box", () => {
  it("gives the sponsored story card the same full width as a post", () => {
    const frame = adZone.slice(adZone.indexOf('"story-card": {'), adZone.indexOf('lightbox: {'));
    expect(frame).toContain("bleed-phone");
    expect(frame, "the ad's own border is what made it look smaller than a post")
      .not.toMatch(/border border-border/);
    expect(frame).not.toMatch(/rounded/);
    // And no hairline either — "instagram has no border, why kept ??"
    expect(frame).not.toMatch(/border/);
  });

  it("gives the sponsored card a post header — avatar, name, and Sponsored", () => {
    // Owner, 2026-08-10, with our feed beside Instagram's: "our site vs
    // Instagram.... see space between posts inclusing spoesnored posts too".
    // On Instagram an ad IS a post — 32px avatar, advertiser name in bold, "Ad"
    // beneath. Ours printed the bare word "Sponsored" with no avatar and no
    // name, hard against the previous post's caption.
    const header = adZone.slice(adZone.indexOf('{zone === "story-card" && ('));
    const block = header.slice(0, header.indexOf("{/* GOOGLE"));
    // The numbers are PostCard's header, copied so both start at the same
    // height and the feed reads as one rhythm.
    expect(block, "the ad header must match the post header exactly")
      .toContain('className="flex items-center gap-2.5 p-3 pb-2"');
    expect(block).toContain('className="w-8 h-8 rounded-full object-cover"');
    expect(block).toContain('className="text-sm font-semibold truncate"');
    // The blue tick. Owner: "after 50mm retina world why verified blue tick
    // missing here ??" — every other post by this same account carries it, and
    // a name verified on one card but not the next reads as a different
    // account. Same glyph and same 14px size UserBadgeInline uses.
    expect(block, "the ad header lost its verified tick").toContain('<VerifiedBadge className="h-3.5 w-3.5" />');
    expect(block).toContain('className="text-xs text-muted-foreground"');
    expect(block).toContain("Sponsored");
    expect(block, "the bare one-word label is back").not.toMatch(
      /<div className="px-3 pt-2\.5 pb-2 text-xs text-muted-foreground"/,
    );
    const post = code("src/components/post/PostCard.tsx");
    expect(post, "PostCard's header moved — the ad header has to follow it")
      .toContain('className="flex items-center gap-2.5 p-3 pb-2"');
  });

  it("keeps the 4:5 crop the admin guidance promises", () => {
    expect(adZone).toMatch(/aspect: "4 \/ 5"/);
  });

  it("adds no gap around the ad in the feed", () => {
    expect(feed, "a margin around the ad reintroduces the inset look")
      .not.toMatch(/feed-ad-\$\{slot\}`\} className="mb-4"/);
  });

  it("gives the people-you-may-know rail the same full width", () => {
    const section = suggestions.slice(suggestions.indexOf("<section"), suggestions.indexOf("</section>"));
    expect(section.slice(0, 400)).toContain("bleed-phone");
    const opening = section.slice(0, section.indexOf(">") + 1);
    expect(opening).not.toMatch(/border/);
    expect(opening).not.toMatch(/rounded/);
  });
});

describe("the composer is shaped like a post", () => {
  const wall = code("src/components/WallPosts.tsx");

  it("wears one hairline and no box, on every screen size", () => {
    // Measured live on 2026-08-10 AFTER the posts were fixed: the composer was
    // still 0.8px on all four sides while every post under it had only its
    // bottom hairline. It was the last `md:border` left in the feed.
    expect(wall).toContain('className="bleed-phone mb-4 overflow-hidden"');
    expect(wall, "the composer's desktop card is back").not.toContain("md:border");
  });
});

describe("the bottom bar is icons only", () => {
  it("writes no word under any icon", () => {
    expect(nav, "the tab captions are back").not.toContain("tab.labelKey ? t(tab.labelKey) : tab.label");
    expect(nav).not.toContain('t("nav.profile")');
    expect(nav, "uppercase 9px captions were the heaviest thing in the bar")
      .not.toMatch(/text-\[9px\] tracking-\[0\.1em\] uppercase/);
  });

  it("centres the icons now that they have nothing to sit above", () => {
    // `items-end` existed to hang each icon above its caption.
    expect(nav).toContain("flex items-center justify-around h-14");
    expect(nav).not.toContain("flex items-end justify-around h-14");
  });

  it("uses Instagram's 24px icon", () => {
    expect(nav).toMatch(/<tab\.icon className=\{`h-6 w-6/);
  });
});

describe("the admin is told the size the feed ad is actually cropped to", () => {
  const guide = adminAds.slice(adminAds.indexOf('"story-card": {'), adminAds.indexOf('lightbox: {'));

  it("states 1080 x 1350 and names the ratio", () => {
    expect(guide).toContain("1080 × 1350");
    expect(guide).toContain("4:5");
  });

  it("no longer describes it as a full phone photo", () => {
    // "tall (like a phone photo)" is what invited 1080 x 1920 into a 4:5 crop.
    expect(guide).not.toContain("like a phone photo");
    expect(guide).not.toContain("Make it tall, not wide.");
  });

  it("warns what happens to a picture of the wrong shape", () => {
    expect(guide).toContain("1080 × 1920");
    expect(guide.toLowerCase()).toContain("crop");
  });

  it("tells the admin it runs edge to edge", () => {
    expect(guide.toLowerCase()).toContain("edge to edge");
    expect(guide.toLowerCase()).toContain("no border");
  });
});

describe("nothing on the site is set in capitals or stretched apart", () => {
  const raw = readFileSync(join(process.cwd(), "src/index.css"), "utf8");
  /**
   * lastIndexOf, not indexOf: the phrase "INSTAGRAM TYPE" also appears earlier
   * in the file, in the comment that points at this block. And the comments are
   * stripped before anything is asserted, because the block's own prose names
   * `tracking-tight` and quotes font sizes — a source-scanning test that reads
   * its own documentation is the trap this project has fallen into three times.
   */
  const block = raw
    .slice(raw.lastIndexOf("INSTAGRAM TYPE"))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[\s\S]*?═══ \*\//, "");

  it("exists at all", () => {
    expect(raw, "the INSTAGRAM TYPE block is gone from src/index.css").toContain("INSTAGRAM TYPE");
  });

  it("turns off uppercase wherever it is applied", () => {
    // `uppercase` appears 1,637 times in src/. This is the one place it can be
    // switched off without touching any of them.
    expect(block).toMatch(/\[class\*="uppercase"\]\s*\{\s*text-transform:\s*none;/);
  });

  it("removes wide letter-spacing, including every arbitrary value", () => {
    // tracking-[0.15em] alone is used 534 times; an enumerated list would go
    // stale the first time somebody writes a new value.
    expect(block).toContain('[class*="tracking-["]');
    for (const named of [".tracking-wide", ".tracking-wider", ".tracking-widest"]) {
      expect(block).toContain(named);
    }
    expect(block).toMatch(/letter-spacing:\s*normal;/);
  });

  it("leaves the NEGATIVE tracking on display headings alone", () => {
    // tracking-tight and tracking-tighter pull letters together; they are part
    // of the headline style and were never what made text look big.
    expect(block).not.toContain("tracking-tight");
    expect(block).not.toContain("tracking-tighter");
  });

  it("changes no font size, so the readability floor still stands", () => {
    // The owner asked for smaller-LOOKING text on the same day he asked that
    // nothing render under 12px. Both hold only because this block touches
    // casing and spacing and nothing else.
    expect(block).not.toMatch(/font-size/);
    expect(raw).toMatch(/font-size:\s*12px/);
  });

  it("also drops the 0.02em that was added to all small text", () => {
    const baseRule = raw.slice(raw.indexOf("small, label, .text-xs"));
    expect(baseRule.slice(0, 200)).toMatch(/letter-spacing:\s*normal;/);
  });
});
