// Phase 5 — Scheduled posts manager: 3 tabs + per-row actions + realtime + shift banner.
// Tabs (mapped to DB `status` CHECK constraint values):
//   Upcoming  = pending | publishing
//   Issues    = failed  | cancelled
//   Published = published
// Row actions: Edit time, Edit caption, Duplicate, Cancel, View published.
// Realtime: server-side filter user_id=eq.<uid>, invalidates query on change.

import * as React from "react";
import { format } from "date-fns";
import {
  Calendar as CalIcon,
  X,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Clock,
  MoreHorizontal,
  Pencil,
  Copy,
  ExternalLink,
  ClockAlert,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useScheduledPosts,
  useCancelScheduledPost,
  useCreateScheduledPost,
  useScheduledPostsRealtime,
  type ScheduledPost,
} from "@/hooks/feed/useScheduledPosts";
import { toast } from "@/hooks/core/use-toast";
import EditScheduledPostDialog from "@/components/post/EditScheduledPostDialog";

type TabKey = "upcoming" | "issues" | "published";

const statusMeta: Record<
  ScheduledPost["status"],
  { label: string; className: string; icon: JSX.Element }
> = {
  pending: {
    label: "Scheduled",
    className: "text-primary",
    icon: <Clock className="h-3.5 w-3.5" />,
  },
  publishing: {
    label: "Publishing…",
    className: "text-primary",
    icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
  },
  published: {
    label: "Published",
    className: "text-emerald-500",
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
  },
  failed: {
    label: "Failed",
    className: "text-destructive",
    icon: <AlertCircle className="h-3.5 w-3.5" />,
  },
  cancelled: {
    label: "Cancelled",
    className: "text-muted-foreground",
    icon: <X className="h-3.5 w-3.5" />,
  },
};

function bucketOf(s: ScheduledPost["status"]): TabKey {
  if (s === "pending" || s === "publishing") return "upcoming";
  if (s === "published") return "published";
  return "issues"; // failed | cancelled
}

export default function ScheduledPostsList() {
  useScheduledPostsRealtime();
  const { data: posts, isLoading, error } = useScheduledPosts();
  const cancel = useCancelScheduledPost();
  const duplicate = useCreateScheduledPost();

  const [tab, setTab] = React.useState<TabKey>("upcoming");
  const [editState, setEditState] = React.useState<{
    post: ScheduledPost | null;
    mode: "time" | "caption";
    open: boolean;
  }>({ post: null, mode: "time", open: false });
  const [confirmCancelId, setConfirmCancelId] = React.useState<string | null>(
    null,
  );

  const buckets = React.useMemo(() => {
    const groups: Record<TabKey, ScheduledPost[]> = {
      upcoming: [],
      issues: [],
      published: [],
    };
    (posts ?? []).forEach((p) => groups[bucketOf(p.status)].push(p));
    return groups;
  }, [posts]);

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }
  if (error) {
    return (
      <div className="p-6 text-sm text-destructive">
        Failed to load scheduled posts.
      </div>
    );
  }

  const handleDuplicate = async (p: ScheduledPost) => {
    // Duplicate re-uses existing image URLs (no re-upload); shifts time +1 hour.
    const next = new Date();
    next.setMinutes(next.getMinutes() + 60);
    try {
      await duplicate.mutateAsync({
        content: p.content ?? "",
        image_urls: p.image_urls ?? [],
        image_url: p.image_url,
        tagged_user_ids: p.tagged_user_ids ?? [],
        scheduled_for: next.toISOString(),
      });
      toast({
        title: "Duplicated",
        description: `New draft scheduled for ${format(next, "PPP p")}`,
      });
    } catch (e: any) {
      toast({
        title: "Duplicate failed",
        description: e?.message,
        variant: "destructive",
      });
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await cancel.mutateAsync(id);
      toast({ title: "Scheduled post cancelled" });
    } catch (e: any) {
      toast({
        title: "Failed to cancel",
        description: e?.message,
        variant: "destructive",
      });
    } finally {
      setConfirmCancelId(null);
    }
  };

  const renderList = (rows: ScheduledPost[], key: TabKey) => {
    if (rows.length === 0) {
      const emptyText =
        key === "upcoming"
          ? "You have no upcoming scheduled posts."
          : key === "issues"
          ? "No failed or cancelled posts."
          : "No posts have been published from the queue yet.";
      return (
        <div className="border border-border rounded-xl p-10 text-center">
          <CalIcon className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        </div>
      );
    }
    return (
      <div className="space-y-3">
        {rows.map((p) => {
          const meta = statusMeta[p.status];
          const scheduled = new Date(p.scheduled_for);
          const original = new Date(p.original_scheduled_for);
          const canEdit = p.status === "pending";
          const canCancel = p.status === "pending";
          const shifted = p.shifted_count > 0;

          return (
            <div
              key={p.id}
              className="border border-border rounded-xl p-4 flex gap-4"
            >
              {p.image_urls?.[0] && (
                <img
                  src={p.image_urls[0]}
                  alt=""
                  loading="lazy"
                  className="h-20 w-20 rounded-md object-cover flex-shrink-0"
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center flex-wrap gap-x-2 gap-y-1 text-xs mb-1.5">
                  <span
                    className={`inline-flex items-center gap-1 ${meta.className}`}
                  >
                    {meta.icon}
                    {meta.label}
                  </span>
                  <span className="text-muted-foreground">
                    · {format(scheduled, "PPP p")}
                  </span>
                </div>
                {p.content && (
                  <p className="text-sm line-clamp-2 whitespace-pre-wrap break-words">
                    {p.content}
                  </p>
                )}
                {shifted && (
                  <div className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-500 bg-amber-500/10 border border-amber-500/30 rounded-md px-2 py-1.5">
                    <ClockAlert className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                    <span>
                      Auto-shifted from {format(original, "PPP p")} →{" "}
                      {format(scheduled, "PPP p")}
                      {p.last_shift_reason ? ` — ${p.last_shift_reason}` : ""}
                    </span>
                  </div>
                )}
                {p.last_error && p.status === "failed" && (
                  <p className="text-xs text-destructive mt-1 line-clamp-2">
                    {p.last_error}
                  </p>
                )}
              </div>

              <div className="self-start">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground"
                      aria-label="Row actions"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    {canEdit && (
                      <>
                        <DropdownMenuItem
                          onClick={() =>
                            setEditState({
                              post: p,
                              mode: "time",
                              open: true,
                            })
                          }
                        >
                          <Clock className="h-4 w-4 mr-2" /> Edit time
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            setEditState({
                              post: p,
                              mode: "caption",
                              open: true,
                            })
                          }
                        >
                          <Pencil className="h-4 w-4 mr-2" /> Edit caption
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    )}
                    <DropdownMenuItem
                      onClick={() => handleDuplicate(p)}
                      disabled={duplicate.isPending}
                    >
                      <Copy className="h-4 w-4 mr-2" /> Duplicate
                    </DropdownMenuItem>
                    {p.status === "published" && p.published_post_id && (
                      <DropdownMenuItem asChild>
                        <Link to={`/post/${p.published_post_id}`}>
                          <ExternalLink className="h-4 w-4 mr-2" />
                          View published
                        </Link>
                      </DropdownMenuItem>
                    )}
                    {canCancel && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => setConfirmCancelId(p.id)}
                          className="text-destructive focus:text-destructive"
                        >
                          <X className="h-4 w-4 mr-2" /> Cancel
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <>
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList className="mb-4">
          <TabsTrigger value="upcoming">
            Upcoming
            {buckets.upcoming.length > 0 && (
              <span className="ml-1.5 text-xs text-muted-foreground">
                {buckets.upcoming.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="issues">
            Issues
            {buckets.issues.length > 0 && (
              <span className="ml-1.5 text-xs text-muted-foreground">
                {buckets.issues.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="published">
            Published
            {buckets.published.length > 0 && (
              <span className="ml-1.5 text-xs text-muted-foreground">
                {buckets.published.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="upcoming">
          {renderList(buckets.upcoming, "upcoming")}
        </TabsContent>
        <TabsContent value="issues">
          {renderList(buckets.issues, "issues")}
        </TabsContent>
        <TabsContent value="published">
          {renderList(buckets.published, "published")}
        </TabsContent>
      </Tabs>

      <EditScheduledPostDialog
        post={editState.post}
        mode={editState.mode}
        open={editState.open}
        onOpenChange={(o) => setEditState((s) => ({ ...s, open: o }))}
      />

      <AlertDialog
        open={!!confirmCancelId}
        onOpenChange={(o) => !o && setConfirmCancelId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this scheduled post?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the schedule permanently. Your uploaded images stay
              in your library.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmCancelId && handleCancel(confirmCancelId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Cancel post
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
