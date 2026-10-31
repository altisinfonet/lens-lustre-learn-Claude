#!/usr/bin/env node
/**
 * S5-d · THE 8-POINT KILL HARNESS — `node tools/uishot/photo-kill-harness.mjs`.
 *
 * Gate (master plan, verbatim): "v2 8-point kill test: at all 8 kill points →
 * exactly 1 post, 0 orphans, 0 duplicate media". The 8 points are v2 §4
 * (ENGINEERING_PLAN_V2_APPROVED_ARCHITECTURE.md), mapped in
 * docs/evidence/d2/S5/DESIGN.md §2.
 *
 * A real browser runs the REAL upload code (photouploadharness.html →
 * src/uiharness/photoupload/main.ts): a 2-photo post (8 stored objects). The
 * SERVER lives here, in Node, so it survives the page being killed. It is the
 * server's contract, no more: presign hands out a URL per key, a PUT stores
 * the key (an S3 PUT is atomic — an interrupted one stores nothing),
 * media_begin_upload is UNIQUE (owner, sha256), media-register-upload needs
 * the object stored, post_publish_with_media is UNIQUE (user, idempotency_key)
 * and returns the post a key already made.
 *
 * For each kill point: a fresh browser profile; start the post; when the
 * server sees the kill event the PAGE IS CLOSED mid-request (the app killed);
 * a new page opens on the same profile (relaunch) and resumes; then the server
 * is counted: posts === 1, orphan objects === 0 (stored keys no post
 * references), duplicate media === 0 (media rows beyond one per photo).
 *
 *   --impl job       the S5-b resumable photo job (default) — must pass 8/8
 *   --impl legacy    the pre-S5 pipeline (fresh keys, nothing kept on the
 *                    device; after a kill the member posts again)
 *   --expect-fail    CONTROL: the verdict is PASS only if at least one kill
 *                    point FAILS (proves the harness can see the defect)
 *   --origin URL     serve the page at that origin (https://localhost = app)
 *   --json FILE      write the reading
 * Exit code = the verdict.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const IMPL = arg("--impl", "job");
const EXPECT_FAIL = process.argv.includes("--expect-fail");
const ORIGIN = arg("--origin", null);
const OUT = arg("--json", null);
const PORT = 5197;
const BASE = `http://127.0.0.1:${PORT}`;
const PAGE = (ORIGIN ?? BASE).replace(/\/$/, "");
const USER = "11111111-1111-4111-8111-111111111111"; // HARNESS_USER_ID
const PHOTOS = 2;

const KILLS = [
  { n: 1, name: "before presign", on: "presign" },
  { n: 2, name: "after presign", on: "put" },
  { n: 3, name: "10% uploaded", on: "bytes", frac: 0.1 },
  { n: 4, name: "50% uploaded", on: "bytes", frac: 0.5 },
  { n: 5, name: "90% uploaded", on: "bytes", frac: 0.9 },
  { n: 6, name: "after original uploaded", on: "begin" },
  { n: 7, name: "after media ready (derivatives)", on: "publish" },
  { n: 8, name: "after DB post creation", on: "publish", commit: true },
];

function chromePath() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  if (!existsSync(root)) return undefined;
  for (const d of readdirSync(root)) for (const rel of ["chrome-linux/chrome", "chrome-linux64/chrome", "chrome-linux/headless_shell"]) {
    const p = join(root, d, rel);
    if (existsSync(p)) return p;
  }
  return undefined;
}

const server = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], { stdio: ["ignore", "pipe", "pipe"], detached: true });
const stop = () => { try { process.kill(-server.pid, "SIGTERM"); } catch { /* gone */ } };
process.on("exit", stop);
async function waitUp() {
  for (let i = 0; i < 180; i++) {
    try { const r = await fetch(`${BASE}/photouploadharness.html`); if (r.ok) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("dev server did not come up in 180 s");
}

/* ── the server's contract ──────────────────────────────────────────────── */
function newServer() {
  return { posts: new Map(), media: new Map(), mediaByContent: new Map(), postMedia: [], objects: new Map(), sig: 0, putBytes: 0, log: [] };
}
const json = (status, body) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const sign = (S, path) => ({ uploadUrl: `/__s5r2/${path}?sig=${++S.sig}`, publicUrl: `https://cdn.harness.test/${path}`, key: path, expiresIn: 300 });

function answer(S, method, path, query, body) {
  if (path === "/functions/v1/s3-presign-upload") {
    const one = sign(S, body.path);
    return json(200, body.pair ? { ...one, pair: sign(S, body.pair.path) } : one);
  }
  if (path === "/rest/v1/rpc/is_s3_storage_enabled") return json(200, true);
  if (path === "/rest/v1/rpc/media_begin_upload") {
    const k = `${USER}|${body._sha256}`;
    let id = S.mediaByContent.get(k);
    if (!id) { id = randomUUID(); S.mediaByContent.set(k, id); S.media.set(id, { sha: body._sha256, state: "pending", path: null }); }
    return json(200, id);
  }
  if (path === "/functions/v1/media-register-upload") {
    const m = S.media.get(body.media_id);
    if (!m) return json(404, { error: "no such media" });
    if (m.state === "ready") return json(200, { media_id: body.media_id, state: "ready", already: true });
    if (!S.objects.has(body.object_path)) return json(409, { state: "pending" });
    m.state = "ready"; m.path = body.object_path;
    return json(200, { media_id: body.media_id, state: "ready" });
  }
  if (path === "/rest/v1/rpc/post_publish_with_media") {
    for (const [id, p] of S.posts) if (p.key === body._idempotency_key) return json(200, id);
    if (body._media_ids.some((id) => S.media.get(id)?.state !== "ready")) return json(400, { message: "media not ready" });
    const id = randomUUID();
    S.posts.set(id, { key: body._idempotency_key, media: body._media_ids, thumbs: body._thumbnail_urls });
    body._media_ids.forEach((m, ord) => S.postMedia.push({ post: id, media: m, ord }));
    return json(200, id);
  }
  if (path === "/rest/v1/posts" && method === "POST") {
    // The legacy fallback: only reached if the media path failed. Same UNIQUE.
    for (const [, p] of S.posts) if (p.key && p.key === body.idempotency_key) return json(409, { code: "23505", message: "duplicate key" });
    const id = randomUUID();
    S.posts.set(id, { key: body.idempotency_key ?? null, media: [], urls: body.image_urls, thumbs: body.thumbnail_urls });
    return json(201, { id });
  }
  if (path === "/rest/v1/posts" && method === "GET") {
    const key = (query.get("idempotency_key") ?? "").replace(/^eq\./, "");
    for (const [id, p] of S.posts) if (p.key === key) return json(200, { id });
    return json(406, { code: "PGRST116", message: "no rows" });
  }
  return json(404, { error: `harness: no answer for ${method} ${path}` });
}

/** posts, orphan objects, duplicate media — the gate's three numbers. */
function count(S) {
  const referenced = new Set();
  const keyOf = (u) => u.replace(/^https:\/\/cdn\.harness\.test\//, "");
  for (const [, p] of S.posts) {
    for (const id of p.media) {
      const full = S.media.get(id)?.path;
      if (!full) continue;
      referenced.add(full);
      referenced.add(full.replace(/\.webp$/, "-thumb.webp"));
      for (const r of [1080, 1440]) referenced.add(full.replace(/\.webp$/, `-r${r}.webp`));
    }
    for (const u of [...(p.urls ?? []), ...(p.thumbs ?? [])]) {
      const k = keyOf(u);
      referenced.add(k);
      for (const r of [1080, 1440]) referenced.add(k.replace(/\.webp$/, `-r${r}.webp`));
    }
  }
  const orphans = [...S.objects.keys()].filter((k) => !referenced.has(k));
  return { posts: S.posts.size, orphanObjects: orphans.length, duplicateMedia: Math.max(0, S.media.size - PHOTOS), objects: S.objects.size, mediaRows: S.media.size };
}

/* ── the browser ────────────────────────────────────────────────────────── */
const originCache = new Map();
async function serveAtOrigin(ctx) {
  await ctx.route(`${PAGE}/**`, async (route) => {
    const req = route.request();
    const url = BASE + req.url().slice(PAGE.length);
    try {
      let hit = req.method() === "GET" ? originCache.get(url) : undefined;
      if (!hit) {
        const res = await route.fetch({ url });
        hit = { status: res.status(), headers: res.headers(), body: await res.body() };
        if (req.method() === "GET" && hit.status === 200) originCache.set(url, hit);
      }
      await route.fulfill(hit);
    } catch { await route.abort().catch(() => {}); }
  });
  const wsOrigin = PAGE.replace(/^https/, "wss");
  await ctx.routeWebSocket((u) => u.href.startsWith(wsOrigin), (ws) => { ws.connectToServer(BASE.replace(/^http/, "ws") + ws.url().slice(wsOrigin.length)); });
}

async function waitFor(page, fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}
const readState = (page) => page.evaluate(() => window.__s5 ?? null).catch(() => null);

async function runPoint(browser, kill, totalBytes) {
  const S = newServer();
  const ctx = await browser.newContext();
  if (ORIGIN) await serveAtOrigin(ctx);
  let page = null;
  let armed = !!kill;
  let killed = false;
  const counts = { presign: 0, put: 0, begin: 0, publish: 0 };
  const doKill = async () => { armed = false; killed = true; S.log.push(`KILL at ${kill.name}`); await page.close().catch(() => {}); };

  await ctx.route("**/__s5r2/**", async (route) => {
    const req = route.request();
    const key = decodeURIComponent(new URL(req.url()).pathname.slice("/__s5r2/".length));
    const size = req.postDataBuffer()?.length ?? 0;
    counts.put++;
    if (armed && kill.on === "put" && counts.put === 1) return doKill();
    if (armed && kill.on === "bytes" && S.putBytes + size >= kill.frac * totalBytes) return doKill();
    S.objects.set(key, size);
    S.putBytes += size;
    await route.fulfill({ status: 200, body: "" });
  });
  await ctx.route("**/__s5api/**", async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const path = u.pathname.slice("/__s5api".length);
    let body = {};
    try { body = req.postData() ? JSON.parse(req.postData()) : {}; } catch { /* not json */ }
    const ev = path.endsWith("s3-presign-upload") ? "presign" : path.endsWith("media_begin_upload") ? "begin" : path.endsWith("post_publish_with_media") ? "publish" : null;
    if (ev) counts[ev]++;
    if (armed && ev === kill.on && counts[ev] === 1) {
      if (kill.commit) answer(S, req.method(), path, u.searchParams, body); // committed, then the answer is lost
      return doKill();
    }
    await route.fulfill(answer(S, req.method(), path, u.searchParams, body));
  });

  const open = async (phase) => {
    page = await ctx.newPage();
    await page.goto(`${PAGE}/photouploadharness.html?impl=${IMPL}&phase=${phase}`);
  };
  await open("start");
  const startEnded = await waitFor(page, async () => killed || !!((await readState(page))?.done || (await readState(page))?.error), 120_000);
  const startState = killed ? null : await readState(page);
  let resumeState = null;
  if (kill) {
    if (!killed) { await ctx.close(); return { kill: kill?.name, n: kill?.n, reached: false, startState, verdict: "FAIL", why: "the kill point was never reached" }; }
    await open("resume");
    await waitFor(page, async () => { const s = await readState(page); return !!(s?.done || s?.error); }, 120_000);
    resumeState = await readState(page);
  }
  const c = count(S);
  await ctx.close();
  const ok = c.posts === 1 && c.orphanObjects === 0 && c.duplicateMedia === 0;
  return { n: kill?.n ?? 0, kill: kill?.name ?? "no kill (calibration)", reached: kill ? killed : startEnded, startState, resumeState, ...c, putBytes: S.putBytes, verdict: ok ? "PASS" : "FAIL" };
}

const result = { at: new Date().toISOString(), impl: IMPL, origin: PAGE, expectFail: EXPECT_FAIL, calibration: null, points: [], verdict: "FAIL" };
let code = 1;
try {
  await waitUp();
  const exe = chromePath();
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  // Calibration: the same post with no kill — must be clean, and measures the bytes for the 10/50/90 % points.
  result.calibration = await runPoint(browser, null, 0);
  const total = result.calibration.putBytes;
  if (result.calibration.verdict !== "PASS" || total === 0) throw new Error(`calibration run is not clean: ${JSON.stringify(result.calibration)}`);
  for (const k of KILLS) {
    const r = await runPoint(browser, k, total);
    result.points.push(r);
    console.log(`${r.verdict}  ${k.n}. ${k.name.padEnd(32)} posts=${r.posts} orphans=${r.orphanObjects} dupMedia=${r.duplicateMedia}${r.why ? ` (${r.why})` : ""}${r.resumeState?.error ? ` resume error: ${r.resumeState.error}` : ""}`);
  }
  await browser.close();
  const passed = result.points.filter((p) => p.verdict === "PASS").length;
  const allReached = result.points.every((p) => p.reached);
  if (EXPECT_FAIL) result.verdict = allReached && passed < KILLS.length ? "PASS" : "FAIL";
  else result.verdict = passed === KILLS.length ? "PASS" : "FAIL";
  console.log(`${IMPL}${EXPECT_FAIL ? " (control: must fail somewhere)" : ""}: ${passed}/${KILLS.length} kill points clean → ${result.verdict}`);
  code = result.verdict === "PASS" ? 0 : 1;
} catch (e) {
  result.error = e instanceof Error ? e.message : String(e);
  console.error("harness error:", result.error);
} finally {
  if (OUT) writeFileSync(OUT, JSON.stringify(result, null, 2));
  stop();
  process.exit(code);
}
