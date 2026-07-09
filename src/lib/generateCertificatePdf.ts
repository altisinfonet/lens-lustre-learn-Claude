import jsPDF from "jspdf";
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

// --- Gold ornamental drawing helpers ---

const GOLD: [number, number, number] = [184, 150, 80];
const GOLD_LIGHT: [number, number, number] = [210, 185, 120];
const TEXT_DARK: [number, number, number] = [40, 40, 40];
const TEXT_MUTED: [number, number, number] = [100, 95, 88];
const TEXT_SUBTLE: [number, number, number] = [150, 145, 138];
const BG_COLOR: [number, number, number] = [255, 253, 248];

function drawCornerFlourish(doc: jsPDF, cx: number, cy: number, flipX: number, flipY: number) {
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.4);

  // Main corner L-shape
  const len = 20;
  const inset = 3;
  doc.line(cx, cy, cx + len * flipX, cy);
  doc.line(cx, cy, cx, cy + len * flipY);

  // Inner L
  doc.line(cx + inset * flipX, cy + inset * flipY, cx + (len - 4) * flipX, cy + inset * flipY);
  doc.line(cx + inset * flipX, cy + inset * flipY, cx + inset * flipX, cy + (len - 4) * flipY);

  // Small decorative circle at corner
  doc.setFillColor(...GOLD);
  doc.circle(cx + 1.5 * flipX, cy + 1.5 * flipY, 1, "F");

  // Ornamental curl lines
  doc.setLineWidth(0.25);
  const curlLen = 10;
  // Horizontal curl
  doc.line(cx + (len - 2) * flipX, cy, cx + (len + curlLen) * flipX, cy);
  doc.circle(cx + (len + curlLen + 1.2) * flipX, cy, 0.6, "F");
  // Vertical curl
  doc.line(cx, cy + (len - 2) * flipY, cx, cy + (len + curlLen) * flipY);
  doc.circle(cx, cy + (len + curlLen + 1.2) * flipY, 0.6, "F");

  // Decorative scroll near corner
  doc.setLineWidth(0.2);
  for (let r = 2; r <= 5; r += 1.5) {
    const startAngle = flipX > 0 && flipY > 0 ? 180 : flipX < 0 && flipY > 0 ? 270 : flipX > 0 && flipY < 0 ? 90 : 0;
    // Draw small arc approximation
    const steps = 8;
    for (let s = 0; s < steps; s++) {
      const a1 = (startAngle + s * (90 / steps)) * Math.PI / 180;
      const a2 = (startAngle + (s + 1) * (90 / steps)) * Math.PI / 180;
      doc.line(
        cx + Math.cos(a1) * r * 1.2, cy + Math.sin(a1) * r * 1.2,
        cx + Math.cos(a2) * r * 1.2, cy + Math.sin(a2) * r * 1.2,
      );
    }
  }
}

function drawGoldBorder(doc: jsPDF, W: number, H: number) {
  const margin = 12;
  const inner = 16;

  // Outer gold border
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.8);
  doc.rect(margin, margin, W - margin * 2, H - margin * 2);

  // Inner thin border
  doc.setDrawColor(...GOLD_LIGHT);
  doc.setLineWidth(0.3);
  doc.rect(inner, inner, W - inner * 2, H - inner * 2);

  // Corner flourishes
  drawCornerFlourish(doc, inner + 1, inner + 1, 1, 1);      // top-left
  drawCornerFlourish(doc, W - inner - 1, inner + 1, -1, 1);  // top-right
  drawCornerFlourish(doc, inner + 1, H - inner - 1, 1, -1);  // bottom-left
  drawCornerFlourish(doc, W - inner - 1, H - inner - 1, -1, -1); // bottom-right

  // Top center ornamental line
  const topLineY = inner + 6;
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.3);
  doc.line(W / 2 - 50, topLineY, W / 2 - 10, topLineY);
  doc.line(W / 2 + 10, topLineY, W / 2 + 50, topLineY);
  // Small diamond center
  doc.setFillColor(...GOLD);
  doc.triangle(W / 2, topLineY - 2, W / 2 - 2, topLineY, W / 2, topLineY + 2, "F");
  doc.triangle(W / 2, topLineY - 2, W / 2 + 2, topLineY, W / 2, topLineY + 2, "F");

  // Bottom center — no ornamental line/diamond (clean footer area)
}

export const generateCertificatePdf = async ({
  recipientName,
  courseTitle,
  issueDate,
  certificateId,
  verificationToken,
  displayCertificateId,
  type = "course_completion",
}: CertificateData) => {
  const tier = resolveTier(type);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = 297;
  const H = 210;

  // --- Background ---
  doc.setFillColor(...BG_COLOR);
  doc.rect(0, 0, W, H, "F");

  // --- Gold ornamental border + corners ---
  drawGoldBorder(doc, W, H);

  // --- Watermark: Large logo in center at 10% opacity, grayscale ---
  try {
    let wmLogoUrl = await fetchCertAsset("certificate_logo");
    if (!wmLogoUrl) wmLogoUrl = await getSiteLogoUrl();
    if (wmLogoUrl && wmLogoUrl.startsWith("/")) wmLogoUrl = `${window.location.origin}${wmLogoUrl}`;
    if (wmLogoUrl) {
      const wmImg = await loadImage(wmLogoUrl);
      const wmDataUrl = imageToPngDataUrl(wmImg, 0.10, true);
      const wmSize = 100;
      doc.addImage(wmDataUrl, "PNG", W / 2 - wmSize / 2, H / 2 - wmSize / 2 + 5, wmSize, wmSize);
    }
  } catch { /* watermark failed */ }

  // ============== TEXT CONTENT ==============
  let y = 38;

  // --- "CERTIFICATE" ---
  doc.setFont("times", "normal");
  doc.setFontSize(36);
  doc.setTextColor(...GOLD);
  doc.text("CERTIFICATE", W / 2, y, { align: "center" });
  y += 12;

  // --- "OF ACHIEVEMENT / OF COMPLETION" ---
  doc.setFont("times", "normal");
  doc.setFontSize(18);
  doc.setTextColor(...GOLD);
  const ofText = tier.ofText;
  doc.text(ofText, W / 2, y, { align: "center" });
  y += 18;

  // --- "This certificate is proudly presented to" ---
  doc.setFont("times", "normal");
  doc.setFontSize(14);
  doc.setTextColor(...TEXT_MUTED);
  const presentText = tier.presentText;
  doc.text(presentText, W / 2, y, { align: "center" });
  y += 14;

  // --- Recipient Name (elegant script-like) ---
  doc.setFont("times", "bolditalic");
  doc.setFontSize(38);
  doc.setTextColor(...TEXT_DARK);
  doc.text(recipientName, W / 2, y, { align: "center" });
  y += 14;

  // --- "for successfully completing the course" ---
  doc.setFont("times", "normal");
  doc.setFontSize(14);
  doc.setTextColor(...TEXT_MUTED);
  const completionText = tier.completionText;
  doc.text(completionText, W / 2, y, { align: "center" });
  y += 12;

  // --- Course Title ---
  doc.setFont("times", "bolditalic");
  doc.setFontSize(22);
  doc.setTextColor(...TEXT_DARK);
  const maxTitleWidth = 220;
  const titleLines = doc.splitTextToSize(`"${courseTitle}"`, maxTitleWidth);
  titleLines.forEach((line: string, i: number) => {
    doc.text(line, W / 2, y + i * 9, { align: "center" });
  });
  y += titleLines.length * 9 + 4;

  // --- Dedication text ---
  doc.setFont("times", "italic");
  doc.setFontSize(12);
  doc.setTextColor(...TEXT_SUBTLE);
  const dedicationText = tier.dedicationText;
  doc.text(dedicationText, W / 2, y, { align: "center" });

  // ============== FOOTER SECTION ==============
  const footerY = H - 40;
  const leftX = 60;
  const centerX = W / 2;
  const rightX = W - 60;

  // --- Left: Date ---
  doc.setFont("times", "normal");
  doc.setFontSize(12);
  doc.setTextColor(...TEXT_DARK);
  doc.text(issueDate, leftX, footerY, { align: "center" });
  // Underline below date
  const dateTextW = doc.getTextWidth(issueDate);
  doc.setDrawColor(...GOLD_LIGHT);
  doc.setLineWidth(0.3);
  doc.line(leftX - dateTextW / 2, footerY + 2, leftX + dateTextW / 2, footerY + 2);
  // Label
  doc.setFont("times", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...TEXT_SUBTLE);
  doc.text("DATE", leftX, footerY + 8, { align: "center" });

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
      doc.addImage(logoDataUrl, "PNG", centerX - logoW / 2, footerY - logoH, logoW, logoH);
      footerLogoDrawn = true;
    }
  } catch { /* logo failed */ }
  if (!footerLogoDrawn) {
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(0.4);
    doc.circle(centerX, footerY - 15, 10, "S");
  }
  // "50MM RETINA WORLD" below logo
  doc.setFont("times", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...GOLD);
  doc.text("50MM RETINA WORLD", centerX, footerY + 8, { align: "center" });

  // --- Right: Signature ---
  try {
    const sigUrl = await fetchCertAsset("certificate_signature");
    if (sigUrl) {
      const sigImg = await loadImage(sigUrl);
      const sigDataUrl = imageToPngDataUrl(sigImg);
      const sigH = 18;
      const sigW = (sigImg.width / sigImg.height) * sigH;
      doc.addImage(sigDataUrl, "PNG", rightX - sigW / 2, footerY - sigH - 2, sigW, sigH);
    }
  } catch { /* signature load failed */ }
  // Underline for signature
  doc.setDrawColor(...GOLD_LIGHT);
  doc.setLineWidth(0.3);
  doc.line(rightX - 25, footerY + 2, rightX + 25, footerY + 2);
  // Label
  doc.setFont("times", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...TEXT_SUBTLE);
  doc.text("AUTHORIZED SIGNATURE", rightX, footerY + 8, { align: "center" });

  // --- Certificate ID (no underline, no diamond) ---
  const displayId = displayCertificateId || certificateId;
  doc.setFont("times", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...TEXT_SUBTLE);
  doc.text(`Certificate ID: ${displayId}`, W / 2, H - 22, { align: "center" });

  // --- Verification URL ---
  const publishedOrigin = "https://50mmretina.com";
  const origin = window.location.hostname === "localhost" || window.location.hostname.includes("preview")
    ? publishedOrigin
    : window.location.origin;
  const verifyUrl = verificationToken
    ? `${origin}/certificate/${verificationToken}`
    : `${origin}/verify?id=${certificateId}`;
  doc.setFontSize(6);
  doc.setTextColor(...TEXT_SUBTLE);
  doc.text(`Verify at: ${verifyUrl}`, W / 2, H - 17, { align: "center" });

  // --- QR Code (bottom-right corner) ---
  try {
    const qrDataUrl = await QRCode.toDataURL(verifyUrl, {
      width: 200,
      margin: 1,
      color: { dark: "#b89650", light: "#fffdf8" },
    });
    const qrSize = 18;
    doc.addImage(qrDataUrl, "PNG", W - 34, H - 34, qrSize, qrSize);
    doc.setFontSize(5);
    doc.setTextColor(...TEXT_SUBTLE);
    doc.text("Scan to verify", W - 34 + qrSize / 2, H - 14, { align: "center" });
  } catch { /* QR failed */ }

  return doc;
};
