import { memo } from "react";
import { motion } from "framer-motion";
import {
  Camera, ChevronRight, Sparkles,
} from "lucide-react";
import type { Competition, JudgingRound } from "@/hooks/judging/types";
import { useT } from "@/i18n/I18nContext";

interface CompetitionWithCover extends Competition {
  cover_image_url?: string;
}

interface CinemaDashboardProps {
  competitions: CompetitionWithCover[];
  selectedCompId: string | null;
  setSelectedCompId: (id: string) => void;
  setExpandedComp: (id: string) => void;
  setSidebarView: (v: string) => void;
  setMobileTab: (tab: "comps" | "photos" | "judge") => void;
  rounds: JudgingRound[];
  currentRound: JudgingRound | null;
  totalEntries: number;
  markedEntries: number;
  handleStartJudging: (roundId: string) => void;
  /** Real per-competition progress data keyed by competition ID */
  competitionProgress?: Record<string, { roundLabel: string; progressPct: number }>;
}

const f = { fontFamily: "var(--font-heading)" };
const fd = { fontFamily: "var(--font-display)" };

/* ── Secondary competition card ── */
const CompCard = memo(({
  title, description, icon, roundLabel, progressPct, onClick,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  roundLabel: string;
  progressPct: string;
  onClick: () => void;
}) => (
  <motion.div
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.35 }}
    onClick={onClick}
    className="rounded-xl border border-border/60 bg-card/80 p-5 cursor-pointer hover:bg-card hover:border-border transition-all group flex flex-col justify-between"
  >
    <div className="flex items-start justify-between mb-4">
      <div className="w-8 h-8 rounded-lg bg-muted/20 flex items-center justify-center">
        {icon}
      </div>
      <span className="text-[10px] text-muted-foreground/50 tracking-wide" style={f}>{roundLabel}</span>
    </div>
    <h3 className="text-[15px] font-bold text-foreground mb-1.5 leading-snug" style={fd}>{title}</h3>
    <p className="text-[11px] text-muted-foreground/60 mb-5 leading-relaxed line-clamp-2" style={f}>
      {description}
    </p>
    <div className="flex items-center justify-between">
      <span className="text-[12px] text-muted-foreground/70 font-medium" style={f}>{progressPct}</span>
      <div className="w-7 h-7 rounded-full bg-muted/10 flex items-center justify-center group-hover:bg-muted/20 transition-colors">
        <ChevronRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-muted-foreground/70 transition-colors" />
      </div>
    </div>
  </motion.div>
));
CompCard.displayName = "CompCard";

/* JoinCard removed — no invitation system exists */

/* ── Upcoming round sidebar card ── */
const UpcomingCard = memo(({
  comp, actionLabel, dateLabel, onClick,
}: {
  comp: CompetitionWithCover;
  actionLabel: string;
  dateLabel: string;
  onClick: () => void;
}) => {
  const t = useT();
  return (
  <div
    className="rounded-xl border border-border/60 bg-card/80 overflow-hidden cursor-pointer hover:border-border transition-all"
    onClick={onClick}
  >
    {/* Cover image */}
    <div className="h-44 bg-gradient-to-br from-primary/10 to-background overflow-hidden relative">
      {comp.cover_image_url ? (
        <img src={comp.cover_image_url} alt="" className="w-full h-full object-cover opacity-60" loading="lazy" />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/15 via-background to-background">
          <Camera className="w-10 h-10 text-muted-foreground/10" />
        </div>
      )}
    </div>

    {/* Info */}
    <div className="p-5 space-y-3.5">
      <span className="text-[9px] tracking-[0.2em] uppercase text-primary/80 font-semibold block" style={f}>
        {t("jg.upcomingRound")}
      </span>
      <h3 className="text-[15px] font-bold text-foreground leading-snug" style={fd}>
        {comp.title}
      </h3>
    <div className="flex items-center justify-between text-[11px] text-muted-foreground/60" style={f}>
      <span>{actionLabel}</span>
      <span className="font-bold text-foreground/70 tabular-nums">{dateLabel}</span>
    </div>
    </div>
  </div>
  );
});
UpcomingCard.displayName = "UpcomingCard";

/* ── Stat item ── */
const StatItem = memo(({ label, value, sub, accent }: {
  label: string; value: string; sub?: string; accent?: boolean;
}) => (
  <div className="rounded-xl border border-border/50 bg-card/50 px-5 py-4">
    <span className="text-[8px] tracking-[0.2em] uppercase text-muted-foreground/40 block mb-3" style={f}>
      {label}
    </span>
    <div className="flex items-baseline gap-0.5">
      <span
        className={`text-[28px] font-bold tabular-nums leading-none ${accent ? "text-primary" : "text-foreground"}`}
        style={fd}
      >
        {value}
      </span>
      {sub && (
        <span className="text-[14px] text-muted-foreground/50 font-medium" style={f}>{sub}</span>
      )}
    </div>
  </div>
));
StatItem.displayName = "StatItem";

/* ══════════════════════════════════════════════════════════════════
   MAIN DASHBOARD
   ══════════════════════════════════════════════════════════════════ */
const CinemaDashboard = memo(({
  competitions,
  selectedCompId,
  setSelectedCompId,
  setExpandedComp,
  setSidebarView,
  setMobileTab,
  rounds,
  currentRound,
  totalEntries,
  markedEntries,
  handleStartJudging,
  competitionProgress,
}: CinemaDashboardProps) => {
  const t = useT();
  const activeComps = competitions.filter(c => ["submission_open", "voting", "judging"].includes(c.phase));
  const resultComps = competitions.filter(c => c.phase === "result");
  const heroComp = activeComps[0];
  const completionPct = totalEntries > 0 ? Math.round((markedEntries / totalEntries) * 100) : 0;

  const selectComp = (comp: CompetitionWithCover) => {
    setSelectedCompId(comp.id);
    setExpandedComp(comp.id);
    setSidebarView("round");
    setMobileTab("photos");
  };

  // J-07: Phase-aware concrete round dates (replaces vague "Starting soon").
  // Returns { label, date } so the card surfaces both the action ("Voting
  // closes" / "Submissions close" / "Judging ends" / "Starts") and an
  // absolute, locale-formatted calendar date the judge can plan against.
  const getRoundDateLabel = (comp: CompetitionWithCover): { label: string; date: string } => {
    const fmt = (iso: string) => {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return "TBA";
      const datePart = d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
      const diffMs = d.getTime() - Date.now();
      const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      if (days < 0) return datePart; // already past — just show the date
      if (days === 0) return `${datePart} · today`;
      if (days === 1) return `${datePart} · tomorrow`;
      if (days <= 14) return `${datePart} · in ${days} days`;
      return datePart;
    };

    switch (comp.phase) {
      case "judging":
        return { label: "Judging ends", date: fmt(comp.voting_ends_at || comp.ends_at) };
      case "voting":
        return { label: "Voting closes", date: fmt(comp.voting_ends_at || comp.ends_at) };
      case "submission_open":
        return { label: "Submissions close", date: fmt(comp.ends_at) };
      case "result":
        return { label: "Results published", date: fmt(comp.voting_ends_at || comp.ends_at) };
      default:
        return { label: "Starts", date: fmt(comp.ends_at) };
    }
  };

  const formattedMarked = String(markedEntries).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const stats = [
    { label: "Total Photos Reviewed", value: formattedMarked },
    { label: "Entries Pending", value: totalEntries > 0 ? String(totalEntries - markedEntries).replace(/\B(?=(\d{3})+(?!\d))/g, ",") : "0" },
    { label: "Completion Rate", value: completionPct > 0 ? `${completionPct}%` : "0%", accent: completionPct >= 80 },
    { label: "Competitions Assigned", value: String(competitions.length), accent: true },
  ];

  return (
    <div className="flex-1 overflow-y-auto scrollbar-hide bg-background">
      <div className="p-6 lg:p-8 max-w-[1400px] mx-auto">
        {/* ── Header ── */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-8"
        >
          <h1 className="text-[36px] lg:text-[42px] font-bold text-foreground tracking-tight leading-none" style={fd}>
            {t("jg.activeComps")}
          </h1>
          <p className="text-[14px] text-muted-foreground/60 mt-2 leading-relaxed" style={f}>
            {t("jg.manageAssignments")}
          </p>
        </motion.div>

        {/* ── Empty state ── */}
        {competitions.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex items-center justify-center h-[50vh]"
          >
            <div className="text-center">
              <Camera className="h-14 w-14 text-muted-foreground/10 mx-auto mb-4" />
              <p className="text-base text-muted-foreground/30" style={fd}>No active assignments</p>
              <p className="text-xs text-muted-foreground/20 mt-1" style={f}>Check back later for new judging assignments.</p>
            </div>
          </motion.div>
        ) : (
          <div className="flex gap-6">
            {/* ── Main column ── */}
            <div className="flex-1 min-w-0 space-y-6">

              {/* Bento grid: hero (2x2) + secondary (1x1) — square cards on desktop */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 auto-rows-fr gap-4">
                {/* Hero — large 2x2 square */}
                {heroComp && (
                  <motion.div
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.45, delay: 0.05 }}
                    className="relative rounded-2xl overflow-hidden border border-border/60 bg-card group cursor-pointer sm:col-span-2 sm:row-span-2 sm:aspect-square flex flex-col"
                    onClick={() => selectComp(heroComp)}
                  >
                    {/* Cover image area */}
                    <div className="relative flex-1 min-h-0 overflow-hidden">
                      {heroComp.cover_image_url ? (
                        <img
                          src={heroComp.cover_image_url}
                          alt=""
                          className="w-full h-full object-cover opacity-50 group-hover:opacity-60 transition-opacity duration-500 scale-105 group-hover:scale-100"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-primary/10 via-card to-background flex items-center justify-center">
                          <span className="text-[140px] font-black text-foreground/[0.04] select-none leading-none" style={fd}>
                            {new Date(heroComp.ends_at).getFullYear()}
                          </span>
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-card via-card/40 to-transparent" />

                      {/* Badges overlaid on image */}
                      <div className="absolute bottom-5 left-6 flex items-center gap-2.5">
                        <span
                          className={`px-3.5 py-1 text-[9px] font-extrabold uppercase tracking-[0.12em] rounded-md ${
                            heroComp.phase === "judging"
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted/40 text-muted-foreground border border-border/60"
                          }`}
                          style={f}
                        >
                          {heroComp.phase === "judging" ? "Active Assignment" : "Awaiting Judging"}
                        </span>
                        <span
                          className="px-3 py-1 bg-foreground/[0.08] backdrop-blur-sm text-foreground/50 text-[9px] font-medium rounded-md"
                          style={f}
                        >
                          ID: #{heroComp.id.slice(0, 8).toUpperCase()}
                        </span>
                      </div>
                    </div>

                    {/* Info section */}
                    <div className="p-6 shrink-0">
                      <h2 className="text-[24px] lg:text-[28px] font-bold text-foreground mb-2 leading-tight" style={fd}>
                        {heroComp.title}
                      </h2>
                      <p className="text-[13px] text-muted-foreground/50 mb-6 leading-relaxed max-w-2xl" style={f}>
                        {heroComp.category} competition — {totalEntries} entries to evaluate across {rounds.length || 1} round{rounds.length !== 1 ? "s" : ""}.
                      </p>

                      <div className="flex items-end gap-10 flex-wrap">
                        <div>
                          <span className="text-[8px] tracking-[0.2em] uppercase text-muted-foreground/40 block mb-1.5" style={f}>Current Phase</span>
                          <span className="text-[15px] font-bold text-foreground" style={f}>
                            {heroComp.phase === "submission_open" ? "Submissions Open (View Only)" :
                             heroComp.phase === "voting" ? "Public Voting in Progress" :
                             currentRound ? `${currentRound.name}: ${currentRound.round_number >= 2 ? "Tagging" : "Scoring"}` : "Awaiting Round"}
                          </span>
                        </div>
                        <div>
                          <span className="text-[8px] tracking-[0.2em] uppercase text-muted-foreground/40 block mb-1.5" style={f}>Completion</span>
                          <span className="text-[15px] font-bold text-primary" style={f}>{completionPct}%</span>
                        </div>
                        {heroComp.phase === "judging" ? (
                          <motion.button
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.97 }}
                            onClick={(e) => { e.stopPropagation(); selectComp(heroComp); }}
                            className="ml-auto px-8 py-3 rounded-xl bg-foreground text-background text-[14px] font-bold hover:opacity-90 transition-all"
                            style={f}
                          >
                            {t("jg.enterPanel")}
                          </motion.button>
                        ) : (
                          <motion.button
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.97 }}
                            onClick={(e) => { e.stopPropagation(); selectComp(heroComp); }}
                            className="ml-auto px-8 py-3 rounded-xl bg-muted text-muted-foreground text-[14px] font-bold transition-all border border-border"
                            style={f}
                          >
                            {t("jg.viewSubmissions")}
                          </motion.button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* Secondary cards — small 1x1 squares */}
                {activeComps.slice(1).map((comp) => {
                  const progress = competitionProgress?.[comp.id];
                  return (
                    <div key={comp.id} className="sm:aspect-square">
                      <CompCard
                        title={comp.title}
                        description={`${comp.category} submissions${comp.entry_count ? ` — ${comp.entry_count} entries` : ""}.`}
                        icon={<Sparkles className="w-4 h-4 text-primary" />}
                        roundLabel={progress?.roundLabel || "Round 1"}
                        progressPct={progress ? `${progress.progressPct}% Done` : "Pending"}
                        onClick={() => selectComp(comp)}
                      />
                    </div>
                  );
                })}
              </div>

              {/* Mobile-only stats ribbon (right rail handles desktop) */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.2 }}
                className="grid grid-cols-2 gap-3 xl:hidden"
              >
                {stats.map((s) => (
                  <StatItem key={s.label} {...s} />
                ))}
              </motion.div>
            </div>

            {/* ── Right rail — stat cards + upcoming round ── */}
            <motion.aside
              initial={{ opacity: 0, x: 14 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.45, delay: 0.15 }}
              className="hidden xl:flex flex-col gap-3 w-[300px] shrink-0"
            >
              {/* Stat cards stacked — slot for up to 8 update cards */}
              <div className="grid grid-cols-2 gap-3">
                {stats.map((s) => (
                  <StatItem key={s.label} {...s} />
                ))}
              </div>

              {/* Upcoming round card */}
              {(() => {
                const upcomingComp = competitions.find(c => c.phase !== "judging" && c.phase !== "submission_open");
                if (!upcomingComp) return null;
                const meta = getRoundDateLabel(upcomingComp);
                return (
                  <UpcomingCard
                    comp={upcomingComp}
                    actionLabel={meta.label}
                    dateLabel={meta.date}
                    onClick={() => selectComp(upcomingComp)}
                  />
                );
              })()}
            </motion.aside>
          </div>
        )}
      </div>
    </div>
  );
});

CinemaDashboard.displayName = "CinemaDashboard";

export default CinemaDashboard;
