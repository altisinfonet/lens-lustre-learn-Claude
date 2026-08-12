/**
 * WHEN THE COMPOSER IS ALLOWED TO WRITE ANYTHING.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A SEPARATE PURE MODULE AND NOT LOGIC INSIDE THE MODAL
 *
 * Two of Stage C's requirements are about what must NOT happen:
 *
 *   1. Create → pick photos → write → categories → Save → leave → Drafts →
 *      Resume → edit → Publish   ................ must work end to end
 *   2. Create → pick photos → leave WITHOUT Save
 *      ............ must NOT create a draft and must NOT upload any image
 *
 * The second is a negative, and negatives buried in component callbacks are
 * exactly what nobody notices breaking: an extra `useEffect`, an autosave that
 * fires once on mount, a "helpful" upload-early optimisation, and suddenly
 * every abandoned compose session costs storage and litters the drafts list.
 * Nothing throws. Nothing looks wrong.
 *
 * So the decision lives here, as a pure function over an explicit state, and
 * the modal does only what this returns. That makes both sequences testable
 * without a browser, a database, or a rendered component.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE, IN ONE LINE
 *
 * `draftId === null` means NOTHING has been persisted — no row, no upload.
 * Only `save` may move out of that state. Nothing else, ever.
 */

/** What the composer knows about itself. */
export interface ComposerState {
  /** Non-null once - and only once - the member has pressed Save. */
  draftId: string | null;
  /** True when the member has photos selected that are still only in memory. */
  hasLocalImages: boolean;
}

export type ComposerEvent =
  /** Any change to caption, categories, photos, privacy, tags. */
  | { type: "edit" }
  /** The member pressed Save. The ONLY event that may begin persistence. */
  | { type: "save" }
  /** The composer was closed, dismissed, or navigated away from. */
  | { type: "close" }
  /** The member pressed Post / Share. */
  | { type: "publish" }
  /** A draft was opened from the Drafts list. */
  | { type: "resume"; draftId: string };

/**
 * Everything the composer is permitted to do in response to one event.
 * Every field defaults to false: the safe answer is always "do nothing".
 */
export interface PersistenceAction {
  /** Upload the in-memory photos to storage. */
  uploadImages: boolean;
  /** INSERT a post_drafts row. */
  createDraft: boolean;
  /** UPDATE the existing post_drafts row (autosave). */
  updateDraft: boolean;
  /** Insert straight into posts — the existing, untouched direct path. */
  directPublish: boolean;
  /** Call publish_post_draft(draftId). */
  publishDraft: boolean;
}

const NOTHING: PersistenceAction = {
  uploadImages: false,
  createDraft: false,
  updateDraft: false,
  directPublish: false,
  publishDraft: false,
};

/**
 * The whole persistence policy.
 *
 * Returns a fresh object every call so a caller cannot mutate the shared
 * NOTHING constant and quietly change the default for everyone else.
 */
export function decidePersistence(
  state: ComposerState,
  event: ComposerEvent,
): PersistenceAction {
  switch (event.type) {
    // ── The negative requirement ─────────────────────────────────────────────
    // Closing NEVER writes anything. Not a row, not an upload, not a "just in
    // case" autosave on unmount. If the member wanted it kept, they had a Save
    // button. This single line is requirement 2.
    case "close":
      return { ...NOTHING };

    // ── Typing, picking photos, choosing categories ──────────────────────────
    // Before the first Save this is deliberately inert: an unsaved composer
    // holds its photos in memory and costs nothing. After the first Save,
    // the same event is autosave - it UPDATES, and can never create.
    case "edit":
      return state.draftId
        ? { ...NOTHING, updateDraft: true }
        : { ...NOTHING };

    // ── The only door into persistence ───────────────────────────────────────
    // First Save uploads the photos and creates the row. Later Saves just
    // update, because the images are already in storage and re-uploading them
    // would orphan the originals.
    case "save":
      return state.draftId
        ? { ...NOTHING, updateDraft: true }
        : { ...NOTHING, uploadImages: state.hasLocalImages, createDraft: true };

    // ── Publishing ───────────────────────────────────────────────────────────
    // A composer that was never saved publishes through the EXISTING direct
    // path, untouched and proven. Only a real draft goes through the RPC.
    // Creating a throwaway draft just to publish it would put a row and an
    // upload in the way of the most common action on the site.
    case "publish":
      return state.draftId
        ? { ...NOTHING, publishDraft: true }
        : { ...NOTHING, uploadImages: state.hasLocalImages, directPublish: true };

    // ── Opening a draft ──────────────────────────────────────────────────────
    // Reading is not writing. Resuming must not touch storage: the images are
    // already there and belong to the row.
    case "resume":
      return { ...NOTHING };

    default:
      return { ...NOTHING };
  }
}

/** The state after an event, given what actually succeeded. */
export function nextComposerState(
  state: ComposerState,
  event: ComposerEvent,
  outcome?: { createdDraftId?: string },
): ComposerState {
  switch (event.type) {
    case "resume":
      return { draftId: event.draftId, hasLocalImages: false };
    case "save":
      return outcome?.createdDraftId
        ? { draftId: outcome.createdDraftId, hasLocalImages: false }
        : state;
    case "publish":
      // Published either way: the draft is gone, the composer resets.
      return { draftId: null, hasLocalImages: false };
    case "close":
      // Closing an UNSAVED composer discards the in-memory photos. Closing a
      // saved one leaves the row alone - it is in Drafts, which is the point.
      return { draftId: state.draftId, hasLocalImages: false };
    default:
      return state;
  }
}
