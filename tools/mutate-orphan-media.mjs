#!/usr/bin/env node
/**
 * MUTATION HARNESS FOR THE MEDIA-AWARE ORPHAN REFERENCE SET (Item D).
 *
 * The reference set is a DELETION SAFETY LIST. Its failure mode is silence: a
 * key it stops seeing is a live file proposed for deletion, and nothing in a
 * green test run says so. "The tests pass" is therefore not evidence. The only
 * evidence is that the tests go RED when a control is removed.
 *
 * Each mutation below deletes or weakens exactly one property of the shipped
 * implementation and requires the suite to fail. A mutation that leaves the
 * suite green marks a control nobody is testing — decorated, not covered.
 *
 * MUTATION 1 IS THE WHOLE CYCLE IN ONE LINE: it reverts the scan to
 * `posts.image_urls`-only, which is the state production was in this morning.
 * If that does not go RED, this workstream achieved nothing measurable.
 *
 * Every mutation is applied to a copy, the file is restored from that copy
 * afterwards, and the run ends by re-asserting the working tree is clean.
 *
 * Usage: node tools/mutate-orphan-media.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const SHARED = "supabase/functions/_shared/referenceSet.ts";
const SCAN   = "supabase/functions/detect-orphan-files/index.ts";
const VERIFY = "supabase/functions/media-verify-upload/index.ts";

const SUITES = [
  "src/__tests__/orphanMediaReferenceSet.test.ts",
  "src/__tests__/orphanReferenceSet.test.ts",
  "src/lib/__tests__/imageLadder.test.ts",
].join(" ");

const originals = Object.fromEntries(
  [SHARED, SCAN, VERIFY].map((f) => [f, readFileSync(f, "utf8")]),
);

/** The suite must FAIL for every one of these. */
const mutations = [
  {
    file: SCAN,
    name: "1.  THE WHOLE CYCLE — media graph unwired, scan reverts to image_urls-only",
    apply: (s) => s.replace("      queries.push(addMediaReferences());\n", ""),
  },
  {
    file: SCAN,
    name: "2.  media_objects read pointed at the wrong table",
    apply: (s) => s.replace('.from("media_objects")', '.from("posts")'),
  },
  {
    file: SCAN,
    name: "3.  media keys computed but never added to referencedPaths",
    apply: (s) => s.replace(
      "for (const k of result.keys) referencedPaths.add(k);",
      "void result;",
    ),
  },
  {
    file: SCAN,
    name: "4.  a failed media_objects read swallowed instead of fatal",
    apply: (s) => s.replace(
      /if \(error\) \{\n            throw new Error\(\n              `reference scan failed on media_objects at offset \$\{from\}: `/,
      "if (error) {\n            break;\n          }\n          if (false) {\n            throw new Error(\n              `reference scan failed on media_objects at offset ${from}: `",
    ),
  },
  {
    file: SCAN,
    name: "5.  media read demoted to best-effort with a .catch",
    apply: (s) => s.replace(
      "queries.push(addMediaReferences());",
      "queries.push(addMediaReferences().catch(() => {}));",
    ),
  },
  {
    file: SCAN,
    name: "6.  sha256 smuggled into the media select",
    apply: (s) => s.replace(
      '.select("id,owner_id,mime,state,derivatives")',
      '.select("id,owner_id,mime,state,derivatives,sha256")',
    ),
  },
  {
    file: SCAN,
    name: "7.  post_media coverage turned into an orphan verdict",
    apply: (s) => s.replace(
      "for (const r of data as { media_id: string }[]) referencedMediaIds.add(r.media_id);",
      "for (const r of data as { media_id: string }[]) { referencedMediaIds.add(r.media_id); orphans.push(r as never); }",
    ),
  },
  {
    file: SCAN,
    name: "8.  the media graph dropped from the report",
    apply: (s) => s.replace(/      media_graph: \{[\s\S]*?\n      \},\n/, ""),
  },
  {
    file: SHARED,
    name: "9.  only `original` read — every derivative rung condemned",
    apply: (s) => s.replace(
      "for (const value of Object.values(derivatives)) {",
      "for (const value of [(derivatives as Record<string, unknown>)[\"original\"]]) {",
    ),
  },
  {
    file: SHARED,
    name: "10. only `ready` counted — in-flight and quarantined media condemned",
    apply: (s) => s.replace(
      "    const derivatives = row.derivatives ?? {};",
      "    if (row.state !== \"ready\") continue;\n    const derivatives = row.derivatives ?? {};",
    ),
  },
  {
    file: SHARED,
    name: "11. the in-flight derivation removed — uploads mid-flight condemned",
    apply: (s) => s.replace(
      /    if \(!sawOriginal && row\.owner_id\) \{\n      keys\.push\(originalKeyFor\(row\.owner_id, row\.id, row\.mime \?\? "image\/webp"\)\);\n      derived_in_flight\+\+;\n    \}/,
      "    void sawOriginal;",
    ),
  },
  {
    file: SHARED,
    name: "12. an unresolvable derivative value silently dropped",
    apply: (s) => s.replace(
      "        unresolved.push({ media_id: row.id, value });\n        keys.push(value);",
      "        unresolved.push({ media_id: row.id, value });",
    ),
  },
  {
    file: SHARED,
    name: "13. unresolvable values no longer reported",
    apply: (s) => s.replace(
      "        unresolved.push({ media_id: row.id, value });\n        keys.push(value);",
      "        keys.push(value);",
    ),
  },
  {
    file: SHARED,
    name: "14. extractPath loses the bare `<bucket>/<path>` branch",
    apply: (s) => s.replace(
      /  for \(const b of BUCKETS\) \{\n    if \(pathPart\.startsWith\(b \+ "\/"\)\) return pathPart;\n    if \(cleanUrl\.startsWith\(b \+ "\/"\)\) return cleanUrl;\n  \}/,
      "",
    ),
  },
  {
    file: SHARED,
    name: "15. the derived in-flight address drifts from the writer",
    apply: (s) => s.replace(
      "return `post-images/${ownerId}/media/${mediaId}/original.${EXT_BY_MIME[mime] ?? \"webp\"}`;",
      "return `post-images/${ownerId}/posts/${mediaId}/original.${EXT_BY_MIME[mime] ?? \"webp\"}`;",
    ),
  },
  {
    file: SCAN,
    name: "16. the LEGACY url-column read swallows its error (same swallow, older path)",
    apply: (s) => s.replace(
      "          if (error) {\n            throw new Error(\n              `reference scan failed on ${table}",
      "          if (error) {\n            break;\n          }\n          if (false) {\n            throw new Error(\n              `reference scan failed on ${table}",
    ),
  },
  {
    file: VERIFY,
    name: "17. the WRITER drifts instead — pair lock must catch it from either side",
    apply: (s) => s.replace(
      "return `post-images/${ownerId}/media/${mediaId}/original.${EXT_BY_MIME[mime] ?? \"webp\"}`;",
      "return `post-images/${ownerId}/uploads/${mediaId}/original.${EXT_BY_MIME[mime] ?? \"webp\"}`;",
    ),
  },
];

function suiteResult() {
  try {
    execSync(`npx vitest run ${SUITES} --reporter=dot`, { stdio: "pipe" });
    return "GREEN";
  } catch {
    return "RED";
  }
}

console.log(`baseline (no mutation): ${suiteResult()}\n`);

let undetected = 0;
for (const m of mutations) {
  const original = originals[m.file];
  const mutated = m.apply(original);
  if (mutated === original) {
    console.log(`✗ NOT APPLIED  ${m.name}  → the pattern no longer matches the file`);
    undetected++;
    continue;
  }
  writeFileSync(m.file, mutated);
  const res = suiteResult();
  writeFileSync(m.file, original);
  if (res === "RED") {
    console.log(`✓ DETECTED    ${m.name}`);
  } else {
    console.log(`✗ UNDETECTED  ${m.name}  → suite stayed GREEN`);
    undetected++;
  }
}

for (const [f, s] of Object.entries(originals)) writeFileSync(f, s);
const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim();
console.log(`\nworking tree vs pre-run snapshot:\n${dirty || "NONE (fully restored)"}`);

if (undetected > 0) {
  console.error(`\n${undetected} MUTATION(S) UNDETECTED. A control with no failing test is not tested.`);
  process.exit(1);
}
console.log("\nALL CONTROLS DETECTED. Every safety property of the media-aware reference set has a test that fails without it.");
