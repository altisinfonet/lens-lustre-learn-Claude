/**
 * The scene list. Each entry mounts ONE piece of UI with fixed, invented data.
 *
 * RULES FOR A SCENE, learned the moment the first one was written:
 *  • No network, no auth, no Supabase. A scene that needs data gets it from a
 *    literal in this file.
 *  • No `Math.random()`, no `new Date()` without a fixed argument. Two runs of
 *    the same scene must produce the same pixels, or the screenshots cannot be
 *    compared to each other.
 *  • Cover the states that actually break, not just the happy one: empty, one
 *    item, many items, a very long caption, a missing image. Those are the
 *    screenshots worth looking at.
 */

import type { JSX } from "react";

/** A deterministic stand-in image, so a scene never depends on the network. */
export function swatch(seed: number, label = ""): string {
  const hue = (seed * 37) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="hsl(${hue} 30% 32%)"/>
      <stop offset="100%" stop-color="hsl(${(hue + 40) % 360} 26% 18%)"/>
    </linearGradient></defs>
    <rect width="600" height="600" fill="url(#g)"/>
    ${label ? `<text x="300" y="320" font-family="sans-serif" font-size="72" font-weight="700"
        fill="rgba(255,255,255,.55)" text-anchor="middle">${label}</text>` : ""}
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const SCENES: Record<string, () => JSX.Element> = {
  /**
   * Proves the harness itself renders the app's real styling — Tailwind
   * tokens, the dark theme, the font — rather than a bare white page that
   * would make every later screenshot meaningless.
   */
  "harness-selftest": () => (
    <div className="min-h-screen bg-background p-5 text-foreground">
      <p className="mb-3 text-xs uppercase tracking-widest text-primary">Self test</p>
      <h2 className="mb-2 text-xl font-bold">Theme tokens are loading</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        If this block is dark with a blue label, index.css and the design tokens
        reached the harness and a screenshot of any other scene is trustworthy.
      </p>
      <div className="grid grid-cols-3 gap-[2px]">
        {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <img key={i} src={swatch(i, String(i + 1))} alt="" className="aspect-square w-full object-cover" />
        ))}
      </div>
      <button className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
        Primary button
      </button>
    </div>
  ),
};
