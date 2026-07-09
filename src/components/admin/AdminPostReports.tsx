import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, Check, Trash2, Ban, Loader2, XCircle, CheckSquare, Square } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cachedFetchProfilesByIds } from "@/lib/profileBatch";
import { toast } from "@/hooks/core/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import { useConfirmAction } from "@/hooks/admin/useConfirmAction";
import type { User } from "@supabase/supabase-js";

const headingFont = { fontFamily: "var(--font-heading)" };

interface Props {
  user: User | null;
}

interface PostReport {
  id: string;
  post_id: string;
  reporter_id: string;
  reason: string;
  details: string | null;
  status: string;
  admin_action: string | null;
  reviewed_by: string | null;
  created_at: string;
  post_content: string | null;
  post_user_id: string | null;
  post_user_name: string | null;
  reporter_name: string | null;
}

const AdminPostReports = ({ user }: Props) => {
  const [reports, setReports] = useState<PostReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { confirm, dialogProps } = useConfirmAction();

  useEffect(() => {
    fetchReports();
  }, []);

  const fetchReports = async () => {
    setLoading(true);
    const { data: reportsData } = await supabase
      .from("post_reports" as any)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100) as any;

    if (!reportsData || reportsData.length === 0) {
      setReports([]);
      setSelected(new Set());
      setLoading(false);
      return;
    }

    const postIds = [...new Set(reportsData.map((r: any) => r.post_id))] as string[];
    const reporterIds = [...new Set(reportsData.map((r: any) => r.reporter_id))] as string[];

    const [postsRes] = await Promise.all([
      supabase.from("posts").select("id, content, user_id").in("id", postIds),
    ]);

    const postMap = new Map((postsRes.data || []).map((p: any) => [p.id, p]));

    const postAuthorIds = [...new Set((postsRes.data || []).map((p: any) => p.user_id))];
    const allUserIds = [...new Set([...reporterIds, ...postAuthorIds])];
    const profileMap = await cachedFetchProfilesByIds(allUserIds);

    const enriched: PostReport[] = reportsData.map((r: any) => {
      const post = postMap.get(r.post_id) as any;
      return {
        ...r,
        post_content: post?.content || "[deleted]",
        post_user_id: post?.user_id || null,
        post_user_name: post?.user_id ? profileMap.get(post.user_id) || null : null,
        reporter_name: profileMap.get(r.reporter_id) || null,
      };
    });

    setReports(enriched);
    setSelected(new Set());
    setLoading(false);
  };

  const handleAction = async (reportId: string, action: string, postId: string, postUserId: string | null) => {
    if (!user) return;
    setProcessing(reportId);

    try {
      if (action === "remove_post") {
        await supabase.from("posts").delete().eq("id", postId);
        toast({ title: "Post removed" });
      } else if (action === "ban_user" && postUserId) {
        await supabase.from("profiles").update({
          is_suspended: true,
          suspension_reason: "Banned for inappropriate post content",
        } as any).eq("id", postUserId);
        await supabase.from("posts").delete().eq("id", postId);
        toast({ title: "User banned & post removed" });
      } else if (action === "dismiss") {
        toast({ title: "Report dismissed" });
      }

      await (supabase.from("post_reports" as any).update({
        status: "reviewed",
        admin_action: action,
        reviewed_by: user.id,
        updated_at: new Date().toISOString(),
      } as any).eq("id", reportId) as any);

      fetchReports();
    } catch (err: any) {
      toast({ title: "Action failed", description: err.message, variant: "destructive" });
    }
    setProcessing(null);
  };

  const deleteReportRecords = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    const { error } = await (supabase.from("post_reports" as any).delete().in("id", ids) as any);
    if (error) throw error;
    toast({ title: `${ids.length} report${ids.length > 1 ? "s" : ""} deleted` });
    fetchReports();
  }, []);

  const toggleSelection = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (reports.every(r => selected.has(r.id))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(reports.map(r => r.id)));
    }
  };

  if (loading) {
    return <div className="flex items-center gap-2 text-xs text-muted-foreground py-8"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</div>;
  }

  const pendingReports = reports.filter(r => r.status === "pending");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-destructive" />
        <span className="text-xs text-muted-foreground" style={headingFont}>
          {pendingReports.length} pending · {reports.length} total
        </span>
      </div>

      {reports.length === 0 ? (
        <div className="border border-border p-8 text-center">
          <Check className="h-6 w-6 text-primary mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">No post reports to review</p>
        </div>
      ) : (
        <>
          {/* Select all + bulk bar */}
          <div className="flex items-center gap-3">
            <button
              onClick={toggleAll}
              className="inline-flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
              style={headingFont}
            >
              {reports.every(r => selected.has(r.id))
                ? <CheckSquare className="h-3.5 w-3.5 text-primary" />
                : <Square className="h-3.5 w-3.5" />}
              Select All
            </button>
          </div>

          {selected.size > 0 && (
            <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/50 border border-border rounded-sm">
              <span className="text-[10px] tracking-wider uppercase text-muted-foreground" style={headingFont}>
                {selected.size} selected
              </span>
              <button
                onClick={() => confirm({
                  title: `Delete ${selected.size} Report${selected.size > 1 ? "s" : ""}`,
                  description: `Permanently delete ${selected.size} report record${selected.size > 1 ? "s" : ""}? The post itself will not be affected.`,
                  confirmLabel: "Delete",
                  variant: "destructive",
                  onConfirm: () => deleteReportRecords([...selected]),
                })}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-[9px] uppercase tracking-wider border border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground rounded-sm transition-all"
                style={headingFont}
              >
                <Trash2 className="h-2.5 w-2.5" /> Delete Reports
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

          <div className="border border-border rounded-sm divide-y divide-border">
            {reports.map(r => (
              <div key={r.id} className={`p-4 space-y-2 ${selected.has(r.id) ? "bg-primary/5" : ""}`}>
                <div className="flex items-start gap-3">
                  <Checkbox
                    checked={selected.has(r.id)}
                    onCheckedChange={() => toggleSelection(r.id)}
                    className="mt-1 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[8px] px-1.5 py-0.5 border rounded-sm uppercase tracking-wider ${
                        r.status === "pending" ? "border-destructive/40 text-destructive" : "border-primary/40 text-primary"
                      }`}>{r.status}</span>
                      <span className="text-[9px] text-muted-foreground">Reported by: {r.reporter_name || "Unknown"}</span>
                      <span className="text-[9px] text-muted-foreground">· {new Date(r.created_at).toLocaleDateString()}</span>
                      <span className="text-[9px] px-1.5 py-0.5 bg-muted rounded-sm">{r.reason}</span>
                    </div>
                    <div className="mt-1.5 p-2 bg-muted/30 border border-border/50 rounded-sm">
                      <p className="text-[10px] text-muted-foreground mb-0.5">Post by <strong>{r.post_user_name || "Unknown"}</strong>:</p>
                      <p className="text-xs line-clamp-3" style={{ fontFamily: "var(--font-body)" }}>
                        {r.post_content}
                      </p>
                    </div>
                    {r.admin_action && (
                      <p className="text-[9px] text-primary mt-1">Action taken: {r.admin_action.replace(/_/g, " ")}</p>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 pt-1 pl-8">
                  {r.status === "pending" && (
                    <>
                      <button onClick={() => handleAction(r.id, "remove_post", r.post_id, r.post_user_id)} disabled={processing === r.id}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-[9px] uppercase tracking-wider border border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground rounded-sm transition-all"
                        style={headingFont}>
                        <Trash2 className="h-2.5 w-2.5" /> Remove Post
                      </button>
                      <button onClick={() => handleAction(r.id, "ban_user", r.post_id, r.post_user_id)} disabled={processing === r.id}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-[9px] uppercase tracking-wider border border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground rounded-sm transition-all"
                        style={headingFont}>
                        <Ban className="h-2.5 w-2.5" /> Ban User
                      </button>
                      <button onClick={() => handleAction(r.id, "dismiss", r.post_id, r.post_user_id)} disabled={processing === r.id}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-[9px] uppercase tracking-wider border border-border text-muted-foreground hover:border-foreground/50 rounded-sm transition-all"
                        style={headingFont}>
                        <XCircle className="h-2.5 w-2.5" /> Dismiss
                      </button>
                    </>
                  )}
                  {/* Always show Delete Report */}
                  <button
                    onClick={() => confirm({
                      title: "Delete Report",
                      description: "Remove this report record permanently? The post itself will not be affected.",
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

      <ConfirmDialog {...dialogProps} />
    </div>
  );
};

export default AdminPostReports;
