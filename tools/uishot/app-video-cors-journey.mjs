#!/usr/bin/env node
/**
 * THE APP-VIDEO CORS JOURNEY — `node tools/uishot/app-video-cors-journey.mjs`
 *
 * Live bug, Android app 1.2.22 (2026-10-17): "This video can't play right now"
 * on every video post. The app's page lives at https://localhost; it asked
 * fetch("/api/video/play-token") — relative, so to the phone — and the site's
 * Functions had no CORS for a cross-origin ask anyway (OPTIONS -> 405).
 *
 * This reproduces the app's situation in a real browser, end to end:
 *   · `vite build` of tools/uishot/app-video-cors/appvideoharness.html for the
 *     STAGING lane (VITE_SITE_ORIGIN=https://staging.50mmretina.com), the real
 *     FeedVideoCard and the real site-settings read inside it;
 *   · that bundle served at https://localhost with the Capacitor bridge
 *     present — a DIFFERENT origin from the API, as in the app;
 *   · "https://staging.50mmretina.com" resolved (Chromium host-resolver rule)
 *     to a local HTTPS server running the REAL Pages Functions
 *     (functions/api/video/play-token.ts, functions/config/site-settings.ts,
 *     loaded through Vite) — Supabase faked at the network edge only. The
 *     browser does its own CORS preflight against that server; nothing in
 *     between answers for it.
 *
 * PASS needs ALL of:
 *   A  OPTIONS + POST /api/video/play-token reached the API origin from
 *      Origin https://localhost, and the POST was answered 200 with ACAO;
 *   B  the player got a source: the player asked the CDN for the master playlist
 *      at exactly the URL the token answer named, and the <video> element is
 *      given that source (hls.js blob: MediaSource, or the URL itself where the
 *      browser plays HLS natively) — WITHOUT a tap (the in-view autoplay path);
 *      (the CDN stand-in has no files, so playback itself is not judged here);
 *   C  GET /config/site-settings reached the API origin (with ACAO) and the
 *      page shows the value the edge served;
 *   D  nothing was asked of https://localhost/api/ or /config/ (the 1.2.22 bug).
 *
 *   --json <file>   write the result (default: none)
 * Needs `openssl` on PATH (a throwaway self-signed certificate). Exit code =
 * the verdict.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import { tmpdir } from "node:os";
import { join, extname, resolve } from "node:path";
import { chromium } from "playwright";
import { build, createServer as createVite } from "vite";

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const out = arg("--json");
const SITE = "https://staging.50mmretina.com";
const CDN = "cdn-staging.50mmretina.com";
const APP = "https://localhost";
const VIDEO_ID = "33333333-3333-4333-8333-333333333333";
const OWNER = "11111111-1111-4111-8111-111111111111";
const work = mkdtempSync(join(tmpdir(), "app-video-cors-"));

/* ── 1. the bundle, built for the staging lane ─────────────────────────────── */
process.env.VITE_SITE_ORIGIN = SITE;
process.env.VITE_CDN_HOST = CDN;
process.env.VITE_SUPABASE_URL = "https://testprojectref0000x.supabase.co";
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key-not-real";
process.env.VITE_SUPABASE_PROJECT_ID = "testprojectref0000x";
const dist = join(work, "dist");
await build({
  configFile: resolve("vite.config.ts"),
  mode: "production",
  logLevel: "warn",
  build: { outDir: dist, emptyOutDir: true, rollupOptions: { input: { journey: resolve("tools/uishot/app-video-cors/appvideoharness.html") } } },
});
const page0 = join(dist, "tools", "uishot", "app-video-cors", "appvideoharness.html");
if (!existsSync(page0)) throw new Error(`the build did not produce ${page0}: ${readdirSync(dist).join(", ")}`);

/* ── 2. the REAL Pages Functions, behind HTTPS ─────────────────────────────── */
const ssl = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=staging.50mmretina.com",
  "-keyout", join(work, "k.pem"), "-out", join(work, "c.pem")], { encoding: "utf8" });
if (ssl.status !== 0) throw new Error(`openssl failed: ${ssl.stderr}`);

const vite = await createVite({ configFile: resolve("vite.config.ts"), server: { middlewareMode: true, hmr: false }, appType: "custom", logLevel: "warn" });
const playToken = await vite.ssrLoadModule("/functions/api/video/play-token.ts");
const siteSettings = await vite.ssrLoadModule("/functions/config/site-settings.ts");

// Supabase, faked where the Functions call it — the only stand-in on the server side.
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!/\.supabase\.co\//.test(url)) return realFetch(input, init);
  const ok = (b) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("/rest/v1/videos?")) return ok([{ id: VIDEO_ID, owner_id: OWNER, current_version: 1, state: "ready" }]);
  if (url.includes("/rest/v1/video_versions?")) return ok([{ width: 720, height: 1280, declared_duration_s: "5", has_audio: false, renditions: ["240p"] }]);
  if (url.includes("/rest/v1/site_settings?")) return ok([{ key: "journey_marker", value: "served-by-the-edge" }]);
  return new Response("{}", { status: 401 });
};

const ENV = {
  SUPABASE_PROJECT_REF: "fakeref", SUPABASE_ANON_KEY: "anon-key-not-real", SITE_ORIGIN: SITE,
  VIDEO_DELIVERY_PRIVATE: "1", MEDIA_CDN_HOST: CDN,
  MEDIA_TOKEN_KEY: Buffer.from(Array.from({ length: 32 }, (_, i) => i + 7)).toString("base64"),
};
const apiLog = [];
const localAsks = [];
const cdnAsks = [];
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json" };
/** Pages' own dispatch: onRequest, else onRequest<Method>, else 405. */
const pick = (mod, method) => mod.onRequest ?? mod[`onRequest${method[0]}${method.slice(1).toLowerCase()}`];

/**
 * ONE local HTTPS server, dispatched by Host — the browser reaches every name
 * through Chromium's resolver rule below. Deliberately NO page.route():
 * Playwright answers CORS preflights itself whenever interception is on, which
 * would hide exactly the check this journey exists to make.
 */
async function site(req, res, url) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const request = new Request(new URL(url.pathname + url.search, SITE), {
    method: req.method,
    headers: Object.entries(req.headers).filter(([k, v]) => typeof v === "string" && k !== "host"),
    ...(req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS" ? {} : { body: Buffer.concat(chunks) }),
  });
  const mod = url.pathname === "/api/video/play-token" ? playToken : url.pathname === "/config/site-settings" ? siteSettings : null;
  const fn = mod ? pick(mod, req.method) : null;
  // A Function with no handler for the method: Pages answers 405 (what live OPTIONS got, 2026-10-17).
  const r = fn ? await fn({ request, env: ENV }) : new Response("Method Not Allowed", { status: mod ? 405 : 404 });
  apiLog.push({ method: req.method, path: url.pathname, origin: req.headers.origin ?? null, status: r.status, acao: r.headers.get("access-control-allow-origin") });
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}
function app(req, res, url) {
  // Capacitor's local server: the bundle's files, else the app's HTML.
  const p = decodeURIComponent(url.pathname);
  localAsks.push(p);
  const file = join(dist, p);
  const hit = p !== "/" && extname(p) && existsSync(file);
  res.writeHead(200, { "content-type": hit ? (types[extname(p)] ?? "application/octet-stream") : "text/html" });
  res.end(readFileSync(hit ? file : page0));
}
const server = createHttpsServer({ key: readFileSync(join(work, "k.pem")), cert: readFileSync(join(work, "c.pem")) }, (req, res) => {
  const host = String(req.headers.host ?? "").replace(/:\d+$/, "");
  const url = new URL(req.url, `https://${host}`);
  if (host === "staging.50mmretina.com") return void site(req, res, url);
  if (host === "localhost") return app(req, res, url);
  if (host === CDN) {
    // The media-authz Worker allows https://localhost (measured live 2026-10-17); a stand-in answers like it, with no files.
    cdnAsks.push(url.href);
    res.writeHead(404, { "access-control-allow-origin": APP, vary: "Origin" });
    return res.end();
  }
  // Supabase (the page's own reads): unreachable here, as if offline.
  res.writeHead(503, { "access-control-allow-origin": "*" });
  res.end("{}");
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const port = server.address().port;

/* ── 3. the browser: page at https://localhost, API at the site origin ─────── */
const browser = await chromium.launch({ args: [
  `--host-resolver-rules=MAP localhost 127.0.0.1:${port}, MAP staging.50mmretina.com 127.0.0.1:${port}, MAP ${CDN} 127.0.0.1:${port}, MAP *.supabase.co 127.0.0.1:${port}`,
  // The test resolves PUBLIC names to 127.0.0.1; Chromium's local-network
  // protection would refuse that on its own (a phone resolves the real site).
  "--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests",
] });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 420, height: 900 } });
const page = await ctx.newPage();

const netFails = [];
page.on("requestfailed", (r) => netFails.push(`${r.method()} ${r.url()} ${r.failure()?.errorText}`));
page.on("console", (m) => { if (m.type() === "error") netFails.push(`console: ${m.text().slice(0, 200)}`); });
let grantUrl = null;
page.on("response", async (r) => {
  if (r.url() === `${SITE}/api/video/play-token` && r.request().method() === "POST") {
    try { grantUrl = (await r.json()).master_url; } catch { /* checked below */ }
  }
});

await page.goto(`${APP}/tools/uishot/app-video-cors/appvideoharness.html`);
await page.waitForFunction(() => document.querySelector("[data-testid=site-setting]")?.textContent !== "loading", null, { timeout: 30_000 }).catch(() => {});
await page.waitForFunction(() => (document.querySelector("video")?.currentSrc ?? "").startsWith("blob:"), null, { timeout: 30_000 }).catch(() => {});
await page.waitForTimeout(1500);
const state = await page.evaluate(() => ({
  setting: document.querySelector("[data-testid=site-setting]")?.textContent ?? null,
  videoSrc: document.querySelector("video")?.currentSrc ?? null,
  videoMuted: document.querySelector("video")?.muted ?? null,
  cantPlay: document.body.innerText.includes("This video can't play right now"),
}));
const shot = out ? out.replace(/\.json$/, ".png") : null;
if (shot) await page.screenshot({ path: shot, fullPage: true });
await browser.close();
server.close();
await vite.close();

/* ── 4. the verdict ────────────────────────────────────────────────────────── */
const pt = apiLog.filter((e) => e.path === "/api/video/play-token");
const ss = apiLog.filter((e) => e.path === "/config/site-settings");
const checks = {
  A_play_token_preflight_204: pt.some((e) => e.method === "OPTIONS" && e.origin === APP && e.status === 204 && e.acao === APP),
  A_play_token_post_200_with_acao: pt.some((e) => e.method === "POST" && e.origin === APP && e.status === 200 && e.acao === APP),
  B_hls_asked_cdn_for_granted_master: !!grantUrl && cdnAsks.includes(grantUrl),
  // hls.js attaches a blob: MediaSource; a browser with native HLS takes the URL itself. Either way: no tap.
  B_video_has_source_without_tap: (state.videoSrc ?? "").startsWith("blob:") || (!!grantUrl && state.videoSrc === grantUrl),
  C_site_settings_reached_api_with_acao: ss.some((e) => e.method === "GET" && e.origin === APP && e.status === 200 && e.acao === APP),
  C_page_shows_edge_value: state.setting === 'setting:"served-by-the-edge"',
  D_nothing_asked_of_localhost_api: !localAsks.some((p) => p.startsWith("/api/") || p.startsWith("/config/")),
};
const pass = Object.values(checks).every(Boolean);
const result = {
  journey: "app-video-cors", at: new Date().toISOString(), pass, checks,
  netFails, apiLog, cdnAsks: cdnAsks.map((u) => u.replace(/t=[^&]+/, "t=<token>")),
  localAsks: localAsks.filter((p) => !/\.(js|css|svg|png|woff2)$/.test(p)),
  state: { ...state, videoSrc: state.videoSrc ? state.videoSrc.replace(/t=[^&]+/, "t=<token>") : null },
};
console.log(JSON.stringify(result, null, 2));
if (out) writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
process.exit(pass ? 0 : 1);
