import { useState, useCallback } from "react";
import { downloadImageAsJpeg } from "@/lib/imageCompression";

/**
 * Hook providing a download handler with loading state.
 * Shows a spinner while Canvas converts WebP → JPEG for download.
 */
export function useDownloadImage() {
  const [downloading, setDownloading] = useState<string | null>(null);

  const download = useCallback(async (url: string, fileName?: string) => {
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
