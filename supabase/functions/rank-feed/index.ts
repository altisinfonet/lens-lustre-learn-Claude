// @ts-nocheck — Deno edge function
import { getSecureHeaders } from "../_shared/secureHeaders.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

/**
 * Deterministic Feed Ranking Engine — Phase 3 (Secured + Cached)
 *
 * FIX 2: Server-side cache (60s TTL) using in-memory Map
 * FIX 3: JWT-validated, user_id from token
 */

// Simple in-memory cache (survives across requests in same isolate)
const feedCache = new Map<string, { ids: string[]; ts: number }>();
const CACHE_TTL_MS = 60_000; // 60 seconds

function getCached(userId: string): string[] | null {
  const entry = feedCache.get(userId);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    feedCache.delete(userId);
    return null;
  }
  return entry.ids;
}

function setCache(userId: string, ids: string[]) {
  // Cap cache size to prevent memory leaks
  if (feedCache.size > 5000) {
    const oldest = feedCache.keys().next().value;
    if (oldest) feedCache.delete(oldest);
  }
  feedCache.set(userId, { ids, ts: Date.now() });
}

Deno.serve(async (req) => {
  const secureHeaders = getSecureHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: secureHeaders });
  }

  try {
    // JWT Authentication
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", ranked_ids: [] }),
        { status: 401, headers: { ...secureHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await anonClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims?.sub) {
      return new Response(
        JSON.stringify({ error: "Invalid token", ranked_ids: [] }),
        { status: 401, headers: { ...secureHeaders, "Content-Type": "application/json" } },
      );
    }

    const user_id = claimsData.claims.sub;

    // FIX 2: Check server-side cache first
    const cached = getCached(user_id);
    if (cached) {
      return new Response(
        JSON.stringify({ ranked_ids: cached, cached: true }),
        { headers: { ...secureHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json();
    const posts = body?.posts;

    if (!Array.isArray(posts) || posts.length === 0) {
      return new Response(
        JSON.stringify({ ranked_ids: [] }),
        { headers: { ...secureHeaders, "Content-Type": "application/json" } },
      );
    }

    // Fetch user interaction history (last 30 days)
    let authorScores: Record<string, number> = {};
    try {
      const sb = createClient(supabaseUrl, supabaseServiceKey);
      const { data: events } = await sb
        .from("feed_events")
        .select("author_id, event_type")
        .eq("user_id", user_id)
        .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .limit(500);

      if (events && events.length > 0) {
        const weights: Record<string, number> = {
          like: 3, comment: 4, share: 5, click: 2, view: 1, skip: -1,
        };
        for (const e of events) {
          const w = weights[e.event_type] || 0;
          authorScores[e.author_id] = (authorScores[e.author_id] || 0) + w;
        }
      }
    } catch (e) {
      console.error("Failed to fetch interaction history:", e);
    }

    // Stage 1: Deterministic scoring
    const now = Date.now();
    const scored = posts.map((post: any) => {
      const ageMs = now - new Date(post.created_at).getTime();
      const ageHours = ageMs / (1000 * 60 * 60);
      const recency = Math.exp(-0.0289 * ageHours) * 100;
      const rawEngagement = (post.like_count || 0) * 1.0 + (post.comment_count || 0) * 2.0;
      const engagement = Math.min(Math.log2(1 + rawEngagement) * 15, 100);
      const authorId = post.author_id || post.user_id || "";
      const rawInteraction = post.author_interaction_count || 0;
      const historyBoost = authorScores[authorId] || 0;
      const userInteraction = Math.min((rawInteraction * 12) + (historyBoost * 5), 100);
      const contentTypeMatch = post.has_image ? 80 : 30;
      const networkBoost = post.is_from_network ? 100 : 20;
      const freshness = ageHours < 2 ? 100 : ageHours < 6 ? 60 : ageHours < 12 ? 30 : 0;

      const score =
        recency * 0.30 + engagement * 0.25 + userInteraction * 0.20 +
        contentTypeMatch * 0.10 + networkBoost * 0.10 + freshness * 0.05;

      return { id: post.id, author_id: authorId, score };
    });

    scored.sort((a: any, b: any) => b.score - a.score);

    // Phase 11: Deterministic-first response. Apply diversity, return immediately,
    // then run AI rerank in background and overwrite cache for next request.
    const deterministicDiversified = applyDiversityRules(scored);
    const deterministicIds = deterministicDiversified.map((p: any) => p.id);
    setCache(user_id, deterministicIds);

    const LOVABLE_API_KEY = (Deno.env.get("AI_API_KEY") ?? Deno.env.get("LOVABLE_API_KEY"));
    if (LOVABLE_API_KEY && scored.length > 5) {
      const backgroundRerank = (async () => {
        try {
          const top30 = scored.slice(0, 30);
          const aiOrder = await aiRerank(top30, LOVABLE_API_KEY);
          if (aiOrder.length === 0) return;
          const ruleMap = new Map(top30.map((p: any, i: number) => [p.id, i]));
          const aiMap = new Map(aiOrder.map((id: string, i: number) => [id, i]));
          const blended = [...top30].sort((a: any, b: any) => {
            const aB = (ruleMap.get(a.id) ?? 999) * 0.9 + (aiMap.get(a.id) ?? 999) * 0.1;
            const bB = (ruleMap.get(b.id) ?? 999) * 0.9 + (aiMap.get(b.id) ?? 999) * 0.1;
            return aB - bB;
          });
          const merged = [...scored];
          merged.splice(0, 30, ...blended);
          const finalIds = applyDiversityRules(merged).map((p: any) => p.id);
          setCache(user_id, finalIds);
        } catch (e) {
          console.error("AI rerank background failed (ignored):", e);
        }
      })();
      // Use EdgeRuntime.waitUntil if available; otherwise fire-and-forget.
      // deno-lint-ignore no-explicit-any
      const runtime = (globalThis as any).EdgeRuntime;
      if (runtime?.waitUntil) {
        runtime.waitUntil(backgroundRerank);
      } else {
        backgroundRerank.catch(() => {});
      }
    }

    return new Response(
      JSON.stringify({ ranked_ids: deterministicIds, cached: false, ai_pending: !!LOVABLE_API_KEY }),
      { headers: { ...secureHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Feed ranking error:", err);
    return new Response(
      JSON.stringify({ error: "Internal error", ranked_ids: [] }),
      { status: 500, headers: { ...secureHeaders, "Content-Type": "application/json" } },
    );
  }
});

async function aiRerank(
  candidates: { id: string; score: number }[], apiKey: string,
): Promise<string[]> {
  const prompt = `Re-order these ${candidates.length} social feed posts for better diversity and discovery. Return ONLY a JSON array of post IDs.\n\nPosts (id | score):\n${candidates.map((c, i) => `${i + 1}. ${c.id} | score: ${Math.round(c.score)}`).join("\n")}`;

  const res = await fetch((Deno.env.get("AI_GATEWAY_URL") ?? "https://ai.gateway.lovable.dev/v1/chat/completions"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: "You are a feed diversity optimizer. Return only a valid JSON array of post IDs in optimized order. No explanation." },
        { role: "user", content: prompt },
      ],
      temperature: 0.2, max_tokens: 2000,
    }),
  });

  if (!res.ok) {
    if (res.status === 429 || res.status === 402) return [];
    throw new Error(`AI API error: ${res.status}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || "";
  try {
    const match = content.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const ids = JSON.parse(match[0]);
    if (!Array.isArray(ids)) return [];
    const validIds = new Set(candidates.map((c) => c.id));
    return ids.filter((id: string) => validIds.has(id));
  } catch { return []; }
}

function applyDiversityRules(
  posts: { id: string; author_id: string; score: number }[],
): typeof posts {
  if (posts.length <= 1) return posts;
  const result: typeof posts = [];
  const deferred: typeof posts = [];
  const authorCountInTop10: Record<string, number> = {};

  for (const post of posts) {
    const position = result.length;
    const lastAuthor = result.length > 0 ? result[result.length - 1].author_id : null;
    const isBackToBack = post.author_id === lastAuthor;
    const authorCount = authorCountInTop10[post.author_id] || 0;
    const exceedsTop10Limit = position < 10 && authorCount >= 2;

    if (isBackToBack || exceedsTop10Limit) {
      deferred.push(post);
    } else {
      result.push(post);
      if (position < 10) authorCountInTop10[post.author_id] = authorCount + 1;
    }
  }

  for (const post of deferred) {
    let inserted = false;
    for (let i = 1; i < result.length; i++) {
      if (post.author_id !== result[i - 1].author_id && post.author_id !== result[i].author_id) {
        result.splice(i, 0, post);
        inserted = true;
        break;
      }
    }
    if (!inserted) result.push(post);
  }

  return result;
}
