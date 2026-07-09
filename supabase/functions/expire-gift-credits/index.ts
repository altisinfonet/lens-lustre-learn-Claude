import { createClient } from "https://esm.sh/@supabase/supabase-js@2.97.0";
import { getSecureHeaders } from "../_shared/secureHeaders.ts";

// Phase 1A Step A — wallet_ledger_apply_v2 dry-run shadow (non-blocking).
const SHADOW_PATH_GE = "supabase/functions/expire-gift-credits";
async function shadowApplyV2GE(client: any, args: {
  op: string; user_id: string | null; amount: number; idempotency_key: string;
  description?: string | null; reference_id?: string | null;
}) {
  try {
    const { error } = await client.rpc("wallet_ledger_apply_v2", {
      p_op: args.op, p_user_id: args.user_id, p_amount: args.amount,
      p_idempotency_key: args.idempotency_key,
      p_description: args.description ?? null,
      p_reference_id: args.reference_id ?? null,
      p_source_path: SHADOW_PATH_GE, p_dry_run: false,
    });
    if (error) console.warn(`[v2-shadow] ${SHADOW_PATH_GE} ${args.op}/${args.idempotency_key} dry-run error:`, error.message);
  } catch (e) {
    console.warn(`[v2-shadow] ${SHADOW_PATH_GE} ${args.op}/${args.idempotency_key} threw:`, (e as Error)?.message);
  }
}

Deno.serve(async (req) => {
  const headers = getSecureHeaders(req);

  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method === "TRACE") return new Response("Method Not Allowed", { status: 405, headers });

  const cronSecret = req.headers.get("x-cron-secret");
  if (!cronSecret || cronSecret !== Deno.env.get("CRON_SECRET")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...headers, "Content-Type": "application/json" } });
  }



  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: expiredGifts, error: fetchError } = await supabase
      .from("gift_announcements")
      .select("id, user_id, amount, reason, expires_at")
      .eq("is_expired", false)
      .not("expires_at", "is", null)
      .lt("expires_at", new Date().toISOString());

    if (fetchError) throw fetchError;

    if (!expiredGifts || expiredGifts.length === 0) {
      return new Response(JSON.stringify({ success: true, expired: 0 }), { headers });
    }

    let expiredCount = 0;

    for (const gift of expiredGifts) {
      try {
        const { data: wallet } = await supabase
          .from("wallets").select("balance").eq("user_id", gift.user_id).maybeSingle();

        const currentBalance = wallet?.balance ?? 0;
        const deductAmount = Math.min(gift.amount, currentBalance);

        if (deductAmount > 0) {
          const { error: txnError } = await supabase.rpc("wallet_transaction", {
            _user_id: gift.user_id, _type: "gift_expiry", _amount: -deductAmount,
            _description: `Gift credit expired: "${gift.reason}"`,
            _metadata: { expired_gift_id: gift.id, original_amount: gift.amount },
          });
          if (txnError) { console.error(`Failed to deduct for gift ${gift.id}:`, txnError.message); continue; }
          // Phase 1A Step A — dry-run shadow (non-blocking, post-success only)
          await shadowApplyV2GE(supabase, {
            op: "gift_refund", user_id: gift.user_id, amount: -deductAmount,
            idempotency_key: `gift_expiry:${gift.id}`,
            description: `Gift credit expired: "${gift.reason}"`,
            reference_id: gift.id,
          });
        }

        await supabase.from("gift_announcements").update({ is_expired: true }).eq("id", gift.id);
        expiredCount++;
      } catch (err: any) {
        console.error(`Error processing gift ${gift.id}:`, err.message);
      }
    }

    console.log(`Expired ${expiredCount} gift credits`);
    return new Response(JSON.stringify({ success: true, expired: expiredCount }), { headers });
  } catch (err: any) {
    console.error("Gift expiry error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
});
