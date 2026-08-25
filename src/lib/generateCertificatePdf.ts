import jsPDF from "jspdf";
import { SITE_ORIGIN } from "@/lib/publicUrl";
import QRCode from "qrcode";
import { getSiteLogoUrl } from "@/hooks/core/useSiteLogo";
import { supabase } from "@/integrations/supabase/client";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function imageToPngDataUrl(img: HTMLImageElement, opacity?: number, grayscale?: boolean): string {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context not available");
  ctx.drawImage(img, 0, 0);
  if (grayscale) {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const avg = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      d[i] = d[i + 1] = d[i + 2] = avg;
    }
    ctx.putImageData(imageData, 0, 0);
  }
  if (opacity !== undefined) {
    const c2 = document.createElement("canvas");
    c2.width = canvas.width;
    c2.height = canvas.height;
    const ctx2 = c2.getContext("2d")!;
    ctx2.globalAlpha = opacity;
    ctx2.drawImage(canvas, 0, 0);
    return c2.toDataURL("image/png");
  }
  return canvas.toDataURL("image/png");
}

// Canonical cert.type values (must mirror DB CHECK constraint on public.certificates.type)
export type CertificateType =
  | "course_completion"
  | "competition_winner"
  | "winner"
  | "finalist"
  | "participation_r1"
  | "participation_r2"
  | "participation_r3"
  | "participation_r4"
  // Legacy short-form aliases still accepted by the renderer
  | "course"
  | "competition";

interface CertificateData {
  recipientName: string;
  courseTitle: string;
  issueDate: string;
  certificateId: string;
  verificationToken?: string;
  displayCertificateId?: string;
  type?: CertificateType;
}

// Per-tier renderer config — drives the PDF copy for each canonical cert.type
interface TierConfig {
  ofText: string;          // "OF ACHIEVEMENT" / "OF COMPLETION" / "OF PARTICIPATION"
  presentText: string;     // "This certificate is proudly presented to"
  completionText: string;  // line above the title block
  dedicationText: string;  // line below the title block
}

const TIER_CONFIG: Record<string, TierConfig> = {
  course_completion: {
    ofText: "OF COMPLETION",
    presentText: "This certificate is proudly presented to",
    completionText: "for successfully completing the course",
    dedicationText: "demonstrating dedication, commitment, and proficiency in the subject.",
  },
  competition_winner: {
    ofText: "OF ACHIEVEMENT",
    presentText: "This certificate is proudly presented to",
    completionText: "for outstanding achievement in",
    dedicationText: "demonstrating exceptional skill, creativity, and dedication to the craft.",
  },
  winner: {
    ofText: "OF EXCELLENCE",
    presentText: "This certificate is proudly awarded to",
    completionText: "as the Winner of",
    dedicationText: "in recognition of exceptional artistry, vision, and mastery of the craft.",
  },
  finalist: {
    ofText: "OF DISTINCTION",
    presentText: "This certificate is proudly presented to",
    completionText: "as a Finalist in",
    dedicationText: "for distinguished work selected among the finest entries of the competition.",
  },
  participation_r1: {
    ofText: "OF PARTICIPATION",
    presentText: "This certificate is presented to",
    completionText: "for participation in Round 1 of",
    dedicationText: "in appreciation of the courage to share original work with the community.",
  },
  participation_r2: {
    ofText: "OF PARTICIPATION",
    presentText: "This certificate is presented to",
    completionText: "for advancing to Round 2 of",
    dedicationText: "in recognition of work that earned a place in the second round of judging.",
  },
  participation_r3: {
    ofText: "OF MERIT",
    presentText: "This certificate is presented to",
    completionText: "for advancing to Round 3 of",
    dedicationText: "in recognition of work that progressed to the semi-final stage of the competition.",
  },
  participation_r4: {
    ofText: "OF MERIT",
    presentText: "This certificate is presented to",
    completionText: "for reaching Round 4 of",
    dedicationText: "in recognition of work that advanced to the final round of the competition.",
  },
};

// Map legacy short-form aliases to canonical keys
function resolveTier(type?: CertificateType): TierConfig {
  if (!type) return TIER_CONFIG.course_completion;
  if (type === "course") return TIER_CONFIG.course_completion;
  if (type === "competition") return TIER_CONFIG.competition_winner;
  return TIER_CONFIG[type] ?? TIER_CONFIG.course_completion;
}

async function fetchCertAsset(key: string): Promise<string | null> {
  try {
    const { data } = await supabase
      .from("site_settings")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    if (data?.value) {
      const v = data.value as unknown;
      let url = "";
      if (typeof v === "string") url = (v as string).replace(/^"+|"+$/g, "");
      else if (v && typeof v === "object" && "url" in (v as any)) url = (v as any).url;
      if (url) return url;
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * ⚠ THE DRAWING SURFACE — WHY THIS INTERFACE EXISTS.
 *
 * The preview used to be `<iframe src={blobUrl}>` pointing at the generated
 * PDF. Two things were wrong with that, and only one of them was the CSP:
 *
 *   1. `frame-src` did not list `blob:`, so the browser refused the frame and
 *      the member saw "This content is blocked."
 *   2. Even with the frame allowed, an iframe only shows a PDF if the browser
 *      HAS a built-in PDF viewer. An Android WebView does not. Neither do
 *      several in-app browsers. Widening the CSP would have fixed the desktop
 *      symptom and left the app broken.
 *
 * So the preview no longer shows a PDF at all — it shows an image, drawn by
 * the SAME routine that draws the PDF. `img-src` already permits `blob:` and
 * `data:`, so nothing had to be loosened, and an <img> renders everywhere.
 *
 * The methods below are exactly the jsPDF calls `drawCertificate` makes, in
 * millimetres, with font sizes in points. jsPDF satisfies this interface as it
 * stands, so the PDF path is unchanged BY CONSTRUCTION rather than by
 * inspection — there is one layout, and it cannot drift from itself.
 */
export interface CertificateSurface {
  setFillColor(r: number, g: number, b: number): void;
  setDrawColor(r: number, g: number, b: number): void;
  setTextColor(r: number, g: number, b: number): void;
  setLineWidth(mm: number): void;
  setFont(family: string, style: string): void;
  setFontSize(pt: number): void;
  text(text: string, x: number, y: number, opts?: { align?: string }): void;
  line(x1: number, y1: number, x2: number, y2: number): void;
  circle(x: number, y: number, r: number, style?: string): void;
  rect(x: number, y: number, w: number, h: number, style?: string): void;
  triangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, style?: string): void;
  addImage(data: string, format: string, x: number, y: number, w: number, h: number): void;
  splitTextToSize(text: string, maxWidth: number): string[];
  getTextWidth(text: string): number;
}

/** A4 landscape, in millimetres. The only page geometry there is. */
export const CERT_PAGE_W = 297;
export const CERT_PAGE_H = 210;

// --- Gold ornamental drawing helpers ---

const GOLD: [number, number, number] = [184, 150, 80];
const GOLD_LIGHT: [number, number, number] = [210, 185, 120];
const TEXT_DARK: [number, number, number] = [40, 40, 40];
const TEXT_MUTED: [number, number, number] = [100, 95, 88];
const TEXT_SUBTLE: [number, number, number] = [150, 145, 138];
const BG_COLOR: [number, number, number] = [255, 253, 248];

function drawCornerFlourish(d: CertificateSurface, cx: number, cy: number, flipX: number, flipY: number) {
  d.setDrawColor(...GOLD);
  d.setLineWidth(0.4);

  // Main corner L-shape
  const len = 20;
  const inset = 3;
  d.line(cx, cy, cx + len * flipX, cy);
  d.line(cx, cy, cx, cy + len * flipY);

  // Inner L
  d.line(cx + inset * flipX, cy + inset * flipY, cx + (len - 4) * flipX, cy + inset * flipY);
  d.line(cx + inset * flipX, cy + inset * flipY, cx + inset * flipX, cy + (len - 4) * flipY);

  // Small decorative circle at corner
  d.setFillColor(...GOLD);
  d.circle(cx + 1.5 * flipX, cy + 1.5 * flipY, 1, "F");

  // Ornamental curl lines
  d.setLineWidth(0.25);
  const curlLen = 10;
  // Horizontal curl
  d.line(cx + (len - 2) * flipX, cy, cx + (len + curlLen) * flipX, cy);
  d.circle(cx + (len + curlLen + 1.2) * flipX, cy, 0.6, "F");
  // Vertical curl
  d.line(cx, cy + (len - 2) * flipY, cx, cy + (len + curlLen) * flipY);
  d.circle(cx, cy + (len + curlLen + 1.2) * flipY, 0.6, "F");

  // Decorative scroll near corner
  d.setLineWidth(0.2);
  for (let r = 2; r <= 5; r += 1.5) {
    const startAngle = flipX > 0 && flipY > 0 ? 180 : flipX < 0 && flipY > 0 ? 270 : flipX > 0 && flipY < 0 ? 90 : 0;
    // Draw small arc approximation
    const steps = 8;
    for (let s = 0; s < steps; s++) {
      const a1 = (startAngle + s * (90 / steps)) * Math.PI / 180;
      const a2 = (startAngle + (s + 1) * (90 / steps)) * Math.PI / 180;
      d.line(
        cx + Math.cos(a1) * r * 1.2, cy + Math.sin(a1) * r * 1.2,
        cx + Math.cos(a2) * r * 1.2, cy + Math.sin(a2) * r * 1.2,
      );
    }
  }
}

function drawGoldBorder(d: CertificateSurface, W: number, H: number) {
  const margin = 12;
  const inner = 16;

  // Outer gold border
  d.setDrawColor(...GOLD);
  d.setLineWidth(0.8);
  d.rect(margin, margin, W - margin * 2, H - margin * 2);

  // Inner thin border
  d.setDrawColor(...GOLD_LIGHT);
  d.setLineWidth(0.3);
  d.rect(inner, inner, W - inner * 2, H - inner * 2);

  // Corner flourishes
  drawCornerFlourish(d, inner + 1, inner + 1, 1, 1);      // top-left
  drawCornerFlourish(d, W - inner - 1, inner + 1, -1, 1);  // top-right
  drawCornerFlourish(d, inner + 1, H - inner - 1, 1, -1);  // bottom-left
  drawCornerFlourish(d, W - inner - 1, H - inner - 1, -1, -1); // bottom-right

  // Top center ornamental line
  const topLineY = inner + 6;
  d.setDrawColor(...GOLD);
  d.setLineWidth(0.3);
  d.line(W / 2 - 50, topLineY, W / 2 - 10, topLineY);
  d.line(W / 2 + 10, topLineY, W / 2 + 50, topLineY);
  // Small diamond center
  d.setFillColor(...GOLD);
  d.triangle(W / 2, topLineY - 2, W / 2 - 2, topLineY, W / 2, topLineY + 2, "F");
  d.triangle(W / 2, topLineY - 2, W / 2 + 2, topLineY, W / 2, topLineY + 2, "F");

  // Bottom center — no ornamental line/diamond (clean footer area)
}

/**
 * The one and only certificate layout. Given a surface it draws the same
 * certificate to a PDF page or to a canvas — see CertificateSurface above.
 */
async function drawCertificate(d: CertificateSurface, {
  recipientName,
  courseTitle,
  issueDate,
  certificateId,
  verificationToken,
  displayCertificateId,
  type = "course_completion",
}: CertificateData) {
  const tier = resolveTier(type);
  const W = 297;
  const H = 210;

  // --- Background ---
  d.setFillColor(...BG_COLOR);
  d.rect(0, 0, W, H, "F");

  // --- Gold ornamental border + corners ---
  drawGoldBorder(d, W, H);

  // --- Watermark: Large logo in center at 10% opacity, grayscale ---
  try {
    let wmLogoUrl = await fetchCertAsset("certificate_logo");
    if (!wmLogoUrl) wmLogoUrl = await getSiteLogoUrl();
    if (wmLogoUrl && wmLogoUrl.startsWith("/")) wmLogoUrl = `${window.location.origin}${wmLogoUrl}`;
    if (wmLogoUrl) {
      const wmImg = await loadImage(wmLogoUrl);
      const wmDataUrl = imageToPngDataUrl(wmImg, 0.10, true);
      const wmSize = 100;
      d.addImage(wmDataUrl, "PNG", W / 2 - wmSize / 2, H / 2 - wmSize / 2 + 5, wmSize, wmSize);
    }
  } catch { /* watermark failed */ }

  // ============== TEXT CONTENT ==============
  let y = 38;

  // --- "CERTIFICATE" ---
  d.setFont("times", "normal");
  d.setFontSize(36);
  d.setTextColor(...GOLD);
  d.text("CERTIFICATE", W / 2, y, { align: "center" });
  y += 12;

  // --- "OF ACHIEVEMENT / OF COMPLETION" ---
  d.setFont("times", "normal");
  d.setFontSize(18);
  d.setTextColor(...GOLD);
  const ofText = tier.ofText;
  d.text(ofText, W / 2, y, { align: "center" });
  y += 18;

  // --- "This certificate is proudly presented to" ---
  d.setFont("times", "normal");
  d.setFontSize(14);
  d.setTextColor(...TEXT_MUTED);
  const presentText = tier.presentText;
  d.text(presentText, W / 2, y, { align: "center" });
  y += 14;

  // --- Recipient Name (elegant script-like) ---
  d.setFont("times", "bolditalic");
  d.setFontSize(38);
  d.setTextColor(...TEXT_DARK);
  d.text(recipientName, W / 2, y, { align: "center" });
  y += 14;

  // --- "for successfully completing the course" ---
  d.setFont("times", "normal");
  d.setFontSize(14);
  d.setTextColor(...TEXT_MUTED);
  const completionText = tier.completionText;
  d.text(completionText, W / 2, y, { align: "center" });
  y += 12;

  // --- Course Title ---
  d.setFont("times", "bolditalic");
  d.setFontSize(22);
  d.setTextColor(...TEXT_DARK);
  const maxTitleWidth = 220;
  const titleLines = d.splitTextToSize(`"${courseTitle}"`, maxTitleWidth);
  titleLines.forEach((line: string, i: number) => {
    d.text(line, W / 2, y + i * 9, { align: "center" });
  });
  y += titleLines.length * 9 + 4;

  // --- Dedication text ---
  d.setFont("times", "italic");
  d.setFontSize(12);
  d.setTextColor(...TEXT_SUBTLE);
  const dedicationText = tier.dedicationText;
  d.text(dedicationText, W / 2, y, { align: "center" });

  // ============== FOOTER SECTION ==============
  const footerY = H - 40;
  const leftX = 60;
  const centerX = W / 2;
  const rightX = W - 60;

  // --- Left: Date ---
  d.setFont("times", "normal");
  d.setFontSize(12);
  d.setTextColor(...TEXT_DARK);
  d.text(issueDate, leftX, footerY, { align: "center" });
  // Underline below date
  const dateTextW = d.getTextWidth(issueDate);
  d.setDrawColor(...GOLD_LIGHT);
  d.setLineWidth(0.3);
  d.line(leftX - dateTextW / 2, footerY + 2, leftX + dateTextW / 2, footerY + 2);
  // Label
  d.setFont("times", "normal");
  d.setFontSize(9);
  d.setTextColor(...TEXT_SUBTLE);
  d.text("DATE", leftX, footerY + 8, { align: "center" });

  // --- Center: Logo (30mm height, aligned with date/signature baseline) ---
  let footerLogoDrawn = false;
  try {
    let logoUrl = await fetchCertAsset("certificate_logo");
    if (!logoUrl) logoUrl = await getSiteLogoUrl();
    if (logoUrl && logoUrl.startsWith("/")) logoUrl = `${window.location.origin}${logoUrl}`;
    if (logoUrl) {
      const logoImg = await loadImage(logoUrl);
      const logoDataUrl = imageToPngDataUrl(logoImg);
      const logoH = 30;
      const logoW = (logoImg.width / logoImg.height) * logoH;
      // Align logo bottom edge with footerY so it sits at same baseline as date/signature
      d.addImage(logoDataUrl, "PNG", centerX - logoW / 2, footerY - logoH, logoW, logoH);
      footerLogoDrawn = true;
    }
  } catch { /* logo failed */ }
  if (!footerLogoDrawn) {
    d.setDrawColor(...GOLD);
    d.setLineWidth(0.4);
    d.circle(centerX, footerY - 15, 10, "S");
  }
  // "50MM RETINA WORLD" below logo
  d.setFont("times", "bold");
  d.setFontSize(9);
  d.setTextColor(...GOLD);
  d.text("50MM RETINA WORLD", centerX, footerY + 8, { align: "center" });

  // --- Right: Signature ---
  try {
    const sigUrl = await fetchCertAsset("certificate_signature");
    if (sigUrl) {
      const sigImg = await loadImage(sigUrl);
      const sigDataUrl = imageToPngDataUrl(sigImg);
      const sigH = 18;
      const sigW = (sigImg.width / sigImg.height) * sigH;
      d.addImage(sigDataUrl, "PNG", rightX - sigW / 2, footerY - sigH - 2, sigW, sigH);
    }
  } catch { /* signature load failed */ }
  // Underline for signature
  d.setDrawColor(...GOLD_LIGHT);
  d.setLineWidth(0.3);
  d.line(rightX - 25, footerY + 2, rightX + 25, footerY + 2);
  // Label
  d.setFont("times", "normal");
  d.setFontSize(9);
  d.setTextColor(...TEXT_SUBTLE);
  d.text("AUTHORIZED SIGNATURE", rightX, footerY + 8, { align: "center" });

  // --- Certificate ID (no underline, no diamond) ---
  const displayId = displayCertificateId || certificateId;
  d.setFont("times", "normal");
  d.setFontSize(8);
  d.setTextColor(...TEXT_SUBTLE);
  d.text(`Certificate ID: ${displayId}`, W / 2, H - 22, { align: "center" });

  // --- Verification URL ---
  // Always the canonical origin — inside the installed app location.origin is
  // https://localhost, and the old hostname guard was a special case of what
  // publicUrl.ts now solves for every link that leaves the app.
  const origin = SITE_ORIGIN;
  const verifyUrl = verificationToken
    ? `${origin}/certificate/${verificationToken}`
    : `${origin}/verify?id=${certificateId}`;
  d.setFontSize(6);
  d.setTextColor(...TEXT_SUBTLE);
  d.text(`Verify at: ${verifyUrl}`, W / 2, H - 17, { align: "center" });

  // --- QR Code (bottom-right corner) ---
  try {
    const qrDataUrl = await QRCode.toDataURL(verifyUrl, {
      width: 200,
      margin: 1,
      color: { dark: "#b89650", light: "#fffdf8" },
    });
    const qrSize = 18;
    d.addImage(qrDataUrl, "PNG", W - 34, H - 34, qrSize, qrSize);
    d.setFontSize(5);
    d.setTextColor(...TEXT_SUBTLE);
    d.text("Scan to verify", W - 34 + qrSize / 2, H - 14, { align: "center" });
  } catch { /* QR failed */ }

}

/** The downloadable artefact. Unchanged public API. */
export const generateCertificatePdf = async (data: CertificateData) => {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  await drawCertificate(doc as unknown as CertificateSurface, data);
  return doc;
};

/**
 * The SAME certificate, as a PNG, for on-screen viewing.
 *
 * ⚠ This is not a second renderer. It is the same `drawCertificate` call with a
 * different surface, so the preview cannot show something the PDF does not.
 * The old preview framed the PDF in an <iframe>, which the CSP refused
 * (`frame-src` carries no `blob:`) and which an Android WebView could not have
 * displayed even if it had been allowed. An <img> works everywhere, and
 * `img-src` already permits `blob:` and `data:` — no policy was widened.
 */
export const renderCertificateToPng = async (data: CertificateData): Promise<string> => {
  const { createCanvasSurface } = await import("./certificateCanvas");
  const { surface, toPngDataUrl } = createCanvasSurface();
  await drawCertificate(surface, data);
  return toPngDataUrl();
};
