import { supabase } from "@/integrations/supabase/client";

export interface FinalVoteTotalsResult {
  totals: Record<string, number>;
  perPhoto: Record<string, Record<string, number>>;
}

export async function fetchEntryFinalVotes(entryIds: string[]): Promise<FinalVoteTotalsResult> {
  const uniqueEntryIds = [...new Set(entryIds.filter(Boolean))];

  if (uniqueEntryIds.length === 0) {
    return { totals: {}, perPhoto: {} };
  }

  const { data, error } = await supabase.functions.invoke("entry-final-votes", {
    body: { entry_ids: uniqueEntryIds },
  });

  if (error) {
    console.warn("entry-final-votes failed; showing photos without vote tallies:", error);
    return { totals: {}, perPhoto: {} };
  }

  const payload = (data ?? {}) as {
    totals?: Record<string, number>;
    per_photo?: Record<string, Record<string, number>>;
  };

  return {
    totals: payload.totals ?? {},
    perPhoto: payload.per_photo ?? {},
  };
}