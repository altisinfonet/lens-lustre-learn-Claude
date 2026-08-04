/**
 * BADGE / ROLE PILL APPEARANCE — one definition, used by every surface.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG — owner report with screenshots, 2026-08-04
 *
 * "Except the blue badge no other badge people won't read."
 *
 * Measured, not guessed. Every badge was `bg-<hue>-500/15 text-<hue>-600
 * border-<hue>-500/30` at 7px, and that has two independent faults:
 *
 *   1. THE FILL WAS 15% TRANSPARENT. The page showed through it, so the badge's
 *      real background changed with the surface behind it — and the text colour
 *      (`-600`, a shade tuned for white paper) was used in BOTH dark and light
 *      mode, because there was no `dark:` variant anywhere. Contrast measured
 *      against the app's real card colours:
 *
 *        colour    light   dark
 *        amber     2.73    3.56
 *        emerald   3.14    3.07
 *        violet    4.53    2.21
 *        orange    2.93    3.40
 *        pink      3.66    2.75
 *        …all ten presets failed the 4.5:1 AA minimum in dark mode,
 *        and eight of ten failed in light mode too.
 *
 *   2. THE TEXT WAS 7px. Below anything legible on a phone.
 *
 * WHY A SOLID FILL IS THE FIX, AND NOT JUST A NICER COLOUR
 *
 * A solid pill carries its own background, so the page behind it stops
 * mattering and ONE colour is correct in both modes — no `dark:` variant to
 * forget. That is exactly why the blue VERIFIED badge always read fine while
 * nothing else did: it was the only solid one. Every badge now has that
 * structure, so the failure cannot come back per-colour.
 *
 * Owner decisions, 2026-08-04: vibrant palette (not the muted variant), 10px.
 *
 * THE DATABASE IS THE REASON THIS IS A FUNCTION, NOT A CONSTANT
 *
 * Badge and role colours are admin-editable rows (`badge_definitions.badge_class`,
 * `role_definitions.pill_class`) holding raw Tailwind strings. Fixing the code
 * alone would not have changed a single badge on screen, and an admin could
 * re-introduce an unreadable one at any time from the Admin panel.
 *
 * So `solidPillClass()` NORMALISES whatever is stored into a guaranteed-readable
 * solid pill: it reads only the HUE out of the stored string and supplies the
 * shade itself. A row saved with a bad shade, an old row, or a row someone
 * hand-edits in SQL all still render readably. Same principle as RequireAuth —
 * enforce it in the one place every surface passes through, rather than
 * trusting each caller. (WORKING_RULES: "a rule enforced in one component is
 * not a rule".)
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Fill per hue. Every entry is white-on-fill ≥ 4.5:1 (WCAG AA for small text),
 * so each one is readable on ANY page background, in either mode. The ratio in
 * the comment is computed, and `badgePalette.test.ts` recomputes all of them
 * from these very hex values — if someone lightens one, the test fails.
 *
 * Written as complete literal class strings because Tailwind's scanner only
 * sees literals; never build these by concatenation.
 */
export const BADGE_FILL: Record<string, string> = {
  violet: "bg-violet-600",   // #7c3aed — 5.70:1
  indigo: "bg-indigo-600",   // #4f46e5 — 6.29:1
  emerald: "bg-emerald-700", // #047857 — 5.48:1
  teal: "bg-teal-700",       // #0f766e — 5.47:1
  sky: "bg-sky-700",         // #0369a1 — 5.93:1
  blue: "bg-blue-600",       // #2563eb — 5.17:1  (VERIFIED keeps its blue)
  orange: "bg-orange-700",   // #c2410c — 5.18:1
  amber: "bg-amber-700",     // #b45309 — 5.02:1
  rose: "bg-rose-600",       // #e11d48 — 4.70:1
  pink: "bg-pink-600",       // #db2777 — 4.60:1
  red: "bg-red-600",         // #dc2626 — 4.83:1
};

/** The hex behind each fill, for the contrast test. Kept next to it on purpose. */
export const BADGE_FILL_HEX: Record<keyof typeof BADGE_FILL | string, string> = {
  violet: "#7c3aed",
  indigo: "#4f46e5",
  emerald: "#047857",
  teal: "#0f766e",
  sky: "#0369a1",
  blue: "#2563eb",
  orange: "#c2410c",
  amber: "#b45309",
  rose: "#e11d48",
  pink: "#db2777",
  red: "#dc2626",
};

/** Anything whose hue we cannot recognise still has to be readable. */
export const BADGE_FALLBACK_HUE = "slate";
const FALLBACK_FILL = "bg-slate-700"; // #334155 — 10.4:1

/**
 * Shape and type. White text on a saturated fill, a hairline lighter ring so
 * the pill still has an edge on a white page, and a pill radius per the
 * owner's reference design.
 */
export const BADGE_PILL_BASE =
  "inline-flex items-center gap-1 min-w-0 overflow-hidden rounded-full border border-white/25 text-white font-bold uppercase leading-[1.35] shadow-sm cursor-default";

/**
 * THE NAME OUTRANKS THE BADGE FOR SPACE. Owner rule, 2026-08-04:
 * "Name 1st visible then Badge. Here Name is overlapped by Badge."
 *
 * In a narrow row (the sidebar's "People you may know" is ~220px) the name and
 * the badge compete. The pill used to be `shrink-0`, so it took its full width
 * and the NAME truncated — "Dipannita Sen" became "nni…". Backwards: a member's
 * name is the point, the badge is decoration.
 *
 * `shrink-[9999]` gives the badge an enormous flex-shrink factor next to the
 * name's default of 1, so essentially ALL the shortfall is taken out of the
 * badge: it truncates, then shrinks to just its icon, before the name loses a
 * single character. Deliberately not `hidden md:inline-flex` — that would drop
 * the badge on every phone, where most members read.
 */
export const BADGE_ROW_SHRINK = "min-w-0 shrink-[9999]";

/**
 * 8.5px (owner revised down from 10px, then 9px, 2026-08-04). Was 7px (compact) / 8px
 * (full) — the other half of why these were unreadable. The contrast does the
 * heavy lifting now: white on a solid 4.5:1+ fill is legible at 9px in a way
 * that dark-on-transparent never was at any size. `full` is a touch roomier.
 */
export const BADGE_PILL_SIZE = {
  compact: "text-[8.5px] px-2 py-[2px] tracking-[0.07em]",
  full: "text-[8.5px] px-2.5 py-[3px] tracking-[0.07em]",
} as const;

/** The icon sits optically level with 8.5px caps, and never shrinks away first. */
export const BADGE_ICON_SIZE = "text-[9px] leading-none shrink-0";

const HUE_PATTERN = new RegExp(`\\b(${Object.keys(BADGE_FILL).join("|")})-\\d{2,3}\\b`);

/**
 * Pull the hue out of a stored Tailwind string and return a guaranteed-readable
 * solid fill for it.
 *
 * Accepts a legacy tint string ("bg-amber-500/15 text-amber-600 …"), a bare hue
 * ("amber"), or a new solid string ("bg-amber-700") — all resolve to the same
 * fill. Anything unrecognisable falls back to a readable slate rather than
 * rendering whatever was stored, because an unreadable badge is the bug.
 */
export function solidPillFill(stored: string | null | undefined): string {
  if (!stored) return FALLBACK_FILL;
  const direct = BADGE_FILL[stored.trim().toLowerCase()];
  if (direct) return direct;
  const m = HUE_PATTERN.exec(stored);
  return m ? BADGE_FILL[m[1]] : FALLBACK_FILL;
}

/**
 * The complete class string for a badge / role pill.
 * Every surface that renders one MUST go through this.
 */
export function solidPillClass(
  stored: string | null | undefined,
  size: keyof typeof BADGE_PILL_SIZE = "compact",
): string {
  return `${BADGE_PILL_BASE} ${BADGE_PILL_SIZE[size]} ${solidPillFill(stored)}`;
}
