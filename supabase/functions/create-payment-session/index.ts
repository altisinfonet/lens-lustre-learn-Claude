import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSecureHeaders } from "../_shared/secureHeaders.ts";

Deno.serve(async (req) => {
  const headers = getSecureHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  try {
    // Authenticate
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }
    const userId = claimsData.claims.sub;

    // Parse request
    const { amount, currency, gateway } = await req.json();

    if (!amount || amount <= 0) {
      return new Response(JSON.stringify({ error: "Invalid amount" }), { status: 400, headers });
    }
    if (!["stripe", "razorpay", "paypal"].includes(gateway)) {
      return new Response(JSON.stringify({ error: "Invalid gateway" }), { status: 400, headers });
    }

    // Fetch gateway config from site_settings using service role
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: settingsData } = await adminClient
      .from("site_settings")
      .select("value")
      .eq("key", "payment_gateways")
      .maybeSingle();

    if (!settingsData?.value) {
      return new Response(JSON.stringify({ error: "Payment gateways not configured" }), { status: 400, headers });
    }

    const config = (settingsData.value as Record<string, any>)[gateway];
    if (!config?.enabled) {
      return new Response(JSON.stringify({ error: `${gateway} is not enabled` }), { status: 400, headers });
    }

    const amountUSD = currency === "inr" ? amount : amount; // amount should already be in USD from frontend
    // SECURITY: allowlist return origins to prevent open-redirect via attacker-controlled `Origin` header.
    const ALLOWED_ORIGINS = new Set([
      "https://50mmretina.com",
      "https://www.50mmretina.com",
      "https://fiftymmretinaworld.lovable.app",
    ]);
    const requestOrigin = req.headers.get("Origin") ?? "";
    const origin = ALLOWED_ORIGINS.has(requestOrigin) ? requestOrigin : "https://50mmretina.com";
    const returnUrl = `${origin}/wallet?payment=success`;
    const cancelUrl = `${origin}/wallet?payment=cancelled`;

    // === STRIPE ===
    if (gateway === "stripe") {
      if (!config.secret_key) {
        return new Response(JSON.stringify({ error: "Stripe secret key not configured" }), { status: 400, headers });
      }

      const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${config.secret_key}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          "mode": "payment",
          "success_url": returnUrl,
          "cancel_url": cancelUrl,
          "line_items[0][price_data][currency]": "usd",
          "line_items[0][price_data][product_data][name]": "Wallet Top-up",
          "line_items[0][price_data][unit_amount]": String(Math.round(amountUSD * 100)),
          "line_items[0][quantity]": "1",
          "metadata[user_id]": userId,
          "metadata[amount_usd]": String(amountUSD),
          "client_reference_id": userId,
        }),
      });

      const session = await stripeResponse.json();

      if (!stripeResponse.ok) {
        console.error("Stripe error:", session);
        return new Response(JSON.stringify({ error: session.error?.message || "Stripe session creation failed" }), { status: 400, headers });
      }

      return new Response(JSON.stringify({
        gateway: "stripe",
        session_id: session.id,
        url: session.url,
      }), { headers });
    }

    // === RAZORPAY ===
    if (gateway === "razorpay") {
      if (!config.key_id || !config.key_secret) {
        return new Response(JSON.stringify({ error: "Razorpay keys not configured" }), { status: 400, headers });
      }

      // Razorpay expects amount in paise (INR smallest unit)
      // Fetch exchange rate
      const { data: rateData } = await adminClient
        .from("site_settings")
        .select("value")
        .eq("key", "usd_to_inr_rate")
        .maybeSingle();

      const rate = (rateData?.value as any)?.rate || 83.5;
      const amountINR = Math.round(amountUSD * rate * 100); // paise

      const razorpayAuth = btoa(`${config.key_id}:${config.key_secret}`);
      const orderResponse = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: {
          "Authorization": `Basic ${razorpayAuth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: amountINR,
          currency: "INR",
          receipt: `wallet_${userId.substring(0, 8)}_${Date.now()}`,
          notes: {
            user_id: userId,
            amount_usd: String(amountUSD),
          },
        }),
      });

      const order = await orderResponse.json();

      if (!orderResponse.ok) {
        console.error("Razorpay error:", order);
        return new Response(JSON.stringify({ error: order.error?.description || "Razorpay order creation failed" }), { status: 400, headers });
      }

      return new Response(JSON.stringify({
        gateway: "razorpay",
        order_id: order.id,
        amount: order.amount,
        currency: order.currency,
        key_id: config.key_id, // publishable key is safe to send
      }), { headers });
    }

    // === PAYPAL ===
    if (gateway === "paypal") {
      if (!config.client_id || !config.secret) {
        return new Response(JSON.stringify({ error: "PayPal credentials not configured" }), { status: 400, headers });
      }

      const paypalBase = config.mode === "live"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com";

      // Get access token
      const tokenResponse = await fetch(`${paypalBase}/v1/oauth2/token`, {
        method: "POST",
        headers: {
          "Authorization": `Basic ${btoa(`${config.client_id}:${config.secret}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      });

      const tokenData = await tokenResponse.json();
      if (!tokenResponse.ok) {
        console.error("PayPal token error:", tokenData);
        return new Response(JSON.stringify({ error: "PayPal authentication failed" }), { status: 400, headers });
      }

      // Create order
      const orderResponse = await fetch(`${paypalBase}/v2/checkout/orders`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${tokenData.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          intent: "CAPTURE",
          purchase_units: [{
            amount: {
              currency_code: "USD",
              value: amountUSD.toFixed(2),
            },
            description: "Wallet Top-up",
            custom_id: userId,
          }],
          application_context: {
            return_url: returnUrl,
            cancel_url: cancelUrl,
            brand_name: "50mm Retina World",
            user_action: "PAY_NOW",
          },
        }),
      });

      const order = await orderResponse.json();
      if (!orderResponse.ok) {
        console.error("PayPal order error:", order);
        return new Response(JSON.stringify({ error: "PayPal order creation failed" }), { status: 400, headers });
      }

      const approveLink = order.links?.find((l: any) => l.rel === "approve")?.href;

      return new Response(JSON.stringify({
        gateway: "paypal",
        order_id: order.id,
        url: approveLink,
      }), { headers });
    }

    return new Response(JSON.stringify({ error: "Unsupported gateway" }), { status: 400, headers });

  } catch (err) {
    console.error("create-payment-session error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
});
