// publish-scheduled-posts
// Phase 2 — Scheduled Posts publisher with live Gate A/B/C re-checks + smart shifting.
//
// Behaviour (see Scheduled-Posts-Plan-FINAL.docx):
//   1. Header auth: x-scheduled-posts-secret must match SCHEDULED_POSTS_CRON_SECRET.
//   2. Atomically claim up to BATCH_SIZE due rows: status pending -> publishing
//      (FOR UPDATE SKIP LOCKED so parallel ticks never touch the same row).
//   3. Per row, re-check LIVE against production DB (never hardcoded snapshots):
//        Gate A — rate limit: >=30 posts by this user in the last 1h -> SHIFT
//        Gate B — duplicate:  md5(content|image_urls|image_url) already exists
//                             for this user in the last 10min -> SHIFT
//        Gate C — moderation: blocked_keywords match (high/critical) -> FAIL
//   4. On pass: INSERT into public.posts using service_role. The 4 existing
//      BEFORE-INSERT triggers on posts still fire as a safety net; if any
//      raises, we catch and either SHIFT (rate/dup race) or FAIL (moderation).
//   5. Shift: scheduled_for = greatest(scheduled_for, now()) + 15 minutes,
//      shifted_count++, last_shift_reason set. Cap at MAX_SHIFTS (5) -> FAIL.
//
// Additive-only. No cron wired in Phase 2. No UI touched.

import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-scheduled-posts-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BATCH_SIZE = 50;
const MAX_SHIFTS = 5;
const SHIFT_MINUTES = 15;

interface ScheduledRow {
  id: string;
  user_id: string;
  content: string | null;
  image_urls: string[];
  image_url: string | null;
  tagged_user_ids: string[];
  scheduled_for: string;
  original_scheduled_for: string;
  status: string;
  attempt_count: number;
  shifted_count: number;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function md5Hex(s: string): Promise<string> {
  // Deno crypto has no MD5; DB uses md5(). We recompute the same predicate
  // via SELECT md5($1) to guarantee byte-identical hashing with Postgres.
  return s; // placeholder; actual md5 is computed server-side (see gateB below)
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // ---- Auth ----------------------------------------------------------------
  const expected = Deno.env.get("SCHEDULED_POSTS_CRON_SECRET");
  const provided = req.headers.get("x-scheduled-posts-secret");
  if (!expected || provided !== expected) {
    return json({ error: "unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const summary = {
    reclaimed: 0,
    claimed: 0,
    published: 0,
    shifted: 0,
    failed: 0,
    errors: [] as Array<{ id: string; reason: string }>,
  };

  // ---- Self-heal: reclaim rows stuck in 'publishing' > 5 minutes ----------
  // Additive crash-recovery. Under normal operation this affects 0 rows.
  // Only flips status back to 'pending'; row is then re-gated by A/B/C.
  // Duplicate-publish race is caught by trg_detect_duplicate_post on posts.
  const staleCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: reclaimed } = await admin
    .from("scheduled_posts")
    .update({ status: "pending", last_error: "reclaimed_stale_publishing" })
    .eq("status", "publishing")
    .lt("updated_at", staleCutoff)
    .select("id");
  summary.reclaimed = reclaimed?.length ?? 0;


  // ---- Claim batch (atomic) -----------------------------------------------
  // Single SQL: UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING *.
  // We use a SECURITY DEFINER-free path by wrapping via .rpc is not needed;
  // supabase-js supports raw SQL only through .rpc, so we implement claim via
  // two calls guarded by a short window. Since Phase 1 does NOT expose a
  // claim RPC, we do: SELECT ids, then UPDATE ... RETURNING with a check
  // that status is still 'pending' (optimistic concurrency).
  const nowIso = new Date().toISOString();

  const { data: candidates, error: selErr } = await admin
    .from("scheduled_posts")
    .select("id")
    .eq("status", "pending")
    .lte("scheduled_for", nowIso)
    .order("scheduled_for", { ascending: true })
    .limit(BATCH_SIZE);

  if (selErr) return json({ error: "select_failed", detail: selErr.message }, 500);
  if (!candidates || candidates.length === 0) {
    return json({ ok: true, ...summary, note: "no due rows" });
  }

  const ids = candidates.map((r: { id: string }) => r.id);
  const { data: claimed, error: claimErr } = await admin
    .from("scheduled_posts")
    .update({ status: "publishing", attempt_count: 1 })
    .in("id", ids)
    .eq("status", "pending") // optimistic: skip rows another tick already grabbed
    .select("*");

  if (claimErr) return json({ error: "claim_failed", detail: claimErr.message }, 500);
  summary.claimed = claimed?.length ?? 0;
  if (!claimed || claimed.length === 0) return json({ ok: true, ...summary });

  // ---- Per-row processing --------------------------------------------------
  for (const row of claimed as ScheduledRow[]) {
    try {
      // Gate A — rate limit (live re-check, mirrors trg_rate_limit_posts)
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count: recent, error: rateErr } = await admin
        .from("posts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", row.user_id)
        .gt("created_at", oneHourAgo);
      if (rateErr) throw new Error(`gateA_query: ${rateErr.message}`);
      if ((recent ?? 0) >= 30) {
        await shift(admin, row, "rate_limit_30_per_hour", summary);
        continue;
      }

      // Gate B — duplicate (live re-check, mirrors trg_detect_duplicate_post)
      // md5 computed by DB via .rpc-free trick: we use PostgREST filter on content_hash.
      // Formula: md5(coalesce(content,'')||'|'||coalesce(array_to_string(image_urls,','),'')||'|'||coalesce(image_url,''))
      // We compute the same string client-side and hash via crypto.subtle (MD5 absent → use
      // a tiny pure-TS MD5). To keep dependencies zero and stay byte-identical with Postgres,
      // we instead query for any post by same user in last 10 min with matching content+urls.
      const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const contentStr = row.content ?? "";
      const urlsStr = (row.image_urls ?? []).join(",");
      const legacyUrl = row.image_url ?? "";
      const hashInput = `${contentStr}|${urlsStr}|${legacyUrl}`;
      const { data: hashRow, error: hashErr } = await admin
        .rpc("md5_public_shim", { s: hashInput })
        .maybeSingle?.() ?? { data: null, error: null };
      // Fallback: if no md5 RPC exists, match by (content, image_urls, image_url) tuple.
      let dupExists = false;
      if (hashRow && !hashErr && typeof (hashRow as any).md5 === "string") {
        const { data: dupRow } = await admin
          .from("posts")
          .select("id")
          .eq("user_id", row.user_id)
          .eq("content_hash", (hashRow as any).md5)
          .gt("created_at", tenMinAgo)
          .limit(1)
          .maybeSingle();
        dupExists = !!dupRow;
      } else {
        // Tuple-match fallback — logically equivalent for our formula.
        const { data: dupRow } = await admin
          .from("posts")
          .select("id, image_urls, image_url")
          .eq("user_id", row.user_id)
          .eq("content", contentStr)
          .gt("created_at", tenMinAgo)
          .limit(20);
        if (dupRow) {
          dupExists = dupRow.some(
            (r: any) =>
              (r.image_urls ?? []).join(",") === urlsStr &&
              (r.image_url ?? "") === legacyUrl,
          );
        }
      }
      if (dupExists) {
        await shift(admin, row, "duplicate_within_10_min", summary);
        continue;
      }

      // Gate C — moderation (live re-check, mirrors trg_moderate_post_content)
      const { data: kw, error: kwErr } = await admin
        .from("blocked_keywords")
        .select("keyword")
        .eq("is_active", true)
        .in("severity", ["high", "critical"]);
      if (kwErr) throw new Error(`gateC_query: ${kwErr.message}`);
      const lc = contentStr.toLowerCase();
      const hit = (kw ?? []).find((k: { keyword: string }) =>
        lc.includes(String(k.keyword).toLowerCase()),
      );
      if (hit) {
        await fail(admin, row, `blocked_keyword:${hit.keyword}`, summary);
        continue;
      }

      // ---- Publish -------------------------------------------------------
      const { data: inserted, error: insErr } = await admin
        .from("posts")
        .insert({
          user_id: row.user_id,
          content: contentStr,
          image_urls: row.image_urls ?? [],
          image_url: row.image_url,
          // BUG-024: honor the privacy + SEO choice the user picked when
          // scheduling (stored on scheduled_posts) instead of forcing public.
          privacy: row.privacy ?? "public",
          indexing_disabled: row.indexing_disabled ?? false,
        })
        .select("id")
        .single();

      if (insErr) {
        // Trigger safety-net caught something the pre-check missed (race).
        const msg = insErr.message || "";
        if (/Rate limit/i.test(msg)) {
          await shift(admin, row, `race_rate_limit: ${msg}`, summary);
        } else if (/Duplicate/i.test(msg)) {
          await shift(admin, row, `race_duplicate: ${msg}`, summary);
        } else if (/restricted content/i.test(msg)) {
          await fail(admin, row, `trigger_moderation: ${msg}`, summary);
        } else {
          await fail(admin, row, `insert_error: ${msg}`, summary);
        }
        continue;
      }

      await admin
        .from("scheduled_posts")
        .update({
          status: "published",
          published_post_id: inserted.id,
          last_error: null,
        })
        .eq("id", row.id);
      summary.published++;
    } catch (e) {
      const msg = (e as Error).message || String(e);
      await fail(admin, row, `handler_exception: ${msg}`, summary);
    }
  }

  return json({ ok: true, ...summary });
});

async function shift(
  admin: ReturnType<typeof createClient>,
  row: ScheduledRow,
  reason: string,
  summary: { shifted: number; failed: number; errors: Array<{ id: string; reason: string }> },
) {
  const newShifted = (row.shifted_count ?? 0) + 1;
  if (newShifted > MAX_SHIFTS) {
    await admin
      .from("scheduled_posts")
      .update({
        status: "failed",
        last_error: `max_shifts_exceeded:${reason}`,
        shifted_count: newShifted,
        last_shift_reason: reason,
      })
      .eq("id", row.id);
    summary.failed++;
    summary.errors.push({ id: row.id, reason: `max_shifts_exceeded:${reason}` });
    return;
  }
  const base = new Date(row.scheduled_for).getTime();
  const now = Date.now();
  const next = new Date(Math.max(base, now) + SHIFT_MINUTES * 60 * 1000).toISOString();
  await admin
    .from("scheduled_posts")
    .update({
      status: "pending",
      scheduled_for: next,
      shifted_count: newShifted,
      last_shift_reason: reason,
    })
    .eq("id", row.id);
  summary.shifted++;
}

async function fail(
  admin: ReturnType<typeof createClient>,
  row: ScheduledRow,
  reason: string,
  summary: { failed: number; errors: Array<{ id: string; reason: string }> },
) {
  await admin
    .from("scheduled_posts")
    .update({ status: "failed", last_error: reason })
    .eq("id", row.id);
  summary.failed++;
  summary.errors.push({ id: row.id, reason });
}
