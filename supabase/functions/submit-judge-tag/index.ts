// JP-H-2 Phase A — server-validated judge tag toggle
// Called by client BEFORE direct write (dual-write window).
// Errors are logged and returned; client's direct-write fallback keeps behavior intact.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  authenticateJudge,
  validateJudgeAssignment,
  validateRoundNotLocked,
  AuthError,
} from "../_shared/judgingAuth.ts";

const UNIQUE_AWARD_LABELS = new Set([
  "winner",
  "1st runner-up",
  "2nd runner-up",
  "1st runner up",
  "2nd runner up",
]);

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
    const tag_id = String(body?.tag_id ?? "");
    const photo_index = Number(body?.photo_index);
    const round_number = Number(body?.round_number);

    if (!entry_id || !tag_id || !Number.isInteger(photo_index) || photo_index < 0 ||
        !Number.isInteger(round_number) || round_number < 1 || round_number > 4) {
      return json({ ok: false, error: "invalid_body" }, 400);
    }

    // Resolve competition_id
    const { data: entry, error: eErr } = await admin
      .from("competition_entries")
      .select("id, competition_id")
      .eq("id", entry_id)
      .maybeSingle();
    if (eErr || !entry) return json({ ok: false, error: "entry_not_found" }, 404);
    const competition_id = entry.competition_id as string;

    // Authz: assignment + round lock
    await validateJudgeAssignment(admin, userId, entry_id, competition_id, isAdmin);
    await validateRoundNotLocked(admin, competition_id, round_number, isAdmin);

    // Tag must exist and be visible in this round. NOTE: client (useJudgeActions)
    // does NOT filter on is_active/is_visible — those flags gate the admin tag
    // picker UI, not the write API. Live prod tags used by judges have
    // is_visible=false. Matching client behaviour exactly.
    const { data: tag } = await admin
      .from("judging_tags")
      .select("id, label, visible_in_round")
      .eq("id", tag_id)
      .maybeSingle();
    if (!tag) return json({ ok: false, error: "tag_not_found" }, 404);
    const visible = Array.isArray(tag.visible_in_round) ? tag.visible_in_round : [];
    if (!visible.includes(round_number)) {
      return json({ ok: false, error: "tag_not_visible_in_round" }, 400);
    }



    // Toggle: existing row for this (entry, photo, round, tag, judge)?
    const { data: existing } = await admin
      .from("judge_tag_assignments")
      .select("id")
      .eq("entry_id", entry_id)
      .eq("photo_index", photo_index)
      .eq("round_number", round_number)
      .eq("tag_id", tag_id)
      .eq("judge_id", userId)
      .maybeSingle();

    if (existing) {
      const { error: delErr } = await admin
        .from("judge_tag_assignments")
        .delete()
        .eq("id", existing.id);
      if (delErr) return json({ ok: false, error: delErr.message }, 500);
      return json({ ok: true, action: "removed" });
    }

    // R4 unique-award check
    if (round_number === 4) {
      const label = (tag.label ?? "").toLowerCase().trim();
      if (UNIQUE_AWARD_LABELS.has(label)) {
        const { data: dupe } = await admin
          .from("judge_tag_assignments")
          .select("entry_id")
          .eq("tag_id", tag_id)
          .neq("entry_id", entry_id)
          .limit(1);
        if (dupe && dupe.length > 0) {
          return json({ ok: false, error: "award_already_assigned" }, 409);
        }
      }
    }

    // Single-active-tag cleanup for this round (this judge, this photo)
    const { data: roundTags } = await admin
      .from("judging_tags")
      .select("id")
      .contains("visible_in_round", [round_number]);
    const roundTagIds = (roundTags ?? []).map((t: any) => t.id).filter((id: string) => id !== tag_id);
    if (roundTagIds.length > 0) {
      await admin
        .from("judge_tag_assignments")
        .delete()
        .eq("entry_id", entry_id)
        .eq("photo_index", photo_index)
        .eq("round_number", round_number)
        .eq("judge_id", userId)
        .in("tag_id", roundTagIds);
    }

    const { error: insErr } = await admin
      .from("judge_tag_assignments")
      .insert({ entry_id, photo_index, round_number, tag_id, judge_id: userId });
    if (insErr) return json({ ok: false, error: insErr.message }, 500);

    return json({ ok: true, action: "added" });
  } catch (e) {
    if (e instanceof AuthError) return json({ ok: false, error: e.message }, e.status);
    console.error("[submit-judge-tag] error", e);
    return json({ ok: false, error: (e as Error)?.message ?? "unknown" }, 500);
  }
});
