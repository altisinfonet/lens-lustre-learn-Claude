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

  const [walletRes, depositsRes, withdrawalsRes] = await Promise.all([
    supabase.from("wallets").select("balance").eq("user_id", userId).maybeSingle(),
    supabase
      .from("wallet_transactions")
      .select("id, amount, status, created_at")
      .eq("user_id", userId)
      .eq("type", "deposit")
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
    supabase
      .from("withdrawal_requests")
      .select("id, amount, status, created_at")
      .eq("user_id", userId)
      .in("status", ["pending", "processing"])
      .order("created_at", { ascending: false }),
  ]);

  if (walletRes.error) {
    return new Response(JSON.stringify({ error: walletRes.error.message }), { status: 500, headers });
  }
  if (depositsRes.error) {
    return new Response(JSON.stringify({ error: depositsRes.error.message }), { status: 500, headers });
  }
  if (withdrawalsRes.error) {
    return new Response(JSON.stringify({ error: withdrawalsRes.error.message }), { status: 500, headers });
  }

  return new Response(
    JSON.stringify({
      balance: walletRes.data?.balance ?? 0,
      pendingDeposits: depositsRes.data ?? [],
      pendingWithdrawals: withdrawalsRes.data ?? [],
    }),
    { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
  );
});
