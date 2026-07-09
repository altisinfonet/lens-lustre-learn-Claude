import { Download, Loader2 } from "lucide-react";

interface DownloadButtonProps {
  downloading: boolean;
  onClick: (e: React.MouseEvent) => void;
  className?: string;
  iconSize?: string;
  title?: string;
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
}: DownloadButtonProps) => (
  <button
    onClick={onClick}
    disabled={downloading}
    className={className}
    title={downloading ? "Converting…" : title}
  >
    {downloading ? (
      <Loader2 className={`${iconSize} animate-spin`} />
    ) : (
      <Download className={iconSize} />
    )}
  </button>
);

export default DownloadButton;
