#!/usr/bin/env node
/**
 * OFF-2 · THE OUTBOX GUARD. Every offline-capable write goes through the
 * outbox, and the outbox writes only what D1's contract makes safe to repeat.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Two failures, each of which would let "exactly once" quietly stop being true:
 *
 *   1. OUTSIDE THE CONTRACT. `OUTBOX_TARGETS` in src/lib/offline/outbox.ts
 *      names a table that is not in scripts/db-off2-outbox-contract.json (D1's,
 *      read-only here), or names it with a different guard: a "key" table whose
 *      owner or on_conflict columns differ from D1's constraint, or a "natural"
 *      table whose columns differ. A resend to such a table is a duplicate.
 *
 *   2. AROUND THE OUTBOX. Any file under src/ (tests excepted) that INSERTs or
 *      UPSERTs into an outbox table directly — `.from("post_comments").insert(`
 *      — instead of through outboxSender.ts. Such a write carries no stored key:
 *      it is the pre-OFF-2 path that made three comments out of one lost answer.
 *      Tables scanned: every OUTBOX_TARGETS table, plus every contract "key"
 *      table with a full constraint (post_comments, reports). `posts` (partial
 *      index) is written only through create_post_with_media(_idempotency_key).
 *      Reads, updates and deletes are not outbox actions and are not flagged.
 *
 * No allowlist beyond the sender itself. C-34: `--self-test` drives every shape.
 * Fails first on staging b2aa236 (before this unit): useAddComment.ts and
 * useReportContent.ts insert directly, and OUTBOX_TARGETS does not exist.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   node scripts/web-off2-outbox-check.mjs [--root .]
 *   node scripts/web-off2-outbox-check.mjs --self-test
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const OUTBOX_FILE = "src/lib/offline/outbox.ts";
export const SENDER_FILE = "src/lib/offline/outboxSender.ts";
export const CONTRACT_FILE = "scripts/db-off2-outbox-contract.json";

const TARGET_RE = /(\w+):\s*\{\s*table:\s*"(\w+)",\s*kind:\s*"(key|natural)"(?:,\s*owner:\s*"(\w+)")?,\s*onConflict:\s*"([\w,]+)"\s*\}/g;

/** Parse OUTBOX_TARGETS out of outbox.ts source. null = not found. */
export function parseTargets(src) {
  const start = src.indexOf("export const OUTBOX_TARGETS");
  if (start < 0) return null;
  const end = src.indexOf("};", start);
  const body = src.slice(start, end < 0 ? undefined : end);
  const out = [];
  for (const m of body.matchAll(TARGET_RE)) out.push({ action: m[1], table: m[2], kind: m[3], owner: m[4] ?? null, onConflict: m[5] });
  return out;
}

export function checkContract(targets, contract) {
  const errs = [];
  if (!targets) return [`${OUTBOX_FILE}: no OUTBOX_TARGETS — the outbox's tables cannot be checked`];
  if (!targets.length) return [`${OUTBOX_FILE}: OUTBOX_TARGETS parsed to nothing — the format changed; fix the parser, do not skip`];
  const tables = contract?.tables ?? {};
  for (const t of targets) {
    const c = tables[t.table];
    if (!c) { errs.push(`OUTSIDE THE CONTRACT · ${t.action} → ${t.table}: not in ${CONTRACT_FILE}`); continue; }
    if (c.kind !== t.kind) { errs.push(`OUTSIDE THE CONTRACT · ${t.action} → ${t.table}: kind "${t.kind}", contract says "${c.kind}"`); continue; }
    if (t.kind === "key") {
      if (t.owner !== c.owner) errs.push(`OUTSIDE THE CONTRACT · ${t.action} → ${t.table}: owner "${t.owner}", contract says "${c.owner}"`);
      if (t.onConflict !== `${c.owner},idempotency_key`) errs.push(`OUTSIDE THE CONTRACT · ${t.action} → ${t.table}: on_conflict "${t.onConflict}", the constraint is (${c.owner}, idempotency_key)`);
    } else if (t.onConflict !== (c.columns ?? []).join(",")) {
      errs.push(`OUTSIDE THE CONTRACT · ${t.action} → ${t.table}: on_conflict "${t.onConflict}", the natural key is (${(c.columns ?? []).join(", ")})`);
    }
  }
  return errs;
}

/** Direct INSERT/UPSERT into an outbox table: `.from("t")` then `.insert(`/`.upsert(` before the statement ends. */
export function findBypasses(file, src, tables) {
  const hits = [];
  for (const t of tables) {
    const re = new RegExp(`\\.from\\(\\s*["'\`]${t}["'\`]\\s*\\)`, "g");
    for (const m of src.matchAll(re)) {
      const tail = src.slice(m.index + m[0].length, m.index + m[0].length + 400);
      const stmt = tail.split(/;|\n\s*\n/)[0];
      const w = stmt.match(/^\s*\.(insert|upsert)\s*\(/) || stmt.match(/\)\s*\.(insert|upsert)\s*\(/) || stmt.match(/^\s*\.\s*(insert|upsert)\s*\(/m);
      if (w) hits.push(`AROUND THE OUTBOX · ${file}:${src.slice(0, m.index).split("\n").length} · ${w[1]} into ${t} without the outbox (no stored idempotency key)`);
    }
  }
  return hits;
}

function walk(dir, out = []) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    const st = fs.statSync(p);
    if (st.isDirectory()) { if (n !== "__tests__" && n !== "node_modules") walk(p, out); }
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\.(ts|tsx)$/.test(n)) out.push(p);
  }
  return out;
}

export function run(root = ".") {
  const errs = [];
  let contract;
  try { contract = JSON.parse(fs.readFileSync(path.join(root, CONTRACT_FILE), "utf8")); }
  catch (e) { return [`cannot read ${CONTRACT_FILE}: ${e.message}`]; }
  let targets = null;
  try { targets = parseTargets(fs.readFileSync(path.join(root, OUTBOX_FILE), "utf8")); } catch { targets = null; }
  errs.push(...checkContract(targets, contract));
  const tables = [...new Set([...(targets ?? []).map((t) => t.table), ...Object.entries(contract.tables ?? {}).filter(([, c]) => c.kind === "key" && c.partial !== true).map(([t]) => t)])];
  const srcDir = path.join(root, "src");
  if (fs.existsSync(srcDir)) {
    for (const f of walk(srcDir)) {
      const rel = path.relative(root, f).split(path.sep).join("/");
      if (rel === SENDER_FILE) continue;
      errs.push(...findBypasses(rel, fs.readFileSync(f, "utf8"), tables));
    }
  }
  return errs;
}

export function selfTest() {
  const problems = [];
  const contract = { tables: {
    post_comments: { kind: "key", owner: "user_id" },
    reports: { kind: "key", owner: "reporter_id" },
    post_reactions: { kind: "natural", columns: ["post_id", "user_id"] },
  } };
  const good = `export const OUTBOX_TARGETS: X = {
  react: { table: "post_reactions", kind: "natural", onConflict: "post_id,user_id" },
  comment: { table: "post_comments", kind: "key", owner: "user_id", onConflict: "user_id,idempotency_key" },
};`;
  const cases = [
    ["clean targets", good, 0],
    ["no OUTBOX_TARGETS", "export const X = 1;", 1],
    ["table not in contract", good.replace(`"post_reactions", kind: "natural", onConflict: "post_id,user_id"`, `"image_comments", kind: "natural", onConflict: "image_id,user_id"`), 1],
    ["key table with wrong owner", good.replace(`owner: "user_id", onConflict: "user_id,idempotency_key"`, `owner: "author_id", onConflict: "author_id,idempotency_key"`), 2],
    ["key table with on_conflict missing the key", good.replace(`onConflict: "user_id,idempotency_key"`, `onConflict: "user_id"`), 1],
    ["natural table with wrong columns", good.replace(`onConflict: "post_id,user_id"`, `onConflict: "user_id,post_id"`), 1],
    ["kind disagrees", good.replace(`"post_comments", kind: "key"`, `"post_comments", kind: "natural"`), 1],
  ];
  for (const [name, src, want] of cases) {
    const got = checkContract(parseTargets(src), contract).length;
    if (got !== want) problems.push(`${name}: expected ${want} error(s), got ${got}`);
  }
  const bypass = [
    ["direct insert (pre-OFF-2 useAddComment)", `const { data } = await supabase\n  .from("post_comments")\n  .insert({ post_id })\n  .select("id")\n  .single();`, 1],
    ["one-line insert", `await supabase.from("reports").insert({ a: 1 });`, 1],
    ["upsert", `await db.from('post_comments').upsert(row, { onConflict: "x" });`, 1],
    ["select is fine", `await supabase.from("post_comments").select("id").eq("x", 1);`, 0],
    ["update is fine", `await supabase.from("post_comments").update({ is_pinned: true }).eq("id", id);`, 0],
    ["delete is fine", `await supabase.from("post_comments").delete().eq("id", id);`, 0],
    ["select then insert elsewhere is not this chain", `await supabase.from("reports").select("id");\nawait supabase.from("other").insert({});`, 0],
  ];
  for (const [name, src, want] of bypass) {
    const got = findBypasses("x.ts", src, ["post_comments", "reports", "post_reactions"]).length;
    if (got !== want) problems.push(`${name}: expected ${want} hit(s), got ${got}`);
  }
  return problems;
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  if (process.argv.includes("--self-test")) {
    const p = selfTest();
    p.forEach((x) => console.error("SELF-TEST FAIL · " + x));
    console.log(`self-test: ${p.length ? "FAIL" : "PASS"} (7 contract shapes + 7 write shapes)`);
    process.exit(p.length ? 1 : 0);
  }
  const i = process.argv.indexOf("--root");
  const errs = run(i > 0 ? process.argv[i + 1] : ".");
  for (const e of errs) console.error(`::error::OFF-2 outbox · ${e}`);
  console.log(`OFF-2 outbox guard: ${errs.length} problem(s) — ${errs.length ? "FAIL" : "PASS"}`);
  process.exit(errs.length ? 1 : 0);
}
