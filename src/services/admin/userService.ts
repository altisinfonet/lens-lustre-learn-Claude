/**
 * User admin service — user-related queries for admin panel.
 */
import { supabase } from "@/integrations/supabase/client";

export const userService = {
  async getTotalUserCount(): Promise<number> {
    const { count } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true });
    return count ?? 0;
  },

  async getIndicatorCounts(): Promise<{ tickets: number; notifications: number }> {
    const [{ count: ticketCount }, { count: notifCount }] = await Promise.all([
      supabase
        .from("support_tickets")
        .select("id", { count: "exact", head: true })
        .in("status", ["open", "replied"]),
      supabase
        .from("admin_notifications")
        .select("id", { count: "exact", head: true })
        .eq("is_read", false),
    ]);

    return {
      tickets: ticketCount ?? 0,
      notifications: notifCount ?? 0,
    };
  },
};
