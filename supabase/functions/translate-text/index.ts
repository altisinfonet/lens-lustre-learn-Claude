import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LANG_NAMES: Record<string, string> = {
  en: "English",
  hi: "Hindi",
  bn: "Bengali",
  mr: "Marathi",
  gu: "Gujarati",
  ta: "Tamil",
  te: "Telugu",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Signed-in members only — keeps the endpoint from being an open relay.
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Sign in to translate" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { text, target } = await req.json();
    if (typeof text !== "string" || !text.trim()) {
      return new Response(JSON.stringify({ error: "Nothing to translate" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const targetName = LANG_NAMES[String(target)] ?? "English";
    const clipped = text.slice(0, 4000);

    const API_KEY =
      Deno.env.get("CHATBOT_AI_KEY") ?? Deno.env.get("AI_API_KEY") ?? Deno.env.get("LOVABLE_API_KEY");
    if (!API_KEY) throw new Error("AI API key is not configured");

    const resp = await fetch(
      Deno.env.get("AI_GATEWAY_URL") ?? "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-lite",
          messages: [
            {
              role: "system",
              content:
                `You are a translator. Translate the user's text into ${targetName}. ` +
                "Keep the tone, emoji, hashtags and @mentions exactly as they are. " +
                "Return ONLY the translated text — no quotes, no explanations.",
            },
            { role: "user", content: clipped },
          ],
          temperature: 0.2,
        }),
      },
    );
    if (!resp.ok) {
      const detail = await resp.text();
      console.error("[translate-text] gateway error", resp.status, detail.slice(0, 300));
      throw new Error("Translation service unavailable");
    }
    const data = await resp.json();
    const translated: string = data?.choices?.[0]?.message?.content?.trim() ?? "";
    if (!translated) throw new Error("Empty translation");

    return new Response(JSON.stringify({ translated }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[translate-text]", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
