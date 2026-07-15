/**
 * publish-round — Judging v5 / Rule #6
 *
 * Admin-only. Flips a competition round between unpublished and published.
 * Body: { competition_id: uuid, round_number: 1|2|3|4, action: "publish"|"unpublish" }
 *
 * When published_at IS NOT NULL, photographers can read the entry's true
 * status via the entry_public_status view. Until then they only see
 * "judging_in_progress".
 */
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user?.id) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(supabaseUrl, serviceKey);
  const userId = userData.user.id;

  // Admin gate
  const { data: roleRow } = await admin
    .from("user_roles")
    .select("id")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!roleRow) return json({ error: "Forbidden: admin role required" }, 403);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { competition_id, round_number, action } = body ?? {};
  if (!competition_id || typeof competition_id !== "string") {
    return json({ error: "competition_id required" }, 400);
  }
  if (!Number.isInteger(round_number) || round_number < 1 || round_number > 4) {
    return json({ error: "round_number must be 1..4" }, 400);
  }
  if (action !== "publish" && action !== "unpublish") {
    return json({ error: "action must be 'publish' or 'unpublish'" }, 400);
  }

  // Ensure the publish row exists (defensive — trigger should have created it)
  await admin
    .from("competition_round_publish")
    .upsert(
      { competition_id, round_number },
      { onConflict: "competition_id,round_number" }
    );

  // Spec v3 / Golden Rule: Admin can only DECLARE a round that judges have already LOCKED.
  // Locking is performed by the `complete-round` edge fn and stamps `closed_at`.
  //
  // DEFENSIVE FALLBACK (added after forensic incident 2026-05-02): if the publish row
  // is missing `closed_at` but `judging_rounds.status='completed'` for this round,
  // treat the round as locked and auto-stamp closed_at now. This recovers from any
  // legacy state where complete-round ran before the lockRound() upsert existed,
  // or where the publish row was lost. Without this, admins are permanently unable
  // to Declare and participants never see results.
  if (action === "publish") {
    const { data: existing } = await admin
      .from("competition_round_publish")
      .select("closed_at")
      .eq("competition_id", competition_id)
      .eq("round_number", round_number)
      .maybeSingle();
    let effectiveClosedAt = existing?.closed_at ?? null;
    if (!effectiveClosedAt) {
      const { data: jr } = await admin
        .from("judging_rounds")
        .select("status")
        .eq("competition_id", competition_id)
        .eq("round_number", round_number)
        .maybeSingle();
      if (jr?.status === "completed") {
        const stampNow = new Date().toISOString();
        await admin
          .from("competition_round_publish")
          .update({ closed_at: stampNow, closed_by: userId })
          .eq("competition_id", competition_id)
          .eq("round_number", round_number);
        effectiveClosedAt = stampNow;
        console.log(
          `[publish-round] auto-stamped closed_at for legacy locked round (comp=${competition_id} round=${round_number})`
        );
      }
    }
    if (!effectiveClosedAt) {
      return json({
        error:
          "Cannot declare this round — judges have not finished judging it yet. Ask the judge panel to complete the round first, then declare.",
        code: "round_not_locked",
      }, 409);
    }

    // Phase 5 / Step 5.2 — Admin pending-photo gate.
    // Block declaration if ANY entry in this round still has pending photo decisions.
    // Backed by SECURITY DEFINER RPC `get_round_pending_entries` (Step 5.1) which
    // wraps `any_photo_pending(entry_id)`. Read-only check; does not mutate state.
    const { data: pendingEntries, error: pendingErr } = await admin.rpc(
      "get_round_pending_entries" as any,
      { p_competition_id: competition_id, p_round: round_number },
    );
    if (pendingErr) {
      console.error("[publish-round] get_round_pending_entries failed", pendingErr);
      return json({ error: "Pending-photo gate check failed: " + pendingErr.message }, 500);
    }
    if (Array.isArray(pendingEntries) && pendingEntries.length > 0) {
      return json({
        error:
          "Cannot declare round — " + pendingEntries.length +
          " entr" + (pendingEntries.length === 1 ? "y has" : "ies have") +
          " pending photo decisions. All photos must be fully judged before declaration.",
        code: "round_has_pending_photos",
        pending_entries: pendingEntries,
      }, 409);
    }

    // Spec v3 / Golden Rule #4 — Round 4 declaration requires EXACTLY ONE Winner.
    // Runner-ups, honourable mention, and special jury remain optional, but a
    // competition cannot conclude without a Winner placement.
    //
    // Phase 3.2 (Step 2.4): the placement string is no longer hardcoded — it is
    // resolved from `v3_stage_catalog` (stage_key='r4_winner', cert_eligible=true).
    // Falls back to literal "winner" if the catalog query fails so a transient DB
    // error never blocks an admin from declaring R4.
    if (round_number === 4) {
      let winnerPlacement = "winner";
      try {
        const { data: winnerStage } = await admin
          .from("v3_stage_catalog")
          .select("decision_token")
          .eq("stage_key", "r4_winner")
          .eq("cert_eligible", true)
          .eq("is_active", true)
          .maybeSingle();
        if (winnerStage?.decision_token) {
          winnerPlacement = winnerStage.decision_token;
        }
      } catch (e) {
        console.error("[publish-round] v3_stage_catalog lookup failed, using fallback 'winner'", e);
      }

      const { data: winners, error: wErr } = await admin
        .from("judge_tag_assignments")
        .select("entry_id, photo_index, judging_tags!inner(label), competition_entries!inner(competition_id)")
        .eq("round_number", 4)
        .eq("competition_entries.competition_id", competition_id)
        .or(`label.eq.${winnerPlacement},label.eq.Winner`, { foreignTable: "judging_tags" });
      if (wErr) return json({ error: wErr.message }, 500);
      // BUG-044: dedupe by ENTRY, not (entry,photo). complete-round's winner
      // gate is entry-grain, so a Winner tag on two photos of ONE entry (or
      // two judges tagging the same entry) passed round-close but 409'd here —
      // with the round already locked, the declaration was permanently stuck.
      // The business rule is one winning ENTRY per competition.
      const winnerEntries = new Set((winners || []).map((row: any) => row.entry_id));
      const winnerCount = winnerEntries.size;
      if (winnerCount === 0) {
        return json({
          error:
            "Cannot declare Round 4 — no Winner has been assigned. Golden Rule #4: exactly ONE Winner is mandatory to declare R4. Assign one Winner in the judge panel, then declare.",
          code: "r4_winner_missing",
        }, 409);
      }
      if (winnerCount > 1) {
        return json({
          error:
            "Cannot declare Round 4 — " + winnerCount + " different entries are marked as Winner. Exactly ONE winning entry is allowed per competition.",
          code: "r4_winner_duplicate",
          winner_count: winnerCount,
        }, 409);
      }
    }
  }

  const nowIso = new Date().toISOString();
  const update =
    action === "publish"
      ? { published_at: nowIso, published_by: userId }
      : { published_at: null, published_by: null };

  const { data, error } = await admin
    .from("competition_round_publish")
    .update(update)
    .eq("competition_id", competition_id)
    .eq("round_number", round_number)
    .select()
    .maybeSingle();

  if (error) return json({ error: error.message }, 500);

  // Best-effort audit log
  await admin.from("judge_activity_logs").insert({
    judge_id: userId,
    competition_id,
    round_number,
    action_type: action === "publish" ? "round_published" : "round_unpublished",
    details: { source: "edge:publish-round" },
  });

  // Spec V3 — fan out "Needs Review → submit RAW by email reply" notifications
  // ONLY when the admin DECLARES (publishes) Round 1. NR is R1-only; R2/R3/R4
  // never produce NR rows (DB guard rejects them), so this fan-out is gated
  // hard to round_number === 1.
  if (action === "publish" && round_number === 1) {
    try {
      // Resolve support / reply-to address from site settings (fallback hard-coded).
      let supportEmail = "support@50mmretina.com";
      const { data: setting } = await admin
        .from("site_settings")
        .select("value")
        .eq("key", "support_email")
        .maybeSingle();
      const candidate = (setting?.value as any)?.email ?? (typeof setting?.value === "string" ? setting.value : null);
      if (typeof candidate === "string" && candidate.includes("@")) supportEmail = candidate;

      const { data: recipients, error: recErr } = await admin.rpc(
        "get_needs_review_recipients_for_round" as any,
        { p_competition_id: competition_id, p_round_number: round_number },
      );
      if (recErr) {
        console.error("[publish-round] needs-review recipients RPC failed", recErr);
      } else if (Array.isArray(recipients)) {
        for (const r of recipients as any[]) {
          const photoIdx: number[] = Array.isArray(r.photo_indices) ? r.photo_indices : [];
          const photoLabels = photoIdx.length
            ? photoIdx.map((i) => `Photo ${Number(i) + 1}`).join(", ")
            : "one of your photos";
          try {
            await admin.rpc("emit_notification" as any, {
              _kind: "needs_review_published",
              _entity_id: r.entry_id,
              _round_number: round_number,
              _recipient_user_id: r.user_id,
              _in_app_type: "needs_review",
              _in_app_title: "Action needed: send the original RAW file",
              _in_app_message:
                'The judges of "' + (r.competition_title ?? "your competition") +
                '" flagged ' + photoLabels + ' for review. Please reply to the email from ' +
                supportEmail + " with the original RAW file attached.",
              _in_app_reference_id: r.entry_id,
              _email_template: "needs-review-submit-raw",
              _email_data: {
                competitionTitle: r.competition_title,
                roundNumber: round_number,
                photoLabels,
                supportEmail,
              },
              _action_url: null,
            });
          } catch (e) {
            console.error("[publish-round] emit_notification failed for entry", r.entry_id, e);
          }
        }
      }
    } catch (e) {
      console.error("[publish-round] needs-review fanout threw", e);
    }
  }

  return json({ ok: true, row: data });
});
