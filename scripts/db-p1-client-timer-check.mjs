// ═══════════════════════════════════════════════════════════════════════════
// D1 · P1 · THE CLIENT-TIMER CHECK (Phase 2, unit 2-D1-02)
//
// WHAT IT ASSERTS. docs/gates/P1-interface.md §5, frozen by the Auditor on
// 2026-09-27: "No client code writes profiles.last_active_at or
// profiles.last_platform. There is no client timer that touches profiles."
//
// The server half (supabase/migrations/20260920_0001_p1_session_end_and_backfill.sql)
// gives last-seen two new writers — record_session_end() on page hide and
// backfill_last_seen() every 30 minutes. Neither removes the old one. The old
// one is src/hooks/core/useLastActive.ts: a 5-minute setInterval that UPDATEs
// profiles for every signed-in tab. On production its two statement variants
// were 13,294 calls / 1,033,384 ms and 4,306 / 233,171 ms at the Owner's reading
// of 2026-09-26, and every one of those UPDATEs is a full-row decode for
// Realtime because profiles is REPLICA IDENTITY FULL. P1 is only done when that
// timer is gone, and D1 does not own src/, so D1 cannot remove it. What D1 can
// do is make its continued presence a red check. This is that check.
//
// It is READ-ONLY. It reads files under src/ and writes nothing. It connects to
// nothing and holds no secret.
//
// WHAT COUNTS AS A HIT — two rules, either one fails the check:
//
//   RULE A · a profiles write that names either column. For every
//     `.from("profiles")` (any quote style), the call chain up to the next `;`
//     or the next `.from(` is taken as one statement. If that statement calls
//     .update( / .upsert( / .insert( and, after that call, names last_active_at
//     or last_platform, it is a hit. Multi-line chains are the normal case
//     (useLastActive.ts spreads its chain over six lines), so this is a scan
//     over text, not a line grep.
//
//   RULE B · a timer in a file that writes profiles. A file that contains a
//     RULE A hit AND a setInterval( is reported as the 5-minute timer the gate
//     names, so the red output says which thing is still there.
//
// WHAT IT DOES NOT SEE — stated so nobody mistakes it for more than it is.
//   · A payload built in a variable (`const p = { last_active_at }` then
//     `.update(p)`) is not followed. The column must be named in the chain.
//   · A write through supabase.rpc(...) is not a client table write and is not
//     flagged — record_session_end() is exactly such a call, and is correct.
//   · Test files (__tests__/, *.test.*, *.spec.*) and the generated types file
//     are skipped: they describe the code, they do not run in a member's tab.
//   · user_devices.last_active_at (src/hooks/profile/useUserDevices.ts) is a
//     different table and is correctly NOT a hit. The self-test pins that.
//
// C-34. A check that could not fail is not evidence. scripts/db-p1-client-timer-check.test.mjs
// plants each shape this check must catch and each shape it must not, and runs
// on the same PRs. On the staging tip this unit was cut from (7ebdbf4) the
// check is RED on src/hooks/core/useLastActive.ts — recorded in
// docs/evidence/d1/phase2/p1-client-timer-check-red-20260926.txt.
//
// Usage:  node scripts/db-p1-client-timer-check.mjs [rootDir]
// Exit:   0 = no client write of either column; 1 = at least one hit; 2 = error.
// ═══════════════════════════════════════════════════════════════════════════
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const COLUMNS = /\b(last_active_at|last_platform)\b/;
const WRITE_CALL = /\.(update|upsert|insert)\s*\(/;
const FROM_PROFILES = /\.from\(\s*(["'`])profiles\1\s*\)/g;
const NEXT_FROM = /\.from\(/g;

const SKIP_DIR = new Set(["node_modules", "__tests__", "__mocks__"]);
const SKIP_FILE = /(\.test\.|\.spec\.)|(^|\/)integrations\/supabase\/types\.ts$/;
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

/** Every hit in one file's text. Exported for the self-test. */
export function scanText(text) {
  const hits = [];
  FROM_PROFILES.lastIndex = 0;
  let m;
  while ((m = FROM_PROFILES.exec(text)) !== null) {
    const start = m.index;
    const after = start + m[0].length;
    // The statement ends at the next `;` or the next `.from(`, whichever is
    // first — a chain never legitimately contains a second .from().
    let end = text.indexOf(";", after);
    if (end === -1) end = text.length;
    NEXT_FROM.lastIndex = after;
    const nf = NEXT_FROM.exec(text);
    if (nf && nf.index < end) end = nf.index;
    const stmt = text.slice(start, end);
    const w = WRITE_CALL.exec(stmt);
    if (!w) continue;
    const col = COLUMNS.exec(stmt.slice(w.index));
    if (!col) continue;
    const line = text.slice(0, start).split("\n").length;
    hits.push({ line, call: w[1], column: col[1] });
  }
  return { hits, hasTimer: /\bsetInterval\s*\(/.test(text) };
}

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (SOURCE.test(name)) out.push(p);
  }
  return out;
}

/** Scan a repository root. Returns { files, findings }. Exported for the self-test. */
export function scanRoot(root) {
  const srcDir = join(root, "src");
  const files = walk(srcDir, []).filter((p) => !SKIP_FILE.test(relative(root, p).split(sep).join("/")));
  const findings = [];
  for (const f of files) {
    const { hits, hasTimer } = scanText(readFileSync(f, "utf8"));
    for (const h of hits) findings.push({ file: relative(root, f).split(sep).join("/"), ...h, timer: hasTimer });
  }
  return { files: files.length, findings };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = process.argv[2] || process.cwd();
  let r;
  try {
    r = scanRoot(root);
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    process.exit(2);
  }
  console.log("D1 · P1 client-timer check — docs/gates/P1-interface.md §5");
  console.log(`scanned ${r.files} source file(s) under src/ (tests and generated types skipped)`);
  if (!r.findings.length) {
    console.log("PASS — no client code writes profiles.last_active_at or profiles.last_platform");
    process.exit(0);
  }
  for (const f of r.findings) {
    console.log(
      `FAIL  ${f.file}:${f.line}  .from("profiles").${f.call}(… ${f.column} …)` +
        (f.timer ? "  — and this file runs a setInterval: the client timer §5 removes" : ""),
    );
  }
  console.log(`FAIL — ${r.findings.length} client write(s) of last_active_at / last_platform remain.`);
  console.log("P1 is not done until D2's cut-over removes them (docs/gates/P1-interface.md §5).");
  process.exit(1);
}
