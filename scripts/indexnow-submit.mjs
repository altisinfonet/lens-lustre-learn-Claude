#!/usr/bin/env node
/**
 * SEO plan step A4 (Owner 2026-11-09): tell search engines about new and
 * changed public pages the same day, via IndexNow (Bing, Yandex, Seznam, Naver;
 * Bing's index also feeds several AI search assistants).
 *
 * Reads the LIVE sitemap, picks every URL whose <lastmod> is within the last
 * DAYS days (all URLs with FULL=1), and submits them in one or more batches.
 * The key file is public/<KEY>.txt (an IndexNow key is public by design: it
 * only proves the submitter controls the site). Read-only on our side.
 *
 * env: SITE (default https://www.50mmretina.com), DAYS (default 2), FULL=1, DRY=1
 */
const SITE = (process.env.SITE || "https://www.50mmretina.com").replace(/\/+$/, "");
const KEY = "1b13fead5c15fa88c91ee3657382a3ca";
const DAYS = Number(process.env.DAYS || 2);
const FULL = process.env.FULL === "1";
const DRY = process.env.DRY === "1";
const ENDPOINT = "https://api.indexnow.org/indexnow";
const BATCH = 10000; // IndexNow's per-request limit

const res = await fetch(`${SITE}/sitemap.xml`, { headers: { "User-Agent": "50mm-indexnow/1.0" } });
if (!res.ok) { console.error(`sitemap HTTP ${res.status}`); process.exit(1); }
const xml = await res.text();
const entries = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => ({
  loc: m[1].match(/<loc>([^<]+)<\/loc>/)?.[1]?.trim(),
  lastmod: m[1].match(/<lastmod>([^<]+)<\/lastmod>/)?.[1]?.trim(),
})).filter((e) => e.loc);
if (!entries.length) { console.error("sitemap lists no URLs"); process.exit(1); }

const since = Date.now() - DAYS * 86_400_000;
const pick = entries.filter((e) => FULL || (e.lastmod && Date.parse(e.lastmod) >= since - 86_400_000));
// IndexNow wants one host per request; the key file must live on that host.
const byHost = new Map();
for (const e of pick) {
  const host = new URL(e.loc).host;
  if (!byHost.has(host)) byHost.set(host, []);
  byHost.get(host).push(e.loc);
}
console.log(`sitemap: ${entries.length} URLs; picked ${pick.length} (${FULL ? "full" : `lastmod within ${DAYS} d`}); hosts: ${[...byHost.keys()].join(", ") || "-"}`);

let failed = 0;
for (const [host, urls] of byHost) {
  // the key must be reachable on this host before submitting
  const keyUrl = `https://${host}/${KEY}.txt`;
  const k = await fetch(keyUrl).then((r) => (r.ok ? r.text() : "")).catch(() => "");
  if (k.trim() !== KEY) { console.error(`key file not served at ${keyUrl} — not submitting ${urls.length} URLs`); failed++; continue; }
  for (let i = 0; i < urls.length; i += BATCH) {
    const urlList = urls.slice(i, i + BATCH);
    if (DRY) { console.log(`DRY ${host}: would submit ${urlList.length}`); continue; }
    const r = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host, key: KEY, keyLocation: keyUrl, urlList }),
    });
    // 200 OK / 202 Accepted are success; anything else is reported.
    console.log(`${host}: submitted ${urlList.length} → HTTP ${r.status}`);
    if (r.status !== 200 && r.status !== 202) { failed++; console.error((await r.text()).slice(0, 300)); }
  }
}
process.exit(failed ? 1 : 0);
