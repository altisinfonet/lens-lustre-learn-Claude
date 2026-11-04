// @vitest-environment node
/**
 * CREDIT U3 / PLAN UNIT R1 · ONE RENDERER — RATCHET (Owner, 4 Nov 2026:
 * central control, "one change, every screen").
 *
 * Two renderers (a browser canvas with the machine's system font, a sharp SVG
 * with an ESTIMATED width) drew different glyphs at different sizes. Only
 * tools/media-derivatives/credit-render.mjs may draw a credit now. This test
 * reads every source file and fails CI on:
 *   · `fillText` anywhere but the canvases below, none of which draws a
 *     photo credit, each with its reason;
 *   · any return of the retired names (creditSvg, drawCredit, creditLayout,
 *     credit-svg.mjs, creditGeometryFor);
 *   · any other file asking sharp to draw text (`text:` input) or importing the
 *     renderer outside the named list, so a new draw path has to be added here
 *     on purpose.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = join(__dirname, "../../../..");
const SCAN = ["src", "functions", "tools", "supabase/functions", "converter/src"];
const THE_RENDERER = "tools/media-derivatives/credit-render.mjs";

/** Canvases that draw text and are NOT a photo credit. */
const FILLTEXT_ALLOWED: Record<string, string> = {
  "src/components/profile/QRCodeCard.tsx": "the member's own QR card, an image they generate on purpose",
  "src/lib/certificateCanvas.ts": "competition certificates",
  "src/lib/deviceFingerprint.ts": "a canvas fingerprint, never shown or stored as a picture",
  "tools/uishot/app-video-cors-journey.mjs": "a test tool's throwaway video frame, never a member photo",
  // Owner order, 4 Nov 2026: a FEED photo's credit is never stored — it is drawn in
  // the browser at save time. This is the ONE browser file that may draw it, from
  // the same geometry (CREDIT_GEOMETRY_V5) and the same committed font as the
  // server renderer (asserted below).
  [THE_BROWSER_DRAWER_PATH()]: "THE save-time credit for feed photos (one geometry, one font)",
};
function THE_BROWSER_DRAWER_PATH(): string { return "src/lib/photoCreditSave.ts"; }

/** The only files that may import the renderer: every worker that draws, plus the check that measures it. */
const RENDERER_USERS = [
  "tools/media-derivatives/old-credit.mjs",
  "tools/media-derivatives/photo-set.mjs",
  "tools/media-derivatives/rectify-l4.mjs",
  "tools/media-derivatives/set-credit.mjs",
  "tools/uishot/photo-feed-credit.mjs",
];

const RETIRED = /\b(creditSvg|drawCredit|creditLayout|creditGeometryFor)\b|credit-svg\.mjs/;
const SHARP_TEXT = /sharp\(\s*\{\s*text\s*:/;
const IMPORTS_RENDERER = /from\s+["'][^"']*credit-render(\.mjs)?["']|import\(\s*["'][^"']*credit-render(\.mjs)?["']\s*\)/;

function sources(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" || e.name === "__tests__" || e.name.startsWith(".") ? [] : sources(p);
    return /\.(tsx?|mjs|cjs|js|d\.mts)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
  });
}
const files = SCAN.flatMap((d) => sources(join(ROOT, d))).map((f) => ({
  path: relative(ROOT, f).split(sep).join("/"),
  text: readFileSync(f, "utf8"),
}));

/** The rule itself, so the self-test below runs the same code as the census. */
function offences(list: { path: string; text: string }[]): string[] {
  const out: string[] = [];
  for (const { path, text } of list) {
    if (/\.fillText\(/.test(text) && !(path in FILLTEXT_ALLOWED)) out.push(`${path}: fillText outside the renderer`);
    if (RETIRED.test(text) && path !== THE_RENDERER) out.push(`${path}: a retired credit name`);
    if (SHARP_TEXT.test(text) && path !== THE_RENDERER) out.push(`${path}: sharp text input outside the renderer`);
    if (IMPORTS_RENDERER.test(text) && !RENDERER_USERS.includes(path)) out.push(`${path}: imports the renderer but is not on the list`);
  }
  return out;
}

describe("the credit has ONE renderer", () => {
  it("the census really reads the tree (the renderer and the workers are in it)", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files.some((f) => f.path === THE_RENDERER)).toBe(true);
    for (const u of RENDERER_USERS) expect(files.find((f) => f.path === u), u).toBeDefined();
  });

  it("nothing outside credit-render.mjs draws a credit", () => {
    expect(offences(files)).toEqual([]);
  });

  it("every worker and the check import the renderer; the retired file is gone", () => {
    for (const u of RENDERER_USERS) expect(IMPORTS_RENDERER.test(files.find((f) => f.path === u)!.text), u).toBe(true);
    expect(existsSync(join(ROOT, "tools/media-derivatives/credit-svg.mjs"))).toBe(false);
  });

  it("the browser's save-time credit uses the ONE geometry and the server's committed font", () => {
    const text = files.find((f) => f.path === THE_BROWSER_DRAWER_PATH())!.text;
    expect(text).toMatch(/creditGeometryV5For\(/);
    expect(text).toMatch(/from "@\/lib\/creditGeometry\.mjs"/);
    expect(text).toMatch(/tools\/media-derivatives\/fonts\/FiraSans-SemiBold-latin\.ttf\?url/);
  });

  it("an allowed canvas must really be one (a stale entry fails, so the list only shrinks)", () => {
    for (const p of Object.keys(FILLTEXT_ALLOWED)) expect(/\.fillText\(/.test(files.find((f) => f.path === p)?.text ?? ""), p).toBe(true);
  });

  it("self-test: each offence is caught", () => {
    const bad = (text: string) => offences([{ path: "src/components/Evil.tsx", text }]);
    expect(bad("ctx.fillText(line, 1, 2);")).toHaveLength(1);
    expect(bad(`import { creditSvg } from "./x";`)).toHaveLength(1);
    expect(bad(`await sharp({ text: { text: "x" } }).png()`)).toHaveLength(1);
    expect(bad(`import { renderCredit } from "../credit-render.mjs";`)).toHaveLength(1);
    expect(bad("const a = 1;")).toHaveLength(0);
  });
});
