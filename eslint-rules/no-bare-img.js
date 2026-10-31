/**
 * d2/no-bare-img — P11. No NEW bare <img> in src/components or src/pages.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY. A bare <img> gets none of what this codebase's image components already
 * do: srcSet/sizes, lazy + async decoding, a placeholder, a visible failure
 * path (see the 1x1-GIF history in public/sw-image-cache.js). Every new one is
 * a photo that ships at full resolution to a 360 px phone.
 *
 * WHAT IT ENFORCES — A RATCHET. 225 bare <img> exist today across 110 files
 * (2026-10-04, staging 3408104). Converting them all in one PR would be a
 * blind rewrite of every screen. So each file's count is frozen in
 * `eslint-rules/no-bare-img.baseline.json`:
 *   • a file with MORE bare <img> than its baseline  -> error on each element
 *     (a file not in the baseline has a baseline of 0);
 *   • a file with FEWER than its baseline            -> error "lower the
 *     baseline" — the ratchet only turns one way, and a stale allowance would
 *     silently re-admit a new <img> later.
 * Use the image components instead: `OptimizedImage`, `post/PostMedia`,
 * `gallery/GalleryImage` (or add a reasoned baseline line in a reviewed PR).
 *
 * A MISSING OR UNREADABLE BASELINE IS AN ERROR, never "allow everything" and
 * never "allow nothing" silently: the rule reports it on every file.
 *
 * Counted: JSX elements named exactly `img` (lower-case intrinsic). Not
 * counted: <picture>, <source>, components such as <Img/>, and the string
 * "<img" inside comments or text.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
export const BASELINE_PATH = path.join(__dirname, "no-bare-img.baseline.json");

function loadBaseline(p) {
  try {
    const json = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!json || typeof json.files !== "object") return { error: `${p}: no "files" object` };
    return { files: json.files };
  } catch (e) {
    return { error: `${p}: ${e.message}` };
  }
}

export default {
  meta: {
    type: "problem",
    docs: { description: "P11: no new bare <img> in src/components or src/pages (per-file ratchet)" },
    schema: [{ type: "object", properties: { baselinePath: { type: "string" } }, additionalProperties: false }],
    messages: {
      over: "Bare <img> ({{count}} in this file, baseline {{allowed}}). Use OptimizedImage / PostMedia / GalleryImage — P11.",
      stale: "This file now has {{count}} bare <img> but the baseline allows {{allowed}}: lower its entry in eslint-rules/no-bare-img.baseline.json (the ratchet only turns one way).",
      baseline: "P11 bare-<img> baseline unreadable: {{error}}",
    },
  },
  create(context) {
    const opt = context.options[0] || {};
    const base = loadBaseline(opt.baselinePath ? path.resolve(REPO_ROOT, opt.baselinePath) : BASELINE_PATH);
    const filename = context.filename ?? context.getFilename();
    const rel = path.relative(context.cwd ?? process.cwd(), filename).split(path.sep).join("/");
    const imgs = [];
    return {
      JSXOpeningElement(node) {
        if (node.name && node.name.type === "JSXIdentifier" && node.name.name === "img") imgs.push(node);
      },
      "Program:exit"(program) {
        if (base.error) {
          context.report({ node: program, messageId: "baseline", data: { error: base.error } });
          return;
        }
        const allowed = Number.isInteger(base.files[rel]) ? base.files[rel] : 0;
        const count = imgs.length;
        if (count > allowed) {
          for (const n of imgs) context.report({ node: n, messageId: "over", data: { count, allowed } });
        } else if (count < allowed) {
          context.report({ node: program, messageId: "stale", data: { count, allowed } });
        }
      },
    };
  },
};
