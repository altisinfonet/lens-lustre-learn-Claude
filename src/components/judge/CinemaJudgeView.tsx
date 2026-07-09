import { useState, useRef, useCallback, useMemo, useEffect, memo } from "react";
import StartJudgingPrompt from "@/components/judge/StartJudgingPrompt";
import IdleOverlay from "@/components/judge/IdleOverlay";
import JudgeProgressPanel from "@/components/judge/JudgeProgressPanel";
import { useMultiJudgeProgress } from "@/hooks/judging/useMultiJudgeProgress";
import {
  Star, Loader2, AlertTriangle, Camera,
  ChevronRight, ChevronLeft, CheckCircle, Zap, Minimize2,
  XCircle, FolderCheck, ChevronDown, ChevronUp, Eraser,
  LayoutGrid, List, AlertCircle,
  Download, CheckSquare, Square,
  LogOut, HelpCircle, BookOpen, PauseCircle, Bookmark, BookmarkCheck, Play, CheckCircle2,
} from "lucide-react";
import JudgeRoundSidebar from "@/components/judge/JudgeRoundSidebar";
import type { RoundFilterCounts } from "@/components/judge/JudgeRoundSidebar";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/core/useAuth";
import JudgeSessionTimer from "@/components/judge/JudgeSessionTimer";
import BulkActionsBar from "@/components/judge/BulkActionsBar";
import VirtualizedPhotoGrid from "@/components/judge/VirtualizedPhotoGrid";
import { useColumnCount } from "@/hooks/judging/useColumnCount";
import CinemaDashboard from "@/components/judge/CinemaDashboard";
import CinemaFullView from "@/components/judge/CinemaFullView";
import CinemaListView from "@/components/judge/CinemaListView";
import CompleteRoundDialog from "@/components/judge/CompleteRoundDialog";
import PreflightStatusBadge from "@/components/judge/PreflightStatusBadge";
import JudgeGuideModal from "@/components/judge/JudgeGuideModal";
import UnsavedChangesDialog from "@/components/judge/UnsavedChangesDialog";
import { useJudgeGuide } from "@/hooks/judging/useJudgeGuide";
import { toast } from "@/hooks/core/use-toast";

import type { Competition, JudgingTag, JudgingRound, JudgeComment, JudgeEntry, FlatPhoto, PhotoEvaluation, SidebarView, PhotoScoreData, PhotoTagData } from "@/hooks/judging/types";

const SCORE_BG_STYLE: Record<number, React.CSSProperties> = Object.fromEntries(
  Array.from({ length: 11 }, (_, i) => [i, { backgroundColor: `hsl(var(--score-${i}))` }])
);

interface CinemaJudgeViewProps {
  userId: string;
  isAdmin: boolean;
  competitions: Competition[];
  selectedCompId: string | null;
  setSelectedCompId: (id: string | null) => void;
  entries: JudgeEntry[];
  loadingEntries: boolean;
  loadingMore: boolean;
  hasMoreEntries: boolean;
  availableTags: JudgingTag[];
  rounds: JudgingRound[];
  selectedRound: string | null;
  setSelectedRound: (id: string | null) => void;
  currentRound: JudgingRound | null;
  roundMode: "scoring" | "tagging" | "decision";
  isRoundLocked: boolean;
  sidebarView: SidebarView;
  setSidebarView: (v: SidebarView) => void;
  allPhotos: FlatPhoto[];
  filteredPhotos: FlatPhoto[];
  selectedPhotoKey: string | null;
  setSelectedPhotoKey: (key: string | null) => void;
  selectedPhoto: FlatPhoto | null;
  selectedEntry: JudgeEntry | null;
  selectedPhotoEvaluation: PhotoEvaluation | null;
  getPhotoKey: (p: FlatPhoto) => string;
  getPhotoEvaluation: (p: FlatPhoto) => PhotoEvaluation;
  photoScoresMap: Record<string, PhotoScoreData>;
  photoTagsMap: Record<string, PhotoTagData>;
  photoDecisionsMap?: Record<string, { myDecision: string | null; allDecisions: { judge_id: string; decision: string; round_number: number }[] }>;
  activePhotoIdx: number;
  activePhotoList: FlatPhoto[];
  displayIdx: number;
  displayTotal: number;
  goNext: () => void;
  goPrev: () => void;
  handleQuickScore: (entryId: string, photoIndex: number, score: number, options?: { silent?: boolean; skipAdvance?: boolean; criteria?: { composition: number | null; color_palette: number | null; technique: number | null } }) => Promise<void>;
  toggleTag: (entryId: string, photoIndex: number, tagId: string, options?: { silent?: boolean; skipAdvance?: boolean }) => Promise<void>;
  scoringEntry: string | null;
  taggingEntry: string | null;
  lockedByOther: boolean;
  feedbackInput: string;
  setFeedbackInput: (v: string) => void;
  commentInput: string;
  setCommentInput: (v: string) => void;
  addComment: (entryId: string, photoIndex: number) => Promise<void>;
  handleLoadMore: () => void;
  handleStartJudging: (roundId: string) => void;
  handleCompleteRound: (roundId: string) => Promise<void>;
  handleActivateRound: (roundId: string) => Promise<void>;
  handleExportCSV: () => void;
  expandedComp: string | null;
  setExpandedComp: (id: string | null) => void;
  shortlistedExpanded: boolean;
  setShortlistedExpanded: (v: boolean) => void;
  totalEntries: number;
  markedEntries: number;
  rejectedCount: number;
  acceptedCount: number;
  shortlistedCount: number;
  needsReviewCount: number;
  completedRoundsCount: number;
  bulkMode: boolean;
  setBulkMode: (v: boolean) => void;
  bulkSelected: Set<string>;
  toggleBulkSelect: (key: string) => void;
  setBulkSelected: (s: Set<string>) => void;
  handleBulkScore: (score: number) => Promise<void>;
  handleBulkTag: (tagId: string) => Promise<void>;
  manualVoteCount: string;
  setManualVoteCount: (v: string) => void;
  handleAddManualVotes: (entryId: string) => Promise<void>;
  addingVotes: boolean;
  handlePlacement: (entryId: string, placement: string | null) => Promise<void>;
  setMobileTab: (tab: "comps" | "photos" | "judge") => void;
  onExitCinema?: () => void;
  onTagCreated?: (tag: JudgingTag) => void;
  aggregateTotalPhotos?: number;
  aggregateReviewedPhotos?: number;
  competitionProgress?: Record<string, { roundLabel: string; progressPct: number }>;
  /** Judge's display name for personalization */
  judgeName?: string;
  /** Judge's avatar URL */
  judgeAvatarUrl?: string;
  /** Callback to invalidate/refetch entries after status changes */
  invalidateEntries?: () => void;
  /** Signal counter incremented when feedback autosave completes */
  feedbackSavedSignal?: number;
  /** Current round number (1-4) */
  roundNumber?: number;
  /** SOW flags for UI alignment */
  sowRoundLogic?: boolean;
  sowRound4Criteria?: boolean;
  strictLockFlag?: boolean;
  /** Round filter counts for JudgeRoundSidebar */
  filterCounts?: RoundFilterCounts;
  /** Whether judging session has started (for timer) */
  judgingStarted?: boolean;
  /** Whether the competition is in view-only mode (submission/voting phase) */
  isViewOnly?: boolean;
  // Judging v5 (J-06): handleDecision / handleR2Decision / handleR3Decision /
  // decisionPending props removed — decisions flow exclusively through tag clicks.
  /** Session resilience */
  sessionIdleState?: "active" | "warning" | "paused";
  sessionElapsed?: number;
  onPauseSession?: () => Promise<void>;
  onResumeSession?: () => Promise<void>;
  /** Manual bookmark current entry */
  onBookmarkEntry?: () => void;
  /** Whether the currently viewed entry is the bookmarked entry */
  isCurrentEntryBookmarked?: boolean;
  /** Bookmarked entry id from judge_sessions.last_entry_id — paired with bookmarkedPhotoIndex for per-photo highlight. */
  bookmarkedEntryId?: string | null;
  /** Bookmarked photo index within bookmarkedEntryId — only THAT (entry, photo) pair is highlighted. */
  bookmarkedPhotoIndex?: number | null;
  /** Toggle bookmark for an arbitrary (entry, photo) (called from hover icon / long-press on thumbnails). */
  onToggleBookmarkEntry?: (entryId: string, photoIndex: number) => void;
  /** Callback when user selects View Only from StartJudgingPrompt */
  onSetViewOnly?: () => void;
  /** Save & Leave handler for unsaved changes dialog */
  onSaveAndLeave?: () => void;
}

/* ── Status config — supports both global entry.status values AND per-judge decision values ── */
const statusConfig: Record<string, { label: string; color: string }> = {
  approved: { label: "Passed R1", color: "text-primary" },
  rejected: { label: "Rejected", color: "text-destructive" },
  reject: { label: "Rejected", color: "text-destructive" },
  shortlisted: { label: "Shortlisted", color: "text-primary" },
  shortlist: { label: "Shortlisted", color: "text-primary" },
  round1_qualified: { label: "R1 Qualified", color: "text-primary" },
  accepted: { label: "Accepted", color: "text-primary" },
  accept: { label: "Accepted", color: "text-primary" },
  round2_qualified: { label: "R2 Qualified", color: "text-primary" },
  qualified: { label: "Qualified", color: "text-primary" },
  finalist: { label: "Finalist", color: "text-accent-foreground" },
  hold: { label: "On Hold", color: "text-muted-foreground" },
  needs_review: { label: "Review", color: "text-muted-foreground" },
  submitted: { label: "Pending", color: "text-muted-foreground" },
  winner: { label: "🏆 Winner", color: "text-primary" },
};

const CinemaStatusBadge = ({ status }: { status: string }) => {
  const c = statusConfig[status] || statusConfig.submitted;
  return (
    <span className={`text-[9px] px-2 py-0.5 rounded-full bg-foreground/10 backdrop-blur-sm ${c.color} font-bold uppercase tracking-wider whitespace-nowrap`}
      style={{ fontFamily: "var(--font-heading)" }}>
      {c.label}
    </span>
  );
};

/* EvalPanelContent removed — evaluation is handled entirely by CinemaFullView */

/** Thin wrapper to bridge Cinema grid to VirtualizedPhotoGrid */
const CinemaVirtualizedGrid = memo(({
  filteredPhotos, getPhotoKey, photoScoresMap, photoTagsMap, photoDecisionsMap, availableTags,
  bulkMode, bulkSelected, toggleBulkSelect, setSelectedPhotoKey, setMobileTab, isRoundLocked, isViewOnly,
  judgingStarted, onStartPrompt, roundNumber,
  competitionPhase, competitionCurrentRound, bookmarkedEntryId, bookmarkedPhotoIndex, onToggleBookmark,
  lastViewedPhotoKey,
}: {
  filteredPhotos: FlatPhoto[];
  getPhotoKey: (p: FlatPhoto) => string;
  photoScoresMap: Record<string, PhotoScoreData>;
  photoTagsMap: Record<string, PhotoTagData>;
  photoDecisionsMap?: Record<string, { myDecision: string | null }>;
  availableTags: JudgingTag[];
  bulkMode: boolean;
  bulkSelected: Set<string>;
  toggleBulkSelect: (key: string) => void;
  setSelectedPhotoKey: (key: string | null) => void;
  setMobileTab: (tab: "comps" | "photos" | "judge") => void;
  isRoundLocked?: boolean;
  isViewOnly?: boolean;
  judgingStarted?: boolean;
  onStartPrompt?: (key: string) => void;
  roundNumber?: number;
  /** Step 20: phase + round forwarded to PhaseWatermark on each cell. */
  competitionPhase?: string;
  competitionCurrentRound?: string | null;
  /** Bookmarked entry id — paired with bookmarkedPhotoIndex for per-photo highlight. */
  bookmarkedEntryId?: string | null;
  /** Bookmarked photo index. Only the (entryId,photoIndex) pair is highlighted. */
  bookmarkedPhotoIndex?: number | null;
  /** Toggle bookmark from a thumbnail hover icon. */
  onToggleBookmark?: (entryId: string, photoIndex: number) => void;
  /** Just-exited Full View photo — drives auto-scroll + glow pulse. */
  lastViewedPhotoKey?: string | null;
}) => {
  const columnCount = useColumnCount();
  return (
    <VirtualizedPhotoGrid
      photos={filteredPhotos}
      getPhotoKey={getPhotoKey}
      photoScoresMap={photoScoresMap}
      photoTagsMap={photoTagsMap}
      photoDecisionsMap={photoDecisionsMap as any}
      availableTags={availableTags}
      bulkMode={bulkMode}
      bulkSelected={bulkSelected}
      onPhotoClick={(key) => {
        if (isViewOnly) {
          setSelectedPhotoKey(key);
          setMobileTab("judge");
          return;
        }
        if (!judgingStarted) {
          onStartPrompt?.(key);
          return;
        }
        setSelectedPhotoKey(key);
        setMobileTab("judge");
      }}
      onBulkToggle={toggleBulkSelect}
      StatusBadge={CinemaStatusBadge}
      columnCount={columnCount}
      isRoundLocked={isRoundLocked}
      roundNumber={roundNumber}
      competitionPhase={competitionPhase}
      competitionCurrentRound={competitionCurrentRound}
      bookmarkedEntryId={bookmarkedEntryId}
      bookmarkedPhotoIndex={bookmarkedPhotoIndex}
      onToggleBookmark={onToggleBookmark}
      lastViewedPhotoKey={lastViewedPhotoKey}
    />
  );
});
CinemaVirtualizedGrid.displayName = "CinemaVirtualizedGrid";

/* ══════════════════════════════════════════════════════════════════
   CINEMA MODE JUDGE VIEW
   ══════════════════════════════════════════════════════════════════ */
const CinemaJudgeView = (props: CinemaJudgeViewProps) => {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const {
    userId, isAdmin, competitions, selectedCompId, setSelectedCompId,
    entries, loadingEntries, loadingMore, hasMoreEntries,
    availableTags, rounds, selectedRound, setSelectedRound,
    currentRound, roundMode, isRoundLocked,
    sidebarView, setSidebarView,
    allPhotos, filteredPhotos,
    selectedPhotoKey, setSelectedPhotoKey,
    selectedPhoto, selectedEntry, selectedPhotoEvaluation,
    getPhotoKey, getPhotoEvaluation, photoScoresMap, photoTagsMap, photoDecisionsMap,
    activePhotoIdx, activePhotoList,
    displayIdx, displayTotal,
    goNext, goPrev,
    handleQuickScore, toggleTag,
    scoringEntry, taggingEntry, lockedByOther,
    feedbackInput, setFeedbackInput,
    commentInput, setCommentInput,
    addComment,
    handleLoadMore, handleStartJudging,
    handleCompleteRound, handleActivateRound, handleExportCSV,
    expandedComp, setExpandedComp,
    shortlistedExpanded, setShortlistedExpanded,
    totalEntries, markedEntries,
    rejectedCount, acceptedCount, shortlistedCount, needsReviewCount,
    completedRoundsCount,
    bulkMode, setBulkMode, bulkSelected, toggleBulkSelect, setBulkSelected,
    handleBulkScore, handleBulkTag,
    manualVoteCount, setManualVoteCount, handleAddManualVotes, addingVotes,
    handlePlacement,
    setMobileTab,
    onExitCinema,
    aggregateTotalPhotos, aggregateReviewedPhotos, competitionProgress,
    judgeName, judgeAvatarUrl,
  } = props;

  const [completeRoundConfirm, setCompleteRoundConfirm] = useState<string | null>(null);
  const [showNav, setShowNav] = useState(false);
  const { showGuide, dismissGuide, openGuide } = useJudgeGuide();
  const [gridLayout, setGridLayout] = useState<"grid" | "list">("grid");
  const [zoomLevel, setZoomLevel] = useState(1);
  const [startPromptKey, setStartPromptKey] = useState<string | null>(null); // photo key waiting for start/view-only decision

  // Multi-judge progress
  const { otherJudges, isLoading: judgeProgressLoading } = useMultiJudgeProgress(selectedCompId, userId);

  const wasPhotoOpenRef = useRef(false);
  const gridScrollRef = useRef<HTMLDivElement>(null);
  const savedScrollTop = useRef(0);
  const navTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  // Ref to CinemaFullView's guardedExit — replaces event-based cinema-request-exit
  const fullViewGuardedExitRef = useRef<(() => void) | null>(null);
  // Pending action to run after full view exit completes (e.g. minimize, support, logout)
  const pendingExitActionRef = useRef<(() => void) | null>(null);

  // Callback for when CinemaFullView exit completes — runs any pending continuation action
  const handleFullViewExitComplete = useCallback(() => {
    if (pendingExitActionRef.current) {
      const action = pendingExitActionRef.current;
      pendingExitActionRef.current = null;
      // Run on next tick to allow state to settle
      setTimeout(action, 0);
    }
  }, []);

  // Last-viewed photo key — set when judge exits Full View, cleared after the
  // pulse animation runs. Drives the auto-scroll + glow-pulse on the matching
  // grid cell so judges instantly spot the photo they just left.
  const [lastViewedPhotoKey, setLastViewedPhotoKey] = useState<string | null>(null);
  const lastViewedClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Save scroll position when entering full view, restore when exiting
  useEffect(() => {
    const isPhotoOpen = !!selectedPhoto;
    if (isPhotoOpen && !wasPhotoOpenRef.current) {
      // Save scroll position before opening full view
      if (gridScrollRef.current) savedScrollTop.current = gridScrollRef.current.scrollTop;
      setZoomLevel(1);
    }
    if (!isPhotoOpen && wasPhotoOpenRef.current) {
      // Restore scroll position after returning to grid
      requestAnimationFrame(() => {
        if (gridScrollRef.current) gridScrollRef.current.scrollTop = savedScrollTop.current;
      });
      // Capture the just-closed photo for the highlight pulse; clear after 2.5s
      if (selectedPhotoKey) {
        setLastViewedPhotoKey(selectedPhotoKey);
        if (lastViewedClearTimer.current) clearTimeout(lastViewedClearTimer.current);
        lastViewedClearTimer.current = setTimeout(() => setLastViewedPhotoKey(null), 2500);
      }
    }
    wasPhotoOpenRef.current = isPhotoOpen;
  }, [selectedPhoto, selectedPhotoKey]);

  // Cleanup the highlight timer on unmount
  useEffect(() => () => {
    if (lastViewedClearTimer.current) clearTimeout(lastViewedClearTimer.current);
  }, []);

  useEffect(() => {
    if (!selectedPhoto) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [selectedPhoto]);

  // Auto-hide nav sidebar after inactivity
  const handleMouseMove = useCallback(() => {
    setShowNav(true);
    if (navTimeoutRef.current) clearTimeout(navTimeoutRef.current);
    if (selectedPhoto) {
      navTimeoutRef.current = setTimeout(() => setShowNav(false), 3000);
    }
  }, [selectedPhoto]);

  // Single-pass tag counts (replaces O(n²) nested loop)
  const tagCountsMap = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const tag of availableTags) counts[tag.id] = 0;
    for (const p of allPhotos) {
      const myTags = photoTagsMap[getPhotoKey(p)]?.myTags;
      if (myTags) for (const tagId of myTags) { if (tagId in counts) counts[tagId]++; }
    }
    return counts;
  }, [availableTags, allPhotos, photoTagsMap, getPhotoKey]);

  const selectedCompTitle = useMemo(() => selectedCompId ? competitions.find(c => c.id === selectedCompId)?.title || "Competition" : "Judge Panel", [competitions, selectedCompId]);

  const selectedComp = useMemo(() => competitions.find(c => c.id === selectedCompId) || null, [competitions, selectedCompId]);

  return (
    <main
      className="min-h-screen text-foreground relative overflow-hidden bg-background"
      onMouseMove={handleMouseMove}
    >
      {/* ─── IDLE OVERLAY (Phase 3 Step 3.1) ─── */}
      {props.sessionIdleState && props.sessionIdleState !== "active" && props.onResumeSession && props.onPauseSession && (
        <IdleOverlay
          idleState={props.sessionIdleState}
          elapsedSeconds={props.sessionElapsed ?? 0}
          onResume={props.onResumeSession}
          onPause={props.onPauseSession}
        />
      )}

      {/* ─── AMBIENT GLOW ─── */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 w-72 h-72 bg-primary/[0.03] rounded-full blur-[100px]" />
      </div>

      {/* ─── TOP TOOLBAR ─── */}
      <motion.div
        initial={{ y: -40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5 }}
        className="relative z-20 flex items-center justify-between px-6 h-[52px] border-b border-border bg-card"
      >
        {/* Left: Back + Brand + Round + Competition Details */}
        <div className="flex items-center gap-3 min-w-0">
          {/* Back button — always visible, navigates: FullView→Grid→Dashboard→Exit */}
          {/* FIX #3: Wrap back button with unsaved-changes guard when in full view */}
          <button
            onClick={() => {
              if (selectedPhoto) {
                // Use ref-based guard — triggers CinemaFullView's guardedExit
                fullViewGuardedExitRef.current?.();
              } else if (selectedCompId) {
                setSelectedCompId(null);
                setSelectedPhotoKey(null);
              } else if (onExitCinema) {
                onExitCinema();
              }
            }}
            aria-label={selectedPhoto ? "Back to grid" : selectedCompId ? "Back to dashboard" : "Exit cinema mode"}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-muted-foreground/70 hover:text-foreground hover:bg-muted/10 transition-all text-[12px] font-medium shrink-0"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="hidden sm:inline">
              {selectedPhoto ? "Grid" : selectedCompId ? "Dashboard" : "Exit"}
            </span>
          </button>
          <div className="h-5 w-px bg-border/50" />
          <h2 className="text-sm font-bold text-foreground truncate" style={{ fontFamily: "var(--font-display)" }}>
            {selectedCompTitle}
          </h2>
          {selectedCompId && currentRound && (
            <span className="text-[12px] font-medium text-primary border-b-2 border-primary pb-0.5 shrink-0" style={{ fontFamily: "var(--font-heading)" }}>
              {currentRound.name}: {roundMode === "decision" ? "Screening" : roundMode === "scoring" ? "Scoring" : "Tagging"}
            </span>
          )}
          {selectedCompId && currentRound && (
            <PreflightStatusBadge competitionId={selectedCompId} roundNumber={currentRound.round_number} />
          )}
          {/* Session Timer */}
          {selectedCompId && (
            <JudgeSessionTimer isActive={props.judgingStarted ?? false} entryId={selectedEntry?.id ?? null} sessionElapsed={props.sessionElapsed} />
          )}
        </div>

        {/* Right: Pause + Need Help + Actions + Judge info */}
        <div className="flex items-center gap-3">
          {/* Bookmark — toggle bookmark for the current entry. */}
          {selectedCompId && props.onBookmarkEntry && props.judgingStarted && (
            <button
              onClick={() => {
                const wasBookmarked = !!props.isCurrentEntryBookmarked;
                props.onBookmarkEntry?.();
                toast({
                  title: wasBookmarked ? "Bookmark removed" : "Entry bookmarked ✓",
                  description: wasBookmarked
                    ? "This photo is no longer your resume point."
                    : "You can resume from this point later.",
                });
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all border ${
                props.isCurrentEntryBookmarked
                  ? "bg-primary/15 text-primary border-primary/50 shadow-[0_0_8px_hsl(var(--primary)/0.2)]"
                  : "text-primary hover:text-primary/80 hover:bg-primary/10 border-primary/30 hover:border-primary/50"
              }`}
              style={{ fontFamily: "var(--font-heading)" }}
              aria-label={props.isCurrentEntryBookmarked ? "Remove bookmark" : "Bookmark current entry"}
            >
              {props.isCurrentEntryBookmarked
                ? <BookmarkCheck className="h-3.5 w-3.5 fill-primary" />
                : <Bookmark className="h-3.5 w-3.5" />
              }
              <span className="hidden sm:inline">{props.isCurrentEntryBookmarked ? "Bookmarked" : "Bookmark"}</span>
            </button>
          )}
          {/* Unified Smart Judging Button — single button, 5 states:
              1) Begin Judging  → fresh round, no session active
              2) Resume Judging → paused mid-round (sessionIdleState === 'paused')
              3) Pause          → session active, judging in progress
              4) Complete Round → all judged AND zero Needs Review (pulsing emerald)
              5) Completed      → round finalized (disabled)
              Gate: Complete cannot appear while needsReviewCount > 0. */}
          {selectedCompId && (() => {
            const unjudgedCount = props.filterCounts?.unjudged ?? (totalEntries - markedEntries);
            const pendingReview = props.filterCounts?.needsReview ?? needsReviewCount ?? 0;
            const roundCompleted = currentRound?.status === "completed";
            const isPaused = props.sessionIdleState === "paused";
            const allJudged =
              props.judgingStarted &&
              unjudgedCount === 0 &&
              pendingReview === 0 &&
              totalEntries > 0 &&
              !roundCompleted;

            // 5) Round already finalized
            if (roundCompleted) {
              return (
                <button
                  disabled
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-emerald-500 bg-emerald-500/10 border border-emerald-500/30 opacity-70 cursor-default"
                  style={{ fontFamily: "var(--font-heading)" }}
                  aria-label="Round Completed"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Completed</span>
                </button>
              );
            }

            // 4) All judged + zero Needs Review → Complete Round
            if (allJudged) {
              return (
                <button
                  onClick={() => selectedRound && handleCompleteRound(selectedRound)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10 transition-all border border-emerald-500/30 hover:border-emerald-500/50 animate-pulse"
                  style={{ fontFamily: "var(--font-heading)" }}
                  aria-label="Complete Round"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Complete Round</span>
                </button>
              );
            }

            // 1) Fresh start — no session yet
            if (!props.judgingStarted) {
              return (
                <button
                  onClick={() => selectedRound && handleStartJudging(selectedRound)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-primary hover:text-primary/80 hover:bg-primary/10 transition-all border border-primary/30 hover:border-primary/50"
                  style={{ fontFamily: "var(--font-heading)" }}
                  aria-label="Begin Judging"
                >
                  <Play className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Begin Judging</span>
                </button>
              );
            }

            // 2) Paused mid-round → Resume
            if (isPaused && props.onResumeSession) {
              return (
                <button
                  onClick={async () => { await props.onResumeSession?.(); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-primary hover:text-primary/80 hover:bg-primary/10 transition-all border border-primary/30 hover:border-primary/50"
                  style={{ fontFamily: "var(--font-heading)" }}
                  aria-label="Resume Judging"
                >
                  <Play className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Resume Judging</span>
                </button>
              );
            }

            // 3) Active session → Pause (with inline hint when blocked from completion)
            if (props.judgingStarted && props.onPauseSession) {
              const blockedHint = unjudgedCount === 0 && pendingReview > 0
                ? `${pendingReview} need${pendingReview === 1 ? "s" : ""} review`
                : null;
              return (
                <div className="flex items-center gap-2">
                  {blockedHint && (
                    <span
                      className="hidden md:inline text-[10px] text-amber-500/80"
                      style={{ fontFamily: "var(--font-heading)" }}
                      title="Resolve all 'Needs Review' photos to complete the round"
                    >
                      {blockedHint}
                    </span>
                  )}
                  <button
                    onClick={async () => { await props.onPauseSession?.(); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-amber-500 hover:text-amber-400 hover:bg-amber-500/10 transition-all border border-amber-500/30 hover:border-amber-500/50"
                    style={{ fontFamily: "var(--font-heading)" }}
                    aria-label="Pause Judging"
                  >
                    <PauseCircle className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Pause</span>
                  </button>
                </div>
              );
            }

            return null;
          })()}
          {/* Need Help? — pre-filled support ticket */}
          {selectedCompId && (
            <button
              onClick={() => {
                const params = new URLSearchParams({
                  category: "Judging Query",
                  subject: `[${selectedCompTitle}] — Judge Question`,
                });
                const navTo = `/help-support?${params.toString()}`;
                if (selectedPhoto) {
                  pendingExitActionRef.current = () => navigate(navTo);
                  fullViewGuardedExitRef.current?.();
                } else {
                  navigate(navTo);
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-muted-foreground/70 hover:text-foreground hover:bg-muted/10 transition-all border border-transparent hover:border-border"
              style={{ fontFamily: "var(--font-heading)" }}
              aria-label="Need Help?"
            >
              <HelpCircle className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Need Help?</span>
            </button>
          )}
          {onExitCinema && (
            <button
              onClick={() => {
                if (selectedPhoto) {
                  // Guard exit then call onExitCinema on completion via pendingAction
                  const exitRef = fullViewGuardedExitRef.current;
                  if (exitRef) {
                    // Store the cinema exit as a follow-up — onExitComplete handles it
                    pendingExitActionRef.current = onExitCinema;
                    exitRef();
                  } else {
                    onExitCinema();
                  }
                } else {
                  onExitCinema();
                }
              }}
              className="p-2 rounded-full text-muted-foreground/60 hover:text-foreground hover:bg-muted/20 transition-all"
              title="Back to classic layout"
              aria-label="Exit cinema mode"
            >
              <Minimize2 className="h-4 w-4" />
            </button>
          )}
          <div className="h-6 w-px bg-border" />
          <div className="flex items-center gap-2.5">
            <div className="text-right">
              <span className="text-[9px] text-muted-foreground/50 block leading-none" style={{ fontFamily: "var(--font-heading)" }}>Active Judge</span>
              <span className="text-[11px] font-semibold text-foreground leading-none mt-0.5 block" style={{ fontFamily: "var(--font-heading)" }}>{judgeName || "Judge"}</span>
            </div>
            {judgeAvatarUrl ? (
              <img loading="lazy" decoding="async" src={judgeAvatarUrl} alt={judgeName || "Judge avatar"} className="w-8 h-8 rounded-full object-cover border border-border" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-muted/20 border border-border flex items-center justify-center">
                <Camera className="w-3.5 h-3.5 text-muted-foreground/60" />
              </div>
            )}
          </div>
        </div>
      </motion.div>

      <div className="relative z-10 flex overflow-hidden" style={{ height: "calc(100vh - 52px)" }}>
        {/* ─── LEFT: ROUND-BASED SIDEBAR (auto-hide when photo selected) ─── */}
        <AnimatePresence>
          {(!selectedPhoto || showNav) && (
            <motion.div
              initial={{ x: -200, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -200, opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="w-56 shrink-0 border-r border-border bg-card flex flex-col overflow-y-auto min-h-0"
            >
              <JudgeRoundSidebar
                competitions={competitions}
                selectedCompId={selectedCompId}
                setSelectedCompId={(id) => {
                  if (selectedPhoto) {
                    pendingExitActionRef.current = () => setSelectedCompId(id);
                    fullViewGuardedExitRef.current?.();
                  } else {
                    setSelectedCompId(id);
                  }
                }}
                expandedComp={expandedComp}
                setExpandedComp={(id) => {
                  if (selectedPhoto) {
                    pendingExitActionRef.current = () => { if (id) setSelectedCompId(id); else setSelectedCompId(null); };
                    fullViewGuardedExitRef.current?.();
                  } else {
                    if (id) setSelectedCompId(id); else setSelectedCompId(null);
                  }
                }}
                rounds={rounds}
                selectedRound={selectedRound}
                setSelectedRound={(id) => {
                  if (selectedPhoto) {
                    pendingExitActionRef.current = () => setSelectedRound(id);
                    fullViewGuardedExitRef.current?.();
                  } else {
                    setSelectedRound(id);
                  }
                }}
                sidebarView={sidebarView}
                setSidebarView={(v) => {
                  if (selectedPhoto) {
                    pendingExitActionRef.current = () => { setSidebarView(v as SidebarView); setSelectedPhotoKey(null); };
                    fullViewGuardedExitRef.current?.();
                  } else {
                    setSidebarView(v as SidebarView); setSelectedPhotoKey(null);
                  }
                }}
                setSelectedPhotoKey={(k) => {
                  if (selectedPhoto) {
                    pendingExitActionRef.current = () => setSelectedPhotoKey(k);
                    fullViewGuardedExitRef.current?.();
                  } else {
                    setSelectedPhotoKey(k);
                  }
                }}
                filterCounts={props.filterCounts ?? { accepted: acceptedCount, shortlisted: shortlistedCount, needsReview: needsReviewCount, rejected: rejectedCount, qualified: 0, finalist: 0, winner: 0, runner_up_1: 0, runner_up_2: 0, honorary_mention: 0, special_jury: 0, unjudged: 0, total: totalEntries }}
                availableTags={availableTags}
                tagCountsMap={tagCountsMap}
                setMobileTab={setMobileTab}
              />

              {/* Multi-judge progress panel */}
              <JudgeProgressPanel otherJudges={otherJudges} isLoading={judgeProgressLoading} />

              {/* Bottom section: Actions + Guide + Logout
                  NOTE: 'Begin Judging', 'Complete Round', and 'Activate Round' duplicates removed —
                  the unified header smart button is the SINGLE source of truth for round control. */}
              <div className="px-3 pb-8 pt-2 mt-auto space-y-3 border-t border-border/30">
                {selectedCompId && currentRound && currentRound.status === "active" && !selectedPhotoKey && (() => {
                  const comp = competitions.find(c => c.id === selectedCompId);
                  const isJudgingPhase = comp?.phase === "judging";
                  if (isJudgingPhase) return null;
                  return (
                    <div className="w-full text-center text-[11px] text-muted-foreground/60 py-3 rounded-xl border border-dashed border-border" style={{ fontFamily: "var(--font-heading)" }}>
                      {comp?.phase === "voting" ? "⏳ Voting in progress — judging starts after" :
                       comp?.phase === "submission_open" ? "📥 Submissions open — view only" : "Judging not available"}
                    </div>
                  );
                })()}

                {selectedCompId && currentRound && (
                  <div className="flex gap-1.5">
                    <button onClick={handleExportCSV}
                      aria-label="Export CSV"
                      className="flex-1 flex items-center justify-center gap-1 text-[9px] px-2 py-1.5 rounded-lg border border-border text-muted-foreground/60 hover:text-foreground hover:bg-muted/10 transition-all"
                      style={{ fontFamily: "var(--font-heading)" }}>
                      <Download className="h-3 w-3" /> Export
                    </button>
                    <button onClick={() => { setBulkMode(!bulkMode); setBulkSelected(new Set()); }}
                      aria-label="Toggle bulk mode"
                      className={`flex-1 flex items-center justify-center gap-1 text-[9px] px-2 py-1.5 rounded-lg border transition-all ${
                        bulkMode ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground/60 hover:text-foreground hover:bg-muted/10"
                      }`}
                      style={{ fontFamily: "var(--font-heading)" }}>
                      <CheckSquare className="h-3 w-3" /> Bulk
                    </button>
                  </div>
                )}

                {isAdmin && selectedCompId && currentRound && currentRound.status === "pending" && (
                  <button onClick={() => handleActivateRound(currentRound.id)}
                    aria-label="Activate round"
                    className="w-full flex items-center justify-center gap-1.5 text-[9px] px-3 py-1.5 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/90 transition-all"
                    style={{ fontFamily: "var(--font-heading)" }}>
                    <Zap className="h-3 w-3" /> Activate Round
                  </button>
                )}

                <div className="space-y-1 pt-1">
                  <button onClick={openGuide}
                    aria-label="Judge Guide"
                    className="w-full text-left px-2 py-1.5 text-[12px] flex items-center gap-2.5 text-muted-foreground/60 hover:text-foreground transition-colors rounded-md hover:bg-muted/10"
                    style={{ fontFamily: "var(--font-heading)" }}>
                    <BookOpen className="w-4 h-4" />
                    Judge Guide
                  </button>
                  <button onClick={() => {
                      const params = new URLSearchParams({ category: "Judging Query", subject: `[${selectedCompTitle}] — Judge Question` });
                      const navTo = `/help-support?${params.toString()}`;
                      if (selectedPhoto) {
                        pendingExitActionRef.current = () => { if (onExitCinema) onExitCinema(); navigate(navTo); };
                        fullViewGuardedExitRef.current?.();
                      } else {
                        if (onExitCinema) onExitCinema();
                        navigate(navTo);
                      }
                    }}
                    aria-label="Support"
                    className="w-full text-left px-2 py-1.5 text-[12px] flex items-center gap-2.5 text-muted-foreground/60 hover:text-foreground transition-colors rounded-md hover:bg-muted/10"
                    style={{ fontFamily: "var(--font-heading)" }}>
                    <HelpCircle className="w-4 h-4" />
                    Support
                  </button>
                  <button onClick={() => {
                      if (selectedPhoto) {
                        pendingExitActionRef.current = async () => { if (onExitCinema) onExitCinema(); await signOut(); navigate("/login"); };
                        fullViewGuardedExitRef.current?.();
                      } else {
                        if (onExitCinema) onExitCinema();
                        signOut().then(() => navigate("/login"));
                      }
                    }}
                    aria-label="Logout"
                    className="w-full text-left px-2 py-1.5 text-[12px] flex items-center gap-2.5 text-muted-foreground/60 hover:text-foreground transition-colors rounded-md hover:bg-muted/10"
                    style={{ fontFamily: "var(--font-heading)" }}>
                    <LogOut className="w-4 h-4" />
                    Logout
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ─── CENTER: PHOTO CANVAS / LIGHTBOX HOST ─── */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 relative overflow-hidden">
          {!selectedCompId ? (
            <CinemaDashboard
              competitions={competitions}
              selectedCompId={selectedCompId}
              setSelectedCompId={setSelectedCompId}
              setExpandedComp={setExpandedComp}
              setSidebarView={setSidebarView}
              setMobileTab={setMobileTab}
              rounds={rounds}
              currentRound={currentRound}
              totalEntries={selectedCompId ? totalEntries : (aggregateTotalPhotos ?? totalEntries)}
              markedEntries={selectedCompId ? markedEntries : (aggregateReviewedPhotos ?? markedEntries)}
              handleStartJudging={handleStartJudging}
              competitionProgress={competitionProgress}
            />
          ) : loadingEntries ? (
            <div className="flex-1 flex flex-col px-6 pt-6 pb-24">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="rounded-xl border border-border bg-card overflow-hidden animate-pulse">
                    <div className="aspect-[4/3] bg-muted/20" />
                    <div className="px-3 py-2.5 space-y-1.5">
                      <div className="h-3 bg-muted/20 rounded w-3/4" />
                      <div className="h-2.5 bg-muted/10 rounded w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : selectedEntry && selectedPhoto ? (
            /* ── SCREEN 3: FULL VIEW EVALUATION (FULLSCREEN LIGHTBOX) ── */
            <CinemaFullView
              userId={userId}
              isAdmin={isAdmin}
              selectedEntry={selectedEntry}
              selectedPhoto={selectedPhoto}
              selectedPhotoKey={selectedPhotoKey}
              selectedPhotoEvaluation={selectedPhotoEvaluation}
              setSelectedPhotoKey={setSelectedPhotoKey}
              availableTags={availableTags}
              roundMode={roundMode}
              isRoundLocked={isRoundLocked}
              lockedByOther={lockedByOther}
              scoringEntry={scoringEntry}
              taggingEntry={taggingEntry}
              handleQuickScore={handleQuickScore}
              toggleTag={toggleTag}
              feedbackInput={feedbackInput}
              setFeedbackInput={setFeedbackInput}
              commentInput={commentInput}
              setCommentInput={setCommentInput}
              addComment={addComment}
              photoComments={selectedPhotoEvaluation?.comments ?? []}
              activeRoundId={currentRound?.id ?? null}
              activePhotoIdx={activePhotoIdx}
              activePhotoList={activePhotoList}
              displayIdx={displayIdx}
              displayTotal={displayTotal}
              goNext={goNext}
              goPrev={goPrev}
              getPhotoKey={getPhotoKey}
              sidebarView={sidebarView}
              setSidebarView={setSidebarView}
              photoTagsMap={photoTagsMap}
              photoScoresMap={photoScoresMap}
              tagCountsMap={tagCountsMap}
              totalEntries={totalEntries}
              rejectedCount={rejectedCount}
              acceptedCount={acceptedCount}
              shortlistedCount={shortlistedCount}
              
              completedRoundsCount={completedRoundsCount}
              allPhotos={allPhotos}
              zoomLevel={zoomLevel}
              setZoomLevel={setZoomLevel}
              showNav={showNav}
              handleMouseMove={handleMouseMove}
              selectedCompId={selectedCompId}
              onTagCreated={props.onTagCreated}
              invalidateEntries={props.invalidateEntries}
              needsReviewCount={needsReviewCount}
              feedbackSavedSignal={props.feedbackSavedSignal}
              guardedExitRef={fullViewGuardedExitRef}
              onExitComplete={handleFullViewExitComplete}
              roundNumber={props.roundNumber}
              sowRoundLogic={props.sowRoundLogic}
              sowRound4Criteria={props.sowRound4Criteria}
              strictLockFlag={props.strictLockFlag}
              competitions={competitions}
              rounds={rounds}
              selectedRound={selectedRound}
              setSelectedRound={setSelectedRound}
              expandedComp={expandedComp}
              setExpandedComp={setExpandedComp}
              setSelectedCompId={setSelectedCompId}
              filterCounts={props.filterCounts}
              setMobileTab={setMobileTab}
              isViewOnly={props.isViewOnly}
              sessionElapsed={props.sessionElapsed}
              judgingStarted={props.judgingStarted}
              onSaveAndLeave={props.onSaveAndLeave}
              photoDecisionsMap={photoDecisionsMap}
              competitionPhase={selectedComp?.phase}
              competitionCurrentRound={(selectedComp as any)?.current_round ?? null}
              bookmarkedEntryId={props.bookmarkedEntryId ?? null}
              bookmarkedPhotoIndex={props.bookmarkedPhotoIndex ?? null}
              onBookmarkCurrentPhoto={props.onBookmarkEntry ? () => {
                const wasBookmarked = !!props.isCurrentEntryBookmarked;
                props.onBookmarkEntry?.();
                toast({
                  title: wasBookmarked ? "Bookmark removed" : "Photo bookmarked ✓",
                  description: wasBookmarked
                    ? "This photo is no longer your resume point."
                    : "You can resume from this photo later.",
                  duration: 2400,
                });
              } : undefined}
              isCurrentPhotoBookmarked={!!props.isCurrentEntryBookmarked}
            />
          ) : (
            /* ── GRID VIEW WITH RIGHT SIDEBAR ── */
            <div className="flex-1 flex min-h-0">
              {/* Main grid area */}
              <div className="flex-1 flex flex-col min-w-0">
                <div ref={gridScrollRef} className="flex-1 overflow-y-auto px-6 pt-6 pb-24" style={{ scrollbarGutter: "stable" }}>
                  {/* Competition title + view toggle */}
                  <div className="flex items-center justify-between mb-1">
                    <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "var(--font-display)" }}>
                      {selectedCompTitle}
                    </h1>
                    <div className="flex items-center gap-1 bg-muted/20 rounded-lg p-0.5">
                      <button
                        onClick={() => setGridLayout("grid")}
                        aria-label="Grid view"
                        className={`p-1.5 rounded-md transition-all ${gridLayout === "grid" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground/50 hover:text-foreground"}`}
                      >
                        <LayoutGrid className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setGridLayout("list")}
                        aria-label="List view"
                        className={`p-1.5 rounded-md transition-all ${gridLayout === "list" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground/50 hover:text-foreground"}`}
                      >
                        <List className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <p className="text-[13px] text-muted-foreground/60 mb-5" style={{ fontFamily: "var(--font-heading)" }}>
                    Filtering by: <span className="text-primary font-medium">
                      {sidebarView === "round" ? "All Photos" : sidebarView === "rejected" ? "Rejected" : sidebarView === "accepted" ? (props.roundNumber === 2 ? "Accepted in Round 2" : props.roundNumber === 3 ? "Accepted in Round 3" : "Passed Round 1") : sidebarView === "shortlisted" ? (props.roundNumber === 2 ? "Qualified for R3" : props.roundNumber === 3 ? "Shortlisted for Final" : "Shortlisted") : sidebarView === "needs_review" ? "Needs Review" : sidebarView === "completed" ? "Reviewed by You" : sidebarView.startsWith("shortlisted_tag_") ? availableTags.find(t => `shortlisted_tag_${t.id}` === sidebarView)?.label || "Tagged" : "All Photos"}
                    </span>{" · "}<span className="text-muted-foreground/40">{filteredPhotos.length} images</span>
                  </p>

                  {/* SOW: View-only banner during submission/voting phase */}
                  {props.isViewOnly && (
                    <div className="mb-4 px-4 py-3 rounded-xl border border-primary/30 bg-primary/5 flex items-center gap-3">
                      <AlertCircle className="h-4 w-4 text-primary shrink-0" />
                      <div>
                        <p className="text-[12px] font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                          {selectedComp?.phase === "voting" ? "Voting in Progress — View Only" : "Submissions Open — View Only"}
                        </p>
                        <p className="text-[10px] text-muted-foreground/60" style={{ fontFamily: "var(--font-heading)" }}>
                          You can preview submissions but judging will be enabled after voting ends.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Bulk actions */}
                  {bulkMode && (
                    <div className="mb-3">
                      <BulkActionsBar
                        selectedCount={bulkSelected.size}
                        roundMode={roundMode}
                        availableTags={availableTags}
                        onBulkScore={handleBulkScore}
                        onBulkTag={handleBulkTag}
                        onDeselectAll={() => setBulkSelected(new Set())}
                        isRoundLocked={isRoundLocked}
                      />
                    </div>
                  )}

                  {filteredPhotos.length === 0 ? (
                    <div className="flex items-center justify-center h-full min-h-[300px]">
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center">
                        <Camera className="h-12 w-12 text-muted-foreground/10 mx-auto mb-4" />
                        <p className="text-sm text-muted-foreground/40 mb-1" style={{ fontFamily: "var(--font-display)" }}>No images in this filter</p>
                        <p className="text-[11px] text-muted-foreground/25" style={{ fontFamily: "var(--font-heading)" }}>
                          {sidebarView === "rejected" ? "No entries in this bucket yet" :
                           sidebarView === "accepted" ? (props.roundNumber === 2 ? "No entries accepted in Round 2 yet" : props.roundNumber === 3 ? "No entries accepted in Round 3 yet" : "No entries have passed Round 1 yet") :
                           sidebarView === "shortlisted" ? "No entries in this bucket yet" :
                           sidebarView === "needs_review" ? "No entries need review" :
                           sidebarView === "completed" ? "You haven't reviewed any entries yet" :
                           "Try selecting a different filter"}
                        </p>
                        {sidebarView !== "round" && (
                          <button onClick={() => setSidebarView("round")} aria-label="Show all photos" className="mt-2 text-[10px] text-primary hover:text-primary/80" style={{ fontFamily: "var(--font-heading)" }}>
                            ← Show all
                          </button>
                        )}
                      </motion.div>
                    </div>
                  ) : (
                    <>
                      {gridLayout === "grid" ? (
                        <CinemaVirtualizedGrid
                          filteredPhotos={filteredPhotos}
                          getPhotoKey={getPhotoKey}
                          photoScoresMap={photoScoresMap}
                          photoTagsMap={photoTagsMap}
                          photoDecisionsMap={photoDecisionsMap}
                          availableTags={availableTags}
                          bulkMode={bulkMode}
                          bulkSelected={bulkSelected}
                          toggleBulkSelect={toggleBulkSelect}
                          setSelectedPhotoKey={setSelectedPhotoKey}
                          setMobileTab={setMobileTab}
                          isRoundLocked={isRoundLocked}
                          isViewOnly={props.isViewOnly}
                          judgingStarted={props.judgingStarted}
                          onStartPrompt={(key) => setStartPromptKey(key)}
                          roundNumber={props.roundNumber}
                          competitionPhase={selectedComp?.phase}
                          competitionCurrentRound={(selectedComp as any)?.current_round ?? null}
                          bookmarkedEntryId={props.bookmarkedEntryId ?? null}
                          bookmarkedPhotoIndex={props.bookmarkedPhotoIndex ?? null}
                          onToggleBookmark={props.onToggleBookmarkEntry}
                          lastViewedPhotoKey={lastViewedPhotoKey}
                        />
                      ) : (
                        <CinemaListView
                          filteredPhotos={filteredPhotos}
                          getPhotoKey={getPhotoKey}
                          photoScoresMap={photoScoresMap}
                          photoTagsMap={photoTagsMap}
                          photoDecisionsMap={photoDecisionsMap}
                          availableTags={availableTags}
                          bulkMode={bulkMode}
                          bulkSelected={bulkSelected}
                          toggleBulkSelect={toggleBulkSelect}
                          setSelectedPhotoKey={setSelectedPhotoKey}
                          setMobileTab={setMobileTab}
                          StatusBadge={CinemaStatusBadge}
                          isRoundLocked={isRoundLocked}
                          competitionPhase={selectedComp?.phase}
                          competitionCurrentRound={(selectedComp as any)?.current_round ?? null}
                          roundNumber={props.roundNumber}
                          bookmarkedEntryId={props.bookmarkedEntryId ?? null}
                          bookmarkedPhotoIndex={props.bookmarkedPhotoIndex ?? null}
                          onToggleBookmark={props.onToggleBookmarkEntry}
                        />
                      )}
                      {hasMoreEntries && (
                        <div className="flex justify-center py-6">
                          <motion.button
                            whileHover={{ scale: 1.03 }}
                            whileTap={{ scale: 0.97 }}
                            onClick={handleLoadMore}
                            disabled={loadingMore}
                            aria-label="Load more entries"
                            className="flex items-center gap-2 px-6 py-2.5 text-[10px] font-semibold tracking-wider uppercase rounded-lg border border-border bg-muted/10 hover:bg-muted/20 text-muted-foreground transition-all disabled:opacity-40"
                            style={{ fontFamily: "var(--font-heading)" }}
                          >
                            {loadingMore ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</> : <><ChevronDown className="h-3.5 w-3.5" /> Load More</>}
                          </motion.button>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Quick Score bar removed from grid — it was permanently disabled without a selected photo.
                     Scoring happens in Full View (click a photo to open). */}
              </div>

              {/* ─── RIGHT SIDEBAR: SESSION INFO ─── */}
              <div className="hidden lg:flex w-[260px] shrink-0 border-l border-border bg-card flex-col overflow-y-auto">
                <div className="p-5 space-y-6">
                  {/* Current Round Mode (read-only display) */}
                  <div>
                    <h4 className="text-[10px] font-bold tracking-[0.2em] uppercase text-muted-foreground/60 mb-3" style={{ fontFamily: "var(--font-heading)" }}>
                      Active Mode
                    </h4>
                    <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-primary/40 bg-primary/5">
                      <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                      <span className="text-[13px] font-semibold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                        {roundMode === "scoring" ? "Tag + Score (10 SOW criteria)" : "Tag-Only Decision"}
                      </span>
                    </div>
                    <p className="text-[9px] text-muted-foreground/40 mt-1.5 px-1" style={{ fontFamily: "var(--font-heading)" }}>
                      Mode is set by the active round
                    </p>
                  </div>

                  {/* Quick Stats */}
                  <div>
                    <h4 className="text-[10px] font-bold tracking-[0.2em] uppercase text-muted-foreground/60 mb-3" style={{ fontFamily: "var(--font-heading)" }}>
                      Session Progress
                    </h4>
                    <div className="space-y-2">
                      {[
                        { label: "Total", value: totalEntries, color: "text-foreground" },
                        { label: "Reviewed", value: markedEntries, color: "text-primary" },
                        { label: "Remaining", value: Math.max(0, totalEntries - markedEntries), color: "text-muted-foreground" },
                      ].map(s => (
                        <div key={s.label} className="flex items-center justify-between px-3 py-2 rounded-lg border border-border/50 bg-muted/5">
                          <span className="text-[11px] text-muted-foreground/70" style={{ fontFamily: "var(--font-heading)" }}>{s.label}</span>
                          <span className={`text-[14px] font-bold tabular-nums ${s.color}`} style={{ fontFamily: "var(--font-display)" }}>{s.value}</span>
                        </div>
                      ))}
                    </div>
                    {totalEntries > 0 && (
                      <div className="mt-2 px-1">
                        <div className="h-1.5 bg-muted/20 rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-primary transition-all duration-500"
                            style={{ width: `${Math.round((markedEntries / totalEntries) * 100)}%` }} />
                        </div>
                        <span className="text-[9px] text-muted-foreground/40 mt-1 block text-right" style={{ fontFamily: "var(--font-heading)" }}>
                          {Math.round((markedEntries / totalEntries) * 100)}% complete
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Available Tags — hidden in R1 per SOW. Click a tag to filter the grid to photos YOU tagged with it. */}
                  {availableTags.length > 0 && (props.roundNumber ?? 1) > 1 && (
                    <div>
                      <h4 className="text-[10px] font-bold tracking-[0.2em] uppercase text-muted-foreground/60 mb-3" style={{ fontFamily: "var(--font-heading)" }}>
                        Quality Tags
                      </h4>
                      <div className="space-y-1">
                        {availableTags.map(tag => {
                          const filterKey = `shortlisted_tag_${tag.id}` as const;
                          const isActive = sidebarView === filterKey;
                          const count = tagCountsMap[tag.id] ?? 0;
                          return (
                            <button
                              key={tag.id}
                              type="button"
                              onClick={() => setSidebarView(isActive ? "round" : filterKey)}
                              title={isActive ? "Clear filter" : `Show photos you tagged with "${tag.label}"`}
                              className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-[11px] transition-colors text-left ${
                                isActive
                                  ? "bg-primary/15 text-primary border border-primary/30"
                                  : "text-muted-foreground/70 border border-transparent hover:bg-muted/10 hover:text-foreground"
                              }`}
                              style={{ fontFamily: "var(--font-heading)" }}
                            >
                              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                              <span className="truncate flex-1">{tag.label}</span>
                              <span className={`text-[10px] tabular-nums shrink-0 px-1.5 py-0.5 rounded ${isActive ? "bg-primary/20 text-primary" : "bg-muted/30 text-muted-foreground/60"}`}>
                                {count}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      {sidebarView.startsWith("shortlisted_tag_") && (
                        <button
                          type="button"
                          onClick={() => setSidebarView("round")}
                          className="mt-2 w-full text-[9px] tracking-[0.15em] uppercase text-muted-foreground/60 hover:text-primary transition-colors text-center py-1"
                          style={{ fontFamily: "var(--font-heading)" }}
                        >
                          ✕ Clear tag filter
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Footer spacer — preserves the sidebar's bottom border/padding rhythm
                    after the redundant "Show All Photos" button was removed. */}
                <div className="mt-auto border-t border-border/40 px-4 py-4">
                  <p className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground/30 text-center" style={{ fontFamily: "var(--font-heading)" }}>
                    50mm Retina · Judge Panel
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

      </div>

      {/* Complete Round Confirmation */}
      {completeRoundConfirm && currentRound && selectedCompId && (
        <CompleteRoundDialog
          roundId={completeRoundConfirm}
          roundName={currentRound.name}
          competitionId={selectedCompId}
          roundNumber={currentRound.round_number}
          uiEligiblePhotos={(() => {
            // Build { entryId → photoIndex[] } from the judge's UI-side photo set
            // so the preflight RPC can compare it to the canonical DB eligibility.
            const map: Record<string, number[]> = {};
            for (const p of allPhotos) {
              (map[p.entryId] ??= []).push(p.photoIndex);
            }
            for (const k of Object.keys(map)) map[k].sort((a, b) => a - b);
            return map;
          })()}
          onConfirm={() => { handleCompleteRound(completeRoundConfirm); setCompleteRoundConfirm(null); }}
          onCancel={() => setCompleteRoundConfirm(null)}
        />
      )}

      {/* Judge Guide Modal */}
      <JudgeGuideModal open={showGuide} onClose={dismissGuide} />

      {/* Start Judging Prompt — shown when judge clicks image without starting */}
      <StartJudgingPrompt
        open={!!startPromptKey}
        roundName={currentRound?.name ?? "Round 1"}
        onStartJudging={() => {
          if (currentRound) handleStartJudging(currentRound.id);
          if (startPromptKey) { setSelectedPhotoKey(startPromptKey); setMobileTab("judge"); }
          setStartPromptKey(null);
        }}
        onViewOnly={() => {
          if (startPromptKey) { setSelectedPhotoKey(startPromptKey); setMobileTab("judge"); }
          setStartPromptKey(null);
          props.onSetViewOnly?.();
        }}
        onClose={() => setStartPromptKey(null)}
      />
    </main>
  );
};

export default CinemaJudgeView;
