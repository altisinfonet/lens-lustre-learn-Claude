/**
 * JudgePanel — V4 Architecture: Cinema Mode Only
 * No Classic View. Always renders CinemaJudgeView.
 * Orchestrates: competitions, rounds, entries, photo data, actions, session.
 */
import { useEffect, useState, useMemo, useCallback, useRef, useTransition, lazy, Suspense } from "react";
import { useDebouncedFeedbackSave } from "@/hooks/judging/useDebouncedFeedbackSave";
import { useNavigate } from "react-router-dom";
import { Loader2, Zap, ChevronDown } from "lucide-react";

import { useAuth } from "@/hooks/core/useAuth";
import BrandLoader from "@/components/BrandLoader";
import { useUserRoles } from "@/hooks/profile/useUserRoles";
import { useIsMobile } from "@/hooks/core/use-mobile";
import { useJudgingLock } from "@/hooks/judging/useJudgingLock";
import { useJudgeAggregateStats } from "@/hooks/judging/useJudgeAggregateStats";
import { useJudgeCompetitions } from "@/hooks/judging/useJudgeCompetitions";
import { useJudgeRounds } from "@/hooks/judging/useJudgeRounds";
import { useJudgeClassicData, getRoundMode, saveResumePosition, loadResumePosition } from "@/hooks/judging/useJudgeClassicData";
import { useJudgeActions } from "@/hooks/judging/useJudgeActions";
import { useJudgeSession } from "@/hooks/judging/useJudgeSession";
import { useUpdateEntryPlacement, useAddVoteAdjustment } from "@/hooks/competition/useCompetitionEntryMutations";
import { useAdminEntryOverride } from "@/hooks/competition/useAdminEntryOverride";
import { exportJudgingCSV } from "@/lib/exportJudgingResults";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import { useSystemFlag } from "@/lib/useSystemFlag";
import { useUnjudgedDriftMonitor } from "@/hooks/judging/useUnjudgedDriftMonitor";
import { useMultiJudgeProgress } from "@/hooks/judging/useMultiJudgeProgress";
import SeatModeBar from "@/components/judge/SeatModeBar";
import { flagUnjudgedEntries, clearUnjudgedEntries, flagIncompletePhotos, clearIncompletePhotos, getFirstIncompletePhotoKey } from "@/lib/judging/saveErrorStore";

import type { RoundFilterCounts } from "@/components/judge/JudgeRoundSidebar";
import StartRoundDialog from "@/components/judge/StartRoundDialog";

/* Step 2 (SOW v2.1): defer Cinema/Mobile views — only the device-appropriate
   bundle is downloaded. The two are mutually exclusive (gated by useIsMobile),
   so this halves the eager judge bundle on every device. */
const CinemaJudgeView = lazy(() => import(/* webpackChunkName: "judge-cinema" */ "@/components/judge/CinemaJudgeView"));
const MobileJudgeView = lazy(() => import(/* webpackChunkName: "judge-mobile" */ "@/components/judge/MobileJudgeView"));
import NavigationBlocker from "@/components/judge/NavigationBlocker";
import ResumeSessionDialog from "@/components/judge/ResumeSessionDialog";

import type { CriteriaScores, FlatPhoto, SidebarView } from "@/hooks/judging/types";
import { SOW_ROUND4_CRITERIA_KEYS } from "@/hooks/judging/types";

const hasAllSowCriteria = (criteria?: CriteriaScores | null) =>
  !!criteria && SOW_ROUND4_CRITERIA_KEYS.every((key) => typeof criteria[key] === "number");

const JudgePanel = () => {
  const { user, loading: authLoading } = useAuth();
  const { hasRole, loading: rolesLoading } = useUserRoles();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const placementMutation = useUpdateEntryPlacement();
  const voteAdjustmentMutation = useAddVoteAdjustment();
  const adminOverrideMutation = useAdminEntryOverride();

  const isJudge = hasRole("judge") || hasRole("admin");
  const isAdmin = hasRole("admin");

  // ── MASTER-KEY seat mode ──
  // An admin can "sit in a judge's seat" and see + edit that judge's exact
  // panel; every write is stamped under the seat judge's name. Only admins can
  // seat; a non-admin can never set this. `seatJudgeId` is the seat judge's id.
  const [seatJudgeId, setSeatJudgeId] = useState<string | null>(null);
  const seatActive = isAdmin && !!seatJudgeId;
  // Identity that drives the "my" view and all write attribution.
  const effectiveJudgeId = seatActive ? seatJudgeId! : user?.id;

  useEffect(() => {
    if (!authLoading && !rolesLoading && !isJudge) navigate("/");
  }, [isJudge, authLoading, rolesLoading, navigate]);

  // F-05 route-guard: hydration/role gate. The actual early returns live
  // AFTER all hooks are declared (see below), because React requires every
  // hook to run on every render. Returning here caused React error #310
  // (hook-count mismatch between the loading render and the loaded render),
  // which blanked the whole Judge Panel.

  // ── Core state ──
  const [selectedCompId, setSelectedCompIdRaw] = useState<string | null>(null);
  const [selectedRound, setSelectedRoundRaw] = useState<string | null>(null);
  const [selectedPhotoKey, setSelectedPhotoKey] = useState<string | null>(null);
  const [sidebarView, setSidebarView] = useState<SidebarView>("round");
  const [expandedComp, setExpandedComp] = useState<string | null>(null);

  const setSelectedCompId = useCallback((id: string | null) => {
    setSelectedCompIdRaw(id);
    setSelectedRoundRaw(null);
    setSelectedPhotoKey(null);
    setSidebarView("round");
    setExpandedComp(id);
    // Only reset judgingStarted when switching competitions (session is per-competition)
    setJudgingStarted(false);
    setBulkMode(false);
    setBulkSelected(new Set());
    // MASTER-KEY: a seat belongs to one competition's judge — leaving the room
    // vacates the seat so an admin can never carry a seat into another room.
    setSeatJudgeId(null);
  }, []);

  const setSelectedRound = useCallback((id: string | null) => {
    setSelectedRoundRaw(id);
    setSelectedPhotoKey(null);
    // Don't reset judgingStarted on round change — session persists across rounds.
    // The sync effect (below) ensures judgingStarted stays true if session is active.
    setBulkMode(false);
    setBulkSelected(new Set());
  }, []);

  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [feedbackInput, setFeedbackInput] = useState("");
  const [commentInput, setCommentInput] = useState("");
  const [showStartDialog, setShowStartDialog] = useState(false);
  const [pendingStartRound, setPendingStartRound] = useState<string | null>(null);
  
  const [judgingStarted, setJudgingStarted] = useState(false);
  const [userViewOnly, setUserViewOnly] = useState(false);
  const [mobileTab, setMobileTab] = useState<"comps" | "photos" | "judge">("comps");
  const [showResumeDialog, setShowResumeDialog] = useState(false);
  const [resumeChecked, setResumeChecked] = useState(false);

  // ── Data hooks ──
  const { competitions, isLoading: compsLoading } = useJudgeCompetitions(user?.id, isAdmin, isJudge);
  const { tags: availableTags, rounds, activeRound, updateRound, invalidate: invalidateRounds } = useJudgeRounds(selectedCompId);

  // ── Session management ──
  const session = useJudgeSession(selectedCompId, user?.id);

  // ── Sync judgingStarted from active session — prevents re-prompting after grid return ──
  useEffect(() => {
    if (session.session && session.session.status === "active" && !judgingStarted && !userViewOnly) {
      setJudgingStarted(true);
    }
  }, [session.session?.id, session.session?.status]);

  // ── Phase 3: Crash recovery — check for resumable session on mount ──
  useEffect(() => {
    if (resumeChecked || !session.session || session.isLoading) return;
    setResumeChecked(true);
    if (session.hasResumeData && session.session.last_entry_id) {
      setShowResumeDialog(true);
      if (session.session.competition_id && !selectedCompId) {
        setSelectedCompIdRaw(session.session.competition_id);
        setExpandedComp(session.session.competition_id);
      }
    }
  }, [session.session, session.isLoading, session.hasResumeData, resumeChecked, selectedCompId]);

  const handleResumeFromBookmark = useCallback(() => {
    setShowResumeDialog(false);
    if (!session.session) return;
    if (session.session.round_id) setSelectedRoundRaw(session.session.round_id);
    setJudgingStarted(true);
    session.resumeSession();
    if (session.session.last_entry_id) {
      const pi = session.session.last_photo_index ?? 0;
      setSelectedPhotoKey(`${session.session.last_entry_id}::${pi}`);
    }
  }, [session]);

  const handleStartFresh = useCallback(() => {
    setShowResumeDialog(false);
    // Session is still active in DB — mark judging as started so photos open directly
    if (session.session && session.session.status === "active") {
      setJudgingStarted(true);
    }
  }, [session.session]);

  const handleSaveAndLeave = useCallback(async () => {
    if (session.session && selectedPhotoKey) {
      const [eid, piStr] = selectedPhotoKey.split("::");
      const pi = Number.parseInt(piStr ?? "0", 10) || 0;
      await session.bookmark(eid, 0, pi);
    }
    await session.pauseSession();
  }, [session, selectedPhotoKey]);

  const selectedComp = useMemo(() => competitions.find(c => c.id === selectedCompId) || null, [competitions, selectedCompId]);
  const phaseViewOnly = useMemo(() => {
    if (!selectedComp) return false;
    if (selectedComp.phase === "judging" || selectedComp.phase === "result") return false;
    const votingEnd = selectedComp.voting_ends_at || selectedComp.ends_at;
    if (votingEnd && new Date(votingEnd) < new Date()) return false;
    return true;
  }, [selectedComp]);
  const isViewOnly = phaseViewOnly || userViewOnly;

  useEffect(() => {
    if (activeRound && !selectedRound) setSelectedRound(activeRound.id);
  }, [activeRound, selectedRound]);

  const currentRound = useMemo(() => rounds.find((r) => r.id === selectedRound) || null, [rounds, selectedRound]);
  const roundMode = getRoundMode(currentRound);

  // ── Feature flags ──
  const strictLockFlag = useSystemFlag("enforce_strict_round_lock");
  const sowRoundLogic = useSystemFlag("enable_sow_round_logic");
  const sowScoringRounds = useSystemFlag("enable_sow_scoring_rounds");
  const isRoundLocked = currentRound?.status === "completed";
  const isEffectivelyLocked = isRoundLocked && (!isAdmin || strictLockFlag);
  const roundNumber = currentRound?.round_number ?? undefined;

  const data = useJudgeClassicData({
    // MASTER-KEY: in seat mode this is the seat judge, so all "my" buckets,
    // scores, tags and decisions render as that judge sees them.
    userId: effectiveJudgeId,
    isAdmin,
    seatJudgeId: seatActive ? seatJudgeId! : undefined,
    selectedCompId,
    selectedRound,
    currentRound,
  });

  // MASTER-KEY: full judge roster for the seat picker (admin only). Shares the
  // React Query cache key with CinemaJudgeView's "Other Judges" widget, so this
  // adds no extra network cost.
  const { judges: seatRoster } = useMultiJudgeProgress(selectedCompId, user?.id);

  const {
    entries, setEntries, allPhotos, getPhotoKey, getPhotoEvaluation,
    loadingEntries, loadingMore, hasMoreEntries, handleLoadMore,
    photoScoresMap, photoTagsMap, photoCommentsMap, photoDecisionsMap,
    updateScoreOptimistic, updateTagOptimistic, addCommentOptimistic,
    clearOptimistic, updateDecisionOptimistic, getMyDecisionCounts,
    invalidatePhotoData, lockMutation, unlockMutation,
    updateEntryLocally, loadEntriesPage,
  } = data;

  const tagLabelById = useMemo(() => {
    const map = new Map<string, string>();
    availableTags.forEach((tag) => map.set(tag.id, (tag.label || "").trim().toLowerCase()));
    return map;
  }, [availableTags]);

  // ── Filtered photos (per-judge decisions for R1) ──
  const decisionCounts = useMemo(() => {
    if (!entries) return { accept: 0, shortlist: 0, needs_review: 0, reject: 0, qualified: 0, finalist: 0, winner: 0, unjudged: 0, total: 0 };
    return getMyDecisionCounts(entries, roundNumber);
  }, [entries, getMyDecisionCounts, roundNumber]);

  const filteredPhotos = useMemo(() => {
    // Helper: get per-judge decision for a photo's entry
    const getDecision = (p: FlatPhoto) => photoDecisionsMap[`${p.entryId}::${p.photoIndex}`]?.myDecision ?? null;
    const getTagLabels = (p: FlatPhoto) => (photoTagsMap[getPhotoKey(p)]?.myTags ?? []).map((tagId) => tagLabelById.get(tagId) ?? "");
    const hasLabel = (p: FlatPhoto, labels: string[]) => {
      const wanted = new Set(labels.map((label) => label.toLowerCase()));
      return getTagLabels(p).some((label) => wanted.has(label));
    };
    const hasR2QualifiedTag = (p: FlatPhoto) => hasLabel(p, ["shortlist for round 3", "qualified for round 3", "qualified for r3", "qualified for 3rd round"]);
    // Master Key v2 §5: hasR2NotSelectedTag / hasR3NotSelectedTag removed —
    // 'Not Selected' is a derived display label (avg<7), not a queryable tag.
    const hasR3FinalTag = (p: FlatPhoto) => hasLabel(p, ["shortlist for final round", "shortlist for final", "shortlisted for final", "qualified for final", "qualified for final round"]);
    const hasCompleteSowScore = (p: FlatPhoto) => {
      const key = getPhotoKey(p);
      const scoreData = photoScoresMap[key];
      return scoreData?.myScore != null && hasAllSowCriteria(scoreData.myCriteria);
    };
    const hasScoreOrTag = (p: FlatPhoto) => {
      if (roundNumber != null && roundNumber >= 2) return hasCompleteSowScore(p);
      const key = getPhotoKey(p);
      return (photoScoresMap[key]?.myScore != null) || ((photoTagsMap[key]?.myTags?.length ?? 0) > 0);
    };
    /**
     * R-071 — Score-tier classification (SOW R2/R3/R4).
     *   score 1-6        → "Qualified-current" (qualified)
     *   score 7-10       → "Shortlisted-next" (shortlisted) / R4 "Award-eligible"
     * Spec V3: 'Needs Review' is R1-only — there is NO score=0 → needs_review
     * mapping in R2/R3/R4. score===0 falls through to the qualified bucket
     * (treated as 1-6). Used as a fallback when the judge has scored a photo
     * but not yet written an explicit decision.
     */
    const tierFromScore = (p: FlatPhoto): "qualified" | "shortlisted" | null => {
      const s = photoScoresMap[getPhotoKey(p)]?.myScore;
      if (s == null) return null;
      if (s >= 0 && s <= 6) return "qualified";
      if (s >= 7 && s <= 10) return "shortlisted";
      return null;
    };

    switch (sidebarView) {
      // R1 decision-based filters — use per-judge decisions, NOT global entry.status
      case "rejected": return allPhotos.filter((p) => {
        // Master Key v2 §5: 'rejected' is an R1-only bucket. R2/R3 'Not Selected'
        // is a derived display label (avg<7), NOT a stored bucket — return [].
        if (roundNumber === 2 || roundNumber === 3) return false;
        const d = getDecision(p);
        return d === "reject" || d === "rejected";
      });
      case "accepted": return allPhotos.filter((p) => { const d = getDecision(p); return d === "accept" || d === "accepted"; });
      // Ruleset v4 (2026-04-29) — 'Stay' bucket removed; legacy filter is a no-op.
      case "stayed": return [];
      case "shortlisted": return allPhotos.filter((p) => {
        const d = getDecision(p);
        if (d === "shortlist" || d === "shortlisted" || d === "qualified_r3" || d === "qualified_final" || d === "shortlisted_final") return true;
        if (roundNumber === 2 && hasR2QualifiedTag(p)) return true;
        if (roundNumber === 3 && hasR3FinalTag(p)) return true;
        // R-071: score-tier fallback for R2/R3/R4 (7-10 → shortlisted/award-eligible)
        return roundNumber != null && roundNumber >= 2 && d == null && tierFromScore(p) === "shortlisted";
      });
      case "needs_review": return allPhotos.filter((p) => {
        // Spec V3: 'Needs Review' is R1-only. R2/R3/R4 never bucket photos here.
        if (roundNumber !== 1) return false;
        return getDecision(p) === "needs_review";
      });
      case "qualified": return allPhotos.filter((p) => {
        const d = getDecision(p);
        if (d === "qualified") return true;
        // R-071: score-tier fallback (score 1-6 → qualified) — R2/R3 only
        return roundNumber != null && roundNumber >= 2 && roundNumber <= 3 && d == null && tierFromScore(p) === "qualified";
      });
      case "finalist": return allPhotos.filter((p) => getDecision(p) === "finalist");
      case "winner": return allPhotos.filter((p) => getDecision(p) === "winner");
      // Placement-based filters remain global (set by admin)
      case "runner_up_1": return allPhotos.filter((p) => p.entry.placement === "runner_up_1" || p.entry.placement === "1st_runner_up");
      case "runner_up_2": return allPhotos.filter((p) => p.entry.placement === "runner_up_2" || p.entry.placement === "2nd_runner_up");
      case "honorary_mention": return allPhotos.filter((p) => p.entry.placement === "honorary_mention" || p.entry.placement === "honourable_mention");
      case "special_jury": return allPhotos.filter((p) => p.entry.placement === "special_jury");
      case "completed": return allPhotos.filter((p) => {
        const d = getDecision(p);
        // R1/R2 are decision-only rounds; R3/R4 accept either decision or score/tag
        if (roundNumber && roundNumber <= 2) return d != null;
        return d != null || hasScoreOrTag(p);
      });
      case "unjudged": return allPhotos.filter((p) => {
        const d = getDecision(p);
        // Judging v5: admin-defined judging TAGS act as decisions in every round
        // (R1: Rejected/Accepted/Qualified; R2+: scoring tiers + tags). A photo
        // is "judged" the moment it has either a decision OR a tag OR a score.
        if (roundNumber != null && roundNumber >= 2) return !hasCompleteSowScore(p);
        return d == null && !hasScoreOrTag(p);
      });
      default: {
        if (typeof sidebarView === "string" && sidebarView.startsWith("shortlisted_tag_")) {
          const tagId = sidebarView.replace("shortlisted_tag_", "");
          return allPhotos.filter((p) => (photoTagsMap[getPhotoKey(p)]?.myTags ?? []).includes(tagId));
        }
        return allPhotos;
      }
    }
  }, [allPhotos, sidebarView, getPhotoKey, photoScoresMap, photoTagsMap, photoDecisionsMap, tagLabelById, roundNumber]);

  // ── Selected photo ──
  const selectedPhoto = useMemo(() => {
    if (!selectedPhotoKey) return null;
    return filteredPhotos.find((p) => getPhotoKey(p) === selectedPhotoKey)
      || allPhotos.find((p) => getPhotoKey(p) === selectedPhotoKey)
      || null;
  }, [allPhotos, filteredPhotos, getPhotoKey, selectedPhotoKey]);
  const selectedEntry = selectedPhoto?.entry || null;
  const selectedPhotoEvaluation = selectedPhoto ? getPhotoEvaluation(selectedPhoto) : null;

  // J-03 dev safety net — warn if sidebar Unjudged ≠ grid count.
  useUnjudgedDriftMonitor({
    enabled: !!entries && !loadingEntries,
    sidebarView,
    unjudgedCount: decisionCounts.unjudged,
    filteredCount: filteredPhotos.length,
  });

  const activePhotoList = useMemo(() => {
    if (!selectedPhotoKey) return filteredPhotos;
    return filteredPhotos.some((p) => getPhotoKey(p) === selectedPhotoKey) ? filteredPhotos : allPhotos;
  }, [allPhotos, filteredPhotos, getPhotoKey, selectedPhotoKey]);

  const activePhotoIdx = selectedPhotoKey ? activePhotoList.findIndex((p) => getPhotoKey(p) === selectedPhotoKey) : -1;

  // ── Feedback auto-save ──
  const [feedbackSavedSignal, setFeedbackSavedSignal] = useState(0);
  useDebouncedFeedbackSave(
    user?.id,
    selectedPhoto?.entryId ?? null,
    selectedPhoto?.photoIndex ?? null,
    roundNumber,
    feedbackInput,
    !!selectedPhoto && !isRoundLocked,
    500,
    () => setFeedbackSavedSignal((s) => s + 1),
    seatActive ? seatJudgeId! : undefined,
  );

  // ── Lock ──
  const { lockedByOther } = useJudgingLock(user?.id, selectedPhoto?.entryId || null, selectedPhoto?.photoIndex ?? null);

  // ── Navigation ──
  // NOTE: bookmark is intentional-only — navigation no longer auto-updates last_entry_id.
  // Use header "Bookmark" button, hover icon (desktop), or long-press (mobile) to set/unset.
  const goNext = useCallback(() => {
    if (activePhotoIdx < activePhotoList.length - 1) {
      const next = activePhotoList[activePhotoIdx + 1];
      const key = getPhotoKey(next);
      setSelectedPhotoKey(key);
      if (selectedCompId && selectedRound) saveResumePosition(selectedCompId, selectedRound, key);
    }
  }, [activePhotoIdx, activePhotoList, getPhotoKey, selectedCompId, selectedRound]);

  const goPrev = useCallback(() => {
    if (activePhotoIdx > 0) {
      const prev = activePhotoList[activePhotoIdx - 1];
      const key = getPhotoKey(prev);
      setSelectedPhotoKey(key);
      if (selectedCompId && selectedRound) saveResumePosition(selectedCompId, selectedRound, key);
    }
  }, [activePhotoIdx, activePhotoList, getPhotoKey, selectedCompId, selectedRound]);

  // Toggle: header button → bookmark / unbookmark current photo (per-photo, not per-entry).
  const handleManualBookmark = useCallback(() => {
    if (selectedPhoto) {
      session.toggleBookmark(selectedPhoto.entryId, activePhotoIdx, selectedPhoto.photoIndex ?? 0);
    }
  }, [selectedPhoto, activePhotoIdx, session]);

  // Toggle from a thumbnail (hover icon / long-press) without opening Cinema view.
  const handleToggleBookmarkForEntry = useCallback((entryId: string, photoIndex: number = 0) => {
    session.toggleBookmark(entryId, photoIndex, photoIndex);
  }, [session]);

  // ── Actions ──
  const actions = useJudgeActions({
    userId: user?.id,
    seatJudgeId: seatActive ? seatJudgeId! : undefined,
    isAdmin,
    isRoundLocked: isEffectivelyLocked,
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
    getMyTags: (key) => photoTagsMap[key]?.myTags || [],
    getAllTags: (key) => photoTagsMap[key]?.allTags || [],
    goNext,
  });

  useEffect(() => { actions.setFeedbackRef(feedbackInput); }, [feedbackInput, actions.setFeedbackRef]);

  // Reset feedback on photo change
  const prevPhotoKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = selectedPhoto ? getPhotoKey(selectedPhoto) : null;
    if (key !== prevPhotoKeyRef.current) {
      setFeedbackInput("");
      setCommentInput("");
      prevPhotoKeyRef.current = key;
      if (selectedPhotoEvaluation?.feedback) setFeedbackInput(selectedPhotoEvaluation.feedback);
    }
  }, [selectedPhoto, getPhotoKey, selectedPhotoEvaluation?.feedback]);

  useEffect(() => {
    setSidebarView("round");
  }, [selectedRound]);

  // ── Stats ──
  const stats = useMemo(() => {
    const markedSet = new Set<string>();
    let rejected = 0, accepted = 0, shortlisted = 0, needsReview = 0;
    for (const photo of allPhotos) {
      const key = getPhotoKey(photo);
      const scoreData = photoScoresMap[key];
      const hasCompleteSowScore = scoreData?.myScore != null && hasAllSowCriteria(scoreData.myCriteria);
      // Count per-judge decisions from photoDecisionsMap (R1 screening + later rounds)
      const myDecision = photoDecisionsMap[`${photo.entryId}::${photo.photoIndex}`]?.myDecision;
      if (myDecision) {
        if (myDecision === "reject" || myDecision === "rejected") rejected++;
        if (myDecision === "accept" || myDecision === "accepted") accepted++;
        if (myDecision === "shortlist" || myDecision === "shortlisted") shortlisted++;
        // Spec V3: 'Needs Review' is R1-only. Ignore stray NR rows in R2/R3/R4.
        if (myDecision === "needs_review" && roundNumber === 1) needsReview++;
        if (roundNumber == null || roundNumber < 2 || hasCompleteSowScore) markedSet.add(key);
      }
      // R2/R3/R4 are mandatory 10-SOW scoring rounds: a tag/award alone is
      // not reviewed until the current judge has all criteria filled.
      if (roundNumber != null && roundNumber >= 2 ? hasCompleteSowScore : (hasCompleteSowScore || ((photoTagsMap[key]?.myTags?.length ?? 0) > 0))) {
        markedSet.add(key);
      }
    }
    return { totalEntries: allPhotos.length, markedEntries: markedSet.size, rejected, accepted, shortlisted, needsReview };
  }, [allPhotos, getPhotoKey, photoScoresMap, photoTagsMap, photoDecisionsMap, roundNumber]);

  const isR2QualifiedTag = useCallback((tagId: string) => {
    const label = tagLabelById.get(tagId) ?? "";
    return ["shortlist for round 3", "qualified for round 3", "qualified for r3", "qualified for 3rd round"].includes(label);
  }, [tagLabelById]);

  // Master Key v2 §5: isR2NotSelectedTag / isR3NotSelectedTag removed —
  // 'Not Selected' is a derived display label (avg<7), not a queryable tag.

  const isR3FinalTag = useCallback((tagId: string) => {
    const label = tagLabelById.get(tagId) ?? "";
    return ["shortlist for final round", "shortlist for final", "shortlisted for final", "qualified for final", "qualified for final round"].includes(label);
  }, [tagLabelById]);

  // R3 "Accept for Round 3" tag — Phase 1 fix for "Accepted in Round 3" sidebar
  // bucket showing 0 even when photos carry the Accept tag. judge_decisions has
  // no R3 rows for accept-tagged photos (no DB trigger yet — see Phase 2), so
  // we mirror the R3 Final-shortlist tag-detection pattern for the Accept tag.
  const isR3AcceptedTag = useCallback((tagId: string) => {
    const label = tagLabelById.get(tagId) ?? "";
    return ["accept for round 3", "accepted in round 3", "accepted for round 3", "accept"].includes(label);
  }, [tagLabelById]);

  const roundFilterCounts = useMemo<RoundFilterCounts>(() => {
    let accepted = 0, shortlisted = 0, needsReview = 0, rejected = 0;
    let qualified = 0, finalist = 0, winner = 0;
    let runner_up_1 = 0, runner_up_2 = 0, honorary_mention = 0, special_jury = 0;
    let unjudged = 0;
    for (const photo of allPhotos) {
      const key = getPhotoKey(photo);
      const myDecision = photoDecisionsMap[`${photo.entryId}::${photo.photoIndex}`]?.myDecision;
      const scoreData = photoScoresMap[key];
      const myScore = scoreData?.myScore;
      const hasScore = myScore != null && hasAllSowCriteria(scoreData?.myCriteria);
      const myTagIds = photoTagsMap[key]?.myTags ?? [];
      const hasTag = myTagIds.length > 0;
      const p = photo.entry.placement;
      const hasTaggedR2Qualified = roundNumber === 2 && myTagIds.some(isR2QualifiedTag);
      const hasTaggedR3Final = roundNumber === 3 && myTagIds.some(isR3FinalTag);
      const hasTaggedR3Accepted = roundNumber === 3 && myTagIds.some(isR3AcceptedTag);

      if (roundNumber != null && roundNumber >= 2 && !hasScore) {
        unjudged++;
        continue;
      }

      // Per-judge decision counts (from judge_decisions table, NOT global entry.status)
      // DB stores: accept, reject, shortlist, needs_review, qualified, finalist, winner
      // Master Key v2 §5: 'Not Selected' for R2/R3 is a derived label (avg<7),
      // not a stored bucket — no rejected branch for R2/R3 here.
      if (hasTaggedR2Qualified || hasTaggedR3Final) {
        shortlisted++;
      } else if (hasTaggedR3Accepted) {
        // Phase 1 fix: R3 "Accept for Round 3" tag → accepted bucket.
        accepted++;
      } else if (myDecision) {
        switch (myDecision) {
          case "accept": case "accepted": accepted++; break;
          case "shortlist": case "shortlisted": case "qualified_r3": case "qualified_final": case "shortlisted_final": shortlisted++; break;
          // Spec V3: 'Needs Review' is R1-only. Ignore stray NR rows in R2/R3/R4.
          case "needs_review": if (roundNumber === 1) needsReview++; break;
          // Master Key v2 §5: not_selected_r3 / not_selected_final are RETIRED
          // derived labels, never stored — only R1 'reject' counts here.
          case "reject": case "rejected": if (roundNumber === 1) rejected++; break;
          case "qualified": qualified++; break;
          case "finalist": finalist++; break;
          case "winner": winner++; break;
          default: break;
        }
      } else if (hasScore && roundNumber != null && roundNumber >= 2) {
        // R-071: score-tier fallback for R2/R3/R4 when no explicit decision exists.
        // Spec V3: NO score=0 → Needs Review mapping in R2+. Score 0 falls into
        // the qualified bucket (treated as 0-6).
        //   0-6 → Qualified-current · 7-10 → Shortlisted-next/Award-eligible
        if (myScore >= 0 && myScore <= 6) qualified++;
        else if (myScore >= 7 && myScore <= 10) shortlisted++;
      } else if (roundNumber != null && roundNumber >= 2 ? !hasScore : (!hasScore && !hasTag)) {
        // Judging v5: a photo with an admin tag is "judged" — only count
        // photos with NO decision, NO score, AND NO tag as truly unjudged.
        unjudged++;
      }

      // Placement counts remain global (set by admin, not per-judge)
      if (p === "runner_up_1" || p === "1st_runner_up") runner_up_1++;
      if (p === "runner_up_2" || p === "2nd_runner_up") runner_up_2++;
      if (p === "honorary_mention" || p === "honourable_mention") honorary_mention++;
      if (p === "special_jury") special_jury++;
    }
    return { accepted, shortlisted, needsReview, rejected, qualified, finalist, winner, runner_up_1, runner_up_2, honorary_mention, special_jury, unjudged, total: allPhotos.length };
  }, [allPhotos, getPhotoKey, photoDecisionsMap, photoScoresMap, photoTagsMap, roundNumber, isR2QualifiedTag, isR3FinalTag, isR3AcceptedTag]);

  const completedRoundsCount = rounds.filter((r) => r.status === "completed").length;

  // ── Aggregate stats ──
  const competitionIds = useMemo(() => competitions.map((c) => c.id), [competitions]);
  const { data: aggregateStats } = useJudgeAggregateStats(effectiveJudgeId, competitionIds);

  // ── Round management ──
  const handleCompleteRound = async (roundId: string) => {
    const completedRound = rounds.find((r) => r.id === roundId);
    if (!completedRound || !selectedCompId) return;
    toast({ title: `Completing ${completedRound.name}...` });

    try {
      // BUG-002 FIX: Use raw fetch to read full response body including 409 error details
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const session = (await supabase.auth.getSession()).data.session;
      if (!session?.access_token) {
        toast({ title: "Session expired", description: "Please log in again.", variant: "destructive" });
        return;
      }
      const res = await fetch(`${supabaseUrl}/functions/v1/complete-round`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
          "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ competition_id: selectedCompId, round_number: completedRound.round_number }),
      });

      let result: any;
      try { result = await res.json(); } catch { result = null; }

      if (!res.ok || result?.error) {
        const errMsg = result?.error || `Server returned ${res.status}`;
        const details: string[] = [];
        if (result?.unjudged_count) details.push(`${result.unjudged_count} unjudged entries`);
        if (result?.needs_review_count) details.push(`${result.needs_review_count} entries need review`);
        if (result?.missing_judges) details.push(`${result.missing_judges} judge(s) still missing decisions`);
        if (result?.missing_decisions) details.push(`${result.missing_decisions} missing photo decisions`);
        if (result?.unjudged_ids) details.push(`IDs: ${result.unjudged_ids.slice(0, 5).join(", ")}...`);
        if (result?.needs_review_ids) details.push(`Review IDs: ${result.needs_review_ids.slice(0, 5).join(", ")}...`);
        // Fix C: Prefer human-readable enriched sample. Show entry title + photo name
        // + missing criteria labels instead of UUIDs / photo_index numbers.
        if (Array.isArray(result?.sample) && result.sample.length > 0) {
          const enriched = result.sample.filter((row: any) => row?.entry_title || row?.photo_label);
          if (enriched.length > 0) {
            const preview = enriched
              .slice(0, 3)
              .map((row: any) => {
                const title = row.entry_title || "(untitled)";
                const photo = row.photo_label || `Photo ${row.photo_index + 1}`;
                const missing = Array.isArray(row.missing_criteria_labels) && row.missing_criteria_labels.length > 0
                  ? ` — missing ${row.missing_criteria_labels.slice(0, 3).join(", ")}${row.missing_criteria_labels.length > 3 ? "…" : ""}`
                  : "";
                return `“${title}” · ${photo}${missing}`;
              })
              .join("; ");
            details.push(`Fix: ${preview}`);
          } else {
            const sample = result.sample
              .slice(0, 3)
              .map((row: any) => `judge ${String(row.judge_id).slice(0, 8)} / photo ${row.photo_index + 1}`)
              .join("; ");
            details.push(`Example: ${sample}`);
          }
        }
        // BUG-2 highlight: push flagged entry IDs to the grid so PhotoCells
        // paint an amber pulsing ring + reason badge. Clears on next success.
        clearUnjudgedEntries();
        clearIncompletePhotos();
        if (Array.isArray(result?.unjudged_ids) && result.unjudged_ids.length > 0) {
          flagUnjudgedEntries(
            result.unjudged_ids,
            "missing_scores",
            errMsg || "Missing 15-criteria score",
          );
        }
        if (Array.isArray(result?.needs_review_ids) && result.needs_review_ids.length > 0) {
          flagUnjudgedEntries(
            result.needs_review_ids,
            "needs_review_unresolved",
            "Needs review — resolve before closing round",
          );
        }
        // Fix C: per-photo highlight from enriched sample (scores_incomplete case).
        if (result?.code === "scores_incomplete" && Array.isArray(result?.sample) && result.sample.length > 0) {
          flagIncompletePhotos(result.sample);
          // Auto-scroll to first offender so a novice judge sees exactly which card to open.
          setTimeout(() => {
            const first = getFirstIncompletePhotoKey();
            if (!first) return;
            const el = document.querySelector(`[data-photo-key$="::${first.photoIndex}"][data-photo-key^="${first.entryId}"]`) as HTMLElement | null;
            if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
          }, 150);
        }
        // Fallback: still flag the entries (whole-card amber ring) so cards are locatable
        // even when photo-level sample is empty.
        if (Array.isArray(result?.sample) && result.sample.length > 0) {
          const decisionIds = Array.from(
            new Set(
              result.sample
                .map((row: any) => row?.entry_id)
                .filter((v: any): v is string => typeof v === "string" && v.length > 0),
            ),
          ) as string[];
          if (decisionIds.length > 0) {
            const reason = result?.code === "scores_incomplete" ? "missing_scores" : "missing_decisions";
            const message = result?.code === "scores_incomplete"
              ? "Fill all 15 criteria on the highlighted photos"
              : "Missing photo decision";
            flagUnjudgedEntries(decisionIds, reason as any, message);
          }
        }
        toast({
          title: "Round completion failed",
          description: result?.summary ? `${result.summary}. ${details.slice(-1)[0] ?? ""}` : (details.length > 0 ? `${errMsg} — ${details.join("; ")}` : errMsg),
          variant: "destructive",
        });
        return;
      }

      // BUG-056: an already-processed no-op is a WARNING, not a fresh success —
      // no writes happened, so don't mark the round completed as if this call
      // did the work. Surface it clearly and refresh state from the server.
      if (result?.already_processed || result?.warning) {
        toast({
          title: "No action taken",
          description: result?.message ?? "This round was already completed earlier — nothing was changed by this request.",
        });
        return;
      }

      // Success — clear any prior highlights.
      clearUnjudgedEntries();
      clearIncompletePhotos();

      updateRound(roundId, { status: "completed" });
      if (result?.next_round_activated && result?.next_round_id) {
        const nextRound = rounds.find((r: any) => r.id === result.next_round_id);
        if (nextRound) {
          updateRound(nextRound.id, { status: "active" });
          setSelectedRound(nextRound.id);
          loadEntriesPage(selectedCompId, 0, false, nextRound.round_number);
          toast({ title: `${nextRound.name} is now LIVE` });
        } else {
          invalidateRounds();
          toast({ title: `Round ${result.next_round_number} activated` });
        }
      } else {
        invalidateRounds();
      }
    } catch (networkErr: any) {
      toast({
        title: "Network error",
        description: `Could not reach server: ${networkErr.message || "Connection failed"}`,
        variant: "destructive",
      });
    }
  };

  const handleActivateRound = async (roundId: string) => {
    const targetRound = rounds.find((r) => r.id === roundId);
    if (!targetRound || !selectedCompId) return;
    toast({ title: `Activating ${targetRound.name}...` });
    const { error } = await supabase.functions.invoke("complete-round", {
      body: { competition_id: selectedCompId, round_number: targetRound.round_number, action: "activate" },
    });
    if (error) { toast({ title: "Activation failed", variant: "destructive" }); return; }
    const currentActive = rounds.find((r) => r.status === "active");
    if (currentActive) updateRound(currentActive.id, { status: "pending" });
    updateRound(roundId, { status: "active" });
    setSelectedRound(roundId);
    toast({ title: `${targetRound.name} is now LIVE` });
  };

  // ── Placement ──
  const prevStatusBeforePlacement = useRef<Record<string, string>>({});
  const handlePlacement = async (entryId: string, placement: string | null) => {
    if (isRoundLocked) { toast({ title: "Round completed", variant: "destructive" }); return; }
    const currentEntry = entries.find((e) => e.id === entryId);
    if (!currentEntry) return;
    const newPlacement = currentEntry.placement === placement ? null : placement;
    let newStatus: string;
    if (newPlacement) {
      if (!prevStatusBeforePlacement.current[entryId]) prevStatusBeforePlacement.current[entryId] = currentEntry.status;
      newStatus = newPlacement === "winner" ? "winner" : currentEntry.status;
    } else {
      // BUG-085: removing a placement must NOT silently demote to 'approved'
      // (the in-memory prev-status ref is empty after a reload). Only a 'winner'
      // placement ever changed the status; for any other placement the status is
      // untouched, so keep it. When clearing 'winner', restore the remembered
      // prior status, else fall back to 'finalist' (a winner is at least a
      // finalist) — never 'approved'.
      const restored = prevStatusBeforePlacement.current[entryId];
      if (currentEntry.status === "winner") {
        newStatus = restored && restored !== "winner" ? restored : "finalist";
      } else {
        newStatus = currentEntry.status;
      }
      delete prevStatusBeforePlacement.current[entryId];
    }
    try {
      await placementMutation.mutateAsync({ entryId, placement: newPlacement, status: newStatus });
      updateEntryLocally(entryId, { placement: newPlacement, status: newStatus });
      toast({ title: newPlacement ? `Marked as ${newPlacement.replace(/_/g, " ")}` : "Placement removed" });
    } catch { /* handled */ }
  };

  // ── Admin Override ──
  const handleAdminOverride = async (entryId: string, status: string) => {
    if (!selectedEntry) return;
    await adminOverrideMutation.mutateAsync({
      entryId, competitionId: selectedEntry.competition_id,
      status, placement: status === "winner" ? "winner" : null, reason: "Admin manual status override",
    });
    updateEntryLocally(entryId, { status, placement: status === "winner" ? "winner" : null });
  };

  // ── Vote adjustment ──
  const handleAddManualVotes = async (entryId: string, count: number) => {
    if (!user || !selectedCompId || isNaN(count) || count < 1) return;
    await voteAdjustmentMutation.mutateAsync({ entryId, competitionId: selectedCompId, adjustmentValue: count, reason: `Admin boost (+${count})`, adminId: user.id });
    const currentEntry = entries.find((e) => e.id === entryId);
    updateEntryLocally(entryId, { vote_count: (currentEntry?.vote_count ?? 0) + count });
    toast({ title: `+${count} votes adjusted ✓` });
  };

  // ── Bulk ops ──
  // Step 11: useTransition keeps the input thread responsive (<100ms) while
  // 50+ item bulk mutations and their downstream re-renders run at low
  // priority. Selection/UI state is reset inside startTransition; the awaited
  // mutations themselves run normally — React only deprioritizes the renders
  // they trigger.
  const [, startBulkTransition] = useTransition();

  // ── Route guard (moved here so every hook above always runs) ──
  // Non-judges are redirected by the useEffect near the top; these returns
  // just render a loader/blank until that happens. Must stay BELOW all hooks.
  if (authLoading || rolesLoading) return <BrandLoader fullScreen />;
  if (!isJudge) return null;

  const toggleBulkSelect = (photoKey: string) => setBulkSelected((prev) => { const n = new Set(prev); n.has(photoKey) ? n.delete(photoKey) : n.add(photoKey); return n; });
  const processBatched = async <T,>(items: T[], fn: (item: T) => Promise<void>, batchSize = 10) => {
    for (let i = 0; i < items.length; i += batchSize) { await Promise.all(items.slice(i, i + batchSize).map(fn)); }
  };
  const handleBulkScore = async (score: number) => {
    if (isRoundLocked) { toast({ title: "Round completed", variant: "destructive" }); return; }
    const keys = Array.from(bulkSelected);
    const photos = keys.map((k) => allPhotos.find((p) => getPhotoKey(p) === k)).filter(Boolean) as FlatPhoto[];
    await processBatched(photos, (p) => actions.handleQuickScore(p.entryId, p.photoIndex, score, { silent: true, skipAdvance: true }));
    startBulkTransition(() => {
      setBulkSelected(new Set()); setBulkMode(false);
    });
    toast({ title: `Bulk rated ${photos.length} images ✓` });
  };
  const handleBulkTag = async (tagId: string) => {
    if (isRoundLocked) { toast({ title: "Round completed", variant: "destructive" }); return; }
    const keys = Array.from(bulkSelected);
    const photos = keys.map((k) => allPhotos.find((p) => getPhotoKey(p) === k)).filter(Boolean) as FlatPhoto[];
    await processBatched(photos, (p) => actions.toggleTag(p.entryId, p.photoIndex, tagId, { silent: true, skipAdvance: true }));
    startBulkTransition(() => {
      setBulkSelected(new Set()); setBulkMode(false);
    });
    toast({ title: `Bulk tagged ${photos.length} images ✓` });
  };

  // ── Export ──
  const handleExportCSV = () => {
    const comp = competitions.find((c) => c.id === selectedCompId);
    if (!comp) return;
    const exportEntries = allPhotos.map((photo) => {
      const key = getPhotoKey(photo);
      const scoreData = photoScoresMap[key];
      const tagData = photoTagsMap[key];
      const allScores = scoreData?.allScores ?? [];
      // PER-PHOTO RULE: each row is a photo; status is THIS photo's judge decision,
      // not the entry-level aggregate. Placement remains entry-level (admin-set).
      const myDecision = photoDecisionsMap[key]?.myDecision ?? null;
      return {
        title: `${photo.entry.title} (Image ${photo.photoIndex + 1})`,
        photographer_name: photo.entry.photographer_name,
        status: myDecision || "pending",
        my_score: scoreData?.myScore ?? null,
        avg_score: allScores.length > 0 ? allScores.reduce((s, a) => s + a.score, 0) / allScores.length : null,
        vote_count: photo.entry.vote_count,
        placement: photo.entry.placement,
        tags: (tagData?.myTags ?? []).map((tid) => availableTags.find((t) => t.id === tid)?.label || tid),
      };
    });
    exportJudgingCSV(exportEntries, currentRound, comp.title);
  };

  // ── Start judging — with session creation + round activation ──
  const handleStartJudging = (roundId: string) => {
    // If session is already active, skip the confirmation dialog
    if (judgingStarted && session.session?.status === "active") {
      setSelectedRound(roundId);
      session.updateSessionRound(roundId);
      setJudgingStarted(true);
      return;
    }

    const comp = competitions.find(c => c.id === selectedCompId);
    if (comp && comp.phase !== "judging" && comp.phase !== "result") {
      const votingEnd = comp.voting_ends_at || comp.ends_at;
      const votingExpired = votingEnd && new Date(votingEnd) < new Date();
      if (!votingExpired) {
        if (comp.phase === "voting") toast({ title: "Voting still in progress", description: "Judging available after voting ends.", variant: "destructive" });
        else if (comp.phase === "submission_open") toast({ title: "Submissions still open", description: "Judging available after voting ends.", variant: "destructive" });
        else toast({ title: "Judging not available", variant: "destructive" });
        return;
      }
    }
    setPendingStartRound(roundId);
    setShowStartDialog(true);
  };

  const confirmStartJudging = async () => {
    setShowStartDialog(false);
    if (!pendingStartRound || !selectedCompId) return;

    const comp = competitions.find(c => c.id === selectedCompId);
    if (comp && comp.phase !== "judging" && comp.phase !== "result") {
      const votingEnd = comp.voting_ends_at || comp.ends_at;
      const votingExpired = votingEnd && new Date(votingEnd) < new Date();
      if (!votingExpired) {
        toast({ title: "Cannot start judging", variant: "destructive" });
        setPendingStartRound(null);
        return;
      }
      // Phase is auto-derived from dates — no DB write needed
      toast({ title: "Judging window open" });
    }

    const targetRound = rounds.find((r) => r.id === pendingStartRound);

    // Activate round if pending
    if (targetRound && targetRound.status === "pending") {
      toast({ title: `Activating ${targetRound.name}...` });
      const { error } = await supabase.functions.invoke("complete-round", {
        body: { competition_id: selectedCompId, round_number: targetRound.round_number, action: "activate" },
      });
      if (error) { toast({ title: "Activation failed", variant: "destructive" }); setPendingStartRound(null); return; }
      const currentActive = rounds.find((r) => r.status === "active" && r.id !== pendingStartRound);
      if (currentActive) updateRound(currentActive.id, { status: "pending" });
      updateRound(pendingStartRound, { status: "active" });
      toast({ title: `${targetRound.name} is now LIVE` });
    }

    // Create/resume session
    await session.startSession(pendingStartRound);

    setJudgingStarted(true);
    setUserViewOnly(false);
    setSelectedRound(pendingStartRound);
    setSidebarView("round");

    // Resume from bookmark or find first unjudged
    const resumeKey = session.hasResumeData && session.session?.last_entry_id
      ? `${session.session.last_entry_id}::${session.session.last_photo_index ?? 0}`
      : loadResumePosition(selectedCompId, pendingStartRound);

    if (resumeKey && allPhotos.some((p) => getPhotoKey(p) === resumeKey)) {
      setSelectedPhotoKey(resumeKey);
    } else {
      const mode = getRoundMode(rounds.find((r) => r.id === pendingStartRound) || null);
      const first = allPhotos.find((p) => {
        const key = getPhotoKey(p);
        if (mode === "scoring") return photoScoresMap[key]?.myScore == null;
        return (photoTagsMap[key]?.myTags?.length ?? 0) === 0;
      });
      if (first) setSelectedPhotoKey(getPhotoKey(first));
      else if (allPhotos.length > 0) setSelectedPhotoKey(getPhotoKey(allPhotos[0]));
    }
    setPendingStartRound(null);
  };


  if (authLoading || rolesLoading || compsLoading) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-xs tracking-[0.3em] uppercase text-muted-foreground animate-pulse" style={{ fontFamily: "var(--font-heading)" }}>Loading...</div>
      </main>
    );
  }
  if (!isJudge) return null;

  // ── Mobile ──
  if (isMobile) {
    return (
      <>
        <SeatModeBar isAdmin={isAdmin} roster={seatRoster} seatJudgeId={seatActive ? seatJudgeId : null} onSeat={setSeatJudgeId} selfUserId={user?.id} />
        {showStartDialog && pendingStartRound && (
          <StartRoundDialog roundName={rounds.find((r) => r.id === pendingStartRound)?.name || "Round"} totalImages={allPhotos.length} onConfirm={confirmStartJudging} onCancel={() => { setShowStartDialog(false); setPendingStartRound(null); }} />
        )}
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}>
          <MobileJudgeView
            competitions={competitions} selectedCompId={selectedCompId} setSelectedCompId={setSelectedCompId}
            filteredPhotos={filteredPhotos} selectedPhotoKey={selectedPhotoKey} setSelectedPhotoKey={setSelectedPhotoKey}
            getPhotoKey={getPhotoKey} getPhotoEvaluation={getPhotoEvaluation}
            selectedEntry={selectedEntry} selectedPhoto={selectedPhoto} selectedPhotoEvaluation={selectedPhotoEvaluation}
            handleQuickScore={isViewOnly ? (async () => {}) : actions.handleQuickScore} toggleTag={isViewOnly ? (async () => {}) : actions.toggleTag} availableTags={availableTags}
            roundMode={roundMode} goNext={goNext} goPrev={goPrev} activePhotoIdx={activePhotoIdx} activePhotoList={activePhotoList}
            totalEntries={stats.totalEntries} markedEntries={stats.markedEntries} setFullscreen={() => {}}
            scoringEntry={actions.scoringEntry} feedbackInput={feedbackInput} setFeedbackInput={setFeedbackInput}
            commentInput={commentInput} setCommentInput={setCommentInput}
            addComment={async (eid, pi) => { await actions.addComment(eid, pi, commentInput); setCommentInput(""); }}
            lockedByOther={lockedByOther} isRoundLocked={isRoundLocked}
            loadingEntries={loadingEntries} expandedComp={expandedComp} setExpandedComp={setExpandedComp}
            rounds={rounds} selectedRound={selectedRound} setSelectedRound={setSelectedRound}
            setSidebarView={(v: string) => setSidebarView(v as SidebarView)}
            isR1DecisionMode={actions.isR1DecisionMode}
            roundNumber={roundNumber}
            sowScoringRounds={sowScoringRounds}
            currentRound={currentRound}
            judgingStarted={judgingStarted}
            isViewOnly={isViewOnly}
            onStartJudging={handleStartJudging}
            bookmarkedEntryId={session.session?.last_entry_id ?? null}
            bookmarkedPhotoIndex={session.session?.last_photo_index ?? null}
            onToggleBookmark={handleToggleBookmarkForEntry}
          />
        </Suspense>
      </>
    );
  }

  // ════════════════════════════════════════════════
  // CINEMA MODE ONLY — No Classic View
  // ════════════════════════════════════════════════
  return (
    <>
      <SeatModeBar isAdmin={isAdmin} roster={seatRoster} seatJudgeId={seatActive ? seatJudgeId : null} onSeat={setSeatJudgeId} selfUserId={user?.id} />
      {/* Phase 3: Resume dialog */}
      {showResumeDialog && session.session && (
        <ResumeSessionDialog
          competitionTitle={competitions.find(c => c.id === session.session!.competition_id)?.title || "Competition"}
          lastEntryIndex={session.session.last_entry_index}
          elapsedSeconds={session.session.elapsed_seconds}
          onResume={handleResumeFromBookmark}
          onStartFresh={handleStartFresh}
        />
      )}
      {/* Phase 3: Navigation blocker */}
      <NavigationBlocker isActive={judgingStarted} />
      {showStartDialog && pendingStartRound && (
        <StartRoundDialog roundName={rounds.find((r) => r.id === pendingStartRound)?.name || "Round"} totalImages={allPhotos.length} onConfirm={confirmStartJudging} onCancel={() => { setShowStartDialog(false); setPendingStartRound(null); }} />
      )}
      
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}>
        <CinemaJudgeView
          userId={effectiveJudgeId ?? ""} isAdmin={isAdmin} competitions={competitions}
          selectedCompId={selectedCompId} setSelectedCompId={setSelectedCompId}
          entries={entries} loadingEntries={loadingEntries} loadingMore={loadingMore} hasMoreEntries={hasMoreEntries}
          availableTags={availableTags} rounds={rounds} selectedRound={selectedRound} setSelectedRound={setSelectedRound}
          currentRound={currentRound} roundMode={roundMode} isRoundLocked={isRoundLocked}
          sidebarView={sidebarView} setSidebarView={(v) => setSidebarView(v as SidebarView)}
          allPhotos={allPhotos} filteredPhotos={filteredPhotos}
          selectedPhotoKey={selectedPhotoKey} setSelectedPhotoKey={setSelectedPhotoKey}
          selectedPhoto={selectedPhoto} selectedEntry={selectedEntry} selectedPhotoEvaluation={selectedPhotoEvaluation}
          getPhotoKey={getPhotoKey} getPhotoEvaluation={getPhotoEvaluation}
          photoScoresMap={photoScoresMap} photoTagsMap={photoTagsMap} photoDecisionsMap={photoDecisionsMap}
          activePhotoIdx={activePhotoIdx} activePhotoList={activePhotoList} displayIdx={activePhotoIdx} displayTotal={activePhotoList.length}
          goNext={goNext} goPrev={goPrev}
          handleQuickScore={isViewOnly ? (async () => { toast({ title: "View Only", description: "Start judging to score entries.", variant: "destructive" }); }) : actions.handleQuickScore} toggleTag={isViewOnly ? (async () => { toast({ title: "View Only", description: "Start judging to tag entries.", variant: "destructive" }); }) : actions.toggleTag}
          scoringEntry={actions.scoringEntry} taggingEntry={actions.taggingEntry} lockedByOther={lockedByOther}
          feedbackInput={feedbackInput} setFeedbackInput={setFeedbackInput}
          commentInput={commentInput} setCommentInput={setCommentInput}
          addComment={async (eid, pi) => { try { await actions.addComment(eid, pi, commentInput); setCommentInput(""); } catch { /* retain input on failure */ } }}
          handleLoadMore={handleLoadMore} handleStartJudging={handleStartJudging}
          handleCompleteRound={handleCompleteRound} handleActivateRound={handleActivateRound} handleExportCSV={handleExportCSV}
          expandedComp={expandedComp} setExpandedComp={setExpandedComp}
          bulkMode={bulkMode} setBulkMode={setBulkMode}
          bulkSelected={bulkSelected} toggleBulkSelect={toggleBulkSelect}
          setBulkSelected={setBulkSelected}
          handleBulkScore={handleBulkScore} handleBulkTag={handleBulkTag}
          totalEntries={stats.totalEntries} markedEntries={stats.markedEntries}
          rejectedCount={stats.rejected} acceptedCount={stats.accepted}
          shortlistedCount={stats.shortlisted} completedRoundsCount={completedRoundsCount}
          needsReviewCount={stats.needsReview}
          shortlistedExpanded={true} setShortlistedExpanded={() => {}}
          setMobileTab={setMobileTab}
          manualVoteCount="" setManualVoteCount={() => {}}
          handleAddManualVotes={async (eid) => { await handleAddManualVotes(eid, 1); }}
          addingVotes={voteAdjustmentMutation.isPending}
          handlePlacement={handlePlacement}
          invalidateEntries={invalidatePhotoData}
          aggregateTotalPhotos={aggregateStats?.totalPhotos}
          aggregateReviewedPhotos={aggregateStats?.reviewedPhotos}
          competitionProgress={aggregateStats?.competitionProgress}
          feedbackSavedSignal={feedbackSavedSignal}
          roundNumber={roundNumber}
          sowRoundLogic={sowRoundLogic}
          sowRound4Criteria={sowScoringRounds}
          strictLockFlag={strictLockFlag}
          filterCounts={roundFilterCounts}
          judgingStarted={judgingStarted}
          isViewOnly={isViewOnly}
          // J-06: handleDecision/handleR2Decision/handleR3Decision/decisionPending props removed (tag-only).
          // Session resilience
          sessionIdleState={session.idleState}
          sessionElapsed={session.elapsedSeconds}
          onPauseSession={session.pauseSession}
          onResumeSession={session.resumeSession}
            onBookmarkEntry={handleManualBookmark}
          isCurrentEntryBookmarked={!!session.session?.last_entry_id && !!selectedPhoto && session.session.last_entry_id === selectedPhoto.entryId && (session.session.last_photo_index ?? 0) === (selectedPhoto.photoIndex ?? 0)}
          bookmarkedEntryId={session.session?.last_entry_id ?? null}
          bookmarkedPhotoIndex={session.session?.last_photo_index ?? null}
          onToggleBookmarkEntry={handleToggleBookmarkForEntry}
          onSetViewOnly={() => setUserViewOnly(true)}
          onSaveAndLeave={handleSaveAndLeave}
        />
      </Suspense>
    </>
  );
};

export default JudgePanel;
