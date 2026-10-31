/**
 * saveErrorStore — per-photo save error registry.
 *
 * Judge actions (score / tag / comment / feedback) call `reportSaveError` when
 * the backend rejects a write, and `clearSaveError` when the same slot next
 * saves successfully. UI (photo grid, list view, full view) reads via
 * `useSaveError(entryId, photoIndex)` to paint a destructive ring + tooltip
 * so the judge can see WHICH photo failed and WHAT the reason was — instead
 * of just a transient toast that disappears.
 */
import { useSyncExternalStore } from "react";

export interface SaveError {
  message: string;
  kind: "score" | "tag" | "comment" | "feedback";
  at: number;
}

type Key = string; // `${entryId}::${photoIndex}`
const store = new Map<Key, SaveError>();
const listeners = new Set<() => void>();

const keyOf = (entryId: string, photoIndex: number) => `${entryId}::${photoIndex}`;

function emit() {
  listeners.forEach((l) => l());
}

export function reportSaveError(
  entryId: string,
  photoIndex: number,
  kind: SaveError["kind"],
  message: string,
) {
  store.set(keyOf(entryId, photoIndex), { message, kind, at: Date.now() });
  emit();
}

export function clearSaveError(entryId: string, photoIndex: number) {
  if (store.delete(keyOf(entryId, photoIndex))) emit();
}

export function clearAllSaveErrors() {
  if (store.size === 0) return;
  store.clear();
  emit();
}

export function getSaveError(entryId: string, photoIndex: number): SaveError | null {
  return store.get(keyOf(entryId, photoIndex)) ?? null;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** React hook — reactive read for a single (entry, photo) slot. */
export function useSaveError(entryId: string | undefined, photoIndex: number | undefined): SaveError | null {
  return useSyncExternalStore(
    subscribe,
    () => (entryId != null && photoIndex != null ? store.get(keyOf(entryId, photoIndex)) ?? null : null),
    () => null,
  );
}

/** React hook — total count of photos currently in an error state (for headers). */
export function useSaveErrorCount(): number {
  return useSyncExternalStore(
    subscribe,
    () => store.size,
    () => 0,
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * unjudgedEntriesStore — per-entry backend "not judged yet" registry.
 *
 * When the judge clicks "Complete Round" and the `complete-round` edge fn
 * responds 409 with `unjudged_ids` / `needs_review_ids`, JudgePanel calls
 * `flagUnjudgedEntries` to push those IDs here. The grid's PhotoCell then
 * paints an amber pulsing ring + bottom badge on every photo of those
 * entries so the judge can see EXACTLY which cards are blocking the round.
 * Cleared on the next successful round completion (or manual dismiss).
 * ──────────────────────────────────────────────────────────────────────── */

export type UnjudgedReason = "missing_scores" | "needs_review_unresolved" | "missing_decisions";

export interface UnjudgedFlag {
  reason: UnjudgedReason;
  message: string;
  at: number;
}

const unjudgedStore = new Map<string, UnjudgedFlag>(); // entryId → flag
const unjudgedListeners = new Set<() => void>();

function emitUnjudged() {
  unjudgedListeners.forEach((l) => l());
}

export function flagUnjudgedEntries(entryIds: string[], reason: UnjudgedReason, message: string) {
  if (!entryIds || entryIds.length === 0) return;
  const now = Date.now();
  for (const id of entryIds) {
    if (!id) continue;
    unjudgedStore.set(id, { reason, message, at: now });
  }
  emitUnjudged();
}

export function clearUnjudgedEntries() {
  if (unjudgedStore.size === 0) return;
  unjudgedStore.clear();
  emitUnjudged();
}

function subscribeUnjudged(l: () => void) {
  unjudgedListeners.add(l);
  return () => {
    unjudgedListeners.delete(l);
  };
}

/** React hook — reactive read for a single entry. Null when not flagged. */
export function useUnjudgedEntry(entryId: string | undefined): UnjudgedFlag | null {
  return useSyncExternalStore(
    subscribeUnjudged,
    () => (entryId ? unjudgedStore.get(entryId) ?? null : null),
    () => null,
  );
}

/** React hook — total count of flagged entries (for header banners). */
export function useUnjudgedEntryCount(): number {
  return useSyncExternalStore(
    subscribeUnjudged,
    () => unjudgedStore.size,
    () => 0,
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * incompletePhotoStore — per-PHOTO backend "missing criteria" registry (Fix C).
 *
 * When Complete Round returns 409 `scores_incomplete` with an enriched
 * `sample[]` carrying (entry_id, photo_index, entry_title, photo_label,
 * missing_criteria_labels[]), JudgePanel calls `flagIncompletePhotos` to
 * push those rows here. PhotoCell reads via `useIncompletePhoto(entryId,
 * photoIndex)` to paint an amber pulsing ring + bottom badge that names
 * the EXACT criteria the judge still needs to fill (Line, Shape, …).
 * Cleared on the next successful round completion.
 * ──────────────────────────────────────────────────────────────────────── */

export interface IncompletePhotoFlag {
  entryTitle: string | null;
  photoLabel: string;
  missingCriteriaLabels: string[];
  at: number;
}

const incompletePhotoStore = new Map<Key, IncompletePhotoFlag>(); // `entryId::photoIndex` → flag
const incompletePhotoListeners = new Set<() => void>();

function emitIncompletePhoto() {
  incompletePhotoListeners.forEach((l) => l());
}

export function flagIncompletePhotos(
  rows: {
    entry_id: string;
    photo_index: number;
    entry_title?: string | null;
    photo_label?: string | null;
    missing_criteria_labels?: string[] | null;
  }[],
) {
  if (!rows || rows.length === 0) return;
  const now = Date.now();
  for (const r of rows) {
    if (!r?.entry_id || typeof r.photo_index !== "number") continue;
    incompletePhotoStore.set(keyOf(r.entry_id, r.photo_index), {
      entryTitle: r.entry_title ?? null,
      photoLabel: (r.photo_label && r.photo_label.trim()) || `Photo ${r.photo_index + 1}`,
      missingCriteriaLabels: Array.isArray(r.missing_criteria_labels) ? r.missing_criteria_labels : [],
      at: now,
    });
  }
  emitIncompletePhoto();
}

export function clearIncompletePhotos() {
  if (incompletePhotoStore.size === 0) return;
  incompletePhotoStore.clear();
  emitIncompletePhoto();
}

function subscribeIncompletePhoto(l: () => void) {
  incompletePhotoListeners.add(l);
  return () => {
    incompletePhotoListeners.delete(l);
  };
}

export function useIncompletePhoto(
  entryId: string | undefined,
  photoIndex: number | undefined,
): IncompletePhotoFlag | null {
  return useSyncExternalStore(
    subscribeIncompletePhoto,
    () => (entryId != null && photoIndex != null ? incompletePhotoStore.get(keyOf(entryId, photoIndex)) ?? null : null),
    () => null,
  );
}

/** Return the first flagged (entry, photo) — for auto-scroll after error. */
export function getFirstIncompletePhotoKey(): { entryId: string; photoIndex: number } | null {
  const iter = incompletePhotoStore.keys().next();
  if (iter.done) return null;
  const [entryId, pi] = iter.value.split("::");
  return { entryId, photoIndex: Number(pi) };
}

