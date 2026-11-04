/**
 * THE ONE TOKENS FILE (central-control plan T1; Owner, 4 Nov 2026: one change,
 * every screen). A shared size is written here and nowhere else.
 *
 *   tokens.ts  -> tailwind.config.ts reads these exports directly
 *              -> the TOKENS block in src/index.css must equal tokensCssBlock()
 *                 (src/ui/__tests__/tokens.test.ts fails on any difference and
 *                 prints the block to paste)
 *
 * Every number is today's feed value in CSS pixels at the default root size, so
 * adopting a token moves nothing on screen (the B1 baselines prove it):
 *   space.card-x   the card's side padding (PostCard header, Caption px-3)
 *   space.card-y   the card's top padding (PostCard header p-3)
 *   space.row-gap  avatar to name in a row (PostCard header gap-2.5)
 *   space.stack    one step down a card (PostCard header pb-2)
 *   tap.min        the 44 px finger target (ROW_TAP)
 *   tap.short      the 32 px visible row (actionRowGeometry)
 *   avatar.*       the sizes a face may be
 *   type.caption   the feed caption (Caption text-[13px])
 *   type.meta      time and small print (text-xs)
 *   type.body      comment text (text-sm)
 *   type.name      a member's name (text-sm)
 *   comment.indent a reply's indent (CommentThread, 32 avatar + 12 gap)
 *
 * Written out in rem like Tailwind's own scale, so a member's larger browser
 * text setting keeps working.
 *
 * Tailwind classes: px-card-x, gap-row-gap, h-tap-min, size-avatar-md,
 * ms-comment-indent, text-caption. cn() knows them (src/lib/utils.ts).
 */
export const TOKENS = {
  space: { "card-x": 12, "card-y": 12, "row-gap": 10, stack: 8 },
  tap: { min: 44, short: 32 },
  avatar: { xs: 24, sm: 32, md: 40, lg: 48, xl: 80 },
  type: { caption: 13, meta: 12, body: 14, name: 14 },
  comment: { indent: 45 },
} as const;

const rem = (px: number) => `${px / 16}rem`;

/** [CSS variable, Tailwind key, px] for every size that is not a font size. */
const SIZES: [string, string, number][] = [
  ...Object.entries(TOKENS.space).map(([k, px]): [string, string, number] => [`--space-${k}`, k, px]),
  ...Object.entries(TOKENS.tap).map(([k, px]): [string, string, number] => [`--tap-${k}`, `tap-${k}`, px]),
  ...Object.entries(TOKENS.avatar).map(([k, px]): [string, string, number] => [`--avatar-${k}`, `avatar-${k}`, px]),
  ...Object.entries(TOKENS.comment).map(([k, px]): [string, string, number] => [`--comment-${k}`, `comment-${k}`, px]),
];
const TYPES: [string, string, number][] = Object.entries(TOKENS.type).map(([k, px]) => [`--type-${k}`, k, px]);

export const tailwindSpacing: Record<string, string> = Object.fromEntries(SIZES.map(([name, key]) => [key, `var(${name})`]));
export const tailwindFontSize: Record<string, string> = Object.fromEntries(TYPES.map(([name, key]) => [key, `var(${name})`]));

const cssVars = (): Record<string, string> => Object.fromEntries([...SIZES, ...TYPES].map(([name, , px]) => [name, rem(px)]));

const START = "/* TOKENS:START generated from src/ui/tokens.ts, do not edit by hand */";
const END = "/* TOKENS:END */";

/** The exact text of the block in src/index.css. */
export const tokensCssBlock = (): string =>
  [START, ...Object.entries(cssVars()).map(([name, value]) => `${name}: ${value};`), END].join("\n");

/** Every way the block in index.css differs from this file. Empty means equal. */
export function tokenCssDrift(css: string): string[] {
  const from = css.indexOf(START);
  const to = css.indexOf(END);
  if (from < 0 || to < from) return ["index.css has no TOKENS block"];
  const found = new Map([...css.slice(from, to).matchAll(/(--[a-z-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  const wanted = cssVars();
  const drift: string[] = [];
  for (const [name, value] of Object.entries(wanted)) {
    const have = found.get(name);
    if (have === undefined) drift.push(`${name}: in tokens.ts, not in index.css`);
    else if (have !== value) drift.push(`${name}: index.css has ${have}, tokens.ts has ${value}`);
  }
  for (const name of found.keys()) if (!(name in wanted)) drift.push(`${name}: in index.css, not in tokens.ts`);
  return drift;
}
