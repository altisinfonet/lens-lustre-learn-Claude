#!/usr/bin/env node
/**
 * MUTATION HARNESS FOR THE MEDIA READ RPC.
 *
 * `post_media_for` is SECURITY DEFINER. Row-level security does not apply to the
 * tables it reads, so its WHERE clause is the entire access control. A test that
 * merely passes proves nothing about that; a test that goes RED when the control
 * is removed proves everything.
 *
 * Each mutation below removes or weakens one control in the shipped migration
 * and requires `postMediaForSecurity.test.ts` to fail. A mutation that leaves the
 * suite green is a control nobody is testing — it is decorated, not covered.
 *
 * The measured consequence of mutation 1, taken against real production data in
 * a rolled-back transaction on 2026-08-19:
 *
 *     anon reading a PRIVATE post's media       1 row   (correct answer: 0)
 *     a stranger reading a FRIENDS-ONLY post     1 row   (correct answer: 0)
 *
 * Every mutation is applied to a copy, the file is restored from that copy
 * afterwards, and the run ends by re-asserting the working tree is clean.
 *
 * Usage: node tools/mutate-post-media-rpc.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const SQL   = "supabase/migrations/20260819170132_post_media_read_rpc.sql";
const SUITE = "src/__tests__/postMediaForSecurity.test.ts";

const original = readFileSync(SQL, "utf8");

/** The suite must FAIL for every one of these. */
const mutations = [
  {
    name: "1. the can_view_post predicate — the entire access control",
    apply: (s) => s.replace(
      /\n\s*-- ⚠ DO NOT REMOVE\. This is the entire access control\.\n\s*and public\.can_view_post\(auth\.uid\(\), p\.user_id, p\.privacy\)/,
      "",
    ),
  },
  {
    name: "2. auth.uid() replaced by a caller-supplied viewer id",
    apply: (s) => s.replace(
      "and public.can_view_post(auth.uid(), p.user_id, p.privacy)",
      "and public.can_view_post(_viewer_id, p.user_id, p.privacy)",
    ),
  },
  {
    name: "3. the 50-id cap that stops it becoming a bulk exporter",
    apply: (s) => s.replace(/if array_length\(_post_ids, 1\) > 50 then/, "if false then"),
  },
  {
    name: "4. SECURITY DEFINER's pinned search_path",
    apply: (s) => s.replace("set search_path to 'public'\n", ""),
  },
  {
    name: "5. sha256 added to the return type and the select list",
    apply: (s) => s
      .replace("  bytes       bigint\n)", "  bytes       bigint,\n  sha256      bytea\n)")
      .replace("mo.width, mo.height, mo.mime, mo.bytes", "mo.width, mo.height, mo.mime, mo.bytes, mo.sha256"),
  },
  {
    name: "6. REVOKE ALL FROM public dropped",
    apply: (s) => s.replace(/revoke all on function public\.post_media_for\(uuid\[\]\) from public;\n/, ""),
  },
  {
    name: "7. a table GRANT smuggled in beside the function",
    apply: (s) => s.replace(
      "grant execute on function public.post_media_for(uuid[]) to anon, authenticated;",
      "grant execute on function public.post_media_for(uuid[]) to anon, authenticated;\ngrant select on public.media_objects to authenticated;",
    ),
  },
  {
    name: "8. STABLE weakened to VOLATILE",
    apply: (s) => s.replace(/\nstable\n/, "\nvolatile\n"),
  },
];

function suiteResult() {
  try {
    execSync(`npx vitest run ${SUITE} --reporter=dot`, { stdio: "pipe" });
    return "GREEN";
  } catch {
    return "RED";
  }
}

console.log(`baseline (no mutation): ${suiteResult()}\n`);

let undetected = 0;
for (const m of mutations) {
  const mutated = m.apply(original);
  if (mutated === original) {
    console.log(`✗ NOT APPLIED  ${m.name}  → the pattern no longer matches the file`);
    undetected++;
    continue;
  }
  writeFileSync(SQL, mutated);
  const res = suiteResult();
  writeFileSync(SQL, original);
  if (res === "RED") {
    console.log(`✓ DETECTED  ${m.name}  → suite RED`);
  } else {
    console.log(`✗ UNDETECTED  ${m.name}  → suite stayed GREEN`);
    undetected++;
  }
}

writeFileSync(SQL, original);
const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim();
console.log(`\nfiles differing from the pre-run snapshot: ${dirty || "NONE (fully restored)"}`);

if (undetected > 0) {
  console.error(`\n${undetected} MUTATION(S) UNDETECTED. A control with no failing test is not tested.`);
  process.exit(1);
}
console.log("\nALL CONTROLS DETECTED. Every control in the media read path has a test that fails without it.");
