/**
 * CREDIT FIX U1 · RATCHET — no component PAINTS a member photo URL raw.
 *
 * Review of #874: ProfilePostGrid (tile fallback, showcase band) and
 * ScheduledPostsList painted `image_urls[0]` as is — so a stale `-l4` row
 * painted (and right-click saved) the big-credit master, and a `-l4f` row
 * painted the competition full size. The rule: every `<img src>` built from a
 * member photo field (`image_url`, `image_urls`) goes through the shared helper
 * (src/lib/photoProtection.ts memberPhotoSrc / memberPhotoFallbackSrc, or the
 * ladder helpers), which returns the clean copy of a set photo and an old URL
 * unchanged. Full-screen viewers (ZoomableImage, Lightbox, PostMedia,
 * FacebookPhotoGrid) take the stored URL as a prop and resolve it themselves.
 *
 * Checked: the `src={…}` of every `<img` and `<motion.img` in src/components and
 * src/pages — the expression itself, and the `const`/`let` it names (one hop).
 * Fields: `image_url`, `image_urls`, `imageUrls` (what postMedia() returns) and
 * `.photos[n]` (competition entries).
 * Not member photos (and so not checked): judging stamps / tags, banners, ads,
 * course and lesson images — matched by the object's full name, or by file
 * (NOT_MEMBER_FILES), never by a one-letter name a posts `.map` could also use.
 * Props and destructuring are not followed: that hole closes with the one
 * `<Photo>` component (central plan P2/P3).
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..", "..", "..");
const DIRS = ["src/components", "src/pages"];
/** Advertising creatives are not member photos. */
const SKIP_DIRS = new Set(["src/components/ads", "src/components/admin/ads"]);
/** Helpers that resolve a member photo URL to a paintable (clean) copy. */
const HELPER_NAMES = "memberPhotoSrc|memberPhotoFallbackSrc|inlinePhotoUrl|photoSetUrl|photoSetCleanUrl|photoSetGridUrl|tileSrc|tileFallbackSrc|showcaseSrc|optimizeGalleryImageUrl";
const HELPER_CALL = new RegExp(`\\b(?:${HELPER_NAMES})\\s*\\(`, "g");
/** The same field on a stamp / tag / banner / ad / course record is not a member photo. */
const NON_MEMBER = /\b(?:tag|stamp|banner|ad|creative|lesson|course)\??\.image_url\b/g;
/** Whole files whose images are not member photos, each with its reason. */
const NOT_MEMBER_FILES = new Set<string>([
  "src/components/JuryImageViewer.tsx", // the jury judges the full competition file, signed-in jury only
  "src/components/admin/AdminEntriesSection.tsx", // admin review of the full entry
  "src/components/admin/AdminBanners.tsx", // site banners
  "src/pages/AdDetail.tsx", // ad creatives
]);

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "__tests__" || name === "node_modules" || SKIP_DIRS.has(relative(ROOT, p).replace(/\\/g, "/"))) continue;
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

/** The text inside the braces that open at `open` (index of "{"). */
function braced(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") { depth--; if (depth === 0) return text.slice(open + 1, i); }
  }
  return text.slice(open + 1);
}

/** The expression with every helper call (and its arguments) removed. */
function withoutHelperCalls(expr: string): string {
  let out = expr;
  for (;;) {
    HELPER_CALL.lastIndex = 0;
    const m = HELPER_CALL.exec(out);
    if (!m) return out;
    let depth = 0;
    let end = out.length;
    for (let i = m.index + m[0].length - 1; i < out.length; i++) {
      if (out[i] === "(") depth++;
      else if (out[i] === ")") { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    out = `${out.slice(0, m.index)}__helper__${out.slice(end)}`;
  }
}

/** A member photo field used OUTSIDE any helper call. */
function rawMember(expr: string): boolean {
  return /\bimage_urls?\b|\bimageUrls\b|\.photos\??\.?\[/.test(withoutHelperCalls(expr).replace(NON_MEMBER, ""));
}

/** The JSX tag that opens at `start`, whatever its length: ends at the first `>` outside braces. */
function jsxTag(text: string, start: number): string {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") depth--;
    else if (text[i] === ">" && depth === 0) return text.slice(start, i + 1);
  }
  return text.slice(start);
}

/** Every raw member-photo paint in one file's text. */
function scan(text: string, rel: string): string[] {
  const out: string[] = [];
  const imgRe = /<(?:img|motion\.img)\b/g;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(text))) {
    const tag = jsxTag(text, m.index);
    const s = /\ssrc=\{/.exec(tag);
    if (!s) continue;
    const expr = braced(tag, s.index + s[0].length - 1);
    const line = text.slice(0, m.index).split("\n").length;
    if (rawMember(expr)) { out.push(`${rel}:${line} src={${expr.trim()}}`); continue; }
    // one hop: an identifier the expression names (outside helper calls), declared in this file
    const ids = (withoutHelperCalls(expr).match(/(?<![.\w$])[A-Za-z_$][\w$]*/g) ?? []).filter((x) => !/^(true|false|null|undefined|typeof|void)$/.test(x));
    for (const id of new Set(ids)) {
      // the NEAREST declaration above this <img> (two components in one file may both say `const src`)
      const declRe = new RegExp(`\\b(?:const|let)\\s+${id.replace(/\$/g, "\\$")}\\s*=\\s*([^;]+);`, "g");
      let decl: RegExpExecArray | null = null;
      for (let d = declRe.exec(text); d && d.index < m.index; d = declRe.exec(text)) decl = d;
      if (decl && rawMember(decl[1])) out.push(`${rel}:${line} src={${expr.trim()}} ← ${id} = ${decl[1].trim().slice(0, 120)}`);
    }
  }
  return out;
}

function violations(): string[] {
  const out: string[] = [];
  for (const d of DIRS) {
    for (const f of files(join(ROOT, d))) {
      const rel = relative(ROOT, f).replace(/\\/g, "/");
      if (!NOT_MEMBER_FILES.has(rel)) out.push(...scan(readFileSync(f, "utf8"), rel));
    }
  }
  return out;
}

describe("credit fix U1 · no component paints a member photo URL raw", () => {
  it("every <img src> built from a member photo field goes through the clean-copy helper", () => {
    expect(violations()).toEqual([]);
  });

  it("the scan reaches the shapes the second #874 review found", () => {
    expect(rawMember("media.imageUrls[0]")).toBe(true);
    expect(rawMember("w.photos[0]")).toBe(true);
    expect(rawMember("entry.photos?.[0]")).toBe(true);
    expect(rawMember("b.image_url")).toBe(true); // one-letter names are no longer exempt
    expect(rawMember("memberPhotoSrc(media.imageUrls[0], 600)")).toBe(false);
    expect(scan("<motion.img src={p.image_url} />", "x")).toHaveLength(1);
    expect(scan(`<img onLoad={() => { a(); }} data-x="${"y".repeat(2000)}" src={p.image_url} />`, "x")).toHaveLength(1);
    expect(scan("<img onError={(e) => a(e)} src={memberPhotoSrc(p.image_url)} />", "x")).toHaveLength(0);
  });

  it("the check is not vacuous: it flags the shapes the #874 review found", () => {
    expect(rawMember("p.image_urls[0]")).toBe(true);
    expect(rawMember("failed ? post.image_urls?.[0] ?? null : tileSrc(post, photoSetV2)")).toBe(true); // a helper elsewhere on the line does not cover the raw branch
    expect(rawMember("post.image_urls?.[0] ?? null")).toBe(true);
    expect(rawMember("photo.thumbnail_url || photo.image_url")).toBe(true);
    expect(rawMember("memberPhotoSrc(p.image_urls[0], 320)")).toBe(false);
    expect(rawMember("tag.image_url")).toBe(false);
  });
});
