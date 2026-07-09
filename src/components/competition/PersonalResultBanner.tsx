/**
 * PersonalResultBanner — Judging v5 / Rule #5 + #6
 *
 * Renders the participant's personal result banner on a competition page,
 * but ONLY using publish-gated status from `entry_public_status`. While the
 * relevant round is unpublished, falls back to a neutral "Judging in progress"
 * message so admins control the reveal moment.
 */
import { motion } from "framer-motion";
import { Trophy, Medal, Star, Award, Heart, Clock } from "lucide-react";
import { useEntryPublicStatus } from "@/hooks/judging/useEntryPublicStatus";

interface Entry {
  id: string;
  user_id: string;
  status?: string | null;
  placement?: string | null;
}

interface Props {
  phase: string;
  userId?: string | null;
  entries: Entry[];
}

const f = { fontFamily: "var(--font-heading)" };
const fb = { fontFamily: "var(--font-body)" };

export default function PersonalResultBanner({ phase, userId, entries }: Props) {
  const ownEntries = userId ? entries.filter((e) => e.user_id === userId) : [];
  const ownIds = ownEntries.map((e) => e.id);
  const { data: publicMap = {} } = useEntryPublicStatus(ownIds);

  // Banner is only relevant during the result phase, when the user has entries.
  if (phase !== "result" || !userId || ownEntries.length === 0) return null;

  // Pull publish-gated values; never read entry.status/placement directly here.
  const annotated = ownEntries.map((e) => {
    const row = publicMap[e.id];
    return {
      id: e.id,
      publicStatus: row?.public_status ?? "judging_in_progress",
      publicPlacement: row?.public_placement ?? null,
    };
  });

  const winner = annotated.find((e) => e.publicStatus === "winner" || e.publicPlacement === "winner");
  const finalist = annotated.find((e) => e.publicStatus === "finalist" || e.publicStatus === "r4_finalist");
  const runnerUp = annotated.find(
    (e) =>
      e.publicPlacement === "runner_up_1" ||
      e.publicPlacement === "runner_up_2" ||
      e.publicPlacement === "1st_runner_up" ||
      e.publicPlacement === "2nd_runner_up"
  );
  const qualified = annotated.find(
    (e) =>
      e.publicStatus === "round2_qualified" ||
      e.publicStatus === "round1_qualified" ||
      e.publicStatus === "shortlisted"
  );
  const allPending = annotated.every((e) => e.publicStatus === "judging_in_progress");

  let icon: React.ReactNode;
  let title: string;
  let subtitle: string;
  let bgClass: string;

  if (winner) {
    icon = <Trophy className="h-6 w-6" />;
    title = "Congratulations, you won! 🏆";
    subtitle = "Your entry was selected as the winner of this competition.";
    bgClass = "bg-yellow-500/10 border-yellow-500/30 text-yellow-600 dark:text-yellow-400";
  } else if (runnerUp) {
    icon = <Medal className="h-6 w-6" />;
    title =
      runnerUp.publicPlacement === "1st_runner_up"
      || runnerUp.publicPlacement === "runner_up_1"
        ? "Amazing — 1st Runner-Up! 🥈"
        : "Well done — 2nd Runner-Up! 🥉";
    subtitle = "Your entry earned a top placement. Be proud!";
    bgClass = "bg-[hsl(var(--muted))]/80 border-foreground/10 text-foreground";
  } else if (finalist) {
    icon = <Star className="h-6 w-6" />;
    title = "You're a Finalist! ⭐";
    subtitle = "Your work made it to the final round — an incredible achievement.";
    bgClass = "bg-purple-500/10 border-purple-500/30 text-purple-600 dark:text-purple-400";
  } else if (qualified) {
    icon = <Award className="h-6 w-6" />;
    title = "Your entry was shortlisted";
    subtitle = "Thank you for participating. Your work stood out among many entries.";
    bgClass = "bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400";
  } else if (allPending) {
    icon = <Clock className="h-6 w-6" />;
    title = "Judging in progress";
    subtitle = "Results will be visible here once the admin publishes the round.";
    bgClass = "bg-muted/50 border-border text-muted-foreground";
  } else {
    icon = <Heart className="h-6 w-6" />;
    title = "Thank you for participating";
    subtitle = "Every submission helps build a stronger creative community.";
    bgClass = "bg-muted/50 border-border text-muted-foreground";
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3, duration: 0.5 }}
      className="container mx-auto mt-4 md:mt-6"
    >
      <div className={`flex items-center gap-4 px-5 py-4 rounded-xl border ${bgClass}`}>
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.5, type: "spring", damping: 10 }}>
          {icon}
        </motion.div>
        <div className="min-w-0">
          <p className="text-sm font-semibold" style={f}>{title}</p>
          <p className="text-xs opacity-80" style={fb}>{subtitle}</p>
        </div>
      </div>
    </motion.div>
  );
}
