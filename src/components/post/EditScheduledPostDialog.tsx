// Phase 5 — Edit dialog for a pending scheduled post.
// Edits allowed by RLS `sp_update_own_pending`: content + scheduled_for.
// Image edits intentionally out of scope for this phase.

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScheduleDateTimePicker } from "@/components/post/ScheduleDateTimePicker";
import {
  useUpdateScheduledPost,
  type ScheduledPost,
} from "@/hooks/feed/useScheduledPosts";
import { toast } from "@/hooks/core/use-toast";

const MIN_MINUTES_AHEAD = 5;
const MAX_DAYS_AHEAD = 90;

export interface EditScheduledPostDialogProps {
  post: ScheduledPost | null;
  mode: "time" | "caption";
  open: boolean;
  onOpenChange: (next: boolean) => void;
}

export default function EditScheduledPostDialog({
  post,
  mode,
  open,
  onOpenChange,
}: EditScheduledPostDialogProps) {
  const update = useUpdateScheduledPost();
  const [content, setContent] = React.useState<string>("");
  const [when, setWhen] = React.useState<Date | null>(null);

  React.useEffect(() => {
    if (post && open) {
      setContent(post.content ?? "");
      setWhen(new Date(post.scheduled_for));
    }
  }, [post, open]);

  if (!post) return null;

  const isTime = mode === "time";
  const title = isTime ? "Reschedule post" : "Edit caption";
  const desc = isTime
    ? "Pick a new date and time. Must be 5 minutes to 90 days from now."
    : "Update the caption. Images and tags are not editable here.";

  const minAllowed = new Date(Date.now() + MIN_MINUTES_AHEAD * 60 * 1000);
  const maxAllowed = new Date();
  maxAllowed.setDate(maxAllowed.getDate() + MAX_DAYS_AHEAD);
  const timeInvalid =
    isTime && (!when || when < minAllowed || when > maxAllowed);
  const captionInvalid = !isTime && content.trim().length === 0;
  const disabled = update.isPending || (isTime ? timeInvalid : captionInvalid);

  const handleSave = async () => {
    try {
      const patch =
        isTime && when
          ? { id: post.id, scheduled_for: when.toISOString() }
          : { id: post.id, content: content.trim() };
      await update.mutateAsync(patch);
      toast({ title: isTime ? "Rescheduled" : "Caption updated" });
      onOpenChange(false);
    } catch (e: any) {
      toast({
        title: "Update failed",
        description: e?.message ?? "Please try again",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{desc}</DialogDescription>
        </DialogHeader>

        {isTime ? (
          <ScheduleDateTimePicker
            value={when}
            onChange={setWhen}
            disabled={update.isPending}
          />
        ) : (
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value.slice(0, 2200))}
            rows={6}
            placeholder="Write your caption…"
            disabled={update.isPending}
          />
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={update.isPending}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={disabled}>
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
