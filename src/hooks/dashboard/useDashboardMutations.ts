import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/lib/queryKeys";
import { toast } from "@/hooks/core/use-toast";
import { getCaptchaToken } from "@/lib/turnstile";

interface ApplyRoleParams {
  userId: string;
  role: string;
  reason: string;
  portfolioUrl?: string | null;
  experience?: string | null;
}

export function useApplyForRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, role, reason, portfolioUrl, experience }: ApplyRoleParams) => {
      const { error } = await supabase.from("role_applications").insert({
        user_id: userId,
        requested_role: role as any,
        reason,
        portfolio_url: portfolioUrl || null,
        experience: experience || null,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      toast({ title: "Application submitted!" });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(variables.userId) });
    },
    onError: (error: any) => {
      toast({ title: "Application failed", description: error.message, variant: "destructive" });
    },
  });
}

export function usePasswordReset() {
  return useMutation({
    mutationFn: async (email: string) => {
      const captchaToken = await getCaptchaToken(); // BUG-043
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
        captchaToken,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Password reset email sent", description: "Check your inbox for the reset link." });
    },
    onError: (error: any) => {
      toast({ title: "Failed to send reset email", description: error.message, variant: "destructive" });
    },
  });
}
