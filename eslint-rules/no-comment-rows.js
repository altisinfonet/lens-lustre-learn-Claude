/**
 * d2/no-comment-rows — central-control plan C3 (Owner, 4 Nov 2026: one change,
 * every screen).
 *
 * WHY. Comments had three renderers, and each drifted: the Instagram-compact
 * spacing reached one and not the others. A comment row is now drawn in exactly
 * one place, src/components/comments/CommentThread.tsx. A surface that needs
 * comments writes an adapter for its table and hands the rows to CommentThread,
 * as CommentsSection (#875) and ImageEngagement (C2) do.
 *
 * WHAT IT ENFORCES — A RATCHET. Each file's count of "drawn" comment lists is
 * frozen in eslint-rules/no-comment-rows.baseline.json, with a written reason:
 *   • more than its baseline   -> error on each list (no entry means 0);
 *   • fewer than its baseline  -> error "lower its entry": the ratchet only
 *     turns one way, and a stale allowance would re-admit a list later.
 *
 * A MISSING OR UNREADABLE BASELINE IS AN ERROR on every file, never allow-all.
 *
 * Counted: `.map` / `.flatMap` on a list whose name ends in `comments` or
 * `replies` (through `?.`, `??`, a `.filter()` chain or a `[...copy]`), when the
 * callback draws: it holds JSX, or it calls or is a `render*` helper. The helper
 * case matters. ImageEngagement's old list was
 * `comments.map(c => renderComment(c))`, with no JSX in the callback at all.
 * Not counted: data maps such as `comments.map(toThread)`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
export const BASELINE_PATH = path.join(__dirname, "no-comment-rows.baseline.json");

const LIST_NAME = /(comments|replies)$/i;
const RENDER_NAME = /^render/i;

function loadBaseline(p) {
  try {
    const json = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!json || typeof json.files !== "object" || json.files === null) return { error: `${p}: no "files" object` };
    return { files: json.files };
  } catch (e) {
    return { error: `${p}: ${e.message}` };
  }
}

/** Does this expression read a list named like comments? Follows the shapes a list is reached through. */
function isCommentList(node) {
  if (!node) return false;
  switch (node.type) {
    case "Identifier": return LIST_NAME.test(node.name);
    case "MemberExpression":
      return (!node.computed && node.property.type === "Identifier" && LIST_NAME.test(node.property.name)) || isCommentList(node.object);
    case "CallExpression": return isCommentList(node.callee);
    case "ChainExpression":
    case "TSNonNullExpression":
    case "TSAsExpression":
    case "ParenthesizedExpression": return isCommentList(node.expression);
    case "LogicalExpression": return isCommentList(node.left) || isCommentList(node.right);
    case "ConditionalExpression": return isCommentList(node.consequent) || isCommentList(node.alternate);
    case "ArrayExpression": return node.elements.some(isCommentList);
    case "SpreadElement": return isCommentList(node.argument);
    default: return false;
  }
}

const isRenderCall = (node) => node.type === "CallExpression"
  && ((node.callee.type === "Identifier" && RENDER_NAME.test(node.callee.name))
    || (node.callee.type === "MemberExpression" && node.callee.property.type === "Identifier" && RENDER_NAME.test(node.callee.property.name)));

/** Does this subtree draw: JSX, or a call to a render helper? */
function draws(node) {
  if (!node || typeof node.type !== "string") return false;
  if (node.type === "JSXElement" || node.type === "JSXFragment" || isRenderCall(node)) return true;
  for (const key of Object.keys(node)) {
    if (key === "parent") continue;
    const value = node[key];
    if (Array.isArray(value)) { if (value.some(draws)) return true; } else if (value && typeof value === "object" && draws(value)) return true;
  }
  return false;
}

const callbackDraws = (cb) => !!cb && (cb.type === "Identifier" ? RENDER_NAME.test(cb.name) : draws(cb));

export default {
  meta: {
    type: "problem",
    docs: { description: "C3: comment rows are drawn only by CommentThread (per-file ratchet)" },
    schema: [{ type: "object", properties: { baselinePath: { type: "string" } }, additionalProperties: false }],
    messages: {
      over: "Comment list ({{count}} in this file, baseline {{allowed}}). Rows are drawn only by CommentThread: write an adapter for your table, as ImageEngagement does.",
      stale: "This file now draws {{count}} comment list(s) but the baseline allows {{allowed}}: lower its entry in eslint-rules/no-comment-rows.baseline.json.",
      baseline: "C3 comment-row baseline unreadable: {{error}}",
    },
  },
  create(context) {
    const opt = context.options[0] || {};
    const base = loadBaseline(opt.baselinePath ? path.resolve(REPO_ROOT, opt.baselinePath) : BASELINE_PATH);
    const filename = context.filename ?? context.getFilename();
    const rel = path.relative(context.cwd ?? process.cwd(), filename).split(path.sep).join("/");
    const lists = [];
    return {
      CallExpression(node) {
        const c = node.callee;
        if (c.type !== "MemberExpression" || c.computed || c.property.type !== "Identifier") return;
        if (c.property.name !== "map" && c.property.name !== "flatMap") return;
        if (isCommentList(c.object) && callbackDraws(node.arguments[0])) lists.push(node);
      },
      "Program:exit"(program) {
        if (base.error) {
          context.report({ node: program, messageId: "baseline", data: { error: base.error } });
          return;
        }
        const allowed = Number.isInteger(base.files[rel]) ? base.files[rel] : 0;
        const count = lists.length;
        if (count > allowed) {
          for (const n of lists) context.report({ node: n, messageId: "over", data: { count, allowed } });
        } else if (count < allowed) {
          context.report({ node: program, messageId: "stale", data: { count, allowed } });
        }
      },
    };
  },
};
