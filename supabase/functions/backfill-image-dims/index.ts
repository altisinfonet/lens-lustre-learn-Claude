/**
 * DIMS BACKFILL — repair the 59% of slides that render with no srcset at all.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Measured 2026-08-13: 153 of 258 production slides carry no `-wXhY` in their
 * filename. `buildThumbFirstSrcSet` and the frame-aspect parser both need
 * those numbers, so for 59% of all slides EVERY device downloads the
 * full-size original AND the card frame falls back to 4:5. This is the
 * single biggest measured cause of slow, soft-looking photos on the live
 * site — and it is a NAMING problem, so the repair is a renaming.
 *
 * Per slide: read the file's first 64 KiB from R2 → recover width×height from
 * the container header (refusal-first parsers, byte-tested) → server-side
 * COPY to the dimensioned name → VERIFY the copy answers → only then UPDATE
 * the post row to the new URL. The old object is left in place: it stays
 * referenced by nothing after the UPDATE and becomes an ordinary orphan for
 * the Deletion Protocol to collect at 30 days — deleting is not this job's
 * business.
 *
 * ORDERING IS THE SAFETY: copy → verify → update. A member's post never, at
 * any instant, points at a name that does not answer. A crash mid-run leaves
 * extra copies (harmless, collectable), never broken posts.
 *
 * Runs under the operational half of the Deletion Protocol even though it
 * deletes nothing: dry-run by default, execute requires expected_count from a
 * prior dry run, batch cap with a hard ceiling, per-slide skip reasons in the
 * report, and post-update verification. Modifying 153 slides of member data
 * deserves the same ceremony as deleting them.
 *
 * Out of scope, reported not guessed: slides hosted on Supabase storage
 * (28 measured) — different copy API, own small pass later; slides whose
 * header no parser recognises; slides whose URL does not resolve to a
 * managed bucket key.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { copyS3Object, getS3Settings, readS3ObjectHead } from "../_shared/s3.ts";
import { imageDimsFromBytes, insertDimsInName } from "../_shared/imageDims.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUCKETS = [
  "avatars",
  "competition-photos",
  "course-images",
  "email-assets",
  "journal-images",
  "portfolio-images",
  "post-images",
];

/** Already-dimensioned names are not candidates. Mirrors DIMS_RE. */
const HAS_DIMS = /-w\d{1,6}h\d{1,6}(?:-l3)?(?:-thumb)?\.[a-z0-9]+(?:[?#]|$)/i;

const DEFAULT_MAX_POSTS = 25;
const HARD_MAX_POSTS = 100;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** URL → `<bucket>/<path>` key, or null when the host/shape is unmanaged. */
function keyFromUrl(url: string): string | null {
  const clean = url.split("?")[0].split("#")[0];
  if (/\/storage\/v1\/object\//.test(clean)) return null; // supabase-hosted: out of scope
  let path = clean;
  const m = clean.match(/^https?:\/\/[^/]+\/(.+)$/);
  if (m) path = m[1];
  for (const b of BUCKETS) if (path.startsWith(b + "/")) return path;
  return null;
}

interface SlidePlan {
  post_id: string;
  index: number;
  old_url: string;
  new_url: string;
  old_key: string;
  new_key: string;
  width: number;
  height: number;
  already_copied: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims?.sub) return json({ error: "Unauthorized" }, 401);

    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data: roleData } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", claimsData.claims.sub)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleData) return json({ error: "Admin access required" }, 403);

    let dryRun = true;
    let expectedCount: number | null = null;
    let maxPosts = DEFAULT_MAX_POSTS;
    try {
      const body = await req.json();
      if (typeof body?.dry_run === "boolean") dryRun = body.dry_run;
      if (Number.isInteger(body?.expected_count)) expectedCount = body.expected_count;
      if (Number.isInteger(body?.max_posts) && body.max_posts > 0) {
        maxPosts = Math.min(body.max_posts, HARD_MAX_POSTS);
      }
    } catch (_) {
      // empty body — dry run
    }

    const s3 = await getS3Settings(adminClient);
    if (!s3) return json({ error: "S3 storage not configured/enabled" }, 400);
    const prefix = s3.path_prefix ? s3.path_prefix.replace(/\/+$/, "") + "/" : "";

    // ── Candidates: paginated fail-loud, exactly like every reference read
    //    since the near-miss. An error here aborts; it does not mean "done".
    interface PostRow {
      id: string;
      image_url: string | null;
      image_urls: string[] | null;
    }
    const candidates: PostRow[] = [];
    const PAGE = 500;
    for (let from = 0; candidates.length < maxPosts; from += PAGE) {
      const { data, error } = await adminClient
        .from("posts")
        .select("id, image_url, image_urls")
        .order("id")
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`candidate scan failed at offset ${from}: ${error.message}`);
      if (!data || data.length === 0) break;
      for (const row of data as PostRow[]) {
        const urls = row.image_urls ?? [];
        if (urls.some((u) => u && !HAS_DIMS.test(u)) && candidates.length < maxPosts) {
          candidates.push(row);
        }
      }
      if (data.length < PAGE) break;
    }

    // ── Plan: parse dims for every undimensioned slide.
    const plan: SlidePlan[] = [];
    const skipped: { post_id: string; index: number; url: string; reason: string }[] = [];

    for (const post of candidates) {
      const urls = post.image_urls ?? [];
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        if (!url || HAS_DIMS.test(url)) continue;

        const key = keyFromUrl(url);
        if (!key) {
          skipped.push({
            post_id: post.id, index: i, url,
            reason: /\/storage\/v1\/object\//.test(url)
              ? "supabase_storage_host (own pass later)"
              : "unmanaged_url_shape",
          });
          continue;
        }

        const head = await readS3ObjectHead(s3, prefix + key);
        if (head === null) {
          skipped.push({ post_id: post.id, index: i, url, reason: "object_not_found_in_r2" });
          continue;
        }
        const dims = imageDimsFromBytes(head);
        if (!dims) {
          skipped.push({ post_id: post.id, index: i, url, reason: "header_unparseable (refused to guess)" });
          continue;
        }

        const newKey = insertDimsInName(key, dims.width, dims.height);
        const newUrl = insertDimsInName(url, dims.width, dims.height);
        // Idempotent re-run: a copy from an interrupted earlier run is reused,
        // not duplicated.
        const existing = await readS3ObjectHead(s3, prefix + newKey, 1);
        plan.push({
          post_id: post.id, index: i, old_url: url, new_url: newUrl,
          old_key: key, new_key: newKey,
          width: dims.width, height: dims.height,
          already_copied: existing !== null,
        });
      }
    }

    const report = {
      dry_run: dryRun,
      posts_considered: candidates.length,
      max_posts: maxPosts,
      slides_planned: plan.length,
      slides_skipped: skipped.length,
      skip_reasons: skipped,
      sample_plan: plan.slice(0, 10),
    };

    if (dryRun) {
      return json({
        ...report,
        next_step:
          `To execute: POST { "dry_run": false, "expected_count": ${plan.length} } — ` +
          "the count must still match at execution time.",
      });
    }

    // ── EXECUTE. Same gates as the Deletion Protocol, because rewriting 153
    //    slides of member data deserves the same ceremony as deleting them.
    if (expectedCount === null) {
      return json({ ...report, error: "PROTOCOL ABORT: execution requires expected_count from a prior dry run." }, 400);
    }
    if (expectedCount !== plan.length) {
      return json({
        ...report,
        error: `PROTOCOL ABORT: expected_count ${expectedCount} != planned ${plan.length}. ` +
          "Posts changed since the dry run. Re-run it and re-review.",
      }, 409);
    }

    // Copy + verify EVERY slide of a post before its row is touched.
    const byPost = new Map<string, SlidePlan[]>();
    for (const p of plan) {
      byPost.set(p.post_id, [...(byPost.get(p.post_id) ?? []), p]);
    }

    let copied = 0;
    let updatedPosts = 0;
    const failures: { post_id: string; reason: string }[] = [];

    for (const [postId, slides] of byPost) {
      try {
        for (const sl of slides) {
          if (!sl.already_copied) {
            await copyS3Object(s3, prefix + sl.old_key, prefix + sl.new_key);
            copied++;
          }
          // VERIFY: the new name must answer before any row points at it.
          const check = await readS3ObjectHead(s3, prefix + sl.new_key, 1);
          if (check === null) {
            throw new Error(`copy verification failed: ${sl.new_key} does not answer after copy`);
          }
        }

        // All slides of this post verified — now, and only now, the row.
        const post = candidates.find((c) => c.id === postId)!;
        const newUrls = [...(post.image_urls ?? [])];
        let newImageUrl = post.image_url;
        for (const sl of slides) {
          newUrls[sl.index] = sl.new_url;
          if (newImageUrl === sl.old_url) newImageUrl = sl.new_url;
        }
        const { error: upErr } = await adminClient
          .from("posts")
          .update({ image_urls: newUrls, image_url: newImageUrl })
          .eq("id", postId);
        if (upErr) throw new Error(`row update failed: ${upErr.message}`);

        // Post-update verification: read it back.
        const { data: after, error: afterErr } = await adminClient
          .from("posts")
          .select("image_urls")
          .eq("id", postId)
          .single();
        if (afterErr || !slides.every((sl) => (after?.image_urls ?? [])[sl.index] === sl.new_url)) {
          throw new Error("post-update verification failed: row does not show the new URLs");
        }
        updatedPosts++;
      } catch (e) {
        // A failed post leaves at worst extra copies — never a broken row.
        failures.push({ post_id: postId, reason: (e as Error).message });
      }
    }

    return json({
      ...report,
      copied,
      updated_posts: updatedPosts,
      failed_posts: failures,
      note: "Old objects were NOT deleted. They become unreferenced and collectable by the Deletion Protocol at 30 days.",
    });
  } catch (err) {
    console.error("backfill-image-dims error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
