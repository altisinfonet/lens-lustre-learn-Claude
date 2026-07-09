// JP-H-2 Phase A — server-validated judge comment insert
// Called by client BEFORE direct write (dual-write window).
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  authenticateJudge,
  validateJudgeAssignment,
  validateRoundNotLocked,
  AuthError,
} from "../_shared/judgingAuth.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const { userId, isAdmin, admin } = await authenticateJudge(req);

    const body = await req.json().catch(() => ({}));
    const entry_id = String(body?.entry_id ?? "");
    const photo_index = Number(body?.photo_index);
    const comment_raw = typeof body?.comment === "string" ? body.comment : "";
    const round_id = body?.round_id ?? null;

    if (!entry_id || !Number.isInteger(photo_index) || photo_index < 0) {
      return json({ ok: false, error: "invalid_body" }, 400);
    }
    // Strip control chars, trim, length bound
    const comment = comment_raw.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").trim();
    if (comment.length < 1 || comment.length > 2000) {
      return json({ ok: false, error: "invalid_comment_length" }, 400);
    }

    const { data: entry, error: eErr } = await admin
      .from("competition_entries")
      .select("id, competition_id, current_round")
      .eq("id", entry_id)
      .maybeSingle();
    if (eErr || !entry) return json({ ok: false, error: "entry_not_found" }, 404);
    const competition_id = entry.competition_id as string;

    await validateJudgeAssignment(admin, userId, entry_id, competition_id, isAdmin);

    // Derive round for lock check from round_id when possible, else from entry.current_round digits
    let round_number: number | null = null;
    if (round_id) {
      const { data: r } = await admin
        .from("judging_rounds")
        .select("round_number, competition_id")
        .eq("id", round_id)
        .maybeSingle();
      if (r?.competition_id !== competition_id) {
        return json({ ok: false, error: "round_mismatch" }, 400);
      }
      round_number = r.round_number as number;
    } else if (typeof entry.current_round === "string") {
      const digits = entry.current_round.replace(/\D/g, "");
      round_number = digits ? parseInt(digits, 10) : null;
    }
    if (round_number && round_number >= 1 && round_number <= 4) {
      await validateRoundNotLocked(admin, competition_id, round_number, isAdmin);
    }

    const { data: row, error: insErr } = await admin
      .from("judge_comments")
      .insert({
        entry_id,
        photo_index,
        judge_id: userId,
        comment,
        round_id: round_id || null,
      })
      .select("id, comment, created_at, round_id")
      .single();
    if (insErr) return json({ ok: false, error: insErr.message }, 500);

    return json({ ok: true, row });
  } catch (e) {
    if (e instanceof AuthError) return json({ ok: false, error: e.message }, e.status);
    console.error("[submit-judge-comment] error", e);
    return json({ ok: false, error: (e as Error)?.message ?? "unknown" }, 500);
  }
});
