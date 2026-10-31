import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSecureHeaders } from "../_shared/secureHeaders.ts";

// Phase 1A Step A — wallet_ledger_apply_v2 dry-run shadow (non-blocking).
// MUST NOT throw, MUST NOT change response shape, MUST NOT mutate balances.
// Live branch of v2 still raises P0001 — mutation impossible.
const SHADOW_PATH_RZP = "supabase/functions/razorpay-verify-payment";
async function shadowApplyV2RZP(client: any, args: {
  op: string; user_id: string | null; amount: number; idempotency_key: string;
  description?: string | null; reference_id?: string | null;
}) {
  try {
    const { error } = await client.rpc("wallet_ledger_apply_v2", {
      p_op: args.op,
      p_user_id: args.user_id,
      p_amount: args.amount,
      p_idempotency_key: args.idempotency_key,
      p_description: args.description ?? null,
      p_reference_id: args.reference_id ?? null,
      p_source_path: SHADOW_PATH_RZP,
      p_dry_run: false,
    });
    if (error) console.warn(`[v2-shadow] ${SHADOW_PATH_RZP} ${args.op}/${args.idempotency_key} dry-run error:`, error.message);
  } catch (e) {
    console.warn(`[v2-shadow] ${SHADOW_PATH_RZP} ${args.op}/${args.idempotency_key} threw:`, (e as Error)?.message);
  }
}

// HMAC-SHA256 hex (Razorpay signature spec)
async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const headers = getSecureHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }
    const userId = claimsData.claims.sub as string;

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = await req.json();
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return new Response(JSON.stringify({ error: "Missing razorpay_order_id, razorpay_payment_id or razorpay_signature" }), { status: 400, headers });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Idempotency: payment_id is unique
    const { data: existing } = await admin
      .from("wallet_transactions")
      .select("id, amount, status")
      .contains("metadata", { gateway: "razorpay", razorpay_payment_id })
      .maybeSingle();

    if (existing && existing.status === "completed") {
      return new Response(JSON.stringify({ success: true, already_credited: true, amount: Number(existing.amount) }), { headers });
    }

    const { data: settings } = await admin
      .from("site_settings")
      .select("value")
      .eq("key", "payment_gateways")
      .maybeSingle();

    const cfg = (settings?.value as any)?.razorpay;
    if (!cfg?.enabled || !cfg.key_id || !cfg.key_secret) {
      return new Response(JSON.stringify({ error: "Razorpay not configured" }), { status: 400, headers });
    }

    // 1) Verify signature: HMAC_SHA256(order_id + "|" + payment_id, key_secret)
    const expected = await hmacHex(cfg.key_secret, `${razorpay_order_id}|${razorpay_payment_id}`);
    if (expected !== razorpay_signature) {
      console.error("Razorpay signature mismatch", { razorpay_order_id, razorpay_payment_id });
      return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 400, headers });
    }

    // 2) Fetch payment from Razorpay to confirm captured + amount + ownership
    const auth = btoa(`${cfg.key_id}:${cfg.key_secret}`);
    const payRes = await fetch(`https://api.razorpay.com/v1/payments/${razorpay_payment_id}`, {
      headers: { "Authorization": `Basic ${auth}` },
    });
    const payJson = await payRes.json();
    if (!payRes.ok) {
      console.error("Razorpay fetch payment error:", payJson);
      return new Response(JSON.stringify({ error: "Could not fetch payment" }), { status: 502, headers });
    }

    if (payJson.status !== "captured" && payJson.status !== "authorized") {
      return new Response(JSON.stringify({ error: `Payment status: ${payJson.status}` }), { status: 400, headers });
    }
    if (payJson.order_id !== razorpay_order_id) {
      return new Response(JSON.stringify({ error: "Order/payment mismatch" }), { status: 400, headers });
    }

    // Pull order to read notes (we set user_id + amount_usd at create-payment-session time)
    const ordRes = await fetch(`https://api.razorpay.com/v1/orders/${razorpay_order_id}`, {
      headers: { "Authorization": `Basic ${auth}` },
    });
    const ordJson = await ordRes.json();
    if (!ordRes.ok) {
      console.error("Razorpay fetch order error:", ordJson);
      return new Response(JSON.stringify({ error: "Could not fetch order" }), { status: 502, headers });
    }

    const orderUserId = ordJson?.notes?.user_id;
    const amountUsdNote = ordJson?.notes?.amount_usd;

    if (orderUserId && orderUserId !== userId) {
      return new Response(JSON.stringify({ error: "Order does not belong to caller" }), { status: 403, headers });
    }

    const amountUSD = Number(amountUsdNote);
    if (!Number.isFinite(amountUSD) || amountUSD <= 0) {
      return new Response(JSON.stringify({ error: "Invalid amount in order notes" }), { status: 502, headers });
    }

    // Auto-capture safety: if Razorpay returned 'authorized' (rare with auto-capture), capture now
    if (payJson.status === "authorized") {
      const capRes = await fetch(`https://api.razorpay.com/v1/payments/${razorpay_payment_id}/capture`, {
        method: "POST",
        headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/json" },
        body: JSON.stringify({ amount: payJson.amount, currency: payJson.currency }),
      });
      const capJson = await capRes.json();
      if (!capRes.ok) {
        console.error("Razorpay capture error:", capJson);
        return new Response(JSON.stringify({ error: "Capture failed" }), { status: 502, headers });
      }
    }

    // Credit wallet (USD)
    const { error: rpcErr } = await admin.rpc("wallet_transaction", {
      _user_id: userId,
      _type: "deposit",
      _amount: amountUSD,
      _description: `Razorpay deposit — Payment ${razorpay_payment_id}`,
      _reference_id: null,
      _reference_type: "deposit",
      _metadata: {
        gateway: "razorpay",
        razorpay_order_id,
        razorpay_payment_id,
        amount_inr_paise: payJson.amount,
      },
    });

    if (rpcErr) {
      console.error("wallet_transaction RPC error:", rpcErr);
      return new Response(JSON.stringify({ error: rpcErr.message }), { status: 500, headers });
    }

    // Phase 1A Step A — dry-run shadow (non-blocking, post-success only)
    await shadowApplyV2RZP(admin, {
      op: "deposit_credit",
      user_id: userId,
      amount: amountUSD,
      idempotency_key: `razorpay:${razorpay_payment_id}`,
      description: `Razorpay deposit — Payment ${razorpay_payment_id}`,
      reference_id: razorpay_payment_id,
    });

    return new Response(JSON.stringify({ success: true, amount: amountUSD, gateway: "Razorpay" }), { headers });
  } catch (err) {
    console.error("razorpay-verify-payment error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message || "Internal error" }), { status: 500, headers });
  }
});
