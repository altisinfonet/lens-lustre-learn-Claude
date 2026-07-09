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

  let page = 0;
  let pageSize = 50;
  try {
    const body = await req.json();
    page = typeof body.page === "number" ? Math.max(0, Math.floor(body.page)) : 0;
    pageSize = typeof body.pageSize === "number" ? Math.min(100, Math.max(1, Math.floor(body.pageSize))) : 50;
  } catch {
    // defaults are fine
  }

  const from = page * pageSize;
  const to = from + pageSize - 1;

  const { data, error } = await supabase
    .from("wallet_transactions")
    .select("id, type, amount, balance_after, description, reference_id, reference_type, status, created_at, metadata")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }

  return new Response(JSON.stringify(data ?? []), {
    status: 200,
    headers: { ...headers, "Content-Type": "application/json" },
  });
});
