/**
 * BUG 4 — the admin box "Website to open when clicked" says what it accepts.
 *
 * It took anything, and "Hideaway Resort and Hotel" became a "Learn more" bar
 * that opened a broken page. It now says, under the box, that only a full
 * https:// address works — and an address that is not one is not saved. The
 * rule itself is src/lib/ads/adLink.ts, the same one the ad card uses to decide
 * whether to draw a CTA, so the box cannot accept what the card would ignore.
 */
import { useEffect, useState, type CSSProperties } from "react";
import { adLinkProblem } from "@/lib/ads/adLink";

/** The message under a link box, when what is in it would not work. */
export const AdLinkProblem = ({ value }: { value: string }) => {
  const problem = adLinkProblem(value);
  return problem ? (
    <p role="alert" className="mt-1 text-xs text-destructive" data-testid="ad-link-problem">
      {problem}
    </p>
  ) : null;
};

interface Props {
  value: string;
  className?: string;
  style?: CSSProperties;
  /** Called on blur with the trimmed address, only when it is empty or a valid https:// link and has changed. */
  onSave: (next: string) => void;
}

/** The creative library's box: saves on blur, and only what would work. */
export const AdLinkInput = ({ value, className, style, onSave }: Props) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const invalid = adLinkProblem(draft) !== null;
  return (
    <div>
      <input
        className={className}
        style={style}
        value={draft}
        inputMode="url"
        aria-invalid={invalid}
        placeholder="Website to open when clicked (optional)"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const next = draft.trim();
          if (invalid || next === value) return;
          onSave(next);
        }}
      />
      <AdLinkProblem value={draft} />
    </div>
  );
};
