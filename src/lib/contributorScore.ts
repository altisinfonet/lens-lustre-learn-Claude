/**
 * The public Contributor Score, for the feed and the wall.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS BATCHED, NOT PER-CARD
 *
 * A feed screen renders twenty post cards, each wanting one member's score. The
 * naive shape is twenty requests before anything is on screen. This is the same
 * mistake the ad engagement bar shipped with on 2026-08-11 and had to be fixed
 * the same day — it promised "one round trip, not sixty-four" while every caller
 * passed a single id — so this reuses the fix rather than repeating the bug.
 *
 * Ids asked for inside the same microtask are collected and sent as ONE query.
 * React renders a screen's worth of cards synchronously, so they all land in the
 * same batch without adding a millisecond of delay to a lone request. Each
 * caller awaits its own answer and never knows this happened.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE SCORE IS
 *
 * Calculated live by get_contributor_scores() from the photographs and comments
 * that CURRENTLY exist — see supabase/migrations/20260811160000_top_contributors_v2.sql.
 * There is no stored score, so it rises with new work and falls when work is
 * deleted, and a member whose profile is gone simply stops being returned.
 *
 * The RPC returns NO ROW for an admin account, for a suspended, banned or
 * deleted account, and for a score of zero. Absent means "show nothing" — never
 * a bare "0" sitting beside somebody else's four figures.
 */
import { supabase } from "@/integrations/supabase/client";

/**
 * S11 · answers are kept for CACHE_MS (the app's 5-minute staleTime). The feed
 * window remounts cards while scrolling; without this every remount asked for
 * the same members again. "No score" is cached too (absent = show nothing).
 * A failed request caches nothing, so the next mount simply asks again.
 */
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { score: number | null; at: number }>();

/** Test seam: forget every cached answer. Not used by the app. */
export const __resetContributorScoreCache = () => { cache.clear(); pendingIds = []; pendingFlight = null; };

let pendingIds: string[] = [];
let pendingFlight: Promise<Map<string, number>> | null = null;

const runBatch = async (ids: string[]): Promise<Map<string, number>> => {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;

  const { data, error } = await supabase.rpc("get_contributor_scores" as any, {
    _user_ids: ids,
  } as any);

  // A signed-out visitor can execute this — the leaderboard is public — but a
  // network failure is not worth shouting about. The card renders without a
  // score rather than with an error, and nothing is cached.
  if (error || !Array.isArray(data)) return out;

  for (const row of data as any[]) {
    const n = Number(row.contributor_score);
    if (Number.isFinite(n) && n > 0) out.set(row.user_id, n);
  }
  const at = Date.now();
  for (const id of ids) cache.set(id, { score: out.get(id) ?? null, at });
  return out;
};

export const fetchContributorScores = async (
  userIds: string[],
): Promise<Map<string, number>> => {
  const ids = userIds.filter(Boolean);
  const out = new Map<string, number>();
  if (ids.length === 0) return out;

  const now = Date.now();
  const misses: string[] = [];
  for (const id of ids) {
    const c = cache.get(id);
    if (c && now - c.at < CACHE_MS) { if (c.score !== null) out.set(id, c.score); }
    else misses.push(id);
  }
  if (misses.length === 0) return out;

  for (const id of misses) if (!pendingIds.includes(id)) pendingIds.push(id);

  if (!pendingFlight) {
    pendingFlight = Promise.resolve().then(() => {
      const batch = pendingIds;
      pendingIds = [];
      pendingFlight = null;
      return runBatch(batch);
    });
  }
  const fetched = await pendingFlight;
  for (const id of misses) { const v = fetched.get(id); if (v !== undefined) out.set(id, v); }
  return out;
};

/** "5334" -> "5,334". One definition, so the feed and the wall never disagree. */
export const formatContributorScore = (n: number): string => n.toLocaleString();
