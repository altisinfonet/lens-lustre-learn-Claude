import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
// Spec v3: tag chips render only in the R4 Quality Tags panel below the criteria sliders.
import RoundDecisionButtons from "@/components/judge/RoundDecisionButtons";
import {
  Star, AlertTriangle, Camera,
  Send, ChevronRight, ChevronLeft, CheckCircle, Minimize2,
  ZoomIn, ZoomOut, RotateCcw, Clock, Plus, Loader2,
  XCircle, FolderCheck, ListChecks, LayoutGrid, X, AlertCircle, PanelLeft,
  BookmarkCheck, Bookmark, Heart, FileWarning, Copy,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { usePhotoVoteCount } from "@/hooks/judging/usePhotoVoteCount";
import { toast } from "@/hooks/core/use-toast";
import UnsavedChangesDialog from "@/components/judge/UnsavedChangesDialog";
import JudgeSessionTimer from "@/components/judge/JudgeSessionTimer";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatExifData, formatExifSummary } from "@/lib/exifFormat";
import JudgeRoundSidebar from "@/components/judge/JudgeRoundSidebar";
import type { RoundFilterCounts } from "@/components/judge/JudgeRoundSidebar";
import PhaseWatermark from "@/components/competition/PhaseWatermark";
import { JudgeRawSubmissionsPanel } from "@/components/judge/JudgeRawSubmissionsPanel";
import { JudgeDuplicatesPanel } from "@/components/judge/JudgeDuplicatesPanel";
import { PhotoExifAuditTrail } from "@/components/judge/PhotoExifAuditTrail";
import type { JudgeComment, JudgeEntry, FlatPhoto, JudgingTag, JudgingRound, PhotoEvaluation, SidebarView, PhotoTagData, PhotoScoreData, CriteriaScores, Competition } from "@/hooks/judging/types";
import { DEFAULT_CRITERIA, CRITERIA_KEYS, CRITERIA_LABELS as CRITERIA_LABELS_MAP, SOW_ROUND4_CRITERIA_KEYS, SOW_ROUND4_CRITERIA_LABELS } from "@/hooks/judging/types";

interface CinemaFullViewProps {
  userId: string;
  isAdmin: boolean;
  selectedEntry: JudgeEntry;
  selectedPhoto: FlatPhoto;
  selectedPhotoKey: string | null;
  selectedPhotoEvaluation: PhotoEvaluation | null;
  setSelectedPhotoKey: (k: string | null) => void;
  availableTags: JudgingTag[];
  roundMode: "scoring" | "tagging" | "decision";
  isRoundLocked: boolean;
  lockedByOther: boolean;
  scoringEntry: string | null;
  taggingEntry: string | null;
  handleQuickScore: (entryId: string, photoIndex: number, score: number, options?: { silent?: boolean; skipAdvance?: boolean; criteria?: CriteriaScores }) => Promise<void>;
  toggleTag: (entryId: string, photoIndex: number, tagId: string, options?: { silent?: boolean; skipAdvance?: boolean }) => Promise<void>;
  feedbackInput: string;
  setFeedbackInput: (v: string) => void;
  commentInput: string;
  setCommentInput: (v: string) => void;
  addComment: (entryId: string, photoIndex: number) => Promise<void>;
  photoComments: JudgeComment[];
  activeRoundId: string | null;
  activePhotoIdx: number;
  activePhotoList: FlatPhoto[];
  displayIdx: number;
  displayTotal: number;
  goNext: () => void;
  goPrev: () => void;
  getPhotoKey: (p: FlatPhoto) => string;
  sidebarView: SidebarView;
  setSidebarView: (v: SidebarView) => void;
  photoTagsMap: Record<string, PhotoTagData>;
  photoScoresMap: Record<string, PhotoScoreData>;
  tagCountsMap?: Record<string, number>;
  totalEntries: number;
  rejectedCount: number;
  acceptedCount: number;
  shortlistedCount: number;
  completedRoundsCount: number;
  allPhotos: FlatPhoto[];
  zoomLevel: number;
  setZoomLevel: (fn: (z: number) => number) => void;
  showNav: boolean;
  handleMouseMove: () => void;
  selectedCompId: string | null;
  onTagCreated?: (tag: JudgingTag) => void;
  invalidateEntries?: () => void;
  needsReviewCount?: number;
  feedbackSavedSignal?: number;
  /** Ref callback to expose guardedExit to parent */
  guardedExitRef?: React.MutableRefObject<(() => void) | null>;
  /** Callback when exit completes (replaces cinema-exit-complete event) */
  onExitComplete?: () => void;
  /** Current round number (1-4) for conditional UI */
  roundNumber?: number;
  /** SOW flag: enable_sow_round_logic */
  sowRoundLogic?: boolean;
  /** SOW flag: enable_sow_round4_criteria */
  sowRound4Criteria?: boolean;
  /** SOW flag: enforce_strict_round_lock */
  strictLockFlag?: boolean;
  /** Round-based sidebar props */
  competitions?: Competition[];
  rounds?: JudgingRound[];
  selectedRound?: string | null;
  setSelectedRound?: (id: string | null) => void;
  expandedComp?: string | null;
  setExpandedComp?: (id: string | null) => void;
  setSelectedCompId?: (id: string | null) => void;
  filterCounts?: RoundFilterCounts;
  setMobileTab?: (tab: "comps" | "photos" | "judge") => void;
  // Judging v5 (J-06): handleDecision / handleR2Decision / handleR3Decision /
  // decisionPending props removed — decisions are made via tag clicks only.
  /** View-only mode — blocks ALL scoring, tagging, decisions, keyboard shortcuts */
  isViewOnly?: boolean;
  /** Session timer props */
  sessionElapsed?: number;
  judgingStarted?: boolean;
  /** Save & Leave handler for unsaved changes dialog */
  onSaveAndLeave?: () => void;
  /** Per-entry decisions from judge_decisions table — used for history tab */
  photoDecisionsMap?: Record<string, { myDecision: string | null; allDecisions: { judge_id: string; decision: string; round_number: number }[] }>;
  /** Judge name lookup map for displaying judge names in history */
  judgeNameMap?: Map<string, string>;
  /** Step 20: canonical phase for the active competition (from CinemaJudgeView). */
  competitionPhase?: string;
  /** Step 20: active judging round string ("1"|"2"|"3"|"4"|null). */
  competitionCurrentRound?: string | null;
  /** Bookmarked entry id (from judge_sessions.last_entry_id) — paired with bookmarkedPhotoIndex for per-photo highlight. */
  bookmarkedEntryId?: string | null;
  /** Bookmarked photo index — only that exact filmstrip thumb is highlighted. */
  bookmarkedPhotoIndex?: number | null;
  /** Toggle bookmark for the currently viewed (entry, photo). When provided,
   *  a Bookmark button is rendered in the Full View header for parity with
   *  the grid-header bookmark control. Same handler → guaranteed parity. */
  onBookmarkCurrentPhoto?: () => void;
  /** True when the currently viewed (entry, photo) is the active bookmark. */
  isCurrentPhotoBookmarked?: boolean;
}


const CommentInput = ({ commentInput, setCommentInput, addComment, selectedEntry, selectedPhoto, isLocked }: {
  commentInput: string; setCommentInput: (v: string) => void;
  addComment: (entryId: string, photoIndex: number) => Promise<void>;
  selectedEntry: JudgeEntry; selectedPhoto: FlatPhoto; isLocked: boolean;
}) => {
  const [submitting, setSubmitting] = useState(false);
  const handleSubmit = async () => {
    if (!commentInput.trim() || submitting || isLocked) return;
    setSubmitting(true);
    try {
      await addComment(selectedEntry.id, selectedPhoto.photoIndex);
      setCommentInput("");
    } catch {
      // keep input on failure
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <div className="flex items-center gap-1.5">
      <input type="text" value={commentInput} onChange={e => { if (e.target.value.length <= 300) setCommentInput(e.target.value); }}
        placeholder="Add a comment..." maxLength={300} disabled={isLocked || submitting}
        onKeyDown={async e => { if (e.key === "Enter" && !e.nativeEvent?.isComposing) handleSubmit(); }}
        aria-label="Add a judge comment"
        className="flex-1 bg-muted/10 border border-border rounded px-2.5 py-2 text-[11px] text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/50 transition-colors disabled:opacity-50" />
      <button onClick={handleSubmit} disabled={!commentInput.trim() || submitting || isLocked}
        aria-label="Send comment"
        className="p-2 rounded bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-30 transition-colors">
        {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
      </button>

    </div>
  );
};

const CinemaFullView = (props: CinemaFullViewProps) => {
  const {
    userId, isAdmin, selectedEntry, selectedPhoto, selectedPhotoKey,
    selectedPhotoEvaluation, setSelectedPhotoKey,
    availableTags, roundMode, isRoundLocked, lockedByOther, scoringEntry, taggingEntry,
    handleQuickScore, toggleTag,
    feedbackInput, setFeedbackInput,
    commentInput, setCommentInput, addComment,
    photoComments, activeRoundId,
    activePhotoIdx, activePhotoList, displayIdx, displayTotal,
    goNext, goPrev, getPhotoKey,
    sidebarView, setSidebarView, photoTagsMap, photoScoresMap,
    totalEntries, rejectedCount, acceptedCount, shortlistedCount, completedRoundsCount,
    allPhotos,
    zoomLevel, setZoomLevel, showNav, handleMouseMove,
    selectedCompId, onTagCreated,
  } = props;

  // FIX: isViewOnly blocks ALL evaluation actions
  const isViewOnly = props.isViewOnly === true;
  const isLocked = isRoundLocked || lockedByOther || isViewOnly;

  // ── SOW FLAGS ──
  const useSOWCriteria = props.sowRound4Criteria && (props.roundNumber === 2 || props.roundNumber === 3 || props.roundNumber === 4);
  const useSOWRoundLogic = props.sowRoundLogic;
  const isR1DecisionMode = props.roundNumber === 1;
  const isR2DecisionMode = props.roundNumber === 2;
  const isR3DecisionMode = props.roundNumber === 3;
  const isAnyDecisionMode = isR1DecisionMode || isR2DecisionMode || isR3DecisionMode;
  const isScoreEditingBlocked = isLocked || !!scoringEntry;
  // SOW: Always use 10 criteria for R2/R3/R4 (Line→Depth), never legacy 12
  const activeCriteriaKeys = (props.roundNumber && props.roundNumber >= 2) ? SOW_ROUND4_CRITERIA_KEYS : CRITERIA_KEYS;
  const activeCriteriaLabels = (props.roundNumber && props.roundNumber >= 2) ? SOW_ROUND4_CRITERIA_LABELS : CRITERIA_LABELS_MAP;

  // Filter tags by visible_in_round — STRICT: only tags mapped to current round
  const filteredTags = useMemo(() => {
    if (!props.roundNumber) return [];
    return availableTags.filter(tag =>
      Array.isArray(tag.visible_in_round) && tag.visible_in_round.includes(props.roundNumber!)
    );
  }, [availableTags, props.roundNumber]);

  // ── UNSAVED CHANGES GUARD ──
  const [pendingGuardAction, setPendingGuardAction] = useState<(() => void) | null>(null);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);

  // ── LOCAL CRITERIA STATE (only commits on Submit) ──
  const dbCriteria = selectedPhotoEvaluation?.criteria ?? { ...DEFAULT_CRITERIA };
  const [localCriteria, setLocalCriteria] = useState(dbCriteria);
  const [isDirty, setIsDirty] = useState(false);
  const prevPhotoKey = useRef(selectedPhotoKey);

  // Track feedback dirty state for unsaved guard
  const [feedbackDirty, setFeedbackDirty] = useState(false);
  // FIX #3: Include comment draft in dirty check
  const isSomethingDirty = isDirty || feedbackDirty || commentInput.trim().length > 0;

  // ── ON-THE-FLY TAG CREATION STATE ──
  const [showNewTagInput, setShowNewTagInput] = useState(false);
  const [newTagLabel, setNewTagLabel] = useState("");
  const [creatingTag, setCreatingTag] = useState(false);

  // FIX: Reset transient states on photo change
  useEffect(() => {
    setShowNewTagInput(false);
    setNewTagLabel("");
    setFeedbackDirty(false);
  }, [selectedPhotoKey]);

  // FIX #7: Reset feedbackDirty when autosave completes
  const feedbackSavedSignal = props.feedbackSavedSignal;
  const prevSavedSignal = useRef(feedbackSavedSignal);
  useEffect(() => {
    if (feedbackSavedSignal !== undefined && feedbackSavedSignal !== prevSavedSignal.current) {
      prevSavedSignal.current = feedbackSavedSignal;
      setFeedbackDirty(false);
    }
  }, [feedbackSavedSignal]);
  const [rightPanel, setRightPanel] = useState<"eval" | "exif" | "history" | "raw" | "dupes" | null>("eval");
  const [sidebarPinned, setSidebarPinned] = useState(false);

  // ── DRAG-TO-PAN STATE ──
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [notesExpanded, setNotesExpanded] = useState(true);
  const [commentsExpanded, setCommentsExpanded] = useState(true);
  const panOffsetRef = useRef(panOffset);
  panOffsetRef.current = panOffset;
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });
  const lastScrolledKey = useRef<string | null>(null);

  // Track navigation direction (1 = next/forward, -1 = prev/back) for image swap slide animation
  const [navDirection, setNavDirection] = useState<1 | -1>(1);

  // Track intrinsic image aspect ratio so the neon-bordered wrapper exactly
  // matches the rendered photo edge (no empty side-bands on portrait/landscape).
  const [imgAspect, setImgAspect] = useState<number | null>(null);

  // Reset pan + aspect when photo changes
  useEffect(() => {
    setPanOffset({ x: 0, y: 0 });
    setImgAspect(null);
  }, [selectedPhotoKey]);

  // Per-photo public vote count (judges only — gated by Cinema header visibility).
  // Fallback to activePhotoIdx so View Only mode (where selectedPhoto.photoIndex is undefined) still resolves.
  const effectivePhotoIdx = selectedPhoto?.photoIndex ?? activePhotoIdx ?? 0;
  const { data: photoVoteCount } = usePhotoVoteCount(selectedEntry?.id, effectivePhotoIdx);

  useEffect(() => {
    if (zoomLevel <= 1) setPanOffset({ x: 0, y: 0 });
  }, [zoomLevel]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (zoomLevel <= 1) return;
    isDragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY };
    panStart.current = { ...panOffsetRef.current };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [zoomLevel]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return;
    const rawX = panStart.current.x + (e.clientX - dragStart.current.x);
    const rawY = panStart.current.y + (e.clientY - dragStart.current.y);
    // Clamp pan within reasonable bounds (±500px scaled by zoom)
    const maxPan = 500 * (zoomLevel - 1);
    setPanOffset({
      x: Math.max(-maxPan, Math.min(maxPan, rawX)),
      y: Math.max(-maxPan, Math.min(maxPan, rawY)),
    });
  }, [zoomLevel]);

  const handlePointerUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const handleCreateTag = useCallback(async () => {
    const label = newTagLabel.trim();
    if (!label || !userId || !selectedCompId) return;
    // Only admins can create tags
    if (!isAdmin) {
      toast({ title: "Permission denied", description: "Only admins can create new tags", variant: "destructive" });
      return;
    }
    setCreatingTag(true);
    try {
      // 1. Insert tag into judging_tags
      const TAG_COLORS = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899"];
      const colorIdx = availableTags.length % TAG_COLORS.length;
      const currentRound = props.roundNumber ?? 2;
      const { data: tag, error } = await supabase.from("judging_tags")
        .insert({ label, color: TAG_COLORS[colorIdx], created_by: userId, visible_in_round: [currentRound] })
        .select("id, label, color, icon, image_url, visible_in_round")
        .single();
      if (error) throw error;

      // 2. Link to current competition
      const { error: linkError } = await supabase.from("competition_judging_tags")
        .insert({ competition_id: selectedCompId, tag_id: tag.id });
      if (linkError) throw linkError;

      toast({ title: "Tag created", description: `"${label}" is now available` });
      setNewTagLabel("");
      setShowNewTagInput(false);
      onTagCreated?.(tag);
    } catch (err: any) {
      toast({ title: "Failed to create tag", description: err.message, variant: "destructive" });
    } finally {
      setCreatingTag(false);
    }
  }, [newTagLabel, userId, selectedCompId, onTagCreated, isAdmin, availableTags]);

  // Sync local state when photo changes or DB data loads
  useEffect(() => {
    if (selectedPhotoKey !== prevPhotoKey.current) {
      setLocalCriteria(dbCriteria);
      setIsDirty(false);
      prevPhotoKey.current = selectedPhotoKey;
    }
  }, [selectedPhotoKey, dbCriteria]);

  // Also sync if DB data changes and we haven't made local edits
  useEffect(() => {
    if (!isDirty) {
      setLocalCriteria(dbCriteria);
    }
  }, [dbCriteria, isDirty]);

  const handleSliderChange = useCallback((key: string, value: number) => {
    setLocalCriteria((prev) => ({ ...prev, [key]: Math.round(value) }));
    setIsDirty(true);
  }, []);

  const handleResetCriteria = useCallback((key: string) => {
    setLocalCriteria((prev) => ({ ...prev, [key]: null }));
    setIsDirty(true);
  }, []);

  // SOW Appendix C (verbatim): Total = average of ALL 10 criteria. Unset slider = 0.
  // `computedFinal` keeps the list of criteria the judge has actually moved (for
  // gating "did the judge engage at all?"). `avgScore` is the SOW-literal mean
  // computed across the FULL criteria set with unset = 0.
  const computedFinal = useMemo(
    () => (activeCriteriaKeys as readonly string[])
      .map(k => localCriteria[k as keyof CriteriaScores])
      .filter((v): v is number => v !== null),
    [localCriteria, activeCriteriaKeys],
  );
  const avgScore = useMemo(() => {
    const total = (activeCriteriaKeys as readonly string[]).length;
    if (total === 0) return selectedPhotoEvaluation?.score ?? null;
    if (computedFinal.length === 0) return selectedPhotoEvaluation?.score ?? null;
    const sum = (activeCriteriaKeys as readonly string[])
      .map(k => localCriteria[k as keyof CriteriaScores] ?? 0)
      .reduce((a, b) => a + b, 0);
    return sum / total;
  }, [activeCriteriaKeys, localCriteria, computedFinal.length, selectedPhotoEvaluation?.score]);

  const finalIntegerScore = useMemo(() => {
    if (avgScore === null || avgScore === undefined) return selectedPhotoEvaluation?.score ?? null;
    return Math.round(avgScore);
  }, [avgScore, selectedPhotoEvaluation?.score]);

  // Tag counts — passed from parent CinemaJudgeView to avoid duplicate O(n²) computation
  const tagCountsMap = props.tagCountsMap ?? {};

  // FIX: Compute actual reviewed count instead of using completedRoundsCount
  const reviewedByYouCount = useMemo(() => {
    let count = 0;
    for (const p of allPhotos) {
      const key = getPhotoKey(p);
      if ((photoScoresMap[key]?.myScore != null) || ((photoTagsMap[key]?.myTags?.length ?? 0) > 0)) count++;
    }
    return count;
  }, [allPhotos, getPhotoKey, photoScoresMap, photoTagsMap]);

  const handleSubmitEvaluation = useCallback(() => {
    if (!selectedEntry || !selectedPhoto || isLocked || !!scoringEntry) return;

    // Spec v3 — R2/R3 require ALL 10 SOW criteria filled before submit.
    // No partial scores, no score=0 shortcut, no 'Needs Review' fallback.
    const totalCriteria = (activeCriteriaKeys as readonly string[]).length;
    const isScoringRound = props.roundNumber === 2 || props.roundNumber === 3;
    if (isScoringRound && computedFinal.length < totalCriteria) {
      toast({
        title: `${totalCriteria - computedFinal.length} of ${totalCriteria} criteria remaining`,
        description: "Score every SOW criterion before submitting this evaluation.",
        variant: "destructive",
      });
      return;
    }

    // Non-scoring fallback (e.g. legacy single-score panel) still needs SOMETHING set.
    if (avgScore === null && selectedPhotoEvaluation?.score === null) {
      toast({ title: "Score required", description: "Set at least one criterion before submitting.", variant: "destructive" });
      return;
    }

    // Reuse memoized avgScore to avoid divergence with computedFinal
    const finalScore = computedFinal.length > 0 ? Math.round(avgScore!) : (selectedPhotoEvaluation?.score ?? 0);
    handleQuickScore(selectedEntry.id, selectedPhoto.photoIndex, finalScore, { criteria: localCriteria });
    setIsDirty(false);
  }, [selectedEntry, selectedPhoto, localCriteria, handleQuickScore, selectedPhotoEvaluation, isLocked, avgScore, computedFinal, scoringEntry, activeCriteriaKeys, props.roundNumber]);

  // ── Guard wrapper for navigation actions ──
  const guardedAction = useCallback((action: () => void) => {
    if (isSomethingDirty) {
      setPendingGuardAction(() => action);
      setShowUnsavedDialog(true);
    } else {
      action();
    }
  }, [isSomethingDirty]);

  const handleConfirmDiscard = useCallback(() => {
    setShowUnsavedDialog(false);
    setIsDirty(false);
    setFeedbackDirty(false);
    if (pendingGuardAction) {
      pendingGuardAction();
      setPendingGuardAction(null);
    }
  }, [pendingGuardAction]);

  const handleCancelDiscard = useCallback(() => {
    setShowUnsavedDialog(false);
    setPendingGuardAction(null);
  }, []);

  // ── Guarded navigation ──
  const guardedGoNext = useCallback(() => { setNavDirection(1); guardedAction(goNext); }, [guardedAction, goNext]);
  const guardedGoPrev = useCallback(() => { setNavDirection(-1); guardedAction(goPrev); }, [guardedAction, goPrev]);
  const guardedExit = useCallback(() => guardedAction(() => { setSelectedPhotoKey(null); setZoomLevel(() => 1); props.onExitComplete?.(); }), [guardedAction, setSelectedPhotoKey, setZoomLevel, props.onExitComplete]);

  // Expose guardedExit to parent via ref (replaces event-based cinema-request-exit)
  useEffect(() => {
    if (props.guardedExitRef) {
      props.guardedExitRef.current = guardedExit;
    }
    return () => {
      if (props.guardedExitRef) {
        props.guardedExitRef.current = null;
      }
    };
  }, [guardedExit, props.guardedExitRef]);

  // ── KEYBOARD SHORTCUTS — FULL 0-10 RANGE ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!selectedEntry || !selectedPhoto) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      // FIX: Block ALL scoring/decision keyboard shortcuts in View Only mode
      const isActionKey = e.code.startsWith("Digit") || e.code === "KeyA" || e.code === "KeyR" || e.code === "KeyN" || e.code === "KeyS";
      if (isViewOnly && isActionKey) return;


      switch (e.code) {
        case "Escape":
          e.preventDefault();
          e.stopPropagation();
          guardedExit();
          break;
        case "ArrowLeft":
          e.preventDefault();
          e.stopPropagation();
          guardedGoPrev();
          break;
        case "ArrowRight":
          e.preventDefault();
          e.stopPropagation();
          guardedGoNext();
          break;
        // FIX CN-BUG-03: e.code-based scoring — works on all keyboard layouts
        case "Digit0": case "Digit1": case "Digit2": case "Digit3": case "Digit4":
        case "Digit5": case "Digit6": case "Digit7": case "Digit8": case "Digit9": {
          // Block ALL scoring keys in decision mode (R1 and R2)
          if (isAnyDecisionMode) break;
          if (isScoreEditingBlocked) break;
          if (e.shiftKey && e.code === "Digit1") {
            e.preventDefault();
            e.stopPropagation();
            const criteriaToSend10 = computedFinal.length > 0 ? localCriteria : undefined;
            handleQuickScore(selectedEntry.id, selectedPhoto.photoIndex, 10, { skipAdvance: true, criteria: criteriaToSend10 });
            setIsDirty(false);
            setFeedbackDirty(false);
            break;
          }
          if (e.shiftKey) break;
          e.preventDefault();
          e.stopPropagation();
          const score = parseInt(e.code.replace("Digit", ""));
          const criteriaToSend = computedFinal.length > 0 ? localCriteria : undefined;
          handleQuickScore(selectedEntry.id, selectedPhoto.photoIndex, score, { skipAdvance: true, criteria: criteriaToSend });
          setIsDirty(false);
          setFeedbackDirty(false);
          break;
        }
        case "KeyA": {
          // Judging v5: A no longer triggers Accept/Qualified/Finalist decisions
          // (decisions are tag-only). In score mode it still saves the current
          // criteria avg as a quick mark.
          if (isAnyDecisionMode) break;
          if (isScoreEditingBlocked) break;
          e.preventDefault();
          e.stopPropagation();
          if (computedFinal.length > 0 && avgScore !== null && avgScore !== undefined) {
            handleQuickScore(selectedEntry.id, selectedPhoto.photoIndex, Math.round(avgScore), { skipAdvance: true, criteria: localCriteria });
          } else {
            handleQuickScore(selectedEntry.id, selectedPhoto.photoIndex, 7, { skipAdvance: true });
          }
          setIsDirty(false);
          setFeedbackDirty(false);
          break;
        }
        case "KeyR": {
          // Plan Step 4.2: R no longer rejects in any round.
          // R1 → use decision buttons (isAnyDecisionMode). R2/R3 are STRICTLY BINARY,
          // outcome derived from 10-criteria avg (≥7 Qualified / <7 Not Selected) —
          // a Reject keypad would violate `judging/r2-r3-no-needs-review`.
          // R4 = tags-only per SOW. Shortcut intentionally inert.
          break;
        }
        case "Equal": case "NumpadAdd": {
          e.preventDefault();
          e.stopPropagation();
          setZoomLevel((z: number) => Math.min(3, z + 0.25));
          break;
        }
        // Judging v5: KeyN (Needs Review) and KeyS (Shortlist) shortcuts
        // removed — those decisions are now made via admin-defined tag clicks.
        case "Minus": case "NumpadSubtract": {
          e.preventDefault();
          e.stopPropagation();
          setZoomLevel((z: number) => Math.max(0.5, z - 0.25));
          break;
        }
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [selectedEntry, selectedPhoto, setSelectedPhotoKey, setZoomLevel, guardedGoPrev, guardedGoNext, guardedExit, handleQuickScore, localCriteria, isLocked, avgScore, computedFinal, scoringEntry, isAnyDecisionMode, roundMode]);

  // ── PRELOAD ADJACENT IMAGES ──
  useEffect(() => {
    if (!activePhotoList || activePhotoList.length === 0) return;
    const images: HTMLImageElement[] = [];
    if (activePhotoIdx > 0) {
      const img = new Image();
      img.src = activePhotoList[activePhotoIdx - 1].photoUrl;
      images.push(img);
    }
    if (activePhotoIdx < activePhotoList.length - 1) {
      const img = new Image();
      img.src = activePhotoList[activePhotoIdx + 1].photoUrl;
      images.push(img);
    }
    return () => {
      images.forEach(img => { img.src = ""; });
    };
  }, [activePhotoIdx, activePhotoList]);

  if (!selectedEntry || !selectedPhoto) return null;

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex flex-col bg-background"
      role="dialog"
      aria-modal="true"
      aria-label="Photo evaluation view"
      onMouseMove={handleMouseMove}
      onKeyDown={(e) => {
        if (e.key === "Tab") {
          const focusable = e.currentTarget.querySelectorAll<HTMLElement>(
            "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
          );
          if (focusable.length === 0) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }}
    >
      {/* ── ANIMATED GRADIENT BG ── */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden motion-reduce:hidden">
        <div className="absolute -top-1/2 -left-1/2 w-[200%] h-[200%] animate-[spin_30s_linear_infinite] opacity-[0.03] will-change-transform"
          style={{ background: "conic-gradient(from 0deg, hsl(var(--primary)), hsl(var(--ring)), hsl(var(--primary)))" }} />
      </div>

      {/* ── TOP BAR ── */}
      <div className="relative z-10 flex items-center justify-between px-4 h-[44px] shrink-0 border-b border-border bg-card/95 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <button onClick={() => guardedExit()}
            aria-label="Back to grid view"
            className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
            style={{ fontFamily: "var(--font-heading)" }}>
            <ChevronLeft className="h-4 w-4" /> Back
          </button>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-2">
            {selectedEntry.photographer_avatar && (
              <img loading="lazy" decoding="async" src={selectedEntry.photographer_avatar} alt="" className="w-5 h-5 rounded-full object-cover border border-border/50" />
            )}
            <div className="flex flex-col">
              {(() => {
                /* Per-photo title (SOW v2.2): photo_meta[idx].title shadows the entry title
                 * when set. Falls back to entry title. RAW chip surfaces integrity commitment. */
                const meta: any = Array.isArray((selectedEntry as any).photo_meta)
                  ? (selectedEntry as any).photo_meta[activePhotoIdx ?? 0]
                  : null;
                const photoTitle: string | undefined =
                  typeof meta?.title === "string" && meta.title.trim() ? meta.title.trim() : undefined;
                const showPhotoTitle = photoTitle && photoTitle !== selectedEntry.title;
                const rawRequired = Boolean(meta?.raw_required);
                // Per-photo description + AI flag (SOW v3 — per-photo source of truth)
                const photoDescription: string | undefined =
                  typeof meta?.description === "string" && meta.description.trim() ? meta.description.trim() : undefined;
                const photoIsAi = Boolean(meta?.is_ai_generated);
                return (
                  <>
                    <span className="text-[11px] text-foreground font-medium flex items-center gap-1.5 flex-wrap" style={{ fontFamily: "var(--font-heading)" }}>
                      {showPhotoTitle ? photoTitle : selectedEntry.title}
                      {rawRequired && (
                        <span
                          title="Photographer committed to submit RAW on request"
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-wider border bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/40"
                        >
                          RAW
                        </span>
                      )}
                      {photoIsAi && (
                        <span
                          title="Photographer flagged this image as AI-generated"
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-wider border bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/40"
                        >
                          AI
                        </span>
                      )}
                    </span>
                    {showPhotoTitle && (
                      <span className="text-[9px] text-muted-foreground/50" style={{ fontFamily: "var(--font-heading)" }}>
                        from “{selectedEntry.title}”
                      </span>
                    )}
                    {selectedEntry.photographer_name && (
                      <span className="text-[9px] text-muted-foreground/40" style={{ fontFamily: "var(--font-heading)" }}>
                        by {selectedEntry.photographer_name}
                      </span>
                    )}
                    {photoDescription && (
                      <span
                        title={photoDescription}
                        className="text-[10px] text-muted-foreground/70 italic line-clamp-2 max-w-md mt-0.5"
                        style={{ fontFamily: "var(--font-body)" }}
                      >
                        “{photoDescription}”
                      </span>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
          {/* Strict Lock Banner */}
          {isRoundLocked && props.strictLockFlag && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-destructive/10 border border-destructive/20 rounded text-[9px] font-bold uppercase tracking-wider text-destructive ml-2" style={{ fontFamily: "var(--font-heading)" }}>
              🔒 Round Locked
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 bg-muted/20 rounded-lg px-1.5 py-0.5">
            <button onClick={() => setZoomLevel((z: number) => Math.max(0.5, z - 0.25))} aria-label="Zoom out" className="w-6 h-6 flex items-center justify-center text-muted-foreground/50 hover:text-foreground transition-colors"><ZoomOut className="h-3.5 w-3.5" /></button>
            <span className="text-[9px] font-bold text-muted-foreground tabular-nums min-w-[4ch] text-center" style={{ fontFamily: "var(--font-heading)" }}>{Math.round(zoomLevel * 100)}%</span>
            <button onClick={() => setZoomLevel((z: number) => Math.min(3, z + 0.25))} aria-label="Zoom in" className="w-6 h-6 flex items-center justify-center text-muted-foreground/50 hover:text-foreground transition-colors"><ZoomIn className="h-3.5 w-3.5" /></button>
            {zoomLevel !== 1 && <button onClick={() => setZoomLevel(() => 1)} aria-label="Reset zoom" className="w-6 h-6 flex items-center justify-center text-muted-foreground/50 hover:text-foreground transition-colors"><RotateCcw className="h-3 w-3" /></button>}
          </div>
          <div className="h-4 w-px bg-border" />
          {/* Session Timer */}
          <JudgeSessionTimer
            isActive={props.judgingStarted ?? false}
            entryId={selectedEntry?.id ?? null}
            sessionElapsed={props.sessionElapsed}
          />
          <div className="h-4 w-px bg-border" />
          {/* Bookmark toggle — same handler as the grid-header bookmark button (single source of truth in CinemaJudgeView).
              Renders only when the parent provides the handler. */}
          {props.onBookmarkCurrentPhoto && (
            <button
              onClick={() => props.onBookmarkCurrentPhoto?.()}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border transition-all ${
                props.isCurrentPhotoBookmarked
                  ? "bg-primary/15 text-primary border-primary/50 shadow-[0_0_8px_hsl(var(--primary)/0.2)]"
                  : "text-primary hover:bg-primary/10 border-primary/30 hover:border-primary/50"
              }`}
              style={{ fontFamily: "var(--font-heading)" }}
              aria-label={props.isCurrentPhotoBookmarked ? "Remove bookmark from this photo" : "Bookmark this photo"}
              title={props.isCurrentPhotoBookmarked ? "Bookmarked — click to remove" : "Bookmark this photo"}
            >
              {props.isCurrentPhotoBookmarked
                ? <BookmarkCheck className="h-3 w-3 fill-current" />
                : <Bookmark className="h-3 w-3" />
              }
              <span className="hidden md:inline">
                {props.isCurrentPhotoBookmarked ? "Bookmarked" : "Bookmark"}
              </span>
            </button>
          )}
          {/* Per-photo public vote count — JUDGES ONLY. Always shown (including 0) so judges always see the metric. Placed AFTER Bookmark per UX spec. */}
          <motion.span
            key={`votes-${selectedEntry.id}-${selectedPhoto.photoIndex}`}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-[10px] font-bold"
            style={{ fontFamily: "var(--font-heading)" }}
            title={`${photoVoteCount ?? 0} public vote${(photoVoteCount ?? 0) === 1 ? "" : "s"} for this photo`}
            aria-label={`${photoVoteCount ?? 0} public votes for this photo`}
          >
            <Heart className="h-3 w-3 fill-current" />
            {photoVoteCount ?? 0}
          </motion.span>
          <div className="h-4 w-px bg-border" />
          <span className="text-[11px] font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
            Photo {displayIdx + 1} <span className="text-muted-foreground/40 font-normal">of {displayTotal}</span>
          </span>
        </div>
      </div>

      {/* ── MAIN CONTENT ── */}
      <div className="relative z-10 flex flex-1 min-h-0 overflow-hidden">

        {/* LEFT SIDEBAR NAV — Round-based (auto-hides) */}
        {/* Sidebar toggle button — always visible */}
        {!showNav && !sidebarPinned && (
          <button
            onClick={() => setSidebarPinned(true)}
            className="absolute left-2 top-2 z-30 w-8 h-8 flex items-center justify-center rounded-lg bg-card/80 backdrop-blur border border-border/40 text-muted-foreground hover:text-foreground hover:bg-card transition-colors"
            aria-label="Show sidebar"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
        )}

        <AnimatePresence>
          {(showNav || sidebarPinned) && (
            <motion.div
              initial={{ x: -220, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -220, opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="w-52 shrink-0 border-r border-border bg-card/95 backdrop-blur-sm flex flex-col overflow-y-auto" style={{ scrollbarGutter: "stable" }}
            >
              {/* Sidebar pin/close toggle */}
              <div className="flex items-center justify-between px-3 py-2 border-b border-border/30">
                <span className="text-[9px] font-bold tracking-[0.2em] uppercase text-muted-foreground/50" style={{ fontFamily: "var(--font-heading)" }}>Filters</span>
                <button
                  onClick={() => setSidebarPinned(p => !p)}
                  className={`w-6 h-6 flex items-center justify-center rounded text-muted-foreground/50 hover:text-foreground transition-colors ${sidebarPinned ? "bg-primary/10 text-primary" : ""}`}
                  aria-label={sidebarPinned ? "Unpin sidebar" : "Pin sidebar"}
                  title={sidebarPinned ? "Unpin sidebar (auto-hide)" : "Pin sidebar open"}
                >
                  <PanelLeft className="h-3.5 w-3.5" />
                </button>
              </div>
              {props.competitions && props.rounds && props.filterCounts ? (
                <JudgeRoundSidebar
                  competitions={props.competitions}
                  selectedCompId={selectedCompId}
                  setSelectedCompId={(id) => guardedAction(() => props.setSelectedCompId?.(id))}
                  expandedComp={props.expandedComp ?? null}
                  setExpandedComp={(id) => guardedAction(() => props.setExpandedComp?.(id))}
                  rounds={props.rounds}
                  selectedRound={props.selectedRound ?? null}
                  setSelectedRound={(id) => guardedAction(() => props.setSelectedRound?.(id))}
                  sidebarView={sidebarView}
                  setSidebarView={(v) => guardedAction(() => { setSidebarView(v as SidebarView); setSelectedPhotoKey(null); })}
                  setSelectedPhotoKey={(k) => guardedAction(() => setSelectedPhotoKey(k))}
                  filterCounts={props.filterCounts}
                  availableTags={availableTags}
                  tagCountsMap={tagCountsMap}
                  setMobileTab={props.setMobileTab}
                />
              ) : (
                /* Fallback: minimal flat filters if round props not passed */
                <>
                  <div className="px-4 pt-4 pb-3">
                    <div className="flex items-center gap-2 mb-0.5">
                      <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                      <h3 className="text-sm font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>Judging Panel</h3>
                    </div>
                  </div>
                  <div className="flex-1 px-2 py-1 space-y-0.5">
                    {[
                      { view: "round" as SidebarView, label: "All Photos", count: totalEntries },
                      { view: "rejected" as SidebarView, label: "Rejected", count: rejectedCount },
                      { view: "accepted" as SidebarView, label: "Qualified", count: acceptedCount },
                      { view: "shortlisted" as SidebarView, label: "Shortlisted", count: shortlistedCount },
                      // Spec V3: 'Needs Review' is R1-only — hidden in R2/R3/R4.
                      ...(props.roundNumber === 1
                        ? [{ view: "needs_review" as SidebarView, label: "Needs Review", count: props.needsReviewCount ?? 0 }]
                        : []),
                    ].map(item => (
                      <button key={item.view} onClick={() => guardedAction(() => { setSidebarView(item.view); setSelectedPhotoKey(null); })}
                        className={`w-full text-left px-3 py-2 rounded-lg text-[12px] flex items-center gap-2.5 transition-all ${
                          sidebarView === item.view ? "bg-primary/[0.12] text-foreground border-l-2 border-primary" : "text-muted-foreground/70 hover:text-foreground hover:bg-muted/10"
                        }`} style={{ fontFamily: "var(--font-heading)" }}>
                        <span className="font-medium flex-1">{item.label}</span>
                        <span className="text-[10px] tabular-nums text-muted-foreground/40">{item.count}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── PHOTO CANVAS ── */}
        <div className="flex-1 flex items-center justify-center min-w-0 min-h-0 relative overflow-auto bg-foreground/5 dark:bg-foreground/10"
          onWheel={(e) => { e.preventDefault(); setZoomLevel((z: number) => Math.min(3, Math.max(0.5, z + (e.deltaY < 0 ? 0.15 : -0.15)))); }}
          onDoubleClick={() => setZoomLevel((z: number) => z === 1 ? 2 : 1)}
        >
          <button onClick={guardedGoPrev} disabled={activePhotoIdx <= 0} aria-label="Previous photo"
            className="absolute left-3 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full flex items-center justify-center bg-card/60 backdrop-blur-sm border border-border text-muted-foreground hover:text-foreground hover:bg-card disabled:opacity-20 transition-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button onClick={guardedGoNext} disabled={activePhotoIdx >= activePhotoList.length - 1} aria-label="Next photo"
            className="absolute right-3 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full flex items-center justify-center bg-card/60 backdrop-blur-sm border border-border text-muted-foreground hover:text-foreground hover:bg-card disabled:opacity-20 transition-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            <ChevronRight className="h-5 w-5" />
          </button>
          <AnimatePresence mode="wait" custom={navDirection}>
            <motion.div
              key={selectedPhotoKey}
              custom={navDirection}
              initial={{ opacity: 0, x: navDirection === 1 ? 28 : -28, scale: 0.98 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: navDirection === 1 ? -20 : 20, scale: 1.01 }}
              transition={{ duration: isDragging.current ? 0 : 0.32, ease: [0.16, 1, 0.3, 1] }}
              // Auto-fit: wrapper takes the photo's intrinsic aspect ratio, capped at the
              // available stage area. Neon border now traces the REAL rendered photo edge.
              className="relative rounded-lg"
              style={{
                transformOrigin: "center center",
                aspectRatio: imgAspect ?? undefined,
                maxWidth: "100%",
                maxHeight: "100%",
                width: imgAspect && imgAspect >= 1 ? "100%" : "auto",
                height: imgAspect && imgAspect < 1 ? "100%" : "auto",
              }}
            >
              <motion.img
                src={selectedPhoto.photoUrl}
                alt={selectedEntry.title}
                animate={{ scale: zoomLevel, x: panOffset.x, y: panOffset.y }}
                transition={{ duration: isDragging.current ? 0 : 0.35, ease: [0.16, 1, 0.3, 1] }}
                className="block w-full h-full object-contain rounded-lg shadow-2xl select-none"
                style={{ cursor: zoomLevel > 1 ? (isDragging.current ? "grabbing" : "grab") : "default" }}
                draggable={false}
                onLoad={(e) => {
                  const img = e.currentTarget as HTMLImageElement;
                  if (img.naturalWidth && img.naturalHeight) {
                    setImgAspect(img.naturalWidth / img.naturalHeight);
                  }
                }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
              />
              {/* Step 20: Judging watermark over hero image (renders only when phase==="judging"). */}
              {props.competitionPhase && (
                <PhaseWatermark
                  phase={props.competitionPhase}
                  currentRound={props.competitionCurrentRound ?? null}
                  surface="lightbox"
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* ── RIGHT: SWITCHABLE PANEL ── */}
        <AnimatePresence mode="wait">
          {rightPanel && (
            <motion.div
              key={rightPanel}
              initial={{ x: 60, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 60, opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 250 }}
              className="hidden md:flex w-[300px] shrink-0 border-l border-border bg-card flex-col min-h-0"
            >
              <div className="flex-1 overflow-y-auto" style={{ scrollbarGutter: "stable" }}>
                {rightPanel === "eval" && (
                  <div className="p-5 space-y-5">
                    {/* VIEW ONLY banner — hides ALL evaluation controls */}
                    {isViewOnly && (
                      <div className="flex flex-col items-center justify-center py-8 text-center space-y-3">
                        <div className="w-12 h-12 rounded-full bg-muted/20 flex items-center justify-center">
                          <Camera className="h-5 w-5 text-muted-foreground/40" />
                        </div>
                        <h4 className="text-[12px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60" style={{ fontFamily: "var(--font-heading)" }}>
                          View Only Mode
                        </h4>
                        <p className="text-[10px] text-muted-foreground/40 max-w-[200px]">
                          Scoring, decisions, tags, and comments are disabled. Start judging to evaluate entries.
                        </p>
                      </div>
                    )}

                    {/* Spec v3: R1/R2/R3 → decision buttons. R4 tags render only in the Quality Tags panel below. */}
                    {!isViewOnly && props.roundNumber && props.roundNumber < 4 && (
                      <RoundDecisionButtons
                        availableTags={availableTags}
                        roundNumber={props.roundNumber as 1 | 2 | 3}
                        currentTagIds={selectedPhotoEvaluation?.tags ?? []}
                        onTagClick={(tagId) =>
                          toggleTag(selectedEntry.id, selectedPhoto.photoIndex, tagId, { skipAdvance: true })
                        }
                        disabled={isLocked || !!taggingEntry}
                        pendingTagId={
                          taggingEntry === `${selectedEntry.id}::${selectedPhoto.photoIndex}`
                            ? (selectedPhotoEvaluation?.tags?.[0] ?? null)
                            : null
                        }
                      />
                    )}

                    {!isViewOnly && !isAnyDecisionMode && roundMode === "scoring" && (
                    <div>
                      <div className="flex items-baseline gap-1.5 mb-1">
                        <div className="relative flex-1 h-1.5 bg-muted/20 rounded-full overflow-hidden">
                          <motion.div className="h-full rounded-full" initial={{ width: 0 }}
                            animate={{ width: `${((avgScore ?? 0) / 10) * 100}%` }}
                            transition={{ duration: 0.6, ease: "easeOut" }}
                            style={{ background: "linear-gradient(90deg, hsl(var(--primary)), hsl(var(--ring)))" }} />
                        </div>
                        <span className="text-2xl font-black text-primary tabular-nums" style={{ fontFamily: "var(--font-display)" }} title="Score (whole number)">
                          {finalIntegerScore !== null && finalIntegerScore !== undefined ? finalIntegerScore : "—"}
                        </span>
                        <span className="text-sm text-muted-foreground/40 font-medium">/ 10</span>
                      </div>
                      {isDirty && (
                        <motion.span initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                          className="text-[9px] text-primary font-semibold uppercase tracking-wider" style={{ fontFamily: "var(--font-heading)" }}>
                          ● Unsaved changes
                        </motion.span>
                      )}
                      {/* SOW Tier Classification — round-aware (Spec v3).
                          R2/R3 only. NO 'Needs Review' / 'Reject'/'Accept' (those are R1 vocab).
                          R2: avg ≥ 7 = Qualified for R3, else Not Selected for R3.
                          R3: avg ≥ 7 = Shortlisted for Final, else Not Selected for Final.
                          Only shown once all 10 criteria are filled. */}
                      {useSOWRoundLogic && finalIntegerScore !== null && finalIntegerScore !== undefined && roundMode === "scoring"
                        && (props.roundNumber === 2 || props.roundNumber === 3)
                        && computedFinal.length === (activeCriteriaKeys as readonly string[]).length && (() => {
                          const passes = finalIntegerScore >= 7;
                          const label = props.roundNumber === 2
                            ? (passes ? "Qualified for R3" : "Not Selected for R3")
                            : (passes ? "Shortlisted for Final" : "Not Selected for Final");
                          return (
                            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                              className={`mt-1 flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider ${
                                passes ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                              }`} style={{ fontFamily: "var(--font-heading)" }}>
                              <CheckCircle className="h-3 w-3" />
                              {label}
                            </motion.div>
                          );
                        })()}
                    </div>
                    )}

                    {/* Criteria Sliders — only in scoring mode, hidden in view only */}
                    {!isViewOnly && !isR1DecisionMode && useSOWCriteria && roundMode === "scoring" && (() => {
                      const totalCount = (activeCriteriaKeys as readonly string[]).length;
                      const setCount = computedFinal.length;
                      const isComplete = setCount === totalCount;
                      return (
                        <div className={`mb-2 px-3 py-1.5 rounded-lg border flex items-center justify-between gap-2 ${isComplete ? "bg-emerald-500/10 border-emerald-500/30" : "bg-amber-500/5 border-amber-500/30"}`}>
                          <span className={`text-[9px] font-bold uppercase tracking-wider ${isComplete ? "text-emerald-500" : "text-amber-500"}`} style={{ fontFamily: "var(--font-heading)" }}>
                            ● Round {props.roundNumber} — 10-Criteria Evaluation (SOW)
                          </span>
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-bold tabular-nums ${isComplete ? "text-emerald-500" : "text-amber-500"}`} style={{ fontFamily: "var(--font-heading)" }}>
                              {setCount} of {totalCount} {isComplete ? "✓ complete" : "required"}
                            </span>
                            {isComplete && finalIntegerScore !== null && (
                              <span className="text-[10px] font-bold tabular-nums text-emerald-500 border-l border-emerald-500/30 pl-2" style={{ fontFamily: "var(--font-heading)" }}>
                                Score {finalIntegerScore} / 10
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                    {!isViewOnly && !isR1DecisionMode && roundMode === "scoring" && (activeCriteriaKeys as readonly string[]).map((key, idx) => {
                      const val = localCriteria[key as keyof CriteriaScores];
                      const isUnset = val === null;
                      const pct = isUnset ? 0 : ((val ?? 0) / 10) * 100;
                      return (
                        <motion.div key={key} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * idx }}>
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="text-[10px] font-bold tracking-[0.2em] uppercase text-muted-foreground/70" style={{ fontFamily: "var(--font-heading)" }}>
                              {activeCriteriaLabels[key] || CRITERIA_LABELS_MAP[key]}
                              {isUnset && useSOWCriteria && (
                                <span className="ml-1.5 text-[9px] font-bold text-amber-500 normal-case tracking-normal">* required</span>
                              )}
                              {isUnset && !useSOWCriteria && <span className="ml-1.5 text-[9px] font-normal text-muted-foreground/30 normal-case tracking-normal">not set</span>}
                            </h4>
                            <div className="flex items-center gap-1.5">
                              {!isUnset && (
                                <span className="text-[10px] font-bold tabular-nums text-primary" style={{ fontFamily: "var(--font-heading)" }}>{Math.round(val ?? 0)}</span>
                              )}
                              {!isUnset && (
                                <button onClick={() => handleResetCriteria(key)} className="text-muted-foreground/30 hover:text-muted-foreground transition-colors" title="Clear criterion" aria-label={`Clear ${activeCriteriaLabels[key] || key}`}>
                                  <Minimize2 className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          </div>
                          <div className={`relative flex items-center gap-2 ${isUnset ? "" : ""}`}>
                            <div className={`relative flex-1 h-1.5 rounded-full cursor-pointer group ${isUnset ? "bg-muted/10 border border-dashed border-muted-foreground/15" : "bg-muted/20"}`}>
                              <input type="range" min={0} max={10} step={1} value={val ?? 0}
                                onChange={(e) => handleSliderChange(key, Math.round(parseInt(e.target.value)))}
                                aria-label={activeCriteriaLabels[key] || key}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" style={{ margin: 0 }} />
                              {!isUnset && (
                                <>
                                  <motion.div className="h-full rounded-full" animate={{ width: `${pct}%` }} transition={{ duration: 0.1 }}
                                    style={{ background: "linear-gradient(90deg, hsl(var(--primary)), hsl(var(--ring)))" }} />
                                  <motion.div className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary)/0.5)] group-hover:scale-125 transition-transform"
                                    animate={{ left: `clamp(0px, calc(${pct}% - 8px), calc(100% - 16px))` }} transition={{ duration: 0.1 }} />
                                </>
                              )}
                            </div>
                            {/* Manual input box */}
                            <input
                              type="number"
                              min={0}
                              max={10}
                              step={1}
                              value={isUnset ? "" : (val ?? 0)}
                              onChange={(e) => {
                                const v = parseInt(e.target.value);
                                if (!isNaN(v) && v >= 0 && v <= 10) handleSliderChange(key, v);
                                else if (e.target.value === "") handleResetCriteria(key);
                              }}
                              placeholder="—"
                              disabled={isLocked}
                              className="w-12 h-6 text-center text-[10px] font-bold tabular-nums bg-muted/10 border border-border rounded focus:border-primary/50 focus:outline-none transition-colors disabled:opacity-40"
                              style={{ fontFamily: "var(--font-heading)" }}
                              aria-label={`${activeCriteriaLabels[key] || key} manual input`}
                            />
                          </div>
                        </motion.div>
                      );
                    })}

                    {/* Quality Tags — Spec v3: R4 ONLY (Winner/Runner-Up/Top-N/etc). Hidden in R1–R3. */}
                    {!isViewOnly && !isR1DecisionMode && props.roundNumber === 4 && (
                    <div>
                      <h4 className="text-[10px] font-bold tracking-[0.25em] uppercase text-muted-foreground/70 mb-3" style={{ fontFamily: "var(--font-heading)" }}>Quality Tags</h4>
                      <div className="flex flex-wrap gap-2">
                        {filteredTags.map(tag => {
                          const isActive = selectedPhotoEvaluation?.tags.includes(tag.id);
                          const tagColor = tag.color || "hsl(var(--muted-foreground))";
                          return (
                            <motion.button key={tag.id} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                              onClick={() => toggleTag(selectedEntry.id, selectedPhoto.photoIndex, tag.id)}
                              disabled={!!taggingEntry || isLocked}
                              aria-pressed={!!isActive}
                              className={`flex items-center gap-1.5 px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.15em] rounded border transition-all ${
                                isActive ? "" : "border-border bg-transparent text-muted-foreground/40 hover:text-foreground hover:border-muted-foreground/30"
                              }`}
                              style={isActive
                                ? { fontFamily: "var(--font-heading)", color: tagColor, borderColor: tagColor, backgroundColor: `${tagColor}15` }
                                : { fontFamily: "var(--font-heading)" }}>
                              <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: isActive ? tagColor : "hsl(var(--muted-foreground) / 0.4)" }} />
                              {tag.label}
                            </motion.button>
                          );
                        })}
                        {isAdmin && !showNewTagInput && (
                          <motion.button whileHover={{ scale: 1.05 }} onClick={() => setShowNewTagInput(true)}
                            className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.15em] rounded border border-dashed border-border text-muted-foreground/30 hover:text-muted-foreground/60 hover:border-muted-foreground/40 transition-all flex items-center gap-1"
                            style={{ fontFamily: "var(--font-heading)" }}>
                            <Plus className="h-3 w-3" /> New Tag
                          </motion.button>
                        )}
                        {isAdmin && showNewTagInput && (
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="flex items-center gap-1.5 w-full mt-1">
                            <input type="text" value={newTagLabel} onChange={e => setNewTagLabel(e.target.value)}
                              placeholder="Tag name..." autoFocus maxLength={30} aria-label="New tag name"
                              onKeyDown={e => { if (e.key === "Enter") handleCreateTag(); if (e.key === "Escape") { setShowNewTagInput(false); setNewTagLabel(""); } }}
                              className="flex-1 bg-muted/10 border border-border rounded px-2 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/50" />
                            <button onClick={handleCreateTag} disabled={creatingTag || !newTagLabel.trim()}
                              aria-label="Create tag"
                              className="px-2 py-1.5 rounded bg-primary/10 text-primary text-[9px] font-bold uppercase disabled:opacity-30 hover:bg-primary/20 transition-colors"
                              style={{ fontFamily: "var(--font-heading)" }}>
                              {creatingTag ? <Loader2 className="h-3 w-3 animate-spin" /> : "Add"}
                            </button>
                            <button onClick={() => { setShowNewTagInput(false); setNewTagLabel(""); }}
                              aria-label="Cancel tag creation"
                              className="p-1 text-muted-foreground/40 hover:text-foreground transition-colors">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </motion.div>
                        )}
                      </div>
                    </div>
                    )}

                    {/* Judge's Notes — hidden in view only */}
                    {!isViewOnly && (
                    <div>
                      <button onClick={() => setNotesExpanded(p => !p)} className="flex items-center justify-between w-full mb-2 group">
                        <h4 className="text-[10px] font-bold tracking-[0.25em] uppercase text-muted-foreground/70 flex items-center gap-1" style={{ fontFamily: "var(--font-heading)" }}>
                          <ChevronRight className={`h-3 w-3 transition-transform ${notesExpanded ? "rotate-90" : ""}`} />
                          Your Notes
                        </h4>
                        <span className="text-[9px] tabular-nums text-muted-foreground/30" style={{ fontFamily: "var(--font-heading)" }}>{feedbackInput.length}/500</span>
                      </button>
                      <AnimatePresence initial={false}>
                        {notesExpanded && (
                          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                            <textarea value={feedbackInput} onChange={(e) => { if (e.target.value.length <= 500) { setFeedbackInput(e.target.value); setFeedbackDirty(true); } }}
                              disabled={isLocked}
                              maxLength={500}
                              placeholder="Type evaluation notes..." rows={3}
                              className="w-full bg-muted/10 border border-border rounded-lg px-3 py-2.5 text-[12px] text-foreground placeholder:text-muted-foreground/30 resize-none focus:outline-none focus:border-primary/50 transition-colors disabled:opacity-50"
                              style={{ fontFamily: "var(--font-body)" }} />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                    )}

                    {/* Comments Section — hidden in view only */}
                    {!isViewOnly && (
                    <div>
                      <button onClick={() => setCommentsExpanded(p => !p)} className="flex items-center w-full mb-2 group">
                        <h4 className="text-[10px] font-bold tracking-[0.25em] uppercase text-muted-foreground/70 flex items-center gap-1" style={{ fontFamily: "var(--font-heading)" }}>
                          <ChevronRight className={`h-3 w-3 transition-transform ${commentsExpanded ? "rotate-90" : ""}`} />
                          Comments <span className="text-muted-foreground/30 font-normal normal-case tracking-normal">({photoComments.length})</span>
                        </h4>
                      </button>
                      <AnimatePresence initial={false}>
                        {commentsExpanded && (
                          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                            {photoComments.length > 0 && (
                              <div className="space-y-2 mb-3 max-h-32 overflow-y-auto scrollbar-hide">
                                {photoComments.map(c => (
                                  <motion.div key={c.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                                    className="bg-muted/5 rounded-lg px-3 py-2 border border-border/30">
                                    <div className="flex items-center justify-between mb-0.5">
                                      <span className="text-[9px] font-bold text-muted-foreground/60" style={{ fontFamily: "var(--font-heading)" }}>
                                        {c.judge_id === userId ? "You" : (c.judge_name || "Judge")}
                                      </span>
                                      <span className="text-[9px] text-muted-foreground/30">{new Date(c.created_at).toLocaleString()}</span>
                                    </div>
                                    <p className="text-[11px] text-foreground/80 leading-relaxed">{c.comment}</p>
                                  </motion.div>
                                ))}
                              </div>
                            )}
                            <CommentInput
                              commentInput={commentInput}
                              setCommentInput={setCommentInput}
                              addComment={addComment}
                              selectedEntry={selectedEntry}
                              selectedPhoto={selectedPhoto}
                              isLocked={isLocked}
                            />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                    )}

                    {/* Submit Evaluation — only in scoring mode, hidden in view only.
                        Spec v3: in R2/R3, gate behind all 10 criteria filled. */}
                    {!isViewOnly && roundMode === "scoring" && (() => {
                      const totalCriteria = (activeCriteriaKeys as readonly string[]).length;
                      const isScoringRound = props.roundNumber === 2 || props.roundNumber === 3;
                      const criteriaIncomplete = isScoringRound && computedFinal.length < totalCriteria;
                      const submitDisabled = isLocked || !!scoringEntry || criteriaIncomplete;
                      const label = isLocked
                        ? "Round Locked"
                        : criteriaIncomplete
                          ? `Score ${totalCriteria - computedFinal.length} more criteria`
                          : isDirty ? "Submit Evaluation ●" : "Submit Evaluation";
                      return (
                        <motion.button whileHover={{ scale: submitDisabled ? 1 : 1.01 }} whileTap={{ scale: submitDisabled ? 1 : 0.97 }}
                          onClick={handleSubmitEvaluation}
                          disabled={submitDisabled}
                          className={`w-full py-3 rounded-xl text-[12px] font-bold uppercase tracking-[0.2em] text-primary-foreground transition-all shadow-lg shadow-primary/20 disabled:opacity-50 disabled:cursor-not-allowed ${isDirty && !criteriaIncomplete ? "ring-2 ring-amber-500/50" : ""}`}
                          style={{ fontFamily: "var(--font-heading)", background: "linear-gradient(135deg, hsl(var(--primary)), hsl(var(--ring)))" }}>
                          {label}
                        </motion.button>
                      );
                    })()}
                  </div>
                )}

                {rightPanel === "exif" && (() => {
                  /* SOW v2.2 — Per-photo EXIF resolution.
                   * Source of truth: selectedEntry.photo_meta[activePhotoIdx].exif.
                   * Fallback: legacy single-blob selectedEntry.exif_data (pre-migration entries
                   * are auto-mirrored into photo_meta[0] by the Phase-1 backfill, so this branch
                   * mainly catches stale in-memory snapshots).
                   * Per-photo policy: One Image, One Card, One EXIF. */
                  const meta: any = Array.isArray((selectedEntry as any).photo_meta)
                    ? (selectedEntry as any).photo_meta[activePhotoIdx ?? 0]
                    : null;
                  const exifSource: Record<string, unknown> | null =
                    (meta?.exif && typeof meta.exif === "object" ? meta.exif : null) ??
                    (selectedEntry.exif_data as Record<string, unknown> | null) ??
                    null;
                  const exifAvailable = meta ? Boolean(meta.exif_available) : Boolean(exifSource);
                  const rawRequired = Boolean(meta?.raw_required);
                  const photoTitle: string | undefined =
                    typeof meta?.title === "string" && meta.title.trim() ? meta.title.trim() : undefined;

                  return (
                  <div className="p-5 space-y-4">
                    <h3 className="text-[11px] font-bold tracking-[0.25em] uppercase text-muted-foreground/70" style={{ fontFamily: "var(--font-heading)" }}>
                      <Camera className="h-3.5 w-3.5 inline mr-1.5 -mt-0.5" /> EXIF — Photo {(activePhotoIdx ?? 0) + 1}
                    </h3>

                    {photoTitle && photoTitle !== selectedEntry.title && (
                      <div className="px-3 py-2 bg-muted/30 border border-border/40 rounded-lg">
                        <p className="text-[9px] text-muted-foreground/60 uppercase tracking-[0.2em] mb-0.5" style={{ fontFamily: "var(--font-heading)" }}>Photo Title</p>
                        <p className="text-[11px] font-medium text-foreground">{photoTitle}</p>
                      </div>
                    )}

                    {rawRequired && (
                      <div className="px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                        <p className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider" style={{ fontFamily: "var(--font-heading)" }}>RAW Commitment</p>
                        <p className="text-[10px] text-muted-foreground/80 mt-0.5">Photographer committed to submit RAW on request — required if shortlisted.</p>
                      </div>
                    )}

                    {exifSource && Object.keys(exifSource).length > 0 ? (
                      <div className="space-y-2">
                        {(() => {
                          const summary = formatExifSummary(exifSource);
                          return summary ? (
                            <div className="px-3 py-2 bg-primary/5 border border-primary/20 rounded-lg mb-2">
                              <span className="text-[11px] font-semibold text-foreground tabular-nums" style={{ fontFamily: "var(--font-heading)" }}>{summary}</span>
                            </div>
                          ) : null;
                        })()}
                        {formatExifData(exifSource).map((field, idx) => (
                          <motion.div key={field.label} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.03 }}
                            className="flex items-center justify-between py-1.5 border-b border-border/20 last:border-0">
                            <span className="text-[10px] text-muted-foreground/60 font-medium" style={{ fontFamily: "var(--font-heading)" }}>
                              {field.label}
                            </span>
                            <span className="text-[10px] text-foreground font-semibold tabular-nums">{field.value}</span>
                          </motion.div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-12 text-center">
                        <Camera className="h-8 w-8 text-muted-foreground/15 mb-3" />
                        <p className="text-[11px] text-muted-foreground/40" style={{ fontFamily: "var(--font-heading)" }}>
                          {exifAvailable ? "EXIF flagged available but empty" : "No EXIF — RAW will be requested"}
                        </p>
                        <p className="text-[9px] text-muted-foreground/25 mt-1">Per-photo metadata (photo_meta[{activePhotoIdx ?? 0}].exif)</p>
                      </div>
                    )}

                    {/* AI Detection Info */}
                    {selectedEntry.is_ai_generated && (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                        className="mt-4 p-3 bg-destructive/5 border border-destructive/20 rounded-lg">
                        <div className="flex items-center gap-2 mb-1">
                          <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                          <span className="text-[10px] font-bold text-destructive uppercase tracking-wider" style={{ fontFamily: "var(--font-heading)" }}>AI Generated (Self-Declared)</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground/60 leading-relaxed">The photographer has declared this image as AI-generated at submission.</p>
                      </motion.div>
                    )}

                    {/* Entry Info */}
                    <div className="mt-4 space-y-2 pt-4 border-t border-border/30">
                      <h4 className="text-[9px] font-bold tracking-[0.25em] uppercase text-muted-foreground/40 mb-2" style={{ fontFamily: "var(--font-heading)" }}>Entry Details</h4>
                      {[
                        { label: "Title", value: selectedEntry.title },
                        { label: "Photographer", value: selectedEntry.photographer_name || "Unknown" },
                        { label: "Status", value: (() => {
                          // PER-PHOTO RULE: status reflects this photo's judge decision only.
                          // Never fall back to entry.status (entry-level aggregate misleads).
                          const d = selectedPhotoEvaluation?.decision;
                          const map: Record<string, string> = { accept: "Accept", round1_qualified: "Accept", shortlist: "Shortlist for R2", shortlisted: "Shortlist for R2", needs_review: "Needs Review", reject: "Reject", rejected: "Reject" };
                          return d ? map[d] ?? d : "Pending";
                        })() },
                        { label: "Submitted", value: new Date(selectedEntry.created_at).toLocaleDateString() },
                        { label: "Photos", value: `${selectedEntry.photos.length} image${selectedEntry.photos.length > 1 ? "s" : ""}` },
                      ].map(item => (
                        <div key={item.label} className="flex items-center justify-between py-1 border-b border-border/10 last:border-0">
                          <span className="text-[9px] text-muted-foreground/50" style={{ fontFamily: "var(--font-heading)" }}>{item.label}</span>
                          <span className="text-[10px] text-foreground/80 font-medium">{item.value}</span>
                        </div>
                      ))}
                    </div>

                    {/* P4 — Per-photo EXIF + RAW commitment audit trail (read-only). */}
                    <PhotoExifAuditTrail
                      entryId={selectedEntry.id}
                      photoIndex={activePhotoIdx ?? 0}
                      photoMeta={meta}
                    />
                  </div>
                  );
                })()}

                {rightPanel === "raw" && (
                  <JudgeRawSubmissionsPanel
                    competitionId={selectedCompId}
                    onJump={(entryId, photoIndex) => {
                      setSelectedPhotoKey(`${entryId}::${photoIndex}`);
                      setRightPanel("eval");
                    }}
                  />
                )}

                {rightPanel === "dupes" && (
                  <JudgeDuplicatesPanel
                    competitionId={selectedCompId}
                    onJump={(entryId, photoIndex) => {
                      setSelectedPhotoKey(`${entryId}::${photoIndex}`);
                      setRightPanel("eval");
                    }}
                  />
                )}

                {rightPanel === "history" && (
                  <div className="p-5 space-y-4">
                    <h3 className="text-[11px] font-bold tracking-[0.25em] uppercase text-muted-foreground/70" style={{ fontFamily: "var(--font-heading)" }}>
                      <Clock className="h-3.5 w-3.5 inline mr-1.5 -mt-0.5" /> Scoring History
                    </h3>

                    {/* SOW: Previous Round Decisions — per-judge from judge_decisions table */}
                    {props.roundNumber && props.roundNumber >= 2 && (() => {
                      const entryDecisions = props.photoDecisionsMap?.[`${selectedEntry.id}::${selectedPhoto.photoIndex}`];
                      const allDecs = entryDecisions?.allDecisions ?? [];

                      const ROUND_LABELS: Record<number, string> = { 1: "R1 — Initial Screening", 2: "R2 — Scoring", 3: "R3 — Scoring" };
                      const DECISION_STYLES: Record<string, string> = {
                        accept: "text-primary border-primary/30",
                        accepted: "text-primary border-primary/30",
                        shortlist: "text-amber-500 border-amber-500/30",
                        shortlisted: "text-amber-500 border-amber-500/30",
                        qualified: "text-primary border-primary/30",
                        finalist: "text-primary border-primary/30",
                        reject: "text-destructive border-destructive/30",
                        rejected: "text-destructive border-destructive/30",
                        needs_review: "text-muted-foreground border-muted-foreground/30",
                      };
                      const DECISION_LABELS: Record<string, string> = {
                        accept: "Accept", accepted: "Accept",
                        shortlist: "Shortlist", shortlisted: "Shortlist",
                        qualified: "Qualified", finalist: "Finalist",
                        reject: "Reject", rejected: "Reject",
                        needs_review: "Needs Review", winner: "Winner",
                      };

                      // Group decisions by round_number, only show rounds < current
                      const previousRounds = Array.from(new Set(allDecs.map(d => d.round_number)))
                        .filter(rn => rn < props.roundNumber!)
                        .sort((a, b) => a - b);

                      return (
                        <div className="bg-muted/10 border border-border/30 rounded-lg p-3 space-y-2">
                          <h4 className="text-[9px] font-bold tracking-[0.2em] uppercase text-muted-foreground/50" style={{ fontFamily: "var(--font-heading)" }}>
                            Previous Round Tags
                          </h4>
                          <div className="space-y-2">
                            {previousRounds.length === 0 && (
                              <p className="text-[9px] text-muted-foreground/40 italic">No previous round tags recorded</p>
                            )}
                            {previousRounds.map(rn => {
                              const roundDecs = allDecs.filter(d => d.round_number === rn);
                              return (
                                <div key={rn} className="space-y-1">
                                  <span className="text-[9px] text-muted-foreground/60 font-semibold" style={{ fontFamily: "var(--font-heading)" }}>
                                    {ROUND_LABELS[rn] ?? `R${rn}`}
                                  </span>
                                  {roundDecs.map((dec, idx) => {
                                    const judgeName = props.judgeNameMap?.get(dec.judge_id)
                                      || (dec.judge_id === userId ? "You" : `Judge ${idx + 1}`);
                                    const style = DECISION_STYLES[dec.decision] ?? "text-muted-foreground border-border/30";
                                    const label = DECISION_LABELS[dec.decision] ?? dec.decision;
                                    return (
                                      <div key={`${rn}-${dec.judge_id}`} className="flex items-center justify-between py-0.5 pl-2">
                                        <span className="text-[9px] text-muted-foreground/50" style={{ fontFamily: "var(--font-heading)" }}>
                                          {judgeName}
                                        </span>
                                        <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${style}`} style={{ fontFamily: "var(--font-heading)" }}>
                                          {label}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })}
                          </div>
                          {/* Average score from entry_score_cache */}
                          {selectedEntry.avg_score != null && (
                            <div className="flex items-center justify-between py-1 border-t border-border/20 mt-1 pt-1">
                              <span className="text-[9px] text-muted-foreground/60" style={{ fontFamily: "var(--font-heading)" }}>Average (10 criteria) — entry</span>
                              <span className="text-[11px] font-black text-primary tabular-nums" style={{ fontFamily: "var(--font-display)" }}>
                                {selectedEntry.avg_score.toFixed(1)} / 10
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    {/* Show own score + count for regular judges; full breakdown for admins */}
                    {(() => {
                      const allScores = selectedPhotoEvaluation?.allScores ?? [];
                      const myScore = allScores.find(s => s.judge_id === userId);
                      const otherCount = allScores.filter(s => s.judge_id !== userId).length;

                      // R1 decision history — show when decisions exist but no scores
                      const currentDecision = selectedPhotoEvaluation?.decision;
                      const hasDecisionOnly = allScores.length === 0 && !!currentDecision;

                      if (allScores.length === 0 && !currentDecision) {
                        return (
                          <div className="flex flex-col items-center justify-center py-12 text-center">
                            <Clock className="h-8 w-8 text-muted-foreground/15 mb-3" />
                            <p className="text-[11px] text-muted-foreground/40" style={{ fontFamily: "var(--font-heading)" }}>No scores recorded yet</p>
                            <p className="text-[9px] text-muted-foreground/25 mt-1">Score this photo to begin</p>
                          </div>
                        );
                      }

                      if (hasDecisionOnly) {
                        const decisionLabels: Record<string, { label: string; color: string }> = {
                          accept: { label: "Accept", color: "text-emerald-400 border-emerald-400/30 bg-emerald-400/10" },
                          round1_qualified: { label: "Accept", color: "text-emerald-400 border-emerald-400/30 bg-emerald-400/10" },
                          shortlist: { label: "Shortlist for R2", color: "text-amber-400 border-amber-400/30 bg-amber-400/10" },
                          shortlisted: { label: "Shortlist for R2", color: "text-amber-400 border-amber-400/30 bg-amber-400/10" },
                          needs_review: { label: "Needs Review", color: "text-sky-400 border-sky-400/30 bg-sky-400/10" },
                          reject: { label: "Reject", color: "text-destructive border-destructive/30 bg-destructive/10" },
                          rejected: { label: "Reject", color: "text-destructive border-destructive/30 bg-destructive/10" },
                        };
                        const info = decisionLabels[currentDecision] ?? { label: currentDecision, color: "text-muted-foreground border-border" };
                        return (
                          <div className="space-y-3">
                            <div className="bg-muted/10 border border-border/30 rounded-lg p-3 space-y-2">
                              <h4 className="text-[9px] font-bold tracking-[0.2em] uppercase text-muted-foreground/50" style={{ fontFamily: "var(--font-heading)" }}>
                                R1 — Initial Screening Tag
                              </h4>
                              <div className="flex items-center justify-between py-1">
                                <span className="text-[9px] text-muted-foreground/60" style={{ fontFamily: "var(--font-heading)" }}>Your Tag</span>
                                <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${info.color}`} style={{ fontFamily: "var(--font-heading)" }}>
                                  {info.label}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      }

                      if (isAdmin) {
                        // Admin sees all scores — use stable judge_id hash for labels
                        const judgeIdOrder = [...new Set(allScores.map(s => s.judge_id))];
                        return (
                          <div className="space-y-2">
                            {allScores.map((s, i) => {
                              const judgeNum = judgeIdOrder.indexOf(s.judge_id) + 1;
                              return (
                              <motion.div key={s.judge_id} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                                className="flex items-center gap-3 py-2 border-b border-border/20 last:border-0">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-black text-primary-foreground ${
                                  s.score >= 7 ? "bg-primary" : s.score >= 4 ? "bg-muted-foreground" : "bg-destructive"
                                }`} style={{ fontFamily: "var(--font-display)" }}>{s.score}</div>
                                <div className="flex-1">
                                  <span className="text-[10px] font-semibold text-foreground/80" style={{ fontFamily: "var(--font-heading)" }}>
                                    {s.judge_id === userId ? "You" : `Judge ${judgeNum}`}
                                  </span>
                                </div>
                                <div className="h-1 flex-1 bg-muted/20 rounded-full overflow-hidden">
                                  <motion.div className="h-full rounded-full" initial={{ width: 0 }}
                                    animate={{ width: `${(s.score / 10) * 100}%` }}
                                    transition={{ duration: 0.5, delay: i * 0.1 }}
                                    style={{ background: s.score >= 7 ? "hsl(var(--primary))" : s.score >= 4 ? "hsl(var(--muted-foreground))" : "hsl(var(--destructive))" }} />
                                </div>
                              </motion.div>
                              );
                            })}
                            {allScores.length > 1 && (
                              <div className="mt-3 pt-3 border-t border-border/30 flex items-center justify-between">
                                <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/50" style={{ fontFamily: "var(--font-heading)" }}>Average</span>
                                <span className="text-lg font-black text-primary tabular-nums" style={{ fontFamily: "var(--font-display)" }}>
                                  {(allScores.reduce((a, b) => a + b.score, 0) / allScores.length).toFixed(1)}
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      }

                      // Regular judge: only their own score + peer count
                      return (
                        <div className="space-y-3">
                          {myScore && (
                            <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}
                              className="flex items-center gap-3 py-2 border-b border-border/20">
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-black text-primary-foreground ${
                                myScore.score >= 7 ? "bg-primary" : myScore.score >= 4 ? "bg-muted-foreground" : "bg-destructive"
                              }`} style={{ fontFamily: "var(--font-display)" }}>{myScore.score}</div>
                              <div className="flex-1">
                                <span className="text-[10px] font-semibold text-foreground/80" style={{ fontFamily: "var(--font-heading)" }}>Your Score</span>
                              </div>
                              <div className="h-1 flex-1 bg-muted/20 rounded-full overflow-hidden">
                                <motion.div className="h-full rounded-full" initial={{ width: 0 }}
                                  animate={{ width: `${(myScore.score / 10) * 100}%` }}
                                  transition={{ duration: 0.5 }}
                                  style={{ background: myScore.score >= 7 ? "hsl(var(--primary))" : myScore.score >= 4 ? "hsl(var(--muted-foreground))" : "hsl(var(--destructive))" }} />
                              </div>
                            </motion.div>
                          )}
                          {otherCount > 0 && (
                            <div className="text-center py-2">
                              <span className="text-[10px] text-muted-foreground/50" style={{ fontFamily: "var(--font-heading)" }}>
                                {otherCount} other judge{otherCount > 1 ? "s have" : " has"} also scored this photo
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* Comment timeline */}
                    {photoComments.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-border/30">
                        <h4 className="text-[9px] font-bold tracking-[0.25em] uppercase text-muted-foreground/40 mb-3" style={{ fontFamily: "var(--font-heading)" }}>Comment Timeline</h4>
                        <div className="relative pl-4 space-y-3">
                          <div className="absolute left-[5px] top-2 bottom-2 w-px bg-border/30" />
                          {photoComments.map((c, i) => (
                            <motion.div key={c.id} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                              className="relative">
                              <div className="absolute -left-4 top-1.5 w-2.5 h-2.5 rounded-full bg-primary/30 border-2 border-card" />
                              <div className="bg-muted/5 rounded px-3 py-2 border border-border/20">
                                <div className="flex items-center justify-between mb-0.5">
                                  <span className="text-[9px] font-bold text-muted-foreground/50" style={{ fontFamily: "var(--font-heading)" }}>
                                    {c.judge_id === userId ? "You" : (c.judge_name || "Judge")}
                                  </span>
                                  <span className="text-[9px] text-muted-foreground/30">{new Date(c.created_at).toLocaleString()}</span>
                                </div>
                                <p className="text-[10px] text-foreground/70 leading-relaxed">{c.comment}</p>
                              </div>
                            </motion.div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── FAR RIGHT: ICON TOOLBAR ── */}
        <TooltipProvider delayDuration={300}>
          <div className="hidden md:flex w-12 shrink-0 border-l border-border bg-card flex-col items-center pt-4 gap-1">
            {([
              { key: "eval" as const, icon: <ListChecks className="h-4 w-4" />, label: "Evaluate", tip: "Score & tag this photo" },
              { key: "exif" as const, icon: <Camera className="h-4 w-4" />, label: "Metadata", tip: "View EXIF & entry info" },
              { key: "raw" as const, icon: <FileWarning className="h-4 w-4" />, label: "RAW", tip: "RAW submission commitments for this competition" },
              { key: "dupes" as const, icon: <Copy className="h-4 w-4" />, label: "Dupes", tip: "Duplicate / similar image clusters in this competition" },
              { key: "history" as const, icon: <Clock className="h-4 w-4" />, label: "History", tip: "Scoring history & comments" },
            ]).map(item => (
              <Tooltip key={item.key}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setRightPanel(prev => prev === item.key ? null : item.key)}
                    aria-label={item.label}
                    className={`flex flex-col items-center gap-0.5 p-2 rounded-lg transition-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none ${
                      rightPanel === item.key ? "text-primary bg-primary/5" : "text-muted-foreground/25 hover:text-muted-foreground/60"
                    }`}>
                    {item.icon}
                    <span className="text-[7px] font-bold uppercase tracking-tight leading-none truncate max-w-[40px]" style={{ fontFamily: "var(--font-heading)" }}>{item.label}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left" className="text-xs">{item.tip}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        </TooltipProvider>
      </div>

      {/* ── BOTTOM FOOTER ── */}
      <div className="relative z-10 shrink-0 border-t border-border bg-card/95 backdrop-blur-sm">
        <div className="flex items-center gap-1.5 px-4 py-2 overflow-x-auto scrollbar-hide" role="listbox" aria-label="Photo filmstrip">
          {activePhotoList.slice(Math.max(0, activePhotoIdx - 4), activePhotoIdx + 5).map((p) => {
            const k = getPhotoKey(p);
            const isActive = k === selectedPhotoKey;
            const pScoreData = photoScoresMap[k];
            const isScored = pScoreData?.myScore !== null && pScoreData?.myScore !== undefined;
            const isBookmarked = !!props.bookmarkedEntryId && p.entryId === props.bookmarkedEntryId && (props.bookmarkedPhotoIndex ?? 0) === (p.photoIndex ?? 0);
            return (
              <button key={k} onClick={() => guardedAction(() => { setSelectedPhotoKey(k); setZoomLevel(() => 1); })}
                ref={el => { if (isActive && el && lastScrolledKey.current !== k) { lastScrolledKey.current = k; requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" })); } }}
                aria-label={`Photo thumbnail${isScored ? " (scored)" : ""}${isBookmarked ? " (bookmarked)" : ""}`}
                aria-selected={isActive}
                role="option"
                className={`relative w-11 h-11 rounded-md overflow-hidden border-2 shrink-0 transition-all ${
                  isActive ? "border-primary ring-1 ring-primary/30 scale-105"
                  : isBookmarked ? "border-amber-400 ring-1 ring-amber-400/40 opacity-90"
                  : "border-border/30 opacity-50 hover:opacity-80"
                }`}>
                <img src={p.photoUrl} alt={p.entry.title} className="w-full h-full object-cover" loading="lazy" />
                {/* Step 20: tiny watermark on filmstrip thumb (only renders when phase==="judging"). */}
                {props.competitionPhase && (
                  <PhaseWatermark
                    phase={props.competitionPhase}
                    currentRound={props.competitionCurrentRound ?? null}
                    surface="cinema"
                  />
                )}
                {isBookmarked && (
                  <div
                    className="absolute -top-1 -left-1 w-3.5 h-3.5 rounded-full bg-amber-400 text-background flex items-center justify-center shadow ring-1 ring-background"
                    title="Bookmarked"
                  >
                    <BookmarkCheck className="h-2 w-2" />
                  </div>
                )}
                {isScored && (
                  <div className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-primary border border-card" />
                )}
                {isActive && (
                  <motion.div
                    layoutId="filmstrip-active-indicator"
                    className="absolute -bottom-1 left-1 right-1 h-0.5 rounded-full bg-primary"
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-between px-4 py-2 border-t border-border/50">
          <div className="flex items-center gap-3">
            <button onClick={guardedGoPrev} disabled={activePhotoIdx <= 0} aria-label="Previous photo" className="text-muted-foreground/40 hover:text-foreground disabled:opacity-20 transition-colors"><ChevronLeft className="h-4 w-4" /></button>
            <span className="text-[11px] text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
              <span className="font-bold">PHOTO {displayIdx + 1}</span>
              <span className="text-muted-foreground/40 ml-1.5">OF {displayTotal}</span>
            </span>
            <button onClick={guardedGoNext} disabled={activePhotoIdx >= activePhotoList.length - 1} aria-label="Next photo" className="text-muted-foreground/40 hover:text-foreground disabled:opacity-20 transition-colors"><ChevronRight className="h-4 w-4" /></button>
          </div>
          {/* Footer score chips — R2/R3 only. R1 = decision-only, R4 = sliders + tags (no quick-score chips). */}
          {!isViewOnly && !isAnyDecisionMode && (props.roundNumber === 2 || props.roundNumber === 3) && (
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-bold text-muted-foreground/30 uppercase tracking-widest mr-1 hidden sm:inline" style={{ fontFamily: "var(--font-heading)" }}>Score</span>
            {[0,1,2,3,4,5,6,7,8,9].map(n => (
              <button key={n} onClick={() => {
                  if (isScoreEditingBlocked) return;
                  const criteriaToSend = computedFinal.length > 0 ? localCriteria : undefined;
                  handleQuickScore(selectedEntry.id, selectedPhoto.photoIndex, n, { skipAdvance: true, criteria: criteriaToSend });
                  setIsDirty(false);
                  setFeedbackDirty(false);
                }}
                disabled={isScoreEditingBlocked}
                title={`Key ${n} → Score ${n}`}
                aria-label={`Score ${n}`}
                className="w-6 h-6 rounded border border-border text-[10px] font-bold text-muted-foreground/60 hover:text-foreground hover:border-muted-foreground/40 transition-all flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
                style={{ fontFamily: "var(--font-heading)" }}>
                {n}
              </button>
            ))}
            <button onClick={() => {
                if (isScoreEditingBlocked) return;
                const criteriaToSend = computedFinal.length > 0 ? localCriteria : undefined;
                handleQuickScore(selectedEntry.id, selectedPhoto.photoIndex, 10, { skipAdvance: true, criteria: criteriaToSend });
                setIsDirty(false);
                setFeedbackDirty(false);
              }}
              disabled={isScoreEditingBlocked}
              title="Shift+1 → Score 10"
              aria-label="Score 10"
              className="w-7 h-6 rounded border border-border text-[10px] font-bold text-muted-foreground/60 hover:text-foreground hover:border-muted-foreground/40 transition-all flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ fontFamily: "var(--font-heading)" }}>
              10
            </button>
          </div>
          )}
          {/* Plan Step 4.2: R2/R3 are STRICTLY BINARY — no Reject/Accept quick keypad.
              Outcome is derived from the 10-criteria average (≥7 = Qualified, <7 = Not Selected)
              per memory `judging/r2-r3-no-needs-review`. The Reject/Accept/Flag row is intentionally
              removed for R2/R3. R1 uses isAnyDecisionMode (RoundDecisionButtons below) and R4 uses
              tags-only per SOW. Admin "Flag for review" remains available via the admin toolbar. */}
          {!isViewOnly && !isAnyDecisionMode && props.roundNumber !== 4 && isAdmin && (
          <div className="flex items-center gap-3">
            <button
              onClick={async () => {
                if (isLocked || !isAdmin) return;
                try {
                  const { data: { session } } = await supabase.auth.getSession();
                  if (!session) { toast({ title: "Not authenticated", variant: "destructive" }); return; }
                  const { error } = await supabase.rpc("admin_flag_entry_for_review" as any, { _entry_id: selectedEntry.id });
                  if (error) throw error;
                  toast({ title: "Flagged", description: "Entry marked for review" });
                  if (props.invalidateEntries) props.invalidateEntries();
                } catch (err: any) {
                  toast({ title: "Flag failed", description: err.message, variant: "destructive" });
                }
              }}
              disabled={isLocked}
              aria-label="Flag entry for review (admin)"
              className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 hover:text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed" style={{ fontFamily: "var(--font-heading)" }}>
              <AlertTriangle className="h-3.5 w-3.5" /> Flag
            </button>
          </div>
          )}
          {/* Spec v3: bottom-bar compact decision row. R1–R3 → decision buttons; R4 → tag chips. */}
          {!isViewOnly && props.roundNumber && props.roundNumber < 4 && (
            <RoundDecisionButtons
              availableTags={availableTags}
              roundNumber={props.roundNumber as 1 | 2 | 3}
              currentTagIds={selectedPhotoEvaluation?.tags ?? []}
              onTagClick={(tagId) =>
                toggleTag(selectedEntry.id, selectedPhoto.photoIndex, tagId, { skipAdvance: true })
              }
              disabled={isLocked || !!taggingEntry}
              compact
            />
          )}
          {/* Issue 4 fix: R4 tag chips removed from bottom bar — right-rail Quality Tags panel
              (line ~1111) is now the SINGLE surface for Winner/Runner-Up/Top-N/Honorary/Special Jury. */}
        </div>
      </div>

      {/* Unsaved changes dialog */}
      <UnsavedChangesDialog
        open={showUnsavedDialog}
        onDiscard={handleConfirmDiscard}
        onStay={handleCancelDiscard}
        onSaveAndLeave={props.onSaveAndLeave}
      />
    </motion.div>,
    document.body
  );
};

export default CinemaFullView;
