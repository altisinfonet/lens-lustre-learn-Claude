/**
 * SEARCH WITHIN THE OPEN COMMENT THREAD.
 *
 * A controlled box — it owns no query state of its own. The panel above it
 * (PostCommentsSection) holds the query, because the panel is what has to
 * hand the FILTERED array to CommentThread; a box that kept its own copy
 * would mean two sources for one string.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT COLLAPSES TO A ROW UNTIL IT IS USED
 *
 * The reference puts a permanent search affordance under the title. A full
 * input sitting open above every thread costs a band of vertical space on a
 * phone — the band a comment could have used — for a control most members
 * never touch. So the resting state is one 44px row (the app's tap-target
 * floor, same as MentionInput's send button), and tapping it expands to the
 * real input and focuses it. Nothing is hidden: the word "Search" and the
 * magnifier are visible at rest, which is the whole affordance.
 *
 * `subjectLabel` is the post's own first line, drawn after a separator dot so
 * the row reads "Search · Kathi Holi Nandurbar" — it says WHAT is being
 * searched, which matters on a surface that can be opened from a feed of
 * dozens of posts. It is decoration for orientation only; it is never part of
 * the query.
 */
import { useEffect, useRef } from "react";
import { Search, X } from "lucide-react";

export interface CommentSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  /** Open/closed is the caller's state so closing can clear the query in one place. */
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  /** The post's first line, shown at rest for orientation. Never searched. */
  subjectLabel?: string | null;
  /** Matches currently drawn, announced politely once a query exists. */
  resultCount?: number;
}

/** Long captions are a title here, not a paragraph — one clause, then an ellipsis. */
const LABEL_MAX = 28;
export const truncateLabel = (label: string, max = LABEL_MAX): string => {
  const oneLine = label.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1).trimEnd()}…` : oneLine;
};

const CommentSearchBar = ({
  value,
  onChange,
  expanded,
  onExpandedChange,
  subjectLabel,
  resultCount,
}: CommentSearchBarProps) => {
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Focus on expand only — not on every render, which would steal the caret
  // back from the composer every time a result count changed.
  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  const close = () => {
    onChange("");
    onExpandedChange(false);
  };

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => onExpandedChange(true)}
        className="flex h-11 w-full items-center gap-2 px-4 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <Search className="h-4 w-4 shrink-0" strokeWidth={2} />
        <span className="font-medium text-primary">Search</span>
        {subjectLabel && (
          <>
            <span aria-hidden="true" className="text-muted-foreground/70">·</span>
            <span className="truncate text-primary/90">{truncateLabel(subjectLabel)}</span>
          </>
        )}
      </button>
    );
  }

  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-2 rounded-full bg-muted/40 px-3 ring-1 ring-inset ring-border focus-within:ring-2 focus-within:ring-ring transition-shadow">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={2} />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") close(); }}
          placeholder="Search comments"
          aria-label="Search comments"
          className="h-11 min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        <button
          type="button"
          onClick={close}
          aria-label="Close comment search"
          className="-mr-1 flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>
      {/* Announced, not just drawn: a member using a screen reader gets told the
          list under them changed, which a silently re-rendered list never says. */}
      {value.trim().length > 0 && (
        <p role="status" aria-live="polite" className="px-4 pt-1.5 text-xs text-muted-foreground">
          {resultCount === 0
            ? "No comments match your search."
            : `${resultCount} ${resultCount === 1 ? "comment" : "comments"} match your search.`}
        </p>
      )}
    </div>
  );
};

export default CommentSearchBar;
