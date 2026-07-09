import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, Check, Trash2, Ban, MessageSquare, Loader2, XCircle, Eye, ExternalLink, CheckSquare, Square } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cachedFetchProfilesByIds } from "@/lib/profileBatch";
import { toast } from "@/hooks/core/use-toast";
import { Link } from "react-router-dom";
import { Checkbox } from "@/components/ui/checkbox";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import { useConfirmAction } from "@/hooks/admin/useConfirmAction";
import type { User } from "@supabase/supabase-js";

const headingFont = { fontFamily: "var(--font-heading)" };

interface Props {
  user: User | null;
}

interface Report {
  id: string;
  comment_id: string | null;
  post_comment_id: string | null;
  reporter_id: string;
  reason: string;
  details: string | null;
  status: string;
  admin_action: string | null;
  created_at: string;
  comment_content: string | null;
  comment_user_id: string | null;
  comment_user_name: string | null;
  reporter_name: string | null;
  is_flagged: boolean;
  flag_reason: string | null;
  source_type: "image_comment" | "post_comment";
  effective_comment_id: string;
  context_title: string | null;
  context_link: string | null;
  source: string;
}

interface FlaggedComment {
  id: string;
  content: string;
  flag_reason: string | null;
  user_id: string;
  image_type: string;
  image_id: string;
  created_at: string;
  user_name: string | null;
  context_title: string | null;
  context_link: string | null;
}

const AdminCommentReports = ({ user }: Props) => {
  const [reports, setReports] = useState<Report[]>([]);
  const [flagged, setFlagged] = useState<FlaggedComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"reports" | "flagged" | "ai_flagged">("reports");
  const [processing, setProcessing] = useState<string | null>(null);

  // Selection state
  const [selectedReports, setSelectedReports] = useState<Set<string>>(new Set());
  const [selectedFlagged, setSelectedFlagged] = useState<Set<string>>(new Set());
  const { confirm, dialogProps } = useConfirmAction();

  // Clear selection on tab change
  useEffect(() => {
    setSelectedReports(new Set());
    setSelectedFlagged(new Set());
  }, [tab]);

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    const [reportsRes, flaggedRes] = await Promise.all([
      supabase.from("comment_reports").select("*").order("created_at", { ascending: false }).limit(50),
      supabase.from("image_comments").select("id, content, flag_reason, user_id, image_type, image_id, created_at").eq("is_flagged", true).order("created_at", { ascending: false }).limit(50),
    ]);

    let enrichedReports: Report[] = [];
    if (reportsRes.data && reportsRes.data.length > 0) {
      const imageCommentIds = [...new Set(reportsRes.data.filter(r => r.comment_id).map(r => r.comment_id!))] as string[];
      const postCommentIds = [...new Set(reportsRes.data.filter(r => r.post_comment_id).map(r => r.post_comment_id!))] as string[];
      const reporterIds = [...new Set(reportsRes.data.map(r => r.reporter_id))];

      const [imageCommentsRes, postCommentsRes] = await Promise.all([
        imageCommentIds.length > 0
          ? supabase.from("image_comments").select("id, content, user_id, is_flagged, flag_reason, image_type, image_id").in("id", imageCommentIds)
          : { data: [] },
        postCommentIds.length > 0
          ? supabase.from("post_comments").select("id, content, user_id, post_id").in("id", postCommentIds)
          : { data: [] },
      ]);

      const imageCommentMap = new Map((imageCommentsRes.data || []).map((c: any) => [c.id, c]));
      const postCommentMap = new Map((postCommentsRes.data || []).map((c: any) => [c.id, c]));

      const postIds = [...new Set((postCommentsRes.data || []).map((c: any) => c.post_id).filter(Boolean))] as string[];
      const postContextMap = new Map<string, { content: string; user_id: string }>();
      if (postIds.length > 0) {
        const { data: postsData } = await supabase.from("posts").select("id, content, user_id").in("id", postIds);
        (postsData || []).forEach((p: any) => postContextMap.set(p.id, p));
      }

      const entryImageIds = [...new Set(
        (imageCommentsRes.data || [])
          .filter((c: any) => c.image_type === "entry")
          .map((c: any) => c.image_id)
      )] as string[];
      const entryContextMap = new Map<string, { title: string; competition_id: string }>();
      const competitionTitleMap = new Map<string, string>();
      if (entryImageIds.length > 0) {
        const { data: entriesData } = await supabase.from("competition_entries").select("id, title, competition_id").in("id", entryImageIds);
        (entriesData || []).forEach((e: any) => entryContextMap.set(e.id, e));
        const compIds = [...new Set((entriesData || []).map((e: any) => e.competition_id))] as string[];
        if (compIds.length > 0) {
          const { data: compsData } = await supabase.from("competitions").select("id, title").in("id", compIds);
          (compsData || []).forEach((c: any) => competitionTitleMap.set(c.id, c.title));
        }
      }

      const postAuthorIds = [...postContextMap.values()].map(p => p.user_id);
      const commentUserIds = [
        ...(imageCommentsRes.data || []).map((c: any) => c.user_id),
        ...(postCommentsRes.data || []).map((c: any) => c.user_id),
      ];
      const allUserIds = [...new Set([...reporterIds, ...commentUserIds, ...postAuthorIds])];
      const profileMap = await cachedFetchProfilesByIds(allUserIds);

      enrichedReports = reportsRes.data.map(r => {
        let comment: any = null;
        let sourceType: "image_comment" | "post_comment" = "image_comment";
        let effectiveId = r.comment_id || r.post_comment_id || "";
        let contextTitle: string | null = null;
        let contextLink: string | null = null;

        if (r.post_comment_id && postCommentMap.has(r.post_comment_id)) {
          comment = postCommentMap.get(r.post_comment_id);
          sourceType = "post_comment";
          effectiveId = r.post_comment_id;
          const post = comment?.post_id ? postContextMap.get(comment.post_id) : null;
          if (post) {
            const authorName = profileMap.get(post.user_id) || "Unknown";
            contextTitle = `${authorName}'s Post`;
            contextLink = `/feed`;
          }
        } else if (r.comment_id && imageCommentMap.has(r.comment_id)) {
          comment = imageCommentMap.get(r.comment_id);
          sourceType = "image_comment";
          effectiveId = r.comment_id;
          if (comment?.image_type === "entry" && comment?.image_id) {
            const entry = entryContextMap.get(comment.image_id);
            if (entry) {
              const compTitle = competitionTitleMap.get(entry.competition_id);
              contextTitle = compTitle ? `${entry.title} — ${compTitle}` : entry.title;
              contextLink = `/competitions/${entry.competition_id}`;
            }
          } else if (comment?.image_type === "portfolio" && comment?.image_id) {
            contextTitle = "Portfolio Image";
            contextLink = `/discover`;
          }
        }

        return {
          ...r,
          comment_content: comment?.content || "[deleted]",
          comment_user_id: comment?.user_id || null,
          comment_user_name: comment?.user_id ? profileMap.get(comment.user_id) || null : null,
          reporter_name: profileMap.get(r.reporter_id) || null,
          is_flagged: comment?.is_flagged || false,
          flag_reason: comment?.flag_reason || null,
          source_type: sourceType,
          effective_comment_id: effectiveId,
          context_title: contextTitle,
          context_link: contextLink,
          source: r.source || "user",
        };
      });
    }

    let enrichedFlagged: FlaggedComment[] = [];
    if (flaggedRes.data && flaggedRes.data.length > 0) {
      const userIds = [...new Set(flaggedRes.data.map((f: any) => f.user_id))];

      const flaggedEntryIds = [...new Set(
        flaggedRes.data.filter((f: any) => f.image_type === "entry").map((f: any) => f.image_id)
      )] as string[];
      const flaggedEntryMap = new Map<string, { title: string; competition_id: string }>();
      const flaggedCompMap = new Map<string, string>();
      if (flaggedEntryIds.length > 0) {
        const { data: entriesData } = await supabase.from("competition_entries").select("id, title, competition_id").in("id", flaggedEntryIds);
        (entriesData || []).forEach((e: any) => flaggedEntryMap.set(e.id, e));
        const compIds = [...new Set((entriesData || []).map((e: any) => e.competition_id))] as string[];
        if (compIds.length > 0) {
          const { data: compsData } = await supabase.from("competitions").select("id, title").in("id", compIds);
          (compsData || []).forEach((c: any) => flaggedCompMap.set(c.id, c.title));
        }
      }

      const profileMap = await cachedFetchProfilesByIds(userIds);
      enrichedFlagged = flaggedRes.data.map((f: any) => {
        let contextTitle: string | null = null;
        let contextLink: string | null = null;
        if (f.image_type === "entry" && f.image_id) {
          const entry = flaggedEntryMap.get(f.image_id);
          if (entry) {
            const compTitle = flaggedCompMap.get(entry.competition_id);
            contextTitle = compTitle ? `${entry.title} — ${compTitle}` : entry.title;
            contextLink = `/competitions/${entry.competition_id}`;
          }
        } else if (f.image_type === "portfolio") {
          contextTitle = "Portfolio Image";
          contextLink = `/discover`;
        }
        return {
          ...f,
          user_name: profileMap.get(f.user_id) || null,
          context_title: contextTitle,
          context_link: contextLink,
        };
      });
    }

    setReports(enrichedReports);
    setFlagged(enrichedFlagged);
    setSelectedReports(new Set());
    setSelectedFlagged(new Set());
    setLoading(false);
  };

  const handleAction = async (report: Report, action: string) => {
    if (!user) return;
    setProcessing(report.id);
    const { source_type, effective_comment_id, comment_user_id } = report;
    const table = source_type === "post_comment" ? "post_comments" : "image_comments";

    try {
      if (action === "remove_comment") {
        await supabase.from(table).delete().eq("id", effective_comment_id);
        toast({ title: "Comment removed" });
      } else if (action === "remove_thread") {
        await supabase.from(table).delete().eq("parent_id", effective_comment_id);
        await supabase.from(table).delete().eq("id", effective_comment_id);
        toast({ title: "Thread removed" });
      } else if (action === "ban_user" && comment_user_id) {
        await supabase.from("profiles").update({
          is_suspended: true,
          suspension_reason: "Banned for inappropriate comments",
        }).eq("id", comment_user_id);
        await supabase.from(table).delete().eq("id", effective_comment_id);
        toast({ title: "User banned & comment removed" });
      } else if (action === "dismiss") {
        toast({ title: "Report dismissed" });
      }

      await supabase.from("comment_reports").update({
        status: "reviewed",
        admin_action: action,
        reviewed_by: user.id,
        updated_at: new Date().toISOString(),
      }).eq("id", report.id);

      fetchAll();
    } catch (err: any) {
      toast({ title: "Action failed", description: err.message, variant: "destructive" });
    }
    setProcessing(null);
  };

  const handleFlaggedAction = async (commentId: string, action: "approve" | "delete" | "ban", userId: string) => {
    setProcessing(commentId);
    try {
      if (action === "approve") {
        await supabase.from("image_comments").update({ is_flagged: false, flag_reason: null }).eq("id", commentId);
        toast({ title: "Comment approved" });
      } else if (action === "delete") {
        await supabase.from("image_comments").delete().eq("id", commentId);
        toast({ title: "Comment deleted" });
      } else if (action === "ban") {
        await supabase.from("profiles").update({ is_suspended: true, suspension_reason: "Banned for flagged content" }).eq("id", userId);
        await supabase.from("image_comments").delete().eq("id", commentId);
        toast({ title: "User banned & comment deleted" });
      }
      fetchAll();
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    }
    setProcessing(null);
  };

  // --- Delete report records (not the comment, just the report entry) ---
  const deleteReportRecords = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    const { error } = await supabase.from("comment_reports").delete().in("id", ids);
    if (error) throw error;
    toast({ title: `${ids.length} report${ids.length > 1 ? "s" : ""} deleted` });
    fetchAll();
  }, []);

  const deleteFlaggedComments = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    const { error } = await supabase.from("image_comments").delete().in("id", ids);
    if (error) throw error;
    toast({ title: `${ids.length} flagged comment${ids.length > 1 ? "s" : ""} deleted` });
    fetchAll();
  }, []);

  // --- Selection helpers ---
  const toggleReportSelection = (id: string) => {
    setSelectedReports(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleFlaggedSelection = (id: string) => {
    setSelectedFlagged(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAllReports = (list: Report[]) => {
    const allSelected = list.every(r => selectedReports.has(r.id));
    if (allSelected) {
      setSelectedReports(new Set());
    } else {
      setSelectedReports(new Set(list.map(r => r.id)));
    }
  };

  const toggleAllFlagged = () => {
    const allItems = [...flagged.map(f => f.id), ...aiReports.map(r => r.id)];
    const allSelected = allItems.every(id => selectedFlagged.has(id));
    if (allSelected) {
      setSelectedFlagged(new Set());
    } else {
      setSelectedFlagged(new Set(allItems));
    }
  };

  if (loading) {
    return <div className="flex items-center gap-2 text-xs text-muted-foreground py-8"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</div>;
  }

  const pendingReports = reports.filter(r => r.status === "pending" && r.source !== "ai");
  const aiReports = reports.filter(r => r.source === "ai");
  const userReports = reports.filter(r => r.source !== "ai");

  const ContextLine = ({ title, link }: { title: string | null; link: string | null }) => {
    if (!title) return <p className="text-[9px] text-muted-foreground mt-1">On: <span className="italic">Context unavailable</span></p>;
    return (
      <p className="text-[9px] text-muted-foreground mt-1 flex items-center gap-1">
        On:{" "}
        {link ? (
          <Link to={link} className="text-primary hover:underline inline-flex items-center gap-0.5">
            {title} <ExternalLink className="h-2.5 w-2.5" />
          </Link>
        ) : (
          <span>{title}</span>
        )}
      </p>
    );
  };

  // Bulk bar for Reports tab
  const BulkBarReports = () => {
    if (selectedReports.size === 0) return null;
    return (
      <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/50 border border-border rounded-sm mb-3">
        <span className="text-[10px] tracking-wider uppercase text-muted-foreground" style={headingFont}>
          {selectedReports.size} selected
        </span>
        <button
          onClick={() => confirm({
            title: "Delete Selected Reports",
            description: `Permanently delete ${selectedReports.size} report record${selectedReports.size > 1 ? "s" : ""}? This removes the report, not the comment itself.`,
            confirmLabel: "Delete",
            variant: "destructive",
            onConfirm: () => deleteReportRecords([...selectedReports]),
          })}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-[9px] uppercase tracking-wider border border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground rounded-sm transition-all"
          style={headingFont}
        >
          <Trash2 className="h-2.5 w-2.5" /> Delete Reports
        </button>
        <button
          onClick={() => setSelectedReports(new Set())}
          className="text-[9px] text-muted-foreground hover:text-foreground transition-colors"
          style={headingFont}
        >
          Clear
        </button>
      </div>
    );
  };

  // Bulk bar for AI Flagged tab
  const BulkBarFlagged = () => {
    if (selectedFlagged.size === 0) return null;
    // Split selection into ai report IDs and flagged comment IDs
    const aiReportIds = aiReports.filter(r => selectedFlagged.has(r.id)).map(r => r.id);
    const flaggedIds = flagged.filter(f => selectedFlagged.has(f.id)).map(f => f.id);

    return (
      <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/50 border border-border rounded-sm mb-3">
        <span className="text-[10px] tracking-wider uppercase text-muted-foreground" style={headingFont}>
          {selectedFlagged.size} selected
        </span>
        <button
          onClick={() => confirm({
            title: "Delete Selected",
            description: `Permanently delete ${selectedFlagged.size} item${selectedFlagged.size > 1 ? "s" : ""}? AI report records and flagged comments will be removed.`,
            confirmLabel: "Delete",
            variant: "destructive",
            onConfirm: async () => {
              if (aiReportIds.length > 0) await deleteReportRecords(aiReportIds);
              if (flaggedIds.length > 0) await deleteFlaggedComments(flaggedIds);
            },
          })}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-[9px] uppercase tracking-wider border border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground rounded-sm transition-all"
          style={headingFont}
        >
          <Trash2 className="h-2.5 w-2.5" /> Delete Selected
        </button>
        <button
          onClick={() => setSelectedFlagged(new Set())}
          className="text-[9px] text-muted-foreground hover:text-foreground transition-colors"
          style={headingFont}
        >
          Clear
        </button>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Sub-tabs */}
      <div className="flex gap-2">
        <button onClick={() => setTab("reports")}
          className={`inline-flex items-center gap-1.5 px-4 py-2 text-[10px] tracking-[0.15em] uppercase border rounded-sm transition-all ${tab === "reports" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
          style={headingFont}>
          <AlertTriangle className="h-3 w-3" /> Reports {pendingReports.length > 0 && <span className="ml-1 px-1.5 py-0.5 bg-destructive text-destructive-foreground text-[8px] rounded-full">{pendingReports.length}</span>}
        </button>
        <button onClick={() => setTab("flagged")}
          className={`inline-flex items-center gap-1.5 px-4 py-2 text-[10px] tracking-[0.15em] uppercase border rounded-sm transition-all ${tab === "flagged" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
          style={headingFont}>
          <Eye className="h-3 w-3" /> AI Flagged {(flagged.length + aiReports.length) > 0 && <span className="ml-1 px-1.5 py-0.5 bg-destructive text-destructive-foreground text-[8px] rounded-full">{flagged.length + aiReports.length}</span>}
        </button>
      </div>

      {/* User Reports */}
      {tab === "reports" && (
        <div>
          {userReports.length === 0 ? (
            <div className="border border-border p-8 text-center">
              <Check className="h-6 w-6 text-primary mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">No reports to review</p>
            </div>
          ) : (
            <>
              {/* Select all + bulk bar */}
              <div className="flex items-center gap-3 mb-3">
                <button
                  onClick={() => toggleAllReports(userReports)}
                  className="inline-flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
                  style={headingFont}
                >
                  {userReports.every(r => selectedReports.has(r.id)) ? <CheckSquare className="h-3.5 w-3.5 text-primary" /> : <Square className="h-3.5 w-3.5" />}
                  Select All
                </button>
              </div>
              <BulkBarReports />
              <div className="border border-border rounded-sm divide-y divide-border">
                {userReports.map(r => (
                  <div key={r.id} className={`p-4 space-y-2 ${selectedReports.has(r.id) ? "bg-primary/5" : ""}`}>
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={selectedReports.has(r.id)}
                        onCheckedChange={() => toggleReportSelection(r.id)}
                        className="mt-1 shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[8px] px-1.5 py-0.5 border rounded-sm uppercase tracking-wider ${
                            r.status === "pending" ? "border-destructive/40 text-destructive" : "border-primary/40 text-primary"
                          }`}>{r.status}</span>
                          <span className={`text-[8px] px-1.5 py-0.5 border rounded-sm uppercase tracking-wider ${
                            r.source_type === "post_comment" ? "border-accent/40 text-accent-foreground bg-accent/10" : "border-muted-foreground/30 text-muted-foreground"
                          }`}>{r.source_type === "post_comment" ? "post comment" : "image comment"}</span>
                          <span className="text-[9px] text-muted-foreground">
                            Reported by: {r.reporter_name ? (
                              <Link to={`/profile/${r.reporter_id}`} className="text-primary hover:underline">{r.reporter_name}</Link>
                            ) : "Unknown"}
                          </span>
                          <span className="text-[9px] text-muted-foreground">· {new Date(r.created_at).toLocaleDateString()}</span>
                          <span className="text-[9px] px-1.5 py-0.5 bg-muted rounded-sm">{r.reason}</span>
                        </div>
                        <div className="mt-1.5 p-2 bg-muted/30 border border-border/50 rounded-sm">
                          <p className="text-[10px] text-muted-foreground mb-0.5">
                            Comment by{" "}
                            {r.comment_user_id ? (
                              <Link to={`/profile/${r.comment_user_id}`} className="text-primary font-semibold hover:underline">
                                {r.comment_user_name || "Unknown"}
                              </Link>
                            ) : (
                              <strong>{r.comment_user_name || "Unknown"}</strong>
                            )}:
                          </p>
                          <p className="text-xs" style={{ fontFamily: "var(--font-body)" }}>{r.comment_content}</p>
                        </div>
                        <ContextLine title={r.context_title} link={r.context_link} />
                        {r.is_flagged && r.flag_reason && (
                          <p className="text-[9px] text-destructive mt-1 flex items-center gap-1">
                            <AlertTriangle className="h-2.5 w-2.5" /> AI also flagged: {r.flag_reason}
                          </p>
                        )}
                        {r.admin_action && (
                          <p className="text-[9px] text-primary mt-1">Action taken: {r.admin_action.replace(/_/g, " ")}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1 pl-8">
                      {r.status === "pending" && (
                        <>
                          {r.context_link && (
                            <Link to={r.context_link}
                              className="inline-flex items-center gap-1 px-3 py-1.5 text-[9px] uppercase tracking-wider border border-primary/50 text-primary hover:bg-primary/10 rounded-sm transition-all"
                              style={headingFont}>
                              <ExternalLink className="h-2.5 w-2.5" /> View Full Thread
                            </Link>
                          )}
                          <button onClick={() => handleAction(r, "remove_comment")} disabled={processing === r.id}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-[9px] uppercase tracking-wider border border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground rounded-sm transition-all"
                            style={headingFont}>
                            <Trash2 className="h-2.5 w-2.5" /> Remove Comment
                          </button>
                          <button onClick={() => handleAction(r, "remove_thread")} disabled={processing === r.id}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-[9px] uppercase tracking-wider border border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground rounded-sm transition-all"
                            style={headingFont}>
                            <MessageSquare className="h-2.5 w-2.5" /> Remove Thread
                          </button>
                          <button onClick={() => handleAction(r, "ban_user")} disabled={processing === r.id}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-[9px] uppercase tracking-wider border border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground rounded-sm transition-all"
                            style={headingFont}>
                            <Ban className="h-2.5 w-2.5" /> Ban User
                          </button>
                          <button onClick={() => handleAction(r, "dismiss")} disabled={processing === r.id}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-[9px] uppercase tracking-wider border border-border text-muted-foreground hover:border-foreground/50 rounded-sm transition-all"
                            style={headingFont}>
                            <XCircle className="h-2.5 w-2.5" /> Dismiss
                          </button>
                        </>
                      )}
                      {/* Always show Delete Report button */}
                      <button
                        onClick={() => confirm({
                          title: "Delete Report",
                          description: "Remove this report record permanently? The comment itself will not be affected.",
                          confirmLabel: "Delete",
                          variant: "destructive",
                          onConfirm: () => deleteReportRecords([r.id]),
                        })}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-[9px] uppercase tracking-wider border border-muted-foreground/30 text-muted-foreground hover:border-destructive/50 hover:text-destructive rounded-sm transition-all"
                        style={headingFont}
                      >
                        <Trash2 className="h-2.5 w-2.5" /> Delete Report
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* AI Flagged Comments */}
      {tab === "flagged" && (
        <div className="space-y-4">
          {(aiReports.length > 0 || flagged.length > 0) && (
            <>
              <div className="flex items-center gap-3">
                <button
                  onClick={toggleAllFlagged}
                  className="inline-flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
                  style={headingFont}
                >
                  {[...flagged.map(f => f.id), ...aiReports.map(r => r.id)].every(id => selectedFlagged.has(id))
                    ? <CheckSquare className="h-3.5 w-3.5 text-primary" />
                    : <Square className="h-3.5 w-3.5" />}
                  Select All
                </button>
              </div>
              <BulkBarFlagged />
            </>
          )}

          {/* AI Reports from comment_reports */}
          {aiReports.length > 0 && (
            <div className="border border-border rounded-sm divide-y divide-border">
              {aiReports.map(r => (
                <div key={r.id} className={`p-4 space-y-2 ${selectedFlagged.has(r.id) ? "bg-primary/5" : ""}`}>
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={selectedFlagged.has(r.id)}
                      onCheckedChange={() => toggleFlaggedSelection(r.id)}
                      className="mt-1 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[8px] px-1.5 py-0.5 border border-destructive/40 bg-destructive/10 text-destructive rounded-sm uppercase tracking-wider font-bold">AI Flagged</span>
                        <span className={`text-[8px] px-1.5 py-0.5 border rounded-sm uppercase tracking-wider ${
                          r.source_type === "post_comment" ? "border-accent/40 text-accent-foreground bg-accent/10" : "border-muted-foreground/30 text-muted-foreground"
                        }`}>{r.source_type === "post_comment" ? "post comment" : "image comment"}</span>
                        <span className="text-[9px] text-muted-foreground">
                          By: {r.comment_user_id ? (
                            <Link to={`/profile/${r.comment_user_id}`} className="text-primary hover:underline">{r.comment_user_name || "Unknown"}</Link>
                          ) : "Unknown"}
                        </span>
                        <span className="text-[9px] text-muted-foreground">· {new Date(r.created_at).toLocaleDateString()}</span>
                      </div>
                      <div className="mt-1.5 p-2 bg-muted/30 border border-border/50 rounded-sm">
                        <p className="text-xs" style={{ fontFamily: "var(--font-body)" }}>{r.comment_content}</p>
                      </div>
                      <ContextLine title={r.context_title} link={r.context_link} />
                      {r.details && <p className="text-[9px] text-destructive">{r.details}</p>}
                      {r.status !== "pending" && r.admin_action && (
                        <p className="text-[9px] text-primary">Action taken: {r.admin_action.replace(/_/g, " ")}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1 pl-8">
                    {r.status === "pending" && (
                      <>
                        {r.context_link && (
                          <Link to={r.context_link}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-[9px] uppercase tracking-wider border border-primary/50 text-primary hover:bg-primary/10 rounded-sm transition-all"
                            style={headingFont}>
                            <ExternalLink className="h-2.5 w-2.5" /> View Full Thread
                          </Link>
                        )}
                        <button onClick={() => handleAction(r, "remove_comment")} disabled={processing === r.id}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-[9px] uppercase tracking-wider border border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground rounded-sm transition-all"
                          style={headingFont}>
                          <Trash2 className="h-2.5 w-2.5" /> Remove
                        </button>
                        <button onClick={() => handleAction(r, "dismiss")} disabled={processing === r.id}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-[9px] uppercase tracking-wider border border-border text-muted-foreground hover:border-foreground/50 rounded-sm transition-all"
                          style={headingFont}>
                          <XCircle className="h-2.5 w-2.5" /> Dismiss
                        </button>
                        <button onClick={() => handleAction(r, "ban_user")} disabled={processing === r.id}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-[9px] uppercase tracking-wider border border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground rounded-sm transition-all"
                          style={headingFont}>
                          <Ban className="h-2.5 w-2.5" /> Ban User
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => confirm({
                        title: "Delete Report",
                        description: "Remove this AI report record permanently?",
                        confirmLabel: "Delete",
                        variant: "destructive",
                        onConfirm: () => deleteReportRecords([r.id]),
                      })}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-[9px] uppercase tracking-wider border border-muted-foreground/30 text-muted-foreground hover:border-destructive/50 hover:text-destructive rounded-sm transition-all"
                      style={headingFont}
                    >
                      <Trash2 className="h-2.5 w-2.5" /> Delete Report
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Legacy image_comments is_flagged */}
          {flagged.length > 0 && (
            <div className="border border-border rounded-sm divide-y divide-border">
              {flagged.map(f => (
                <div key={f.id} className={`p-4 space-y-2 ${selectedFlagged.has(f.id) ? "bg-primary/5" : ""}`}>
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={selectedFlagged.has(f.id)}
                      onCheckedChange={() => toggleFlaggedSelection(f.id)}
                      className="mt-1 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[8px] px-1.5 py-0.5 border border-destructive/40 text-destructive rounded-sm uppercase tracking-wider">flagged</span>
                        <span className="text-[9px] text-muted-foreground">
                          By: {f.user_id ? (
                            <Link to={`/profile/${f.user_id}`} className="text-primary hover:underline">{f.user_name || "Unknown"}</Link>
                          ) : (f.user_name || "Unknown")}
                        </span>
                        <span className="text-[9px] text-muted-foreground">· {f.image_type}</span>
                        <span className="text-[9px] text-muted-foreground">· {new Date(f.created_at).toLocaleDateString()}</span>
                      </div>
                      <div className="mt-1.5 p-2 bg-muted/30 border border-border/50 rounded-sm">
                        <p className="text-xs" style={{ fontFamily: "var(--font-body)" }}>{f.content}</p>
                      </div>
                      <ContextLine title={f.context_title} link={f.context_link} />
                      {f.flag_reason && <p className="text-[9px] text-destructive">{f.flag_reason}</p>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 pl-8">
                    {f.context_link && (
                      <Link to={f.context_link}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-[9px] uppercase tracking-wider border border-primary/50 text-primary hover:bg-primary/10 rounded-sm transition-all"
                        style={headingFont}>
                        <ExternalLink className="h-2.5 w-2.5" /> View Full Thread
                      </Link>
                    )}
                    <button onClick={() => handleFlaggedAction(f.id, "approve", f.user_id)} disabled={processing === f.id}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-[9px] uppercase tracking-wider border border-primary/50 text-primary hover:bg-primary hover:text-primary-foreground rounded-sm transition-all"
                      style={headingFont}>
                      <Check className="h-2.5 w-2.5" /> Approve
                    </button>
                    <button onClick={() => handleFlaggedAction(f.id, "delete", f.user_id)} disabled={processing === f.id}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-[9px] uppercase tracking-wider border border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground rounded-sm transition-all"
                      style={headingFont}>
                      <Trash2 className="h-2.5 w-2.5" /> Delete
                    </button>
                    <button onClick={() => handleFlaggedAction(f.id, "ban", f.user_id)} disabled={processing === f.id}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-[9px] uppercase tracking-wider border border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground rounded-sm transition-all"
                      style={headingFont}>
                      <Ban className="h-2.5 w-2.5" /> Ban User
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {flagged.length === 0 && aiReports.length === 0 && (
            <div className="border border-border p-8 text-center">
              <Check className="h-6 w-6 text-primary mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">No AI-flagged comments</p>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog {...dialogProps} />
    </div>
  );
};

export default AdminCommentReports;
