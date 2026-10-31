#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * MUTATION HARNESS FOR THE SCHEMA-DEPENDENCY GUARD
 *
 * A guard is only worth what its failures are worth. Every case below either
 * plants a defect and demands a FAIL, or plants a shape that must NOT trip it
 * and demands a PASS. Cases marked REGRESSION each correspond to a real defect
 * this guard shipped with and no longer has.
 *
 *   node scripts/test-schema-dependencies.mjs
 *
 * Exit 0 only when every case passes.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const GUARD = join(dirname(fileURLToPath(import.meta.url)), "verify-schema-dependencies.mjs");

function run(files, catalog, env = {}) {
  const root = mkdtempSync(join(tmpdir(), "schema-guard-"));
  const src = join(root, "src");
  mkdirSync(src, { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    const p = join(src, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  const catPath = join(root, "catalog.json");
  if (catalog) writeFileSync(catPath, JSON.stringify(catalog));
  let code = 0, out = "";
  try {
    out = execFileSync(process.execPath, [GUARD, src], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: process.env.PATH, ...(catalog ? { SCHEMA_GUARD_CATALOG_FILE: catPath } : {}), ...env },
    });
  } catch (e) {
    code = e.status ?? 1;
    out = `${e.stdout || ""}${e.stderr || ""}`;
  }
  rmSync(root, { recursive: true, force: true });
  return { code, out: out.replace(new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "<T>") };
}

const cat = (functions, ref = "TEST") => ({ ref, functions });
const results = [];
function check(id, title, cond, detail = "") {
  results.push({ id, title, ok: !!cond, detail });
}
function expect(id, title, r, { code, includes = [], excludes = [] }) {
  const problems = [];
  if (r.code !== code) problems.push(`exit ${r.code}, wanted ${code}`);
  for (const s of includes) if (!r.out.includes(s)) problems.push(`missing "${s}"`);
  for (const s of excludes) if (r.out.includes(s)) problems.push(`unwanted "${s}"`);
  check(id, title, problems.length === 0, problems.join("; "));
}

/* ── 1. normal RPC → PASS ────────────────────────────────────────────────── */
expect("H1", "normal RPC → PASS",
  run({ "a.ts": `export const f = async (id: string) => supabase.rpc("get_thing", { _id: id });\n` },
      cat({ get_thing: [{ args: ["_id"], required: 1 }] })),
  { code: 0, includes: ["SCHEMA-GUARD PASS", "argument-compatible checks: 1", "name-only checks: 0"] });

/* ── 2. multiline RPC → PASS ─────────────────────────────────────────────── */
expect("H2", "multiline RPC → PASS",
  run({ "a.ts": `
const r = await supabase.rpc(
  "search_people",
  {
    _query: q,
    _limit: 20,
    _offset: page * 20,
  },
);
` }, cat({ search_people: [{ args: ["_query", "_limit", "_offset"], required: 0 }] })),
  { code: 0, includes: ["SCHEMA-GUARD PASS", "argument-compatible checks: 1"] });

/* ── 3. cast-form RPC → PASS with arguments ──────────────────────────────── */
expect("H3", "cast-form RPC → PASS, arguments actually read",
  run({ "a.ts": `
const { data } = await (supabase.rpc as unknown as (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown[] | null; error: { message: string } | null }>)(
  "admin_search_users_v2",
  { _query: q, _by: by, _role: role, _badge: badge, _limit: 25, _offset: 0 },
);
` }, cat({ admin_search_users_v2: [{ args: ["_query", "_by", "_role", "_badge", "_limit", "_offset"], required: 0 }] })),
  { code: 0, includes: ["SCHEMA-GUARD PASS", "argument-compatible checks: 1", "name-only checks: 0"] });

// and the same shape must FAIL when a parameter name differs — proof the
// arguments were read, not merely the name.
expect("H3b", "cast-form RPC → FAIL on a renamed parameter",
  run({ "a.ts": `
const { data } = await (supabase.rpc as unknown as (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown[] | null }>)(
  "admin_search_users_v2",
  { _query: q, _by: by, _role: role, _badge: badge, _limit: 25, _offset: 0 },
);
` }, cat({ admin_search_users_v2: [{ args: ["query", "by", "role", "badge", "limit", "offset"], required: 0 }] })),
  { code: 1, includes: ["INCOMPATIBLE", "admin_search_users_v2", "resolves an RPC by argument NAME"] });

/* ── 4. missing RPC → FAIL ───────────────────────────────────────────────── */
expect("H4", "missing RPC → FAIL",
  run({ "a.ts": `supabase.rpc("not_deployed_yet", { _id: 1 });\n` },
      cat({ something_else: [{ args: [], required: 0 }] })),
  { code: 1, includes: ["MISSING", "not_deployed_yet", "a.ts:1"] });

/* ── 5. wrong argument names → FAIL ──────────────────────────────────────── */
expect("H5", "wrong argument names → FAIL",
  run({ "a.ts": `supabase.rpc("get_thing", { id: 1 });\n` },
      cat({ get_thing: [{ args: ["_id"], required: 1 }] })),
  { code: 1, includes: ["INCOMPATIBLE", "application sends: id", "target has       : _id"] });

/* ── 6. overload / signature mismatch → FAIL ─────────────────────────────── */
expect("H6", "overload mismatch → FAIL when no overload matches",
  run({ "a.ts": `supabase.rpc("feed", { _seed: 1, _mode: "x" });\n` },
      cat({ feed: [{ args: ["_seed"], required: 1 }, { args: ["_seed", "_limit"], required: 1 }] })),
  { code: 1, includes: ["INCOMPATIBLE", "feed"] });

expect("H6b", "overload match → PASS when one overload fits",
  run({ "a.ts": `supabase.rpc("feed", { _seed: 1, _limit: 5 });\n` },
      cat({ feed: [{ args: ["_seed"], required: 1 }, { args: ["_seed", "_limit"], required: 1 }] })),
  { code: 0, includes: ["SCHEMA-GUARD PASS"] });

expect("H6c", "required parameter omitted → FAIL",
  run({ "a.ts": `supabase.rpc("needs_both", { _a: 1 });\n` },
      cat({ needs_both: [{ args: ["_a", "_b"], required: 2 }] })),
  { code: 1, includes: ["INCOMPATIBLE", "required: _a, _b"] });

/* ── 7. multiple references → all reported ───────────────────────────────── */
expect("H7", "multiple references → every call site reported",
  run({
    "one.ts": `supabase.rpc("gone", { _a: 1 });\n`,
    "two.ts": `\n\nsupabase.rpc("gone", { _a: 2 });\n`,
    "deep/three.ts": `supabase.rpc("gone", { _a: 3 });\n`,
  }, cat({ other: [{ args: [], required: 0 }] })),
  { code: 1, includes: ["one.ts:1", "two.ts:3", "deep/three.ts:1"] });

/* ── 8. RPC inside comments → ignored ────────────────────────────────────── */
expect("H8", "RPC inside comments → ignored (the `rest` incident)",
  run({ "a.ts": `
/**
 * supabase-js internals, quoted for the reader:
 *     rpc(fn, args, options) { return this.rest.rpc(fn, args, options) }
 */
// supabase.rpc("ghost_function", { _x: 1 });
const url = "https://example.com/not-a-comment";
await supabase.rpc("real_one", { _x: 1 });
` }, cat({ real_one: [{ args: ["_x"], required: 0 }] })),
  { code: 0, includes: ["SCHEMA-GUARD PASS", "distinct RPC names: 1"], excludes: ["ghost_function", "rest"] });

/* ── 9. no-argument RPC does not steal a later object literal ────────────── */
expect("H9", "no-argument RPC → does not adopt a later object literal",
  run({ "a.ts": `
const { data } = await supabase.rpc("get_my_certificate_entries");
const mapped = (data || []).map((r) => ({
  entryId: r.entry_id,
  competitionTitle: r.competition_title,
  placement: r.placement,
}));
` }, cat({ get_my_certificate_entries: [{ args: [], required: 0 }] })),
  { code: 0, includes: ["SCHEMA-GUARD PASS"], excludes: ["INCOMPATIBLE", "entryId"] });

/* ── 10. test / spec references → excluded per documented scope ──────────── */
expect("H10", "test and spec files → excluded from scope",
  run({
    "a.ts": `supabase.rpc("real_one", { _x: 1 });\n`,
    "a.test.ts": `supabase.rpc("only_in_tests", { _y: 1 });\n`,
    "thing.spec.tsx": `supabase.rpc("also_only_in_tests", {});\n`,
    "__tests__/deep.ts": `supabase.rpc("third_test_only", {});\n`,
    "__mocks__/client.ts": `supabase.rpc("mock_only", {});\n`,
  }, cat({ real_one: [{ args: ["_x"], required: 0 }] })),
  { code: 0, includes: ["SCHEMA-GUARD PASS", "distinct RPC names: 1"],
    excludes: ["only_in_tests", "also_only_in_tests", "third_test_only", "mock_only"] });

/* ── 11. planted missing RPC → FAIL ──────────────────────────────────────── */
{
  const green = { "a.ts": `supabase.rpc("real_one", { _x: 1 });\n` };
  const c = cat({ real_one: [{ args: ["_x"], required: 0 }] });
  expect("H11a", "baseline before planting → PASS", run(green, c), { code: 0, includes: ["SCHEMA-GUARD PASS"] });
  expect("H11b", "planted missing RPC → FAIL with file:line",
    run({ ...green, "b.ts": `\nsupabase.rpc("planted_missing_fn", { _z: 1 });\n` }, c),
    { code: 1, includes: ["MISSING", "planted_missing_fn", "b.ts:2"] });
  expect("H11c", "plant removed → PASS again", run(green, c), { code: 0, includes: ["SCHEMA-GUARD PASS"] });
}

/* ── 12. planted wrong arguments → FAIL ──────────────────────────────────── */
expect("H12", "planted wrong argument name → FAIL",
  run({ "a.ts": `supabase.rpc("real_one", { _typo_x: 1 });\n` },
      cat({ real_one: [{ args: ["_x"], required: 0 }] })),
  { code: 1, includes: ["INCOMPATIBLE", "application sends: _typo_x"] });

/* ── 13. missing credentials → FAIL ──────────────────────────────────────── */
expect("H13", "no catalog and no credential → FAIL, and never prints a URL",
  run({ "a.ts": `supabase.rpc("real_one", { _x: 1 });\n` }, null),
  { code: 1, includes: ["SCHEMA-GUARD FAIL [S3]", "SUPABASE_DB_URL is not set"], excludes: ["postgres://", "postgresql://"] });

/* ── 14. empty source / parser finds nothing → FAIL ──────────────────────── */
expect("H14", "no RPC calls anywhere → FAIL (a check that cannot fail is not a check)",
  run({ "a.ts": `export const nothing = 1;\n` }, cat({ real_one: [{ args: [], required: 0 }] })),
  { code: 1, includes: ["SCHEMA-GUARD FAIL [S2]", "cannot fail is not a check"] });

expect("H14b", "empty catalog → FAIL (a failed query is not an empty database)",
  run({ "a.ts": `supabase.rpc("real_one", { _x: 1 });\n` }, cat({})),
  { code: 1, includes: ["SCHEMA-GUARD FAIL [S6]", "came back empty"] });

/* ── 15. unexpected name-only call → FAIL unless explicitly allow-listed ── */
{
  const files = { "a.ts": `const built = makeArgs();\nsupabase.rpc("real_one", built);\n` };
  const c = cat({ real_one: [{ args: ["_x"], required: 0 }] });
  expect("H15a", "unreadable argument object → FAIL, not a silent name-only pass",
    run(files, c),
    { code: 1, includes: ["UNREADABLE ARGUMENTS", "real_one", "a.ts:2", "name-only checks: 1",
                          "will not downgrade this to a name-only check"] });

  const root = mkdtempSync(join(tmpdir(), "schema-guard-allow-"));
  const allowFile = join(root, "exceptions.json");
  writeFileSync(allowFile, JSON.stringify({ "a.ts:2": "harness fixture: proves the mechanism" }));
  expect("H15b", "same site, explicit allow-list entry → PASS, still counted and listed",
    run(files, c, { SCHEMA_GUARD_ALLOW_NAME_ONLY: allowFile }),
    { code: 0, includes: ["SCHEMA-GUARD PASS", "name-only checks: 1", "ALLOW-LISTED"] });
  expect("H15c", "allow-list path that does not exist → FAIL",
    run(files, c, { SCHEMA_GUARD_ALLOW_NAME_ONLY: join(root, "nope.json") }),
    { code: 1, includes: ["SCHEMA-GUARD FAIL [S7]"] });
  rmSync(root, { recursive: true, force: true });
}

/* ── REGRESSIONS ─────────────────────────────────────────────────────────── */

/* R1 — the defect this revision exists to fix: a long call was silently
        degraded to a name-only check by a fixed 600-character window. */
{
  const filler = Array.from({ length: 30 }, (_, i) => `  _pad_${i}: values[${i}] ?? null,`).join("\n");
  expect("R1", "REGRESSION long call (>600 chars) → arguments still read, not name-only",
    run({ "a.ts": `
const { data, error } = await (supabase.rpc as unknown as (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown[] | null; error: { message: string } | null }>)(
  // A long explanatory comment sat here in the real file, pushing the argument
  // object past the old window. Comments are blanked but still occupy offsets,
  // which is exactly how the window ran out before reaching the object.
  "wide_fn",
  {
${filler}
  },
);
` }, cat({ wide_fn: [{ args: Array.from({ length: 30 }, (_, i) => `_pad_${i}`), required: 0 }] })),
    { code: 0, includes: ["SCHEMA-GUARD PASS", "argument-compatible checks: 1", "name-only checks: 0"] });

  expect("R1b", "REGRESSION same long call, one parameter renamed → FAIL",
    run({ "a.ts": `
const r = await (supabase.rpc as any)(
  "wide_fn",
  {
${filler}
  },
);
` }, cat({ wide_fn: [{ args: Array.from({ length: 30 }, (_, i) => (i === 29 ? "_renamed" : `_pad_${i}`)), required: 0 }] })),
    { code: 1, includes: ["INCOMPATIBLE", "wide_fn"] });
}

/* R2 — module-local forwarder: the call was not degraded, it was INVISIBLE. */
expect("R2", "REGRESSION module-local rpc forwarder → its call sites are seen",
  run({ "a.ts": `
type UntypedRpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown }>;
const rpc: UntypedRpc = (fn, args) => (supabase.rpc as unknown as UntypedRpc)(fn, args);

export async function publish(draftId: string) {
  const { data } = await rpc("publish_post_draft", { _draft_id: draftId });
  return data;
}
` }, cat({ publish_post_draft: [{ args: ["_draft_id"], required: 1 }] })),
  { code: 0, includes: ["SCHEMA-GUARD PASS", "distinct RPC names: 1", "argument-compatible checks: 1"] });

expect("R2b", "REGRESSION forwarder call with a wrong argument name → FAIL",
  run({ "a.ts": `
type UntypedRpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown }>;
const rpc: UntypedRpc = (fn, args) => (supabase.rpc as unknown as UntypedRpc)(fn, args);
const go = async () => rpc("publish_post_draft", { draft_id: "x" });
` }, cat({ publish_post_draft: [{ args: ["_draft_id"], required: 1 }] })),
  { code: 1, includes: ["INCOMPATIBLE", "publish_post_draft"] });

/* R3 — a trailing comma is formatting, not an unreadable second argument. */
expect("R3", "REGRESSION trailing comma → a one-argument call, not name-only",
  run({ "a.ts": `
const { data } = await supabase.rpc(
  "backfill_thing" as any,
);
` }, cat({ backfill_thing: [{ args: [], required: 0 }] })),
  { code: 0, includes: ["SCHEMA-GUARD PASS", "name-only checks: 0", "are calls that pass no"] });

/* R4 — an argument object built one line above, as a conditional. Both shapes
        must be checked; the union would hide the empty branch. */
expect("R4", "REGRESSION const ternary argument → both branches checked (PASS when both fit)",
  run({ "a.ts": `
const arg = competitionId ? { _competition_id: competitionId } : {};
const r = await supabase.rpc("get_placement_drift_admin" as any, arg);
` }, cat({ get_placement_drift_admin: [{ args: ["_competition_id"], required: 0 }] })),
  { code: 0, includes: ["SCHEMA-GUARD PASS", "name-only checks: 0"] });

expect("R4b", "REGRESSION const ternary argument → FAIL when the empty branch cannot call it",
  run({ "a.ts": `
const arg = competitionId ? { _competition_id: competitionId } : {};
const r = await supabase.rpc("get_placement_drift_admin" as any, arg);
` }, cat({ get_placement_drift_admin: [{ args: ["_competition_id"], required: 1 }] })),
  { code: 1, includes: ["INCOMPATIBLE", "application sends: (no arguments)"] });

/* R5 — a zero-argument call is a real argument-level check, not a name check. */
expect("R5", "REGRESSION zero-argument call against a required parameter → FAIL",
  run({ "a.ts": `const r = await supabase.rpc("needs_an_arg");\n` },
      cat({ needs_an_arg: [{ args: ["_id"], required: 1 }] })),
  { code: 1, includes: ["INCOMPATIBLE", "application sends: (no arguments)"] });

/* R6 — a name the guard cannot resolve is a name the guard cannot check. */
expect("R6", "REGRESSION dynamic RPC name → FAIL, never silently skipped",
  run({ "a.ts": `
const which = flag ? "a_fn" : "b_fn";
await supabase.rpc(which, { _x: 1 });
` }, cat({ a_fn: [{ args: ["_x"], required: 0 }], b_fn: [{ args: ["_x"], required: 0 }] })),
  { code: 1, includes: ["UNRESOLVED NAME", "a.ts:3"] });

/* R7 — `"name" as any` is still a name. */
expect("R7", "REGRESSION cast on the name argument → still read as the name",
  run({ "a.ts": `await supabase.rpc("mutual_friends_count" as any, { _user_a: a, _user_b: b });\n` },
      cat({ mutual_friends_count: [{ args: ["_user_a", "_user_b"], required: 2 }] })),
  { code: 0, includes: ["SCHEMA-GUARD PASS", "argument-compatible checks: 1"] });

/* R8 — array and nested-object VALUES are not computed keys. */
expect("R8", "REGRESSION array / nested object values → keys still read",
  run({ "a.ts": `
await supabase.rpc("create_system_post", {
  _content: content,
  _image_urls: [imageUrl, other],
  _meta: { nested: { deep: 1 } },
  _thumbnail_urls: null,
});
` }, cat({ create_system_post: [{ args: ["_content", "_image_urls", "_meta", "_thumbnail_urls"], required: 0 }] })),
  { code: 0, includes: ["SCHEMA-GUARD PASS", "name-only checks: 0"] });

/* R9 — a spread really is unreadable, and must fail rather than be guessed. */
expect("R9", "spread in the argument object → FAIL (unknown keys cannot be checked)",
  run({ "a.ts": `await supabase.rpc("real_one", { _x: 1, ...extra });\n` },
      cat({ real_one: [{ args: ["_x"], required: 0 }] })),
  { code: 1, includes: ["UNREADABLE ARGUMENTS"] });

/* R10 — out-of-band catalog integrity. */
{
  const tsvRoot = mkdtempSync(join(tmpdir(), "schema-guard-tsv-"));
  const tsv = join(tsvRoot, "catalog.tsv");
  const body = "real_one\t_x\t0\n";
  writeFileSync(tsv, body);
  const good = createHash("md5").update(Buffer.from(body)).digest("hex");
  const files = { "a.ts": `supabase.rpc("real_one", { _x: 1 });\n` };
  expect("R10a", "out-of-band catalog with the database's digest → PASS, marked authoritative",
    run(files, null, { SCHEMA_GUARD_CATALOG_TSV: tsv, SCHEMA_GUARD_CATALOG_MD5: good, SCHEMA_GUARD_CATALOG_REF: "reftest" }),
    { code: 0, includes: ["SCHEMA-GUARD PASS", "reftest", "verified against the digest"],
      excludes: ["NOT AUTHORITATIVE"] });
  expect("R10b", "out-of-band catalog with a wrong digest → FAIL",
    run(files, null, { SCHEMA_GUARD_CATALOG_TSV: tsv, SCHEMA_GUARD_CATALOG_MD5: "0".repeat(32), SCHEMA_GUARD_CATALOG_REF: "reftest" }),
    { code: 1, includes: ["SCHEMA-GUARD FAIL [S8]", "integrity check failed"] });
  expect("R10c", "out-of-band catalog with no digest → FAIL",
    run(files, null, { SCHEMA_GUARD_CATALOG_TSV: tsv, SCHEMA_GUARD_CATALOG_REF: "reftest" }),
    { code: 1, includes: ["SCHEMA-GUARD FAIL [S8]", "not evidence"] });
  rmSync(tsvRoot, { recursive: true, force: true });
}

/* R11 — the fake-catalog path must always announce itself. */
expect("R11", "fake catalog → announces itself as NOT AUTHORITATIVE",
  run({ "a.ts": `supabase.rpc("real_one", { _x: 1 });\n` }, cat({ real_one: [{ args: ["_x"], required: 0 }] })),
  { code: 0, includes: ["NOT AUTHORITATIVE", "must never appear in a"] });

/* R12 — coverage is printed on both outcomes, never only on success. */
expect("R12a", "coverage block printed on PASS",
  run({ "a.ts": `supabase.rpc("real_one", { _x: 1 });\n` }, cat({ real_one: [{ args: ["_x"], required: 0 }] })),
  { code: 0, includes: ["COVERAGE", "distinct RPC names:", "call sites:", "argument-compatible checks:", "name-only checks:"] });
expect("R12b", "coverage block printed on FAIL",
  run({ "a.ts": `supabase.rpc("gone", { _x: 1 });\n` }, cat({ real_one: [{ args: ["_x"], required: 0 }] })),
  { code: 1, includes: ["COVERAGE", "distinct RPC names:", "call sites:", "argument-compatible checks:", "name-only checks:"] });

/* ── SUMMARY ─────────────────────────────────────────────────────────────── */
const pass = results.filter((r) => r.ok).length;
const fail = results.length - pass;
console.log("");
console.log("SCHEMA-GUARD MUTATION HARNESS");
console.log("=".repeat(72));
for (const r of results) {
  console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.id.padEnd(5)} ${r.title}`);
  if (!r.ok) console.log(`        └─ ${r.detail}`);
}
console.log("=".repeat(72));
console.log(`  ${pass}/${results.length} cases passed, ${fail} failed.`);
console.log("");
process.exit(fail === 0 ? 0 : 1);
