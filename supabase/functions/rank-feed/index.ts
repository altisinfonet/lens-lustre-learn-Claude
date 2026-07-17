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

    // BUG-061: read the submitted candidate set FIRST so the cache can be
    // reconciled against it. Returning the cache before reading body.posts hid a
    // just-posted item (not in the 60s-old cache) until the TTL expired.
    const body = await req.json();
    const posts = body?.posts;

    if (!Array.isArray(posts) || posts.length === 0) {
      return new Response(
        JSON.stringify({ ranked_ids: [] }),
        { headers: { ...secureHeaders, "Content-Type": "application/json" } },
      );
    }

    // FIX 2: server-side cache (60s TTL) — but MERGE it against the current
    // candidate set instead of returning it blindly: keep the cached ranking for
    // ids still present, drop stale ids, and surface any NEW candidate ids
    // (e.g. the user's just-posted item) at the top rather than hiding them.
    const cached = getCached(user_id);
    if (cached) {
      const rank = new Map<string, number>(cached.map((id, i) => [id, i]));
      const mergedIds = posts
        .map((p: any, i: number) => ({ id: p.id, i, r: rank.has(p.id) ? (rank.get(p.id) as number) : -1 }))
        .sort((a: any, b: any) => a.r - b.r || a.i - b.i)
        .map((x: any) => x.id);
      return new Response(
        JSON.stringify({ ranked_ids: mergedIds, cached: true }),
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

    // AI rerank removed (cost control): the deterministic EdgeRank order above
    // (affinity + weight + time-decay + diversity) is now the final feed order.
    // No external AI calls are made from this function.
    return new Response(
      JSON.stringify({ ranked_ids: deterministicIds, cached: false, ai_pending: false }),
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
