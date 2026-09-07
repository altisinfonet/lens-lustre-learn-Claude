import { Download, Loader2 } from "lucide-react";

interface DownloadButtonProps {
  downloading: boolean;
  onClick: (e: React.MouseEvent) => void;
  className?: string;
  iconSize?: string;
  title?: string;
  /**
   * The ACCESSIBLE name. `title` is a tooltip: VoiceOver and TalkBack announce
   * it inconsistently and some configurations skip it entirely, so a button
   * whose only text was an icon and a title announced as "button". Measured by
   * the Auditor in the deployed lightbox, 2026-09-06. Defaults to `title` so
   * every existing caller gains a real name without changing.
   */
  ariaLabel?: string;
}

/**
 * Reusable download button with loading spinner.
 */
const DownloadButton = ({
  downloading,
  onClick,
  className = "",
  iconSize = "h-4 w-4",
  title = "Download",
  ariaLabel,
}: DownloadButtonProps) => (
  <button
    onClick={onClick}
    disabled={downloading}
    className={className}
    title={downloading ? "Converting…" : title}
    aria-label={ariaLabel ?? title}
  >
    {downloading ? (
      <Loader2 className={`${iconSize} animate-spin`} />
    ) : (
      <Download className={iconSize} />
    )}
  </button>
);

export default DownloadButton;
