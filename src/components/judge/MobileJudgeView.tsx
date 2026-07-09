import { useState, useCallback } from "react";
import StartJudgingPrompt from "@/components/judge/StartJudgingPrompt";
import LongPressButton from "@/components/judge/LongPressButton";
import PhaseWatermark from "@/components/competition/PhaseWatermark";
import { ChevronLeft, ChevronDown, Camera, Star, Zap, Tag, ChevronRight, Trophy, Send, Maximize2, BookmarkCheck } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import JudgingStampBadge from "@/components/JudgingStampBadge";
import JudgeProgressRing from "@/components/judge/JudgeProgressRing";
import UnsavedChangesDialog from "@/components/judge/UnsavedChangesDialog";
import TagDecisionPanel from "@/components/judge/TagDecisionPanel";
import RoundDecisionButtons from "@/components/judge/RoundDecisionButtons";
// Judging v5 (J-06): Round1/2/3 decision panels removed — tag-only decisions.
import { useUnsavedChangesGuard } from "@/hooks/judging/useUnsavedChangesGuard";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import type { CriteriaScores, PhotoEvaluation } from "@/hooks/judging/types";
import { getJudgePhotoTitle, SOW_ROUND4_CRITERIA_KEYS, SOW_ROUND4_CRITERIA_LABELS, DEFAULT_CRITERIA } from "@/hooks/judging/types";
import { toast } from "@/hooks/core/use-toast";

const f = { fontFamily: "var(--font-heading)" };

/** Score colors using CSS custom properties from index.css */
const SCORE_BG_STYLE: Record<number, React.CSSProperties> = Object.fromEntries(
  Array.from({ length: 11 }, (_, i) => [i, { backgroundColor: `hsl(var(--score-${i}))` }])
);

/* SOW-mandated 10 criteria — imported from types.ts (no local overrides) */
const CRITERIA_KEYS = SOW_ROUND4_CRITERIA_KEYS;
const CRITERIA_LABELS = SOW_ROUND4_CRITERIA_LABELS;

interface Competition { id: string; title: string; category: string; status: string; phase: string; entry_count?: number; }
interface JudgingTag { id: string; label: string; color: string; icon?: string | null; image_url?: string | null; visible_in_round?: number[]; }
interface FlatPhoto { entryId: string; photoUrl: string; photoThumbUrl: string; photoIndex: number; entry: any; }

interface Props {
  competitions: Competition[];
  selectedCompId: string | null;
  setSelectedCompId: (id: string | null) => void;
  filteredPhotos: FlatPhoto[];
  selectedPhotoKey: string | null;
  setSelectedPhotoKey: (key: string | null) => void;
  getPhotoKey: (p: FlatPhoto) => string;
  getPhotoEvaluation: (p: FlatPhoto) => PhotoEvaluation;
  selectedEntry: any;
  selectedPhoto: FlatPhoto | null;
  selectedPhotoEvaluation: PhotoEvaluation | null;
  handleQuickScore: (entryId: string, photoIndex: number, score: number, options?: { silent?: boolean; skipAdvance?: boolean; criteria?: CriteriaScores }) => void;
  toggleTag: (entryId: string, photoIndex: number, tagId: string) => void;
  availableTags: JudgingTag[];
  roundMode: "scoring" | "tagging" | "decision";
  goNext: () => void;
  goPrev: () => void;
  activePhotoIdx: number;
  activePhotoList: FlatPhoto[];
  totalEntries: number;
  markedEntries: number;
  setFullscreen: (v: boolean) => void;
  scoringEntry: string | null;
  feedbackInput: string;
  setFeedbackInput: (v: string) => void;
  commentInput: string;
  setCommentInput: (v: string) => void;
  addComment: (entryId: string, photoIndex: number) => void;
  lockedByOther?: boolean;
  isRoundLocked?: boolean;
  loadingEntries: boolean;
  expandedComp: string | null;
  setExpandedComp: (id: string | null) => void;
  rounds: { id: string; round_number: number; name: string; status: string }[];
  selectedRound: string | null;
  setSelectedRound: (id: string | null) => void;
  setSidebarView: (v: string) => void;
  // SOW parity props
  isR1DecisionMode?: boolean;
  // Judging v5 (J-06): handleDecision / handleR2Decision / handleR3Decision /
  // decisionPending props removed — decisions flow exclusively through tag clicks.
  roundNumber?: number;
  sowScoringRounds?: boolean;
  currentRound?: { id: string; round_number: number; name: string; status: string } | null;
  judgingStarted?: boolean;
  isViewOnly?: boolean;
  onStartJudging?: (roundId: string) => void;
  /** Bookmarked entry id (from judge_sessions.last_entry_id) — paired with bookmarkedPhotoIndex for per-photo highlight. */
  bookmarkedEntryId?: string | null;
  /** Bookmarked photo index within the bookmarked entry — only THAT photo gets the amber ring + pin. */
  bookmarkedPhotoIndex?: number | null;
  /** Long-press to toggle bookmark on a thumbnail (mobile-friendly). */
  onToggleBookmark?: (entryId: string, photoIndex: number) => void;
}

export default function MobileJudgeView({
  competitions, selectedCompId, setSelectedCompId, filteredPhotos,
  selectedPhotoKey, setSelectedPhotoKey, getPhotoKey, getPhotoEvaluation,
  selectedEntry, selectedPhoto, selectedPhotoEvaluation,
  handleQuickScore, toggleTag, availableTags, roundMode,
  goNext, goPrev, activePhotoIdx, activePhotoList,
  totalEntries, markedEntries, setFullscreen, scoringEntry,
  feedbackInput, setFeedbackInput, commentInput, setCommentInput,
  addComment, lockedByOther, isRoundLocked, loadingEntries,
  expandedComp, setExpandedComp, rounds, selectedRound, setSelectedRound, setSidebarView,
  isR1DecisionMode,
  roundNumber, sowScoringRounds,
  currentRound, judgingStarted, isViewOnly, onStartJudging,
  bookmarkedEntryId, bookmarkedPhotoIndex, onToggleBookmark,
}: Props) {
  const navigate = useNavigate();
  const [compDropdownOpen, setCompDropdownOpen] = useState(false);
  const [expandedPhotoKey, setExpandedPhotoKey] = useState<string | null>(null);
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [criteriaOpen, setCriteriaOpen] = useState(false);
  const [startPromptKey, setStartPromptKey] = useState<string | null>(null);
  const mobileGuard = useUnsavedChangesGuard();

  const selectedComp = competitions.find(c => c.id === selectedCompId);
  const activeRound = rounds.find(r => r.id === selectedRound);
  const isR2DecisionMode = roundNumber === 2;
  const isR3DecisionMode = roundNumber === 3;
  const isAnyDecisionMode = !!isR1DecisionMode || isR2DecisionMode || isR3DecisionMode;

  // Determine if 10-criteria should be shown (R2/R3/R4 when SOW flag on)
  const showCriteria = sowScoringRounds && roundNumber && roundNumber >= 2;

  // Filter tags by visible_in_round — STRICT: only tags mapped to current round
  const visibleTags = availableTags.filter(tag => {
    if (!roundNumber) return false;
    return Array.isArray(tag.visible_in_round) && tag.visible_in_round.includes(roundNumber);
  });

  const handleSelectComp = (compId: string) => {
    mobileGuard.guardAction(() => {
      setSelectedCompId(compId);
      setExpandedComp(compId);
      setCompDropdownOpen(false);
      const compRounds = rounds.filter(r => r.status === "active");
      if (compRounds.length > 0) {
        setSelectedRound(compRounds[0].id);
        setSidebarView("round");
      }
    });
  };

  const handlePhotoTap = (key: string) => {
    if (isViewOnly) {
      // In view-only, open photo directly for preview
      mobileGuard.guardAction(() => {
        if (expandedPhotoKey === key) {
          setExpandedPhotoKey(null);
        } else {
          setExpandedPhotoKey(key);
          setSelectedPhotoKey(key);
        }
      });
      return;
    }
    if (!judgingStarted) {
      // Show Start/View Only prompt instead of toast
      setStartPromptKey(key);
      return;
    }
    mobileGuard.guardAction(() => {
      if (expandedPhotoKey === key) {
        setExpandedPhotoKey(null);
      } else {
        setExpandedPhotoKey(key);
        setSelectedPhotoKey(key);
      }
    });
  };

  const displayIdx = activePhotoIdx >= 0 ? activePhotoIdx : 0;
  const displayTotal = activePhotoList.length;

  /** Inline 10-criteria editor for a photo */
  const CriteriaSliders = ({ photo, evaluation }: { photo: FlatPhoto; evaluation: PhotoEvaluation }) => {
    const [localCriteria, setLocalCriteria] = useState<CriteriaScores>(() => {
      const c = evaluation.criteria;
      return { ...DEFAULT_CRITERIA, ...c };
    });

    const handleCriteriaChange = (key: keyof CriteriaScores, val: number) => {
      setLocalCriteria(prev => ({ ...prev, [key]: val }));
      mobileGuard.markDirty();
    };

    const scoredKeys = CRITERIA_KEYS.filter(k => (localCriteria[k as keyof CriteriaScores] ?? 0) > 0);
    const avg = scoredKeys.length > 0
      ? Math.round(scoredKeys.reduce((sum, k) => sum + (localCriteria[k as keyof CriteriaScores] ?? 0), 0) / scoredKeys.length)
      : 0;

    const saveCriteria = () => {
      handleQuickScore(photo.entryId, photo.photoIndex, avg, { criteria: localCriteria });
      mobileGuard.markClean();
    };

    return (
      <div className="space-y-2">
        {/* Phase 10: min-h-[44px] for mobile touch target parity. */}
        <button
          onClick={() => setCriteriaOpen(!criteriaOpen)}
          aria-expanded={criteriaOpen}
          aria-label="Toggle 10-criteria evaluation panel"
          className="w-full flex items-center justify-between px-3 py-2 min-h-[44px] bg-muted/30 rounded-lg text-[10px] font-bold uppercase tracking-wider text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          style={f}
        >
          <span className="flex items-center gap-1.5">
            <Star className="h-3.5 w-3.5" /> 10-Criteria Evaluation
          </span>
          <div className="flex items-center gap-2">
            {avg > 0 && (
              <span className="px-1.5 py-0.5 rounded text-white text-[9px]" style={SCORE_BG_STYLE[Math.min(10, avg)]}>
                Avg: {avg}
              </span>
            )}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${criteriaOpen ? "rotate-180" : ""}`} />
          </div>
        </button>

        <AnimatePresence>
          {criteriaOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden space-y-2"
            >
              {/* Phase 10: each row ≥44px so slider thumb + number input are reachable on 390px viewport. */}
              {CRITERIA_KEYS.map(key => (
                <div key={key} className="flex items-center gap-2 px-1 min-h-[44px]">
                  <span className="text-[9px] text-muted-foreground w-16 shrink-0 truncate" style={f}>
                    {CRITERIA_LABELS[key]}
                  </span>
                  <Slider
                    min={0} max={10} step={1}
                    value={[localCriteria[key as keyof CriteriaScores] ?? 0]}
                    onValueChange={([v]) => handleCriteriaChange(key as keyof CriteriaScores, v)}
                    disabled={isRoundLocked}
                    aria-label={`${CRITERIA_LABELS[key]} score`}
                    className="flex-1"
                  />
                  <Input
                    type="number" min={0} max={10}
                    value={localCriteria[key as keyof CriteriaScores] ?? 0}
                    onChange={e => {
                      const v = Math.max(0, Math.min(10, Number(e.target.value) || 0));
                      handleCriteriaChange(key as keyof CriteriaScores, v);
                    }}
                    disabled={isRoundLocked}
                    aria-label={`${CRITERIA_LABELS[key]} numeric input`}
                    className="w-12 h-11 text-center text-xs px-1"
                  />
                </div>
              ))}
              <button
                onClick={saveCriteria}
                disabled={isRoundLocked}
                className="w-full min-h-[44px] py-3 bg-primary text-primary-foreground text-[11px] font-bold uppercase tracking-wider rounded-lg disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                style={f}
              >
                Save Score (Avg: {avg}/10)
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <div className="md:hidden flex flex-col min-h-screen bg-background">
      {/* ── Sticky Top Bar ── */}
      <div className="sticky top-0 z-40 bg-card/95 backdrop-blur-xl border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3">
          {/* Phase 10: 44×44 touch target for top back button. */}
          <button
            onClick={() => mobileGuard.guardAction(() => navigate("/dashboard"))}
            aria-label="Back to dashboard"
            className="min-h-[44px] min-w-[44px] -ml-2 flex items-center justify-center text-muted-foreground hover:text-primary transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none rounded-lg"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold" style={f}>Judge Panel</h1>
          </div>
          <div className="shrink-0">
            <JudgeProgressRing total={totalEntries} marked={markedEntries} size={48} strokeWidth={5} />
          </div>
        </div>

        {/* Competition Dropdown */}
        <div className="px-4 pb-3">
          <button
            onClick={() => setCompDropdownOpen(!compDropdownOpen)}
            className="w-full flex items-center justify-between px-3 py-2.5 bg-muted/30 border border-border rounded-lg text-sm transition-colors"
            style={{ fontFamily: "var(--font-body)" }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Trophy className="h-4 w-4 text-primary shrink-0" />
              <span className="truncate">{selectedComp?.title || "Select Competition"}</span>
            </div>
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${compDropdownOpen ? "rotate-180" : ""}`} />
          </button>

          <AnimatePresence>
            {compDropdownOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="overflow-hidden"
              >
                <div className="mt-1 bg-card border border-border rounded-lg shadow-lg max-h-[40vh] overflow-y-auto">
                  {competitions.length === 0 ? (
                    <p className="text-sm text-muted-foreground p-4 text-center">No competitions assigned</p>
                  ) : competitions.map(comp => (
                    <button
                      key={comp.id}
                      onClick={() => handleSelectComp(comp.id)}
                      className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors border-b border-border/30 last:border-0 ${
                        selectedCompId === comp.id ? "bg-primary/5 text-primary" : "hover:bg-muted/30"
                      }`}
                    >
                      <Trophy className="h-4 w-4 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{comp.title}</p>
                        <p className="text-[10px] text-muted-foreground">{comp.category} · {comp.phase || comp.status}</p>
                      </div>
                      {comp.entry_count != null && (
                        <span className="text-[10px] text-muted-foreground shrink-0">{comp.entry_count} entries</span>
                      )}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Round selector */}
        {selectedCompId && rounds.length > 0 && (
          <div className="flex items-center gap-1.5 px-4 pb-2 overflow-x-auto scrollbar-hide">
            {/* Phase 10: round chips now ≥44px tall with intrinsic min width for reliable tapping. */}
            {rounds.map(r => (
              <button
                key={r.id}
                onClick={() => mobileGuard.guardAction(() => { setSelectedRound(r.id); setSidebarView("round"); })}
                aria-label={`Select ${r.name}`}
                aria-pressed={selectedRound === r.id}
                className={`shrink-0 inline-flex items-center gap-1 px-4 min-h-[44px] rounded-full text-[11px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                  selectedRound === r.id
                    ? "bg-primary text-primary-foreground"
                    : r.status === "completed"
                    ? "bg-muted/50 text-muted-foreground"
                    : "bg-muted text-foreground"
                }`}
                style={f}
              >
                {r.name}
                {r.status === "active" && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />}
              </button>
            ))}
          </div>
        )}

        {selectedCompId && currentRound && (
          <div className="px-4 pb-3">
            {isViewOnly ? (
              <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-[10px] text-foreground" style={f}>
                {selectedComp?.phase === "voting" ? "Voting in progress — view only mode" : "Submissions open — view only mode"}
              </div>
            ) : !judgingStarted ? (
              <button
                onClick={() => onStartJudging?.(currentRound.id)}
                className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-primary text-primary-foreground text-[12px] font-bold uppercase tracking-[0.18em] shadow-lg animate-pulse hover:animate-none"
                style={f}
              >
                <Zap className="h-4 w-4" /> Begin Judging — {currentRound.name}
              </button>
            ) : null}
          </div>
        )}
      </div>

      {/* ── Start Judging Prompt (shown when tapping photo before starting) ── */}
      <StartJudgingPrompt
        open={!!startPromptKey}
        roundName={currentRound?.name ?? "Round"}
        onStartJudging={() => {
          if (currentRound) onStartJudging?.(currentRound.id);
          if (startPromptKey) {
            setExpandedPhotoKey(startPromptKey);
            setSelectedPhotoKey(startPromptKey);
          }
          setStartPromptKey(null);
        }}
        onViewOnly={() => {
          if (startPromptKey) {
            setExpandedPhotoKey(startPromptKey);
            setSelectedPhotoKey(startPromptKey);
          }
          setStartPromptKey(null);
        }}
        onClose={() => setStartPromptKey(null)}
      />

      {/* ── Photo Cards Feed ── */}
      <div className="flex-1 overflow-y-auto pb-20">
        {!selectedCompId ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center px-8">
              <Trophy className="h-12 w-12 text-muted-foreground/15 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground" style={{ fontFamily: "var(--font-display)" }}>Select a competition above</p>
            </div>
          </div>
        ) : loadingEntries ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredPhotos.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center px-8">
              <Camera className="h-10 w-10 text-muted-foreground/15 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">No photos to judge</p>
            </div>
          </div>
        ) : (
          <div className="px-3 py-3 space-y-2">
            <p className="text-[10px] text-muted-foreground px-1 mb-1" style={f}>
              {filteredPhotos.length} images · {isR1DecisionMode ? "Tap to decide" : "Tap to evaluate"}
            </p>

            {filteredPhotos.map((photo) => {
              const key = getPhotoKey(photo);
              const evaluation = getPhotoEvaluation(photo);
              const isExpanded = expandedPhotoKey === key;
              const hasScore = evaluation.score !== null;
              const hasDecision = !!evaluation.decision;
              const isBookmarked = !!bookmarkedEntryId && photo.entryId === bookmarkedEntryId && (bookmarkedPhotoIndex ?? 0) === (photo.photoIndex ?? 0);

              return (
                <motion.div
                  key={key}
                  layout
                  className={`bg-card border rounded-xl overflow-hidden shadow-sm ${
                    isBookmarked ? "border-amber-400 ring-2 ring-amber-400/40" : "border-border"
                  }`}
                >
                  {/* Card header: thumbnail + info. Long-press (500ms) to toggle bookmark on mobile. */}
                  <LongPressButton
                    onTap={() => handlePhotoTap(key)}
                    onLongPress={onToggleBookmark ? () => onToggleBookmark(photo.entryId, photo.photoIndex) : undefined}
                    className="w-full flex items-center gap-3 p-3 text-left transition-colors hover:bg-muted/20"
                  >
                    {/* SOW v2.1 Step 5: filmstrip thumb uses lightweight variant. */}
                    <div className="relative w-16 h-12 rounded-lg overflow-hidden shrink-0 border border-border/50">
                      {photo.photoThumbUrl ? (
                        <img src={photo.photoThumbUrl} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                      ) : (
                        <div className="w-full h-full bg-muted flex items-center justify-center">
                          <Camera className="h-4 w-4 text-muted-foreground/30" />
                        </div>
                      )}
                      {/* Step 20: judging-phase watermark (renders only when phase==="judging"). */}
                      {selectedComp?.phase && (
                        <PhaseWatermark
                          phase={selectedComp.phase}
                          currentRound={(selectedComp as any)?.current_round ?? null}
                          surface="cinema"
                        />
                      )}
                      {isBookmarked && (
                        <div
                          className="absolute -top-1 -left-1 w-5 h-5 rounded-full bg-amber-400 text-background flex items-center justify-center shadow-md ring-1 ring-background z-10"
                          title="Bookmarked"
                          aria-label="Bookmarked"
                        >
                          <BookmarkCheck className="h-3 w-3" />
                        </div>
                      )}
                      {isR1DecisionMode && hasDecision && (
                        <div className={`absolute -top-1 -right-1 w-5 h-5 rounded-full text-white text-[8px] font-bold flex items-center justify-center shadow ${
                          evaluation.decision === "round1_qualified" ? "bg-green-500"
                          : evaluation.decision === "rejected" ? "bg-red-500"
                          : evaluation.decision === "shortlisted" ? "bg-yellow-500"
                          : "bg-gray-500"
                        }`}>
                          {evaluation.decision === "round1_qualified" ? "A" : evaluation.decision === "rejected" ? "R" : evaluation.decision === "shortlisted" ? "S" : "N"}
                        </div>
                      )}
                      {isR2DecisionMode && hasDecision && (
                        <div className={`absolute -top-1 -right-1 w-5 h-5 rounded-full text-white text-[8px] font-bold flex items-center justify-center shadow ${
                          evaluation.decision === "qualified" ? "bg-green-500"
                          : evaluation.decision === "shortlist" || evaluation.decision === "shortlisted" ? "bg-yellow-500"
                          : "bg-gray-500"
                        }`}>
                          {evaluation.decision === "qualified" ? "Q" : evaluation.decision === "shortlist" || evaluation.decision === "shortlisted" ? "S" : "R"}
                        </div>
                      )}
                      {isR3DecisionMode && hasDecision && (
                        <div className={`absolute -top-1 -right-1 w-5 h-5 rounded-full text-white text-[8px] font-bold flex items-center justify-center shadow ${
                          evaluation.decision === "finalist" ? "bg-primary"
                          : evaluation.decision === "shortlist" || evaluation.decision === "shortlisted" ? "bg-yellow-500"
                          : "bg-gray-500"
                        }`}>
                          {evaluation.decision === "finalist" ? "F" : evaluation.decision === "shortlist" || evaluation.decision === "shortlisted" ? "S" : "R"}
                        </div>
                      )}
                      {!isR1DecisionMode && hasScore && (
                        <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full text-white text-[8px] font-bold flex items-center justify-center shadow"
                          style={SCORE_BG_STYLE[Math.min(10, Math.max(0, evaluation.score!))]}>
                          {evaluation.score}
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate" style={f}>
                        {getJudgePhotoTitle(photo as any)}
                      </p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {photo.entry.photographer_name || "Unknown"}
                      </p>
                    </div>

                    <div className="shrink-0 flex items-center gap-1.5">
                      {evaluation.tags.length > 0 && (
                        <div className="flex -space-x-1">
                          {evaluation.tags.slice(0, 2).map(tagId => {
                            const tag = visibleTags.find(t => t.id === tagId) || availableTags.find(t => t.id === tagId);
                            return tag ? (
                              <span key={tagId} className="w-4 h-4 rounded-full border-2 border-card" style={{ backgroundColor: tag.color }} />
                            ) : null;
                          })}
                        </div>
                      )}
                      <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                    </div>
                  </LongPressButton>

                  {/* Expanded: inline controls */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden border-t border-border/50"
                      >
                        {/* Large preview */}
                        <div className="relative aspect-[4/3] bg-black">
                          {photo.photoUrl && (
                            <img loading="lazy" decoding="async" src={photo.photoUrl} alt="" className="w-full h-full object-contain" />
                          )}
                          {/* Step 20: judging watermark on full preview. */}
                          {selectedComp?.phase && (
                            <PhaseWatermark
                              phase={selectedComp.phase}
                              currentRound={(selectedComp as any)?.current_round ?? null}
                              surface="lightbox"
                            />
                          )}
                          {/* Phase 10: expanded preview controls upgraded to 44×44 touch targets. */}
                          <button
                            onClick={() => setFullscreen(true)}
                            aria-label="Enter fullscreen"
                            className="absolute top-2 right-2 w-11 h-11 rounded-full bg-black/40 text-white flex items-center justify-center focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                          >
                            <Maximize2 className="h-4 w-4" />
                          </button>
                          <div className="absolute inset-y-0 left-0 flex items-center">
                            <button
                              onClick={(e) => { e.stopPropagation(); mobileGuard.guardAction(goPrev); }}
                              aria-label="Previous photo"
                              className="ml-1 w-11 h-11 rounded-full bg-black/30 text-white flex items-center justify-center focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                            >
                              <ChevronLeft className="h-5 w-5" />
                            </button>
                          </div>
                          <div className="absolute inset-y-0 right-0 flex items-center">
                            <button
                              onClick={(e) => { e.stopPropagation(); mobileGuard.guardAction(goNext); }}
                              aria-label="Next photo"
                              className="mr-1 w-11 h-11 rounded-full bg-black/30 text-white flex items-center justify-center focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                            >
                              <ChevronRight className="h-5 w-5" />
                            </button>
                          </div>
                          {evaluation.tags.length > 0 && (
                            <div className="absolute bottom-0 left-0 right-0 flex items-center gap-1 px-2 py-1.5 bg-gradient-to-t from-black/60 to-transparent">
                              {evaluation.tags.map(tagId => {
                                const tag = visibleTags.find(t => t.id === tagId) || availableTags.find(t => t.id === tagId);
                                return tag ? <JudgingStampBadge key={tagId} label={tag.label} color={tag.color} icon={tag.icon || "award"} imageUrl={tag.image_url} size="sm" /> : null;
                              })}
                            </div>
                          )}
                        </div>

                        {/* Controls */}
                        <div className="p-3 space-y-3">
                          {/* Spec v3: R1–R3 → decision buttons. R4 → tag chips. */}
                          {roundNumber && roundNumber < 4 && (
                            <RoundDecisionButtons
                              availableTags={availableTags}
                              roundNumber={roundNumber as 1 | 2 | 3}
                              currentTagIds={evaluation.tags ?? []}
                              onTagClick={(tagId) =>
                                toggleTag(photo.entryId, photo.photoIndex, tagId)
                              }
                              disabled={!!isRoundLocked || !!lockedByOther}
                            />
                          )}
                          {roundNumber === 4 && (
                            <TagDecisionPanel
                              availableTags={availableTags}
                              roundNumber={roundNumber}
                              currentTagIds={evaluation.tags ?? []}
                              onTagClick={(tagId) =>
                                toggleTag(photo.entryId, photo.photoIndex, tagId)
                              }
                              disabled={!!isRoundLocked || !!lockedByOther}
                            />
                          )}

                          {/* ── R2-R4: Scoring ── */}
                          {!isR1DecisionMode && roundMode === "scoring" && (
                            <>
                              {showCriteria ? (
                                <CriteriaSliders photo={photo} evaluation={evaluation} />
                              ) : (
                                <div>
                                  <span className="text-[9px] tracking-wider uppercase text-muted-foreground flex items-center gap-1 mb-1.5" style={f}>
                                    <Zap className="h-3 w-3" /> Your Rating
                                  </span>
                                  <div className="grid grid-cols-6 gap-2">
                                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => {
                                      const isActive = evaluation.score === n;
                                      return (
                                        <button
                                          key={n}
                                          onClick={() => handleQuickScore(photo.entryId, photo.photoIndex, n)}
                                          disabled={lockedByOther || scoringEntry === `${photo.entryId}::${photo.photoIndex}` || isRoundLocked}
                                          aria-label={`Score ${n}`}
                                          className={`min-h-[44px] min-w-[44px] flex items-center justify-center text-sm font-bold rounded-lg transition-all ${
                                            isActive ? "text-white scale-110 ring-2 ring-offset-1 ring-offset-background ring-current" : "bg-muted hover:bg-muted/80 text-foreground"
                                          } disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none`}
                                          style={isActive ? { ...f, ...(SCORE_BG_STYLE[n] || {}) } : f}
                                        >
                                          {n}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                              <input
                                type="text"
                                value={feedbackInput}
                                onChange={e => { if (e.target.value.length <= 500) { setFeedbackInput(e.target.value); mobileGuard.markDirty(); } }}
                                placeholder="Optional feedback..."
                                maxLength={500}
                                disabled={isRoundLocked}
                                className="w-full bg-transparent border border-border focus:border-primary outline-none px-3 py-2 text-xs rounded-lg disabled:opacity-40"
                                style={{ fontFamily: "var(--font-body)" }}
                              />
                            </>
                          )}

                          {/* ── Tags — Spec v3: R4 ONLY (Winner/Runner-Up/Top-N/etc). Hidden in R1–R3. ── */}
                          {!isR1DecisionMode && roundNumber === 4 && visibleTags.length > 0 && (
                            <div>
                              <span className="text-[9px] tracking-wider uppercase text-muted-foreground flex items-center gap-1 mb-1.5" style={f}>
                                <Tag className="h-3 w-3" /> Tags
                              </span>
                              <div className="flex flex-wrap gap-2">
                                {visibleTags.map(tag => {
                                  const isActive = evaluation.tags.includes(tag.id);
                                  return (
                                    <button
                                      key={tag.id}
                                      onClick={() => toggleTag(photo.entryId, photo.photoIndex, tag.id)}
                                      disabled={isRoundLocked}
                                      aria-pressed={isActive}
                                      aria-label={`Tag: ${tag.label}${isActive ? " (active)" : ""}`}
                                      className={`flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-full text-[10px] font-medium border transition-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                                        isActive ? "border-current shadow-sm" : "border-border text-muted-foreground hover:text-foreground"
                                      }`}
                                      style={isActive ? { color: tag.color, borderColor: tag.color, backgroundColor: `${tag.color}15` } : {}}
                                    >
                                      <span
                                        className="w-2.5 h-2.5 rounded-full"
                                        style={{ backgroundColor: isActive ? tag.color : "hsl(var(--muted-foreground) / 0.4)" }}
                                      />
                                      {tag.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* Comment + Clear */}
                          <div className="flex gap-1.5">
                            <input
                              type="text"
                              value={commentInput}
                              onChange={e => { setCommentInput(e.target.value); mobileGuard.markDirty(); }}
                              placeholder="Add note..."
                              maxLength={500}
                              onKeyDown={async e => {
                                if (e.key === "Enter" && commentInput.trim() && !commentSubmitting) {
                                  setCommentSubmitting(true);
                                  try { await addComment(photo.entryId, photo.photoIndex); setCommentInput(""); } catch { /* retain input */ } finally { setCommentSubmitting(false); }
                                }
                              }}
                              disabled={isRoundLocked}
                              className="flex-1 bg-transparent border border-border focus:border-primary outline-none px-3 py-2 text-xs rounded-lg disabled:opacity-40"
                              style={{ fontFamily: "var(--font-body)" }}
                            />
                            <button
                              onClick={async () => {
                                if (!commentInput.trim() || commentSubmitting) return;
                                setCommentSubmitting(true);
                                try { await addComment(photo.entryId, photo.photoIndex); setCommentInput(""); } catch { /* retain input */ } finally { setCommentSubmitting(false); }
                              }}
                              disabled={!commentInput.trim() || commentSubmitting}
                              className="px-2.5 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50"
                            >
                              <Send className="h-3.5 w-3.5" />
                            </button>
                          </div>

                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Sticky Bottom Action Bar ── */}
      {selectedCompId && selectedPhotoKey && selectedEntry && selectedPhoto && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-2xl border-t border-border safe-area-bottom">
          <div className="flex items-center justify-between px-4 py-3">
            <button onClick={() => mobileGuard.guardAction(goPrev)} disabled={activePhotoIdx <= 0} aria-label="Previous photo" className="px-4 py-2.5 min-h-[44px] rounded-lg bg-muted text-sm font-medium disabled:opacity-30 flex items-center gap-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" style={f}>
              <ChevronLeft className="h-4 w-4" /> Prev
            </button>
            <div className="text-center">
              <span className="text-[11px] text-muted-foreground tabular-nums block" style={f}>
                {displayIdx + 1} / {displayTotal}
              </span>
              {(isR1DecisionMode || isR2DecisionMode || isR3DecisionMode) && (
                <span
                  className={`text-[9px] font-bold uppercase tracking-wider ${
                    selectedPhotoEvaluation?.decision ? "text-primary" : "text-muted-foreground/50"
                  }`}
                  style={f}
                >
                  {selectedPhotoEvaluation?.decision ? "Tagged ✓" : "—"}
                </span>
              )}
              {!isR1DecisionMode && selectedPhotoEvaluation?.score !== null && selectedPhotoEvaluation?.score !== undefined && (
                <span
                  className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[9px] font-bold text-white"
                  style={SCORE_BG_STYLE[Math.min(10, Math.max(0, selectedPhotoEvaluation.score))]}
                >
                  {selectedPhotoEvaluation.score}
                </span>
              )}
            </div>
            <button onClick={() => mobileGuard.guardAction(goNext)} disabled={activePhotoIdx >= activePhotoList.length - 1} aria-label="Next photo" className="px-4 py-2.5 min-h-[44px] rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-30 flex items-center gap-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" style={f}>
              Next <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
      <UnsavedChangesDialog
        open={mobileGuard.showConfirm}
        onDiscard={mobileGuard.confirmDiscard}
        onStay={mobileGuard.cancelDiscard}
      />
    </div>
  );
}
