/**
 * Comment admin service — handles deletion across both tables.
 */
import { supabase } from "@/integrations/supabase/client";

export const commentService = {
  /**
   * Delete a comment by trying post_comments first, then legacy comments.
   * Returns { success, table } or throws.
   */
  async deleteComment(commentId: string, adminId: string): Promise<{ success: boolean; table: string }> {
    // Try post_comments first (most common)
    const { error: pcErr, count: pcCount } = await supabase
      .from("post_comments")
      .delete({ count: "exact" })
      .eq("id", commentId);

    if (pcErr) throw new Error(pcErr.message);

    if (pcCount && pcCount > 0) {
      await supabase.from("db_audit_logs").insert({
        table_name: "post_comments",
        operation: "DELETE",
        row_id: commentId,
        old_data: { deleted_reason: "admin_moderation" },
        changed_by: adminId,
      });
      return { success: true, table: "post_comments" };
    }

    // Fallback to legacy comments table
    const { error, count } = await supabase
      .from("comments")
      .delete({ count: "exact" })
      .eq("id", commentId);

    if (error) throw new Error(error.message);

    if (count && count > 0) {
      await supabase.from("db_audit_logs").insert({
        table_name: "comments",
        operation: "DELETE",
        row_id: commentId,
        old_data: { deleted_reason: "admin_moderation" },
        changed_by: adminId,
      });
      return { success: true, table: "comments" };
    }

    return { success: false, table: "" };
  },
};
