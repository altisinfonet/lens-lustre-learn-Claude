/**
 * DRAFTS — the list a member opens from the composer.
 *
 * Owner, 2026-08-12: *"The Create screen should have a visible entry point such
 * as: Drafts (3) … Don't make drafts hidden somewhere inside settings."* So the
 * count lives in the composer's first step and this sheet is one tap away.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE EXPIRY IS SHOWN, NOT SPRUNG.
 *
 * A draft is deleted 7 days after its last edit and there is NO undo — the
 * images go too. Silently removing someone's unfinished work is the kind of
 * thing that reads as data loss even when it is documented policy, so every row
 * carries its own countdown and the last day says so plainly.
 *
 * Drafts already marked for cleanup never reach here: the RLS SELECT policy
 * carries `expiring_at IS NULL`, so a draft on its way out disappears from this
 * list BEFORE its images are deleted. Nobody opens a draft to find blank photos.
 */
import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Trash2, ImageIcon, AlertTriangle } from "lucide-react";
import {
  usePostDrafts, useDeleteDraft, draftDaysLeft, type PostDraft,
} from "@/hooks/feed/usePostDrafts";
import { useT } from "@/i18n/I18nContext";
import { cn } from "@/lib/utils";

export interface DraftsListProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResume: (draft: PostDraft) => void;
}

export default function DraftsList({ open, onOpenChange, onResume }: DraftsListProps) {
  const { data: drafts = [], isLoading } = usePostDrafts();
  const del = useDeleteDraft();
  const t = useT();
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[80dvh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {t("post.drafts.title", "Drafts")}{drafts.length ? ` (${drafts.length})` : ""}
          </SheetTitle>
        </SheetHeader>

        {isLoading && (
          <p className="py-6 text-sm text-muted-foreground">
            {t("common.loading", "Loading…")}
          </p>
        )}

        {!isLoading && drafts.length === 0 && (
          <p className="py-6 text-sm text-muted-foreground">
            {t("post.drafts.empty", "Nothing saved yet. Press Save in the composer to keep a post for later.")}
          </p>
        )}

        <ul className="divide-y">
          {drafts.map((d) => {
            const daysLeft = draftDaysLeft(d.updated_at);
            const lastDay = daysLeft <= 1;
            const cover = d.thumbnail_urls?.[0] ?? d.image_urls?.[0] ?? d.image_url ?? null;

            return (
              <li key={d.id} className="flex items-center gap-3 py-3">
                <button
                  type="button"
                  onClick={() => { onResume(d); onOpenChange(false); }}
                  className="flex flex-1 items-center gap-3 text-left"
                >
                  {cover ? (
                    <img src={cover} alt="" className="h-14 w-14 shrink-0 rounded-md object-cover" />
                  ) : (
                    <span className="grid h-14 w-14 shrink-0 place-items-center rounded-md bg-muted">
                      <ImageIcon className="h-5 w-5 text-muted-foreground" />
                    </span>
                  )}

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {d.content?.trim()
                        ? d.content
                        : t("post.drafts.untitled", "Untitled draft")}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      {d.categories.length > 0 && (
                        <span>{d.categories.length}/5</span>
                      )}
                      {d.image_urls?.length > 0 && (
                        <span>{d.image_urls.length} {t("post.drafts.photos", "photos")}</span>
                      )}
                      {/* The countdown. Never a surprise. */}
                      <span className={cn("inline-flex items-center gap-1", lastDay && "font-medium text-amber-500")}>
                        {lastDay && <AlertTriangle className="h-3 w-3" />}
                        {daysLeft <= 0
                          ? t("post.drafts.expiresToday", "Deleted today")
                          : daysLeft === 1
                            ? t("post.drafts.expiresTomorrow", "Deleted tomorrow")
                            : `${t("post.drafts.expiresIn", "Deleted in")} ${daysLeft} ${t("post.drafts.days", "days")}`}
                      </span>
                    </span>
                  </span>
                </button>

                {confirming === d.id ? (
                  <span className="flex shrink-0 gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                      {t("common.cancel", "Cancel")}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={del.isPending}
                      onClick={() => { del.mutate(d.id); setConfirming(null); }}
                    >
                      {t("common.delete", "Delete")}
                    </Button>
                  </span>
                ) : (
                  // Deleting a draft removes work permanently, so it asks first.
                  <button
                    type="button"
                    aria-label={t("post.drafts.delete", "Delete draft")}
                    onClick={() => setConfirming(d.id)}
                    className="shrink-0 p-2 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
