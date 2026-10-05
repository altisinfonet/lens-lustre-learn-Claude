import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { z } from "zod";
import { queryKeys } from "@/lib/queryKeys";
import { submit } from "@/lib/offline/outbox";

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

      // getSession reads the device; getUser would ask the server, and a report
      // made offline must still be accepted (OFF-5 §2 #15: QUEUED).
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error("You must be logged in to report content");

      // Already reported? Asked only when it can be answered; offline the
      // server-side key still stops a repeat of THIS report.
      const { data: existing, error: lookupError } = await supabase
        .from("reports")
        .select("id")
        .eq("reporter_id", user.id)
        .eq("target_type", parsed.target_type)
        .eq("target_id", parsed.target_id)
        .limit(1);

      if (!lookupError && existing && existing.length > 0) {
        throw new Error("You have already reported this content");
      }

      pendingTargets.add(dedupeKey);
      try {
        // OFF-2 · through the outbox, keyed once (UNIQUE (reporter_id, idempotency_key)).
        const r = await submit(user.id, {
          kind: "report",
          targetType: parsed.target_type,
          targetId: parsed.target_id,
          reason: parsed.reason,
        });
        return { queued: r.status === "queued" };
      } finally {
        pendingTargets.delete(dedupeKey);
      }
    },
    networkMode: "always",
    onSuccess: (res) => {
      toast.success(res?.queued ? "Report saved" : "Report submitted", {
        description: res?.queued
          ? "You're offline. It will be sent as soon as you're back online."
          : "Thank you. Our team will review this shortly.",
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.reports() });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to submit report");
    },
  });
}
