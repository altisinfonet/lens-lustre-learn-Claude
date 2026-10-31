/**
 * Comments Module — extracted from AdminPanel.tsx
 */
import { useState, useCallback } from "react";
import { Trash2, MessageSquare, CheckSquare, Square } from "lucide-react";
import { useAdminComments } from "@/hooks/admin/useAdminComments";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { commentService } from "@/services/admin/commentService";
import { toast } from "@/hooks/core/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import { useConfirmAction } from "@/hooks/admin/useConfirmAction";
import type { User } from "@supabase/supabase-js";

const headingFont = { fontFamily: "var(--font-heading)" };

interface Props {
  user: User | null;
}

const CommentsModule = ({ user }: Props) => {
  const { comments: adminComments, isLoading, error } = useAdminComments();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const { confirm, dialogProps } = useConfirmAction();

  const toggleSelection = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (adminComments.every(c => selected.has(c.id))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(adminComments.map(c => c.id)));
    }
  };

  const deleteSingle = useCallback((commentId: string) => {
    if (!user) return;
    confirm({
      title: "Delete Comment",
      description: "This will permanently delete this comment and log the action. This cannot be undone.",
      confirmLabel: "Delete",
      variant: "destructive",
      onConfirm: async () => {
        const result = await commentService.deleteComment(commentId, user.id);
        if (result.success) {
          toast({ title: "Comment deleted" });
        } else {
          toast({ title: "Comment not found", description: "It may have already been deleted", variant: "destructive" });
        }
        queryClient.invalidateQueries({ queryKey: queryKeys.adminComments() });
        setSelected(prev => { const n = new Set(prev); n.delete(commentId); return n; });
      },
    });
  }, [user, confirm, queryClient]);

  const deleteBulk = useCallback(() => {
    if (!user || selected.size === 0) return;
    confirm({
      title: `Delete ${selected.size} Comment${selected.size > 1 ? "s" : ""}`,
      description: `Permanently delete ${selected.size} comment${selected.size > 1 ? "s" : ""}? This cannot be undone.`,
      confirmLabel: "Delete All",
      variant: "destructive",
      onConfirm: async () => {
        let successCount = 0;
        for (const id of selected) {
          try {
            const result = await commentService.deleteComment(id, user.id);
            if (result.success) successCount++;
          } catch { /* continue */ }
        }
        toast({ title: `${successCount} comment${successCount !== 1 ? "s" : ""} deleted` });
        setSelected(new Set());
        queryClient.invalidateQueries({ queryKey: queryKeys.adminComments() });
      },
    });
  }, [user, selected, confirm, queryClient]);

  if (error) {
    return <p className="text-sm text-destructive py-8 text-center">Failed to load comments: {error.message}</p>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground" style={headingFont}>
          {adminComments.length} comment{adminComments.length !== 1 ? "s" : ""} (latest 50)
        </span>
      </div>

      {adminComments.length > 0 ? (
        <>
          {/* Select all + bulk bar */}
          <div className="flex items-center gap-3 mb-3">
            <button
              onClick={toggleAll}
              className="inline-flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
              style={headingFont}
            >
              {adminComments.every(c => selected.has(c.id))
                ? <CheckSquare className="h-3.5 w-3.5 text-primary" />
                : <Square className="h-3.5 w-3.5" />}
              Select All
            </button>
          </div>

          {selected.size > 0 && (
            <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/50 border border-border rounded-sm mb-3">
              <span className="text-[10px] tracking-wider uppercase text-muted-foreground" style={headingFont}>
                {selected.size} selected
              </span>
              <button
                onClick={deleteBulk}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-[9px] uppercase tracking-wider border border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground rounded-sm transition-all"
                style={headingFont}
              >
                <Trash2 className="h-2.5 w-2.5" /> Delete Selected
              </button>
              <button
                onClick={() => setSelected(new Set())}
                className="text-[9px] text-muted-foreground hover:text-foreground transition-colors"
                style={headingFont}
              >
                Clear
              </button>
            </div>
          )}

          <div className="space-y-0 divide-y divide-border border border-border">
            {adminComments.map((c) => (
              <div key={c.id} className={`p-5 flex flex-col md:flex-row md:items-start gap-4 ${selected.has(c.id) ? "bg-primary/5" : ""}`}>
                <Checkbox
                  checked={selected.has(c.id)}
                  onCheckedChange={() => toggleSelection(c.id)}
                  className="shrink-0 mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1.5">
                    <span className="text-xs font-medium" style={headingFont}>
                      {c.profile_name || "Anonymous"}
                    </span>
                    {c.parent_id && (
                      <span className="text-[9px] tracking-[0.1em] uppercase text-muted-foreground px-1.5 py-0.5 border border-border" style={headingFont}>
                        Reply
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(c.created_at).toLocaleDateString()} {new Date(c.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <p className="text-sm text-foreground/85 leading-relaxed mb-1.5 line-clamp-3" style={{ fontFamily: "var(--font-body)" }}>
                    {c.content}
                  </p>
                  {c.context_title && (
                    <span className="text-[10px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
                      On: <em>{c.context_title}</em> ({c.article_id ? "Journal" : "Competition Entry"})
                    </span>
                  )}
                </div>
                <button onClick={() => deleteSingle(c.id)}
                  className="shrink-0 inline-flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase text-destructive hover:text-destructive/70 transition-colors"
                  style={headingFont}>
                  <Trash2 className="h-3 w-3" /> Delete
                </button>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="text-center py-16 border border-dashed border-border rounded">
          <MessageSquare className="h-10 w-10 text-muted-foreground/30 mx-auto mb-4" />
          <p className="text-sm text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>No comments yet.</p>
        </div>
      )}

      <ConfirmDialog {...dialogProps} />
    </div>
  );
};

export default CommentsModule;
