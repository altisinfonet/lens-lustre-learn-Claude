import { useState, useEffect, useMemo } from "react";
import { Clock, Trophy, Eye, Upload, Lock, Gavel } from "lucide-react";
import { motion } from "framer-motion";
import { resolveCompetitionPhase } from "@/lib/competitionPhase";
import { useT } from "@/i18n/I18nContext";

interface Competition {
  status: string;
  phase?: string;
  current_round?: string | null;
  starts_at: string;
  ends_at: string;
  voting_ends_at?: string | null;
  judging_completed?: boolean | null;
}

const phaseConfig: Record<string, { labelKey: string; descKey: string; icon: any; className: string }> = {
  upcoming: {
    labelKey: "pb.upcoming",
    descKey: "pb.upcomingDesc",
    icon: Clock,
    className: "border-muted-foreground/30 bg-muted/40 text-muted-foreground",
  },
  submission_open: {
    labelKey: "pb.open",
    descKey: "pb.openDesc",
    icon: Upload,
    className: "border-primary/30 bg-primary/5 text-primary",
  },
  voting: {
    labelKey: "pb.voting",
    descKey: "pb.votingDesc",
    icon: Eye,
    className: "border-primary/30 bg-primary/5 text-primary",
  },
  judging: {
    labelKey: "pb.judging",
    descKey: "pb.judgingDesc",
    icon: Gavel,
    className: "border-yellow-500/30 bg-yellow-500/5 text-yellow-600 dark:text-yellow-400",
  },
  result: {
    labelKey: "pb.result",
    descKey: "pb.resultDesc",
    icon: Trophy,
    className: "border-foreground/10 bg-muted/30 text-muted-foreground",
  },
};

function useCountdown(targetDate: string) {
  const target = useMemo(() => new Date(targetDate).getTime(), [targetDate]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const diff = Math.max(0, target - now);
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  const isExpired = diff <= 0;

  return { days, hours, minutes, seconds, isExpired };
}

const CountdownUnit = ({ value, label }: { value: number; label: string }) => (
  <div className="flex flex-col items-center min-w-[40px]">
    <span className="text-lg md:text-xl font-light tabular-nums" style={{ fontFamily: "var(--font-display)" }}>
      {String(value).padStart(2, "0")}
    </span>
    <span className="text-[8px] tracking-[0.2em] uppercase opacity-60" style={{ fontFamily: "var(--font-heading)" }}>
      {label}
    </span>
  </div>
);

const Separator = () => (
  <span className="text-lg font-light opacity-30 -mt-2">:</span>
);

export default function PhaseBanner({ competition }: { competition: Competition }) {
  const t = useT();
  // Use canonical resolver — never trust raw phase field alone (P-04: stale countdown bug)
  const activePhase = resolveCompetitionPhase(competition);
  const config = phaseConfig[activePhase] || phaseConfig.upcoming;
  const Icon = config.icon;

  // Determine countdown target — judging has NO public deadline (judges work async)
  const countdownTarget =
    activePhase === "upcoming"
      ? competition.starts_at
      : activePhase === "submission_open"
      ? competition.ends_at
      : activePhase === "voting"
      ? (competition.voting_ends_at || competition.ends_at)
      : null;

  const countdownLabel =
    activePhase === "upcoming"
      ? t("pb.opensIn")
      : activePhase === "submission_open"
      ? t("pb.subCloseIn")
      : activePhase === "voting"
      ? t("pb.voteCloseIn")
      : null;

  const countdown = useCountdown(countdownTarget || new Date().toISOString());

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className={`border-b ${config.className}`}
    >
      <div className="container mx-auto py-4 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Icon className="h-4 w-4 shrink-0" />
          <div>
            <span className="text-[10px] tracking-[0.25em] uppercase font-medium block" style={{ fontFamily: "var(--font-heading)" }}>
              {t(config.labelKey)}
            </span>
            <span className="text-[10px] opacity-70" style={{ fontFamily: "var(--font-body)" }}>
              {t(config.descKey)}
            </span>
            {activePhase === "judging" && competition.current_round && (
              <span className="text-[9px] tracking-[0.15em] uppercase opacity-80 mt-0.5 block" style={{ fontFamily: "var(--font-heading)" }}>
                {t("pb.round")} {competition.current_round} {t("pb.roundOf4")}
              </span>
            )}
          </div>
        </div>

        {countdownTarget && !countdown.isExpired && (
          <div className="flex items-center gap-1.5">
            <span className="text-[8px] tracking-[0.2em] uppercase opacity-50 mr-2" style={{ fontFamily: "var(--font-heading)" }}>
              {countdownLabel}
            </span>
            <CountdownUnit value={countdown.days} label={t("pb.days")} />
            <Separator />
            <CountdownUnit value={countdown.hours} label={t("pb.hrs")} />
            <Separator />
            <CountdownUnit value={countdown.minutes} label={t("pb.min")} />
            <Separator />
            <CountdownUnit value={countdown.seconds} label={t("pb.sec")} />
          </div>
        )}

        {activePhase === "result" && (
          <div className="flex items-center gap-1.5 opacity-50">
            <Lock className="h-3 w-3" />
            <span className="text-[9px] tracking-[0.15em] uppercase" style={{ fontFamily: "var(--font-heading)" }}>
              {t("pb.finalResults")}
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );
}
