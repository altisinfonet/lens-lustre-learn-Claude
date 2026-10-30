/**
 * "SHARE YOUR FIRST PHOTO" — the last step after the welcome form.
 *
 * Shown once, right after a NEW member finishes OnboardingModal, and only when
 * site_settings `first_post_nudge` is "on" (Layout decides; this component
 * never reads the switch itself). Never a forced block: "Later" closes it, and
 * so do Escape, the outside click and the close button.
 *
 * ONE BIG BUTTON, AND ON THE WEB IT IS THE PICKER ITSELF.
 * A browser opens a file picker only from the member's own tap. Navigating to
 * the feed first and clicking a hidden input from an effect would be blocked
 * (no user activation), so on the web this button is a <label> for a file
 * input: the tap opens the picker here, the chosen photos are handed to the
 * normal composer (putFirstPostFiles) and the feed opens with them loaded and
 * the category filled in — Next, Post. In the app the native picker needs no
 * such activation, so the button opens the normal app flow (`?compose=1`),
 * which starts with the picker exactly as the + button does.
 *
 * THE PROMISE IS WHAT THE FEED DOES (S12 get_personal_feed, personal_feed is
 * "everyone" on production, measured 2026-10-30 run 40991090922):
 *   · the "fair" list fills mix_fair of every (circle+suggested+fair) slots
 *     with posts from authors OUTSIDE the viewer's circle that the viewer has
 *     not seen, ordered by reach ASC — the author's mean viewer_count, so a
 *     first post (0 views) is in the lowest bucket (ties: session jitter);
 *   · the "suggested" list admits a post whose categories overlap the
 *     viewer's chosen photography_interests (`chosen`).
 * No number is shown: mix_fair is admin-editable config, and a sentence with
 * "2 of 10" in it would become false the day it is changed.
 */
import { useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ImagePlus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/i18n/I18nContext";
import { categoryLabelKey } from "@/lib/categories";
import { useCategories } from "@/hooks/useCategories";
import { isNativeCapacitorApp } from "@/lib/native/authDeepLink";
import { firstPostComposeUrl, isSlugShaped, putFirstPostFiles } from "@/lib/firstPost/firstPostNudge";

interface FirstPostPromptProps {
  open: boolean;
  /** The member's chosen interests (category slugs), in the order chosen. */
  interests: string[];
  onClose: () => void;
}

export default function FirstPostPrompt({ open, interests, onClose }: FirstPostPromptProps) {
  const t = useT();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: categories } = useCategories();
  const app = isNativeCapacitorApp();

  // The first chosen interest that is still an active category. Nothing valid
  // → no pre-fill and the interest line is left out (never an invented one).
  const active = new Set((categories ?? []).map((c) => c.slug));
  const slug = interests.find((s) => isSlugShaped(s) && active.has(s)) ?? null;
  const name = slug ? t(categoryLabelKey(slug), (categories ?? []).find((c) => c.slug === slug)?.name ?? slug) : null;

  const go = (handoff: boolean) => {
    onClose();
    navigate(firstPostComposeUrl({ category: slug, handoff }));
  };

  const onFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length === 0) return; // picker cancelled: stay on this step
    putFirstPostFiles(files);
    go(true);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden border-border bg-background" data-testid="first-post-prompt">
        <div className="px-8 pt-8 pb-6 text-center">
          <DialogTitle className="text-xl font-light tracking-tight mb-3" style={{ fontFamily: "var(--font-display)" }}>
            Share your first photo
          </DialogTitle>
          <DialogDescription asChild>
            <div className="text-sm text-muted-foreground space-y-2">
              <p data-testid="first-post-promise">
                Every member's feed keeps a share of its places for photographers they haven't seen much of yet.
                A first photo has no views yet, so it is among the first in that line.
              </p>
              {name && (
                <p data-testid="first-post-interest">
                  It is also suggested to members who picked <strong className="text-foreground">{name}</strong>.
                </p>
              )}
            </div>
          </DialogDescription>

          {app ? (
            <button
              type="button"
              onClick={() => go(false)}
              className="mt-6 w-full inline-flex items-center justify-center gap-2 h-12 rounded-md bg-primary text-primary-foreground text-sm font-medium"
              data-testid="first-post-choose"
            >
              <ImagePlus className="h-5 w-5" /> Choose a photo
            </button>
          ) : (
            <>
              <label
                htmlFor="first-post-file"
                className="mt-6 w-full inline-flex items-center justify-center gap-2 h-12 rounded-md bg-primary text-primary-foreground text-sm font-medium cursor-pointer"
                data-testid="first-post-choose"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileRef.current?.click(); } }}
              >
                <ImagePlus className="h-5 w-5" /> Choose a photo
              </label>
              <input
                id="first-post-file"
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                tabIndex={-1}
                onChange={onFiles}
                data-testid="first-post-file"
              />
            </>
          )}

          <button
            type="button"
            onClick={onClose}
            className="mt-4 text-xs text-muted-foreground underline underline-offset-4"
            data-testid="first-post-later"
          >
            Later
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
