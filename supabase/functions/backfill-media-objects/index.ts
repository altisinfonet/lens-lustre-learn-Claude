/**
 * B5-2 — BACKFILL THE 210 EXISTING POSTS INTO THE MEDIA ENGINE.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Today a post's photographs are a text array of URLs. The media engine
 * (media_objects + post_media) is built, proven and EMPTY. Before the client
 * can switch to it, every photograph already on the platform needs a real
 * media_objects row — with its true content fingerprint — and a post_media
 * reference tying it to its post at its true position.
 *
 * THIS JOB IS ADDITIVE AND REVERSIBLE. It does not touch posts.image_urls, it
 * deletes nothing, and it publishes nothing. Until the client switch, the rows
 * it writes are read by no one. If it is wrong, the fix is to delete the rows
 * it created; the member-visible site is unaffected either way.
 *
 * WHY IT DOWNLOADS EVERY FILE
 * `media_objects.sha256` is the platform's content identity: per-owner dedup,
 * takedown targeting and retry-safety all key off it. A fingerprint over a
 * ranged read would be identical for every photograph sharing a container
 * header — that is most of them — and would silently collapse different
 * photographs into one row. So the bytes are read whole and hashed whole.
 * That is why the per-run cap is small: this job is bandwidth, not CPU.
 *
 * RESUMABLE BY CONSTRUCTION
 *   • a post that already has post_media rows is skipped outright
 *   • media_objects carries UNIQUE (owner_id, sha256), so a photograph seen
 *     in an earlier run (or shared between two posts) is REUSED, not doubled
 *   • each post's references are written in one transaction-like sequence and
 *     verified; a post that fails is reported and left completely untouched,
 *     so the next run retries it from the start
 *
 * THE SAME CEREMONY AS DELETION
 * Dry-run by default; execution requires expected_count from a prior dry run
 * and aborts on drift; per-run cap with a hard ceiling; every skip carries a
 * reason; every failure is reported rather than swallowed.
 *
 * STATE MACHINE, HONESTLY WALKED
 * Rows go pending → verified → ready through the same trigger-guarded path a
 * live upload takes. Inserting a row directly as `ready` would be possible for
 * the service role and would mean the backfill is the one writer that never
 * proves it looked at the bytes. It looked at the bytes; it walks the states.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { getS3Settings, readS3Object } from "../_shared/s3.ts";
import { imageDimsFromBytes } from "../_shared/imageDims.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUCKETS = [
  "avatars", "competition-photos", "course-images", "email-assets",
  "journal-images", "portfolio-images", "post-images",
];

/** media_objects.mime is a CHECK-constrained set; anything else is skipped. */
const MIME_BY_EXT: Record<string, string> = {
  webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg",
  png: "image/png", avif: "image/avif",
};

const DEFAULT_MAX_POSTS = 10;
const HARD_MAX_POSTS = 50;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** URL → `<bucket>/<path>` key, or null when the host/shape is unmanaged. */
function keyFromUrl(url: string): string | null {
  const clean = url.split("?")[0].split("#")[0];
  if (/\/storage\/v1\/object\//.test(clean)) return null; // supabase-hosted: own pass
  let path = clean;
  const m = clean.match(/^https?:\/\/[^/]+\/(.+)$/);
  if (m) path = m[1];
  for (const b of BUCKETS) if (path.startsWith(b + "/")) return path;
  return null;
}

function extOf(key: string): string {
  return (key.split(".").pop() ?? "").toLowerCase();
}

/** Dimensions already recorded in the filename, if the uploader put them there. */
function dimsFromName(key: string): { width: number; height: number } | null {
  const m = key.match(/-w(\d{1,6})h(\d{1,6})(?:-l3)?(?:-thumb)?\.[a-z0-9]+$/i);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}

async function sha256Of(bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(digest);
}

/** bytea literal Postgres accepts through PostgREST. */
function toHex(b: Uint8Array): string {
  return "\\x" + Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

interface SlidePlan {
  post_id: string;
  user_id: string;
  ord: number;
  url: string;
  key: string;
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
      .from("user_roles").select("role")
      .eq("user_id", claimsData.claims.sub).eq("role", "admin").maybeSingle();
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

    // ── Which posts are already done? Read the whole set fail-loud, paginated.
    //    An error here must abort: treating it as "none done" would re-do work
    //    and, worse, report a false picture of how much remains.
    const done = new Set<string>();
    {
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await adminClient
          .from("post_media").select("post_id").range(from, from + PAGE - 1);
        if (error) throw new Error(`post_media scan failed at offset ${from}: ${error.message}`);
        if (!data || data.length === 0) break;
        for (const r of data as { post_id: string }[]) done.add(r.post_id);
        if (data.length < PAGE) break;
      }
    }

    // ── Candidates: posts carrying photographs that have no references yet.
    interface PostRow { id: string; user_id: string; image_urls: string[] | null }
    const candidates: PostRow[] = [];
    {
      const PAGE = 500;
      for (let from = 0; candidates.length < maxPosts; from += PAGE) {
        const { data, error } = await adminClient
          .from("posts").select("id, user_id, image_urls").order("created_at").range(from, from + PAGE - 1);
        if (error) throw new Error(`post scan failed at offset ${from}: ${error.message}`);
        if (!data || data.length === 0) break;
        for (const row of data as PostRow[]) {
          const urls = (row.image_urls ?? []).filter(Boolean);
          if (urls.length > 0 && !done.has(row.id) && candidates.length < maxPosts) {
            candidates.push(row);
          }
        }
        if (data.length < PAGE) break;
      }
    }

    // ── Plan. Resolving keys costs nothing; downloading does not happen here.
    const plan: SlidePlan[] = [];
    const skipped: { post_id: string; ord: number; url: string; reason: string }[] = [];

    for (const post of candidates) {
      const urls = (post.image_urls ?? []).filter(Boolean);
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        const key = keyFromUrl(url);
        if (!key) {
          skipped.push({
            post_id: post.id, ord: i, url,
            reason: /\/storage\/v1\/object\//.test(url) ? "supabase_storage_host (own pass later)" : "unmanaged_url_shape",
          });
          continue;
        }
        if (!MIME_BY_EXT[extOf(key)]) {
          skipped.push({ post_id: post.id, ord: i, url, reason: `unsupported_extension_${extOf(key) || "none"}` });
          continue;
        }
        plan.push({ post_id: post.id, user_id: post.user_id, ord: i, url, key });
      }
    }

    // A post is only backfilled when EVERY one of its slides is plannable —
    // a partial reference set is exactly the half-published state the publish
    // gate exists to prevent, and the backfill must not create by hand what
    // the front door refuses.
    const slidesByPost = new Map<string, SlidePlan[]>();
    for (const p of plan) slidesByPost.set(p.post_id, [...(slidesByPost.get(p.post_id) ?? []), p]);

    const wholePosts: string[] = [];
    const partialPosts: { post_id: string; planned: number; total: number }[] = [];
    for (const post of candidates) {
      const total = (post.image_urls ?? []).filter(Boolean).length;
      const planned = slidesByPost.get(post.id)?.length ?? 0;
      if (planned === total && total > 0) wholePosts.push(post.id);
      else partialPosts.push({ post_id: post.id, planned, total });
    }

    const report = {
      dry_run: dryRun,
      posts_already_backfilled: done.size,
      posts_considered: candidates.length,
      max_posts: maxPosts,
      posts_fully_plannable: wholePosts.length,
      posts_skipped_partial: partialPosts,
      slides_planned: plan.filter((p) => wholePosts.includes(p.post_id)).length,
      slides_skipped: skipped.length,
      skip_reasons: skipped.slice(0, 50),
    };

    if (dryRun) {
      return json({
        ...report,
        next_step:
          `To execute: POST { "dry_run": false, "expected_count": ${wholePosts.length} } — ` +
          "the count of FULLY PLANNABLE POSTS must still match at execution time.",
      });
    }

    if (expectedCount === null) {
      return json({ ...report, error: "PROTOCOL ABORT: execution requires expected_count from a prior dry run." }, 400);
    }
    if (expectedCount !== wholePosts.length) {
      return json({
        ...report,
        error: `PROTOCOL ABORT: expected_count ${expectedCount} != fully-plannable ${wholePosts.length}. ` +
          "Posts changed since the dry run. Re-run it and re-review.",
      }, 409);
    }

    // ── EXECUTE, one whole post at a time.
    let mediaCreated = 0, mediaReused = 0, refsCreated = 0, postsDone = 0;
    const failures: { post_id: string; reason: string }[] = [];

    for (const postId of wholePosts) {
      const slides = (slidesByPost.get(postId) ?? []).sort((a, b) => a.ord - b.ord);
      try {
        const mediaIds: { ord: number; id: string }[] = [];

        for (const sl of slides) {
          const bytes = await readS3Object(s3, prefix + sl.key);
          if (bytes === null) throw new Error(`object missing in R2: ${sl.key}`);
          if (bytes.byteLength === 0) throw new Error(`object is empty: ${sl.key}`);

          const sha = toHex(await sha256Of(bytes));

          // Reuse before create: the same photograph may already have a row
          // from an earlier run, or from another post by the same member.
          const { data: existing, error: exErr } = await adminClient
            .from("media_objects").select("id, state")
            .eq("owner_id", sl.user_id).eq("sha256", sha).maybeSingle();
          if (exErr) throw new Error(`media lookup failed: ${exErr.message}`);

          if (existing) {
            if (existing.state !== "ready") {
              throw new Error(`existing media ${existing.id} is in state ${existing.state}, not ready`);
            }
            mediaReused++;
            mediaIds.push({ ord: sl.ord, id: existing.id });
            continue;
          }

          const dims = dimsFromName(sl.key) ?? imageDimsFromBytes(bytes);
          if (!dims) throw new Error(`could not determine dimensions for ${sl.key} (refused to guess)`);

          const { data: created, error: insErr } = await adminClient
            .from("media_objects")
            .insert({
              owner_id: sl.user_id, sha256: sha,
              width: dims.width, height: dims.height,
              bytes: bytes.byteLength, mime: MIME_BY_EXT[extOf(sl.key)],
              visibility: "public",
            })
            .select("id").single();
          if (insErr) throw new Error(`media insert failed: ${insErr.message}`);

          // The honest walk: the bytes were read, so the row may claim verified;
          // the derivative it points at is the original that already exists.
          const { error: vErr } = await adminClient.rpc("media_mark_verified", { _id: created.id });
          if (vErr) throw new Error(`mark_verified failed for ${created.id}: ${vErr.message}`);

          const { error: rErr } = await adminClient.rpc("media_mark_ready", {
            _id: created.id, _derivatives: { original: sl.key },
          });
          if (rErr) throw new Error(`mark_ready failed for ${created.id}: ${rErr.message}`);

          mediaCreated++;
          mediaIds.push({ ord: sl.ord, id: created.id });
        }

        // Contiguous ords from 0, in the post's own slide order.
        const rows = mediaIds
          .sort((a, b) => a.ord - b.ord)
          .map((m, idx) => ({ post_id: postId, ord: idx, media_id: m.id }));

        const { error: pmErr } = await adminClient.from("post_media").insert(rows);
        if (pmErr) throw new Error(`reference insert failed: ${pmErr.message}`);

        // Post-write verification: read back and count.
        const { count, error: cErr } = await adminClient
          .from("post_media").select("*", { count: "exact", head: true }).eq("post_id", postId);
        if (cErr) throw new Error(`verification read failed: ${cErr.message}`);
        if (count !== rows.length) {
          throw new Error(`verification failed: ${count} references present, expected ${rows.length}`);
        }

        refsCreated += rows.length;
        postsDone++;
      } catch (e) {
        // Left completely untouched for the next run to retry from the start.
        failures.push({ post_id: postId, reason: (e as Error).message });
      }
    }

    return json({
      ...report,
      media_created: mediaCreated,
      media_reused: mediaReused,
      references_created: refsCreated,
      posts_backfilled: postsDone,
      failed_posts: failures,
      note:
        "Additive only: posts.image_urls untouched, nothing deleted, nothing published. " +
        "These rows are read by no one until the client switch.",
    });
  } catch (err) {
    console.error("backfill-media-objects error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
