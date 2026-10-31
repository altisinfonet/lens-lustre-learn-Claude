import { Trophy, Clock, CheckCircle, XCircle, Star, ArrowRight, AlertTriangle } from "lucide-react";

const NEXT_STEPS: Record<string, { icon: React.ElementType; message: string; color: string }> = {
  // Default for ANY publish-gated state. Used when the relevant round has not
  // yet been admin-published (entry_public_status returns 'judging_in_progress').
  judging_in_progress: { icon: Clock, message: "Your entry is currently under review. Results will appear here once the round is officially published.", color: "text-muted-foreground" },
  submitted: { icon: Clock, message: "Your entry is under review. Results will be announced soon.", color: "text-yellow-600" },
  approved: { icon: CheckCircle, message: "Your entry has passed initial screening and is now being evaluated.", color: "text-green-600" },
  r1_accepted: { icon: CheckCircle, message: "Congratulations! Your photo was accepted in Round 1.", color: "text-green-600" },
  r1_shortlisted_r2: { icon: Star, message: "Congratulations! You have advanced to Round 2.", color: "text-emerald-600" },
  round1_qualified: { icon: Star, message: "Congratulations! You have advanced to Round 2.", color: "text-emerald-600" },
  shortlisted: { icon: Star, message: "You have been shortlisted and advanced to Round 2.", color: "text-emerald-600" },
  round2_qualified: { icon: Star, message: "Outstanding! You are now in the final round.", color: "text-blue-600" },
  round2_not_selected: { icon: XCircle, message: "Your photo was not selected for Round 3.", color: "text-muted-foreground" },
  round3_not_selected: { icon: XCircle, message: "Your photo was not selected for the final round.", color: "text-muted-foreground" },
  finalist: { icon: Trophy, message: "You are a finalist! Final results will be announced soon.", color: "text-purple-600" },
  winner: { icon: Trophy, message: "🎉 Congratulations! You are a winner!", color: "text-yellow-500" },
  rejected: { icon: XCircle, message: "Unfortunately, your entry was not selected. Explore other competitions!", color: "text-muted-foreground" },
  needs_review: { icon: AlertTriangle, message: "Action needed: please reply to the verification email from our support team and attach the original RAW file for the flagged photo(s).", color: "text-orange-500" },
  hold: { icon: AlertTriangle, message: "Your submission is under additional review. You will be notified once review is complete.", color: "text-orange-500" },
  results_declared: { icon: CheckCircle, message: "Results have been declared for this competition.", color: "text-green-600" },
};

interface UserNextStepPanelProps {
  status: string;
  compact?: boolean;
}

const UserNextStepPanel = ({ status, compact = false }: UserNextStepPanelProps) => {
  const config = NEXT_STEPS[status] || NEXT_STEPS.judging_in_progress;
  const Icon = config.icon;

  if (compact) {
    return (
      <p className={`text-[9px] ${config.color} flex items-center gap-1`} style={{ fontFamily: "var(--font-body)" }}>
        <Icon className="h-2.5 w-2.5 shrink-0" />
        {config.message}
      </p>
    );
  }

  return (
    <div className={`flex items-start gap-2 p-2.5 rounded-md border ${
      status === "hold" ? "border-orange-500/30 bg-orange-500/5" :
      status === "rejected" ? "border-border bg-muted/20" :
      "border-primary/20 bg-primary/5"
    }`}>
      <Icon className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${config.color}`} />
      <p className={`text-[10px] leading-relaxed ${config.color}`} style={{ fontFamily: "var(--font-body)" }}>
        {config.message}
      </p>
    </div>
  );
};

export default UserNextStepPanel;
