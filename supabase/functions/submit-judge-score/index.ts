/**
 * submit-judge-score — Phase 0.5 Edge Function
 *
 * Server-validated write path for judge_scores.
 * JUDGING-15 (2026-07-16): R2–R4 scoring uses 15 elements of art, each a whole
 * number 0..10; the final `score` is their average (one decimal), auto-computed
 * once all 15 are present.
 *
 * Enforces:
 *   1. JWT valid (judge/admin)
 *   2. Round not completed (admin bypass)
 *   3. Judge assigned to competition + entry (distributed mode)
 *   4. score (when provided) is a 0..10 number (average; may carry one decimal)
 *   5. Each of the 15 criterion columns is a whole number in 0..10 (when provided)
 *   6. R2+ final score requires ALL 15 criteria (mandatory-complete)
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

// JUDGING-15 (2026-07-16, owner-approved): R2–R4 scoring uses FIFTEEN
// elements of art, each 0–10. The final `score` is the auto-computed average
// of all 15 (one decimal) and only exists once ALL 15 are filled.
const SOW_SCORE_COLUMNS = [
  "composition_score",
  "color_palette_score",
  "technique_score",
  "line_score",
  "shape_score",
  "form_score",
  "texture_score",
  "space_score",
  "tone_score",
  "balance_score",
  "light_score",
  "depth_score",
  "editing_score",
  "story_score",
  "moment_score",
] as const;

// No legacy-rejected columns any more — composition & technique are first-class.
const LEGACY_REJECTED_COLUMNS = [] as const;

function bad(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Each of the 15 criteria is a WHOLE number 0..10.
function isWholeScoreInRange(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 10;
}
// The final `score` is the average of the 15 criteria — a 0..10 number that may
// carry one decimal (e.g. 7.3), so it is NOT required to be a whole number.
function isAvgScoreInRange(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 10;
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

  if (score !== undefined && score !== null && !isAvgScoreInRange(score))
    return bad("score must be a number 0..10 (average of the 15 criteria)");

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

  // ── JUDGING-15: Mandatory 15 criteria + auto-average ──
  // For R2/R3/R4, when the caller is FINALIZING the photo's score (i.e. sending
  // a non-null `score`), every one of the 15 criteria must be present in the
  // merged row (incoming payload + already-stored). Partial saves WITHOUT a
  // final `score` are still allowed so judges can fill sliders one at a time.
  // Auto-average: if no `score` is sent but all 15 criteria are present after
  // the merge, the server computes `score` as their mean, rounded to 1 decimal.
  let finalScore: number | null = (score === undefined || score === null) ? null : score;

  if (round_number >= 2) {
    // Load any existing row so we can check the merged-final state (all 15 cols)
    const { data: existing } = await admin
      .from("judge_scores")
      .select("composition_score,color_palette_score,technique_score,line_score,shape_score,form_score,texture_score,space_score,tone_score,balance_score,light_score,depth_score,editing_score,story_score,moment_score,score")
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

    const allFifteen = SOW_SCORE_COLUMNS.every((c) => typeof merged[c] === "number");
    const anyFilled = SOW_SCORE_COLUMNS.some((c) => typeof merged[c] === "number");

    // Hard block: caller is sending a final `score` but the 15 criteria are not all set.
    if (finalScore !== null && !allFifteen) {
      const missing = SOW_SCORE_COLUMNS.filter((c) => typeof merged[c] !== "number");
      return bad(
        `Round ${round_number} requires ALL ${SOW_SCORE_COLUMNS.length} criteria before saving a final score. Missing: ${missing.join(", ")}.`,
        422,
      );
    }

    // Server-authoritative average: once all 15 criteria are present, the final
    // score IS their mean (one decimal). The judge cannot override it — any
    // client-sent `score` is ignored in favour of the computed average.
    if (allFifteen) {
      const sum = SOW_SCORE_COLUMNS.reduce((acc, c) => acc + (merged[c] as number), 0);
      finalScore = Math.round((sum / SOW_SCORE_COLUMNS.length) * 10) / 10;
    }

    // Partial saves (draft) are still allowed; the client shows an "X of 15" indicator.
    void anyFilled;
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
