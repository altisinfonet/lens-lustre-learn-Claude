import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getSecureHeaders } from "../_shared/secureHeaders.ts";

/**
 * PUBLIC endpoint that returns ONLY non-sensitive payment gateway info
 * needed by the user-side Wallet UI (enabled flags + public fields).
 *
 * Secret keys (stripe.secret_key, razorpay.key_secret, paypal.secret) are
 * NEVER returned. Those live server-side in `create-payment-session`.
 *
 * This is required because the `payment_gateways` row in `site_settings`
 * is RLS-blocked from non-admin users for security.
 */
Deno.serve(async (req) => {
  const headers = getSecureHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers });

  // SECURITY (payment_gateways_no_auth): require authenticated caller.
  // The only consumer (useWalletPageData) already gates on userId, so this
  // is non-breaking for the app while blocking anonymous scrapers from
  // reading platform bank account number + UPI ID.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
  try {
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }
  } catch {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }


  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await admin
      .from("site_settings")
      .select("value")
      .eq("key", "payment_gateways")
      .maybeSingle();

    if (error) throw error;

    const raw = (data?.value ?? {}) as Record<string, any>;

    // Whitelist: ONLY return non-secret fields
    const safe = {
      stripe: {
        enabled: !!raw.stripe?.enabled,
        publishable_key: raw.stripe?.publishable_key ?? "",
      },
      paypal: {
        enabled: !!raw.paypal?.enabled,
        client_id: raw.paypal?.client_id ?? "",
        mode: raw.paypal?.mode ?? "sandbox",
      },
      razorpay: {
        enabled: !!raw.razorpay?.enabled,
        key_id: raw.razorpay?.key_id ?? "",
      },
      upi: {
        enabled: !!raw.upi?.enabled,
        upi_id: raw.upi?.upi_id ?? "",
        merchant_name: raw.upi?.merchant_name ?? "",
      },
      bank: {
        enabled: !!raw.bank?.enabled,
        account_name: raw.bank?.account_name ?? "",
        account_number: raw.bank?.account_number ?? "",
        ifsc: raw.bank?.ifsc ?? "",
        bank_name: raw.bank?.bank_name ?? "",
      },
    };

    return new Response(JSON.stringify({ payment_gateways: safe }), {
      status: 200,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("get-payment-gateways-public error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
});
