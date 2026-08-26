import jsPDF from "jspdf";
import { SITE_ORIGIN } from "@/lib/publicUrl";
import QRCode from "qrcode";
import { getSiteLogoUrl } from "@/hooks/core/useSiteLogo";
import { supabase } from "@/integrations/supabase/client";

/**
 * Decoded images and their converted data URLs, held for the life of the page.
 * See the note on `fetchCertAsset`: the live admin preview re-renders on a
 * debounce while the admin types, and the grayscale watermark pass walks every
 * pixel of the logo. Doing that per keystroke is what makes a preview feel
 * laggy. Cleared by `clearCertificateAssetCache()` when an asset is replaced.
 */
const imageCache = new Map<string, Promise<HTMLImageElement>>();

function cachedImage(src: string): Promise<HTMLImageElement> {
  const hit = imageCache.get(src);
  if (hit) return hit;
  const p = loadImage(src);
  imageCache.set(src, p);
  return p;
}

/** `imageToPngDataUrl` memoised on (url, opacity, grayscale). */
async function cachedPng(src: string, opacity?: number, grayscale?: boolean): Promise<string> {
  const key = `${src}|${opacity ?? ""}|${grayscale ? "g" : ""}`;
  const hit = assetPngCache.get(key);
  if (hit) {
    const v = await hit;
    if (v) return v;
  }
  const p = cachedImage(src).then((img) => imageToPngDataUrl(img, opacity, grayscale));
  assetPngCache.set(key, p);
  return p;
}

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
  // Hand-issued by an admin
  | "achievement"
  | "custom"
  | "course_completion"
  // Competition awards, written by trg_auto_certificate_r4_award
  | "competition_winner"
  | "competition_runner_up_1"
  | "competition_runner_up_2"
  | "competition_honorary_mention"
  | "competition_special_jury"
  | "competition_top_50"
  | "competition_top_100"
  // Member-requested
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
  /**
   * ⚠ THE ADMIN'S OWN WORDS, AND UNTIL NOW THEY WENT NOWHERE.
   *
   * The issue form has always collected a description and the database has
   * always stored it — a certificate issued on staging on 2026-08-25 carries
   * one — but this renderer had no such field, so it was never printed. The
   * admin typed it, the row kept it, and the certificate ignored it.
   *
   * It is printed in place of the canned closing line beneath the title, which
   * is the slot that line was already occupying. Blank falls back to the
   * wording for the type, so nothing regresses for the automatic kinds.
   */
  description?: string | null;
  /**
   * ⚠ CUSTOM CERTIFICATES ONLY — the line printed under the word CERTIFICATE.
   *
   * Every other type gets that line from `TIER_CONFIG`: OF COMPLETION for a
   * course, OF MERIT for a Top 50, and so on. That is correct, because those
   * types describe a known occasion and the wording must match the placement
   * the member actually earned.
   *
   * `custom` exists precisely because the occasion is NOT one of those, which
   * made the heading the one line on the page the admin could not write. Now
   * they can. Blank falls back to the type's own wording — OF ACHIEVEMENT for
   * `custom` — so nothing already issued changes.
   *
   * The rule is enforced by a CHECK constraint, not by this file:
   * `certificates_heading_only_for_custom`. A renderer guard would be a second
   * copy of the rule and the two would eventually disagree.
   */
  heading?: string | null;
}

// Per-tier renderer config — drives the PDF copy for each canonical cert.type
interface TierConfig {
  ofText: string;          // "OF ACHIEVEMENT" / "OF COMPLETION" / "OF PARTICIPATION"
  presentText: string;     // "This certificate is proudly presented to"
  completionText: string;  // line above the title block
  dedicationText: string;  // line below the title block
}

/**
 * ⚠ EVERY TYPE THE CHECK CONSTRAINT PERMITS MUST HAVE AN ENTRY.
 *
 * This map held 8 of the 16 permitted types and `resolveTier` ended with
 * `?? TIER_CONFIG.course_completion`. So `custom`, `achievement` and all six
 * `competition_*` placements printed **"for successfully completing the
 * course"** on a certificate that had nothing to do with a course. The owner
 * hit it the moment `custom` became issuable: a Custom certificate came out
 * reading Completion of Course.
 *
 * A default that silently substitutes the wrong words is the same defect as a
 * <select> falling back to its first <option>. `certificateTiers.test.ts` pins
 * these keys against the constraint so the two cannot drift again.
 */
const TIER_CONFIG: Record<string, TierConfig> = {
  // ── Hand-issued ──────────────────────────────────────────────────────────
  achievement: {
    ofText: "OF ACHIEVEMENT",
    presentText: "This certificate is proudly presented to",
    completionText: "in recognition of",
    dedicationText: "for work that stands apart and deserves to be marked.",
  },
  custom: {
    // Deliberately neutral: a Custom certificate exists precisely because the
    // occasion does not fit a preset, so the closing line is expected to come
    // from the admin's description rather than from here.
    ofText: "OF ACHIEVEMENT",
    presentText: "This certificate is proudly presented to",
    completionText: "in recognition of",
    dedicationText: "with the appreciation of 50mm Retina World.",
  },
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
  competition_runner_up_1: {
    ofText: "OF EXCELLENCE",
    presentText: "This certificate is proudly awarded to",
    completionText: "as 1st Runner-Up in",
    dedicationText: "in recognition of work placed among the very finest of the competition.",
  },
  competition_runner_up_2: {
    ofText: "OF EXCELLENCE",
    presentText: "This certificate is proudly awarded to",
    completionText: "as 2nd Runner-Up in",
    dedicationText: "in recognition of work placed among the very finest of the competition.",
  },
  competition_honorary_mention: {
    ofText: "OF MERIT",
    presentText: "This certificate is proudly presented to",
    completionText: "awarded an Honorary Mention in",
    dedicationText: "for work the jury singled out for special recognition.",
  },
  competition_special_jury: {
    ofText: "OF DISTINCTION",
    presentText: "This certificate is proudly awarded to",
    completionText: "awarded the Special Jury Award in",
    dedicationText: "chosen by the jury for exceptional artistry and originality.",
  },
  competition_top_50: {
    ofText: "OF MERIT",
    presentText: "This certificate is presented to",
    completionText: "for placing in the Top 50 of",
    dedicationText: "in recognition of work ranked among the fifty finest entries.",
  },
  competition_top_100: {
    ofText: "OF MERIT",
    presentText: "This certificate is presented to",
    completionText: "for placing in the Top 100 of",
    dedicationText: "in recognition of work ranked among the hundred finest entries.",
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

/**
 * Neutral wording for a type this renderer has never heard of.
 *
 * ⚠ NOT `course_completion`. That was the old fallback and it is why a Custom
 * certificate printed "for successfully completing the course": a default that
 * asserts something specific and wrong is worse than one that asserts little.
 * If a new type is added to the constraint and not to TIER_CONFIG, the
 * certificate should read plainly rather than confidently lie about a course.
 */
const NEUTRAL_TIER: TierConfig = {
  ofText: "OF ACHIEVEMENT",
  presentText: "This certificate is proudly presented to",
  completionText: "in recognition of",
  dedicationText: "with the appreciation of 50mm Retina World.",
};

// Map legacy short-form aliases to canonical keys
function resolveTier(type?: CertificateType): TierConfig {
  if (!type) return NEUTRAL_TIER;
  if (type === "course") return TIER_CONFIG.course_completion;
  if (type === "competition") return TIER_CONFIG.competition_winner;
  return TIER_CONFIG[type] ?? NEUTRAL_TIER;
}

/**
 * ⚠ CACHED, BECAUSE THE ADMIN PREVIEW NOW RENDERS WHILE THEY TYPE.
 *
 * Each render asks for the certificate logo, the site logo and the signature.
 * Uncached, a live preview would fire three Supabase reads and three image
 * downloads for every debounced keystroke — a sentence of description would
 * cost dozens of round trips and the preview would lag behind the typing.
 *
 * Certificate assets change only when an admin uploads one, so they are held
 * for the life of the page. `clearCertificateAssetCache()` is called by the
 * uploader the moment a new logo or signature is saved, so the preview never
 * shows the previous one.
 *
 * Promises are cached, not results: two renders racing on first paint share
 * one request instead of issuing two.
 */
const assetUrlCache = new Map<string, Promise<string | null>>();
const assetPngCache = new Map<string, Promise<string | null>>();

/** Invalidate after an upload, so the next render fetches the new asset. */
export function clearCertificateAssetCache() {
  assetUrlCache.clear();
  assetPngCache.clear();
  imageCache.clear();
}

async function fetchCertAsset(key: string): Promise<string | null> {
  const hit = assetUrlCache.get(key);
  if (hit) return hit;
  const p = fetchCertAssetUncached(key);
  assetUrlCache.set(key, p);
  return p;
}

async function fetchCertAssetUncached(key: string): Promise<string | null> {
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
/**
 * ⚠ OWNER DECISION 2026-08-25 — THE TWO TEXT TIERS SHIFTED, DELIBERATELY.
 *
 * Before today the certificate ran on a single dark grey for the things that
 * matter (name, title, date) and a warm grey `TEXT_MUTED` [100, 95, 88] for the
 * two connector lines. The owner moved BOTH:
 *
 *   name / title / date .................. #282828  ->  #007BB1  (TEXT_ACCENT)
 *   "This is to certify that" /
 *   "has successfully completed" ......... #645F58  ->  #282828  (TEXT_DARK)
 *
 * So the connector lines inherit the old headline colour and the headline gets
 * the brand blue. `TEXT_MUTED` is gone rather than left unused: an orphaned
 * palette entry is the kind of thing the next person re-applies by accident.
 * It was [100, 95, 88] if it is ever wanted back.
 */
const TEXT_ACCENT: [number, number, number] = [0, 123, 177];
const TEXT_DARK: [number, number, number] = [40, 40, 40];
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
  description,
  heading,
}: CertificateData) {
  const tier = resolveTier(type);

  /**
   * ⚠ RESOLVED ONCE PER RENDER, NOT TWICE.
   *
   * The logo is drawn twice — as the faint watermark behind the text and again
   * in the footer — and each site previously resolved it independently. Where
   * `certificate_logo` is unset that meant TWO calls to `getSiteLogoUrl()`,
   * which documents itself as deliberately uncached so a changed logo shows
   * immediately. Harmless for a one-off download; measured at 12 network round
   * trips across six renders once the admin preview started redrawing as they
   * type. Same freshness, half the requests, and the two never disagree.
   */
  let logoUrlMemo: string | null | undefined;
  const logoUrlOnce = async (): Promise<string | null> => {
    if (logoUrlMemo !== undefined) return logoUrlMemo;
    let u = await fetchCertAsset("certificate_logo");
    if (!u) u = await getSiteLogoUrl();
    if (u && u.startsWith("/")) u = `${window.location.origin}${u}`;
    logoUrlMemo = u || null;
    return logoUrlMemo;
  };

  const W = 297;
  const H = 210;

  // --- Background ---
  d.setFillColor(...BG_COLOR);
  d.rect(0, 0, W, H, "F");

  // --- Gold ornamental border + corners ---
  drawGoldBorder(d, W, H);

  // --- Watermark: Large logo in center at 10% opacity, grayscale ---
  try {
    const wmLogoUrl = await logoUrlOnce();
    if (wmLogoUrl) {
      const wmDataUrl = await cachedPng(wmLogoUrl, 0.10, true);
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
  // The admin's heading where there is one, the type's wording otherwise.
  const ofText = (heading || "").trim() || tier.ofText;
  d.text(ofText, W / 2, y, { align: "center" });
  y += 18;

  // --- "This certificate is proudly presented to" ---
  d.setFont("times", "normal");
  d.setFontSize(14);
  d.setTextColor(...TEXT_DARK);
  const presentText = tier.presentText;
  d.text(presentText, W / 2, y, { align: "center" });
  y += 14;

  // --- Recipient Name (elegant script-like) ---
  d.setFont("times", "bolditalic");
  d.setFontSize(38);
  d.setTextColor(...TEXT_ACCENT);
  d.text(recipientName, W / 2, y, { align: "center" });
  y += 14;

  // --- "for successfully completing the course" ---
  d.setFont("times", "normal");
  d.setFontSize(14);
  d.setTextColor(...TEXT_DARK);
  const completionText = tier.completionText;
  d.text(completionText, W / 2, y, { align: "center" });
  y += 12;

  // --- Course Title ---
  d.setFont("times", "bolditalic");
  d.setFontSize(22);
  d.setTextColor(...TEXT_ACCENT);
  const maxTitleWidth = 220;
  const titleLines = d.splitTextToSize(`"${courseTitle}"`, maxTitleWidth);
  titleLines.forEach((line: string, i: number) => {
    d.text(line, W / 2, y + i * 9, { align: "center" });
  });
  y += titleLines.length * 9 + 4;

  // --- Closing line: the admin's description if there is one ---
  //
  // ⚠ This is where the description finally lands. It was collected by the
  // form and stored by the database and printed nowhere. Wrapped, because an
  // admin writing free text will not stop at one line the way the canned
  // wording does — an unwrapped string would run off both edges of the page.
  d.setFont("times", "italic");
  d.setFontSize(12);
  d.setTextColor(...TEXT_SUBTLE);
  const closing = (description || "").trim() || tier.dedicationText;
  const closingLines = d.splitTextToSize(closing, 200).slice(0, 3);
  closingLines.forEach((line: string, i: number) => {
    d.text(line, W / 2, y + i * 6, { align: "center" });
  });

  // ============== FOOTER SECTION ==============
  const footerY = H - 40;
  const leftX = 60;
  const centerX = W / 2;
  const rightX = W - 60;

  // --- Left: Date ---
  d.setFont("times", "normal");
  d.setFontSize(12);
  d.setTextColor(...TEXT_ACCENT);
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
    const logoUrl = await logoUrlOnce();
    if (logoUrl) {
      const logoImg = await cachedImage(logoUrl);
      const logoDataUrl = await cachedPng(logoUrl);
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
      const sigImg = await cachedImage(sigUrl);
      const sigDataUrl = await cachedPng(sigUrl);
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
