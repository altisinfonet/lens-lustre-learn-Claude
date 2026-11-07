/**
 * STORIES v2 — "Highlight" on one's own story: pick a highlight (or make one)
 * and keep this story in it. A kept story stays after 24 hours, with its
 * comments (stories_v2 clean-up skips stories in a highlight).
 */
import { useEffect, useState } from "react";
import { Plus, Star, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { toast } from "@/hooks/core/use-toast";
import type { StorySlide } from "@/lib/stories/storyData";
import { addStoryToHighlight } from "@/lib/stories/storyViewerData";

interface HighlightRow { id: string; title: string }

export default function StoryHighlightPicker({ slide, onDone }: { slide: StorySlide; onDone: () => void }) {
  const { user } = useAuth();
  const [rows, setRows] = useState<HighlightRow[] | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    void supabase.from("highlights" as never).select("id, title").eq("user_id", user.id).order("sort_order")
      .then(({ data }) => setRows(((data as HighlightRow[] | null) ?? [])));
  }, [user]);

  const keep = async (highlightId: string, name: string) => {
    setBusy(true);
    try {
      await addStoryToHighlight(highlightId, slide);
      toast({ title: `Saved to ${name}` });
      onDone();
    } catch (err) {
      toast({ title: "Not saved", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  const makeAndKeep = async () => {
    const t = title.trim().slice(0, 40);
    if (!t || !user) return;
    setBusy(true);
    const { data, error } = await supabase.from("highlights" as never)
      .insert({ user_id: user.id, title: t, cover_url: slide.src ?? slide.story.media[0] ?? null } as never).select("id").single();
    setBusy(false);
    if (error || !data) { toast({ title: "Not saved", description: error?.message, variant: "destructive" }); return; }
    await keep((data as { id: string }).id, t);
  };

  return (
    <div className="absolute inset-0 z-10 flex items-end justify-center bg-black/50 p-4 sm:items-center" onClick={onDone}>
      <div className="w-full max-w-sm rounded-2xl bg-card p-4 text-foreground shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <p className="font-semibold">Add to highlight</p>
          <button type="button" aria-label="Close" onClick={onDone}><X className="h-5 w-5" /></button>
        </div>
        <div className="max-h-56 space-y-1 overflow-y-auto">
          {(rows ?? []).map((h) => (
            <button key={h.id} type="button" disabled={busy} onClick={() => void keep(h.id, h.title)}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm hover:bg-muted">
              <Star className="h-4 w-4 text-primary" />{h.title}
            </button>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={40} placeholder="New highlight name"
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none" />
          <button type="button" disabled={busy || !title.trim()} onClick={() => void makeAndKeep()}
            className="flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
            <Plus className="h-4 w-4" />Add
          </button>
        </div>
      </div>
    </div>
  );
}
