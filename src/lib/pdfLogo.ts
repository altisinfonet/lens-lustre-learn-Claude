// Centralized PDF logo loader.
// Resolves the site logo URL (or an explicit override), fetches the image with
// CORS, and re-encodes it to a PNG dataURL via canvas so jsPDF's addImage()
// always receives a format it accepts (PNG/JPEG). Returns null on any failure
// so callers can keep their existing fallback paths.
import { getSiteLogoUrl } from "@/hooks/core/useSiteLogo";

export interface PdfLogo {
  dataUrl: string;
  width: number;
  height: number;
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export async function loadPdfLogo(overrideUrl?: string | null): Promise<PdfLogo | null> {
  try {
    let url = overrideUrl || (await getSiteLogoUrl());
    if (!url) return null;
    if (url.startsWith("/")) url = `${window.location.origin}${url}`;

    const img = await loadImg(url);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return null;

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return { dataUrl: canvas.toDataURL("image/png"), width: w, height: h };
  } catch {
    return null;
  }
}
