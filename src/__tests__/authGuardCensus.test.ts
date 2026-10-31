/**
 * MEMBERS-ONLY ROUTES SEND A LOGGED-OUT VISITOR TO /login.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG — owner requirement, 2026-08-03
 *
 * "Any link which is accessible to a logged-in user, if a logged-out user tries
 * to open it, the sign-in page must open automatically."
 *
 * There was no central guard. Every page hand-wrote its own
 * `if (!authLoading && !user) navigate("/login")` — a pattern that has to be
 * REMEMBERED, and nine pages forgot. Each was verified logged-out in a rendered
 * browser before the fix: /photos rendered a literally blank body,
 * /notifications claimed "Nothing here yet.", /profile rendered a fake
 * "Photographer" skeleton, /entry said "not found" for data the database
 * refuses to anonymous readers at all.
 *
 * The fix is <RequireAuth> in App.tsx wrapping an EXPLICIT route list. This
 * test pins that list and the guard's semantics, so a new members-only route
 * added as a bare sibling — the exact mistake that produced the nine — at least
 * fails to silently shrink the protected set.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "@/test-utils/sourceText";

const src = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
const body = stripComments(src).replace(/\/\/.*$/gm, "");

/** Everything between <Route element={<RequireAuth />}> and its closing tag. */
const guardedBlock = (() => {
  const open = body.indexOf("<Route element={<RequireAuth />}>");
  expect(open, "the RequireAuth wrapper route is missing from App.tsx").toBeGreaterThan(-1);
  const close = body.indexOf("</Route>", open);
  return body.slice(open, close);
})();

/** The nine routes proven broken logged-out on 2026-08-03. */
const MUST_BE_GUARDED = [
  'path="/profile" ',
  'path="/photos"',
  'path="/notifications"',
  'path="/entry/:entryId"',
  'path="/journal/new"',
  'path="/journal/edit/:id"',
  'path="/courses/new"',
  'path="/courses/edit/:id"',
  'path="/courses/:slug/lessons/:lessonId"',
];

describe("the members-only routes are inside RequireAuth", () => {
  it.each(MUST_BE_GUARDED)("%s is wrapped", (p) => {
    expect(guardedBlock).toContain(p);
  });

  it("none of them also exists as an unguarded sibling", () => {
    // A duplicate <Route> outside the wrapper would win or shadow — either way
    // the guard would be decorative for that path.
    const outside = body.replace(guardedBlock, "");
    for (const p of MUST_BE_GUARDED) {
      expect(outside, `${p} must appear ONLY inside RequireAuth`).not.toContain(`<Route ${p}`);
    }
  });
});

describe("the guard's semantics", () => {
  it("redirects to /login, replacing history", () => {
    expect(body).toMatch(/if \(!user\) return <Navigate to="\/login" replace \/>/);
  });

  it("waits for auth to resolve instead of bouncing a hydrating member", () => {
    // Redirecting while `loading` is true would kick every signed-in member to
    // /login on a slow connection — a worse bug than the one this fixes.
    const g = body.slice(body.indexOf("const RequireAuth"), body.indexOf("const RequireAuth") + 400);
    expect(g).toMatch(/if \(loading\) return <BrandLoader/);
    expect(g.indexOf("loading")).toBeLessThan(g.indexOf("!user"));
  });

  it("public-by-design routes are NOT wrapped", () => {
    // /hashtag says "public posts" in its own UI; /IDverification is the public
    // staff-card check; posts are anon-readable by RLS (share links).
    for (const p of ['path="/hashtag/:tag"', 'path="/post/:postId"', 'path="/IDverification"']) {
      expect(guardedBlock).not.toContain(p);
    }
  });
});
