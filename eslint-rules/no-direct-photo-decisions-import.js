/**
 * no-direct-photo-decisions-import — Audit v6 Phase 4 chokepoint enforcement.
 *
 * Forbids value imports of the per-photo aggregation primitives
 * (`usePhotoDecisions`, `usePhotoPlacements`, `fetchPhotoConsensus`,
 * `fetchPhotoPlacements`, `buildPhotoStatusMaps`) outside the single
 * sanctioned chokepoint `src/lib/perPhotoStatus.ts`.
 *
 * WHY: Phase 4 wired the chokepoint to merge consensus + R4 placement in
 * parallel via `fetchPhotoStatusMaps`. A new component that imports
 * `usePhotoDecisions` directly would silently bypass the placement merge
 * and re-introduce the "R4 placement label missing on per-photo grid" bug
 * that participant `sendipannita2@gmail.com` repro'd before Phase 3.
 *
 * Type-only imports (`import type { PerPhotoStatus }`) are intentionally
 * allowed — they carry no runtime behaviour.
 *
 * Allowlist:
 *   - src/lib/perPhotoStatus.ts                          (the chokepoint)
 *   - src/hooks/judging/usePhotoDecisions.ts             (defines the API)
 *   - src/hooks/judging/usePhotoPlacements.ts            (sibling)
 *   - src/lib/judging/mergeConsensusAndPlacement.ts      (merge helper)
 *   - src/test/**                                        (parity specs)
 */
const FORBIDDEN_NAMED = new Set([
  "usePhotoDecisions",
  "usePhotoPlacements",
  "fetchPhotoConsensus",
  "fetchPhotoPlacements",
  "buildPhotoStatusMaps",
]);

const FORBIDDEN_SOURCES = [
  "@/hooks/judging/usePhotoDecisions",
  "@/hooks/judging/usePhotoPlacements",
];

const FILE_ALLOWLIST = [
  "/src/lib/perPhotoStatus.ts",
  "/src/hooks/judging/usePhotoDecisions.ts",
  "/src/hooks/judging/usePhotoPlacements.ts",
  "/src/lib/judging/mergeConsensusAndPlacement.ts",
];

const DIR_ALLOWLIST = ["/src/test/"];

function isAllowlisted(filename) {
  if (!filename) return true;
  const norm = filename.replace(/\\/g, "/");
  if (FILE_ALLOWLIST.some((p) => norm.endsWith(p))) return true;
  return DIR_ALLOWLIST.some((p) => norm.includes(p));
}

function sourceMatches(value) {
  if (!value) return false;
  // Exact alias match, or relative path ending with the same module name.
  if (FORBIDDEN_SOURCES.includes(value)) return true;
  return /(^|\/)usePhotoDecisions$|(^|\/)usePhotoPlacements$/.test(value);
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid direct value imports of usePhotoDecisions / usePhotoPlacements / fetchPhotoConsensus / fetchPhotoPlacements / buildPhotoStatusMaps outside the perPhotoStatus chokepoint. Use fetchPhotoStatusMaps from '@/lib/perPhotoStatus' instead.",
    },
    schema: [],
    messages: {
      forbidden:
        "Audit v6 Phase 4: do not import `{{name}}` directly. " +
        "Use `fetchPhotoStatusMaps` from '@/lib/perPhotoStatus' which merges " +
        "per-photo consensus AND R4 placements. Direct hook usage bypasses " +
        "the placement merge and silently drops R4 labels (winner / runner-up / " +
        "honorary / top_50 / top_100) on the per-photo grid.",
    },
  },
  create(context) {
    const filename = context.getFilename();
    if (isAllowlisted(filename)) return {};

    return {
      ImportDeclaration(node) {
        // Allow `import type { ... } from "..."` entirely (no runtime).
        if (node.importKind === "type") return;
        if (!sourceMatches(node.source && node.source.value)) return;

        for (const spec of node.specifiers) {
          // Per-specifier `import { type X }` is also a type-only specifier.
          if (spec.importKind === "type") continue;
          if (spec.type !== "ImportSpecifier") {
            // Default or namespace import of a forbidden module — block.
            context.report({
              node: spec,
              messageId: "forbidden",
              data: { name: spec.local && spec.local.name ? spec.local.name : "<module>" },
            });
            continue;
          }
          const importedName =
            spec.imported && spec.imported.name ? spec.imported.name : null;
          if (importedName && FORBIDDEN_NAMED.has(importedName)) {
            context.report({
              node: spec,
              messageId: "forbidden",
              data: { name: importedName },
            });
          }
        }
      },
    };
  },
};

export default rule;
