/**
 * submit-judge-score — Phase 0.5 Edge Function
 *
 * Server-validated write path for judge_scores.
 * Accepts FULL payload (per Phase 0.5 decision): score, feedback, and the
 * full set of 13 score columns (10 SOW criteria + 3 legacy). Phase 5 will
 * narrow this to the 10 SOW criteria.
 *
 * Enforces:
 *   1. JWT valid (judge/admin)
 *   2. Round not completed (admin bypass)
 *   3. Judge assigned to competition + entry (distributed mode)
 *   4. score is a whole number in 0..10 (when provided)
 *   5. Each criterion column is a whole number in 0..10 (when provided)
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

// Phase 5: SOW-conformant — ONLY the 10 SOW criteria are accepted.
// Legacy columns (composition_score, technique_score) remain in DB for audit trail
// but are REJECTED in the payload with 400.
const SOW_SCORE_COLUMNS = [
  "line_score",
  "shape_score",
  "form_score",
  "texture_score",
  "color_palette_score", // SOW criterion COLOR maps to color_palette_score column
  "space_score",
  "tone_score",
  "balance_score",
  "light_score",
  "depth_score",
] as const;

const LEGACY_REJECTED_COLUMNS = ["composition_score", "technique_score"] as const;

function bad(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isWholeScoreInRange(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 10;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return bad("Method not allowed", 405);

  let auth;
  try {
    auth = await authenticateJudge(req);
  } catch (e) {
    if (e instanceof AuthError) return bad(e.message, e.status);
    return bad("Unauthorized", 401);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body");
  }

  const {
    entry_id,
    photo_index,
    round_number,
    score,
    feedback,
    criteria,
  } = body ?? {};

  if (!entry_id || typeof entry_id !== "string") return bad("entry_id required");
  if (!Number.isInteger(photo_index) || photo_index < 0)
    return bad("photo_index must be a non-negative integer");
  if (!Number.isInteger(round_number) || round_number < 1 || round_number > 4)
    return bad("round_number must be 1..4");

  if (score !== undefined && score !== null && !isWholeScoreInRange(score))
    return bad("score must be a whole number 0..10");

  if (feedback !== undefined && feedback !== null && typeof feedback !== "string")
    return bad("feedback must be string or null");
  if (typeof feedback === "string" && feedback.length > 5000)
    return bad("feedback exceeds 5000 chars");

  // Validate criteria payload — Phase 5: reject any legacy keys, accept only the 10 SOW keys
  const writeCriteria: Record<string, number | null> = {};
  if (criteria && typeof criteria === "object") {
    for (const legacyCol of LEGACY_REJECTED_COLUMNS) {
      if (legacyCol in criteria) {
        return bad(`${legacyCol} is a legacy criterion and not accepted in R2+. Use the 10 SOW keys only.`, 400);
      }
    }
    for (const key of Object.keys(criteria)) {
      if (!(SOW_SCORE_COLUMNS as readonly string[]).includes(key)) {
        return bad(`Unknown criterion '${key}'. Allowed: ${SOW_SCORE_COLUMNS.join(", ")}`, 400);
      }
    }
    for (const col of SOW_SCORE_COLUMNS) {
      if (col in criteria) {
        const v = (criteria as any)[col];
        if (v === null) {
          writeCriteria[col] = null;
        } else if (isWholeScoreInRange(v)) {
          writeCriteria[col] = v;
        } else {
          return bad(`${col} must be a whole number 0..10 or null`);
        }
      }
    }
  }

  const { admin, userId, isAdmin } = auth;

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

  // ── Spec v3 / Blockers B3+B4 (2026-04-25): Mandatory 10 criteria + auto-tier ──
  // For R2/R3/R4, when the caller is FINALIZING the photo's score (i.e. sending
  // a non-null `score`), every one of the 10 SOW criteria must be present in
  // the merged row (incoming payload + already-stored). Partial saves WITHOUT
  // a final `score` are still allowed so judges can fill criteria one slider
  // at a time. Auto-tier: if no `score` is sent but all 10 criteria are
  // present after the merge, the server computes `score` as the criteria mean.
  let finalScore: number | null = (score === undefined || score === null) ? null : score;

  if (round_number >= 2) {
    // Load any existing row so we can check the merged-final state
    const { data: existing } = await admin
      .from("judge_scores")
      .select("line_score,shape_score,form_score,texture_score,color_palette_score,space_score,tone_score,balance_score,light_score,depth_score,score")
      .eq("entry_id", entry_id)
      .eq("judge_id", userId)
      .eq("round_number", round_number)
      .eq("photo_index", photo_index)
      .maybeSingle();

    const merged: Record<string, number | null> = {};
    for (const col of SOW_SCORE_COLUMNS) {
      if (col in writeCriteria) merged[col] = writeCriteria[col];
      else merged[col] = ((existing ?? {}) as any)[col] ?? null;
    }

    const allTen = SOW_SCORE_COLUMNS.every((c) => typeof merged[c] === "number");
    const anyTen = SOW_SCORE_COLUMNS.some((c) => typeof merged[c] === "number");

    // Hard block: caller is sending a final `score` but the 10 criteria are not all set.
    if (finalScore !== null && !allTen) {
      const missing = SOW_SCORE_COLUMNS.filter((c) => typeof merged[c] !== "number");
      return bad(
        `Round ${round_number} requires ALL 10 criteria before saving a final score. Missing: ${missing.join(", ")}.`,
        422,
      );
    }

    // Auto-tier: caller didn't send `score` but all 10 are now present → derive whole-number mark.
    if (finalScore === null && allTen) {
      const sum = SOW_SCORE_COLUMNS.reduce((acc, c) => acc + (merged[c] as number), 0);
      finalScore = Math.round(sum / SOW_SCORE_COLUMNS.length);
    }

    // Defensive: if any criteria were touched but not all present and no final score,
    // we still allow the partial save (draft) — but we surface that the row is incomplete
    // via the response so the client can show the "X of 10" indicator.
    void anyTen;
  }

  const nowIso = new Date().toISOString();

  const upsertRow: Record<string, unknown> = {
    entry_id,
    judge_id: userId,
    round_number,
    photo_index,
    updated_at: nowIso,
    ...writeCriteria,
  };
  // judge_scores.score + criteria columns are integer — judges save whole-number marks only.
  if (finalScore !== null) upsertRow.score = finalScore;
  if (feedback !== undefined) upsertRow.feedback = feedback;

  // [SAVE-LOG] Server-side trace — visible in edge function logs
  // (Lovable Cloud → Backend → Edge Functions → submit-judge-score → Logs)
  const logKey = `entry=${entry_id} photo=${photo_index} round=${round_number} judge=${userId}`;
  console.log(`[SAVE-LOG] upsert:start ${logKey} score=${finalScore} criteria_keys=${Object.keys(writeCriteria).join(",")}`);

  const { error: upsertErr } = await admin
    .from("judge_scores")
    .upsert(upsertRow, { onConflict: "entry_id,judge_id,round_number,photo_index" });

  if (upsertErr) {
    console.error(`[SAVE-LOG] upsert:FAILED ${logKey} err=${upsertErr.message}`);
    return new Response(
      JSON.stringify({ error: "Write failed", details: upsertErr.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // [SAVE-LOG] Post-write read-back — proves the row actually persisted.
  const { data: verifyRow, error: verifyErr } = await admin
    .from("judge_scores")
    .select("score,line_score,shape_score,form_score,texture_score,color_palette_score,space_score,tone_score,balance_score,light_score,depth_score,updated_at")
    .eq("entry_id", entry_id)
    .eq("judge_id", userId)
    .eq("round_number", round_number)
    .eq("photo_index", photo_index)
    .maybeSingle();

  if (verifyErr || !verifyRow) {
    console.error(`[SAVE-LOG] verify:MISSING ${logKey} err=${verifyErr?.message ?? "no row"}`);
    return new Response(
      JSON.stringify({ error: "Save verification failed — row not found after write", details: verifyErr?.message ?? null }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
  console.log(`[SAVE-LOG] verify:OK ${logKey} db_score=${verifyRow.score} db_updated_at=${verifyRow.updated_at}`);

  await admin.from("judge_activity_logs").insert({
    judge_id: userId,
    competition_id,
    entry_id,
    round_number,
    action_type: "score_submitted",
    details: {
      photo_index,
      score: finalScore,
      auto_tier: score === undefined || score === null ? finalScore !== null : false,
      criteria_keys: Object.keys(writeCriteria),
      feedback_len: typeof feedback === "string" ? feedback.length : 0,
      source: "edge:submit-judge-score",
    },
  });

  return new Response(
    JSON.stringify({
      ok: true,
      entry_id,
      photo_index,
      written_at: nowIso,
      score: finalScore,
      // Lets the UI render "X of 10" indicator without a roundtrip
      auto_tiered: (score === undefined || score === null) && finalScore !== null,
      // [SAVE-LOG] Persisted row from post-write read-back — client uses this
      // to render its own verification toast if anything looks wrong.
      verification: {
        score: verifyRow.score,
        updated_at: verifyRow.updated_at,
      },
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
