/**
 * Step 21 — Custom ESLint rule: require-phase-watermark
 *
 * Any <img> rendering competition_entries.photos in a non-thumbnail context
 * MUST have a <PhaseWatermark> sibling within the same parent JSXElement.
 *
 * Heuristic for "competition photo, non-thumbnail context":
 *   - <img> whose `src` references one of: photoUrl, photo_url, entry.photos,
 *     current.photoUrl, photos[, .photos[, primaryPhoto, coverPhoto, photo.url
 *   - AND the file path is in a known competition surface (see SURFACES).
 *   - Thumbnails are skipped via opt-out: add `data-watermark="skip"` on the
 *     <img> OR wrap parent with `data-watermark-skip` attribute, OR src
 *     references `thumbnail`/`thumb`/`avatar`.
 *
 * Gate: CI lint fails if a new surface renders a competition photo without
 * mounting <PhaseWatermark /> as a sibling.
 */

const SURFACE_PATTERNS = [
  /EntryCard\.tsx$/,
  /CompetitionLightbox\.tsx$/,
  /JuryImageViewer\.tsx$/,
  /CinemaFullView\.tsx$/,
  /CinemaListView\.tsx$/,
  /CinemaJudgeView\.tsx$/,
  /VirtualizedPhotoGrid\.tsx$/,
  /MobileJudgeView\.tsx$/,
  /EntryDetail\.tsx$/,
  /SubmissionDetail\.tsx$/,
  /Dashboard\.tsx$/,
  /PublicProfile\.tsx$/,
  /AdminEntriesSection\.tsx$/,
];

const COMPETITION_SRC_HINTS = [
  "photoUrl",
  "photo_url",
  ".photos[",
  "photos[0]",
  "primaryPhoto",
  "coverPhoto",
  "entry.photos",
  "current.photoUrl",
  "photo.url",
];

const THUMBNAIL_HINTS = ["thumbnail", "thumb", "avatar", "icon"];

function srcExpressionToString(node) {
  if (!node) return "";
  if (node.type === "Literal") return String(node.value || "");
  if (node.type === "TemplateLiteral") {
    return node.quasis.map((q) => q.value.cooked).join("${...}");
  }
  if (node.type === "JSXExpressionContainer") {
    return srcExpressionToString(node.expression);
  }
  if (node.type === "MemberExpression") {
    const obj = srcExpressionToString(node.object);
    const prop = node.computed
      ? `[${srcExpressionToString(node.property)}]`
      : node.property && node.property.name
      ? `.${node.property.name}`
      : "";
    return `${obj}${prop}`;
  }
  if (node.type === "Identifier") return node.name || "";
  if (node.type === "CallExpression") {
    return srcExpressionToString(node.callee) + "(...)";
  }
  if (node.type === "ConditionalExpression") {
    return `${srcExpressionToString(node.consequent)}|${srcExpressionToString(
      node.alternate,
    )}`;
  }
  return "";
}

function getAttr(jsxElement, name) {
  if (!jsxElement || !jsxElement.openingElement) return null;
  return jsxElement.openingElement.attributes.find(
    (a) => a.type === "JSXAttribute" && a.name && a.name.name === name,
  );
}

function isThumbnailContext(jsxElement) {
  // explicit opt-out
  const skip = getAttr(jsxElement, "data-watermark");
  if (skip && skip.value && skip.value.value === "skip") return true;

  const src = getAttr(jsxElement, "src");
  if (!src) return true; // no src → not a competition photo
  const srcStr = srcExpressionToString(src.value).toLowerCase();
  if (!srcStr) return false;
  return THUMBNAIL_HINTS.some((h) => srcStr.includes(h));
}

function looksLikeCompetitionPhoto(jsxElement) {
  const src = getAttr(jsxElement, "src");
  if (!src) return false;
  const srcStr = srcExpressionToString(src.value);
  if (!srcStr) return false;
  return COMPETITION_SRC_HINTS.some((h) => srcStr.includes(h));
}

function jsxNodeMentionsPhaseWatermark(node) {
  if (!node) return false;
  if (node.type === "JSXElement") {
    const name = node.openingElement && node.openingElement.name;
    if (name && name.type === "JSXIdentifier" && name.name === "PhaseWatermark")
      return true;
    return (node.children || []).some(jsxNodeMentionsPhaseWatermark);
  }
  if (node.type === "JSXFragment") {
    return (node.children || []).some(jsxNodeMentionsPhaseWatermark);
  }
  if (node.type === "JSXExpressionContainer") {
    return expressionMentionsPhaseWatermark(node.expression);
  }
  return false;
}

function expressionMentionsPhaseWatermark(expr) {
  if (!expr) return false;
  if (expr.type === "JSXElement" || expr.type === "JSXFragment")
    return jsxNodeMentionsPhaseWatermark(expr);
  if (expr.type === "LogicalExpression")
    return (
      expressionMentionsPhaseWatermark(expr.left) ||
      expressionMentionsPhaseWatermark(expr.right)
    );
  if (expr.type === "ConditionalExpression")
    return (
      expressionMentionsPhaseWatermark(expr.consequent) ||
      expressionMentionsPhaseWatermark(expr.alternate)
    );
  if (expr.type === "CallExpression")
    return (expr.arguments || []).some(expressionMentionsPhaseWatermark);
  return false;
}

function hasPhaseWatermarkSibling(jsxElement) {
  const parent = jsxElement.parent;
  if (!parent) return false;

  // Climb to nearest JSXElement/JSXFragment parent
  let container = parent;
  while (
    container &&
    container.type !== "JSXElement" &&
    container.type !== "JSXFragment" &&
    container.type !== "Program"
  ) {
    container = container.parent;
  }
  if (!container || container.type === "Program") return false;

  const children = container.children || [];
  return children.some((child) => jsxNodeMentionsPhaseWatermark(child));
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require <PhaseWatermark /> sibling for competition photo <img> tags in non-thumbnail surfaces.",
    },
    schema: [],
    messages: {
      missing:
        "Competition photo <img> in {{file}} must have <PhaseWatermark /> as sibling. Add `<PhaseWatermark phase={...} currentRound={...} />` next to this <img>, or mark thumbnail with data-watermark=\"skip\".",
    },
  },
  create(context) {
    const filename = context.getFilename();
    const isWatched = SURFACE_PATTERNS.some((p) => p.test(filename));
    if (!isWatched) return {};

    return {
      JSXOpeningElement(node) {
        if (!node.name || node.name.name !== "img") return;
        const jsxElement = node.parent; // JSXElement
        if (isThumbnailContext(jsxElement)) return;
        if (!looksLikeCompetitionPhoto(jsxElement)) return;
        if (hasPhaseWatermarkSibling(jsxElement)) return;
        context.report({
          node,
          messageId: "missing",
          data: { file: filename.split("/").pop() },
        });
      },
    };
  },
};
