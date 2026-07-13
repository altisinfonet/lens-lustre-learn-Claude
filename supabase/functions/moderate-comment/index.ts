import { createClient } from "https://esm.sh/@supabase/supabase-js@2.97.0";
import { getSecureHeaders } from "../_shared/secureHeaders.ts";

const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001";

// ── Rule-based moderation (runs before AI) ──

const PROFANITY_LIST = [
  "fuck", "shit", "ass", "bitch", "damn", "dick", "cock", "pussy", "bastard",
  "whore", "slut", "cunt", "fag", "nigger", "retard", "rape",
  "motherfucker", "asshole", "bullshit", "goddamn", "piss",
  "f u c k", "s h i t", "b i t c h", "f*ck", "sh*t", "b*tch", "a$$",
  "fck", "fuk", "stfu", "wtf", "lmfao",
];

const FUZZY_TARGETS = [
  "fuck", "shit", "bitch", "bastard", "asshole", "nigger", "cunt",
  "whore", "slut", "retard", "dick", "cock", "pussy", "rape",
  "idiot", "stupid",
];

const KNOWN_VARIANTS = [
  "bstrd", "busterd", "bastrd", "bastad", "bustard",
  "fuk", "fck", "phuck", "phuk", "fuxk", "fucc",
  "sht", "shiit", "shyt", "sh1t",
  "btch", "biatch", "beyatch", "b1tch",
  "azz", "a55", "azhole", "a55hole",
  "d1ck", "dik", "dicc",
  "cnt", "kunt",
  "rtard", "retrd",
  "niga", "nigg", "n1gger", "niggr",
  "wh0re", "h0e",
  "s1ut",
  "idi0t", "idot", "ideot",
  "stupd", "stup1d", "stoopid",
];

const URL_PATTERN = /(?:https?:\/\/|www\.|[a-z0-9-]+\.(com|org|net|io|co|me|info|biz|xyz|online|site|top|click|link|gq|ml|cf|ga|tk))/i;

const SPAM_PATTERNS = [
  /buy\s+now/i, /click\s+here/i,
  /free\s+(money|gift|card|iphone|bitcoin|crypto)/i,
  /earn\s+\$?\d+/i, /make\s+money/i, /limited\s+time\s+offer/i,
  /act\s+now/i, /congratulations.*won/i, /100%\s+free/i,
  /dm\s+me/i, /follow\s+me\s+@/i,
  /check\s+(my|out)\s+(bio|profile|link)/i,
  /whatsapp/i, /telegram/i,
];

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[@4]/g, "a")
    .replace(/[$5]/g, "s")
    .replace(/[3]/g, "e")
    .replace(/[1!|]/g, "i")
    .replace(/[0]/g, "o")
    .replace(/[^a-z]/g, "");
}

interface RuleResult {
  flagged: boolean;
  reason: string;
  category: string;
  method: string;
  matchedWord?: string;
}

function runRuleBasedModeration(text: string): RuleResult {
  const lower = text.toLowerCase().trim();

  // Keyword match (exact word boundary)
  for (const word of PROFANITY_LIST) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b${escaped}\\b`, "i");
    if (regex.test(lower)) {
      return { flagged: true, reason: "Inappropriate language", category: "profanity", method: "keyword", matchedWord: word };
    }
  }

  // Known variant match (short inputs only)
  const normalized = normalize(text);
  if (normalized.length <= 20) {
    for (const variant of KNOWN_VARIANTS) {
      if (normalized.includes(variant)) {
        return { flagged: true, reason: "Inappropriate language (obfuscated)", category: "profanity", method: "variant", matchedWord: variant };
      }
    }
  }

  // Fuzzy match (tokenized, length >= 5 targets only)
  const tokens = text.toLowerCase().split(/[^a-z]+/).filter(t => t.length >= 3);
  for (const token of tokens) {
    for (const word of FUZZY_TARGETS) {
      if (word.length < 5) continue;
      if (token === word) {
        return { flagged: true, reason: "Inappropriate language", category: "profanity", method: "fuzzy", matchedWord: word };
      }
      const tolerance = word.length <= 5 ? 1 : 2;
      if (Math.abs(token.length - word.length) > tolerance) continue;
      if (levenshtein(token, word) <= tolerance) {
        return { flagged: true, reason: `Misspelled abusive word (similar to "${word}")`, category: "profanity", method: "fuzzy", matchedWord: token };
      }
    }
  }

  // URL check
  if (URL_PATTERN.test(text)) {
    return { flagged: true, reason: "Contains URL", category: "spam", method: "url" };
  }

  // Spam patterns
  for (const pattern of SPAM_PATTERNS) {
    if (pattern.test(text)) {
      return { flagged: true, reason: "Spam pattern detected", category: "spam", method: "spam" };
    }
  }

  // Excessive caps
  if (lower.length > 10) {
    const upperCount = (text.match(/[A-Z]/g) || []).length;
    const letterCount = (text.match(/[a-zA-Z]/g) || []).length;
    if (letterCount > 0 && upperCount / letterCount > 0.7) {
      return { flagged: true, reason: "Excessive capital letters", category: "spam", method: "caps" };
    }
  }

  // Repetitive characters
  if (/(.)\1{5,}/i.test(text)) {
    return { flagged: true, reason: "Repetitive characters", category: "spam", method: "repetition" };
  }

  return { flagged: false, reason: "", category: "clean", method: "none" };
}

// ── Flag helper ──

async function flagComment(
  supabase: ReturnType<typeof createClient>,
  commentId: string,
  commentType: string,
  details: string,
  category: string,
) {
  // Flag image_comments directly (backward compat)
  if (commentType === "image_comment") {
    await supabase
      .from("image_comments")
      .update({ is_flagged: true, flag_reason: details })
      .eq("id", commentId);
  }

  // Insert into comment_reports — check duplicates
  const duplicateQuery = commentType === "post_comment"
    ? supabase.from("comment_reports").select("id").eq("post_comment_id", commentId).eq("source", "ai").limit(1)
    : supabase.from("comment_reports").select("id").eq("comment_id", commentId).eq("source", "ai").limit(1);

  const { data: existing } = await duplicateQuery;
  if (!existing || existing.length === 0) {
    const insertPayload: Record<string, unknown> = {
      reporter_id: SYSTEM_USER_ID,
      reason: "ai_flag",
      details,
      source: "ai",
      status: "pending",
    };
    if (commentType === "post_comment") {
      insertPayload.post_comment_id = commentId;
    } else {
      insertPayload.comment_id = commentId;
    }
    await supabase.from("comment_reports").insert(insertPayload);
  }

  console.log(`Comment ${commentId} (${commentType}) flagged: ${category}`);
}

// ── Main handler ──

Deno.serve(async (req) => {
  const headers = getSecureHeaders(req);

  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method === "TRACE") return new Response("Method Not Allowed", { status: 405, headers });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify caller identity from JWT
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (claimsError || !claimsData?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }

    const { comment_id, type } = await req.json();
    const commentType = type || "image_comment";

    if (!comment_id) {
      return new Response(JSON.stringify({ flagged: false }), { headers });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Fetch comment content + owner
    let content: string | null = null;
    let ownerId: string | null = null;

    if (commentType === "post_comment") {
      const { data: comment } = await supabase
        .from("post_comments").select("content, user_id").eq("id", comment_id).single();
      if (!comment) return new Response(JSON.stringify({ flagged: false }), { headers });
      content = comment.content;
      ownerId = comment.user_id;
    } else {
      const { data: comment } = await supabase
        .from("image_comments").select("content, user_id").eq("id", comment_id).single();
      if (!comment) return new Response(JSON.stringify({ flagged: false }), { headers });
      content = comment.content;
      ownerId = comment.user_id;
    }

    // ── Authorization: caller must be the comment owner OR an admin ──
    const callerId = claimsData.claims.sub as string;
    if (callerId !== ownerId) {
      const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: callerId, _role: "admin" });
      const { data: isSuper } = await supabase.rpc("has_role", { _user_id: callerId, _role: "super_admin" });
      if (!isAdmin && !isSuper) {
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers });
      }
    }

    // ── Layer 0: Admin keyword blocklist (DB-driven) ──
    const { data: blockedKeywords } = await supabase
      .from("blocked_keywords")
      .select("keyword, category, severity")
      .eq("is_active", true);

    if (blockedKeywords && blockedKeywords.length > 0) {
      const lowerContent = content!.toLowerCase();
      const normalizedContent = normalize(lowerContent);

      for (const bk of blockedKeywords) {
        const kw = bk.keyword.toLowerCase();
        const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(`\\b${escaped}\\b`, "i");

        if (regex.test(lowerContent) || normalizedContent.includes(normalize(kw))) {
          const details = `Blocklist (${bk.category}): matched "${bk.keyword}"`;

          if (bk.severity === "auto_hide") {
            // Auto-hide: delete the comment
            if (commentType === "post_comment") {
              await supabase.from("post_comments").delete().eq("id", comment_id);
            } else {
              await supabase.from("image_comments").delete().eq("id", comment_id);
            }
            console.log(`Comment ${comment_id} auto-hidden by blocklist: ${bk.keyword}`);
            return new Response(JSON.stringify({
              flagged: true,
              reason: "Comment blocked by content filter",
              category: bk.category,
              method: "blocklist",
              action: "auto_hide",
            }), { headers });
          } else {
            // Flag for review
            await flagComment(supabase, comment_id, commentType, details, bk.category);
            return new Response(JSON.stringify({
              flagged: true,
              reason: "Comment flagged for review",
              category: bk.category,
              method: "blocklist",
              action: "flag_review",
            }), { headers });
          }
        }
      }
    }

    // ── Layer 1: Rule-based moderation ──
    const ruleResult = runRuleBasedModeration(content!);
    if (ruleResult.flagged) {
      const details = `Rule (${ruleResult.method}): ${ruleResult.category} - ${ruleResult.reason}${ruleResult.matchedWord ? ` [${ruleResult.matchedWord}]` : ""}`;
      await flagComment(supabase, comment_id, commentType, details, ruleResult.category);
      return new Response(JSON.stringify({
        flagged: true,
        reason: ruleResult.reason,
        category: ruleResult.category,
        method: ruleResult.method,
      }), { headers });
    }

    // ── Layer 2: AI moderation (secondary) ──
    // Per-function key (own credit limit/tracking) → shared AI_API_KEY → legacy Lovable.
    const lovableApiKey = (Deno.env.get("MODERATION_AI_KEY") ?? Deno.env.get("AI_API_KEY") ?? Deno.env.get("LOVABLE_API_KEY"));
    if (!lovableApiKey) {
      console.log("No AI key configured, skipping AI moderation");
      return new Response(JSON.stringify({ flagged: false }), { headers });
    }

    const aiResponse = await fetch((Deno.env.get("AI_GATEWAY_URL") ?? "https://ai.gateway.lovable.dev/v1/chat/completions"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${lovableApiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          {
            role: "system",
            content: `You are a content moderation AI. Analyze the following comment and determine if it should be flagged. 
Flag for: nudity/sexual content references, hate speech, severe harassment, spam/advertising, phishing attempts, or threats.
Do NOT flag for: mild disagreements, opinions, constructive criticism, or casual language.
Respond with JSON only: {"flagged": true/false, "reason": "brief reason if flagged", "category": "nudity|hate|harassment|spam|threat|clean"}`
          },
          { role: "user", content: `Comment to moderate: "${content}"` }
        ],
        temperature: 0.1,
        max_tokens: 100,
      }),
    });

    if (!aiResponse.ok) {
      console.error("AI moderation failed:", await aiResponse.text());
      return new Response(JSON.stringify({ flagged: false }), { headers });
    }

    const aiData = await aiResponse.json();
    const aiText = aiData.choices?.[0]?.message?.content || "";

    let aiResult = { flagged: false, reason: "", category: "clean" };
    try {
      const cleaned = aiText.replace(/```json\n?/g, "").replace(/```/g, "").trim();
      aiResult = JSON.parse(cleaned);
    } catch {
      console.log("Could not parse AI response:", aiText);
    }

    if (aiResult.flagged) {
      const details = `AI: ${aiResult.category} - ${aiResult.reason}`;
      await flagComment(supabase, comment_id, commentType, details, aiResult.category);
    }

    return new Response(JSON.stringify({ ...aiResult, method: "ai" }), { headers });
  } catch (err: unknown) {
    console.error("Moderation error:", err);
    return new Response(
      JSON.stringify({ flagged: false, error: "Internal server error" }),
      { status: 500, headers }
    );
  }
});
