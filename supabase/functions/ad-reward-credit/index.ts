/**
 * ad-reward-credit — server-verified rewarded-ad wallet credit.
 *
 * Two actions:
 *   { action: "start" }          → returns a signed token stamping the server
 *                                  start time (proves when the attention timer began).
 *   { action: "claim", token }   → verifies the token, enforces the minimum
 *                                  dwell + daily cap + cooldown, then credits.
 *
 * Money-safety guarantees (all server-side, from the immutable wallet ledger):
 *   • You cannot claim faster than `rewarded_attention_seconds` (token iat check).
 *   • You cannot earn more than `rewarded_max_per_day` per day.
 *   • You cannot earn twice within `rewarded_cooldown_minutes`.
 *   • If `rewarded_credit_amount` is 0 (default), NOTHING is ever credited.
 * Even a replayed token can never exceed the daily cap / cooldown, so the
 * maximum payout is bounded regardless of client behaviour. (Fully tamper-proof
 * verification, SSV, arrives with AdMob in Phase 2 — this is the honest Phase-1
 * guarantee.)
 *
 * Credits go through the existing admin_wallet_credit RPC via the service-role
 * client (auth.uid() IS NULL bypasses the admin check by design), which updates
 * the balance atomically — no direct ledger writes.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/* ── HMAC token (Web Crypto) ── */
const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer | string): string => {
  const bytes = typeof buf === "string" ? enc.encode(buf) : new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const b64urlToStr = (s: string): string => {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
};
async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function sign(payload: string, secret: string): Promise<string> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return b64url(sig);
}
async function makeToken(userId: string, secret: string): Promise<string> {
  const payload = b64url(JSON.stringify({ u: userId, t: Date.now() }));
  const sig = await sign(payload, secret);
  return `${payload}.${sig}`;
}
async function verifyToken(token: string, userId: string, secret: string): Promise<{ ok: boolean; iat?: number }> {
  const [payload, sig] = (token || "").split(".");
  if (!payload || !sig) return { ok: false };
  const expected = await sign(payload, secret);
  if (expected !== sig) return { ok: false };
  try {
    const data = JSON.parse(b64urlToStr(payload));
    if (data.u !== userId) return { ok: false };
    return { ok: true, iat: Number(data.t) };
  } catch {
    return { ok: false };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ ok: false, error: "unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const secret = Deno.env.get("AD_REWARD_SECRET");
    if (!secret) return json({ ok: false, error: "reward_not_configured" }, 400);

    // Authenticate the caller
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: ud, error: uErr } = await userClient.auth.getUser();
    if (uErr || !ud?.user?.id) return json({ ok: false, error: "invalid_token" }, 401);
    const userId = ud.user.id;

    const admin = createClient(url, serviceKey);

    // Load rewarded config from ad_frequency_v2
    const { data: freqRow } = await admin.from("site_settings").select("value").eq("key", "ad_frequency_v2").maybeSingle();
    const cfg = (freqRow?.value || {}) as Record<string, unknown>;
    const attentionSec = Number(cfg.rewarded_attention_seconds ?? 15);
    const amount = Number(cfg.rewarded_credit_amount ?? 0);
    const maxPerDay = Number(cfg.rewarded_max_per_day ?? 3);
    const cooldownMin = Number(cfg.rewarded_cooldown_minutes ?? 30);

    const body = await req.json().catch(() => ({}));
    const action = body?.action;

    if (action === "start") {
      if (!(amount > 0)) return json({ ok: false, error: "reward_not_configured" });
      const token = await makeToken(userId, secret);
      return json({ ok: true, token, attention_seconds: attentionSec });
    }

    if (action === "claim") {
      if (!(amount > 0)) return json({ ok: false, error: "reward_not_configured" });

      const v = await verifyToken(String(body?.token ?? ""), userId, secret);
      if (!v.ok || !v.iat) return json({ ok: false, error: "bad_token" }, 400);

      const ageMs = Date.now() - v.iat;
      // Must have waited at least the attention window (2s tolerance) …
      if (ageMs < attentionSec * 1000 - 2000) return json({ ok: false, error: "too_soon" }, 400);
      // … and not be an ancient token (10 min max) to shrink the replay window.
      if (ageMs > 10 * 60 * 1000) return json({ ok: false, error: "token_expired" }, 400);

      // Daily cap (from the immutable ledger)
      const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
      const { count: todayCount } = await admin
        .from("wallet_transactions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("reference_type", "ad_reward")
        .gte("created_at", startOfDay.toISOString());
      if ((todayCount ?? 0) >= maxPerDay) return json({ ok: false, error: "daily_cap_reached" });

      // Cooldown (last ad_reward must be older than cooldown)
      const { data: lastTx } = await admin
        .from("wallet_transactions")
        .select("created_at")
        .eq("user_id", userId)
        .eq("reference_type", "ad_reward")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastTx?.created_at) {
        const since = Date.now() - new Date(lastTx.created_at).getTime();
        if (since < cooldownMin * 60 * 1000) return json({ ok: false, error: "cooldown" });
      }

      // Credit via the audited RPC (service-role bypasses the admin check by design)
      const { data: txId, error: rpcErr } = await admin.rpc("admin_wallet_credit", {
        _admin_id: userId,           // ignored by the function
        _target_user_id: userId,
        _amount: amount,
        _type: "reward",
        _description: "Rewarded ad — attention credit",
        _reference_type: "ad_reward",
        _metadata: { source: "ad-reward-credit" },
      });
      if (rpcErr) return json({ ok: false, error: "credit_failed", detail: rpcErr.message }, 500);

      return json({ ok: true, credited: amount, tx_id: txId });
    }

    return json({ ok: false, error: "unknown_action" }, 400);
  } catch (e) {
    console.error("[ad-reward-credit]", e);
    return json({ ok: false, error: "server_error", detail: (e as Error)?.message ?? "unknown" }, 500);
  }
});
