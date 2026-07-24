/**
 * RoundDecisionButtons — Spec v3 / Blocker B1+B2 (2026-04-25)
 *
 * Renders the per-round DECISION choices (R1/R2/R3) as plain decision
 * buttons — NOT tag chips. Tag chips are reserved exclusively for R4
 * (Winner, Runner-Ups, Honorary Mention, Special Jury, Top N, etc).
 *
 * Under the hood the click still writes to `judge_tag_assignments` via the
 * existing `toggleTag` action — that table is what the consensus pipeline
 * reads. We are only changing the *visual presentation* and the *vocabulary*
 * for the judge: in R1–R3 these are "decisions"; in R4 they are "tags".
 *
 * Round mapping (driven by `judging_tags.visible_in_round`):
 *
 *   R1 → "Accept" / "Shortlist for R2" / "Reject" / "Verification Required - Round 1"
 *   R2 → "Qualified for R3" / "Qualified for R2" / "Verification Required - Round 2"
 *   R3 → "Shortlisted for Final" / "Qualified for R3 Final" / "Verification Required - Round 3"
 *
 * The component is purely presentational: it filters `availableTags` to the
 * current round and renders one big radio-style button per option. Only one
 * decision active at a time is enforced visually (clicking the same one again
 * removes it; clicking a different one swaps via toggle calls).
 */
import { memo, useMemo } from "react";
import { Loader2, CheckCircle2, XCircle, AlertTriangle, ArrowRight } from "lucide-react";
import type { JudgingTag } from "@/hooks/judging/types";
import { useT } from "@/i18n/I18nContext";

const f = { fontFamily: "var(--font-heading)" };
const fb = { fontFamily: "var(--font-body)" };

type DecisionKind = "accept" | "promote" | "reject" | "needs_review";

interface DecisionButtonMeta {
  kind: DecisionKind;
  short: string;
  hint: string;
  Icon: typeof CheckCircle2;
  // tailwind classes
  active: string;
  idle: string;
}

const KIND_META: Record<DecisionKind, DecisionButtonMeta> = {
  accept: {
    kind: "accept",
    short: "Accept",
    hint: "Photo passes this round.",
    Icon: CheckCircle2,
    active: "border-emerald-500 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
    idle: "border-border hover:border-emerald-500/60 hover:text-emerald-600 dark:hover:text-emerald-300",
  },
  promote: {
    kind: "promote",
    short: "Move to next round",
    hint: "Photo qualifies for the next round.",
    Icon: ArrowRight,
    active: "border-primary bg-primary/15 text-primary",
    idle: "border-border hover:border-primary/60 hover:text-primary",
  },
  reject: {
    kind: "reject",
    short: "Reject",
    hint: "Photo eliminated from this round.",
    Icon: XCircle,
    active: "border-destructive bg-destructive/15 text-destructive",
    idle: "border-border hover:border-destructive/60 hover:text-destructive",
  },
  needs_review: {
    kind: "needs_review",
    short: "Needs Review",
    hint: "Hold for second look — must be resolved before round closes.",
    Icon: AlertTriangle,
    active: "border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-300",
    idle: "border-border hover:border-amber-500/60 hover:text-amber-600 dark:hover:text-amber-300",
  },
};

/**
 * Map a judging_tags row → DecisionKind. Falls back to "accept" for any
 * unknown system label (defensive — admin can rename).
 */
function classify(tag: JudgingTag): DecisionKind {
  const lbl = (tag.label ?? "").toLowerCase().trim();
  // Needs Review (Spec v3) — match canonical label, snake_case, and legacy "verification" wording.
  if (lbl === "needs review" || lbl === "needs_review" || lbl.includes("needs review") || lbl.includes("verification")) {
    return "needs_review";
  }
  if (lbl.startsWith("rejected") || lbl.startsWith("reject") || lbl.startsWith("not selected")) return "reject";
  if (lbl.startsWith("shortlist") || lbl.startsWith("qualified for")) return "promote";
  if (lbl === "accepted" || lbl === "accept") return "accept";
  return "accept";
}

interface Props {
  /** ALL judging tags (we filter to the current round inside). */
  availableTags: JudgingTag[];
  /** Current round number (1, 2, or 3). For R4 use TagDecisionPanel instead. */
  roundNumber: 1 | 2 | 3;
  /** Currently-applied tag IDs for this judge on this photo. */
  currentTagIds: string[];
  /** Click handler — wires through to `toggleTag(entryId, photoIndex, tagId)`. */
  onTagClick: (tagId: string) => void;
  disabled: boolean;
  /** ID of the tag currently being written (for spinner). */
  pendingTagId?: string | null;
  compact?: boolean;
}

const RoundDecisionButtons = memo(({
  availableTags,
  roundNumber,
  currentTagIds,
  onTagClick,
  disabled,
  pendingTagId,
  compact = false,
}: Props) => {
  const t = useT();
  const KIND_T: Record<string, [string, string]> = {
    accept: ["jg.accept", "jg.acceptHint"],
    promote: ["jg.promote", "jg.promoteHint"],
    reject: ["jg.reject", "jg.rejectHint"],
    needs_review: ["jg.needsReview", "jg.needsReviewHint"],
  };
  const kShort = (k: string, fb: string) => KIND_T[k] ? t(KIND_T[k][0], fb) : fb;
  const kHint = (k: string, fb: string) => KIND_T[k] ? t(KIND_T[k][1], fb) : fb;
  const visibleTags = useMemo(
    () =>
      availableTags.filter(
        (t) => Array.isArray(t.visible_in_round) && t.visible_in_round.includes(roundNumber)
      ),
    [availableTags, roundNumber]
  );

  if (visibleTags.length === 0) {
    return (
      <div className="px-3 py-2 rounded-md border border-dashed border-border text-[10px] text-muted-foreground" style={f}>
        No decision options configured for Round {roundNumber}. Ask an admin to create the
        Round {roundNumber} system decisions in Judging Tags.
      </div>
    );
  }

  // Sort: accept/promote first, needs_review middle, reject last.
  const sortOrder: Record<DecisionKind, number> = { accept: 1, promote: 2, needs_review: 3, reject: 4 };
  const ordered = [...visibleTags].sort((a, b) => sortOrder[classify(a)] - sortOrder[classify(b)]);

  return (
    <div className={compact ? "flex flex-wrap items-center gap-1.5" : "space-y-2"}>
      {!compact && (
        <span className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground flex items-center gap-1.5" style={f}>
          Round {roundNumber} Decision · pick one
        </span>
      )}
      <div className={compact ? "flex flex-wrap gap-1.5" : "grid grid-cols-1 gap-1.5"}>
        {ordered.map((tag) => {
          const isActive = currentTagIds.includes(tag.id);
          const isPending = pendingTagId === tag.id;
          const meta = KIND_META[classify(tag)];
          const Icon = meta.Icon;
          return (
            <button
              key={tag.id}
              onClick={() => onTagClick(tag.id)}
              disabled={disabled || isPending}
              aria-pressed={isActive}
              aria-label={`${kShort(meta.kind, meta.short)}: ${tag.label}`}
              title={kHint(meta.kind, meta.hint)}
              className={[
                "flex items-center gap-2 rounded-lg border-2 transition-all font-bold uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed",
                compact ? "px-2.5 py-1.5 text-[10px]" : "px-3 py-2.5 text-[11px] justify-start",
                isActive ? meta.active : `${meta.idle} bg-muted/20 text-muted-foreground`,
              ].join(" ")}
              style={f}
            >
              {isPending ? (
                <Loader2 className={compact ? "h-3 w-3 animate-spin" : "h-3.5 w-3.5 animate-spin"} />
              ) : (
                <Icon className={compact ? "h-3 w-3 shrink-0" : "h-3.5 w-3.5 shrink-0"} />
              )}
              <span className="truncate">{compact ? meta.short : tag.label}</span>
            </button>
          );
        })}
      </div>
      {!compact && (
        <p className="text-[8px] text-muted-foreground/60" style={fb}>
          {t("jg.decisionsNote")}
          {t("jg.tagsRound4")}
        </p>
      )}
    </div>
  );
});

RoundDecisionButtons.displayName = "RoundDecisionButtons";
export default RoundDecisionButtons;
