#!/usr/bin/env node
/**
 * S2-B · SYNTHETIC MONITOR — measured from OUTSIDE (GitHub's runners), with no
 * secret and no dependency on our database being healthy.
 *
 * Gate: "Owner can read, without an editor: feed p95 yesterday, upload
 * failure %, crash rate per build, egress/1k views". This supplies the second,
 * independent sink (+ alert) and the egress estimate.
 *
 * For each lane (live, staging) it measures time-to-first-byte (fetch() resolves
 * when the response headers arrive) of:
 *   home           GET  https://<site>/
 *   site_settings  GET  https://<site>/config/site-settings
 *   feed_rest      GET  <supabase>/rest/v1/posts?… (anon, newest 10 public posts)
 *   cdn_image      GET  the first feed image, resized by the CDN (640 px)
 * and the feed's media bytes: the sum of the first page's images at 640 px —
 * "estimated egress per 1,000 feed views" = that × 1000. It is an ESTIMATE:
 * one page of 10 posts, one width, no video, no browser cache.
 *
 * Usage: node scripts/d2-synthetic.mjs <history.jsonl> <summary.md> <latest.json>
 *   Appends one line to history.jsonl, writes the markdown summary and
 *   latest.json, and exits 1 when any probe is DOWN or the p95 of the last
 *   WINDOW runs (this one included) crosses its threshold.
 * Prints numbers only (public Actions log): no post ids, no member data.
 */
import { readFileSync, appendFileSync, writeFileSync, existsSync } from "node:fs";

// Public anon (publishable) keys — already in health.yml / web-build.yml.
const LANES = {
  live: {
    site: "https://www.50mmretina.com",
    supabase: "https://jtdtehuqtinjxropkkcn.supabase.co",
    anon: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp0ZHRlaHVxdGluanhyb3Bra2NuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM1NzI3MjEsImV4cCI6MjA5OTE0ODcyMX0.qY8BI5LXb6uLzTwbpf8AleZ6UZyfeaOA0q4_TC5CEpo",
  },
  staging: {
    site: "https://staging.50mmretina.com",
    supabase: "https://fpszggreishhuvdpkmdr.supabase.co",
    anon: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZwc3pnZ3JlaXNoaHV2ZHBrbWRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMDcyNDUsImV4cCI6MjEwNDY4MzI0NX0.h3t2eZ8hwXDev6JydjsDnA8CpXFlKve4CaUlXp_mwiQ",
  },
};
const PATHS = { home: "/", site_settings: "/config/site-settings" };
const FEED_QUERY = "/rest/v1/posts?select=image_url&privacy=eq.public&image_url=not.is.null&order=created_at.desc&limit=10";
const CDN_HOST = "cdn.50mmretina.com";
const IMG_WIDTH = 640;
/** p95 TTFB thresholds (ms) over the last WINDOW runs. */
export const THRESHOLD_MS = { home: 2500, site_settings: 2000, feed_rest: 2500, cdn_image: 3000 };
export const WINDOW = 12; // 12 × 15 min = 3 h
const TIMEOUT_MS = 15_000;

export function p95(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  return v[Math.min(v.length - 1, Math.ceil(0.95 * v.length) - 1)];
}

function cdnResized(url) {
  if (!/^https:\/\//.test(url) || url.includes("/cdn-cgi/image/")) return url;
  return `https://${CDN_HOST}/cdn-cgi/image/width=${IMG_WIDTH}%2Cquality=82%2Cformat=auto/${url}`;
}

/** TTFB in ms, status, and (optionally) the body. Never throws. */
async function probe(url, { headers = {}, body = false } = {}) {
  const t0 = performance.now();
  try {
    const r = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
    const ttfb = Math.round(performance.now() - t0);
    let data = null;
    let bytes = null;
    if (body === "json") data = await r.json().catch(() => null);
    else if (body === "bytes") bytes = (await r.arrayBuffer()).byteLength;
    else await r.body?.cancel();
    return { ok: r.ok, status: r.status, ttfb, data, bytes };
  } catch (e) {
    return { ok: false, status: 0, ttfb: null, error: String(e?.name ?? "error") };
  }
}

async function measureLane(name, lane) {
  const out = {};
  for (const [k, p] of Object.entries(PATHS)) out[k] = await probe(lane.site + p);
  const feed = await probe(lane.supabase + FEED_QUERY, {
    headers: { apikey: lane.anon, Authorization: `Bearer ${lane.anon}` },
    body: "json",
  });
  const urls = Array.isArray(feed.data) ? feed.data.map((r) => r?.image_url).filter((u) => typeof u === "string") : [];
  out.feed_rest = { ok: feed.ok && Array.isArray(feed.data), status: feed.status, ttfb: feed.ttfb };

  let mediaBytes = 0;
  let imgs = 0;
  out.cdn_image = { ok: false, status: 0, ttfb: null, note: "no image in the feed page" };
  for (const [i, u] of urls.entries()) {
    const r = await probe(cdnResized(u), { body: "bytes" });
    if (i === 0) out.cdn_image = { ok: r.ok, status: r.status, ttfb: r.ttfb };
    if (r.ok && r.bytes) {
      mediaBytes += r.bytes;
      imgs++;
    }
  }
  return { lane: name, probes: out, feed_page_media_bytes: mediaBytes, feed_page_images: imgs };
}

function strip(p) {
  const o = {};
  for (const [k, v] of Object.entries(p)) o[k] = { ok: v.ok, status: v.status, ttfb: v.ttfb };
  return o;
}

async function main() {
  const [historyPath, summaryPath, latestPath] = process.argv.slice(2);
  if (!historyPath || !summaryPath || !latestPath) {
    console.error("usage: d2-synthetic.mjs <history.jsonl> <summary.md> <latest.json>");
    process.exit(2);
  }
  const at = new Date().toISOString();
  const lanes = [];
  for (const [n, l] of Object.entries(LANES)) lanes.push(await measureLane(n, l));
  const row = {
    at,
    lanes: Object.fromEntries(lanes.map((l) => [l.lane, {
      probes: strip(l.probes),
      feed_page_media_bytes: l.feed_page_media_bytes,
      feed_page_images: l.feed_page_images,
      est_egress_per_1k_feed_views_mb: Math.round((l.feed_page_media_bytes * 1000) / 1e6),
    }])),
  };
  appendFileSync(historyPath, JSON.stringify(row) + "\n");

  const history = existsSync(historyPath)
    ? readFileSync(historyPath, "utf8").trim().split("\n").slice(-WINDOW).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
    : [row];

  const problems = [];
  const lines = [
    `## Synthetic monitor — ${at}`,
    "",
    `TTFB from GitHub's runners. p95 over the last ${history.length} run(s) (window ${WINDOW}).`,
    "",
    "| lane | probe | status | TTFB ms | p95 ms | threshold |",
    "|---|---|---|---|---|---|",
  ];
  const summary = { at, window: history.length, lanes: {} };
  for (const lane of Object.keys(LANES)) {
    const cur = row.lanes[lane];
    summary.lanes[lane] = { probes: {}, est_egress_per_1k_feed_views_mb: cur.est_egress_per_1k_feed_views_mb, feed_page_images: cur.feed_page_images };
    for (const k of Object.keys(THRESHOLD_MS)) {
      const c = cur.probes[k];
      const q = p95(history.map((h) => h?.lanes?.[lane]?.probes?.[k]?.ttfb));
      summary.lanes[lane].probes[k] = { ok: c.ok, status: c.status, ttfb: c.ttfb, p95: q };
      if (!c.ok) problems.push(`${lane} ${k} DOWN (HTTP ${c.status})`);
      if (q != null && q > THRESHOLD_MS[k]) problems.push(`${lane} ${k} p95 ${q} ms > ${THRESHOLD_MS[k]} ms`);
      lines.push(`| ${lane} | ${k} | ${c.ok ? "up" : "**DOWN**"} ${c.status} | ${c.ttfb ?? "—"} | ${q ?? "—"} | ${THRESHOLD_MS[k]} |`);
    }
  }
  lines.push("", "**Estimated egress per 1,000 feed views** (first page of 10 public posts, images at 640 px via the CDN, × 1000; no video, no cache):", "");
  for (const lane of Object.keys(LANES)) {
    const c = row.lanes[lane];
    lines.push(`- ${lane}: ${c.est_egress_per_1k_feed_views_mb} MB (${c.feed_page_images} images, ${c.feed_page_media_bytes} bytes per page view)`);
  }
  lines.push("", problems.length ? `### FAIL\n${problems.map((p) => `- ${p}`).join("\n")}` : "### PASS — every probe up and under its p95 threshold");
  summary.problems = problems;

  writeFileSync(summaryPath, lines.join("\n") + "\n");
  writeFileSync(latestPath, JSON.stringify(summary, null, 2) + "\n");
  console.log(lines.join("\n"));
  process.exit(problems.length ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
