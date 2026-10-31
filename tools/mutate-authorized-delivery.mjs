#!/usr/bin/env node
/**
 * MUTATION HARNESS FOR D-003 — AUTHORIZED MEDIA DELIVERY.
 *
 * The gap D-003 records is not closed. The danger is not that someone forgets
 * it; it is that someone lands HALF of it — a restricted prefix on a bucket
 * that still serves everything publicly, or a signed URL in the client with no
 * server refusing the unsigned one. Both look like progress in a diff and
 * protect nothing. That is exactly the failure D-001 refused to ship.
 *
 * So every mutation below is a plausible half-move, and each must turn the
 * suite RED. A green suite here would mean the register can say one thing
 * while the product does another.
 *
 * Usage: node tools/mutate-authorized-delivery.mjs
 */
import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { execSync } from "node:child_process";

const REG    = "docs/DECISIONS.md";
const READER = "src/lib/media/postMediaRead.ts";
const RPC    = "supabase/migrations/20260819170132_post_media_read_rpc.sql";
const NOTICE = "src/components/post/PrivacyGapNotice.tsx";
const PIN    = "src/__tests__/authorizedMediaDelivery.test.ts";

const SUITE = `${PIN} src/__tests__/decisionRegister.test.ts`;

const FILES = [REG, READER, RPC, PIN];
const originals = Object.fromEntries(FILES.map((f) => [f, readFileSync(f, "utf8")]));
const noticeOriginal = readFileSync(NOTICE, "utf8");

const mutations = [
  {
    file: REG,
    name: "1. D-003 quietly marked CLOSED while the bytes are still public",
    apply: (s) => s.replace(
      "## D-003 — Authorized media delivery: the architecture is chosen, the dependency is not ours\n\n- **Status:** ACTIVE",
      "## D-003 — Authorized media delivery: the architecture is chosen, the dependency is not ours\n\n- **Status:** CLOSED",
    ),
  },
  {
    file: REG,
    name: "2. the blocking dependency deleted from the entry",
    apply: (s) => s.replace(/Cloudflare/g, "the delivery layer"),
  },
  {
    file: PIN,
    name: "3. the pin loses its @decision marker (register and test drift apart)",
    apply: (s) => s.replace(" * @decision D-003", " * decision D-003"),
  },
  {
    file: READER,
    name: "4. the resolver starts minting a signed URL",
    apply: (s) => s.replace(
      "  return `https://${MEDIA_CDN_HOST}/${path}`;",
      "  return `https://${MEDIA_CDN_HOST}/${path}?token=` + Date.now();",
    ),
  },
  {
    file: READER,
    name: "5. createSignedUrl appears in the client media path",
    apply: (s) => s.replace(
      "export function mediaUrlFor(",
      "export async function signIt(p: string) { return supabase.storage.from('x').createSignedUrl(p, 60); }\nexport function mediaUrlFor(",
    ),
  },
  {
    file: RPC,
    name: "6. the RPC starts returning something time-limited",
    apply: (s) => s.replace("  object_path text,", "  object_path text,\n  signed_expires timestamptz,"),
  },
  {
    file: RPC,
    name: "7. a table grant smuggled in as the 'easy' fix",
    apply: (s) => s.replace(
      "grant execute on function public.post_media_for(uuid[]) to anon, authenticated;",
      "grant execute on function public.post_media_for(uuid[]) to anon, authenticated;\ngrant select on public.media_objects to authenticated;",
    ),
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

// 8. the notice deleted while the gap is open — a file move, not an edit.
{
  const name = "8. PrivacyGapNotice deleted while the gap is still open";
  renameSync(NOTICE, NOTICE + ".mutated");
  const res = suiteResult();
  renameSync(NOTICE + ".mutated", NOTICE);
  if (res === "RED") console.log(`✓ DETECTED    ${name}`);
  else { console.log(`✗ UNDETECTED  ${name}  → suite stayed GREEN`); undetected++; }
}

for (const [f, s] of Object.entries(originals)) writeFileSync(f, s);
writeFileSync(NOTICE, noticeOriginal);
const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim();
console.log(`\nworking tree vs pre-run snapshot:\n${dirty || "NONE (fully restored)"}`);

if (undetected > 0) {
  console.error(`\n${undetected} MUTATION(S) UNDETECTED. A half-closed security gap would land silently.`);
  process.exit(1);
}
console.log("\nALL CONTROLS DETECTED. D-003 cannot be closed, half-closed, or forgotten without the suite going red.");
