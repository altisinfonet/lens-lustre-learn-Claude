/**
 * The guard that keeps every call to our own Pages Functions on ONE path:
 * src/lib/net/siteApi.ts (siteFetch / siteUrl / SITE_API).
 *
 * Why it exists: Android app 1.2.22 (2026-10-17) could not play or upload a
 * single video, because playGrant.ts and the upload runner asked RELATIVE URLs
 * ("/api/video/play-token") that, inside the app's https://localhost WebView,
 * go to the phone instead of the site. Every test passed, because every test
 * ran on the web, where relative is right.
 *
 * Two rules, read from the TypeScript AST (comments and prose never trip it):
 *   own-origin-route  a string or template literal starting with a Pages
 *                     Function prefix (/api/, /config/) anywhere outside
 *                     siteApi.ts — routes are named once, in SITE_API;
 *   relative-fetch    fetch / new Request / sendBeacon / EventSource /
 *                     XMLHttpRequest.open given a literal that starts with "/"
 *                     (but not "//") — the call would leave the app for
 *                     https://localhost.
 *
 * Shown red on planted shapes, clean on the real tree, and red again when the
 * real fixed call site is put back the way it was (fail-first on real code).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const HELPER = "src/lib/net/siteApi.ts";
const ROUTE_PREFIXES = ["/api/", "/config/"];

type V = { file: string; line: number; rule: "own-origin-route" | "relative-fetch"; text: string };

function literalText(n: ts.Node): string | null {
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isTemplateExpression(n)) return n.head.text;
  return null;
}

const isRelative = (s: string) => s.startsWith("/") && !s.startsWith("//");

function scanText(src: string, file: string): V[] {
  if (file.replace(/\\/g, "/").endsWith(HELPER)) return [];
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: V[] = [];
  const at = (n: ts.Node, rule: V["rule"]) =>
    out.push({ file, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, rule, text: n.getText(sf).slice(0, 120) });
  const visit = (n: ts.Node) => {
    const lit = literalText(n);
    if (lit !== null && ROUTE_PREFIXES.some((p) => lit.startsWith(p))) at(n, "own-origin-route");
    if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
      const callee = n.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
      const args = n.arguments ?? ts.factory.createNodeArray();
      const target =
        name === "fetch" || name === "sendBeacon" || name === "Request" || name === "EventSource" ? args[0]
        : name === "open" && args.length >= 2 && literalText(args[0]) !== null && /^[A-Z]+$/.test(literalText(args[0]) ?? "") ? args[1]
        : undefined;
      const t = target ? literalText(target) : null;
      if (t !== null && isRelative(t)) at(n, "relative-fetch");
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e === "__tests__" || e === "node_modules") continue;
      walk(p, acc);
    } else if (/\.(ts|tsx)$/.test(e) && !/\.(test|spec)\.tsx?$/.test(e) && !e.endsWith(".d.ts")) acc.push(p);
  }
  return acc;
}

const rules = (src: string, file = "t.ts") => scanText(src, file).map((v) => v.rule).sort();

describe("site API guard — shapes", () => {
  const CASES: Array<[string, string, V["rule"][]]> = [
    ["the 1.2.22 bug: fetch of a relative /api route", `await fetch("/api/video/play-token", { method: "POST" });`, ["own-origin-route", "relative-fetch"]],
    ["a route held in a constant, fetched later", `const EDGE = "/config/site-settings"; await fetch(EDGE);`, ["own-origin-route"]],
    ["a route passed to some other wrapper", `await d.api("/api/video/complete", {});`, ["own-origin-route"]],
    ["a template route", "await fetch(`/api/video/${id}`);", ["own-origin-route", "relative-fetch"]],
    ["any relative fetch at all", `await fetch("/some/new/thing");`, ["relative-fetch"]],
    ["new Request with a relative URL", `new Request("/x");`, ["relative-fetch"]],
    ["sendBeacon with a relative URL", `navigator.sendBeacon("/beacon", b);`, ["relative-fetch"]],
    ["XHR open with a relative URL", `x.open("POST", "/upload");`, ["relative-fetch"]],
    ["absolute Supabase URL is fine", "await fetch(`${SUPABASE_URL}/rest/v1/x`);", []],
    ["a presigned absolute URL is fine", `await fetch(url, { method: "PUT" });`, []],
    ["protocol-relative is not 'relative to the page'", `await fetch("//cdn.example.com/a.js");`, []],
    ["the helper call is fine", `await siteFetch(SITE_API.videoPlayToken, {});`, []],
    ["a route in a comment is fine", `// fetch("/api/video/play-token")\n/* "/config/site-settings" */ const a = 1;`, []],
    ["an SPA route string is fine", `navigate("/profile/abc"); const to = "/feed";`, []],
  ];
  it.each(CASES)("%s", (_n, src, want) => {
    expect(rules(src)).toEqual(want);
  });
  it("parses .tsx with JSX around the call", () => {
    expect(rules(`export const X = () => { void fetch("/api/x"); return <div a="1" />; };`, "x.tsx")).toEqual(["own-origin-route", "relative-fetch"]);
  });
  it("the helper itself is the one place routes may be written", () => {
    expect(scanText(readFileSync(HELPER, "utf8"), HELPER)).toEqual([]);
    expect(readFileSync(HELPER, "utf8")).toContain('"/api/video/play-token"');
  });
});

describe("site API guard — the real tree", () => {
  it("src/ has zero relative own-origin calls outside siteApi.ts", () => {
    const files = walk("src");
    const v = files.flatMap((f) => scanText(readFileSync(f, "utf8"), f));
    expect(v).toEqual([]);
    // A scan that read nothing would also be "clean".
    expect(files.length).toBeGreaterThan(300);
  }, 120_000); // parses every file in src/ — slow on a cold Windows disk

  it("goes red when the play-token call is put back the way 1.2.22 shipped it (fail-first on real code)", () => {
    const path = "src/lib/video/playGrant.ts";
    const real = readFileSync(path, "utf8");
    expect(scanText(real, path)).toEqual([]);
    const mutated = real.replace("siteFetch(SITE_API.videoPlayToken,", 'fetch("/api/video/play-token",');
    expect(mutated).not.toBe(real);
    expect(scanText(mutated, path).map((x) => x.rule).sort()).toEqual(["own-origin-route", "relative-fetch"]);
  });

  it("goes red when an upload route is written inline again", () => {
    const path = "src/lib/video/uploadJobs.ts";
    const real = readFileSync(path, "utf8");
    expect(scanText(real, path)).toEqual([]);
    const mutated = real.replace("d.api(SITE_API.videoUploadUrls,", 'd.api("/api/video/upload-urls",');
    expect(mutated).not.toBe(real);
    expect(scanText(mutated, path).map((x) => x.rule).sort()).toEqual(["own-origin-route"]);
  });

  it("goes red when site-settings names its route inline again", () => {
    const path = "src/lib/siteSettingsCache.ts";
    const real = readFileSync(path, "utf8");
    const mutated = real.replace("const EDGE_PATH = SITE_API.siteSettings;", 'const EDGE_PATH = "/config/site-settings";');
    expect(mutated).not.toBe(real);
    expect(scanText(mutated, path).map((x) => x.rule).sort()).toEqual(["own-origin-route"]);
  });
});
