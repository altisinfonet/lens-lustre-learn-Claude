import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = claimsData.claims.sub;

    // Direct table query to avoid PostgREST overload ambiguity with has_role
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data: roleRow, error: roleError } = await serviceClient
      .from("user_roles")
      .select("id")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (roleError || !roleRow) {
      console.error("Role check failed:", roleError?.message || "not admin", { userId });
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { provider, api_key: rawApiKey } = await req.json();
    const api_key = typeof rawApiKey === 'string' ? rawApiKey.trim() : '';
    const hadWhitespace = typeof rawApiKey === 'string' && rawApiKey.length !== api_key.length;

    if (!api_key || !provider) {
      return new Response(JSON.stringify({ valid: false, message: "Missing provider or API key" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let valid = false;
    let message = "";
    let account = "";

    if (provider === "brevo") {
      if (!api_key.startsWith("xkeysib-")) {
        return new Response(JSON.stringify({
          valid: false,
          message: `This does not look like a Brevo v3 API key (expected prefix "xkeysib-", got "${api_key.slice(0, 9)}…"). Generate one at Brevo → SMTP & API → API Keys.`,
          meta: { length: api_key.length, prefix: api_key.slice(0, 9), trimmed_whitespace: hadWhitespace },
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const res = await fetch("https://api.brevo.com/v3/account", {
        headers: { "accept": "application/json", "api-key": api_key },
      });
      const text = await res.text();
      if (res.ok) {
        valid = true;
        try {
          const data = JSON.parse(text);
          account = data.email || data.companyName || "";
          message = `Connected${account ? ` — ${account}` : ""}${hadWhitespace ? " (whitespace trimmed)" : ""}`;
        } catch {
          message = "API key is valid";
        }
      } else {
        let brevoMsg = "";
        try { brevoMsg = JSON.parse(text).message || ""; } catch { brevoMsg = text.slice(0, 200); }
        message = `Brevo rejected the key (HTTP ${res.status}${brevoMsg ? ` — ${brevoMsg}` : ""}). Key length=${api_key.length}, prefix=${api_key.slice(0, 9)}.`;
      }
    } else if (provider === "resend") {
      const res = await fetch("https://api.resend.com/domains", {
        headers: { "Authorization": `Bearer ${api_key}` },
      });
      const text = await res.text();
      if (res.ok) {
        valid = true;
        try {
          const data = JSON.parse(text);
          const domains = data.data?.map((d: any) => d.name).join(", ") || "";
          message = `Connected${domains ? ` — Domains: ${domains}` : ""}`;
        } catch {
          message = "API key is valid";
        }
      } else {
        message = `Invalid API key (${res.status})`;
        try { message = JSON.parse(text).message || message; } catch {}
      }
    } else if (provider === "sendgrid") {
      const res = await fetch("https://api.sendgrid.com/v3/user/profile", {
        headers: { "Authorization": `Bearer ${api_key}` },
      });
      const text = await res.text();
      if (res.ok) {
        valid = true;
        try {
          const data = JSON.parse(text);
          account = data.username || "";
          message = `Connected${account ? ` — ${account}` : ""}`;
        } catch {
          message = "API key is valid";
        }
      } else {
        message = `Invalid API key (${res.status})`;
        try {
          const parsed = JSON.parse(text);
          message = parsed.errors?.[0]?.message || message;
        } catch {}
      }
    } else {
      message = "Unsupported provider";
    }

    return new Response(JSON.stringify({ valid, message, account }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Verify API key error:", err);
    return new Response(JSON.stringify({ valid: false, message: err.message || "Verification failed" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
