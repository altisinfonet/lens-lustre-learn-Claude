/**
 * ALARMS FOR THE THING THAT CHECKS EVERYTHING ELSE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The screenshot harness is now the last gate before a build, so the harness
 * itself is the most dangerous code in the repository: if it lies, it lies
 * quietly, and it lies in the direction of "everything looks fine".
 *
 * IT ALREADY DID, ONCE, WITHIN AN HOUR OF BEING WRITTEN. The write rule matched
 * `POST /rest/v1/…`, and a Supabase RPC call IS a POST to `/rest/v1/rpc/<name>`
 * — so the feed's own RPC was answered with `[]`. The feed rendered a tidy
 * "No posts yet", the sweep reported zero problems, and the screenshot looked
 * entirely reasonable. It was caught by LOOKING at the picture and thinking
 * "the feed should have three posts in it".
 *
 * Every test below exists to make one of those lies loud.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EMPTY_BY_DESIGN_REASONS, FIXTURE_TABLE_NAMES, fixtureRoutes } from "@/uiharness/fixtureRoutes";
import { REAL_SCREEN_PREFIX, SIGNED_OUT_SCENES, providesOwnShell } from "@/uiharness/sceneConfig";
import { posts, profiles, postComments, profilesPublicData } from "@/uiharness/fixtures";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const BACKEND = read("src/uiharness/fakeBackend.ts");
const ROUTES = read("src/uiharness/fixtureRoutes.ts");
const REAL = read("src/uiharness/realScreens.tsx");
const MAIN = read("src/uiharness/main.tsx");

describe("an unanswered request is LOUD, never silently empty", () => {
  it("the fallback reports to the console before returning anything", () => {
    // The sweep counts console errors as problems, so this is what turns a
    // missing fixture into a failed gate instead of a tidy screenshot.
    const tail = BACKEND.slice(BACKEND.indexOf("NO FIXTURE"));
    expect(BACKEND).toMatch(/console\.error\(`\[harness\] NO FIXTURE/);
    expect(tail).toMatch(/unmatched\.push/);
  });

  it("an RPC is matched by NAME and never by the write rule", () => {
    // The exact bug: `POST /rest/v1/rpc/get_broadcast_feed` fell into the
    // "it's a write, answer []" branch and emptied the feed in silence.
    expect(ROUTES).toMatch(/rest\\\/v1\\\/rpc\\\//);
    const writeRule = ROUTES.slice(ROUTES.indexOf("// ── Writes."));
    expect(writeRule).toMatch(/if \(\/\^\\\/rest\\\/v1\\\/rpc\\\/\/\.test\(path\)\) return undefined;/);
  });

  /**
   * ASK THE ROUTES, DO NOT READ THEM.
   *
   * The first version of this test grepped the source for
   * `get_broadcast_feed:` and checked `posts.length > 2`. Both stayed true
   * when the handler was mutated to `() => []` — the mutation ESCAPED, and the
   * escaped mutation is precisely the original bug: an empty feed that reports
   * no problem. So run the routes and look at what comes back.
   */
  const ask = (method: string, path: string, search = "") => {
    const req = { method, path, params: new URLSearchParams(search), body: {} };
    for (const route of fixtureRoutes) {
      const reply = route(req);
      if (reply) return reply;
    }
    return undefined; // no route matched: this is the loud path
  };

  it("the feed RPC actually returns posts when it is called", () => {
    // A feed that renders "No posts yet" is the most convincing wrong
    // screenshot this harness can produce.
    const reply = ask("POST", "/rest/v1/rpc/get_broadcast_feed");
    expect(Array.isArray(reply?.body)).toBe(true);
    expect((reply?.body as unknown[]).length).toBeGreaterThan(2);
  });

  it("an UNKNOWN rpc is not answered at all — it must reach the loud path", () => {
    expect(ask("POST", "/rest/v1/rpc/some_function_nobody_fixtured")).toBeUndefined();
  });

  it("an unknown TABLE is not answered either", () => {
    expect(ask("GET", "/rest/v1/a_table_that_does_not_exist")).toBeUndefined();
  });

  it("a real table read comes back with rows, filtered by eq", () => {
    const reply = ask("GET", "/rest/v1/profiles", `id=eq.${profiles[0].id}`);
    expect((reply?.body as unknown[]).length).toBe(1);
  });

  it("a HEAD count reports the real number in content-range", () => {
    // supabase-js reads `count` from this header; a wrong one renders as
    // "0 comments" beside a thread that plainly has two.
    const reply = ask("HEAD", "/rest/v1/post_comments", `post_id=eq.${posts[0].id}`);
    expect(reply?.headers?.["content-range"]).toBe(`0-${postComments.length - 1}/${postComments.length}`);
  });

  it("the feed rows carry the author's identity, or the OLD path is photographed", () => {
    // useFeedQuery decides which code path to take from the SHAPE of the first
    // row — `"author_name" in first`. A fixture without it would silently
    // photograph the pre-20260813171159 behaviour.
    for (const p of posts) {
      expect(p.author_name).toBeTruthy();
      expect("thumbnail_urls" in p).toBe(true);
    }
  });

  it("every deliberately-empty table states WHY, in words", () => {
    // "Empty on purpose" and "nobody wrote a fixture" photograph identically.
    // The only thing separating them is this sentence.
    for (const [table, reason] of Object.entries(EMPTY_BY_DESIGN_REASONS)) {
      expect(reason.length, `${table} needs a real reason`).toBeGreaterThan(20);
    }
  });

  it("a table is never both answered and declared empty", () => {
    const both = FIXTURE_TABLE_NAMES.filter((t) => t in EMPTY_BY_DESIGN_REASONS);
    expect(both).toEqual([]);
  });
});

describe("the screen scenes mount the REAL pages", () => {
  it("every real screen imports a page from @/pages", () => {
    expect(REAL).toMatch(/import\("@\/pages\/Login"\)/);
    expect(REAL).toMatch(/import\("@\/pages\/Feed"\)/);
    expect(REAL).toMatch(/import\("@\/pages\/Profile"\)/);
    expect(REAL).toMatch(/import\("@\/pages\/PostDetail"\)/);
  });

  it("they are named with the prefix main.tsx keys off", () => {
    // A `screen-` scene brings its own router; wrapping it again threw
    // "You cannot render a <Router> inside another <Router>" and photographed
    // five blank pages.
    const keys = [...REAL.matchAll(/"(screen-[a-z-]+)":/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThanOrEqual(5);
    for (const k of keys) expect(providesOwnShell(k)).toBe(true);
    expect(REAL_SCREEN_PREFIX).toBe("screen-");
  });

  it("main.tsx installs the backend BEFORE it imports any app code", () => {
    // A static import of scenes.tsx would be hoisted above the install, the
    // Supabase client would capture the real fetch, and every real screen
    // would photograph a loading state.
    const install = MAIN.indexOf("installFakeBackend({");
    const dynamic = MAIN.indexOf('await import("./scenes")');
    expect(install).toBeGreaterThan(0);
    expect(dynamic).toBeGreaterThan(install);
    expect(MAIN).not.toMatch(/^import .* from "\.\/scenes";/m);
  });

  it("the signed-out list only names scenes that exist", () => {
    const keys = [...REAL.matchAll(/"(screen-[a-z-]+)":/g)].map((m) => m[1]);
    for (const name of SIGNED_OUT_SCENES) expect(keys).toContain(name);
  });

  it("a missing-data banner is drawn INTO the picture, not only the console", () => {
    // So that a person looking at the screenshot cannot mistake a data-starved
    // screen for an empty one.
    expect(REAL).toMatch(/data-testid="harness-missing-data"/);
    expect(REAL).toMatch(/unmatched\.length/);
  });
});

describe("the fixtures are the states worth photographing", () => {
  it("names are Title Case, because the app's rule is Title Case everywhere", () => {
    for (const p of profiles) {
      expect(p.full_name).not.toBe(p.full_name.toUpperCase());
    }
  });

  it("one member has NO avatar, so the initials fallback is in a picture", () => {
    expect(profiles.some((p) => p.avatar_url === null)).toBe(true);
  });

  it("one caption cannot wrap, which is what breaks a card at 360px", () => {
    // This fixture is what found the missing `break-words` on Caption: the
    // text ran 178px past the card and was sliced off mid-word.
    expect(posts.some((p) => p.content.length > 40 && !p.content.includes(" "))).toBe(true);
  });

  it("the photo shapes span the frame rule, not just 3:2", () => {
    const all = posts.flatMap((p) => p.image_urls).join(" ");
    expect(all).toMatch(/-w1200h1500/); // portrait, the 4:5 clamp
    expect(all).toMatch(/-w2400h900/);  // panorama, the 1.91:1 clamp
  });

  it("a five-figure count is present — the widest the counter ever gets", () => {
    expect(Math.max(...posts.map((p) => p.like_count))).toBeGreaterThan(9999);
  });

  it("the public view and the profiles table describe the SAME people", () => {
    // Two lists of the same members that could drift apart is a bug waiting to
    // be photographed as a feature.
    expect(profilesPublicData.map((p) => p.id)).toEqual(profiles.map((p) => p.id));
  });

  it("one comment is a REPLY, so the threaded indent is checked too", () => {
    expect(postComments.some((c) => c.parent_id !== null)).toBe(true);
  });
});

describe("the harness can still never reach a member", () => {
  it("the dev-only guard is intact", () => {
    expect(MAIN).toMatch(/if \(!import\.meta\.env\.DEV\)/);
  });

  it("no app module is imported before the backend is installed", () => {
    const head = MAIN.slice(0, MAIN.indexOf("installFakeBackend({"));
    expect(head).not.toMatch(/from "@\//);
  });

  it("the fake backend imports nothing from the app", () => {
    // An app import here would be hoisted above the installation.
    expect(BACKEND).not.toMatch(/from "@\//);
  });
});
