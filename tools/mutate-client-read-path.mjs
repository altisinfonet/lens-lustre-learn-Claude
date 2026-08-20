#!/usr/bin/env node
/**
 * MUTATION HARNESS FOR THE ITEM E CLIENT READ-PATH SWITCH.
 *
 * The switch has two opposite quiet failures, and neither is visible on screen:
 *
 *   1. THE SWITCH DID NOT HAPPEN. The pictures still come from
 *      `posts.image_urls`. Everything looks perfect until the day that column
 *      stops being written, and then every photograph disappears at once.
 *
 *   2. THE FALLBACK WENT AWAY. 57 posts carrying 84 photographs have no
 *      `post_media` rows at all — they are outside the fenced migration
 *      population. Remove the fallback and they go blank TODAY.
 *
 * A green suite proves neither. Only a suite that goes RED when each control is
 * removed proves anything, so every mutation below deletes exactly one control
 * and requires `postMediaClientReadPath.test.ts` to fail.
 *
 * Every mutation is applied to a copy, restored from that copy, and the run
 * ends by re-asserting the working tree is clean.
 *
 * Usage: node tools/mutate-client-read-path.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const READER = "src/lib/media/postMediaRead.ts";
const FEED   = "src/hooks/feed/useFeedQuery.ts";
const WALL   = "src/hooks/feed/useUserPostsQuery.ts";
const DETAIL = "src/pages/PostDetail.tsx";
const HASH   = "src/pages/HashtagFeed.tsx";

const SUITE = "src/__tests__/postMediaClientReadPath.test.ts";

const FILES = [READER, FEED, WALL, DETAIL, HASH];
const originals = Object.fromEntries(FILES.map((f) => [f, readFileSync(f, "utf8")]));

/** The legacy expression each surface used before the switch. */
const legacyFeed = `p.image_urls?.length > 0 ? p.image_urls : p.image_url ? [p.image_url] : []`;

const mutations = [
  {
    file: FEED,
    name: "1.  THE SWITCH ITSELF — the feed reverts to image_urls-only",
    apply: (s) => s.replace(
      /const imageUrls = resolvePostImageUrls\(\n      postMediaMap,\n      p\.id,\n      p\.image_urls\?\.length > 0 \? p\.image_urls : p\.image_url \? \[p\.image_url\] : \[\],\n    \);/,
      `const imageUrls = ${legacyFeed};`,
    ),
  },
  {
    file: WALL,
    name: "2.  the wall reverts to image_urls-only",
    apply: (s) => s.replace(
      /const imageUrls = resolvePostImageUrls\(\n      postMediaMap,\n      p\.id,\n      p\.image_urls\?\.length > 0 \? p\.image_urls : p\.image_url \? \[p\.image_url\] : \[\],\n    \);/,
      `const imageUrls = ${legacyFeed};`,
    ),
  },
  {
    file: DETAIL,
    name: "3.  the photo detail page reverts to image_urls-only",
    apply: (s) => s.replace(
      "image_urls: resolvePostImageUrls(postMediaMap, rawPost.id, (rawPost as any).image_urls || []),",
      "image_urls: (rawPost as any).image_urls || [],",
    ),
  },
  {
    file: HASH,
    name: "4.  the hashtag feed reverts to image_urls-only",
    apply: (s) => s.replace(
      /image_urls: resolvePostImageUrls\(\n          postMediaMap,\n          p\.id,\n          \(p as any\)\.image_urls \|\| \(p\.image_url \? \[p\.image_url\] : \[\]\),\n        \),/,
      "image_urls: (p as any).image_urls || (p.image_url ? [p.image_url] : []),",
    ),
  },
  {
    file: READER,
    name: "5.  post_media_for bypassed for some other function",
    apply: (s) => s.replace('"post_media_for",', '"get_post_media_unchecked",'),
  },
  {
    file: FEED,
    name: "6.  a DIRECT media_objects query smuggled into the client",
    apply: (s) => s.replace(
      "      fetchPostMediaMap(postIds),",
      '      supabase.from("media_objects").select("id,derivatives"),\n      fetchPostMediaMap(postIds),',
    ),
  },
  {
    file: FEED,
    name: "7.  a DIRECT post_media query smuggled into the client",
    apply: (s) => s.replace(
      "      fetchPostMediaMap(postIds),",
      '      supabase.from("post_media").select("post_id,ord,media_id"),\n      fetchPostMediaMap(postIds),',
    ),
  },
  {
    file: READER,
    name: "8.  batching removed — one call for every id, past the MEDIA-1001 cap",
    apply: (s) => s.replace(
      "export const POST_MEDIA_ID_BATCH = 50;",
      "export const POST_MEDIA_ID_BATCH = 5000;",
    ),
  },
  {
    file: READER,
    name: "9.  ordinal ordering dropped — an album shuffles",
    apply: (s) => s.replace(
      "      .sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0))\n",
      "",
    ),
  },
  {
    file: READER,
    name: "10. THE FALLBACK — 57 posts / 84 photographs go blank",
    apply: (s) => s.replace(
      "  return (legacyUrls ?? []).filter((u): u is string => typeof u === \"string\" && u.length > 0);",
      "  return [];",
    ),
  },
  {
    file: DETAIL,
    name: "11. N+1 — the reader called per post instead of per page",
    apply: (s) => s.replace(
      "      const postMediaMap = await fetchPostMediaMap([rawPost.id]);",
      "      const postMediaMap = await Promise.all([rawPost].map(async (q) => fetchPostMediaMap([q.id]))).then((m) => m[0]);",
    ),
  },
  {
    file: READER,
    name: "12. forbidden metadata carried into the client",
    apply: (s) => s.replace(
      "  bytes: number | null;\n}",
      "  bytes: number | null;\n  sha256: string | null;\n  verified_at: string | null;\n  quarantine_reason: string | null;\n}",
    ),
  },
  {
    file: READER,
    name: "13. the client starts supplying a viewer id — second-guessing the server",
    apply: (s) => s.replace(
      '        { _post_ids: ids },',
      '        { _post_ids: ids, _viewer_id: "self" },',
    ),
  },
  {
    file: READER,
    name: "14. the CDN host drifts to the apex (the August outage)",
    apply: (s) => s.replace(
      'export const MEDIA_CDN_HOST = "cdn.50mmretina.com";',
      'export const MEDIA_CDN_HOST = "50mmretina.com";',
    ),
  },
  {
    file: READER,
    name: "15. a missing derivative emits an empty src instead of being dropped",
    apply: (s) => s.replace(
      '      .filter((u): u is string => u !== null);',
      '      .map((u) => u ?? "");',
    ),
  },
  {
    file: READER,
    name: "16. de-duplication removed — the same post id sent repeatedly",
    apply: (s) => s.replace(
      "  const unique = [...new Set(postIds.filter((id): id is string => typeof id === \"string\" && id.length > 0))];",
      "  const unique = postIds.filter((id): id is string => typeof id === \"string\");",
    ),
  },
  {
    file: READER,
    name: "17. an RPC failure swallowed silently instead of logged",
    apply: (s) => s.replace(/        logger\.warn\(\{[\s\S]*?\}\);\n/, ""),
  },
  {
    file: READER,
    name: "18. traversal accepted in a derivative path",
    apply: (s) => s.replace(
      '  if (!path || path.startsWith("/") || path.includes("..")) return null;',
      "  if (!path) return null;",
    ),
  },
  {
    file: FEED,
    name: "19. the media read pulled out of the page's batched Promise.all",
    apply: (s) => s
      .replace("      fetchPostMediaMap(postIds),\n    ]);", "    ]);\n  const postMediaMap = await fetchPostMediaMap(postIds);")
      .replace(", tagsRes, postMediaMap] =", ", tagsRes] ="),
  },
];

function suiteResult() {
  try {
    execSync(`npx vitest run ${SUITE} --reporter=dot`, { stdio: "pipe" });
    return "GREEN";
  } catch {
    return "RED";
  }
}

console.log(`baseline (no mutation): ${suiteResult()}\n`);

let undetected = 0;
for (const m of mutations) {
  const original = originals[m.file];
  const mutated = m.apply(original);
  if (mutated === original) {
    console.log(`✗ NOT APPLIED  ${m.name}  → the pattern no longer matches ${m.file}`);
    undetected++;
    continue;
  }
  writeFileSync(m.file, mutated);
  const res = suiteResult();
  writeFileSync(m.file, original);
  if (res === "RED") console.log(`✓ DETECTED    ${m.name}`);
  else { console.log(`✗ UNDETECTED  ${m.name}  → suite stayed GREEN`); undetected++; }
}

for (const [f, s] of Object.entries(originals)) writeFileSync(f, s);
const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim();
console.log(`\nworking tree vs pre-run snapshot:\n${dirty || "NONE (fully restored)"}`);

if (undetected > 0) {
  console.error(`\n${undetected} MUTATION(S) UNDETECTED. A control with no failing test is not tested.`);
  process.exit(1);
}
console.log("\nALL CONTROLS DETECTED. The client read-path switch is pinned in both directions: it cannot silently revert, and its fallback cannot silently vanish.");
