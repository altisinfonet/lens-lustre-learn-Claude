import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const CATEGORIES = [
  "Wildlife", "Street", "Portrait", "Aerial", "Documentary",
  "Landscape", "Architecture", "Macro", "Sports", "Fashion",
  "Underwater", "Astrophotography", "Food", "Travel", "Abstract",
  "Nature", "Urban", "Black & White", "Night", "General",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // --- Auth gate (PHASE-SEC-1) ---
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: jsonHeaders,
    });
  }
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: jsonHeaders,
      });
    }
  } catch {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: jsonHeaders,
    });
  }

  try {
    const { imageUrl } = await req.json();
    if (!imageUrl) {
      return new Response(JSON.stringify({ error: "imageUrl required" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    // Per-function key (own credit limit/tracking) → shared AI_API_KEY → legacy Lovable.
    const LOVABLE_API_KEY = (Deno.env.get("IMAGE_ANALYSIS_AI_KEY") ?? Deno.env.get("AI_API_KEY") ?? Deno.env.get("LOVABLE_API_KEY"));
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const response = await fetch((Deno.env.get("AI_GATEWAY_URL") ?? "https://ai.gateway.lovable.dev/v1/chat/completions"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          {
            role: "system",
            content: `You are an image analysis assistant. Given a photograph, suggest:
1. A short artistic title (3-6 words, creative/poetic, no quotes)
2. The best matching category from this list: ${CATEGORIES.join(", ")}
3. A brief description (1-2 sentences, describing what the image shows)

Respond ONLY with valid JSON: {"title": "...", "category": "...", "description": "..."}`,
          },
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: imageUrl } },
              { type: "text", text: "Analyze this photograph and suggest a title, category, and description." },
            ],
          },
        ],
        max_tokens: 200,
      }),
    });

    if (!response.ok) {
      const t = await response.text();
      console.error("AI error:", response.status, t);
      return new Response(
        JSON.stringify({ title: "Untitled", category: "General" }),
        { headers: jsonHeaders }
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const title = (parsed.title || "Untitled").slice(0, 60);
        const category = CATEGORIES.includes(parsed.category) ? parsed.category : "General";
        const description = (parsed.description || "").slice(0, 200);
        return new Response(
          JSON.stringify({ title, category, description }),
          { headers: jsonHeaders }
        );
      }
    } catch {
      // fallback
    }

    return new Response(
      JSON.stringify({ title: "Untitled", category: "General" }),
      { headers: jsonHeaders }
    );
  } catch (e: any) {
    console.error("analyze-gallery-image error:", e);
    return new Response(
      JSON.stringify({ title: "Untitled", category: "General" }),
      { headers: jsonHeaders }
    );
  }
});
