// C-34 self-test for scripts/db-p1-client-timer-check.mjs.
// Each MUST-CATCH case plants a shape the check exists to fail on; each
// MUST-PASS case is a real neighbour in this codebase it must not fail on.
// Then the whole-root scan is run on a temporary tree containing the exact
// shape of src/hooks/core/useLastActive.ts as of staging 7ebdbf4, and on the
// same tree with the timer removed and record_session_end() called instead.
//
//   node scripts/db-p1-client-timer-check.test.mjs
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { scanText, scanRoot } from "./db-p1-client-timer-check.mjs";

let failed = 0;
const ok = (name, cond, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!cond) failed++;
};

// The shape on staging today — src/hooks/core/useLastActive.ts, verbatim in structure.
const TODAY = `
export function useLastActive() {
  useEffect(() => {
    const update = () => {
      supabase
        .from("profiles")
        .update({
          last_active_at: new Date().toISOString(),
          last_platform: isNativeCapacitorApp() ? "app" : "web",
        } as any)
        .eq("id", user.id)
        .then(() => {});
    };
    const interval = setInterval(update, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [user]);
}
export function formatLastSeen(lastActiveAt) { return ""; }
`;

// The shape the interface asks for — no table write, one RPC on hide.
const AFTER = `
export function useSessionEnd() {
  useEffect(() => {
    const onHide = () => { void supabase.rpc("record_session_end", { _platform: "web" }); };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);
}
export function formatLastSeen(lastActiveAt) { return ""; }
`;

console.log("MUST CATCH");
{
  const r = scanText(TODAY);
  ok("today's useLastActive.ts shape (multi-line chain, both columns)", r.hits.length === 1 && r.hasTimer,
     JSON.stringify(r));
}
ok("single-quoted table name", scanText(`supabase.from('profiles').update({ last_active_at: x }).eq('id', u);`).hits.length === 1);
ok("back-quoted table name", scanText("supabase.from(`profiles`).update({ last_active_at: x });").hits.length === 1);
ok("last_platform alone", scanText(`supabase.from("profiles").update({ last_platform: "web" }).eq("id", u);`).hits.length === 1);
ok("upsert", scanText(`supabase.from("profiles").upsert({ id: u, last_active_at: t });`).hits.length === 1);
ok("one line, no timer (a write is a write, timer or not)",
   (() => { const r = scanText(`await supabase.from("profiles").update({ last_active_at: t }).eq("id", u);`); return r.hits.length === 1 && !r.hasTimer; })());

console.log("MUST PASS");
ok("the interface's own shape: rpc('record_session_end')", scanText(AFTER).hits.length === 0);
ok("user_devices.last_active_at is a different table (useUserDevices.ts)",
   scanText(`supabase.from("user_devices").update({ last_active_at: new Date().toISOString() }).eq("id", d);`).hits.length === 0);
ok("reading the columns (AdminUsers.tsx select)",
   scanText(`supabase.from("profiles").select("id, last_active_at, last_platform" as any).in("id", ids),`).hits.length === 0);
ok("a profiles update that names neither column",
   scanText(`supabase.from("profiles").update({ bio: b }).eq("id", u);`).hits.length === 0);
ok("a profiles write followed by an unrelated .from() that names the column",
   scanText(`supabase.from("profiles").update({ bio: b }).eq("id", u)\n  .then(() => supabase.from("user_devices").update({ last_active_at: t }))`).hits.length === 0);

console.log("WHOLE-ROOT SCAN (the CLI, exit codes)");
const cli = fileURLToPath(new URL("./db-p1-client-timer-check.mjs", import.meta.url));
const tree = (body) => {
  const d = mkdtempSync(join(tmpdir(), "p1timer-"));
  mkdirSync(join(d, "src/hooks/core"), { recursive: true });
  mkdirSync(join(d, "src/components/__tests__"), { recursive: true });
  writeFileSync(join(d, "src/hooks/core/useLastActive.ts"), body);
  // A test file that asserts the old write must NOT make the check red.
  writeFileSync(join(d, "src/components/__tests__/AdminUsersActivity.test.ts"),
    `// supabase.from("profiles").update({ last_active_at: new Date().toISOString() })\n`);
  return d;
};
const run = (d) => { try { execFileSync("node", [cli, d], { stdio: "pipe" }); return 0; } catch (e) { return e.status; } };
{
  const d = tree(TODAY);
  const r = scanRoot(d);
  ok("today's tree: exit 1 (RED), one finding, timer named", run(d) === 1 && r.findings.length === 1 && r.findings[0].timer,
     JSON.stringify(r.findings));
  rmSync(d, { recursive: true, force: true });
}
{
  const d = tree(AFTER);
  ok("after D2's cut-over shape: exit 0 (GREEN)", run(d) === 0);
  rmSync(d, { recursive: true, force: true });
}

console.log(failed ? `\n${failed} CASE(S) FAILED` : "\nALL CASES PASS");
process.exit(failed ? 1 : 0);
