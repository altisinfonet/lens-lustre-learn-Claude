// One-shot diagnostic: tests the stored BREVO_API_KEY against Brevo's /v3/account.
// Admin-only. Returns Brevo's verbatim status + body so we know whether the
// stored key is the failing one or whether the issue is only with a freshly
// pasted key in the Admin UI.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } = await supabase.auth.getClaims(token);
    if (claimsErr || !claims?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claims.claims.sub;
    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: roleRow } = await service
      .from("user_roles")
      .select("id")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rawKey = Deno.env.get("BREVO_API_KEY") ?? "";
    const trimmedKey = rawKey.trim();

    const meta = {
      stored: !!rawKey,
      length_raw: rawKey.length,
      length_trimmed: trimmedKey.length,
      had_whitespace: rawKey.length !== trimmedKey.length,
      starts_with: trimmedKey.slice(0, 9),
      ends_with: trimmedKey.slice(-4),
      looks_like_v3_api_key: trimmedKey.startsWith("xkeysib-"),
    };

    if (!trimmedKey) {
      return new Response(
        JSON.stringify({ ok: false, stage: "env", meta, message: "BREVO_API_KEY secret is empty" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const res = await fetch("https://api.brevo.com/v3/account", {
      headers: { accept: "application/json", "api-key": trimmedKey },
    });
    const body = await res.text();
    let parsed: unknown = body;
    try { parsed = JSON.parse(body); } catch { /* keep raw */ }

    return new Response(
      JSON.stringify({
        ok: res.ok,
        stage: "brevo",
        meta,
        brevo_status: res.status,
        brevo_body: parsed,
      }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "unknown";
    return new Response(JSON.stringify({ ok: false, stage: "exception", message: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
