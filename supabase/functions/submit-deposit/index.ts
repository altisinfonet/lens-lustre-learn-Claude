import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSecureHeaders } from "../_shared/secureHeaders.ts";

Deno.serve(async (req) => {
  const headers = getSecureHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
  }

  // Anon client used ONLY for JWT validation (does not perform any writes).
  const authClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const token = authHeader.replace("Bearer ", "");
  const { data: claimsData, error: claimsError } = await authClient.auth.getClaims(token);
  if (claimsError || !claimsData?.claims) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
  }

  const userId = claimsData.claims.sub;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body" }), { status: 400, headers });
  }

  const { amountUSD, gateway, reference, metadata } = body;
  if (!amountUSD || !gateway || !reference) {
    return new Response(JSON.stringify({ error: "amountUSD, gateway, and reference are required" }), { status: 400, headers });
  }

  // Amount validation (mirrored server-side in RPC for defence in depth)
  const amount = Number(amountUSD);
  if (!Number.isFinite(amount) || amount < 1 || amount > 50000) {
    return new Response(JSON.stringify({ error: "Amount must be between $1 and $50,000" }), { status: 400, headers });
  }

  // Reference sanitization
  const safeRef = String(reference).trim().slice(0, 200);
  if (!safeRef) {
    return new Response(JSON.stringify({ error: "Valid reference is required" }), { status: 400, headers });
  }

  if (gateway !== "upi" && gateway !== "bank_transfer") {
    return new Response(JSON.stringify({ error: "Invalid gateway" }), { status: 400, headers });
  }

  const gatewayLabel = gateway === "upi" ? "UPI" : "Bank Transfer";

  // Service-role client for RLS-bypassing writes (gated by SECURITY DEFINER RPC + admin_notifications RLS).
  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  try {
    // Create pending deposit via SECURITY DEFINER RPC (HOTFIX-5).
    const { data: txnId, error: rpcError } = await serviceClient.rpc("create_pending_deposit", {
      _user_id: userId,
      _amount: amount,
      _gateway: gateway,
      _reference: safeRef,
      _metadata: metadata ?? {},
      _idempotency_key: null,
    });
    if (rpcError) throw rpcError;

    // Notify admin (service-role; admin_notifications RLS unchanged).
    await serviceClient.from("admin_notifications").insert({
      type: "deposit_request",
      title: `${gatewayLabel} Deposit Request`,
      message: `User submitted a ${gatewayLabel} deposit of $${amount.toFixed(2)}. Ref: ${safeRef}`,
      reference_id: userId,
    });

    return new Response(
      JSON.stringify({ success: true, gateway: gatewayLabel, transaction_id: txnId }),
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message ?? "Internal server error" }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
});
