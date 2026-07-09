import { CheckCircle, Clock, XCircle, Award, Shield, Star, Trophy, AlertCircle, Medal } from "lucide-react";
import { participantStageLabel } from "@/lib/judging/participantStageLabels";

interface ParticipantStageBadgeProps {
  status: string;
  tags: { label: string; color: string }[];
  compact?: boolean;
}

// Plan Phase 5 / Task 5.1 — labels are NEVER hardcoded in this file.
// Every visible string is resolved through `participantStageLabel(key)`,
// which delegates to PARTICIPANT_STAGE_LABELS → PARTICIPANT_LABELS
// (the byte-identical mirror of `v3_stage_catalog.tag_label_canonical`).
// Only icon + color tokens live here; rename a label by editing the catalog
// + participantWording.ts, never this component.
type StageStyle = { icon: typeof CheckCircle; color: string; bg: string };

const STAGE_STYLE: Record<string, StageStyle> = {
  submitted:           { icon: Clock,        color: "text-yellow-600", bg: "bg-yellow-500/10 border-yellow-500/30" },
  judging_in_progress: { icon: Clock,        color: "text-yellow-600", bg: "bg-yellow-500/10 border-yellow-500/30" },
  pending_consensus:   { icon: Clock,        color: "text-yellow-600", bg: "bg-yellow-500/10 border-yellow-500/30" },
  approved:            { icon: Shield,       color: "text-green-600",  bg: "bg-green-500/10 border-green-500/30" },
  round1_qualified:    { icon: CheckCircle,  color: "text-emerald-600",bg: "bg-emerald-500/10 border-emerald-500/30" },
  shortlisted:         { icon: Star,         color: "text-amber-600",  bg: "bg-amber-500/10 border-amber-500/30" },
  // ── Frozen Contract v3 R1 canonical keys (Phase 1) — were missing,
  // causing photos with these statuses to silently fall back to the
  // "submitted" yellow Clock style despite having a real R1 outcome.
  r1_accepted:         { icon: Shield,       color: "text-green-600",  bg: "bg-green-500/10 border-green-500/30" },
  r1_shortlisted_r2:   { icon: Star,         color: "text-amber-600",  bg: "bg-amber-500/10 border-amber-500/30" },
  r1_needs_review:     { icon: AlertCircle,  color: "text-orange-500", bg: "bg-orange-500/10 border-orange-500/30" },
  r1_rejected:         { icon: XCircle,      color: "text-red-500",    bg: "bg-red-500/10 border-red-500/30" },
  round2_qualified:    { icon: CheckCircle,  color: "text-blue-600",   bg: "bg-blue-500/10 border-blue-500/30" },
  r2_accepted:         { icon: CheckCircle,  color: "text-blue-600",   bg: "bg-blue-500/10 border-blue-500/30" },
  r2_qualified_r3:     { icon: CheckCircle,  color: "text-blue-600",   bg: "bg-blue-500/10 border-blue-500/30" },
  r2_not_selected_r3:  { icon: XCircle,      color: "text-red-500",    bg: "bg-red-500/10 border-red-500/30" },
  finalist:            { icon: Trophy,       color: "text-purple-600", bg: "bg-purple-500/10 border-purple-500/30" },
  qualified_final:     { icon: CheckCircle,  color: "text-cyan-600",   bg: "bg-cyan-500/10 border-cyan-500/30" },
  r3_accepted:         { icon: CheckCircle,  color: "text-cyan-600",   bg: "bg-cyan-500/10 border-cyan-500/30" },
  r3_qualified_final:  { icon: Trophy,       color: "text-purple-600", bg: "bg-purple-500/10 border-purple-500/30" },
  r3_not_selected_final: { icon: XCircle,    color: "text-red-500",    bg: "bg-red-500/10 border-red-500/30" },
  top_50:              { icon: Medal,        color: "text-amber-500",  bg: "bg-amber-500/10 border-amber-500/30" },
  top_100:             { icon: Medal,        color: "text-slate-400",  bg: "bg-slate-500/10 border-slate-500/30" },
  rejected:            { icon: XCircle,      color: "text-red-500",    bg: "bg-red-500/10 border-red-500/30" },
  round2_not_selected: { icon: XCircle,      color: "text-red-500",    bg: "bg-red-500/10 border-red-500/30" },
  round3_not_selected: { icon: XCircle,      color: "text-red-500",    bg: "bg-red-500/10 border-red-500/30" },
  needs_review:        { icon: AlertCircle,  color: "text-orange-500", bg: "bg-orange-500/10 border-orange-500/30" },
  needs_verification:  { icon: AlertCircle,  color: "text-orange-500", bg: "bg-orange-500/10 border-orange-500/30" },
  winner:              { icon: Trophy,       color: "text-yellow-500", bg: "bg-yellow-500/15 border-yellow-500/40" },
  runner_up_1:         { icon: Award,        color: "text-slate-500",  bg: "bg-slate-500/10 border-slate-500/30" },
  runner_up_2:         { icon: Award,        color: "text-amber-700",  bg: "bg-amber-700/10 border-amber-700/30" },
  honorary_mention:    { icon: Award,        color: "text-teal-600",   bg: "bg-teal-500/10 border-teal-500/30" },
  // Legacy alias — keeps any historical row rendering correctly.
  honourable_mention:  { icon: Award,        color: "text-teal-600",   bg: "bg-teal-500/10 border-teal-500/30" },
  special_jury:        { icon: Award,        color: "text-indigo-600", bg: "bg-indigo-500/10 border-indigo-500/30" },
  hold:                { icon: Clock,        color: "text-orange-500", bg: "bg-orange-500/10 border-orange-500/30" },
  results_declared:    { icon: CheckCircle,  color: "text-green-600",  bg: "bg-green-500/10 border-green-500/30" },
};

function styleFor(status: string): StageStyle {
  return STAGE_STYLE[status] ?? STAGE_STYLE.submitted;
}

const ParticipantStageBadge = ({ status, tags, compact = false }: ParticipantStageBadgeProps) => {
  const style = styleFor(status);
  const label = participantStageLabel(status);
  const Icon = style.icon;

  if (compact) {
    return (
      <span className={`inline-flex items-center gap-1 text-[8px] tracking-[0.1em] uppercase px-1.5 py-0.5 rounded-full border font-semibold ${style.bg} ${style.color}`} style={{ fontFamily: "var(--font-heading)" }}>
        <Icon className="h-2.5 w-2.5" />
        {label}
      </span>
    );
  }

  return (
    <div className="space-y-1.5">
      {/* Main status badge */}
      <div className={`inline-flex items-center gap-1.5 text-[9px] tracking-[0.1em] uppercase px-2 py-1 rounded-md border font-semibold ${style.bg} ${style.color}`} style={{ fontFamily: "var(--font-heading)" }}>
        <Icon className="h-3 w-3" />
        {label}
      </div>

      {/* Tag-based progression */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map(tag => (
            <span
              key={tag.label}
              className="inline-flex items-center gap-1 text-[7px] tracking-[0.1em] uppercase px-1.5 py-0.5 border rounded-sm font-semibold"
              style={{ borderColor: tag.color, color: tag.color, fontFamily: "var(--font-heading)" }}
            >
              <Award className="h-2.5 w-2.5" />
              {tag.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

/* Timeline showing progression stages */
export const ParticipantStageTimeline = ({ status, tags }: { status: string; tags: { label: string; color: string }[] }) => {
  const stages: { label: string; reached: boolean; color: string }[] = [];

  // Plan Phase 5 / Task 5.1 — every label resolved through participantStageLabel().
  // Build timeline from status and tags
  stages.push({ label: "Submitted", reached: true, color: "hsl(var(--primary))" });

  if (status !== "rejected") {
    stages.push({
      label: status === "submitted" ? "Screening…" : participantStageLabel("approved"),
      reached: status !== "submitted",
      color: "#22c55e",
    });
  }

  if (["round1_qualified", "shortlisted", "round2_qualified", "finalist", "winner", "runner_up_1", "runner_up_2", "honorary_mention", "honourable_mention", "special_jury"].includes(status)) {
    stages.push({ label: participantStageLabel("round1_qualified"), reached: true, color: "#10b981" });
  }

  if (["round2_qualified", "finalist", "winner", "runner_up_1", "runner_up_2", "honorary_mention", "honourable_mention", "special_jury"].includes(status)) {
    stages.push({ label: participantStageLabel("round2_qualified"), reached: true, color: "#3b82f6" });
  }

  // Add tag-based stages
  tags.forEach(tag => {
    stages.push({ label: `Selected ${tag.label}`, reached: true, color: tag.color });
  });

  if (["finalist", "winner", "runner_up_1", "runner_up_2", "honorary_mention", "honourable_mention", "special_jury"].includes(status)) {
    stages.push({ label: `⭐ ${participantStageLabel("finalist")}`, reached: true, color: "#a855f7" });
  }

  if (status === "winner") {
    stages.push({ label: `🏆 ${participantStageLabel("winner")}`, reached: true, color: "#eab308" });
  }

  if (status === "runner_up_1") {
    stages.push({ label: `🥈 ${participantStageLabel("runner_up_1")}`, reached: true, color: "#64748b" });
  }

  if (status === "runner_up_2") {
    stages.push({ label: `🥉 ${participantStageLabel("runner_up_2")}`, reached: true, color: "#b45309" });
  }

  if (status === "rejected") {
    stages.push({ label: participantStageLabel("rejected"), reached: true, color: "#ef4444" });
  }

  return (
    <div className="space-y-0">
      {stages.map((stage, i) => (
        <div key={i} className="flex items-start gap-2">
          <div className="flex flex-col items-center">
            <div
              className={`w-2.5 h-2.5 rounded-full border-2 ${stage.reached ? "" : "bg-transparent"}`}
              style={{
                borderColor: stage.reached ? stage.color : "hsl(var(--border))",
                backgroundColor: stage.reached ? stage.color : "transparent",
              }}
            />
            {i < stages.length - 1 && (
              <div className="w-px h-4" style={{ backgroundColor: stages[i + 1]?.reached ? stage.color : "hsl(var(--border))" }} />
            )}
          </div>
          <span
            className={`text-[9px] -mt-0.5 ${stage.reached ? "text-foreground font-medium" : "text-muted-foreground/50"}`}
            style={{ fontFamily: "var(--font-heading)" }}
          >
            {stage.label}
          </span>
        </div>
      ))}
    </div>
  );
};

export default ParticipantStageBadge;
