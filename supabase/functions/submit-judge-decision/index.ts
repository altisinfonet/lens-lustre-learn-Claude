/**
 * submit-judge-decision — Judging v3 · Phase 3 · Step 3.1 (Edge Function)
 *
 * Server-validated, catalog-driven write path for `judge_decisions`.
 *
 * Why this exists:
 *   v2 allowed any client to write any decision string permitted by the (newly
 *   widened) CHECK constraint. v3 collapses every legal judging outcome to one
 *   of 19 canonical rows in `public.v3_stage_catalog`. The caller now sends a
 *   `stage_key` (e.g. "r1_accept", "r2_qualified_r3", "r4_winner"). The edge
 *   function:
 *     1. Looks the stage up in v3_stage_catalog (must be is_active=true).
 *     2. Asserts catalog.round_number === payload.round_number (no cross-round
 *        bleed — e.g. you cannot send r4_winner with round_number=2).
 *     3. Resolves the canonical decision_token and writes it to judge_decisions.
 *     4. If a matching active system tag exists for catalog.tag_label_canonical,
 *        also upserts a judge_tag_assignments row. The DB mirror trigger
 *        (tr_mirror_system_tag_to_decision) covers tag→decision mirroring;
 *        decision→tag mirroring is handled here in the edge fn.
 *     5. Re-uses the existing _shared/judgingAuth helpers for JWT, round-lock,
 *        and judge-assignment checks (admin bypass already wired in there).
 *
 * Backward compat (per plan Step 3.1):
 *   The canonical decision_token IS one of the strings already in the widened
 *   CHECK constraint. Legacy callers that still write `'accept'` / `'reject'`
 *   directly to judge_decisions continue to work; this function does NOT
 *   require existing code to migrate immediately. Phase 4 of the plan migrates
 *   client callers to invoke this fn instead.
 *
 * NOT done in this turn (intentional — separate phase steps):
 *   - JudgePanel.tsx / SubmissionDetail.tsx still use direct supabase writes.
 *     Phase 4 (Step 4.x) migrates them to invoke this fn.
 *   - No DB-level guarantee yet that EVERY judge_decisions write goes through
 *     a canonical stage_key. That guard (a BEFORE INSERT trigger asserting the
 *     row matches a catalog row) is Phase 5 territory once all callers migrate.
 */
import {
  authenticateJudge,
  validateRoundNotLocked,
  validateJudgeAssignment,
  AuthError,
} from "../_shared/judgingAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function bad(message: string, status = 400, extra?: Record<string, unknown>) {
  return new Response(
    JSON.stringify({ error: message, ...(extra ?? {}) }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

interface CatalogRow {
  id: string;
  stage_key: string;
  round_number: number;
  family: string;
  decision_token: string;
  tag_label_canonical: string | null;
  is_active: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return bad("Method not allowed", 405);

  // ── 1. Auth ────────────────────────────────────────────────────────────
  let auth;
  try {
    auth = await authenticateJudge(req);
  } catch (e) {
    if (e instanceof AuthError) return bad(e.message, e.status);
    return bad("Unauthorized", 401);
  }
  const { admin, userId, isAdmin } = auth;

  // ── 2. Parse + validate payload shape ──────────────────────────────────
  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body");
  }

  const { entry_id, photo_index, round_number, stage_key } = body ?? {};

  if (!entry_id || typeof entry_id !== "string") return bad("entry_id required");
  if (!Number.isInteger(photo_index) || photo_index < 0)
    return bad("photo_index must be a non-negative integer");
  if (!Number.isInteger(round_number) || round_number < 1 || round_number > 4)
    return bad("round_number must be 1..4");
  if (!stage_key || typeof stage_key !== "string")
    return bad("stage_key required (canonical key from v3_stage_catalog)");

  // ── 3. Resolve canonical stage from v3_stage_catalog ───────────────────
  const { data: stageRow, error: stageErr } = await admin
    .from("v3_stage_catalog")
    .select("id, stage_key, round_number, family, decision_token, tag_label_canonical, is_active")
    .eq("stage_key", stage_key)
    .maybeSingle();

  if (stageErr) return bad("Catalog lookup failed", 500, { details: stageErr.message });
  if (!stageRow) return bad(`Unknown stage_key '${stage_key}'`, 422);
  const stage = stageRow as CatalogRow;
  if (!stage.is_active) return bad(`stage_key '${stage_key}' is inactive`, 422);
  if (stage.round_number !== round_number) {
    return bad(
      `stage_key '${stage_key}' belongs to round ${stage.round_number}, payload round_number=${round_number}`,
      422,
    );
  }

  // Guard: 'needs_review' is R1-only (DB trigger already enforces this; we
  // pre-reject for a cleaner 422 instead of a generic 500 from the trigger).
  if (stage.decision_token === "needs_review" && round_number !== 1) {
    return bad("'needs_review' is only valid in Round 1", 422);
  }
  // Guard: 'needs_verification' is R1-only (16-Key Frozen Contract v3 / Phase 1).
  // Verification Required is exclusively a Round 1 outcome under the contract;
  // Phase E verification workflow continues to operate independently for any round.
  if (stage.decision_token === "needs_verification" && round_number !== 1) {
    return bad("'needs_verification' is only valid in Round 1", 422);
  }

  // ── 4. Resolve entry, validate round + assignment ──────────────────────
  const { data: entry, error: entryErr } = await admin
    .from("competition_entries")
    .select("competition_id, photos")
    .eq("id", entry_id)
    .maybeSingle();
  if (entryErr || !entry) return bad("Entry not found", 404);

  const competition_id = entry.competition_id as string;
  const photoCount = Array.isArray(entry.photos) ? entry.photos.length : 0;
  if (photo_index >= photoCount) return bad("photo_index out of range");

  try {
    await validateRoundNotLocked(admin, competition_id, round_number, isAdmin);
    await validateJudgeAssignment(admin, userId, entry_id, competition_id, isAdmin);
  } catch (e) {
    if (e instanceof AuthError) return bad(e.message, e.status);
    return bad("Validation failed", 400);
  }

  // ── 5. Upsert judge_decisions with canonical decision_token ────────────
  const nowIso = new Date().toISOString();
  // Phase 2 (Option B): also persist canonical stage_key alongside decision token.
  const { error: decErr } = await admin
    .from("judge_decisions")
    .upsert(
      {
        entry_id,
        judge_id: userId,
        round_number,
        photo_index,
        decision: stage.decision_token,
        stage_key: stage.stage_key,
        updated_at: nowIso,
      },
      { onConflict: "entry_id,judge_id,round_number,photo_index" },
    );

  if (decErr) {
    return bad("judge_decisions write failed", 500, { details: decErr.message });
  }

  // ── 5b. Forward-only canonical write to competition_entries via the
  //        audited atomic RPC. Dual-write window (Phase 1 of edge-fn cutover):
  //        the RPC is the canonical, suppression-tagged path. SQLSTATE 23514
  //        is the documented rewind-refusal contract — expected and non-fatal
  //        (e.g. stale retry from a judge tab that already advanced). Every
  //        other failure is logged but does NOT roll back the judge_decisions
  //        write above (the suppression layer + db_audit_logs is the proof
  //        channel; the legacy PostgREST path remains the safety net).
  let atomicWrite: { ok: boolean; reason?: string } = { ok: true };
  try {
    const { error: rpcErr } = await admin.rpc("judging_write_decision_atomic", {
      p_entry_id: entry_id,
      p_stage_key: stage.stage_key,
      p_current_round: String(round_number),
    });
    if (rpcErr) {
      // Postgres SQLSTATE arrives in `code` for postgrest-js errors.
      const code = (rpcErr as any).code ?? "";
      if (code === "23514") {
        atomicWrite = { ok: false, reason: "rewind_refused" };
        console.log(
          `[submit-judge-decision] rewind_refused entry=${entry_id} stage=${stage.stage_key} (expected, non-fatal)`,
        );
      } else {
        atomicWrite = { ok: false, reason: `rpc_error:${code || "unknown"}` };
        console.error(
          `[submit-judge-decision] judging_write_decision_atomic failed entry=${entry_id} code=${code} msg=${rpcErr.message}`,
        );
      }
    }
  } catch (e: any) {
    atomicWrite = { ok: false, reason: `rpc_threw:${e?.message ?? "unknown"}` };
    console.error(`[submit-judge-decision] RPC threw entry=${entry_id}`, e);
  }

  // ── 6. Mirror to judge_tag_assignments if a matching active system tag
  //      exists. NOOP if no tag exists (e.g. R4 award labels not seeded yet,
  //      or stages where tag UI is intentionally suppressed).
  let tagWritten: { tag_id: string; label: string } | null = null;
  if (stage.tag_label_canonical) {
    const { data: tagRow } = await admin
      .from("judging_tags")
      .select("id, label")
      .eq("label", stage.tag_label_canonical)
      .eq("is_system", true)
      .eq("is_active", true)
      .maybeSingle();

    if (tagRow) {
      const { error: tagErr } = await admin
        .from("judge_tag_assignments")
        .upsert(
          {
            entry_id,
            judge_id: userId,
            round_number,
            photo_index,
            tag_id: tagRow.id,
            updated_at: nowIso,
          },
          { onConflict: "entry_id,judge_id,round_number,photo_index,tag_id" },
        );
      if (tagErr) {
        // Non-fatal: decision already written. Surface to caller for visibility.
        // We do NOT roll back the decision because the mirror trigger will
        // reconcile on the next tag write, and the canonical decision is the
        // source of truth.
        return new Response(
          JSON.stringify({
            ok: true,
            entry_id,
            photo_index,
            round_number,
            stage_key,
            decision_token: stage.decision_token,
            tag_mirror_warning: tagErr.message,
            atomic_write: atomicWrite,
            written_at: nowIso,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      tagWritten = { tag_id: tagRow.id, label: tagRow.label };
    }
  }

  // ── 7. Activity log (best-effort, never blocks success) ─────────────────
  await admin.from("judge_activity_logs").insert({
    judge_id: userId,
    competition_id,
    entry_id,
    round_number,
    action_type: "decision_submitted",
    details: {
      photo_index,
      stage_key,
      decision_token: stage.decision_token,
      tag_label: stage.tag_label_canonical,
      tag_written: tagWritten,
      atomic_write: atomicWrite,
      source: "edge:submit-judge-decision",
    },
  });

  return new Response(
    JSON.stringify({
      ok: true,
      entry_id,
      photo_index,
      round_number,
      stage_key,
      decision_token: stage.decision_token,
      tag_written: tagWritten,
      atomic_write: atomicWrite,
      written_at: nowIso,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
