import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { z } from "zod";
import { queryKeys } from "@/lib/queryKeys";

const reportSchema = z.object({
  target_type: z.enum(["post", "user", "comment"]),
  target_id: z.string().uuid("Invalid target"),
  reason: z.string().trim().min(3, "Reason must be at least 3 characters").max(500, "Reason is too long"),
});

type ReportInput = z.infer<typeof reportSchema>;

// Track in-flight submissions to block spam clicks
const pendingTargets = new Set<string>();

export function useReportContent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: ReportInput) => {
      const parsed = reportSchema.parse(input);
      const dedupeKey = `${parsed.target_type}:${parsed.target_id}`;

      if (pendingTargets.has(dedupeKey)) {
        throw new Error("Report already being submitted");
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("You must be logged in to report content");

      // Check for existing report by same user on same target
      const { data: existing } = await supabase
        .from("reports")
        .select("id")
        .eq("reporter_id", user.id)
        .eq("target_type", parsed.target_type)
        .eq("target_id", parsed.target_id)
        .limit(1);

      if (existing && existing.length > 0) {
        throw new Error("You have already reported this content");
      }

      pendingTargets.add(dedupeKey);
      try {
        const { error } = await supabase.from("reports").insert({
          reporter_id: user.id,
          target_type: parsed.target_type,
          target_id: parsed.target_id,
          reason: parsed.reason,
        });
        if (error) throw error;
      } finally {
        pendingTargets.delete(dedupeKey);
      }
    },
    onSuccess: () => {
      toast.success("Report submitted", {
        description: "Thank you. Our team will review this shortly.",
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.reports() });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to submit report");
    },
  });
}
