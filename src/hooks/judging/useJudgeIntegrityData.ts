/**
 * P4 Judge — Data hooks for RAW Submissions tab + Duplicate report.
 * -----------------------------------------------------------------
 * Both call SECURITY DEFINER RPCs that gate access to admins + assigned judges.
 * Any non-judge call returns "Permission denied" and we surface it as an error.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/* ─────────────── RAW commitments ─────────────── */
export interface RawCommitmentRow {
  entry_id: string;
  photo_index: number;
  user_id: string;
  entry_title: string;
  photo_url: string;
  thumbnail_url: string;
  photo_title: string | null;
  raw_required: boolean;
  exif_available: boolean;
  committed_at: string | null;
  source: string | null;
  raw_delivered_at: string | null;
  raw_file_url: string | null;
  admin_verified_at: string | null;
  admin_verified_by: string | null;
}

export function useCompetitionRawCommitments(competitionId: string | null | undefined) {
  return useQuery<RawCommitmentRow[]>({
    queryKey: ["competition-raw-commitments", competitionId],
    enabled: !!competitionId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_competition_raw_commitments" as any, {
        _competition_id: competitionId,
      });
      if (error) throw error;
      return (data ?? []) as RawCommitmentRow[];
    },
    staleTime: 30_000,
  });
}

/* ─────────────── Duplicate clusters ─────────────── */
export interface DuplicateClusterRow {
  cluster_key: string;
  match_type: "exact" | "similar";
  entry_id: string;
  photo_index: number;
  user_id: string;
  entry_title: string;
  photo_url: string;
  thumbnail_url: string;
  created_at: string;
  matched_against_entry: string;
  matched_against_photo: number;
  hamming_distance: number;
}

export function useCompetitionDuplicateClusters(competitionId: string | null | undefined) {
  return useQuery<DuplicateClusterRow[]>({
    queryKey: ["competition-duplicate-clusters", competitionId],
    enabled: !!competitionId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_competition_duplicate_clusters" as any, {
        _competition_id: competitionId,
      });
      if (error) throw error;
      return (data ?? []) as DuplicateClusterRow[];
    },
    staleTime: 30_000,
  });
}
