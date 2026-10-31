/**
 * WHAT "ONLY ME" AND "FRIENDS" DO NOT YET COVER, SAID PLAINLY, IN THE UI.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS COMPONENT EXISTS. The audience chooser was withheld from the
 * composer on 2026-08-16 (docs/DECISIONS.md D-001) for a reason that is still
 * true: the database honours a post's privacy, the feed honours it, eight of
 * the nine surfaces in the visibility invariant honour it — and the direct
 * image URL does not. The `post-images` bucket is public and its
 * `storage.objects` SELECT policy is `(bucket_id = 'post-images')`, with no
 * privacy condition at all. So the photograph behind a restricted post stays
 * fetchable by anyone holding its link.
 *
 * The owner was told that plainly, including that hiding the link inside the
 * app does NOT fix it — the file is served with no server-side check, so a URL
 * obtained at any point keeps working — and chose to restore the chooser
 * anyway rather than keep members waiting (D-002).
 *
 * ⚠ THIS NOTICE IS THE CONDITION OF THAT DECISION. Restoring the control
 * WITHOUT it would be the precise thing the withholding existed to prevent: a
 * control that promises more than the platform can keep. With it, a member
 * choosing "Only me" is choosing it knowing what it does and does not cover,
 * which is a different and honest thing.
 *
 * IT DISAPPEARS BY ITSELF. Public posts show nothing, because for a public post
 * there is no gap to disclose. And when authorized media delivery goes live the
 * whole component is deleted — D-002 names that condition, and
 * `PrivacyGapDisclosed.test.ts` fails if the chooser is offered without it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠ THE SECOND SENTENCE WAS REMOVED ON 2026-08-29, AND THE GAP WAS NOT CLOSED.
 *
 * Until that day this read:
 *
 *     "{who} will see this post on 50mm Retina World. The photo file itself can
 *      still be opened by anyone who has its direct link — we are still building
 *      that protection."
 *
 * The owner shortened it to the first sentence alone. It is a UI-COPY decision,
 * taken deliberately and confirmed with him — NOT the removal of a disclosure
 * that had become unnecessary, and NOT evidence that the underlying fault was
 * fixed.
 *
 * Be clear about what that means, because the paragraphs above no longer
 * describe what a member reads: `post-images` is still a public bucket whose
 * `storage.objects` SELECT policy is `(bucket_id = 'post-images')` with no
 * privacy condition, the photograph behind an "Only me" post is still fetchable
 * by anyone holding its URL, and this notice no longer says so. D-002 stays
 * OPEN and is closed by authorized media delivery going live — see
 * docs/DECISIONS.md, where the 2026-08-29 change is recorded so that it is not
 * later mistaken for an accidental deletion.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { Info } from "lucide-react";

/** The privacy values that carry the gap. `public` promises nothing extra. */
export type RestrictedPrivacy = "friends" | "private";

export function privacyHasFileGap(privacy: string): privacy is RestrictedPrivacy {
  return privacy === "friends" || privacy === "private";
}

/**
 * Deliberately NOT a warning colour and not a blocking dialog. This is not an
 * error and the member has done nothing wrong — it is the one true thing they
 * need in order to choose well. Styled as a quiet note so it informs rather
 * than alarms, and so it does not train people to dismiss it unread.
 */
export function PrivacyGapNotice({ privacy }: { privacy: string }) {
  if (!privacyHasFileGap(privacy)) return null;
  const who = privacy === "private" ? "Only you" : "Only your friends";
  return (
    <div
      role="note"
      data-testid="privacy-gap-notice"
      className="mt-2 flex items-start gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground"
    >
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{who} will see this post on 50mm Retina World.</span>
    </div>
  );
}
