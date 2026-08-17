#!/usr/bin/env node
/**
 * MUTATION HARNESS FOR THE MEDIA MIGRATION.
 *
 * A green suite proves nothing on its own. The abandoned `backfill-media-objects`
 * had 18 passing tests and, when mutated in Cycle 5A, kept passing while the
 * failure path did the OPPOSITE of what its test's name claimed.
 *
 * So: remove each safety control in turn and require the suite to go red. A
 * control whose removal leaves the suite green is not tested — it is decorated.
 *
 * Every mutation is applied to a copy of the file, the file is restored from
 * that copy afterwards, and the run ends by re-asserting the working tree is
 * clean. Usage: `node tools/mutate-migrator.mjs`
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const PLAN = "supabase/functions/_shared/manifestPlan.ts";
const SQL = "supabase/migrations/20260817170000_media_migration_engine.sql";
const FN = "supabase/functions/migrate-post-media/index.ts";
const SUITE = "src/__tests__/manifestMigrator.test.ts";

/** Each mutation removes ONE control. `expect: "red"` means the suite must fail. */
const MUTATIONS = [
  {
    control: "1. manifest hash verification",
    file: PLAN,
    from: `  if (actualSha256 !== approvedSha256) {`,
    to: `  if (false) {`,
  },
  {
    control: "2. fence set-membership verification",
    file: PLAN,
    from: `  if (manifestKeySetDigest !== liveKeySetDigest) {`,
    to: `  if (false) {`,
  },
  {
    control: "3. per-post live/manifest slide comparison",
    file: PLAN,
    from: `    if (liveUrls[i] !== group[i].source_url) {`,
    to: `    if (false) {`,
  },
  {
    control: "4. owner-is-the-object-path-folder verification",
    file: PLAN,
    from: `    if (object_path.split("/")[1] !== owner_id) {`,
    to: `    if (false) {`,
  },
  {
    control: "5. SHA-256 verification of the bytes",
    file: PLAN,
    from: `  if (m.sha256 !== row.sha256) {`,
    to: `  if (false) {`,
  },
  {
    control: "6. duplicate (post_id, ord) protection",
    file: PLAN,
    from: `    if (seenKey.has(key)) {`,
    to: `    if (false) {`,
  },
  {
    control: "6b. duplicate content-within-one-post protection",
    file: PLAN,
    from: `    if (seenPostSha.has(ps)) {`,
    to: `    if (false) {`,
  },
  {
    control: "7. final reconciliation",
    file: PLAN,
    from: `  if (db.postMediaCount !== expectedRefs) {`,
    to: `  if (false) {`,
  },
  {
    control: "8. transactional post-write verification (SQL)",
    file: SQL,
    from: `    raise exception 'MIG-2010 verification read-back disagrees for post %', _post_id using errcode = '23514';`,
    to: `    null;`,
  },
  {
    control: "9. stuck-state repair (SQL) — the old migrator's permanent dead end",
    file: SQL,
    from: `  _repaired int := 0;`,
    to: `  _repaired_removed int := 0;`,
  },
  {
    control: "10. edge function writes only through the RPC",
    file: FN,
    from: `      const { data: out, error: rpcErr } =`,
    to: `      await admin.from("post_media").insert(items as never);\n      const { data: out, error: rpcErr } =`,
  },
  {
    control: "11. MIME/dimensions come from the bytes",
    file: FN,
    from: `    const d = imageDimsFromBytes(buf);`,
    to: `    const d = { width: row.width, height: row.height };`,
  },
];

const read = (f) => readFileSync(f, "utf8");
const originals = new Map();
for (const f of [PLAN, SQL, FN]) originals.set(f, read(f));

function suiteResult() {
  try {
    execSync(`npx vitest run ${SUITE} --reporter=basic`, { stdio: "pipe" });
    return "GREEN";
  } catch {
    return "RED";
  }
}

console.log("baseline (no mutation):", suiteResult(), "\n");
let failures = 0;

for (const m of MUTATIONS) {
  const src = originals.get(m.file);
  if (!src.includes(m.from)) {
    console.log(`⚠ SKIPPED  ${m.control} — anchor not found in ${m.file}`);
    failures++;
    continue;
  }
  writeFileSync(m.file, src.replace(m.from, m.to));
  const r = suiteResult();
  writeFileSync(m.file, src);
  const ok = r === "RED";
  if (!ok) failures++;
  console.log(`${ok ? "✓ DETECTED" : "✗ UNDETECTED"}  ${m.control}  → suite ${r}`);
}

// Restore is belt; this is braces.
for (const [f, s] of originals) writeFileSync(f, s);
// Only TRACKED files matter here: the new migrator files are untracked by
// design in this cycle, and listing them as "dirty" would hide a real leftover.
const dirty = execSync("git diff --name-only", { encoding: "utf8" }).trim();
console.log("\ntracked files modified after restore:", dirty === "" ? "NONE (clean)" : `LEFTOVER:\n${dirty}`);
console.log(failures === 0
  ? "\nALL CONTROLS DETECTED. Every safety control has a test that fails without it."
  : `\n${failures} CONTROL(S) NOT DETECTED — those tests are decoration, not proof.`);
process.exit(failures === 0 && dirty === "" ? 0 : 1);
