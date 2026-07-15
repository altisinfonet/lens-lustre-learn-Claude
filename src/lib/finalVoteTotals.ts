import { supabase } from "@/integrations/supabase/client";

export interface FinalVoteTotalsResult {
  totals: Record<string, number>;
  perPhoto: Record<string, Record<string, number>>;
}

/**
 * BUG-031: vote totals previously flowed through the entry-final-votes edge
 * function, which 401s anonymous callers (the anon key carries no `sub`
 * claim) — and this helper swallowed the error into empty maps, so every
 * logged-out visitor saw "0 votes" on all public results. Totals now come
 * from the get_public_final_votes RPC: SECURITY DEFINER, anon-executable,
 * phase-gated server-side (NOT is_vote_phase_locked — visible exactly when
 * the vote-count RLS policy would show them), aggregate-only output.
 */
export async function fetchEntryFinalVotes(entryIds: string[]): Promise<FinalVoteTotalsResult> {
  const uniqueEntryIds = [...new Set(entryIds.filter(Boolean))];

  if (uniqueEntryIds.length === 0) {
    return { totals: {}, perPhoto: {} };
  }

  const { data, error } = await supabase.rpc("get_public_final_votes" as any, {
    _entry_ids: uniqueEntryIds,
  });

  if (error) {
    console.warn("get_public_final_votes failed; showing photos without vote tallies:", error);
    return { totals: {}, perPhoto: {} };
  }

  const rows = (data ?? []) as { entry_id: string; photo_index: number; final_votes: number }[];
  const totals: Record<string, number> = {};
  const perPhoto: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    totals[r.entry_id] = (totals[r.entry_id] ?? 0) + (r.final_votes ?? 0);
    (perPhoto[r.entry_id] ??= {})[String(r.photo_index ?? 0)] = r.final_votes ?? 0;
  }
  return { totals, perPhoto };
}
