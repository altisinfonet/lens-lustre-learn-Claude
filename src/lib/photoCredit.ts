/**
 * THE CREDIT ON THE 2048 COPY — photo plan U1b, Owner decision 4 (2026-11-02).
 *
 *   "© <post owner's name>, 50mm Retina World"
 *   small soft white text with a light shadow, bottom-right, scaled to the
 *   image width; burned into the 2048 copy ONLY (the 1080/600/320 copies are
 *   made from the clean pixels — see photoSetEncode.ts).
 *
 * NAME RULE (pure, tested in photoCredit.test.ts):
 *   1. the full name if it is ≤ 26 characters;
 *   2. else every middle name becomes an initial ("Subhadeep K. Chattopadhyay");
 *   3. still > 26 → first name + surname initial ("Venkataraghavan C.").
 *   ", 50mm Retina World" is never cut.
 *
 * WHOSE NAME: the uploader's own profile full name — the `full_name` WallPosts
 * already holds from useProfileCore (posts) and the entrant's own profile at
 * competition submit / edit (the entrant is the signed-in member there).
 * Fallback when it is empty or the "Photographer" placeholder resolveName puts
 * in for a missing name: the member's profile handle (`custom_url`). With
 * neither, or for an admin account (whose name resolves to the brand), the line
 * is just "© 50mm Retina World" — never "© , 50mm Retina World" and never the
 * brand twice.
 *
 * GEOMETRY: the approved sample (50mm-photo-samples-2.html, section 3) draws
 * 13px weight-600 text on a 400px-wide photo at right 2.2% / bottom 2.6%,
 * colour rgba(255,255,255,.82), shadow 0 1px 2px rgba(0,0,0,.65). The same
 * proportions are applied to the real width.
 */
/** Same text as adminBrand.BRAND_NAME (not imported: that module loads the database client). */
const BRAND_NAME = "50mm Retina World";

export const CREDIT_NAME_MAX = 26;
export const CREDIT_SUFFIX = `, ${BRAND_NAME}`;

const len = (s: string) => Array.from(s).length;
const initial = (word: string) => `${Array.from(word)[0]?.toUpperCase() ?? ""}.`;

/** The owner's name shortened by the rule above (never longer than 26). */
export function creditName(fullName: string): string {
  const words = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  const whole = words.join(" ");
  if (len(whole) <= CREDIT_NAME_MAX) return whole;
  if (words.length >= 3) {
    const middles = words.slice(1, -1).map(initial);
    const shorter = [words[0], ...middles, words[words.length - 1]].join(" ");
    if (len(shorter) <= CREDIT_NAME_MAX) return shorter;
  }
  if (words.length >= 2) {
    const firstPlus = `${words[0]} ${initial(words[words.length - 1])}`;
    if (len(firstPlus) <= CREDIT_NAME_MAX) return firstPlus;
  }
  // One enormous word (or a first name longer than the rule allows): cut it.
  return `${Array.from(words[0] ?? "").slice(0, CREDIT_NAME_MAX - 1).join("")}…`;
}

/** The full line drawn on the photo. */
export function creditText(ownerName: string): string {
  const name = creditName(ownerName ?? "");
  if (!name || name.toLowerCase() === BRAND_NAME.toLowerCase()) return `© ${BRAND_NAME}`;
  return `© ${name}${CREDIT_SUFFIX}`;
}

/** Whose name, from the profile row the screen already has. "" when none. */
export function creditOwnerName(profile: { full_name?: string | null; custom_url?: string | null } | null | undefined): string {
  const full = (profile?.full_name ?? "").trim();
  if (full && full !== "Photographer") return full;
  return (profile?.custom_url ?? "").trim();
}

export interface CreditLayout {
  fontPx: number;
  /** Right edge of the text (textAlign = "right"). */
  x: number;
  /** Baseline of the text (textBaseline = "alphabetic"). */
  y: number;
  fill: string;
  shadow: string;
  shadowOffsetY: number;
  shadowBlur: number;
  font: string;
}

/** The sample's proportions applied to a `width × height` image. */
export function creditLayout(width: number, height: number): CreditLayout {
  const k = width / 400;
  const fontPx = Math.max(10, Math.round(13 * k));
  return {
    fontPx,
    x: width - Math.round(width * 0.022),
    y: height - Math.round(height * 0.026),
    fill: "rgba(255,255,255,0.82)",
    shadow: "rgba(0,0,0,0.65)",
    shadowOffsetY: Math.max(1, Math.round(1 * k)),
    shadowBlur: Math.max(1, Math.round(2 * k)),
    font: `600 ${fontPx}px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`,
  };
}

/**
 * Draw the credit onto a canvas that already holds the 2048 copy's pixels.
 * If the line is wider than 90% of the photo (a narrow portrait), the font is
 * scaled down to fit rather than running off the left edge.
 */
export function drawCredit(ctx: CanvasRenderingContext2D, width: number, height: number, text: string): void {
  const l = creditLayout(width, height);
  ctx.save();
  ctx.font = l.font;
  const measured = ctx.measureText(text).width;
  const maxW = width * 0.9;
  if (measured > maxW && measured > 0) {
    const px = Math.max(8, Math.floor((l.fontPx * maxW) / measured));
    ctx.font = l.font.replace(`${l.fontPx}px`, `${px}px`);
  }
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = l.fill;
  ctx.shadowColor = l.shadow;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = l.shadowOffsetY;
  ctx.shadowBlur = l.shadowBlur;
  ctx.fillText(text, l.x, l.y);
  ctx.restore();
}
