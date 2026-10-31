#!/usr/bin/env node
/**
 * P14 — CACHE POLICY PER ASSET CLASS: STATED HERE, CHECKED TWO WAYS.
 *
 * Gate (docs/gates/GATE_REGISTER.md, P14, verbatim):
 *   "`Cache-Control`, `ETag` and `stale-while-revalidate` policy stated per
 *    asset class and verified by fetch; the cache-hit target in M13 and V5
 *    traced to the rules that produce it."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. STRUCTURAL (`--static`, runs in vitest and CI, needs no network):
 *    simulates Cloudflare Pages' `_headers` merge on `public/_headers` — every
 *    matching rule applies, a repeated header is joined with ", " (Pages docs,
 *    "Headers") — and fails when any class's sample path resolves to a
 *    Cache-Control that contradicts itself: `no-store` together with a positive
 *    `max-age`/`s-maxage`, or two different `max-age` values. That is the exact
 *    defect measured on 2026-10-04 (`/images/*`, `/*.webp`, the page rules).
 *    Paths served through a Pages Function that SETS Cache-Control are
 *    resolved from that Function's source instead, because the Function's
 *    value is what leaves the edge.
 *
 * 2. BY FETCH (`<origin>`): one sample URL per class, `curl -D -`, and each
 *    response is held to the POLICY table below: the Cache-Control directives
 *    that must be present, the ones that must be absent, and whether an ETag
 *    is required.
 *
 * The POLICY table is the statement the gate asks for. The prose version,
 * with the reason for each class, is docs/evidence/d2/P14/cache-policy.md.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   node scripts/web-cache-headers-check.mjs --static
 *   node scripts/web-cache-headers-check.mjs --self-test
 *   node scripts/web-cache-headers-check.mjs https://staging.50mmretina.com [--json out.json]
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * Policy per asset class. `sample` is fetched; `must` directives must appear,
 * `mustNot` must not; `etag` true = an ETag is required (revalidation is the
 * point of the policy); `fn` names the Function whose source sets the value.
 * `lane` limits a row to one origin where the lanes legitimately differ.
 */
export const POLICY = [
  { cls: "document (SPA shell)", sample: "/", must: ["no-store"], mustNot: ["max-age=31536000"], etag: false, lane: "staging",
    why: "the shell names the hashed chunks of ONE deploy; a cached shell after a deploy asks for deleted chunks" },
  { cls: "document (SPA shell), production", sample: "/", must: ["max-age=0", "s-maxage=60"], mustNot: ["immutable"], etag: true, lane: "production",
    why: "production's zone Worker seo-edge-injector rewrites the shell and sets this (F-D2-12); browser never caches, edge 60 s" },
  { cls: "SPA deep link", sample: "/explore", must: [], mustNot: ["immutable", "max-age=31536000"], etag: false,
    why: "same response as the document" },
  { cls: "hashed build asset (/assets/*)", sample: "@asset", must: ["public", "max-age=31536000", "immutable"], mustNot: ["no-store", "no-cache"], etag: true,
    fn: "functions/assets/[[path]].ts", why: "content-hashed names never change content; a miss is a no-store 404" },
  { cls: "missing hashed asset", sample: "/assets/does-not-exist-p14.js", status: 404, must: ["no-store"], mustNot: ["immutable"], etag: false,
    fn: "functions/assets/[[path]].ts", why: "a cached miss is the 30-day poisoned-chunk bug" },
  { cls: "unhashed image (/images/*)", sample: "/images/logo-fallback.webp", must: ["public", "max-age=86400", "stale-while-revalidate=604800"], mustNot: ["no-store", "immutable"], etag: true,
    fn: "functions/images/[[path]].ts", why: "replaced in place, so a day fresh + a week SWR, revalidated by ETag" },
  { cls: "root public file", sample: "/robots.txt", must: ["no-store"], mustNot: ["immutable"], etag: true,
    why: "robots, manifest, sitemap, favicon, og-image: tiny, rarely fetched, must change the moment they are edited" },
  { cls: "service-worker script", sample: "/sw-image-cache.js", must: ["no-store"], mustNot: ["max-age=31536000", "immutable"], etag: true,
    why: "a cached SW script delays every SW update" },
  { cls: "config Function (P4)", sample: "/config/site-settings", expectType: "json", must: ["public", "max-age=60", "stale-while-revalidate=600"], mustNot: ["no-store"], etag: true,
    fn: "functions/config/site-settings.ts", why: "versioned body, ETag = content hash, 304 on match; edits reach members within 60 s" },
];

/**
 * Classes whose policy is checked from the Function source only. The SEO
 * Functions answer per published slug/id, and no slug is guaranteed to exist
 * on both lanes, so a fetch could only ever test the fall-through.
 */
export const SOURCE_POLICY = [
  { cls: "SEO page Functions (/page, /journal, /courses, /competitions, /featured-artist)", file: "functions/_seo.ts",
    value: "public, max-age=0, s-maxage=1800, stale-while-revalidate=86400", why: "crawlable HTML edge-cached 30 min, served stale for a day while refreshing; browser always revalidates" },
  { cls: "hashed build asset", file: "functions/assets/[[path]].ts", value: "public, max-age=31536000, immutable", why: "see POLICY" },
  { cls: "unhashed image", file: "functions/images/[[path]].ts", value: "public, max-age=86400, stale-while-revalidate=604800", why: "see POLICY" },
];

// ── _headers parse + Pages merge simulation ─────────────────────────────────

export function parseHeadersFile(text) {
  const rules = [];
  let cur = null;
  for (const raw of text.split("\n")) {
    if (raw.startsWith("#") || raw.trim() === "") continue;
    if (!/^\s/.test(raw)) {
      cur = { pattern: raw.trim(), headers: [] };
      rules.push(cur);
      continue;
    }
    const m = raw.match(/^\s+(!\s+)?([A-Za-z0-9-]+)(?::\s*(.*))?$/);
    if (m && cur) cur.headers.push({ name: m[2].toLowerCase(), value: (m[3] ?? "").trim(), detach: !!m[1] });
  }
  return rules;
}

/** Pages URL pattern → RegExp: `*` = any run of characters (splat). */
export function patternMatches(pattern, path) {
  if (/^https?:/.test(pattern)) return false;
  const re = new RegExp("^" + pattern.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
  return re.test(path);
}

/** Every matching rule contributes; a repeated header is comma-joined (Pages docs). */
export function resolveHeaders(rules, path) {
  const out = {};
  for (const r of rules) {
    if (!patternMatches(r.pattern, path)) continue;
    for (const h of r.headers) {
      if (h.detach) continue; // not used in this file; semantics undocumented, never relied on
      out[h.name] = out[h.name] ? `${out[h.name]}, ${h.value}` : h.value;
    }
  }
  return out;
}

/** The value a Function SETS for Cache-Control on its success path, read from source. */
export function functionCacheControl(source) {
  const m = source.match(/(?:headers\.set\(\s*["']Cache-Control["']\s*,\s*|const\s+\w*CACHE\w*\s*=\s*)["'`]([^"'`]+)["'`]/i);
  return m ? m[1] : null;
}

export function contradictions(cacheControl) {
  const d = (cacheControl || "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
  const problems = [];
  const ages = d.filter((x) => /^max-age=\d+$/.test(x));
  const positive = d.some((x) => /^(s-)?max-age=([1-9]\d*)$/.test(x));
  if (d.includes("no-store") && (positive || d.includes("public") || d.includes("immutable"))) {
    problems.push("no-store together with a cacheable directive — no-store wins, the rest is dead");
  }
  if (new Set(ages).size > 1) problems.push(`conflicting max-age values: ${[...new Set(ages)].join(" vs ")}`);
  return problems;
}

/** Sample paths for the static check: one per class plus each rule's own pattern. */
export const STATIC_SAMPLES = [
  "/", "/explore", "/competitions", "/certificates/abc", "/assets/index-abc123.js", "/assets/x.css",
  "/images/logo-fallback.webp", "/images/logo.png", "/robots.txt", "/sw-image-cache.js", "/og-image.png", "/x.webp", "/font.woff2",
];

export function staticCheck(headersText, fnSources = {}) {
  const rules = parseHeadersFile(headersText);
  const fnFor = (p) =>
    p.startsWith("/assets/") ? "functions/assets/[[path]].ts" : p.startsWith("/images/") ? "functions/images/[[path]].ts" : null;
  const rows = [];
  for (const path of STATIC_SAMPLES) {
    const fn = fnFor(path);
    const fnCc = fn && fnSources[fn] ? functionCacheControl(fnSources[fn]) : null;
    const cc = fnCc ?? resolveHeaders(rules, path)["cache-control"] ?? "";
    rows.push({ path, source: fnCc ? fn : "_headers merge", cacheControl: cc, problems: contradictions(cc) });
  }
  return rows;
}

// ── by fetch ─────────────────────────────────────────────────────────────────

function head(url) {
  const out = execFileSync("curl", ["-sS", "-o", "/dev/null", "-D", "-", "-H", "accept-encoding: br, gzip",
    "-H", "user-agent: 50mm-p14-cache-check", "--max-time", "30", url], { encoding: "utf8" });
  const blocks = out.split(/\r?\n\r?\n/).filter((b) => /^HTTP\//.test(b));
  const last = blocks[blocks.length - 1] || "";
  const [statusLine, ...lines] = last.split(/\r?\n/);
  const h = {};
  for (const l of lines) {
    const i = l.indexOf(":");
    if (i > 0) h[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
  }
  return { status: Number(statusLine.split(" ")[1]), headers: h };
}

export function judge(policy, status, headers) {
  const cc = (headers["cache-control"] || "").toLowerCase();
  const d = cc.split(",").map((s) => s.trim());
  const fails = [];
  const want = policy.status ?? 200;
  if (status !== want) fails.push(`status ${status}, expected ${want}`);
  for (const m of policy.must) if (!d.includes(m)) fails.push(`missing ${m}`);
  for (const m of policy.mustNot) if (d.includes(m)) fails.push(`has ${m}`);
  if (policy.etag && !headers["etag"]) fails.push("no ETag");
  fails.push(...contradictions(cc));
  return fails;
}

export async function fetchCheck(origin) {
  const base = origin.replace(/\/+$/, "");
  const lane = /\/\/www\./.test(base) ? "production" : "staging";
  const docHtml = execFileSync("curl", ["-sS", "--compressed", "--max-time", "30", base + "/"], { encoding: "utf8" });
  const asset = (docHtml.match(/\/assets\/[\w.-]+\.js/) || [])[0];
  const rows = [];
  for (const p of POLICY) {
    if (p.lane && p.lane !== lane) continue;
    const path = p.sample === "@asset" ? asset : p.sample;
    const r = head(base + path);
    let fails = judge(p, r.status, r.headers);
    let verdict = fails.length ? "FAIL" : "PASS";
    // A Function route not deployed on this origin answers with the SPA shell;
    // that row tests nothing, so it is ABSENT — printed, never PASS.
    if (p.expectType && !(r.headers["content-type"] || "").includes(p.expectType)) {
      verdict = "ABSENT";
      fails = [`route not deployed here (content-type ${r.headers["content-type"] || "none"})`];
    }
    rows.push({ cls: p.cls, path, status: r.status, cacheControl: r.headers["cache-control"] || "", etag: !!r.headers["etag"],
      cfCacheStatus: r.headers["cf-cache-status"] || "", verdict, fails });
  }
  return rows;
}

export const SELF_TEST = [
  { name: "the 2026-10-04 /images/* header", cc: "no-store, no-cache, must-revalidate, proxy-revalidate, public, max-age=2592000, immutable, public, max-age=31536000, immutable", bad: true },
  { name: "the page-rule header", cc: "no-store, no-cache, must-revalidate, proxy-revalidate, public, max-age=300, s-maxage=600, stale-while-revalidate=86400", bad: true },
  { name: "two max-ages", cc: "public, max-age=60, max-age=3600", bad: true },
  { name: "no-store alone", cc: "no-store, no-cache, must-revalidate, proxy-revalidate", bad: false },
  { name: "immutable asset", cc: "public, max-age=31536000, immutable", bad: false },
  { name: "edge-only HTML", cc: "public, max-age=0, s-maxage=60", bad: false },
];

export function selfTest() {
  const f = SELF_TEST.filter((c) => (contradictions(c.cc).length > 0) !== c.bad).map((c) => `${c.name}: expected ${c.bad ? "contradiction" : "clean"}`);
  const oldTemplate = "/*\n  Cache-Control: no-store\n/images/*\n  Cache-Control: public, max-age=2592000, immutable\n/*.webp\n  Cache-Control: public, max-age=31536000, immutable\n";
  const r = staticCheck(oldTemplate).find((x) => x.path === "/images/logo-fallback.webp");
  if (!r || r.problems.length === 0) f.push("merge simulation: the old /images/* template did not resolve contradictory");
  return f;
}

export function readFunctionSources() {
  const out = {};
  for (const f of ["functions/assets/[[path]].ts", "functions/images/[[path]].ts"]) if (existsSync(f)) out[f] = readFileSync(f, "utf8");
  return out;
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  if (process.argv.includes("--self-test")) {
    const f = selfTest();
    f.forEach((x) => console.error("SELF-TEST FAIL · " + x));
    console.log(`self-test: ${f.length ? "FAIL" : "PASS"} (${SELF_TEST.length} header shapes + merge simulation)`);
    process.exit(f.length ? 1 : 0);
  }
  if (process.argv.includes("--static")) {
    let srcBad = 0;
    for (const sp of SOURCE_POLICY) {
      const got = existsSync(sp.file) ? functionCacheControl(readFileSync(sp.file, "utf8")) : null;
      const ok = got === sp.value;
      if (!ok) srcBad++;
      console.log(`${ok ? "PASS" : "FAIL"} source ${sp.file.padEnd(30)} ${got ?? "(no Cache-Control found)"}${ok ? "" : "  ← expected " + sp.value}`);
    }
    const rows = staticCheck(readFileSync("public/_headers", "utf8"), readFunctionSources());
    for (const r of rows) console.log(`${r.problems.length ? "FAIL" : "PASS"} ${r.path.padEnd(28)} ${r.source.padEnd(30)} ${r.cacheControl}${r.problems.length ? "  ← " + r.problems.join("; ") : ""}`);
    const bad = rows.filter((r) => r.problems.length).length;
    console.log(`static: ${rows.length} sample paths, ${bad} contradictory; ${SOURCE_POLICY.length} Function sources, ${srcBad} off-policy`);
    process.exit(bad || srcBad ? 1 : 0);
  }
  const origin = process.argv.slice(2).find((a) => /^https?:\/\//.test(a));
  if (!origin) { console.error("usage: --static | --self-test | <origin> [--json out.json]"); process.exit(2); }
  const rows = await fetchCheck(origin);
  for (const r of rows) console.log(`${r.verdict} ${String(r.status).padEnd(3)} ${r.cls.padEnd(34)} ${r.path}  [${r.cacheControl}] etag=${r.etag} cf=${r.cfCacheStatus}${r.fails.length ? "  ← " + r.fails.join("; ") : ""}`);
  const summary = { origin, measuredAt: new Date().toISOString(), classes: rows.length, fail: rows.filter((r) => r.verdict === "FAIL").length, absent: rows.filter((r) => r.verdict === "ABSENT").length };
  console.log(JSON.stringify(summary));
  const ji = process.argv.indexOf("--json");
  if (ji > 0 && process.argv[ji + 1]) writeFileSync(process.argv[ji + 1], JSON.stringify({ summary, rows }, null, 2) + "\n");
  process.exit(summary.fail ? 1 : 0);
}
