import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { toast } from "@/hooks/core/use-toast";

interface OverrideParams {
  entryId: string;
  competitionId: string;
  status?: string;
  placement?: string | null;
  reason?: string;
}

export function useAdminEntryOverride() {
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ entryId, competitionId, status, placement, reason }: OverrideParams) => {
      if (!user) throw new Error("Not authenticated");

      const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (status !== undefined) update.status = status;
      if (placement !== undefined) update.placement = placement;

      const { error } = await supabase
        .from("competition_entries")
        .update(update)
        .eq("id", entryId);
      if (error) throw error;

      // Audit log
      await supabase.from("judge_activity_logs").insert({
        judge_id: user.id,
        entry_id: entryId,
        competition_id: competitionId,
        round_number: null,
        action_type: "admin_override",
        details: { status, placement, reason: reason || "Admin override" },
      } as any);
    },
    onSuccess: () => {
      toast({ title: "✅ Admin override applied" });
    },
    onError: (err: Error) => {
      toast({ title: "Override failed", description: err.message, variant: "destructive" });
    },
  });
}
