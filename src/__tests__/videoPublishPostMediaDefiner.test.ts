/**
 * VID-1 · 20261013_0004 — video_publish_post() must not read post_media as the
 * member.
 *
 * Independent review of PR #424 (2026-10-13): video_publish_post() is SECURITY
 * INVOKER and its replay branch read public.post_media as the caller. On
 * production the role authenticated holds no privilege on post_media (and
 * must not — postMediaRead.ts / useFeedQuery.ts), so that replay raised 42501.
 * Staging hid it with a deliberate keep. The behaviour is proved on a
 * production-shaped database by scripts/db-vid1-publish-fixture.mjs (CI:
 * d1-vid1-publish-fixture.yml); these assertions pin the SQL text that the
 * proof depends on, reading the LAST definition across the migrations.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MIGRATIONS_DIR, migrationsInSequence } from "@/test-utils/migrations";

const files = migrationsInSequence(MIGRATIONS_DIR);
const bodies = files.map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8").replace(/--.*$/gm, " "));
const all = bodies.join("\n");

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function lastDefinitionOf(fn: string, quote: string): string {
  const q = esc(quote);
  const re = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${fn}\\s*\\([\\s\\S]*?${q}[\\s\\S]*?${q};`, "gi");
  let latest = "";
  for (const b of bodies) for (const m of b.matchAll(re)) latest = m[0];
  return latest;
}

/** Index of the last migration whose (comment-stripped) text matches re; -1 if none. */
function lastFileMatching(re: RegExp): number {
  let at = -1;
  bodies.forEach((b, i) => { if (re.test(b)) at = i; });
  return at;
}

describe("video_publish_post — no post_media read with the member's privileges", () => {
  const fn = lastDefinitionOf("video_publish_post", "$fn$");

  it("exists (vacuity guard)", () => {
    expect(fn.length).toBeGreaterThan(0);
  });

  it("still runs as the member (SECURITY INVOKER): the posts/post_videos rules keep applying", () => {
    expect(fn).toMatch(/SECURITY INVOKER/);
    expect(fn).not.toMatch(/SECURITY DEFINER/);
  });

  it("never names the post_media table in its body", () => {
    expect(fn, "video_publish_post reads post_media directly — on production that is 42501").not.toMatch(/\bpost_media\b/);
  });

  it("asks the definer helper, inside the photo-post refusal of the replay branch", () => {
    const refuse = fn.indexOf("this publish key belongs to a photo post");
    expect(refuse).toBeGreaterThan(-1);
    expect(fn.slice(0, refuse)).toMatch(/image_urls[\s\S]*image_url[\s\S]*public\.video_publish_own_post_has_media\(_post\)/);
  });
});

describe("video_publish_own_post_has_media — SECURITY DEFINER, judged by its WHERE clause", () => {
  const h = lastDefinitionOf("video_publish_own_post_has_media", "$fn$");

  it("exists (vacuity guard)", () => {
    expect(h.length, "no migration defines video_publish_own_post_has_media").toBeGreaterThan(0);
  });

  it("is SECURITY DEFINER, STABLE, with an empty search_path", () => {
    expect(h).toMatch(/SECURITY DEFINER/);
    expect(h).toMatch(/\bSTABLE\b/);
    expect(h).toMatch(/SET search_path TO ''/);
  });

  it("answers only for the caller's own post: the post id AND the author = auth.uid()", () => {
    expect(h).toMatch(/JOIN public\.posts p ON p\.id = pm\.post_id/);
    expect(h).toMatch(/pm\.post_id = _post_id/);
    expect(h, "the ownership predicate is gone — any member could ask about any post").toMatch(/p\.user_id = \(SELECT auth\.uid\(\)\)/);
    // An OR would let a second branch bypass the ownership predicate.
    expect(h.slice(h.indexOf("WHERE"))).not.toMatch(/\bOR\b/i);
  });

  it("returns a boolean, never a row of post_media", () => {
    expect(h).toMatch(/RETURNS boolean/);
    expect(h).toMatch(/SELECT EXISTS \(/);
  });

  it("EXECUTE: authenticated + service_role only — never PUBLIC or anon", () => {
    expect(all).toMatch(/REVOKE ALL ON FUNCTION public\.video_publish_own_post_has_media\(uuid\) FROM PUBLIC, anon, authenticated, service_role;/);
    expect(all).toMatch(/GRANT EXECUTE ON FUNCTION public\.video_publish_own_post_has_media\(uuid\) TO authenticated, service_role;/);
    expect(all).not.toMatch(/GRANT[^;]*ON FUNCTION public\.video_publish_own_post_has_media[^;]*TO[^;]*\b(anon|PUBLIC)\b/i);
  });
});

describe("post_media — no privilege for the API roles (staging = production)", () => {
  it("a migration revokes everything on post_media from PUBLIC, anon and authenticated", () => {
    expect(lastFileMatching(/REVOKE ALL ON TABLE public\.post_media FROM PUBLIC, anon, authenticated;/)).toBeGreaterThan(-1);
  });

  it("no later migration grants anything on post_media back to anon or authenticated", () => {
    const revoked = lastFileMatching(/REVOKE ALL ON TABLE public\.post_media FROM PUBLIC, anon, authenticated;/);
    const granted = lastFileMatching(/\bGRANT\b[^;]*\bON\s+(?:TABLE\s+)?public\.post_media\b(?!_)[^;]*\bTO\b[^;]*\b(anon|authenticated|PUBLIC)\b/i);
    expect(granted, `a GRANT on post_media to an API role comes after the revoke (${files[granted]})`).toBeLessThan(revoked);
  });
});

describe("20261013_0004 ships with its rollback, its PROBE and its fixture", () => {
  const root = process.cwd();
  it.each([
    "supabase/migrations/20261013_0004_vid1_publish_post_media_definer.sql",
    "supabase/rollback/20261013_0004_vid1_publish_post_media_definer_ROLLBACK.sql",
    "supabase/migrations/PROBE_20261013_0004_vid1_publish_post_media_definer.sql",
    "scripts/db-vid1-publish-fixture.mjs",
    ".github/workflows/d1-vid1-publish-fixture.yml",
  ])("%s exists", (p) => {
    expect(existsSync(join(root, p))).toBe(true);
  });

  it("the PROBE is read-only, lane-guarded and tests cross-member and anon by effect", () => {
    const probe = readFileSync(join(root, "supabase/migrations/PROBE_20261013_0004_vid1_publish_post_media_definer.sql"), "utf8").replace(/\r\n/g, "\n");
    expect(probe).toMatch(/^BEGIN READ ONLY;$/m);
    expect(probe.trimEnd().endsWith("ROLLBACK;")).toBe(true);
    // Nothing that could write: no COMMIT, and no DDL/DML statement outside comments.
    const code = probe.replace(/--.*$/gm, " ");
    expect(code).not.toMatch(/\bCOMMIT\b/i);
    expect(code).not.toMatch(/^\s*(CREATE|ALTER|DROP|GRANT|REVOKE|INSERT|UPDATE|DELETE|TRUNCATE)\b/im);
    expect(code).toMatch(/current_setting\('p32\.lane', true\)[\s\S]*NOT IN \('staging', 'production'\)[\s\S]*PROBE REFUSED/);
    expect(code).toMatch(/SET LOCAL ROLE authenticated;/);
    expect(code).toMatch(/SET LOCAL ROLE anon;/);
    expect(code).toMatch(/G5 cross-member/);
    expect(code).toMatch(/G5 anon can execute the helper/);
    // A lane with nothing to leak must not pass the cross-member check vacuously.
    expect(code).toMatch(/the cross-member check would be vacuous/);
  });

  it("the migration and its rollback are lane-guarded and refuse outside their own pre-state", () => {
    const mig = readFileSync(join(root, "supabase/migrations/20261013_0004_vid1_publish_post_media_definer.sql"), "utf8");
    const rb = readFileSync(join(root, "supabase/rollback/20261013_0004_vid1_publish_post_media_definer_ROLLBACK.sql"), "utf8");
    for (const sql of [mig, rb]) {
      expect(sql).toMatch(/current_setting\('p32\.lane', true\)[\s\S]*NOT IN \('staging', 'production'\)/);
    }
    expect(mig).toMatch(/VID-PM-PRE-001/); // a re-run is refused
    expect(mig).toMatch(/VID-PM-PRE-003/); // the lane's known post_media ACL, or nothing happens
    expect(mig).toMatch(/VID-PM-PRE-005/); // no other caller reads post_media as the member
    expect(rb).toMatch(/VID-PM-RB-PRE-001/);
    // The rollback puts back the 20261011_0003 body and, on staging only, the keep.
    expect(rb).toMatch(/EXISTS \(SELECT 1 FROM public\.post_media pm WHERE pm\.post_id = _post\)/);
    expect(rb).toMatch(/current_setting\('p32\.lane', true\) = 'staging' THEN\s+GRANT SELECT ON TABLE public\.post_media TO authenticated;/);
    expect(rb).toMatch(/DROP FUNCTION public\.video_publish_own_post_has_media\(uuid\);/);
  });

  it("the fixture fails first: the AFTER assertions must be red on the unfixed body", () => {
    const runner = readFileSync(join(root, "scripts/db-vid1-publish-fixture.mjs"), "utf8");
    // An expected-failure step over 40_after.sql, before the migration step.
    const failFirst = runner.indexOf('["fail", "FAIL-FIRST');
    const apply = runner.indexOf('["ok", "20261013_0004 (verbatim)"');
    expect(failFirst).toBeGreaterThan(-1);
    expect(apply).toBeGreaterThan(failFirst);
    expect(runner.slice(failFirst, apply)).toMatch(/40_after\.sql[\s\S]*tx: true/);
    // Both lane shapes run, and the runner refuses any host that is not local.
    expect(runner).toMatch(/for \(const shape of \["production", "staging"\]\)/);
    expect(runner).toMatch(/REFUSED: PGHOST must be a local throwaway server/);
  });
});
