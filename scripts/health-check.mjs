#!/usr/bin/env node
/**
 * 50mm Retina World — automated health check.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Owner, 2026-08-07, after the second image outage in three days:
 *   "this is a live site, even i can't find all issues too... i am upset what to
 *    do to maintain it"
 *
 * Every incident in this project's history was found the same way: by the owner,
 * on his phone, after members were already affected. The Cloudflare image
 * outage, the mojibake, the search freeze, the guessed-thumbnail failure — all
 * of them. That is the actual problem. Software should find them first.
 *
 * This is that software. It is deliberately BORING: it asks a small number of
 * questions that have provably caught real outages here, and it says nothing at
 * all when the answers are fine, so that any output at all means "look at me".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT CANNOT DO, AND WHY — READ THIS BEFORE ADDING CHECKS
 *
 * Measured 2026-08-07 from this cloud environment:
 *
 *     https://jtdtehuqtinjxropkkcn.supabase.co/rest/...   200  ✓
 *     https://jtdtehuqtinjxropkkcn.supabase.co/storage/.. 200  ✓
 *     https://api.github.com/...                          200  ✓
 *     https://cdn.50mmretina.com/...                      403  ✗
 *     https://www.50mmretina.com/                         403  ✗
 *
 * THE FIRST DIAGNOSIS OF THAT 403 WAS WRONG — corrected 2026-08-09.
 *
 * It was recorded here as "Cloudflare rejects datacenter IPs, so no server-side
 * checker can ever reach the site". That was a conclusion drawn from a status
 * code without checking it — the same mistake that caused the outage this
 * script exists to catch. Re-measured with full headers:
 *
 *     supabase.co        →  HTTP/1.1 200 Connection Established  (proxy tunnel)
 *     www.50mmretina.com →  HTTP/1.1 403, Content-Length: 36, NO cf-* headers
 *     example.com        →  connection failure
 *     cloudflare.com     →  connection failure
 *
 * A Cloudflare block carries cf-ray/server headers and a challenge body. This
 * has neither, refuses the CONNECT itself, and blocks example.com too — so it
 * is the SANDBOX's own egress allowlist, not the site's protection. Confirmed
 * from the owner's Cloudflare dashboard the same day: of 3,560 requests in 24h,
 * exactly 11 were mitigated. Cloudflare is not blocking monitoring.
 *
 * CONSEQUENCE: the full live check IS possible from any runner with open
 * internet — GitHub Actions, a VPS, an uptime service. Only the Cowork sandbox
 * cannot reach the site. So the live checks are gated on DEEP rather than
 * abandoned:
 *
 *     DEEP=1 node scripts/health-check.mjs   ← CI / anywhere with open internet
 *     node scripts/health-check.mjs          ← sandbox; skips the live checks
 *
 * Unreached is NOT reported as down. "I could not reach it" and "it is broken"
 * are different claims, and conflating them is how a watchdog starts crying
 * wolf — which is the one thing that makes it useless.
 */

const SUPABASE_URL = "https://jtdtehuqtinjxropkkcn.supabase.co";
/** The PUBLIC anon key — the same one shipped in every browser bundle. Not a secret. */
const ANON =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp0ZHRlaHVxdGluanhyb3Bra2NuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM1NzI3MjEsImV4cCI6MjA5OTE0ODcyMX0.qY8BI5LXb6uLzTwbpf8AleZ6UZyfeaOA0q4_TC5CEpo";
const REPO = "altisinfonet/lens-lustre-learn-Claude";

const H = { apikey: ANON, Authorization: `Bearer ${ANON}` };
const problems = [];
const notes = [];
const fail = (title, detail) => problems.push({ title, detail });

const j = async (path) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: H });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 120)}`);
  return r.json();
};

/** Load an image URL the way a browser would, and say whether bytes came back. */
async function imageLoads(url) {
  try {
    const r = await fetch(url, { method: "GET" });
    if (!r.ok) return false;
    const buf = await r.arrayBuffer();
    return buf.byteLength > 0;
  } catch {
    return false;
  }
}

/* ── CHECK 1 — the thumbnail contract ────────────────────────────────────────
 * THIS IS THE ONE THAT MATTERS. Both August image outages were failures of the
 * relationship between a post's images and its thumbnails:
 *   - 2026-08-07: the app GUESSED thumbnail addresses instead of reading them,
 *     and for ~1 post in 3 the guess pointed at a file that does not exist.
 * A post whose thumbnail_urls do not line up 1:1 with its image_urls is the
 * shape of that bug, and it is visible here long before anyone scrolls past it.
 */
async function checkThumbnailContract() {
  const posts = await j(
    "posts?select=id,created_at,image_urls,thumbnail_urls&image_urls=not.is.null&order=created_at.desc&limit=1000",
  );
  /**
   * "Updated their profile picture" posts carry an AVATAR as their image, and
   * avatars never go through the post-thumbnail pipeline — they are already
   * small and are served direct. They legitimately have no thumbnail, so
   * counting them as missing is a false alarm.
   *
   * Caught on this script's very first run, 2026-08-09: it flagged exactly one
   * such post and the flag was wrong. Left unfixed it would have cried wolf
   * every time anyone changed their profile photo — and a watchdog that is
   * routinely wrong gets ignored, which is worse than having none at all.
   *
   * (Worth noting: these posts DID show the grey placeholder under the
   * 2026-08-07 bug, because deriving from ".../avatar.webp" produced
   * ".../avatar-thumb.webp", which has never existed. Reading the recorded
   * address — null here — correctly falls back to the avatar itself.)
   */
  const isAvatarPost = (p) =>
    (p.image_urls || []).every((u) => typeof u === "string" && u.includes("/avatars/"));

  const withImages = posts.filter(
    (p) => (p.image_urls || []).length > 0 && !isAvatarPost(p),
  );
  const misaligned = withImages.filter((p) => {
    const t = p.thumbnail_urls || [];
    return t.length > 0 && t.length !== p.image_urls.length;
  });
  const missing = withImages.filter((p) => (p.thumbnail_urls || []).length === 0);

  notes.push(`posts with images: ${withImages.length}`);

  if (misaligned.length) {
    fail(
      `${misaligned.length} post(s) have thumbnails that do not line up with their images`,
      "A mismatched array is how photo 1's thumbnail ends up under photo 2. " +
        `Newest: ${misaligned[0].id} (${misaligned[0].created_at}).`,
    );
  }
  // Posts predating the thumbnail pipeline legitimately have none — they show
  // the full original. Only flag it if a RECENT post is missing one, which
  // would mean the upload pipeline has stopped producing them.
  const recentMissing = missing.filter(
    (p) => Date.now() - Date.parse(p.created_at) < 3 * 24 * 60 * 60 * 1000,
  );
  if (recentMissing.length) {
    fail(
      `${recentMissing.length} post(s) from the last 3 days have NO thumbnail`,
      "The upload pipeline may have stopped generating them — new photos will " +
        `load slowly for everyone. Newest: ${recentMissing[0].id}.`,
    );
  }
  return withImages;
}

/* ── CHECK 2 — thumbnails that are actually reachable from here ──────────────
 * Only the Supabase-hosted ones can be verified server-side (see the note at
 * the top about Cloudflare). That is still a real sample of real member-facing
 * images, and it is exactly the set that the 2026-08-07 bug broke.
 */
async function checkImagesLoad(withImages) {
  const supabaseThumbs = withImages
    .map((p) => (p.thumbnail_urls || [])[0])
    .filter((u) => typeof u === "string" && u.includes("supabase.co"));

  if (supabaseThumbs.length === 0) {
    notes.push("no supabase-hosted thumbnails to sample (all on the CDN)");
    return;
  }
  const sample = supabaseThumbs.slice(0, 25);
  const results = await Promise.all(sample.map(imageLoads));
  const broken = results.filter((ok) => !ok).length;
  notes.push(`supabase-hosted thumbnails sampled: ${sample.length}, broken: ${broken}`);

  // One failure is a blip; a cluster is an outage.
  if (broken > Math.max(1, Math.floor(sample.length * 0.1))) {
    fail(
      `${broken} of ${sample.length} sampled member photos did not load`,
      "Images are failing at a rate that members will notice.",
    );
  }
}

/* ── CHECK 3 — is anybody still able to use the site? ────────────────────────
 * The site cannot be fetched from here, so liveness is inferred from member
 * behaviour instead. A community that posts every day and then posts NOTHING
 * for a day is the signature of an outage nobody has reported yet — including
 * the "app works but nothing loads" failures that do not throw errors.
 */
async function checkActivity() {
  const since = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
  const [posts, comments] = await Promise.all([
    j(`posts?select=id&created_at=gte.${since}&limit=200`),
    j(`post_comments?select=id&created_at=gte.${since}&limit=200`).catch(() => null),
  ]);
  notes.push(
    `last 36h — posts: ${posts.length}` +
      (comments ? `, comments: ${comments.length}` : ""),
  );
  if (posts.length === 0 && (!comments || comments.length === 0)) {
    fail(
      "No posts OR comments anywhere in the last 36 hours",
      "For a community this active that is not quiet, it is broken. Check the " +
        "site and the app before assuming it is a slow day.",
    );
  }
}

/* ── CHECK 4 — did the last release actually build? ──────────────────────────
 * A red Android build means the app the owner is about to upload does not
 * exist. A red typecheck/security run means main is broken for the website too.
 */
async function checkCI() {
  const r = await fetch(
    `https://api.github.com/repos/${REPO}/actions/runs?per_page=12&branch=main`,
    { headers: { Accept: "application/vnd.github+json" } },
  );
  if (!r.ok) {
    // 403 here is almost always the unauthenticated rate limit (60/hour), not
    // an outage — so it is a note, never a problem. Nothing about the live site
    // can be inferred from it.
    const why = r.status === 403 ? "rate-limited" : `HTTP ${r.status}`;
    notes.push(`github api ${why} — CI not checked this run`);
    return;
  }
  const { workflow_runs = [] } = await r.json();
  const finished = workflow_runs.filter((w) => w.status === "completed");
  const failed = finished.filter((w) => w.conclusion === "failure");
  notes.push(`recent CI runs: ${finished.length}, failed: ${failed.length}`);
  for (const w of failed.slice(0, 3)) {
    fail(
      `CI failed: ${w.name} #${w.run_number}`,
      `${(w.head_commit?.message || "").split("\n")[0]} — ${w.html_url}`,
    );
  }
}

/* ── CHECK 5 — the live site and real member photos (DEEP only) ─────────────
 * Everything above infers health from the database. This is the only check that
 * asks the question a member would ask: does the page come back, and do the
 * photographs actually arrive? It needs open internet (see the header), so it
 * runs in CI and is skipped — never failed — in the sandbox.
 */
async function checkLiveSite(withImages) {
  if (!process.env.DEEP) {
    notes.push("live site + CDN checks skipped (set DEEP=1 on a runner with open internet)");
    return;
  }

  // 1. The website itself.
  for (const url of ["https://www.50mmretina.com/", "https://www.50mmretina.com/feed"]) {
    try {
      const r = await fetch(url, { redirect: "follow" });
      const body = r.ok ? await r.text() : "";
      if (!r.ok) {
        fail(`The website returned HTTP ${r.status}`, url);
      } else if (!body.includes("<div id=\"root\">")) {
        fail("The website loaded but the app shell is missing", `${url} — the page came back without its root element, which means members would see a blank page.`);
      }
    } catch (e) {
      fail("The website could not be loaded at all", `${url} — ${String(e).slice(0, 120)}`);
    }
  }

  // 2. Real member photographs, straight off the CDN — the exact thing that
  //    broke on 2026-08-07 and that nothing else here can see.
  const cdn = withImages
    .flatMap((p) => [(p.thumbnail_urls || [])[0], (p.image_urls || [])[0]])
    .filter((u) => typeof u === "string" && u.includes("cdn.50mmretina.com"));
  const sample = [...new Set(cdn)].slice(0, 30);
  if (sample.length) {
    const results = await Promise.all(sample.map(imageLoads));
    const broken = results.filter((ok) => !ok).length;
    notes.push(`CDN photos sampled: ${sample.length}, broken: ${broken}`);
    if (broken > Math.max(1, Math.floor(sample.length * 0.1))) {
      fail(
        `${broken} of ${sample.length} real member photographs did not load from the CDN`,
        "This is the 2026-08-07 failure shape. Check whether the app is asking " +
          "for addresses that do not exist, and whether search has also slowed down.",
      );
    }
  }
}

/* ── Run ─────────────────────────────────────────────────────────────────── */
const run = async (name, fn) => {
  try {
    return await fn();
  } catch (e) {
    fail(`The "${name}" check could not run`, String(e).slice(0, 200));
    return null;
  }
};

const withImages = (await run("thumbnail contract", checkThumbnailContract)) || [];
await run("images load", () => checkImagesLoad(withImages));
await run("member activity", checkActivity);
await run("CI health", checkCI);
await run("live site", () => checkLiveSite(withImages));

const stamp = new Date().toISOString().replace("T", " ").slice(0, 16);
if (problems.length === 0) {
  console.log(`HEALTHY — 50mm Retina World, ${stamp} UTC`);
  console.log(notes.map((n) => `  · ${n}`).join("\n"));
  process.exit(0);
}

console.log(`PROBLEMS FOUND — 50mm Retina World, ${stamp} UTC\n`);
problems.forEach((p, i) => {
  console.log(`${i + 1}. ${p.title}`);
  console.log(`   ${p.detail}\n`);
});
console.log("Context:");
console.log(notes.map((n) => `  · ${n}`).join("\n"));
process.exit(1);

/* ── DEEP CHECK — the part that needs a real browser ─────────────────────────
 * Because Cloudflare blocks this environment, the following can only be checked
 * from the owner's own Chrome, and are worth running whenever it is connected:
 *
 *   1. open https://www.50mmretina.com/feed
 *   2. count images where `complete && naturalWidth === 0` — expect 0
 *   3. count images whose src is the branded placeholder data-URI — expect 0
 *   4. count requests containing "__r=" — a high number means the retry storm
 *      is back (it is capped since 2026-08-07, so this should stay near zero)
 *   5. open search, type a name, confirm a result appears and backspace works
 *
 * Steps 2-4 are the exact measurements that proved the 2026-08-07 fix.
 */
