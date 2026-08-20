#!/usr/bin/env node
/**
 * MUTATION HARNESS FOR THE CANDIDATE-PATTERN WIDENING.
 *
 * The danger here is not that the new slides fail to migrate — that is loud and
 * measurable. It is that widening the pattern quietly changes what four ALREADY
 * APPROVED fences covered, so `docs/MANIFEST_PROVENANCE.md` stops being true
 * while nothing anywhere goes red. 27 to 34 class B/C slides predate every
 * historical fence, so that is not a theoretical risk: it is what happens the
 * moment someone edits one regex in the wrong file.
 *
 * The second danger is the opposite: widening too far, and pulling in the
 * MUTABLE avatar paths whose bytes change under a recorded hash.
 *
 * Every mutation below is one of those two, and each must turn the suite RED.
 *
 * Usage: node tools/mutate-candidate-widening.mjs
 */
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { execSync } from "node:child_process";

const PLAN   = "supabase/functions/_shared/manifestPlan.ts";
const MIG    = "supabase/migrations/20260820090000_candidate_pattern_widened.sql";
const ENGINE = "supabase/migrations/20260818011014_media_migration_engine.sql";
const MIGRATOR = "supabase/functions/migrate-post-media/index.ts";
const MEASURE  = "supabase/functions/measure-post-media/index.ts";
const EDGE   = "supabase/functions/media-register-upload/index.ts";
const AUDIT  = "docs/CANDIDATE_PATTERN_AUDIT.md";
const PIN    = "src/__tests__/candidatePatternWidening.test.ts";

const SUITE = `${PIN} src/__tests__/mediaWritePath.test.ts src/__tests__/manifestMigrator.test.ts src/__tests__/measurePostMediaReadOnly.test.ts`;

const FILES = [PLAN, MIG, ENGINE, MIGRATOR, MEASURE, EDGE, AUDIT, PIN];
const originals = Object.fromEntries(FILES.map((f) => [f, readFileSync(f, "utf8")]));

const mutations = [
  {
    file: PLAN, name: "1. class A widened in place — every approved manifest now describes a different population",
    apply: (s) => s.replace(
      '{ cls: "A", re: new RegExp(`^post-images/${UUID_SEG}/posts/[^/?]+$`) },',
      '{ cls: "A", re: new RegExp(`^post-images/${UUID_SEG}/(posts/)?[^/?]+$`) },',
    ),
  },
  {
    file: MIG, name: "2. the FROZEN fence redefined in a later migration — four historical digests change",
    apply: (s) => s + `
CREATE OR REPLACE FUNCTION public.media_migration_fence_digest(_fence timestamptz)
RETURNS TABLE (key_set_md5 text, item_count integer, post_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$ select ''::text, 0, 0 $f$;
`,
  },
  {
    file: MIG, name: "3. the wide function stops being a drop-in (column names drift)",
    apply: (s) => s.replace(
      "RETURNS TABLE (key_set_md5 text, item_count integer, post_count integer)",
      "RETURNS TABLE (digest text, rows integer, posts integer)",
    ),
  },
  {
    file: MIG, name: "4. the wide function granted to authenticated",
    apply: (s) => s.replace(
      "REVOKE ALL ON FUNCTION public.media_migration_fence_digest_wide(timestamptz) FROM authenticated;",
      "GRANT EXECUTE ON FUNCTION public.media_migration_fence_digest_wide(timestamptz) TO authenticated;",
    ),
  },
  {
    file: PLAN, name: "5. class C loosened to swallow the MUTABLE avatar paths",
    apply: (s) => s.replace(
      '{ cls: "C", re: new RegExp(`^avatars/${UUID_SEG}/my-photos/${UUID_SEG}/[^/?]+$`) },',
      '{ cls: "C", re: new RegExp(`^avatars/${UUID_SEG}/.*$`) },',
    ),
  },
  {
    file: PLAN, name: "6. the query-string guard dropped — a cache-buster becomes part of an object key",
    apply: (s) => s.replace(/\[\^\/\?\]\+\$/g, "[^/]+$"),
  },
  {
    file: PLAN, name: "7. MIG-1017 stops classifying — anything reaches the manifest",
    apply: (s) => s.replace("if (candidateClass(object_path) === null) {", "if (false) {"),
  },
  {
    file: PLAN, name: "8. MIG-1019 stops pinning the owner to path segment 2",
    apply: (s) => s.replace('if (object_path.split("/")[1] !== owner_id) {', "if (false) {"),
  },
  {
    file: MIGRATOR, name: "9. the migrator defaults to the WIDE fence — a class-A run is silently regated",
    apply: (s) => s.replace("const wide: boolean = body?.wide === true;", "const wide: boolean = body?.wide !== false;"),
  },
  {
    file: MIGRATOR, name: "10. the run stops recording which population it was gated on",
    apply: (s) => s.replace("fence, fence_fn: fenceFn, wide, fence_live: live,", "fence, fence_live: live,"),
  },
  {
    // ⚠ RETARGETED 2026-08-20. The registrar's single-line prefix check became a
    // two-constant form when `avatars/<owner>/my-photos/` was admitted, so this
    // mutation stopped applying and reported a false escape — the same stale-target
    // bug as mutations 13, 21 and 22 in the write-path harness. The INVARIANT is
    // unchanged and is what the mutation must still break: the live registrar may
    // accept the immutable album prefix, and must never accept the whole avatars
    // folder, which holds avatar.webp and cover.webp.
    file: EDGE, name: "11. the LIVE registrar accepts all of avatars/ — a member registers their mutable avatar as a post photo",
    apply: (s) => s.replace(
      "const inMyPhotos = key.startsWith(`avatars/${ownerId}/my-photos/`);",
      "const inMyPhotos = key.startsWith(`avatars/${ownerId}/`);",
    ),
  },
  {
    file: MEASURE, name: "12. the measurement population loses class A's frozen shape",
    apply: (s) => s.replace(
      "/^https:\\/\\/cdn\\.50mmretina\\.com\\/post-images\\/[0-9a-f-]{36}\\/posts\\/[^/?]+$/,\n  /^https",
      "/^https",
    ),
  },
  {
    file: AUDIT, name: "13. the retrieval evidence deleted from the audit",
    apply: (s) => s.replace(/RETRIEVED 1080x1350/g, "probably fine"),
  },
];

function suiteResult() {
  try { execSync(`npx vitest run ${SUITE} --reporter=dot`, { stdio: "pipe" }); return "GREEN"; }
  catch { return "RED"; }
}

console.log(`baseline (no mutation): ${suiteResult()}\n`);
let undetected = 0;

for (const m of mutations) {
  const original = originals[m.file];
  const mutated = m.apply(original);
  if (mutated === original) { console.log(`✗ NOT APPLIED  ${m.name}`); undetected++; continue; }
  writeFileSync(m.file, mutated);
  const res = suiteResult();
  writeFileSync(m.file, original);
  if (res === "RED") console.log(`✓ DETECTED    ${m.name}`);
  else { console.log(`✗ UNDETECTED  ${m.name}  → suite stayed GREEN`); undetected++; }
}

// 14. the audit deleted outright — a file move, not an edit.
{
  const name = "14. the audit deleted — the widening loses its written justification";
  renameSync(AUDIT, AUDIT + ".mutated");
  const res = suiteResult();
  renameSync(AUDIT + ".mutated", AUDIT);
  if (res === "RED") console.log(`✓ DETECTED    ${name}`);
  else { console.log(`✗ UNDETECTED  ${name}  → suite stayed GREEN`); undetected++; }
}

for (const [f, s] of Object.entries(originals)) writeFileSync(f, s);
const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim();
console.log(`\nworking tree vs pre-run snapshot:\n${dirty || "NONE (fully restored)"}`);

if (undetected > 0) {
  console.error(`\n${undetected} MUTATION(S) UNDETECTED. A frozen fence could be redefined, or a mutable path admitted, in silence.`);
  process.exit(1);
}
console.log("\nALL CONTROLS DETECTED. The frozen fences cannot be redefined and the mutable paths cannot be admitted without the suite going red.");
