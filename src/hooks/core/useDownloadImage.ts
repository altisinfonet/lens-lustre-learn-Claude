import { useState, useCallback } from "react";
import { downloadImageAsJpeg } from "@/lib/imageCompression";
import { originalFor } from "@/lib/media/resolvedMedia";

/**
 * Hook providing a download handler with loading state.
 * Shows a spinner while Canvas converts WebP → JPEG for download.
 */
export function useDownloadImage() {
  const [downloading, setDownloading] = useState<string | null>(null);

  const download = useCallback(async (shownUrl: string, fileName?: string) => {
    // S3-c: a derivative on screen downloads its ORIGINAL (unchanged for every other URL).
    const url = originalFor(shownUrl);
    if (downloading) return;
    setDownloading(url);
    try {
      await downloadImageAsJpeg(url, fileName);
    } catch {
      window.open(url, "_blank");
    } finally {
      setDownloading(null);
    }
  }, [downloading]);

  return { downloading, download };
}
