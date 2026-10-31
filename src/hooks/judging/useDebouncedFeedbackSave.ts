import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { normalizePhotoIndex } from "./types";
import { submitJudgeScoreEdge } from "@/lib/judgingApi";
import { reportSaveError, clearSaveError } from "@/lib/judging/saveErrorStore";
import { useSystemFlag } from "@/lib/useSystemFlag";



/**
 * Debounced auto-save for judge feedback (notes).
 * FIX: Uses upsert instead of update — feedback is saved even if no score row exists yet.
 * FIX CN-BUG-04: Captures photo key at timer creation; aborts if photo changed.
 */
export function useDebouncedFeedbackSave(
  userId: string | undefined,
  entryId: string | null,
  photoIndex: number | null,
  roundNumber: number | undefined,
  feedbackValue: string,
  enabled: boolean,
  debounceMs = 800,
  onSaved?: () => void,
  /** MASTER-KEY seat mode: admin-only; store under this judge's identity. */
  seatJudgeId?: string,
) {
  // Identity every write is stamped under (seat judge, else self).
  const effectiveJudgeId = seatJudgeId ?? userId;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>("");
  const prevKeyRef = useRef<string>("");
  // FIX CN-BUG-04: Track the *current* photo key so the timeout can check staleness
  const currentKeyRef = useRef<string>("");
  // F-01 Phase C: When ON, edge-fn failure surfaces silently (no raw fallback).
  const edgeAuthoritative = useSystemFlag("judge_edge_authoritative");


  // Reset last-saved when photo changes
  const currentKey = entryId && photoIndex !== null ? `${entryId}::${normalizePhotoIndex(photoIndex)}` : "";
  currentKeyRef.current = currentKey;

  useEffect(() => {
    if (currentKey !== prevKeyRef.current) {
      prevKeyRef.current = currentKey;
      lastSavedRef.current = feedbackValue;
      // Cancel any pending save from the previous photo
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [currentKey, feedbackValue]);

  useEffect(() => {
    if (!enabled || !userId || !entryId || photoIndex === null) return;
    if (feedbackValue === lastSavedRef.current) return;

    if (timerRef.current) clearTimeout(timerRef.current);

    // Capture the key at the time the timer is set
    const capturedKey = currentKeyRef.current;
    const capturedEntryId = entryId;
    const capturedPhotoIndex = photoIndex;

    timerRef.current = setTimeout(async () => {
      // FIX CN-BUG-04: Abort if user navigated to a different photo during debounce
      if (currentKeyRef.current !== capturedKey) return;

      const pi = normalizePhotoIndex(capturedPhotoIndex);
      const trimmed = feedbackValue.trim() || null;

      // F-01 Phase B-completion: route feedback autosave through edge fn
      // (server enforces round-lock + assignment + payload validation).
      // Direct upsert remains as a fallback on edge failure (safe mode).
      const edgeResult = await submitJudgeScoreEdge({
        entry_id: capturedEntryId,
        photo_index: pi,
        round_number: roundNumber ?? 1,
        feedback: trimmed,
        as_judge_id: seatJudgeId,
      });

      let error: { message: string } | null = null;

      if (!edgeResult.ok && !edgeAuthoritative) {
        // Fallback: update-first (avoid phantom score:0 rows), else upsert with feedback only.
        const { data: existing } = await supabase
          .from("judge_scores")
          .select("id")
          .eq("entry_id", capturedEntryId)
          .eq("photo_index", pi)
          .eq("judge_id", effectiveJudgeId!)
          .eq("round_number", roundNumber ?? 1)
          .maybeSingle();

        if (existing) {
          ({ error } = await supabase
            .from("judge_scores")
            .update({ feedback: trimmed })
            .eq("entry_id", capturedEntryId)
            .eq("photo_index", pi)
            .eq("judge_id", effectiveJudgeId!)
            .eq("round_number", roundNumber ?? 1));
        } else {
          ({ error } = await supabase
            .from("judge_scores")
            .upsert(
              { entry_id: capturedEntryId, photo_index: pi, judge_id: effectiveJudgeId!, round_number: roundNumber ?? 1, feedback: trimmed },
              { onConflict: "entry_id,judge_id,round_number,photo_index" }
            ));
        }
      }

      // If the edge-authoritative flag is ON, edge failure is the definitive
      // outcome (no fallback). Capture it so the photo gets a red highlight.
      if (!edgeResult.ok && edgeAuthoritative) {
        error = { message: (edgeResult as any).error ?? "Feedback save failed" };
      }

      if (error) {
        reportSaveError(capturedEntryId, pi, "feedback", error.message);
      } else {
        clearSaveError(capturedEntryId, pi);
        lastSavedRef.current = feedbackValue;
        onSaved?.();
      }
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [feedbackValue, userId, entryId, photoIndex, roundNumber, enabled, debounceMs]);

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);
}
