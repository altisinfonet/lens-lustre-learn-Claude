import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSecureHeaders } from "../_shared/secureHeaders.ts";

// Phase 1A Step A — wallet_ledger_apply_v2 dry-run shadow (non-blocking).
const SHADOW_PATH_PP = "supabase/functions/paypal-capture-order";
async function shadowApplyV2PP(client: any, args: {
  op: string; user_id: string | null; amount: number; idempotency_key: string;
  description?: string | null; reference_id?: string | null;
}) {
  try {
    const { error } = await client.rpc("wallet_ledger_apply_v2", {
      p_op: args.op, p_user_id: args.user_id, p_amount: args.amount,
      p_idempotency_key: args.idempotency_key,
      p_description: args.description ?? null,
      p_reference_id: args.reference_id ?? null,
      p_source_path: SHADOW_PATH_PP, p_dry_run: false,
    });
    if (error) console.warn(`[v2-shadow] ${SHADOW_PATH_PP} ${args.op}/${args.idempotency_key} live error:`, error.message);
  } catch (e) {
    console.warn(`[v2-shadow] ${SHADOW_PATH_PP} ${args.op}/${args.idempotency_key} threw:`, (e as Error)?.message);
  }
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

    const { order_id } = await req.json();
    if (!order_id || typeof order_id !== "string") {
      return new Response(JSON.stringify({ error: "order_id is required" }), { status: 400, headers });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Idempotency: if we already credited this PayPal order, return success
    const { data: existing } = await admin
      .from("wallet_transactions")
      .select("id, amount, status")
      .eq("user_id", userId)
      .eq("reference_type", "deposit")
      .contains("metadata", { gateway: "paypal", paypal_order_id: order_id })
      .maybeSingle();

    if (existing && existing.status === "completed") {
      return new Response(JSON.stringify({ success: true, already_credited: true, amount: Number(existing.amount) }), { headers });
    }

    // Get PayPal config
    const { data: settings } = await admin
      .from("site_settings")
      .select("value")
      .eq("key", "payment_gateways")
      .maybeSingle();

    const cfg = (settings?.value as any)?.paypal;
    if (!cfg?.enabled || !cfg.client_id || !cfg.secret) {
      return new Response(JSON.stringify({ error: "PayPal not configured" }), { status: 400, headers });
    }
    const base = cfg.mode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

    // Get access token
    const tokRes = await fetch(`${base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${btoa(`${cfg.client_id}:${cfg.secret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    const tokJson = await tokRes.json();
    if (!tokRes.ok) {
      console.error("PayPal token error:", tokJson);
      return new Response(JSON.stringify({ error: "PayPal auth failed" }), { status: 502, headers });
    }

    // Capture the order
    const capRes = await fetch(`${base}/v2/checkout/orders/${order_id}/capture`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${tokJson.access_token}`,
        "Content-Type": "application/json",
      },
    });
    const capJson = await capRes.json();

    // PayPal returns 422 ORDER_ALREADY_CAPTURED if already captured — fetch order to read amount
    let orderData = capJson;
    const alreadyCaptured = !capRes.ok && (capJson?.details?.[0]?.issue === "ORDER_ALREADY_CAPTURED" || capJson?.name === "UNPROCESSABLE_ENTITY");

    if (alreadyCaptured) {
      const getRes = await fetch(`${base}/v2/checkout/orders/${order_id}`, {
        headers: { "Authorization": `Bearer ${tokJson.access_token}` },
      });
      orderData = await getRes.json();
      if (!getRes.ok) {
        console.error("PayPal get-order error:", orderData);
        return new Response(JSON.stringify({ error: "Could not fetch PayPal order" }), { status: 502, headers });
      }
    } else if (!capRes.ok) {
      console.error("PayPal capture error:", capJson);
      return new Response(JSON.stringify({ error: capJson?.message || "PayPal capture failed", details: capJson }), { status: 502, headers });
    }

    // Verify status COMPLETED and pull amount
    const status = orderData?.status;
    if (status !== "COMPLETED" && status !== "APPROVED") {
      return new Response(JSON.stringify({ error: `PayPal order status: ${status}` }), { status: 400, headers });
    }

    const pu = orderData?.purchase_units?.[0];
    const cap = pu?.payments?.captures?.[0];
    const amountStr = cap?.amount?.value || pu?.amount?.value;
    const currency = cap?.amount?.currency_code || pu?.amount?.currency_code;
    const captureId = cap?.id || null;
    const customId = pu?.payments?.captures?.[0]?.custom_id || pu?.custom_id;

    if (!amountStr) {
      return new Response(JSON.stringify({ error: "No capture amount in PayPal response" }), { status: 502, headers });
    }
    if (currency !== "USD") {
      return new Response(JSON.stringify({ error: `Unexpected currency: ${currency}` }), { status: 502, headers });
    }
    if (customId && customId !== userId) {
      console.error("PayPal custom_id mismatch", { customId, userId });
      return new Response(JSON.stringify({ error: "Order does not belong to caller" }), { status: 403, headers });
    }

    const amount = Number(amountStr);
    if (!Number.isFinite(amount) || amount <= 0) {
      return new Response(JSON.stringify({ error: "Invalid amount" }), { status: 502, headers });
    }

    // Re-check idempotency just before insert (race-safety on capture id)
    if (captureId) {
      const { data: dup } = await admin
        .from("wallet_transactions")
        .select("id")
        .contains("metadata", { gateway: "paypal", paypal_capture_id: captureId })
        .maybeSingle();
      if (dup) {
        return new Response(JSON.stringify({ success: true, already_credited: true, amount }), { headers });
      }
    }

    // Credit wallet via SECURITY DEFINER RPC (service role => auth.uid() is null => self-transaction allowed)
    const { error: rpcErr } = await admin.rpc("wallet_transaction", {
      _user_id: userId,
      _type: "deposit",
      _amount: amount,
      _description: `PayPal deposit — Order ${order_id}`,
      _reference_id: null,
      _reference_type: "deposit",
      _metadata: { gateway: "paypal", paypal_order_id: order_id, paypal_capture_id: captureId },
    });

    if (rpcErr) {
      console.error("wallet_transaction RPC error:", rpcErr);
      return new Response(JSON.stringify({ error: rpcErr.message }), { status: 500, headers });
    }

    // Phase 1A Step A — dry-run shadow (non-blocking, post-success only)
    await shadowApplyV2PP(admin, {
      op: "deposit_credit",
      user_id: userId,
      amount,
      idempotency_key: `paypal:${captureId ?? order_id}`,
      description: `PayPal deposit — Order ${order_id}`,
      reference_id: captureId ?? order_id,
    });

    return new Response(JSON.stringify({ success: true, amount, gateway: "PayPal" }), { headers });
  } catch (err) {
    console.error("paypal-capture-order error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message || "Internal error" }), { status: 500, headers });
  }
});
