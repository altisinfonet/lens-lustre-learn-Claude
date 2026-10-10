#!/usr/bin/env node
/**
 * F-AUD-3 / R-82 — self-test for scripts/health-check.mjs's "member activity" rule.
 *
 * R-82 (Owner): live traffic readings are monitors only and never block a close.
 * F-AUD-3: the scheduled "Is the live site healthy?" run failed main when nobody
 * had posted or commented for 36 h. A quiet community is a traffic reading, so
 * that rule must WARN (exit 0, visible) — and every real fault must still FAIL.
 *
 * Runs the REAL script in a child process with `fetch` replaced by a fixture
 * backend (a preload written to a temp dir). Connects to nothing, holds no
 * secret. Run: node scripts/web-health-activity.test.mjs
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "health-check.mjs");
const dir = mkdtempSync(join(tmpdir(), "health-activity-"));

/** One fixture backend per scenario. `activity` = rows the 36 h queries return. */
function runWith(name, { posts36 = [], comments36 = [], activityStatus = 200, misaligned = false }) {
  const fixture = {
    posts36, comments36, activityStatus,
    thumbs: misaligned
      ? [{ id: "p-bad", created_at: "2026-10-09T00:00:00Z", image_urls: ["a", "b"], thumbnail_urls: ["a-t"] }]
      : [],
  };
  const preload = join(dir, `${name}.mjs`);
  writeFileSync(preload, `
const F = ${JSON.stringify(fixture)};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = async (input) => {
  const url = String(input);
  if (url.includes("api.github.com")) return json({ message: "rate limited" }, 403);
  if (url.includes("/rest/v1/posts?select=id&created_at=gte.")) return F.activityStatus === 200 ? json(F.posts36) : json({ message: "boom" }, F.activityStatus);
  if (url.includes("/rest/v1/post_comments?select=id&created_at=gte.")) return json(F.comments36);
  if (url.includes("/rest/v1/posts?select=id,created_at,image_urls,thumbnail_urls")) return json(F.thumbs);
  throw new Error("fixture backend: no answer for " + url);
};
`);
  const r = spawnSync(process.execPath, ["--import", pathToFileURL(preload).href, SCRIPT], {
    env: { PATH: process.env.PATH, SUPABASE_ANON_KEY: "test-anon-key-not-real" },
    encoding: "utf8",
    timeout: 30_000,
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

let failures = 0;
const ok = (cond, label, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) { failures++; if (detail) console.log(detail.split("\n").map((l) => "    " + l).join("\n")); }
};

// 1. THE F-AUD-3 CASE: nobody posted or commented for 36 h → warning, not failure.
const quiet = runWith("quiet", { posts36: [], comments36: [] });
ok(quiet.code === 0, "no posts AND no comments for 36 h → exit 0 (R-82: a reading never blocks)", quiet.out);
ok(/WARNING/.test(quiet.out) && /36 hours/.test(quiet.out), "…and the quiet spell is still SAID, as a warning", quiet.out);
ok(!/PROBLEMS FOUND/.test(quiet.out), "…and it is not reported as a problem", quiet.out);
ok(/::warning/.test(quiet.out), "…and it becomes a GitHub annotation, so the run page shows it", quiet.out);

// 2. Ordinary day: activity present → no warning at all.
const busy = runWith("busy", { posts36: [{ id: "p1" }], comments36: [] });
ok(busy.code === 0 && /HEALTHY/.test(busy.out), "one post in 36 h → HEALTHY, exit 0", busy.out);
ok(!/WARNING/.test(busy.out), "…with no warning", busy.out);

// 3. Real faults still FAIL — the rule was narrowed, not the check.
const broken = runWith("broken-query", { activityStatus: 500 });
ok(broken.code === 1 && /PROBLEMS FOUND/.test(broken.out), "activity query itself errors → still exit 1 (could-not-run is a fault)", broken.out);
const thumbs = runWith("misaligned", { posts36: [{ id: "p1" }], misaligned: true });
ok(thumbs.code === 1 && /do not line up/.test(thumbs.out), "misaligned thumbnails → still exit 1", thumbs.out);
const both = runWith("quiet-and-misaligned", { misaligned: true });
ok(both.code === 1 && /do not line up/.test(both.out) && /WARNING/.test(both.out), "a real fault AND a quiet spell → exit 1, warning still listed", both.out);

console.log(failures ? `\nFAIL: ${failures} assertion(s)` : "\nPASS");
process.exit(failures ? 1 : 0);
