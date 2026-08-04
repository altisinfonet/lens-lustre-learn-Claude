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
});
