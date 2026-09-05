import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { memberPath } from "@/lib/urlHelpers";

/**
 * F-95 — NO PART OF THE APP MAY BUILD A NAVIGABLE /profile/<id> ADDRESS.
 *
 * The edge redirect in functions/profile/[id].ts answers a real HTTP request,
 * which is every hard load, every shared link and every crawler. It cannot see
 * an in-app <Link>: that is a client-side navigation that never leaves the
 * browser. So the address bar shows the id and keeps it, and the Owner's rule —
 * any link always shows the name link — is broken on exactly the journey he
 * takes most, clicking a member out of his own feed.
 *
 * This is the check that says the app no longer does that. It reads source
 * rather than behaviour on purpose: a rendering test can only cover the screens
 * someone remembered to write a test for, and the failure here is one of
 * omission across thirty files. Source is the only place the whole set is
 * visible at once.
 *
 * WHAT COUNTS AS NAVIGATIONAL: anything whose value becomes an address the
 * browser will show — to=, href=, navigate(), .push(), .replace(),
 * location.href, redirect(), and linkTo=, which UserIdentityBlock passes
 * straight into a <Link to>. A string in a comment or a route PATTERN
 * (path="/profile/:userId") is neither, and neither is matched.
 *
 * THE ROUTE ITSELF STAYS. /profile/:userId must keep working — old links,
 * bookmarks and shared URLs depend on it, and the edge function's whole job is
 * to redirect TO the name when one exists. What must stop is the app GENERATING
 * those addresses.
 */
/**
 * ANY construction of a /profile/<id> ADDRESS, anywhere in src.
 *
 * ⚠ THIS DELIBERATELY DOES NOT LOOK FOR A NAVIGATION TOKEN, AND THAT IS THE
 * WHOLE CORRECTION. The first version of this check bridged from `to=` / `href=`
 * / `navigate(` to the id url with [^`"'\n]{0,80} — a character class that
 * excludes backticks. In a ternary the FIRST branch is a template literal, so a
 * backtick always sits between the token and the fallback:
 *
 *     to={p?.custom_url ? `/${p.custom_url}` : `/profile/${user?.id}`}
 *
 * and the pattern could never reach it. EVERY ternary fallback in the codebase
 * was invisible, and four survived in src/pages/Profile.tsx while this check
 * reported zero. The Auditor found them by reading; the check could not have
 * failed on that shape, which makes it a C-34 failure of the instrument itself.
 *
 * Dropping the bridge fixes three things at once. Ternary fallbacks are caught,
 * because nothing has to sit adjacent to the token. A token and an id url split
 * across two lines of a JSX prop are caught, because proximity is no longer
 * part of the rule — the old line-by-line scan could not have seen that shape
 * either, and neither could the Auditor's. And a NON-navigational id url is
 * caught too: Profile.tsx built one inside publicUrl() to show the member their
 * own address to copy, which is not a link at all but is still an id url put in
 * front of a person.
 *
 * The cost of dropping the bridge is that this now bans BUILDING the string,
 * not just navigating to it. That is the right rule: there is no longer any
 * legitimate reason for the client to compose this address. The edge function
 * composes it (functions/, not scanned here) and the route PATTERN declares it
 * (no `${`, so not matched).
 */
const ID_ADDRESS = /\/profile\/(?:\$\{|"\s*\+|'\s*\+|\$\{?\s*\w+\s*\})/;

/**
 * Comments stripped before matching, the same way loggingStandard.test.ts does
 * it and for the same reason: this rule has to be explained in the files it
 * governs, and a naive search cannot tell an explanation from a violation.
 * Anchored to ^ because a greedy block-comment match eats real code — see the
 * note in that file about 20 000 characters of WallPosts.tsx disappearing.
 */
const strip = (s: string) =>
  s
    .replace(/^\s*\/\*[\s\S]*?\*\//gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "");

function offenders(): Array<{ file: string; line: number; text: string }> {
  const root = process.cwd();
  const files = execSync("find src -name '*.ts' -o -name '*.tsx'", { cwd: root, encoding: "utf8" })
    .trim()
    .split("\n")
    .filter((f) => !f.includes("__tests__") && !f.includes("/uiharness/") && !f.includes("/test/"));

  const found: Array<{ file: string; line: number; text: string }> = [];
  for (const file of files) {
    const lines = strip(readFileSync(join(root, file), "utf8")).split("\n");
    lines.forEach((ln, i) => {
      if (ID_ADDRESS.test(ln)) found.push({ file, line: i + 1, text: ln.trim().slice(0, 120) });
    });
  }
  return found;
}

describe("F-95 — the app never builds a navigable /profile/<id> address", () => {
  it("no source file constructs one", () => {
    const found = offenders();
    const report = found.map((f) => `  ${f.file}:${f.line}\n      ${f.text}`).join("\n");
    expect(
      found.length,
      `${found.length} navigational /profile/<id> link(s) remain across ` +
        `${new Set(found.map((f) => f.file)).size} file(s):\n${report}\n\n` +
        `Each must take the member's HANDLE instead. The handle arrives with the ` +
        `name — see ProfileMapEntry.custom_url — so any place that can render a ` +
        `name can build the address. Where there is no handle, render the name as ` +
        `plain text; never fall back to the id.`,
    ).toBe(0);
  });

  it("the check can actually see a violation (it is not a vacuous zero)", () => {
    // Guards the guard: if the regex or the file walk silently stopped matching,
    // the assertion above would pass for the wrong reason and this whole unit
    // would become decoration.
    expect(ID_ADDRESS.test('const x = <Link to={`/profile/${post.user_id}`}>n</Link>;')).toBe(true);
    expect(ID_ADDRESS.test('  linkTo={`/profile/${u.id}`}')).toBe(true);
    expect(ID_ADDRESS.test('  <a href={`/profile/${u.id}`} target="_blank">')).toBe(true);
    expect(ID_ADDRESS.test('  navigate(`/profile/${id}`, { replace: true })')).toBe(true);
  });

  it("SEES THE TERNARY FALLBACK — the shape that got past the first version", () => {
    // These four lived in src/pages/Profile.tsx while the check reported 0.
    expect(ID_ADDRESS.test(
      "to={p?.custom_url ? `/${p.custom_url}` : `/profile/${user?.id}`}",
    )).toBe(true);
    expect(ID_ADDRESS.test(
      "<Link to={p?.custom_url ? `/${p.custom_url}?section=wall` : `/profile/${user?.id}?section=wall`}>",
    )).toBe(true);
  });

  it("SEES AN ID URL THAT IS NOT A LINK AT ALL", () => {
    // Profile.tsx showed the member their own id address to copy and share.
    // Not navigation, still an id url put in front of a person.
    expect(ID_ADDRESS.test("publicUrl(`/profile/${user?.id}`)")).toBe(true);
  });

  it("SEES A TOKEN AND AN ID URL SPLIT ACROSS LINES", () => {
    // Neither the old check nor the Auditor's could have: both bridged from the
    // token on a single line. This one does not bridge at all, so the split is
    // irrelevant — the second line matches on its own.
    const lines = ["                  to={", "                    `/profile/${u.id}`", "                  }"];
    expect(lines.some((l) => ID_ADDRESS.test(l))).toBe(true);
  });

  it("does not flag the route pattern or a comment, which are not addresses", () => {
    expect(ID_ADDRESS.test('<Route path="/profile/:userId" element={<PublicProfile />} />')).toBe(false);
    expect(strip(' // navigate(`/profile/${id}`) used to happen here').trim()).toBe("");
  });

  it("memberPath never yields an id address, for any input", () => {
    /*
     * GUARDS A HOLE THIS CHECK HAD, found by planting.
     *
     * The scan above reads call sites, so it sees a literal `/profile/${id}`
     * written into a to= or href=. It cannot see the rule being broken one
     * level down: restoring the id fallback INSIDE memberPath() puts the id
     * back into every address in the app while every call site still reads
     * `handle={...}` and the scan still passes. Planted exactly that and it
     * came back green, which is how this test came to exist.
     *
     * So the helper is asserted on behaviour, not on its text.
     */
    for (const input of ["liwei", "phani.anindya", "", "   ", null, undefined]) {
      const out = memberPath(input);
      if (out !== null) expect(out.startsWith("/profile/")).toBe(false);
    }
    expect(memberPath(null)).toBeNull();
    expect(memberPath("")).toBeNull();
    expect(memberPath("   ")).toBeNull();
    expect(memberPath("liwei")).toBe("/liwei");
  });

  it("the /profile/:userId route still exists — this rule removes links, not the route", () => {
    const app = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
    expect(app).toContain("/profile/:userId");
  });
});
