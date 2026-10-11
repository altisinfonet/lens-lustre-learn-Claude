/**
 * VID-1 · a video post is written in ONE step (20261011_0003).
 *
 * Owner, staging 2026-10-11: an "empty post" on the wall and "Duplicate post
 * detected". Both came from publishing a video post in two requests (post,
 * then its post_videos link). These assertions read the LAST definition of
 * each function across the migrations (the one that is live) and check the
 * properties that make the one-step publish safe, not just present.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MIGRATIONS_DIR, migrationsInSequence } from "@/test-utils/migrations";

const bodies = migrationsInSequence(MIGRATIONS_DIR).map((f) =>
  readFileSync(join(MIGRATIONS_DIR, f), "utf8").replace(/--.*$/gm, " "),
);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function lastDefinitionOf(fn: string, quote: string): string {
  const q = esc(quote);
  const re = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${fn}\\s*\\([\\s\\S]*?${q}[\\s\\S]*?${q};`, "gi");
  let latest = "";
  for (const b of bodies) for (const m of b.matchAll(re)) latest = m[0];
  return latest;
}

describe("video_publish_post — post and video link in one transaction", () => {
  const fn = lastDefinitionOf("video_publish_post", "$fn$");

  it("exists (vacuity guard)", () => {
    expect(fn.length, "no migration defines video_publish_post").toBeGreaterThan(0);
  });

  it("runs as the member (SECURITY INVOKER), so every posts/post_videos rule still applies", () => {
    expect(fn).toMatch(/SECURITY INVOKER/);
    expect(fn).not.toMatch(/SECURITY DEFINER/);
    expect(fn).toMatch(/SET search_path TO ''/);
  });

  it("writes the post, then the link, in the same function body (one transaction)", () => {
    const post = fn.indexOf("INSERT INTO public.posts");
    const link = fn.lastIndexOf("INSERT INTO public.post_videos");
    expect(post).toBeGreaterThan(-1);
    expect(link).toBeGreaterThan(post);
  });

  it("is idempotent by key: a replay returns the existing post before any insert", () => {
    const replay = fn.indexOf("p.idempotency_key = _idempotency_key");
    expect(replay).toBeGreaterThan(-1);
    expect(replay).toBeLessThan(fn.indexOf("INSERT INTO public.posts"));
  });

  it("sets the duplicate-guard marker transaction-locally, only around its own post insert", () => {
    const on = fn.indexOf("set_config('vid1.publishing_video', _video_id::text, true)");
    const off = fn.indexOf("set_config('vid1.publishing_video', '', true)");
    const post = fn.indexOf("INSERT INTO public.posts");
    expect(on).toBeGreaterThan(-1);
    expect(on).toBeLessThan(post);
    expect(off).toBeGreaterThan(post);
  });

  it("is granted to authenticated only", () => {
    const all = bodies.join("\n");
    expect(all).toMatch(/REVOKE ALL ON FUNCTION public\.video_publish_post\(uuid, text, text, text\[\], text\) FROM PUBLIC, anon;/);
    expect(all).toMatch(/GRANT EXECUTE ON FUNCTION public\.video_publish_post\(uuid, text, text, text\[\], text\) TO authenticated;/);
  });
});

describe("detect_duplicate_post — skips only a verified video publish", () => {
  const dup = lastDefinitionOf("detect_duplicate_post", "$function$");

  it("re-checks the video itself, never trusting the marker alone", () => {
    const at = dup.indexOf("current_setting('vid1.publishing_video', true)");
    expect(at, "the video-publish skip is gone: same caption on two videos is refused again").toBeGreaterThan(-1);
    const skip = dup.slice(at, dup.indexOf("RETURN NEW;", at));
    for (const must of ["v.owner_id = NEW.user_id", "v.state = 'ready'", "v.purpose = 'post'", "NOT EXISTS (SELECT 1 FROM public.post_videos pv WHERE pv.video_id = pub::uuid)"]) {
      expect(skip, `the skip no longer checks: ${must}`).toContain(must);
    }
  });

  it("the skip comes before the hash, lock and window — and those are all still there", () => {
    const skip = dup.indexOf("current_setting('vid1.publishing_video', true)");
    const lock = dup.indexOf("pg_advisory_xact_lock");
    expect(skip).toBeGreaterThan(-1);
    expect(skip).toBeLessThan(lock);
    expect(dup).toContain("interval '10 minutes'");
    expect(dup).toContain("Duplicate post detected");
  });
});
