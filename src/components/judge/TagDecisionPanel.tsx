/**
 * TagDecisionPanel — Judging v5 canonical decision UI.
 *
 * Single component used in R1–R4. Renders ONLY the admin-defined tags whose
 * `visible_in_round` includes the current round. Click = tag write via
 * `toggleTag` (which writes to judge_tag_assignments). NO auto-advance.
 *
 * Rules enforced visually:
 *   - System tags get a 🔒 marker.
 *   - "Create new tag" is intentionally absent — judges cannot create tags.
 *   - Currently-applied tag highlighted with primary ring.
 */
import { memo } from "react";
import { Loader2, Lock, Tag as TagIcon } from "lucide-react";
import type { JudgingTag } from "@/hooks/judging/types";

const f = { fontFamily: "var(--font-heading)" };

interface Props {
  availableTags: JudgingTag[];
  roundNumber: number;
  currentTagIds: string[]; // judge's own tag IDs on this photo
  onTagClick: (tagId: string) => void;
  disabled: boolean;
  pendingTagId?: string | null;
  compact?: boolean;
}

const TagDecisionPanel = memo(({
  availableTags,
  roundNumber,
  currentTagIds,
  onTagClick,
  disabled,
  pendingTagId,
  compact = false,
}: Props) => {
  const visibleTags = availableTags.filter(
    (t) => Array.isArray(t.visible_in_round) && t.visible_in_round.includes(roundNumber)
  );

  if (visibleTags.length === 0) {
    return (
      <div className="px-3 py-2 rounded-md border border-dashed border-border text-[10px] text-muted-foreground" style={f}>
        No decision tags configured for Round {roundNumber}. Ask an admin to create them in Judging Tags.
      </div>
    );
  }

  return (
    <div className={compact ? "flex flex-wrap items-center gap-1.5" : "space-y-2"}>
      {!compact && (
        <span className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground flex items-center gap-1.5" style={f}>
          <TagIcon className="h-3 w-3" /> Round {roundNumber} Decision · click a tag
        </span>
      )}
      <div className={compact ? "flex flex-wrap gap-1.5" : "grid grid-cols-2 gap-2"}>
        {visibleTags.map((tag) => {
          const isActive = currentTagIds.includes(tag.id);
          const isPending = pendingTagId === tag.id;
          const isSystem = (tag as any).is_system === true;
          const tagColor = tag.color || "hsl(var(--muted-foreground))";
          return (
            <button
              key={tag.id}
              onClick={() => onTagClick(tag.id)}
              disabled={disabled || isPending}
              aria-pressed={isActive}
              aria-label={`${tag.label}${isSystem ? " (system tag)" : ""}`}
              className={`flex items-center justify-center gap-1.5 ${
                compact ? "px-2.5 py-1.5 text-[10px]" : "px-3 py-2.5 text-[11px]"
              } font-bold uppercase tracking-wider rounded-lg border-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                isActive
                  ? "ring-2 ring-offset-1 ring-offset-background"
                  : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              }`}
              style={
                isActive
                  ? { ...f, backgroundColor: `${tagColor}1F`, borderColor: tagColor, color: tagColor, boxShadow: `0 0 0 2px ${tagColor}55` }
                  : f
              }
            >
              {isPending ? (
                <Loader2 className={compact ? "h-3 w-3 animate-spin" : "h-3.5 w-3.5 animate-spin"} />
              ) : (
                <span
                  className="inline-block w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: isActive ? tagColor : "hsl(var(--muted-foreground) / 0.4)" }}
                />
              )}
              <span className="truncate">{tag.label}</span>
              {isSystem && <Lock className="h-2.5 w-2.5 opacity-60 shrink-0" />}
            </button>
          );
        })}
      </div>
      {!compact && (
        <p className="text-[8px] text-muted-foreground/60" style={f}>
          One tag per photo. Click again to remove. Judges cannot create new tags — admin only.
        </p>
      )}
    </div>
  );
});

TagDecisionPanel.displayName = "TagDecisionPanel";
export default TagDecisionPanel;
