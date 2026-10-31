import { XCircle, CheckCircle, Tag, X } from "lucide-react";

interface JudgingTag {
  id: string;
  label: string;
  color: string;
}

interface BulkActionsBarProps {
  selectedCount: number;
  roundMode: "scoring" | "tagging" | "decision";
  availableTags: JudgingTag[];
  onBulkScore: (score: number) => void;
  onBulkTag: (tagId: string) => void;
  onDeselectAll: () => void;
  /** FIX CN-BUG-10: Disable all actions when round is locked */
  isRoundLocked?: boolean;
}

const BulkActionsBar = ({
  selectedCount,
  roundMode,
  availableTags,
  onBulkScore,
  onBulkTag,
  onDeselectAll,
  isRoundLocked = false,
}: BulkActionsBarProps) => {
  if (selectedCount === 0) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-primary/5 border-b border-primary/20 shrink-0">
      <span className="text-[10px] font-semibold text-primary tabular-nums" style={{ fontFamily: "var(--font-heading)" }}>
        {selectedCount} selected
      </span>
      <button onClick={onDeselectAll} className="p-1 hover:bg-muted rounded-full" title="Deselect all">
        <X className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      <div className="w-px h-4 bg-border mx-1" />

      {/* FIX CN-BUG-10: Round lock disables all bulk actions */}
      {isRoundLocked && (
        <span className="text-[9px] text-destructive font-bold uppercase tracking-wider" style={{ fontFamily: "var(--font-heading)" }}>
          Round Locked
        </span>
      )}

      {roundMode === "scoring" && (
        <>
          <button onClick={() => onBulkScore(0)} disabled={isRoundLocked}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-[9px] uppercase tracking-wider border border-destructive/50 text-destructive rounded-lg hover:bg-destructive/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ fontFamily: "var(--font-heading)" }}>
            <XCircle className="h-3 w-3" /> Reject All
          </button>
          <button onClick={() => onBulkScore(7)} disabled={isRoundLocked}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-[9px] uppercase tracking-wider border border-blue-500/50 text-blue-500 rounded-lg hover:bg-blue-500/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ fontFamily: "var(--font-heading)" }}>
            <CheckCircle className="h-3 w-3" /> Advance All
          </button>
        </>
      )}

      {roundMode !== "decision" && availableTags.length > 0 && (
        <div className="flex items-center gap-1">
          <Tag className="h-3 w-3 text-muted-foreground" />
          {availableTags.slice(0, 4).map(tag => (
            <button
              key={tag.id}
              onClick={() => onBulkTag(tag.id)}
              disabled={isRoundLocked}
              title={`Apply "${tag.label}" to ${selectedCount} selected`}
              aria-label={`Bulk apply tag ${tag.label}`}
              className="group px-2 py-1 text-[9px] uppercase tracking-wider rounded-lg border border-border bg-muted/30 text-muted-foreground transition-colors hover:scale-105 disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ fontFamily: "var(--font-heading)" }}
              onMouseEnter={(e) => {
                if (isRoundLocked) return;
                e.currentTarget.style.borderColor = tag.color;
                e.currentTarget.style.color = tag.color;
                e.currentTarget.style.backgroundColor = `${tag.color}15`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "";
                e.currentTarget.style.color = "";
                e.currentTarget.style.backgroundColor = "";
              }}
            >
              {tag.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1" />
    </div>
  );
};

export default BulkActionsBar;
