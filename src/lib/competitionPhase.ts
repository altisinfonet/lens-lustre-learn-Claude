/**
 * Auto-derived competition phase system.
 * Phase is NEVER manually controlled — always computed from dates + judging state.
 *
 * Canonical phases: "upcoming", "submission_open", "voting", "judging", "result"
 */

export interface CompetitionPhaseInput {
  starts_at?: string | null;
  ends_at?: string | null;
  voting_ends_at?: string | null;
  judging_completed?: boolean | null;
  /** Legacy fallback fields — used ONLY when date fields are missing */
  phase?: string | null;
  status?: string;
}

/**
 * Resolves the effective phase from a competition record.
 * Priority: date-derived logic → legacy phase → legacy status mapping → default.
 */
export function resolveCompetitionPhase(comp: CompetitionPhaseInput): string {
  // Archived status is explicit — never override it
  if (comp.status === "archived") return "archived";

  const now = new Date();

  // If all date fields present → fully auto-derive
  if (comp.starts_at && comp.ends_at) {
    const start = new Date(comp.starts_at);
    const end = new Date(comp.ends_at);
    const votingEnd = comp.voting_ends_at ? new Date(comp.voting_ends_at) : end;

    if (now < start) return "upcoming";
    if (now >= start && now <= end) return "submission_open";
    if (now > end && now <= votingEnd) return "voting";
    if (comp.judging_completed) return "result";
    return "judging";
  }

  // Fallback: legacy phase field
  if (comp.phase && comp.phase !== "") return comp.phase;

  // Fallback: legacy status mapping
  if (comp.status) return mapCompetitionStatusToPhase(comp.status);

  return "submission_open";
}

/** Backward-compatible alias — delegates to new auto-derived resolver */
export function resolvePhase(comp: { phase?: string | null; status?: string; starts_at?: string | null; ends_at?: string | null; voting_ends_at?: string | null; judging_completed?: boolean | null }): string {
  return resolveCompetitionPhase(comp);
}

/**
 * Maps legacy competition.status values to canonical phase values.
 */
function mapCompetitionStatusToPhase(status: string): string {
  switch (status) {
    case "draft":
    case "open":
    case "upcoming":
      return "submission_open";
    case "active":
    case "judging":
      return "judging";
    case "result":
    case "closed":
    case "completed":
      return "result";
    default:
      return "submission_open";
  }
}

/** Display labels for phases */
export const phaseDisplayLabels: Record<string, string> = {
  upcoming: "Upcoming",
  submission_open: "Open",
  voting: "Voting",
  judging: "Judging",
  result: "Results",
  archived: "Archived",
};

/** Status colors for phase badges */
export const phaseStatusColors: Record<string, string> = {
  upcoming: "border-blue-500 text-blue-500",
  submission_open: "border-primary text-primary",
  voting: "border-emerald-500 text-emerald-500",
  judging: "border-yellow-500 text-yellow-500",
  result: "border-foreground/20 text-foreground/40",
  archived: "border-muted-foreground/30 text-muted-foreground/60",
};
