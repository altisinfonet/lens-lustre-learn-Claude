#!/usr/bin/env node
/**
 * MUTATION HARNESS FOR THE LIVE MEDIA WRITE PATH.
 *
 * The write path's whole purpose is that a newly published photograph cannot
 * become an `image_urls`-only post. Every failure that matters here is SILENT:
 * the post still publishes, the member sees their photograph, and the only
 * visible symptom is a number in a reconciliation report weeks later. A green
 * suite therefore proves nothing on its own — each control below is removed,
 * and each removal must turn the suite RED.
 *
 * The nine mutations the brief named are 1–9. 10–17 are the ones this
 * implementation makes possible and a reviewer would not think to look for.
 *
 * Usage: node tools/mutate-write-path.mjs
 */
import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { execSync } from "node:child_process";

const MIG      = "supabase/migrations/20260820061500_media_write_path_live.sql";
const CLIENT   = "src/lib/media/postMediaWrite.ts";
const COMPOSER = "src/components/WallPosts.tsx";
const UPLOAD   = "src/lib/imageUpload.ts";
const STORED   = "src/lib/media/storedObject.ts";
const EDGE     = "supabase/functions/media-register-upload/index.ts";
const TOML     = "supabase/config.toml";
const MIG2     = "supabase/migrations/20260820073000_media_attach_for_deferred_publish.sql";
const SCHED    = "supabase/functions/publish-scheduled-posts/index.ts";
const SCHEDHOOK= "src/hooks/feed/useScheduledPosts.ts";
const REG      = "docs/DECISIONS.md";
const PIN      = "src/__tests__/mediaWritePath.test.ts";

const SUITE = `${PIN} src/__tests__/publishAtomicity.test.ts src/__tests__/decisionRegister.test.ts`;

const FILES = [MIG, MIG2, CLIENT, COMPOSER, UPLOAD, STORED, EDGE, TOML, REG, PIN, SCHED, SCHEDHOOK];
const originals = Object.fromEntries(FILES.map((f) => [f, readFileSync(f, "utf8")]));

const mutations = [
  // ── the nine the brief named ──────────────────────────────────────────────
  {
    file: CLIENT, name: "1. missing media_objects insert — the row is never opened",
    apply: (s) => s.replace(
      'const { data: mediaId, error: beginErr } = await rpc<string>("media_begin_upload", {',
      'const { data: mediaId, error: beginErr } = { data: "fake", error: null }; const _unused = ({',
    ),
  },
  {
    file: MIG, name: "2. missing post_media insert — the post publishes with no references",
    apply: (s) => s.replace(
      "  INSERT INTO public.post_media (post_id, ord, media_id)\n  SELECT _post_id, ord - 1, mid\n  FROM unnest(_media_ids) WITH ORDINALITY AS t(mid, ord);",
      "  -- references intentionally not inserted",
    ),
  },
  {
    file: MIG, name: "3. wrong owner — ownership no longer checked at publish",
    apply: (s) => s.replace("mo.owner_id <> _uid OR mo.state <> 'ready'", "mo.state <> 'ready'"),
  },
  {
    file: MIG, name: "4. wrong ord — ords no longer come from the array's ordinality",
    apply: (s) => s.replace(
      "  SELECT _post_id, ord - 1, mid\n  FROM unnest(_media_ids) WITH ORDINALITY AS t(mid, ord);",
      "  SELECT _post_id, 0, mid\n  FROM unnest(_media_ids) AS t(mid);",
    ),
  },
  {
    file: MIG, name: "5. missing readiness verification — unverified bytes may be published",
    apply: (s) => s.replace("mo.owner_id <> _uid OR mo.state <> 'ready'", "mo.owner_id <> _uid"),
  },
  {
    file: MIG, name: "6. missing transaction/rollback — the completeness gate removed",
    apply: (s) => s.replace(
      "    RAISE EXCEPTION 'publish aborted: % of % photographs attached', _bad, _n USING ERRCODE = '23514';",
      "    NULL;",
    ),
  },
  {
    file: EDGE, name: "7. caller-supplied owner — the path checked against the request, not the row",
    apply: (s) => s.replace(
      "const key = objectKeyForOwner(rawPath, row.owner_id);",
      "const key = objectKeyForOwner(rawPath, callerId);",
    ),
  },
  {
    file: MIG, name: "8. privacy bypass — privacy defaulted instead of carried",
    apply: (s) => s.replace(
      "  VALUES (_uid, COALESCE(_content, ''), _privacy, COALESCE(_categories, '{}'),",
      "  VALUES (_uid, COALESCE(_content, ''), 'public', COALESCE(_categories, '{}'),",
    ),
  },
  {
    file: MIG, name: "9. duplicate prevention removed — the same photograph twice in one post",
    apply: (s) => s.replace(
      "    RAISE EXCEPTION 'the same photograph appears more than once in this post' USING ERRCODE = '22023';",
      "    NULL;",
    ),
  },

  // ── the ones this implementation makes possible ──────────────────────────
  {
    file: MIG, name: "10. the D-004 dual-write dropped — every Android member's photo blanks",
    apply: (s) => s.replace("_image_urls[1], _image_urls, _thumbs)", "NULL, '{}', NULL)"),
  },
  {
    file: MIG, name: "11. image_urls becomes a PARAMETER — the legacy array can now lie",
    apply: (s) => s
      .replace("  _thumbnail_urls   text[]  DEFAULT NULL\n)", "  _thumbnail_urls   text[]  DEFAULT NULL,\n  _image_urls       text[]  DEFAULT NULL\n)")
      .replace("  _image_urls text[];\n", ""),
  },
  {
    file: MIG, name: "12. the thumbnail constraint removed — a grid can point anywhere",
    apply: (s) => s.replace(
      "      RAISE EXCEPTION 'MEDIA-2113 % thumbnail url(s) are neither the photograph nor its -thumb sibling', _bad\n        USING ERRCODE = '23514';",
      "      NULL;",
    ),
  },
  {
    file: MIG, name: "13. media_mark_ready stops checking the object belongs to the owner",
    apply: (s) => s.replace(
      "    RAISE EXCEPTION 'MEDIA-2102 derivative original % is not inside post-images/%/', _orig, _owner\n      USING ERRCODE = '23514';",
      "    NULL;",
    ),
  },
  {
    file: COMPOSER, name: "14. the fallback reordered — legacy first, so the media path rots",
    apply: (s) => s.replace("if (!viaMedia.viaMedia) {", "if (true) {"),
  },
  {
    file: COMPOSER, name: "15. the legacy-only counter deleted — the delta grows invisibly",
    apply: (s) => s.replace(/\s*reportLegacyOnlyPublish\([\s\S]*?\);\n/, "\n"),
  },
  {
    file: UPLOAD, name: "16. the picked file hashed instead of the encoded one — every upload quarantines",
    apply: (s) => s.replace("await describeStoredObject(fullResFile, encodedDims)", "await describeStoredObject(file, encodedDims)"),
  },
  // ── the deferred publish paths ───────────────────────────────────────────
  {
    file: MIG2, name: "19. MEDIA-2205 removed — a draft can attach the member's OTHER photographs",
    apply: (s) => s.replace(
      "    RAISE EXCEPTION 'MEDIA-2205 % of % media do not resolve to the photographs this post shows',\n      _bad, _n USING ERRCODE = '23514';",
      "    NULL;",
    ),
  },
  {
    file: MIG2, name: "20. the author read from the caller instead of the post",
    apply: (s) => s.replace(
      "SELECT user_id, coalesce(image_urls, '{}') INTO _author, _slides",
      "SELECT auth.uid(), coalesce(image_urls, '{}') INTO _author, _slides",
    ),
  },
  {
    file: MIG2, name: "21. whole-post rule dropped — a post may carry fewer references than photographs",
    apply: (s) => s.replace(
      "    RAISE EXCEPTION 'MEDIA-2204 post % shows % photographs, % media offered',\n      _post_id, coalesce(array_length(_slides, 1), 0), _n USING ERRCODE = '23514';",
      "    NULL;",
    ),
  },
  {
    file: MIG2, name: "22. the draft attach stops being guarded — a refusal now costs the member the post",
    apply: (s) => s.replace(
      "  BEGIN\n    PERFORM public.post_attach_media(_post_id, _d.media_ids);\n  EXCEPTION WHEN OTHERS THEN\n    RAISE WARNING 'DRAFT-005: media references not attached to post %: %', _post_id, SQLERRM;\n  END;",
      "  PERFORM public.post_attach_media(_post_id, _d.media_ids);",
    ),
  },
  {
    file: MIG2, name: "23. post_attach_media granted to authenticated — members attach their own references",
    apply: (s) => s.replace(
      "REVOKE ALL ON FUNCTION public.post_attach_media(uuid, uuid[]) FROM authenticated;",
      "GRANT EXECUTE ON FUNCTION public.post_attach_media(uuid, uuid[]) TO authenticated;",
    ),
  },
  {
    file: CLIENT, name: "24. registerAllOrNone registers a SUBSET — drafts publish with ord gaps",
    apply: (s) => s.replace("    if (!id) return null;\n    ids.push(id);", "    if (id) ids.push(id);"),
  },
  {
    file: COMPOSER, name: "25. resumed draft slides claim a declaration they do not have",
    apply: (s) => s.replace(
      "let stored: (StoredObjectFacts | null)[] = resumedUrls.map(() => null);",
      "let stored: (StoredObjectFacts | null)[] = [];",
    ),
  },
  {
    file: SCHED, name: "26. the scheduled publisher stops attaching media",
    apply: (s) => s.replace('const { error: attachErr } = await admin.rpc("post_attach_media", {', 'const { error: attachErr } = { error: null } as never; void ({'),
  },
  {
    file: SCHED, name: "27. an unattached scheduled post stops being counted",
    apply: (s) => s.replace(/\s*console\.warn\(\s*`MEDIA-4005[\s\S]*?\);\n/, "\n"),
  },
  {
    file: SCHEDHOOK, name: "28. scheduled rows stop carrying media_ids",
    apply: (s) => s.replace("          media_ids: input.media_ids ?? null,\n", ""),
  },

  {
    file: TOML, name: "17. the superseded verifier deployed — every upload strands at pending",
    apply: (s) => s + "\n  [functions.media-verify-upload]\n    verify_jwt = true\n",
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

// 18. the verifier deleted outright — a file move, not an edit.
{
  const name = "18. media-register-upload deleted — nothing can move an upload to ready";
  renameSync(EDGE, EDGE + ".mutated");
  const res = suiteResult();
  renameSync(EDGE + ".mutated", EDGE);
  if (res === "RED") console.log(`✓ DETECTED    ${name}`);
  else { console.log(`✗ UNDETECTED  ${name}  → suite stayed GREEN`); undetected++; }
}

for (const [f, s] of Object.entries(originals)) writeFileSync(f, s);
const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim();
console.log(`\nworking tree vs pre-run snapshot:\n${dirty || "NONE (fully restored)"}`);

if (undetected > 0) {
  console.error(`\n${undetected} MUTATION(S) UNDETECTED. A new post could silently become image_urls-only again.`);
  process.exit(1);
}
console.log("\nALL CONTROLS DETECTED. A newly published photograph cannot silently become an image_urls-only post.");
