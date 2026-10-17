/**
 * BUG 4 — the admin box "Website to open when clicked" says what it accepts.
 *
 * It took anything, and "Hideaway Resort and Hotel" became a "Learn more" bar
 * that opened a broken page. It now takes what Meta Ads Manager takes (https://,
 * http://, or a bare "site.com", saved as https://site.com), says under the box
 * why anything else is refused, and does not save it. The
 * rule itself is src/lib/ads/adLink.ts, the same one the ad card uses to decide
 * whether to draw a CTA, so the box cannot accept what the card would ignore.
 */
import { useEffect, useState, type CSSProperties } from "react";
import { adLink, adLinkProblem, adLinkToSave, AD_LINK_STORED_WARNING } from "@/lib/ads/adLink";

/** The message under a link box, when what is in it would not work. */
export const AdLinkProblem = ({ value }: { value: string }) => {
  const problem = adLinkProblem(value);
  return problem ? (
    <p role="alert" className="mt-1 text-xs text-destructive" data-testid="ad-link-problem">
      {problem}
    </p>
  ) : null;
};

/**
 * No silent loss: an ad ALREADY SAVED with a link that fails the rule (plain
 * text, from before the rule existed) draws no button on the feed. This says
 * so on the ad's own row, from the value already loaded, so the admin knows
 * to add a link. Nothing for an empty link: that is "no link" by choice.
 */
export const AdStoredLinkWarning = ({ stored }: { stored: string | null | undefined }) =>
  (stored ?? "").trim() !== "" && adLink(stored) === null ? (
    <p role="status" className="mt-1 text-xs font-medium text-amber-600 dark:text-amber-400" data-testid="ad-link-stored-warning">
      {AD_LINK_STORED_WARNING}
    </p>
  ) : null;

interface Props {
  value: string;
  className?: string;
  style?: CSSProperties;
  /** Called on blur with the address to store (empty, or the parsed link), only when it is valid and has changed. */
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
          if (invalid) return;
          const next = adLinkToSave(draft);
          setDraft(next);
          if (next === value) return;
          onSave(next);
        }}
      />
      <AdLinkProblem value={draft} />
      <AdStoredLinkWarning stored={value} />
    </div>
  );
};
