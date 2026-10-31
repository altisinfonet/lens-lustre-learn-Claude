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
const DELTA    = "supabase/migrations/20260820110000_media_write_path_delta.sql";
const MAIN     = "src/main.tsx";
const CATALOG  = "src/lib/errorCodes.ts";
const WIDEN    = "supabase/migrations/20260820090000_candidate_pattern_widened.sql";
const SYSPOST  = "supabase/migrations/20260820120000_system_post_media.sql";
const ATTRIB   = "supabase/migrations/20260820130000_delta_attribution.sql";
const MYPHOTOS = "src/pages/MyPhotos.tsx";
const PROFHELP = "src/lib/profilePostHelper.ts";
const PIN      = "src/__tests__/mediaWritePath.test.ts";

const SUITE = `${PIN} src/__tests__/publishAtomicity.test.ts src/__tests__/decisionRegister.test.ts`;

const FILES = [MIG, MIG2, CLIENT, COMPOSER, UPLOAD, STORED, EDGE, TOML, REG, PIN, SCHED, SCHEDHOOK, DELTA, MAIN, CATALOG, WIDEN, SYSPOST, ATTRIB, MYPHOTOS, PROFHELP];
const originals = Object.fromEntries(FILES.map((f) => [f, readFileSync(f, "utf8")]));

const mutations = [
  // ── the nine the brief named ──────────────────────────────────────────────
  {
    // ⚠ RETARGETED 2026-08-20 (WS2). The old target quoted
    // `await rpc<string>("media_begin_upload", {` — the DETACHED form, which was
    // RED-1 and has been removed. A mutation aimed at a line that no longer
    // exists does not apply, and the harness then reports a false escape: the
    // same stale-target bug as mutations 13, 21 and 22. Retargeted at the live
    // in-call-position form. The INVARIANT is unchanged: the client must open a
    // media_objects row before it publishes.
    file: CLIENT, name: "1. missing media_objects insert — the row is never opened",
    apply: (s) => s.replace(
      'const { data: mediaId, error: beginErr } = await (supabase.rpc as unknown as (',
      'const { data: mediaId, error: beginErr } = { data: "fake", error: null }; const _unused = ((',
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
    // ⚠ RETARGETED 2026-08-20. This originally mutated the copy of
    // media_mark_ready in MIG (20260820061500). The candidate-pattern widening
    // (20260820090000) then re-declared the function with CREATE OR REPLACE, so
    // MIG's copy became a SUPERSEDED definition — mutating it changed a file
    // but not the behaviour, and the harness reported an escape that was really
    // a stale target. The assertions resolve the LAST definition on purpose;
    // the mutation must aim at the same one.
    file: WIDEN, name: "13. media_mark_ready stops checking the object belongs to the owner",
    apply: (s) => s.replace(
      "  IF _orig IS NULL\n     OR _orig !~ ('^(post-images|avatars)/' || _owner::text || '/') THEN",
      "  IF FALSE THEN",
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

  // ── RED-1: the detached prototype method (WS2, 2026-08-20) ───────────────
  //
  // These re-introduce the EXACT line that shipped. Each must turn the suite
  // red. If any of them stays green, the guard added in WS2 is decorative and
  // the bug that cost members every photograph post can come back unnoticed.
  {
    file: CLIENT, name: "R1a. supabase.rpc DETACHED at the media_begin_upload site — the exact line that shipped",
    apply: (s) => s.replace(
      `  const { data: mediaId, error: beginErr } = await (supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: string | null; error: { message: string } | null }>)(
    "media_begin_upload",
    {`,
      `  const rpc = supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: string | null; error: { message: string } | null }>;
  const { data: mediaId, error: beginErr } = await rpc(
    "media_begin_upload",
    {`,
    ),
  },
  {
    file: CLIENT, name: "R1b. supabase.rpc DETACHED at the post_publish_with_media site",
    apply: (s) => s.replace(
      `  const { data: postId, error } = await (supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: string | null; error: { message: string } | null }>)(
    "post_publish_with_media",
    {`,
      `  const rpc = supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: string | null; error: { message: string } | null }>;
  const { data: postId, error } = await rpc(
    "post_publish_with_media",
    {`,
    ),
  },
  {
    file: PIN, name: "R1c. the client mock reverted to an OBJECT LITERAL — the blind spot that let RED-1 ship",
    apply: (s) => s.replace(
      `    /** Prototype method, exactly as supabase-js declares it. */
    rpc(fn: string, args: Record<string, unknown> = {}) {
      return this.rest.rpc(fn, args);
    }
  }

  return { supabase: new MockSupabaseClient() };`,
      `  }

  const rest = new MockRest();
  return {
    supabase: {
      rest,
      functions: new MockFunctions(),
      rpc: (fn: string, args: Record<string, unknown> = {}) => rest.rpc(fn, args),
    },
  };`,
    ),
  },
  {
    file: PIN, name: "R1d. the mock BINDS rpc — production does not, so the mock stops being able to fail",
    apply: (s) => s.replace(
      `  class MockSupabaseClient {
    rest = new MockRest();`,
      `  class MockSupabaseClient {
    constructor() { this.rpc = this.rpc.bind(this); }
    rest = new MockRest();`,
    ),
  },
  {
    file: PIN, name: "R1e. the repository-wide scan walks nothing — a vacuous guard that reads as proof",
    apply: (s) => s.replace(
      "        if (e.isDirectory()) return e.name === \"node_modules\" || e.name === \"__tests__\" ? [] : walk(full);",
      "        if (e.isDirectory()) return [];",
    ),
  },
  {
    file: PIN, name: "R1f. the scan stops treating a stored reference as different from a call",
    apply: (s) => s.replace(
      "(?:rpc|from)\\b(?!\\s*\\()/;",
      "(?:rpc|from)\\bXXNEVER/;",
    ),
  },
  // ── P3: the fallback must not mask a media-path failure (WS2, 2026-08-20) ─
  {
    file: CLIENT, name: "P3a. the two fallback conditions merged back into one — the leak looks like the floor",
    apply: (s) => s.replace(
      "  const undescribable = input.photos.filter((p) => !p.stored);\n  if (undescribable.length > 0) {",
      "  const undescribable = input.photos.filter((p) => !p.stored);\n  if (false) {",
    ),
  },
  {
    file: CLIENT, name: "P3b. every failure reported as unmigratable — MEDIA-4010 can never fire",
    apply: (s) => s.replace(
      'return { postId: null, viaMedia: false, failure: "media-path-failed" };',
      'return { postId: null, viaMedia: false, failure: "unmigratable-slides" };',
    ),
  },
  {
    file: CLIENT, name: "P3c. the throw guard removed — an exception escapes past the composer's fallback again (RED-1's real cost)",
    apply: (s) => s.replace(
      "  try {\n    return await registerUploadedPhotoInner(photo, correlationId);\n  } catch (e) {",
      "  if (true) {\n    return await registerUploadedPhotoInner(photo, correlationId);\n  }\n  { const e = new Error(); {",
    ),
  },
  {
    file: CLIENT, name: "P3d. MEDIA-4006 stops firing on the composer path once classification moves up front",
    apply: (s) => s.replace(
      "    for (const p of undescribable) reportUndescribableSlide(p, input.idempotencyKey);\n",
      "",
    ),
  },
  {
    file: CATALOG, name: "P3e. MEDIA-4010 downgraded to a warning — the leak stops being alertable",
    apply: (s) => s.replace(
      '    code: "MEDIA-4010",\n    severity: "error",',
      '    code: "MEDIA-4010",\n    severity: "warn",',
    ),
  },
  {
    file: COMPOSER, name: "P3f. the composer stops branching — MEDIA-4010 is never emitted",
    apply: (s) => s.replace(
      "        if (!unmigratable) reportMediaPathFailure(correlationId);\n",
      "",
    ),
  },
  {
    file: COMPOSER, name: "P3g. MEDIA-4001 stops counting the expected kind — the log undercounts the database",
    apply: (s) => s.replace(
      "        const unmigratable = viaMedia.failure === \"unmigratable-slides\";\n        if (!unmigratable) reportMediaPathFailure(correlationId);\n        reportLegacyOnlyPublish(",
      "        const unmigratable = viaMedia.failure === \"unmigratable-slides\";\n        if (!unmigratable) reportMediaPathFailure(correlationId);\n        if (!unmigratable) reportLegacyOnlyPublish(",
    ),
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

// ⚠ A RED BASELINE INVALIDATES EVERY RESULT BELOW. If the suite is already
// failing, every mutation is "detected" for a reason that has nothing to do
// with the mutation, and the run prints a page of green ticks that mean nothing.
// Added 2026-08-20 (WS2) after the scheduled-duplicate harness did exactly that.
const baseline = suiteResult();
console.log(`baseline (no mutation): ${baseline}\n`);
if (baseline !== "GREEN") {
  console.error("BASELINE IS RED — fix the suite before drawing any conclusion from a mutation run.");
  process.exit(1);
}
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

// ── 19–23: the stale-client hole, closed 2026-08-20 ────────────────────────
//
// These five are the ones the 07:08 incident proves are needed. Each is a
// plausible tidy-up that would restore the exact blindness that let a
// legacy-only post through unnoticed.
for (const m of [
  {
    file: CLIENT,
    name: "19. MEDIA-4006 deleted — an undescribable slide is silently dropped again",
    apply: (s) => s.replace(
      /  if \(!photo\.stored\) \{[\s\S]*?\n    return null;\n  \}/,
      "  if (!photo.stored) return null;",
    ),
  },
  {
    file: CLIENT,
    name: "20. MEDIA-4006 downgraded to a comment (an assertion satisfiable by prose)",
    apply: (s) => s.replace('code: "MEDIA-4006",', 'code: "MEDIA-9999", // was MEDIA-4006'),
  },
  {
    // ⚠ RETARGETED 2026-08-20, same stale-target bug as mutation 13. The delta
    // check's original migration (20260820110000) was superseded by the
    // attribution migration (20260820130000) via CREATE OR REPLACE, so mutating
    // the older file changed a file without changing the live definition. The
    // assertions resolve the LAST definition on purpose; the mutation must aim
    // at the same one.
    file: ATTRIB,
    name: "21. the delta check starts reading client_errors — inherits the blindness",
    apply: (s) => s.replace(
      "    from public.posts p\n    where coalesce(array_length(p.image_urls, 1), 0) > 0",
      "    from public.posts p left join public.client_errors ce on ce.user_id = p.user_id\n    where coalesce(array_length(p.image_urls, 1), 0) > 0",
    ),
  },
  {
    // ⚠ RETARGETED 2026-08-20 — see the note on 21.
    file: ATTRIB,
    name: "22. the scoped 'new' counters removed — a shrinking total hides a growing edge",
    apply: (s) => s.replace(/'new_legacy_only_posts',/, "'unused_counter',"),
  },
  {
    file: DELTA,
    name: "23. the revoke dropped and execute granted to the client",
    apply: (s) => s.replace(
      /revoke all on function public\.media_write_path_delta\(timestamptz\) from public, anon, authenticated;/,
      "grant execute on function public.media_write_path_delta(timestamptz) to authenticated;",
    ),
  },
  {
    file: MAIN,
    name: "24. the build marker reverted to the value the stale client reported",
    apply: (s) => s.replace(/__APP_BUILD = "[^"]+"/, '__APP_BUILD = "2026-08-10-3"'),
  },
  {
    file: CATALOG,
    name: "25. MEDIA-4006 removed from the catalog while the client still emits it",
    apply: (s) => s.replace('    code: "MEDIA-4006",', '    code: "MEDIA-4106",'),
  },
]) {
  const original = originals[m.file];
  const mutated = m.apply(original);
  if (mutated === original) { console.log(`✗ NOT APPLIED  ${m.name}`); undetected++; continue; }
  writeFileSync(m.file, mutated);
  const res = suiteResult();
  writeFileSync(m.file, original);
  if (res === "RED") console.log(`✓ DETECTED    ${m.name}`);
  else { console.log(`✗ UNDETECTED  ${m.name}  → suite stayed GREEN`); undetected++; }
}

// ── 26–34: the fourth write surface, found in the closure audit ───────────
//
// `create_system_post` was granted to `authenticated`, inserted into posts with
// image_urls and nothing else, and reported NOTHING — MEDIA-4001 lives in the
// composer's client code and this RPC is called from two other places entirely.
// Every mutation below restores some part of that hole.
for (const m of [
  {
    file: SYSPOST,
    name: "26. create_system_post stops attaching media — album posts go legacy-only again",
    apply: (s) => s.replace(/PERFORM public\.post_attach_media\(_id, _media_ids\);/, "NULL;"),
  },
  {
    file: SYSPOST,
    name: "27. the guarded attach becomes unguarded — a refusal now costs the member the post",
    apply: (s) => s.replace(
      /    BEGIN\n      PERFORM public\.post_attach_media\(_id, _media_ids\);\n    EXCEPTION WHEN OTHERS THEN\n      RAISE WARNING 'MEDIA-4008[^\n]*\n    END;/,
      "    PERFORM public.post_attach_media(_id, _media_ids);",
    ),
  },
  {
    file: SYSPOST,
    name: "28. the 4-arg overload is left in place — every 4-arg call becomes ambiguous (42725)",
    apply: (s) => s.replace(
      /drop function if exists public\.create_system_post\(text, text, text\[\], text\[\]\);/,
      "-- drop removed",
    ),
  },
  {
    file: SYSPOST,
    name: "29. the PUBLIC/anon grant is left in place on a SECURITY DEFINER function",
    apply: (s) => s.replace(
      /revoke all on function public\.create_system_post\([^)]*\) from public, anon;/,
      "-- revoke removed",
    ),
  },
  {
    file: MYPHOTOS,
    name: "30. MyPhotos stops registering media — album uploads grow the delta silently",
    apply: (s) => s.replace(/const mediaIds = await registerAllOrNone\(/, "const mediaIds = null && await registerAllOrNone("),
  },
  {
    file: MYPHOTOS,
    name: "31. MyPhotos stops carrying the stored facts — every slide is undescribable",
    apply: (s) => s.replace(/uploadedStored\.push\(result\.stored\);/, ""),
  },
  {
    file: PROFHELP,
    name: "32. the permanent floor is reported as MEDIA-4001, so it reads as a regression",
    apply: (s) => s.replace(/code: "MEDIA-4007"/, 'code: "MEDIA-4001"'),
  },
  {
    file: ATTRIB,
    name: "33. delta_growing stops excluding the floor — the alarm fires on healthy behaviour",
    apply: (s) => s.replace(
      /'delta_growing',\s*\(select count\(\*\) > 0 from recent_legacy where not has_mutable_media\)/,
      "'delta_growing',            (select count(*) > 0 from recent_legacy)",
    ),
  },
  {
    file: ATTRIB,
    name: "34. mutable media classified by post_kind instead of URL shape (misses the 14 oldest)",
    apply: (s) => s.replace(/has_mutable_media/g, "is_system_kind"),
  },
]) {
  const original = originals[m.file];
  const mutated = m.apply(original);
  if (mutated === original) { console.log(`✗ NOT APPLIED  ${m.name}`); undetected++; continue; }
  writeFileSync(m.file, mutated);
  const res = suiteResult();
  writeFileSync(m.file, original);
  if (res === "RED") console.log(`✓ DETECTED    ${m.name}`);
  else { console.log(`✗ UNDETECTED  ${m.name}  → suite stayed GREEN`); undetected++; }
}

// 35. the album registrar prefix widened to the whole avatars folder.
{
  const name = "35. media-register-upload widened to all of avatars/<owner>/ — mutable avatar registrable";
  const original = originals[EDGE];
  const mutated = original.replace(
    "const inMyPhotos = key.startsWith(`avatars/${ownerId}/my-photos/`);",
    "const inMyPhotos = key.startsWith(`avatars/${ownerId}/`);",
  );
  if (mutated === original) { console.log(`✗ NOT APPLIED  ${name}`); undetected++; }
  else {
    writeFileSync(EDGE, mutated);
    const res = suiteResult();
    writeFileSync(EDGE, original);
    if (res === "RED") console.log(`✓ DETECTED    ${name}`);
    else { console.log(`✗ UNDETECTED  ${name}  → suite stayed GREEN`); undetected++; }
  }
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
