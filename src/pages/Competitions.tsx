import { Link } from "react-router-dom";
import PageSEO from "@/components/PageSEO";
import { Calendar, Trophy, Clock, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { useState } from "react";
import { useCompetitions, CompetitionListItem } from "@/hooks/competition/useCompetitions";
import { useAuth } from "@/hooks/core/useAuth";
import { phaseStatusColors, phaseDisplayLabels } from "@/lib/competitionPhase";
import { useT } from "@/i18n/I18nContext";

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.8, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] },
  }),
};

type PhaseFilter = "all" | "submission_open" | "voting" | "judging" | "result";

const Competitions = () => {
  const { user } = useAuth();
  const t = useT();
  const [filter, setFilter] = useState<PhaseFilter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { data: competitions = [], isLoading: loading } = useCompetitions(filter === "all" ? undefined : filter);

  const filterLabels: Record<string, string> = {
    all: t("comp.filterAll"),
    submission_open: t("comp.filterOpen"),
    voting: t("comp.filterVoting"),
    judging: t("comp.filterJudging"),
    result: t("comp.filterResult"),
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <PageSEO title="Competitions" description="Browse and enter photography competitions on 50mm Retina World." />
      <div className="container mx-auto py-3 md:py-20">
<motion.div initial="hidden" animate="visible">
          <motion.div variants={fadeUp} custom={0} className="flex items-center gap-4 mb-2">
            <div className="w-12 h-px bg-primary" />
            <span className="text-[10px] tracking-[0.3em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>{t("nav.compete")}</span>
          </motion.div>
          <motion.h1 variants={fadeUp} custom={1} className="text-xl md:text-6xl font-light tracking-tight mb-2 md:mb-4 px-2 md:px-0" style={{ fontFamily: "var(--font-display)" }}>
            Photography <em className="italic text-primary">Competitions</em>
          </motion.h1>
          <motion.p variants={fadeUp} custom={2} className="text-xs md:text-sm text-muted-foreground max-w-lg mb-4 md:mb-12 px-2 md:px-0" style={{ fontFamily: "var(--font-body)" }}>
            {t("comp.subtitle")}
          </motion.p>

          {/* Filters */}
          <motion.div variants={fadeUp} custom={3} className="flex gap-2 mb-4 md:mb-12 overflow-x-auto scrollbar-hide px-2 md:px-0">
            {(["all", "submission_open", "voting", "judging", "result"] as PhaseFilter[]).map((s) => (
                <button
                key={s}
                onClick={() => { setFilter(s); }}
                className={`text-[10px] tracking-[0.2em] uppercase px-3 md:px-4 py-1.5 md:py-2 border rounded-full md:rounded-none transition-all duration-500 whitespace-nowrap ${
                  filter === s ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-foreground/50"
                }`}
                style={{ fontFamily: "var(--font-heading)" }}
              >
                {filterLabels[s]}
              </button>
            ))}
          </motion.div>
        </motion.div>

        {/* Grid */}
        {loading ? (
          <div className="text-xs tracking-[0.3em] uppercase text-muted-foreground animate-pulse py-20 text-center" style={{ fontFamily: "var(--font-heading)" }}>
            {t("comp.loading")}
          </div>
        ) : competitions.length === 0 ? (
          <div className="text-center py-20">
            <Trophy className="h-10 w-10 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-sm text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
              {t("comp.empty")}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-6 md:grid md:grid-cols-1 md:auto-rows-fr md:gap-8 max-w-6xl mx-auto">
            {competitions.map((comp, i) => (
              <motion.div
                key={comp.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08, duration: 0.6, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] }}
                className="w-full"
              >
                <Link
                  to={`/competitions/${comp.slug || comp.id}`}
                  data-expanded={expandedId === comp.id}
                  onClick={(e) => {
                    const isTouch = typeof window !== "undefined" && window.matchMedia("(hover: none)").matches;
                    if (isTouch && expandedId !== comp.id) {
                      e.preventDefault();
                      setExpandedId(comp.id);
                    }
                  }}
                  className="group block h-full border border-border hover:border-primary/40 transition-all duration-700 overflow-hidden rounded-xl md:rounded-2xl hover:shadow-2xl hover:shadow-primary/5"
                >
                  {/* Image with hover-reveal overlay */}
                  <div className="relative aspect-[2/3] overflow-hidden bg-muted">
                    {comp.cover_image_url ? (
                      <img
                        src={comp.cover_image_url}
                        alt={comp.title}
                        className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-110 group-data-[expanded=true]:scale-110"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Trophy className="h-12 w-12 text-muted-foreground/20" />
                      </div>
                    )}

                    {/* Dark overlay on hover / when expanded */}
                    <div className="absolute inset-0 bg-background/0 group-hover:bg-background/70 group-data-[expanded=true]:bg-background/70 transition-all duration-500" />

                    {/* Content that slides up on hover / when expanded */}
                    <div className="absolute inset-0 flex flex-col justify-end p-8 md:p-12 translate-y-full group-hover:translate-y-0 group-data-[expanded=true]:translate-y-0 transition-transform duration-500 ease-out">
                      <span className="text-sm tracking-[0.2em] uppercase text-primary block mb-3" style={{ fontFamily: "var(--font-heading)" }}>
                        {comp.category}
                      </span>
                      <h2 className="text-3xl md:text-5xl font-light tracking-tight text-foreground mb-3" style={{ fontFamily: "var(--font-display)" }}>
                        {comp.title}
                      </h2>
                      <div className="w-16 md:w-20 h-px bg-primary mb-4" />
                      {comp.description && (
                        <p className="text-base md:text-lg text-muted-foreground/80 leading-relaxed line-clamp-2 mb-4" style={{ fontFamily: "var(--font-body)" }}>
                          {comp.description}
                        </p>
                      )}
                      <div className="space-y-2 mb-3">
                        <div className="flex items-center gap-3">
                          <Calendar className="h-5 w-5 text-primary" />
                          <span className="text-sm text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
                            <span className="text-muted-foreground/60">Submissions:</span>{" "}
                            {new Date(comp.starts_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })} — {new Date(comp.ends_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </span>
                        </div>
                        {comp.voting_ends_at && (
                          <div className="flex items-center gap-3">
                            <Clock className="h-5 w-5 text-primary/70" />
                            <span className="text-sm text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
                              <span className="text-muted-foreground/60">Voting:</span>{" "}
                              {new Date(comp.ends_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })} — {new Date(comp.voting_ends_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                            </span>
                          </div>
                        )}
                      </div>
                      <span className="inline-flex items-center gap-2 text-sm tracking-[0.2em] uppercase text-primary mt-2" style={{ fontFamily: "var(--font-heading)" }}>
                        {t("comp.viewDetails")}
                        <ArrowRight className="h-5 w-5 group-hover:translate-x-1 group-data-[expanded=true]:translate-x-1 transition-transform duration-500" />
                      </span>
                    </div>

                    {/* Status badge - always visible */}
                    <div className="absolute top-4 left-4">
                      <span className={`text-sm tracking-[0.2em] uppercase px-4 py-2 border bg-background/80 backdrop-blur-sm rounded-full ${phaseStatusColors[comp.phase] || ""}`} style={{ fontFamily: "var(--font-heading)" }}>
                        {t("phase." + comp.phase, phaseDisplayLabels[comp.phase] || comp.phase)}
                      </span>
                    </div>

                    {/* Tap hint - mobile only, hidden when expanded */}
                    <div className="absolute top-4 right-4 md:hidden group-data-[expanded=true]:opacity-0 transition-opacity duration-300">
                      <span className="text-[10px] tracking-[0.2em] uppercase px-3 py-1.5 border border-primary/40 bg-background/80 backdrop-blur-sm rounded-full text-primary" style={{ fontFamily: "var(--font-heading)" }}>
                        {t("comp.tapInfo")}
                      </span>
                    </div>

                    {/* Bottom gradient - hidden on hover / when expanded */}
                    <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-background/40 to-transparent group-hover:opacity-0 group-data-[expanded=true]:opacity-0 transition-opacity duration-500" />
                  </div>


                  {/* Footer: Grand Prize only */}
                  {comp.prize_info && (
                    <div className="px-8 md:px-12 py-6 md:py-8 border-t border-border bg-gradient-to-r from-primary/5 via-transparent to-primary/5">
                      <div className="flex items-center gap-3">
                        <span className="text-xs tracking-[0.3em] uppercase text-primary/70 font-semibold" style={{ fontFamily: "var(--font-heading)" }}>
                          🏆 Grand Prize
                        </span>
                        <div className="flex-1 h-px bg-gradient-to-r from-primary/20 to-transparent" />
                        <span className="text-lg md:text-xl font-bold text-primary tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
                          {comp.prize_info}
                        </span>
                      </div>
                    </div>
                  )}
                </Link>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
};

export default Competitions;
