import { memo, useState, useMemo, useCallback } from "react";
import {
  Trophy, ChevronDown, ChevronUp, CheckCircle, Lock,
  Layers, ShieldCheck, Zap, Eye, Tag as TagIcon,
  ThumbsUp, Star, AlertCircle, ThumbsDown, ArrowUpRight, Award, Pause,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { Competition, JudgingRound, SidebarView, JudgingTag } from "@/hooks/judging/types";
import { useT } from "@/i18n/I18nContext";

const f = { fontFamily: "var(--font-heading)" };

interface CompetitionWithCover extends Competition { cover_image_url?: string; }

/**
 * RoundFilterCounts — kept for backward compatibility with the bottom
 * Total/Passed/Out/Review summary strip and parent prop typing. The
 * per-tag counts now come from `tagCountsMap` (live, admin-defined).
 */
export interface RoundFilterCounts {
  accepted: number;
  shortlisted: number;
  needsReview: number;
  rejected: number;
  qualified: number;
  finalist: number;
  winner: number;
  runner_up_1: number;
  runner_up_2: number;
  honorary_mention: number;
  special_jury: number;
  unjudged: number;
  total: number;
}

interface JudgeRoundSidebarProps {
  competitions: CompetitionWithCover[];
  selectedCompId: string | null;
  setSelectedCompId: (id: string | null) => void;
  expandedComp: string | null;
  setExpandedComp: (id: string | null) => void;
  rounds: JudgingRound[];
  selectedRound: string | null;
  setSelectedRound: (id: string | null) => void;
  sidebarView: SidebarView;
  setSidebarView: (v: SidebarView) => void;
  setSelectedPhotoKey: (k: string | null) => void;
  filterCounts: RoundFilterCounts;
  /** All admin-defined tags currently active for the competition (single source of truth). */
  availableTags: JudgingTag[];
  /** Live count of photos carrying each tag id (judge's own evaluation). */
  tagCountsMap: Record<string, number>;
  setMobileTab?: (tab: "comps" | "photos" | "judge") => void;
  onCinemaMode?: () => void;
}

/* ─── Step 10: extracted memo'd row components ─── */

interface CompetitionRowProps {
  comp: CompetitionWithCover;
  isSelected: boolean;
  onToggle: (id: string) => void;
}
const CompetitionRow = memo(({ comp, isSelected, onToggle }: CompetitionRowProps) => (
  <button
    onClick={() => onToggle(comp.id)}
    className={`w-full text-left px-2 py-2 rounded-md transition-all duration-200 flex items-center gap-2 group mb-1 ${
      isSelected ? "bg-primary/10 text-primary" : "hover:bg-muted/40 text-foreground"
    }`}
  >
    <Trophy className="h-3.5 w-3.5 shrink-0" />
    <span className="text-[11px] font-medium truncate flex-1" style={f} title={comp.title}>{comp.title}</span>
  </button>
));
CompetitionRow.displayName = "CompetitionRow";

interface SubBucketProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count: number;
  view: SidebarView;
  current: SidebarView;
  onClick: (view: SidebarView) => void;
  colorClass?: string;
}
const SubBucket = memo(({ icon: Icon, label, count, view, current, onClick, colorClass }: SubBucketProps) => {
  const isActive = current === view;
  return (
    <button
      onClick={() => onClick(view)}
      className={`w-full text-left px-2 py-1.5 rounded-md text-[10px] flex items-center gap-2 transition-all ${
        isActive ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
      }`}
      style={f}
      title={label}
    >
      <Icon className={`h-3 w-3 shrink-0 ${isActive ? "" : colorClass ?? ""}`} />
      <span className="flex-1 truncate">{label}</span>
      <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-medium ${
        count > 0 ? "bg-muted" : "bg-transparent text-muted-foreground/40"
      }`}>{count}</span>
    </button>
  );
});
SubBucket.displayName = "SubBucket";

interface RoundRowProps {
  round: JudgingRound;
  isLocked: boolean;
  isExpanded: boolean;
  isSelectedRound: boolean;
  isActive: boolean;
  isCompleted: boolean;
  isPending: boolean;
  sidebarView: SidebarView;
  /** Counts (used only for the round-level "All Entries" total + summary strip). */
  counts: RoundFilterCounts | null;
  /** Admin-defined tags applicable to this round (already filtered by visible_in_round). */
  roundTags: JudgingTag[];
  /** Live per-tag count map (id -> count). */
  tagCountsMap: Record<string, number>;
  /** Count of photos this judge hasn't evaluated yet, for the structural Unjudged bucket. */
  unjudgedCount: number;
  onRoundClick: (round: JudgingRound) => void;
  onSubmenuClick: (view: SidebarView) => void;
}
const RoundRow = memo(({
  round, isLocked, isExpanded, isSelectedRound, isActive, isCompleted, isPending,
  sidebarView, counts, roundTags, tagCountsMap, unjudgedCount, onRoundClick, onSubmenuClick,
}: RoundRowProps) => {
  const t = useT();
  return (
    <div className="mb-1">
      <button
        onClick={() => !isLocked && onRoundClick(round)}
        disabled={!!isLocked}
        className={`w-full text-left px-2.5 py-2 rounded-lg text-[11px] flex items-center gap-2 transition-all duration-200 ${
          isLocked
            ? "opacity-40 cursor-not-allowed text-muted-foreground"
            : isSelectedRound && sidebarView === "round"
            ? "bg-primary/15 text-primary font-semibold shadow-sm"
            : isSelectedRound
            ? "bg-primary/8 text-primary font-medium"
            : isCompleted
            ? "text-muted-foreground hover:bg-muted/40"
            : "text-foreground hover:bg-muted/40"
        }`}
        style={f}
      >
        {isActive && <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />}
        {isCompleted && <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}
        {isLocked && <Lock className="h-3.5 w-3.5 shrink-0 opacity-50" />}
        {isPending && !isLocked && <span className="w-2 h-2 rounded-full bg-muted-foreground/30 shrink-0" />}

        <span className="flex-1 truncate">{round.name}</span>

        {isSelectedRound && counts && (
          <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">
            {counts.total}
          </span>
        )}

        {!isLocked && (
          isExpanded
            ? <ChevronUp className="h-3 w-3 shrink-0 text-muted-foreground" />
            : <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
      </button>

      <AnimatePresence>
        {isExpanded && !isLocked && isSelectedRound && counts && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="ml-3 pl-2.5 border-l-2 border-primary/20 space-y-0.5 py-1.5">
              {/* All Entries — always visible */}
              <button
                onClick={() => onSubmenuClick("round")}
                className={`w-full text-left px-2 py-1.5 rounded-md text-[10px] flex items-center gap-2 transition-all ${
                  sidebarView === "round" ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                }`}
                style={f}
              >
                <Eye className="h-3 w-3 shrink-0" />
                <span className="flex-1">All Entries</span>
                <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-muted font-medium">{counts.total}</span>
              </button>

              {/* Round-aware buckets per Spec v3 */}
              {round.round_number === 1 && (
                <>
                  <SubBucket icon={ThumbsUp} label="Accept" count={counts.accepted} view="accepted" current={sidebarView} onClick={onSubmenuClick} colorClass="text-emerald-500" />
                  <SubBucket icon={Star} label="Shortlist for R2" count={counts.shortlisted} view="shortlisted" current={sidebarView} onClick={onSubmenuClick} colorClass="text-amber-500" />
                  <SubBucket icon={AlertCircle} label="Needs Review" count={counts.needsReview} view="needs_review" current={sidebarView} onClick={onSubmenuClick} colorClass="text-orange-500" />
                  <SubBucket icon={ThumbsDown} label="Reject" count={counts.rejected} view="rejected" current={sidebarView} onClick={onSubmenuClick} colorClass="text-red-500" />
                </>
              )}

              {round.round_number === 2 && (
                <>
                  {/* Master Key v2 §2: R2 has exactly 2 stage_keys (r2_accepted, r2_qualified_r3).
                      §5: r2_not_selected is a RETIRED key — derived label only, no bucket. */}
                  <SubBucket icon={ThumbsUp} label="Accepted in Round 2" count={counts.accepted} view="accepted" current={sidebarView} onClick={onSubmenuClick} colorClass="text-emerald-500" />
                  <SubBucket icon={ArrowUpRight} label="Qualified for R3" count={counts.shortlisted} view="shortlisted" current={sidebarView} onClick={onSubmenuClick} colorClass="text-emerald-400" />
                </>
              )}

              {round.round_number === 3 && (
                <>
                  {/* Master Key v2 §2: R3 has exactly 2 stage_keys (r3_accepted, r3_qualified_final).
                      §5: r3_not_selected is a RETIRED key — derived label only, no bucket. */}
                  <SubBucket icon={ThumbsUp} label="Accepted in Round 3" count={counts.accepted} view="accepted" current={sidebarView} onClick={onSubmenuClick} colorClass="text-emerald-500" />
                  <SubBucket icon={Award} label="Shortlisted for Final" count={counts.shortlisted} view="shortlisted" current={sidebarView} onClick={onSubmenuClick} colorClass="text-amber-500" />
                </>
              )}

              {round.round_number === 4 && (
                roundTags.length === 0 ? (
                  <div className="px-2 py-2 text-[9px] text-muted-foreground/50 italic" style={f}>
                    {t("jg.noTagsRound4")}
                  </div>
                ) : (
                  roundTags.map((tag) => {
                    const view = `shortlisted_tag_${tag.id}` as SidebarView;
                    const count = tagCountsMap[tag.id] ?? 0;
                    const isActiveView = sidebarView === view;
                    return (
                      <button
                        key={tag.id}
                        onClick={() => onSubmenuClick(view)}
                        className={`w-full text-left px-2 py-1.5 rounded-md text-[10px] flex items-center gap-2 transition-all ${
                          isActiveView ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                        }`}
                        style={f}
                        title={tag.label}
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0 border border-border/40"
                          style={{ backgroundColor: tag.color || "hsl(var(--muted-foreground))" }}
                        />
                        <span className="flex-1 truncate">{tag.label}</span>
                        <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-medium ${
                          count > 0 ? "bg-muted" : "bg-transparent text-muted-foreground/40"
                        }`}>{count}</span>
                      </button>
                    );
                  })
                )
              )}

              {/* Unjudged — always last, structural workflow filter */}
              <button
                onClick={() => onSubmenuClick("unjudged")}
                className={`w-full text-left px-2 py-1.5 rounded-md text-[10px] flex items-center gap-2 transition-all mt-1 border-t border-border/20 pt-2 ${
                  sidebarView === "unjudged" ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                }`}
                style={f}
              >
                <TagIcon className="h-3 w-3 shrink-0 opacity-50" />
                <span className="flex-1">Unjudged</span>
                <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-medium ${
                  unjudgedCount > 0 ? "bg-muted" : "bg-transparent text-muted-foreground/40"
                }`}>{unjudgedCount}</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
RoundRow.displayName = "RoundRow";

/* ─── Main sidebar ─── */

const JudgeRoundSidebar = memo(({
  competitions, selectedCompId, setSelectedCompId, expandedComp: _expandedComp, setExpandedComp: _setExpandedComp,
  rounds, selectedRound, setSelectedRound, sidebarView, setSidebarView, setSelectedPhotoKey,
  filterCounts, availableTags, tagCountsMap, setMobileTab, onCinemaMode,
}: JudgeRoundSidebarProps) => {
  const t = useT();
  const [expandedRound, setExpandedRound] = useState<string | null>(null);

  const activeRound = useMemo(() => rounds.find(r => r.status === "active"), [rounds]);
  const effectiveExpandedRound = expandedRound ?? activeRound?.id ?? null;

  // Stable callbacks so memoized rows don't re-render when parent re-renders.
  const handleCompToggle = useCallback((id: string) => {
    if (selectedCompId === id) { setSelectedCompId(null); }
    else { setSelectedCompId(id); setMobileTab?.("photos"); }
  }, [selectedCompId, setSelectedCompId, setMobileTab]);

  const handleRoundClick = useCallback((round: JudgingRound) => {
    setSelectedRound(round.id);
    setSidebarView("round");
    setSelectedPhotoKey(null);
    setExpandedRound((prev) => {
      const eff = prev ?? activeRound?.id ?? null;
      return eff === round.id ? null : round.id;
    });
  }, [setSelectedRound, setSidebarView, setSelectedPhotoKey, activeRound?.id]);

  const handleSubmenuClick = useCallback((view: SidebarView) => {
    setSidebarView(view);
    setSelectedPhotoKey(null);
  }, [setSidebarView, setSelectedPhotoKey]);

  return (
    <div className="w-48 xl:w-56 shrink-0 border-r border-border flex flex-col bg-muted/20 overflow-hidden" style={{ scrollbarGutter: "stable" }}>
      <div className="px-3 py-2.5 border-b border-border bg-muted/40">
        <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground flex items-center gap-1.5" style={f}>
          <ShieldCheck className="h-3.5 w-3.5 text-primary" /> Judge Panel
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-2 py-2">
          <span className="text-[8px] tracking-[0.25em] uppercase text-muted-foreground/70 px-1 mb-1 block" style={f}>Competition</span>
          {competitions.length === 0 ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-6 px-2">
              <Layers className="h-8 w-8 text-muted-foreground/15 mx-auto mb-2" />
              <p className="text-[11px] text-muted-foreground mb-1" style={f}>No competitions assigned</p>
            </motion.div>
          ) : (
            competitions.map((comp) => (
              <CompetitionRow
                key={comp.id}
                comp={comp}
                isSelected={selectedCompId === comp.id}
                onToggle={handleCompToggle}
              />
            ))
          )}
        </div>

        {selectedCompId && rounds.length > 0 && (
          <div className="px-2 py-2 border-t border-border/50">
            <span className="text-[8px] tracking-[0.25em] uppercase text-muted-foreground/70 px-1 mb-1.5 block" style={f}>Rounds</span>

            {rounds.map((round) => {
              const isActive = round.status === "active";
              const isCompleted = round.status === "completed";
              const isPending = round.status === "pending";
              const isExpanded = effectiveExpandedRound === round.id;
              const isSelectedRound = selectedRound === round.id;
              const isLocked = isPending && !!activeRound && round.round_number > activeRound.round_number;

              // Filter admin-defined tags to the ones the admin mapped to this round number.
              const roundTags = isSelectedRound
                ? availableTags.filter(t => Array.isArray(t.visible_in_round) && t.visible_in_round.includes(round.round_number))
                : [];

              return (
                <RoundRow
                  key={round.id}
                  round={round}
                  isLocked={isLocked}
                  isExpanded={isExpanded}
                  isSelectedRound={isSelectedRound}
                  isActive={isActive}
                  isCompleted={isCompleted}
                  isPending={isPending}
                  sidebarView={sidebarView}
                  counts={isSelectedRound ? filterCounts : null}
                  roundTags={roundTags}
                  tagCountsMap={tagCountsMap}
                  unjudgedCount={filterCounts.unjudged}
                  onRoundClick={handleRoundClick}
                  onSubmenuClick={handleSubmenuClick}
                />
              );
            })}
          </div>
        )}

        {selectedCompId && onCinemaMode && (
          <div className="px-2 py-2 border-t border-border/50">
            <button
              onClick={onCinemaMode}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-[10px] bg-primary/10 text-primary hover:bg-primary/15 transition-all"
              style={f}
            >
              <Zap className="h-3.5 w-3.5" />
              <span className="font-medium">Cinema Mode</span>
            </button>
          </div>
        )}
      </div>

      {selectedCompId && selectedRound && (
        <div className="border-t border-border bg-muted/40 px-3 py-2.5">
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[7px] uppercase tracking-wider text-muted-foreground/70" style={f}>Total</span>
              <span className="text-[9px] font-bold text-foreground" style={f}>{filterCounts.total}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[7px] uppercase tracking-wider text-emerald-500/70" style={f}>Tagged</span>
              <span className="text-[9px] font-bold text-emerald-500" style={f}>{filterCounts.total - filterCounts.unjudged}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[7px] uppercase tracking-wider text-amber-500/70" style={f}>Unjudged</span>
              <span className="text-[9px] font-bold text-amber-500" style={f}>{filterCounts.unjudged}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[7px] uppercase tracking-wider text-primary/70" style={f}>Tags</span>
              <span className="text-[9px] font-bold text-primary" style={f}>{availableTags.filter(t => Array.isArray(t.visible_in_round) && rounds.find(r => r.id === selectedRound)?.round_number !== undefined && t.visible_in_round.includes(rounds.find(r => r.id === selectedRound)!.round_number)).length}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

JudgeRoundSidebar.displayName = "JudgeRoundSidebar";
export default JudgeRoundSidebar;
