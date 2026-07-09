/**
 * P4 Judge — Per-photo EXIF + RAW commitment timeline.
 * -----------------------------------------------------
 * Pulls every raw_commitments row for one (entry_id, photo_index) tuple,
 * ordered chronologically. RLS restricts visibility to the entry owner,
 * admins, and judges assigned to the competition (see migration
 * 20260419093000 lines 28-47), so no extra gating is needed client-side.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface RawCommitmentEvent {
  id: string;
  entry_id: string;
  photo_index: number;
  raw_required: boolean;
  source: "submit" | "admin_request" | "delivery" | "revoked";
  committed_at: string;
  raw_delivered_at: string | null;
  raw_file_url: string | null;
  admin_verified_at: string | null;
  admin_verified_by: string | null;
  notes: string | null;
}

export function usePhotoExifAudit(entryId: string | null | undefined, photoIndex: number | null | undefined) {
  return useQuery<RawCommitmentEvent[]>({
    queryKey: ["photo-exif-audit", entryId, photoIndex],
    enabled: !!entryId && photoIndex !== null && photoIndex !== undefined,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_commitments")
        .select("id, entry_id, photo_index, raw_required, source, committed_at, raw_delivered_at, raw_file_url, admin_verified_at, admin_verified_by, notes")
        .eq("entry_id", entryId as string)
        .eq("photo_index", photoIndex as number)
        .order("committed_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as RawCommitmentEvent[];
    },
    staleTime: 30_000,
  });
}
