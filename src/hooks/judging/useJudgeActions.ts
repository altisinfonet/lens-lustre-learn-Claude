/**
 * Mutation handlers for judge scoring, tagging, comments, clearing, and round decisions.
 * 
 * FIX 1: R1 decisions now write to judge_decisions table (DB trigger syncs status).
 * FIX 5: Strict lock blocks ALL actions including admin.
 * FIX 7: Legacy score-based R1 classification removed.
 * R2 decisions: Qualified, Shortlisted for R3, Needs Review.
 */
import { useCallback, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import { normalizePhotoIndex } from "./types";
import type { JudgeComment, CriteriaScores } from "./types";
import { submitJudgeScoreEdge, submitJudgeTagEdge, submitJudgeCommentEdge } from "@/lib/judgingApi";
import { reportSaveError, clearSaveError } from "@/lib/judging/saveErrorStore";
import { tagLabelToDecision } from "./tagLabelToDecision";
import { probeDecisionParity } from "./decisionParityProbe";
import { useSystemFlag } from "@/lib/useSystemFlag";



// Judging v5: Round1/2/3 decision panels were removed (tag-only decisions).
// The legacy Round1Decision / Round2Decision / Round3Decision union types and
// DECISION_TO_DB / R2_DECISION_TO_DB / R3_DECISION_TO_DB lookup maps are no
// longer imported — all judge decisions now flow through `toggleTag`.

interface UseJudgeActionsArgs {
  userId: string | undefined;
  isAdmin: boolean;
  isRoundLocked: boolean;
  selectedRound: string | null;
  roundMode?: "scoring" | "tagging" | "decision";
  roundNumber?: number;
  sowRoundLogic?: boolean;
  /** SOW flag: enforce_strict_round_lock */
  strictLockFlag?: boolean;
  updateScoreOptimistic: (key: string, score: number, feedback: string | null, criteria?: CriteriaScores) => void;
  updateTagOptimistic: (key: string, newMyTags: string[], newAllTags: { tag_id: string; judge_id: string }[]) => void;
  addCommentOptimistic: (key: string, comment: JudgeComment) => void;
  clearOptimistic: (key: string, clearAll: boolean) => void;
  updateDecisionOptimistic: (entryId: string, photoIndex: number, decision: string, roundNumber: number) => void;
  invalidatePhotoData: () => void;
  lockMutation: () => void;
  unlockMutation: () => void;
  getMyTags: (photoKey: string) => string[];
  getAllTags: (photoKey: string) => { tag_id: string; judge_id: string }[];
  goNext: () => void;
}

export function useJudgeActions({
  userId,
  isAdmin,
  isRoundLocked,
  selectedRound,
  roundMode,
  roundNumber,
  sowRoundLogic,
  strictLockFlag,
  updateScoreOptimistic,
  updateTagOptimistic,
  addCommentOptimistic,
  clearOptimistic,
  updateDecisionOptimistic,
  invalidatePhotoData,
  lockMutation,
  unlockMutation,
  getMyTags,
  getAllTags,
  goNext,
}: UseJudgeActionsArgs) {
  const [scoringEntry, setScoringEntry] = useState<string | null>(null);
  const [taggingEntry, setTaggingEntry] = useState<string | null>(null);
  const feedbackRef = useRef("");
  // F-01 Phase C: When ON, edge-fn failure surfaces an error instead of
  // silently falling back to a raw client write. Default OFF (dual-write).
  const edgeAuthoritative = useSystemFlag("judge_edge_authoritative");

  const setFeedbackRef = useCallback((v: string) => { feedbackRef.current = v; }, []);


  // FIX 5: Centralized lock check — blocks ALL users when strict lock is on
  const isEffectivelyLocked = isRoundLocked && (!isAdmin || strictLockFlag);

  const handleQuickScore = useCallback(async (
    entryId: string,
    photoIndex: number,
    score: number,
    options?: { silent?: boolean; skipAdvance?: boolean; criteria?: CriteriaScores },
  ) => {
    if (!userId) return;

    // SOW: marks remain editable alongside tag-based judging flows.
    // R1 / R2 / R3 may still use tags for the decision, but judges must be
    // able to save or revise marks at any time before the round is locked.

    // FIX 5: Use effective lock
    if (isEffectivelyLocked) {
      toast({ title: "Round is completed", description: "Scoring is locked.", variant: "destructive" });
      return;
    }

    const normalizedPI = normalizePhotoIndex(photoIndex);
    const scoreKey = `${entryId}::${normalizedPI}`;
    setScoringEntry(scoreKey);
    lockMutation();

    const currentFeedback = feedbackRef.current?.trim() || null;
    const upsertData: any = {
      entry_id: entryId,
      photo_index: normalizedPI,
      judge_id: userId,
      round_number: roundNumber ?? 1,
      score,
      feedback: currentFeedback,
    };
    if (options?.criteria) {
      upsertData.composition_score = options.criteria.composition;
      upsertData.color_palette_score = options.criteria.color_palette;
      upsertData.technique_score = options.criteria.technique;
      upsertData.line_score = options.criteria.line;
      upsertData.shape_score = options.criteria.shape;
      upsertData.form_score = options.criteria.form;
      upsertData.texture_score = options.criteria.texture;
      upsertData.space_score = options.criteria.space;
      upsertData.tone_score = options.criteria.tone;
      upsertData.balance_score = options.criteria.balance;
      upsertData.light_score = options.criteria.light;
      upsertData.depth_score = options.criteria.depth;
    }

    // [SAVE-LOG] Client-side trace — visible in browser DevTools → Console.
    // Filter the console with the substring `[SAVE-LOG]` to see every save attempt.
    const logKey = `entry=${entryId} photo=${normalizedPI} round=${roundNumber ?? 1} judge=${userId}`;
    console.log(`[SAVE-LOG] submit:start ${logKey} score=${score} criteria=${options?.criteria ? "yes" : "no"}`);

    // Canonical path: validated backend function first.
    // Direct table upsert remains only as a fallback when the function fails.
    const edgeResult = await submitJudgeScoreEdge({
      entry_id: entryId,
      photo_index: normalizedPI,
      round_number: roundNumber ?? 0,
      score,
      feedback: currentFeedback,
      // Phase 5 SOW: edge function rejects legacy composition_score / technique_score.
      // Send ONLY the 10 SOW criteria to the edge fn. Legacy values still go via
      // the direct PostgREST upsert below (audit-trail columns retained in DB).
      criteria: options?.criteria
        ? {
            color_palette_score: options.criteria.color_palette,
            line_score: options.criteria.line,
            shape_score: options.criteria.shape,
            form_score: options.criteria.form,
            texture_score: options.criteria.texture,
            space_score: options.criteria.space,
            tone_score: options.criteria.tone,
            balance_score: options.criteria.balance,
            light_score: options.criteria.light,
            depth_score: options.criteria.depth,
          }
        : undefined,
    });

    let error: { message: string } | null = null;
    let writePath: "edge" | "fallback" = "edge";

    if (!edgeResult.ok) {
      if (edgeAuthoritative) {
        // F-01 Phase C: flag ON — edge fn is the ONLY allowed writer.
        console.error(`[SAVE-LOG] edge:FAILED ${logKey} err=${(edgeResult as any).error ?? "unknown"} (flag=edgeAuthoritative, NO fallback)`);
        error = { message: (edgeResult as any).error ?? "Edge function failed" };
      } else {
        console.warn(`[SAVE-LOG] edge:FAILED ${logKey} err=${(edgeResult as any).error ?? "unknown"} → falling back to direct upsert`);
        writePath = "fallback";
        const fallback = await supabase
          .from("judge_scores")
          .upsert(upsertData, { onConflict: "entry_id,judge_id,round_number,photo_index" });
        error = fallback.error ? { message: fallback.error.message } : null;
      }
    } else {
      console.log(`[SAVE-LOG] edge:OK ${logKey} db_score=${(edgeResult as any).verification?.score} db_updated_at=${(edgeResult as any).verification?.updated_at}`);
    }


    if (error) {
      console.error(`[SAVE-LOG] submit:FAILED ${logKey} path=${writePath} err=${error.message}`);
      unlockMutation();
      setScoringEntry(null);
      reportSaveError(entryId, normalizedPI, "score", error.message);
      toast({ title: `Failed to save score — Photo ${normalizedPI + 1}`, description: error.message, variant: "destructive" });
      invalidatePhotoData();
      return;
    }

    // [SAVE-LOG] Post-save verification read-back from the client.
    // Re-reads judge_scores for THIS slot to prove the row is actually there.
    // If missing, surface a destructive toast so the judge knows the save
    // silently dropped (this is exactly the "marked area didn't persist" case).
    const { data: verifyRow, error: verifyErr } = await supabase
      .from("judge_scores")
      .select("score,updated_at")
      .eq("entry_id", entryId)
      .eq("judge_id", userId)
      .eq("round_number", roundNumber ?? 1)
      .eq("photo_index", normalizedPI)
      .maybeSingle();

    if (verifyErr || !verifyRow) {
      console.error(`[SAVE-LOG] verify:MISSING ${logKey} path=${writePath} err=${verifyErr?.message ?? "no row"}`);
      unlockMutation();
      setScoringEntry(null);
      const msg = `Row missing after save. Click Submit again or reload.`;
      reportSaveError(entryId, normalizedPI, "score", msg);
      toast({
        title: `Save did not persist — Photo ${normalizedPI + 1}`,
        description: msg,
        variant: "destructive",
        duration: 6000,
      });
      invalidatePhotoData();
      return;
    }
    // Success — clear any prior error highlight for this slot.
    clearSaveError(entryId, normalizedPI);
    console.log(`[SAVE-LOG] verify:OK ${logKey} path=${writePath} db_score=${verifyRow.score} db_updated_at=${verifyRow.updated_at}`);

    // SOW score-rubric → derived per-photo decision (R2/R3 only).
    // R2: 0 = needs_review, 1-6 = skip, 7-10 = shortlist.
    // R3: 0 = needs_review, 1-6 = reject, 7-10 = qualified.
    // Writing to judge_decisions keeps the consensus pipeline + per-photo
    // status badges in sync without server changes.
    // Judging v5: Scores are PRIVATE marks (admin+judge only). They no longer
    // derive a decision. Decisions are made exclusively via tag clicks
    // (judge_tag_assignments). The legacy score→decision shim is removed.

    // NOTE: Entry status is NOT updated client-side. Status transitions
    // are handled server-side by evaluate-round2/3/4 edge functions
    // which implement multi-judge consensus logic.

    updateScoreOptimistic(scoreKey, score, currentFeedback, options?.criteria);
    setScoringEntry(null);

    if (!options?.silent) {
      // Tiny green-tick "Saved" pill — top-right, never overlaps the
      // Submit Evaluation button at the bottom of the panel.
      toast({
        title: `✓ Saved for Photo ${normalizedPI + 1}`,
        duration: 1400,
        className:
          "!w-auto !min-w-0 !max-w-[220px] !p-2 !pr-3 !gap-1.5 !border-emerald-500/40 !bg-emerald-500/10 !text-emerald-600 dark:!text-emerald-400 !shadow-sm [&>button]:hidden",
      });
    }
    if (!options?.skipAdvance) {
      setTimeout(() => goNext(), 300);
    }

    unlockMutation();
    setTimeout(() => invalidatePhotoData(), 500);
  }, [userId, isEffectivelyLocked, roundMode, roundNumber, sowRoundLogic, lockMutation, unlockMutation, updateScoreOptimistic, updateDecisionOptimistic, invalidatePhotoData, goNext]);

  /** Award tag labels that must be unique (only 1 entry). Spec v3 wording + legacy. */
  const UNIQUE_AWARD_LABELS = ["winner", "1st runner-up", "2nd runner-up", "1st runner up", "2nd runner up"];

  /**
   * Tag label → decision string mapping.
   * Extracted to `./tagLabelToDecision` (pure module) so it is unit-testable.
   * Behaviour is byte-identical to the previous inline implementation.
   */
  // tagLabelToDecision is imported from "./tagLabelToDecision" at top of file

  const toggleTag = useCallback(async (
    entryId: string,
    photoIndex: number,
    tagId: string,
    options?: { silent?: boolean; skipAdvance?: boolean },
  ) => {
    if (!userId || taggingEntry) return;
    // FIX 5: Use effective lock
    if (isEffectivelyLocked) {
      toast({ title: "Round is completed", description: "Tagging is locked.", variant: "destructive" });
      return;
    }

    const normalizedPI = normalizePhotoIndex(photoIndex);
    const photoKey = `${entryId}::${normalizedPI}`;
    setTaggingEntry(photoKey);
    lockMutation();

    const currentTags = getMyTags(photoKey);
    const allTags = getAllTags(photoKey);
    const hasTag = currentTags.includes(tagId);

    // Fetch round tags AND the clicked tag's label in one trip — we need the
    // label up-front so we can mirror the server's tag→decision mapping into
    // the optimistic decision cache (fixes per-photo decision UI staleness).
    const { data: roundTags } = await supabase
      .from("judging_tags")
      .select("id, label")
      .contains("visible_in_round", [roundNumber ?? 1]);
    const currentRoundTagIds = new Set((roundTags ?? []).map((tag) => tag.id));
    const currentRoundTags = currentTags.filter((id) => currentRoundTagIds.has(id));
    const clickedTagLabel = (roundTags ?? []).find((t) => t.id === tagId)?.label ?? null;
    const clickedTagDecision = tagLabelToDecision(clickedTagLabel);


    // Judging v5: Tag click = decision. No prerequisite score or legacy
    // decision is required — the tag IS the decision. Marks (10 sliders)
    // remain optional and private.

    // ── R4 Award uniqueness pre-check (read-only) ──
    if (!hasTag && roundNumber === 4) {
      const tagLabel = clickedTagLabel?.toLowerCase().trim();
      if (tagLabel && UNIQUE_AWARD_LABELS.includes(tagLabel)) {
        const { data: existingAssignments } = await supabase
          .from("judge_tag_assignments")
          .select("entry_id")
          .eq("tag_id", tagId)
          .neq("entry_id", entryId)
          .limit(1);

        if (existingAssignments && existingAssignments.length > 0) {
          unlockMutation();
          setTaggingEntry(null);
          toast({
            title: `"${clickedTagLabel}" already assigned`,
            description: "This award can only be given to one entry. Remove it from the other entry first.",
            variant: "destructive",
          });
          return;
        }
      }
    }

    // F-01 Phase B: Edge function is the authoritative writer for
    // judge_tag_assignments. It performs assignment + round-lock + quota
    // validation, then handles delete/single-active/insert atomically.
    // Direct client writes only run as a fallback when the edge call fails.
    const edgeResult = await submitJudgeTagEdge({
      entry_id: entryId,
      photo_index: normalizedPI,
      round_number: roundNumber ?? 1,
      tag_id: tagId,
    });

    if (!edgeResult.ok) {
      if (edgeAuthoritative) {
        // F-01 Phase C: flag ON — no fallback allowed.
        console.error(`[judge-tag] edge failed (flag=edgeAuthoritative, NO fallback):`, edgeResult.error);
        unlockMutation();
        setTaggingEntry(null);
        const msg = (edgeResult as any).error ?? "Edge function failed";
        reportSaveError(entryId, normalizedPI, "tag", msg);
        toast({ title: `Failed to save tag — Photo ${normalizedPI + 1}`, description: msg, variant: "destructive" });
        return;
      }
      console.warn(`[judge-tag] edge failed, falling back to direct write:`, edgeResult.error);

      if (hasTag) {
        const { error } = await supabase
          .from("judge_tag_assignments")
          .delete()
          .eq("entry_id", entryId)
          .eq("photo_index", normalizedPI)
          .eq("round_number", roundNumber ?? 1)
          .eq("tag_id", tagId)
          .eq("judge_id", userId);
        if (error) {
          unlockMutation();
          setTaggingEntry(null);
          toast({ title: "Failed", description: error.message, variant: "destructive" });
          return;
        }
      } else {
        if (currentRoundTags.length > 0) {
          await supabase
            .from("judge_tag_assignments")
            .delete()
            .eq("entry_id", entryId)
            .eq("photo_index", normalizedPI)
            .eq("round_number", roundNumber ?? 1)
            .eq("judge_id", userId)
            .in("tag_id", currentRoundTags);
        }
        const { error } = await supabase
          .from("judge_tag_assignments")
          .insert([{ entry_id: entryId, photo_index: normalizedPI, round_number: roundNumber ?? 1, tag_id: tagId, judge_id: userId }]);
        if (error) {
          unlockMutation();
          setTaggingEntry(null);
          toast({ title: "Failed", description: error.message, variant: "destructive" });
          return;
        }
      }
    }

    // Success — clear any prior save-error highlight for this slot.
    clearSaveError(entryId, normalizedPI);

    // Optimistic UI update (same for edge success and fallback success)
    if (hasTag) {
      updateTagOptimistic(
        photoKey,
        currentTags.filter((id) => id !== tagId),
        allTags.filter((t) => !(t.tag_id === tagId && t.judge_id === userId)),
      );
      if (clickedTagDecision) {
        updateDecisionOptimistic(entryId, normalizedPI, "", roundNumber ?? 1);
        if (import.meta.env.DEV) {
          probeDecisionParity({
            entryId, photoIndex: normalizedPI, judgeId: userId,
            roundNumber: roundNumber ?? 1,
            optimisticDecision: "",
            source: "toggleTag:remove",
          });
        }
      }
      unlockMutation();
      setTaggingEntry(null);
      setTimeout(() => invalidatePhotoData(), 500);
      return;
    }

    updateTagOptimistic(
      photoKey,
      [...currentTags.filter((id) => !currentRoundTagIds.has(id)), tagId],
      [
        ...allTags.filter((t) => !(t.judge_id === userId && currentRoundTagIds.has(t.tag_id))),
        { tag_id: tagId, judge_id: userId },
      ],
    );
    // Mirror the new tag into the per-photo decision cache so sidebar counts
    // (Shortlisted/Rejected/Qualified) and the photo-grid status badge update
    // in the same frame as the tag chip — no stale UI window.
    if (clickedTagDecision) {
      updateDecisionOptimistic(entryId, normalizedPI, clickedTagDecision, roundNumber ?? 1);
      if (import.meta.env.DEV) {
        probeDecisionParity({
          entryId, photoIndex: normalizedPI, judgeId: userId,
          roundNumber: roundNumber ?? 1,
          optimisticDecision: clickedTagDecision,
          source: "toggleTag:add",
        });
      }
    }


    // Spec v3: "Verification Required" workflow has been deleted.
    // Per-photo concerns now flow exclusively through the "Needs Review" tag,
    // which the participant is informed about via email + in-app ONLY when
    // the admin publishes the round (publish-round edge function).

    if (!options?.silent) {
      toast({ title: `Tagged ✓` });
    }
    // SOW: tagging never auto-advances. Judges must explicitly score + decide
    // before navigating away. Auto-advance was hiding the "incomplete photo"
    // gap and letting tags ship without a final decision.

    unlockMutation();
    setTaggingEntry(null);
    setTimeout(() => invalidatePhotoData(), 500);
  }, [userId, isEffectivelyLocked, taggingEntry, roundNumber, lockMutation, unlockMutation, getMyTags, getAllTags, updateTagOptimistic, updateDecisionOptimistic, invalidatePhotoData, goNext]);

  const addComment = useCallback(async (
    entryId: string,
    photoIndex: number,
    commentText: string,
  ) => {
    if (!userId || !commentText.trim()) return;

    // FIX 5: Use effective lock
    if (isEffectivelyLocked) {
      toast({ title: "Round is completed", description: "Comments are locked.", variant: "destructive" });
      return;
    }

    lockMutation();

    const normalizedPI = normalizePhotoIndex(photoIndex);
    // F-01 Phase B: Edge function is the authoritative writer for judge_comments.
    // Direct client insert only runs as a fallback when the edge call fails.
    const edgeResult = await submitJudgeCommentEdge({
      entry_id: entryId,
      photo_index: normalizedPI,
      comment: commentText.trim(),
      round_id: selectedRound || null,
    });

    let insertedRow: { id: string; comment: string; created_at: string; round_id: string | null } | null = null;

    if (edgeResult.ok && edgeResult.data?.row) {
      insertedRow = edgeResult.data.row;
    } else {
      if (edgeAuthoritative) {
        // F-01 Phase C: flag ON — no fallback allowed.
        console.error(`[judge-comment] edge failed (flag=edgeAuthoritative, NO fallback):`, edgeResult.error);
        unlockMutation();
        const msg = (edgeResult as any).error ?? "Edge function failed";
        reportSaveError(entryId, normalizedPI, "comment", msg);
        toast({ title: `Failed to save comment — Photo ${normalizedPI + 1}`, description: msg, variant: "destructive" });
        throw new Error((edgeResult as any).error ?? "Edge function failed");
      }
      console.warn(`[judge-comment] edge failed, falling back to direct insert:`, edgeResult.error);

      const { data, error } = await supabase
        .from("judge_comments")
        .insert({
          entry_id: entryId,
          photo_index: normalizedPI,
          judge_id: userId,
          comment: commentText.trim(),
          round_id: selectedRound || null,
        })
        .select("id, comment, created_at, round_id")
        .single();

      if (error) {
        unlockMutation();
        reportSaveError(entryId, normalizedPI, "comment", error.message);
        toast({ title: `Failed to save comment — Photo ${normalizedPI + 1}`, description: error.message, variant: "destructive" });
        throw error;
      }
      insertedRow = data as any;
    }

    const photoKey = `${entryId}::${normalizedPI}`;
    addCommentOptimistic(photoKey, { ...insertedRow!, judge_id: userId } as JudgeComment);
    clearSaveError(entryId, normalizedPI);
    toast({ title: "Note saved ✓" });
    unlockMutation();
    setTimeout(() => invalidatePhotoData(), 500);
  }, [userId, selectedRound, isEffectivelyLocked, lockMutation, unlockMutation, addCommentOptimistic, invalidatePhotoData]);

  // Judging v5: handleDecision / handleR2Decision / handleR3Decision were
  // removed. All decisions now flow through `toggleTag` against admin-defined
  // tags. The Round1/2/3 decision panel components and their union types were
  // deleted in J-06.

  /** Whether R1 uses decision mode (kept so views can hide score sliders for R1). */
  const isR1DecisionMode = roundNumber === 1;
  /** Whether R2 uses decision mode. */
  const isR2DecisionMode = roundNumber === 2;
  /** Whether R3 uses decision mode. */
  const isR3DecisionMode = roundNumber === 3;
  /** Whether current round uses decision mode (R1, R2, or R3) */
  const isDecisionMode = roundNumber === 1 || roundNumber === 2 || roundNumber === 3;

  return {
    handleQuickScore,
    toggleTag,
    addComment,
    setFeedbackRef,
    scoringEntry,
    taggingEntry,
    isR1DecisionMode,
    isR2DecisionMode,
    isR3DecisionMode,
    isDecisionMode,
  };
}
