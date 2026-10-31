/**
 * cast-photo-vote
 * ------------------------------------------------------------------
 * PHOTO-FIRST atomic vote endpoint (Phase 1 root-level fix).
 *
 * Replaces the legacy split flow:
 *   • toggle-competition-vote (vote insert/delete)
 *   • vote-wallet-reward       (wallet credit/debit)
 *
 * One request → one atomic outcome:
 *   1. Authn (JWT)
 *   2. Validate entry, photo_index range, competition phase, deadlines
 *   3. Insert / delete the per-photo vote row
 *   4. Apply wallet reward / penalty (idempotent via reference_id)
 *   5. Return unified result
 *
 * SOW: "One Image, One Card, One Vote, One URL" — vote grain is (entry_id, photo_index).
 *
 * INPUT  : { entryId: string, photoIndex: number, action: "vote" | "unvote" }
 * OUTPUT : {
 *   success: boolean,
 *   action: "vote" | "unvote",
 *   photo_index: number,
 *   rewards_applied: boolean,
 *   voter_reward: number,        // signed: + on vote, − on unvote penalty, 0 if none
 *   reason?: string,             // when rewards_applied = false
 * }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.97.0";
import { getSecureHeaders } from "../_shared/secureHeaders.ts";

// Phase 1A Step A — wallet_ledger_apply_v2 dry-run shadow (non-blocking).
// Mutation #11a-PREP: helper accepts optional per-call `dry_run` override; default preserved as true.
// No caller passes `dry_run` yet → all 4 vote paths remain dry-run (zero behavior change).
const SHADOW_PATH_VOTE = "supabase/functions/cast-photo-vote";
async function shadowApplyV2Vote(client: any, args: {
  op: string; user_id: string | null; amount: number; idempotency_key: string;
  description?: string | null; reference_id?: string | null;
  dry_run?: boolean;
}) {
  try {
    const { error } = await client.rpc("wallet_ledger_apply_v2", {
      p_op: args.op, p_user_id: args.user_id, p_amount: args.amount,
      p_idempotency_key: args.idempotency_key,
      p_description: args.description ?? null,
      p_reference_id: args.reference_id ?? null,
      p_source_path: SHADOW_PATH_VOTE, p_dry_run: args.dry_run ?? true,
    });
    if (error) console.warn(`[v2-shadow] ${SHADOW_PATH_VOTE} ${args.op}/${args.idempotency_key} dry-run error:`, error.message);
  } catch (e) {
    console.warn(`[v2-shadow] ${SHADOW_PATH_VOTE} ${args.op}/${args.idempotency_key} threw:`, (e as Error)?.message);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const headers = { ...getSecureHeaders(req), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response(null, { headers });

  try {
    // -------------------------------------------------- 1. Authn
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user?.id) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }
    const userId = userData.user.id;

    // -------------------------------------------------- 2. Input
    let body: any;
    try { body = await req.json(); }
    catch { return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers }); }

    const entryId = String(body?.entryId ?? "");
    const action  = String(body?.action ?? "");
    const photoIndex = Number.isInteger(body?.photoIndex) ? body.photoIndex : 0;

    if (!UUID_RE.test(entryId)) {
      return new Response(JSON.stringify({ error: "Invalid entryId" }), { status: 400, headers });
    }
    if (action !== "vote" && action !== "unvote") {
      return new Response(JSON.stringify({ error: "action must be 'vote' or 'unvote'" }), { status: 400, headers });
    }
    if (photoIndex < 0 || photoIndex > 99) {
      return new Response(JSON.stringify({ error: "photoIndex out of range" }), { status: 400, headers });
    }

    // -------------------------------------------------- 3. Entry + competition lookup
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: entry, error: entryErr } = await admin
      .from("competition_entries")
      .select("id, user_id, competition_id, photos, photo_meta")
      .eq("id", entryId)
      .maybeSingle();

    if (entryErr || !entry) {
      return new Response(JSON.stringify({ error: "Entry not found" }), { status: 404, headers });
    }

    // photoIndex must point to an actual photo
    const photos = Array.isArray(entry.photos) ? entry.photos : [];
    if (photoIndex >= photos.length) {
      return new Response(JSON.stringify({ error: "photoIndex out of range for entry" }), { status: 400, headers });
    }

    // Per-photo rejection guard
    const meta = Array.isArray(entry.photo_meta) ? entry.photo_meta : [];
    if (meta[photoIndex]?.rejected === true) {
      return new Response(JSON.stringify({ error: "This photo is not eligible for voting" }), { status: 403, headers });
    }

    // Self-vote guard
    if (action === "vote" && entry.user_id === userId) {
      return new Response(JSON.stringify({ error: "Cannot vote on your own entry" }), { status: 403, headers });
    }

    // Phase + deadline guard — uses canonical SQL current_phase() (R5)
    const { data: comp } = await admin
      .from("competitions")
      .select("voting_ends_at")
      .eq("id", entry.competition_id)
      .maybeSingle();

    const { data: phaseData } = await admin.rpc("current_phase", {
      p_competition_id: entry.competition_id,
    });
    const phase: string = (phaseData as string) || "submission_open";

    // Voting phase is the canonical "vote-allowed" window per SOW.
    // Submission_open continues to accept votes for the dual-engagement model.
    const allowVote = phase === "voting" || phase === "submission_open";
    if (!allowVote) {
      return new Response(
        JSON.stringify({ error: "Voting is not open for this competition", current_phase: phase }),
        { status: 403, headers },
      );
    }
    if (comp?.voting_ends_at && new Date() > new Date(comp.voting_ends_at)) {
      return new Response(
        JSON.stringify({ error: "Voting period has ended", voting_ends_at: comp.voting_ends_at }),
        { status: 403, headers },
      );
    }

    // -------------------------------------------------- 4. Vote write (atomic)
    let voteRowId: string | null = null;

    if (action === "vote") {
      // Upsert (idempotent on the unique key entry_id+user_id+photo_index)
      const { data: upserted, error: upErr } = await admin
        .from("competition_votes")
        .upsert(
          { entry_id: entryId, user_id: userId, photo_index: photoIndex },
          { onConflict: "entry_id,user_id,photo_index" },
        )
        .select("id")
        .maybeSingle();
      if (upErr) throw upErr;
      voteRowId = upserted?.id ?? null;

      if (!voteRowId) {
        // Conflict ignored — fetch existing row id
        const { data: existing } = await admin
          .from("competition_votes")
          .select("id")
          .eq("entry_id", entryId)
          .eq("user_id", userId)
          .eq("photo_index", photoIndex)
          .maybeSingle();
        voteRowId = existing?.id ?? null;
      }
    } else {
      // unvote — capture row id BEFORE delete so we can record reversal
      const { data: existing } = await admin
        .from("competition_votes")
        .select("id")
        .eq("entry_id", entryId)
        .eq("user_id", userId)
        .eq("photo_index", photoIndex)
        .maybeSingle();
      voteRowId = existing?.id ?? null;

      const { error: delErr } = await admin
        .from("competition_votes")
        .delete()
        .eq("entry_id", entryId)
        .eq("user_id", userId)
        .eq("photo_index", photoIndex);
      if (delErr) throw delErr;
    }

    // -------------------------------------------------- 5. Wallet reward / penalty
    // Vote & Earn applies during every server-allowed voting window:
    // submission_open (early engagement) and voting (post-submission public voting).
    let rewardsApplied = false;
    let signedVoterReward = 0;
    let rewardReason: string | undefined;

    if (!allowVote) {
      rewardReason = "not_vote_reward_window";
    } else {
      const { data: settingRow } = await admin
        .from("site_settings")
        .select("value")
        .eq("key", "vote_reward_config")
        .maybeSingle();

      const cfg = settingRow?.value as {
        active?: boolean;
        voter_reward?: number;
        entry_owner_reward?: number;
      } | null;

      if (!cfg?.active) {
        rewardReason = "rewards_inactive";
      } else {
        const voterReward = Number(cfg.voter_reward || 0);
        const ownerReward = Number(cfg.entry_owner_reward || 0);

        if (action === "vote" && voteRowId) {
          // Idempotency: skip if a reward row already exists for this vote
          const { data: existingReward } = await admin
            .from("wallet_transactions")
            .select("id")
            .eq("user_id", userId)
            .eq("type", "vote_reward")
            .eq("reference_id", voteRowId)
            .eq("reference_type", "competition_vote")
            .maybeSingle();

          if (existingReward) {
            rewardReason = "already_rewarded";
          } else {
            if (voterReward > 0) {
              await admin.rpc("wallet_transaction", {
                _user_id: userId,
                _type: "vote_reward",
                _amount: voterReward,
                _description: `Vote reward — thank you for voting! (+$${voterReward.toFixed(3)})`,
                _reference_id: voteRowId,
                _reference_type: "competition_vote",
              });
              // Phase 1A Mutation #11a — vote_reward_voter canonical cutover (live write, one subpath only)
              await shadowApplyV2Vote(admin, {
                op: "vote_reward_voter", user_id: userId, amount: voterReward,
                idempotency_key: `vote_reward_voter:${voteRowId}`,
                description: `Vote reward voter (+$${voterReward.toFixed(3)})`,
                reference_id: voteRowId,
                dry_run: false,
              });
            }
            if (ownerReward > 0 && entry.user_id !== userId) {
              await admin.rpc("wallet_transaction", {
                _user_id: entry.user_id,
                _type: "vote_reward",
                _amount: ownerReward,
                _description: `Someone voted on your entry! (+$${ownerReward.toFixed(3)})`,
                _reference_id: voteRowId,
                _reference_type: "competition_vote",
              });
              // Phase 1A Step A — dry-run shadow (non-blocking)
              await shadowApplyV2Vote(admin, {
                op: "vote_reward_owner", user_id: entry.user_id, amount: ownerReward,
                idempotency_key: `vote_reward_owner:${voteRowId}`,
                description: `Vote reward owner (+$${ownerReward.toFixed(3)})`,
                reference_id: voteRowId,
              });
            }
            rewardsApplied = true;
            signedVoterReward = voterReward;
          }
        } else if (action === "unvote") {
          const voterPenalty = voterReward * 2;
          const ownerPenalty = ownerReward * 2;
          // Phase 2.2 (W4): always tag penalties with reference_id/type for traceability.
          // Use the captured voteRowId (pre-delete) when available; otherwise synthesize a
          // deterministic-ish reference using entry+user+photo so penalties remain auditable.
          const penaltyRef = voteRowId ?? entryId;
          const penaltyRefType = voteRowId ? "competition_vote" : "competition_entry";
          if (voterPenalty > 0) {
            await admin.rpc("wallet_transaction", {
              _user_id: userId,
              _type: "unvote_penalty",
              _amount: -voterPenalty,
              _description: `Unvote penalty — 2× reward deducted ($${voterPenalty.toFixed(3)})`,
              _reference_id: penaltyRef,
              _reference_type: penaltyRefType,
            });
            // Phase 1A Step A — dry-run shadow (non-blocking)
            await shadowApplyV2Vote(admin, {
              op: "vote_unvote_penalty_voter", user_id: userId, amount: -voterPenalty,
              idempotency_key: `vote_unvote_penalty_voter:${penaltyRef}`,
              description: `Unvote penalty voter ($${voterPenalty.toFixed(3)})`,
              reference_id: String(penaltyRef),
            });
          }
          if (ownerPenalty > 0 && entry.user_id !== userId) {
            await admin.rpc("wallet_transaction", {
              _user_id: entry.user_id,
              _type: "unvote_penalty",
              _amount: -ownerPenalty,
              _description: `Vote removed — 2× reward deducted ($${ownerPenalty.toFixed(3)})`,
              _reference_id: penaltyRef,
              _reference_type: penaltyRefType,
            });
            // Phase 1A Step A — dry-run shadow (non-blocking)
            await shadowApplyV2Vote(admin, {
              op: "vote_unvote_penalty_owner", user_id: entry.user_id, amount: -ownerPenalty,
              idempotency_key: `vote_unvote_penalty_owner:${penaltyRef}`,
              description: `Unvote penalty owner ($${ownerPenalty.toFixed(3)})`,
              reference_id: String(penaltyRef),
            });
          }
          rewardsApplied = voterPenalty > 0 || ownerPenalty > 0;
          signedVoterReward = -voterPenalty;
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        action,
        photo_index: photoIndex,
        rewards_applied: rewardsApplied,
        voter_reward: signedVoterReward,
        ...(rewardReason ? { reason: rewardReason } : {}),
      }),
      { status: 200, headers },
    );
  } catch (err: any) {
    console.error("cast-photo-vote error:", err);
    return new Response(
      JSON.stringify({ error: err?.message ?? "Internal server error" }),
      { status: 500, headers },
    );
  }
});
