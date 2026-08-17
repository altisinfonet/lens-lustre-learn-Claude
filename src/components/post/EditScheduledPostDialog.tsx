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
import HashtagSuggestions from "@/components/post/HashtagSuggestions";
import { useCaptionHashtags } from "@/hooks/feed/useCaptionHashtags";
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
  const captionRef = React.useRef<HTMLTextAreaElement>(null);

  // Owner, 2026-08-16: scheduled posts get the hashtag list too.
  //
  // ⚠ MUST be declared above the `if (!post) return null` below. Hooks run in
  // the same order on every render or React throws — and this dialog renders
  // with a null post every time it is closed, which is most of the time.
  //
  // setValue re-applies the 2200 clamp the textarea's own onChange applies.
  // Picking a tag is the ONE way text enters this box without passing through
  // that handler, so without this a long caption could be pushed over the
  // limit by the very list meant to help.
  const captionHashtags = useCaptionHashtags({
    textareaRef: captionRef,
    value: content,
    setValue: (v) => setContent(v.slice(0, 2200)),
  });

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
      captionHashtags.reset();
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
          <div className="relative">
            <Textarea
              ref={captionRef}
              value={content}
              onChange={(e) => {
                setContent(e.target.value.slice(0, 2200));
                captionHashtags.refresh();
              }}
              onClick={captionHashtags.refresh}
              onKeyUp={captionHashtags.refresh}
              onKeyDown={captionHashtags.onKeyDown}
              rows={6}
              placeholder="Write your caption…"
              disabled={update.isPending}
            />
            {/* INLINE, so the dialog grows and the footer moves down.
                Measured at 360px: floating the list downward covered Cancel and
                Save; floating it upward covered the dialog title and its close
                button. Taking real space is the only placement here that hides
                no control at all. */}
            <HashtagSuggestions
              open={captionHashtags.open}
              suggestions={captionHashtags.suggestions}
              focusIdx={captionHashtags.focusIdx}
              onFocusIdx={captionHashtags.setFocusIdx}
              onPick={captionHashtags.pick}
              placement="inline"
            />
          </div>
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
