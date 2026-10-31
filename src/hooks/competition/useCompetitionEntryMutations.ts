import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { toast } from "@/hooks/core/use-toast";

/* ── Submit competition entry (atomic: wallet debit + entry insert + order in one txn) ── */

export function useSubmitCompetitionEntry() {
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (entry: {
      competition_id: string;
      title: string;
      description?: string | null;
      photos: string[];
      photo_thumbnails?: string[];
      photo_meta: any[];
      is_ai_generated?: boolean;
      exif_data?: any;
    }) => {
      if (!user) throw new Error("Not authenticated");

      const n = entry.photos?.length ?? 0;
      if (n === 0) throw new Error("At least one photo is required.");
      if (!Array.isArray(entry.photo_meta) || entry.photo_meta.length !== n) {
        throw new Error(`photo_meta length (${entry.photo_meta?.length ?? 0}) must match photos length (${n}).`);
      }
      if (entry.photo_thumbnails && entry.photo_thumbnails.length !== n) {
        throw new Error(`photo_thumbnails length (${entry.photo_thumbnails.length}) must match photos length (${n}).`);
      }

      // Atomic RPC — handles wallet lock, balance check, debit (correct reference_type),
      // entry insert, and order record in a single transaction.
      const { data, error } = await supabase.rpc("submit_competition_entry" as any, {
        _competition_id: entry.competition_id,
        _title: entry.title,
        _description: entry.description ?? null,
        _photos: entry.photos,
        _photo_thumbnails: entry.photo_thumbnails ?? null,
        _photo_meta: entry.photo_meta as any,
        _is_ai_generated: entry.is_ai_generated ?? false,
        _exif_data: (entry.exif_data ?? null) as any,
      });
      if (error) throw error;
      return data as { entry_id: string; order_id: string; order_no: string; wallet_txn_id: string | null; amount: number };
    },
    onError: (err: Error) => {
      toast({ title: "Submission failed", description: err.message, variant: "destructive" });
    },
  });
}

/* ── Update entry status (admin) ── */

export function useUpdateEntryStatus() {
  return useMutation({
    mutationFn: async ({ entryId, status }: { entryId: string; status: string }) => {
      const { error } = await supabase
        .from("competition_entries")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", entryId);
      if (error) throw error;
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });
}

/* ── Update entry placement (judge) ── */

export function useUpdateEntryPlacement() {
  return useMutation({
    mutationFn: async ({ entryId, placement, status }: { entryId: string; placement: string | null; status: string }) => {
      const { error } = await supabase
        .from("competition_entries")
        .update({ placement, status })
        .eq("id", entryId);
      if (error) throw error;
    },
    onError: (err: Error) => {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    },
  });
}

/* ── Admin vote adjustment (auditable, additive) ── */

export function useAddVoteAdjustment() {
  return useMutation({
    mutationFn: async ({
      entryId,
      competitionId,
      adjustmentValue,
      reason,
      adminId,
    }: {
      entryId: string;
      competitionId: string;
      adjustmentValue: number;
      reason?: string;
      adminId: string;
    }) => {
      if (adjustmentValue === 0) throw new Error("Adjustment value cannot be zero");
      const { error } = await supabase
        .from("admin_vote_adjustments" as any)
        .insert({
          entry_id: entryId,
          competition_id: competitionId,
          admin_id: adminId,
          adjustment_value: adjustmentValue,
          reason: reason || null,
        } as any);
      if (error) throw error;
    },
    onError: (err: Error) => {
      toast({ title: "Failed to add vote adjustment", description: err.message, variant: "destructive" });
    },
  });
}

/* ── Owner edit entry (in-window only; RLS enforces phase + ends_at gate) ── */

export function useUpdateCompetitionEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      entryId: string;
      patch: {
        title?: string;
        description?: string | null;
        photos?: string[];
        photo_thumbnails?: string[];
        photo_meta?: any[];
        exif_data?: any;
      };
    }) => {
      const { error } = await supabase
        .from("competition_entries")
        .update({ ...args.patch, updated_at: new Date().toISOString() })
        .eq("id", args.entryId);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["competition-entry", vars.entryId] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast({ title: "Entry updated" });
    },
    onError: (err: Error) =>
      toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });
}
