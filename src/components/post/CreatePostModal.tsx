/**
 * THE CREATE COMPOSER — three steps on web, full-screen on a phone.
 *
 *   1  compose   caption, audience, the "add to your post" bar, Drafts (n)
 *   2  media     photos chosen, caption visible, Next enabled
 *   3  settings  preview, audience row, scheduling row, CATEGORY CHIPS,
 *                Save draft / Post
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS COMPONENT DECIDES NOTHING ABOUT PERSISTENCE.
 *
 * Every write goes through `decidePersistence()`. The modal asks "given where I
 * am and what just happened, what am I allowed to write?" and does exactly
 * that. It never calls createDraft, updateDraft or an upload on its own
 * initiative.
 *
 * That is not ceremony. The rule "closing the composer must not create a draft
 * or upload anything" is a NEGATIVE, and negatives rot silently: one stray
 * `useEffect(..., [])` that autosaves on unmount and every abandoned session
 * starts costing storage, with no error and nothing on screen to notice. Making
 * the policy a pure function keeps it testable and keeps this file honest.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOT TOUCHED HERE: hashtag parsing (read-time, from posts.content) and
 * people-tagging (TagPeopleModal → post_tags, with coordinates). Both are
 * carried through unchanged.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, X, Globe, Clock, Tags, Images, UserPlus, FileText } from "lucide-react";
import CategoryChips, { canPublishCategories } from "@/components/post/CategoryChips";
import { useIsMobile } from "@/hooks/core/use-mobile";
import { decidePersistence, nextComposerState, type ComposerState } from "@/lib/post/draftPersistence";
import { useT } from "@/i18n/I18nContext";
import { cn } from "@/lib/utils";

export type ComposerStep = 1 | 2 | 3;

export interface ComposerDraftShape {
  content: string;
  categories: string[];
  privacy: string;
  scheduledFor: string | null;
}

export interface CreatePostModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;

  /** Resumed draft id, or null for a fresh composer. */
  draftId: string | null;
  /** Photos currently held in memory (not yet uploaded). */
  localImageCount: number;
  /** Previews for the photos in memory, or the stored URLs of a resumed draft. */
  previews: string[];

  value: ComposerDraftShape;
  onChange: (next: ComposerDraftShape) => void;

  /** How many drafts the member has. Drives the Drafts (n) affordance. */
  draftCount: number;
  onOpenDrafts: () => void;
  onPickPhotos: () => void;
  onTagPeople: () => void;

  /** Runs the action the policy returned. The modal never persists directly. */
  onPersist: (
    action: ReturnType<typeof decidePersistence>,
    state: ComposerState,
  ) => Promise<{ createdDraftId?: string } | void>;

  busy?: boolean;
}

const AUTOSAVE_DEBOUNCE_MS = 3_000;

export default function CreatePostModal({
  open, onOpenChange, draftId, localImageCount, previews,
  value, onChange, draftCount, onOpenDrafts, onPickPhotos, onTagPeople,
  onPersist, busy = false,
}: CreatePostModalProps) {
  const isMobile = useIsMobile();
  const t = useT();
  const [step, setStep] = useState<ComposerStep>(1);

  const state: ComposerState = useMemo(
    () => ({ draftId, hasLocalImages: localImageCount > 0 }),
    [draftId, localImageCount],
  );

  // Latest state for the debounced autosave, so a timer that fires after a
  // re-render still sees the truth rather than the values it closed over.
  const stateRef = useRef(state);
  stateRef.current = state;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(
    async (event: Parameters<typeof decidePersistence>[1]) => {
      const s = stateRef.current;
      const action = decidePersistence(s, event);
      // Nothing to do is the common case before the first Save. Don't call out.
      if (!Object.values(action).some(Boolean)) return;
      await onPersist(action, s);
    },
    [onPersist],
  );

  /**
   * Autosave. Fires only when a draft already exists — the policy returns a
   * no-op otherwise, and `run` short-circuits.
   */
  useEffect(() => {
    if (!open || !draftId) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void run({ type: "edit" }); }, AUTOSAVE_DEBOUNCE_MS);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [open, draftId, value, run]);

  /**
   * ⚠ CLOSING WRITES NOTHING. There is deliberately no autosave-on-unmount
   * here, and there must never be one: it would turn every abandoned compose
   * session into a stored draft with uploaded photos. `decidePersistence`
   * returns an empty action for `close`, and this handler exists only to reset
   * the step.
   */
  const handleClose = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setStep(1);
    onOpenChange(false);
  }, [onOpenChange]);

  const handleSave = useCallback(async () => {
    const s = stateRef.current;
    const result = await onPersist(decidePersistence(s, { type: "save" }), s);
    // `onPersist` may return void; the state transition takes an optional
    // outcome, so normalise rather than widening the signature and losing the
    // guarantee that a caller must hand back the new id when it creates one.
    nextComposerState(s, { type: "save" }, result || undefined);
  }, [onPersist]);

  const handlePublish = useCallback(async () => {
    const s = stateRef.current;
    await onPersist(decidePersistence(s, { type: "publish" }), s);
    handleClose();
  }, [onPersist, handleClose]);

  const canGoToMedia = value.content.trim().length > 0 || previews.length > 0;
  const canPublish = canPublishCategories(value.categories) && !busy;

  const Row = ({ icon: Icon, label, sub, onClick }: {
    icon: typeof Globe; label: string; sub?: string; onClick?: () => void;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-1 py-3 text-left hover:bg-muted/40"
    >
      <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="flex-1">
        <span className="block text-sm font-medium">{label}</span>
        {sub && <span className="block text-xs text-muted-foreground">{sub}</span>}
      </span>
      <span aria-hidden="true" className="text-muted-foreground">›</span>
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : handleClose())}>
      <DialogContent
        className={cn(
          "gap-0 p-0",
          // Full-screen on a phone: a three-step centred modal is unusable at
          // that width, and the app runs at exactly this size.
          isMobile
            ? "h-[100dvh] max-h-[100dvh] w-screen max-w-none rounded-none"
            : "max-w-lg",
        )}
      >
        <header className="flex items-center gap-2 border-b px-4 py-3">
          {step === 1 ? (
            <button type="button" onClick={handleClose} aria-label="Close" className="p-1">
              <X className="h-5 w-5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setStep((s) => (s === 3 ? 2 : 1))}
              aria-label="Back"
              className="p-1"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <h2 className="flex-1 text-center text-base font-semibold">
            {step === 3
              ? t("post.settings.title", "Post settings")
              : t("post.create.title", "Create post")}
          </h2>
          {step < 3 ? (
            <Button size="sm" variant="ghost" disabled={!canGoToMedia}
              onClick={() => setStep(step === 1 ? 2 : 3)}>
              {t("post.next", "Next")}
            </Button>
          ) : <span className="w-12" />}
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {step < 3 && (
            <>
              <Textarea
                value={value.content}
                onChange={(e) => onChange({ ...value, content: e.target.value })}
                placeholder={t("post.create.placeholder", "Share your photograph…")}
                className="min-h-[120px] resize-none border-0 px-0 text-lg focus-visible:ring-0"
              />

              {previews.length > 0 && (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {previews.slice(0, 6).map((src, i) => (
                    <img key={i} src={src} alt="" className="aspect-square w-full rounded-md object-cover" />
                  ))}
                </div>
              )}

              <div className="mt-4 flex items-center gap-1 rounded-lg border p-2">
                <span className="flex-1 pl-1 text-sm font-medium">
                  {t("post.create.addTo", "Add to your post")}
                </span>
                <button type="button" onClick={onPickPhotos} aria-label="Add photos" className="p-2">
                  <Images className="h-5 w-5 text-emerald-500" />
                </button>
                <button type="button" onClick={onTagPeople} aria-label="Tag people" className="p-2">
                  <UserPlus className="h-5 w-5 text-sky-500" />
                </button>
              </div>

              {/* Drafts are visible, not buried in a settings screen. */}
              {draftCount > 0 && (
                <button
                  type="button"
                  onClick={onOpenDrafts}
                  className="mt-3 inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                >
                  <FileText className="h-4 w-4" />
                  {t("post.drafts.open", "Drafts")} ({draftCount})
                </button>
              )}
            </>
          )}

          {step === 3 && (
            <>
              <div className="flex items-center gap-3 pb-3">
                {previews[0] && (
                  <img src={previews[0]} alt="" className="h-16 w-16 rounded-md object-cover" />
                )}
                <p className="line-clamp-3 text-sm">{value.content}</p>
              </div>
              <div className="divide-y border-y">
                <Row icon={Globe} label={t("post.audience", "Post audience")} sub={value.privacy} />
                <Row
                  icon={Clock}
                  label={t("post.scheduling", "Scheduling options")}
                  sub={value.scheduledFor
                    ? new Date(value.scheduledFor).toLocaleString()
                    : t("post.publishNow", "Publish now")}
                />
              </div>

              {/* Option B: the chips live here, not behind another tap. */}
              <div className="pt-4">
                <CategoryChips
                  value={value.categories}
                  onChange={(categories) => onChange({ ...value, categories })}
                />
              </div>

              {!canPublishCategories(value.categories) && (
                <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Tags className="h-3.5 w-3.5" />
                  {t("post.categories.required", "Choose at least one category to post")}
                </p>
              )}
            </>
          )}
        </div>

        {step === 3 && (
          <footer className="flex gap-2 border-t px-4 py-3">
            {/* Save = save draft. Scheduling is its own row above. */}
            <Button variant="secondary" className="flex-1" disabled={busy} onClick={handleSave}>
              {t("post.saveDraft", "Save draft")}
            </Button>
            <Button className="flex-1" disabled={!canPublish} onClick={handlePublish}>
              {t("post.publish", "Post")}
            </Button>
          </footer>
        )}
      </DialogContent>
    </Dialog>
  );
}
