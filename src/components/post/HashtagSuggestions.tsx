/**
 * The hashtag list that drops under a caption box.
 *
 * ONE component for all four caption surfaces (web composer, the app's caption
 * screen, inline post edit, scheduled-post edit) for the reason the owner set
 * on 2026-08-15 after a post rendered two different ways: if two screens draw
 * the same thing, they draw it with the same code or they drift apart.
 *
 * The caller must give it a positioned parent (`relative`) — it anchors to the
 * bottom of that box, exactly like the @mention list it sits beside.
 */
import type { HashtagSuggestion } from "@/hooks/feed/useCaptionHashtags";

interface Props {
  open: boolean;
  suggestions: HashtagSuggestion[];
  focusIdx: number;
  onFocusIdx: (i: number) => void;
  onPick: (s: HashtagSuggestion) => void;
  /**
   * "below"  — floats over whatever follows the box. Right where the caption
   *            box is followed by content, not controls.
   * "inline" — takes real layout space and pushes what follows DOWN. Required
   *            wherever Save/Cancel sit directly under the box.
   *
   * There is deliberately no "above". It was tried first for the scheduled-post
   * dialog and the screenshot at 360px showed it covering the dialog's title
   * AND its close button — trading a covered Save for a covered ×. A list that
   * hides a control is the exact complaint the owner has raised twice
   * ("all buttons are not showing some hiding"), so the option is gone rather
   * than left available to the next person who needs to fit a list somewhere.
   */
  placement?: "below" | "inline";
}

/** "13 people" / "1 person" — the ranking signal, said in plain words. */
const peopleLabel = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
const postsLabel = (n: number) => `${n} ${n === 1 ? "post" : "posts"}`;

export default function HashtagSuggestions({
  open,
  suggestions,
  focusIdx,
  onFocusIdx,
  onPick,
  placement = "below",
}: Props) {
  if (!open) return null;

  return (
    <div
      data-testid="hashtag-suggestions"
      role="listbox"
      aria-label="Hashtag suggestions"
      className={`z-30 overflow-hidden rounded-lg border border-border bg-popover shadow-lg ${
        placement === "inline" ? "relative mt-1" : "absolute left-0 right-0 top-full mt-1"
      }`}
    >
      {suggestions.map((s, i) => (
        <button
          key={s.tag}
          type="button"
          role="option"
          aria-selected={i === focusIdx}
          /*
           * onPointerDown, NOT onClick. A tap has to win the race against the
           * textarea's blur or the list unmounts before the click lands — the
           * same Android-WebView rule already recorded in MentionInput.tsx,
           * GlobalSearch.tsx and the caption @mention list.
           */
          onPointerDown={(e) => {
            e.preventDefault();
            onPick(s);
          }}
          onMouseEnter={() => onFocusIdx(i)}
          className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${
            i === focusIdx ? "bg-accent" : ""
          }`}
        >
          <span className="min-w-0 truncate font-medium">#{s.display_tag}</span>
          {/*
            People first, posts second, and never the other way round. On this
            platform #50mmretinaworld has 11 posts from one person — showing
            "11 posts" as the headline number would recommend one member's
            private tag to everybody who typed "#50".
          */}
          <span className="shrink-0 text-xs text-muted-foreground">
            {peopleLabel(s.unique_user_count)} · {postsLabel(s.post_count)}
          </span>
        </button>
      ))}
    </div>
  );
}
