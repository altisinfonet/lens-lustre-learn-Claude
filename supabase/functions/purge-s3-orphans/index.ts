/**
 * Admin sweep: deletes R2/S3 objects under `competition-photos/` whose
 * top-level UUID folder (competition_id or entry_id) no longer exists in the
 * database.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS FUNCTION RUNS UNDER THE DELETION PROTOCOL (AI_CONTROL.md, 2026-08-14).
 *
 *   dry-run → expected count → sample review → maximum-deletion threshold
 *          → execute → post-delete verification
 *
 * The 2026-08-14 hardening fixed three protocol violations that were live in
 * this file — the DELETING file — and each one is the same defect class that
 * nearly caused the 263-file loss in detect-orphan-files:
 *
 * 1. ERROR MEANT EMPTY. `const { data: comps } = await ...select("id")`
 *    ignored the error. A transient failure reading `competitions` yielded an
 *    EMPTY live-id set, which classifies EVERY uuid folder in the store as an
 *    orphan. On a non-dry run that is the whole competition archive, gone.
 *
 * 2. THE LIVE-ID READ WAS SILENTLY TRUNCATED. PostgREST caps un-ranged
 *    selects (default 1000 rows). Past 1000 entries, every additional entry's
 *    folder would be "not live" — deleted. The platform has not crossed 1000
 *    yet, which is the only reason this was survivable. Same bug class as
 *    BUG-071. Now paginated AND fail-loud.
 *
 * 3. NO CAP, NO EXPECTATION, NO VERIFICATION. One bad run could delete an
 *    unbounded number of objects, the caller never had to state what they
 *    expected, and nothing checked the store afterwards.
 *
 * EXECUTE CONTRACT (dry_run=false) now requires BOTH:
 *   - expected_count: the orphan count from a PRIOR dry run. If the store or
 *     DB changed in between and the count differs, the run aborts — the
 *     operator is looking at stale information.
 *   - orphan count <= max_delete (default 200, hard ceiling 1000). Bigger
 *     cleanups happen in deliberate, repeated, verified passes.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { deleteS3Objects, getS3Settings, listAllS3Objects } from "../_shared/s3.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Deletion Protocol: threshold. A run finding more than this aborts rather
 * than deleting, no matter what the caller asked for. HARD_MAX_DELETE exists
 * so a typo in the request body cannot raise the cap arbitrarily.
 */
const DEFAULT_MAX_DELETE = 200;
const HARD_MAX_DELETE = 1000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) return json({ error: "Unauthorized" }, 401);

    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data: adminRole } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!adminRole) return json({ error: "Admin only" }, 403);

    // ── Request. dry_run defaults TRUE; execution is the explicit path.
    let dryRun = true;
    let expectedCount: number | null = null;
    let maxDelete = DEFAULT_MAX_DELETE;
    try {
      const body = await req.json();
      if (typeof body?.dry_run === "boolean") dryRun = body.dry_run;
      if (Number.isInteger(body?.expected_count)) expectedCount = body.expected_count;
      if (Number.isInteger(body?.max_delete) && body.max_delete > 0) {
        maxDelete = Math.min(body.max_delete, HARD_MAX_DELETE);
      }
    } catch (_) {
      // empty body — keep defaults (dry run)
    }

    const s3 = await getS3Settings(adminClient);
    if (!s3) return json({ error: "S3 storage not configured/enabled" }, 400);

    // ── Live-id set. Paginated AND fail-loud: an error or a truncated read
    //    here is what turns a cleanup into a massacre (violations 1 and 2).
    const liveIds = new Set<string>();
    const collectIds = async (table: string) => {
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await adminClient
          .from(table)
          .select("id")
          .range(from, from + PAGE - 1);
        if (error) {
          throw new Error(
            `live-id read failed on ${table} at offset ${from}: ${error.message} — ` +
              `aborting: an incomplete live-id set classifies live folders as orphans`,
          );
        }
        if (!data || data.length === 0) break;
        for (const r of data as { id: string }[]) liveIds.add(r.id);
        if (data.length < PAGE) break;
      }
    };
    await collectIds("competitions");
    await collectIds("competition_entries");

    // Refuse to run against an implausibly empty database. Production has
    // competitions and entries; an empty set here means we are looking at the
    // wrong project or a broken read that somehow did not throw. Either way,
    // deleting on that basis is the 263-file near-miss with a worse ending.
    if (liveIds.size === 0) {
      return json({
        error: "SAFETY ABORT: live-id set is empty. Refusing to classify anything as an orphan.",
      }, 500);
    }

    // ── Enumerate the store (throws on partial listing).
    const basePrefix = (s3.path_prefix ? `${s3.path_prefix.replace(/\/+$/, "")}/` : "") + "competition-photos/";
    const allObjects = await listAllS3Objects(s3, basePrefix);

    const orphanKeys: string[] = [];
    for (const obj of allObjects) {
      const rest = obj.key.startsWith(basePrefix) ? obj.key.slice(basePrefix.length) : obj.key;
      const segs = rest.split("/").filter(Boolean);
      if (segs.length === 0) continue;
      const idFolder = segs[0];
      // UUIDs only — anything else (e.g. "covers/") is left alone for safety.
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idFolder)) continue;
      if (!liveIds.has(idFolder)) orphanKeys.push(obj.key);
    }

    const report = {
      dry_run: dryRun,
      total_listed: allObjects.length,
      live_ids: liveIds.size,
      orphan_keys_found: orphanKeys.length,
      max_delete: maxDelete,
      sample_orphans: orphanKeys.slice(0, 10),
    };

    if (dryRun) {
      return json({
        ...report,
        deleted: 0,
        next_step:
          `To execute: POST { "dry_run": false, "expected_count": ${orphanKeys.length} }` +
          ` — the count must still match at execution time.`,
      });
    }

    // ── EXECUTE. Deletion Protocol gates, in order.
    if (expectedCount === null) {
      return json({
        ...report,
        error: "PROTOCOL ABORT: execution requires expected_count from a prior dry run. " +
          "Run dry_run:true first and pass its orphan_keys_found back.",
      }, 400);
    }
    if (expectedCount !== orphanKeys.length) {
      return json({
        ...report,
        error: `PROTOCOL ABORT: expected_count ${expectedCount} != found ${orphanKeys.length}. ` +
          "The store or database changed since the dry run. Re-run the dry run and re-review.",
      }, 409);
    }
    if (orphanKeys.length > maxDelete) {
      return json({
        ...report,
        error: `PROTOCOL ABORT: ${orphanKeys.length} orphans exceeds max_delete ${maxDelete}. ` +
          `Review the sample, then run again with an explicit higher max_delete (hard ceiling ${HARD_MAX_DELETE}) ` +
          "or clean up in deliberate passes.",
      }, 400);
    }

    const deleted = await deleteS3Objects(s3, orphanKeys);

    // ── Post-delete verification: re-list and confirm the orphans are gone.
    //    A residue count is reported, never assumed to be zero.
    const afterObjects = await listAllS3Objects(s3, basePrefix);
    const afterKeys = new Set(afterObjects.map((o) => o.key));
    const residue = orphanKeys.filter((k) => afterKeys.has(k));

    return json({
      ...report,
      deleted,
      post_delete_verification: {
        remaining_after: afterObjects.length,
        residue_count: residue.length,
        residue_sample: residue.slice(0, 10),
        verified_clean: residue.length === 0,
      },
    });
  } catch (err) {
    console.error("purge-s3-orphans error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
