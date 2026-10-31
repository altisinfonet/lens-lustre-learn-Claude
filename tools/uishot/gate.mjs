#!/usr/bin/env node
/**
 * THE UI GATE, AS ONE COMMAND — `npm run ui:gate`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS RATHER THAN THREE LINES OF YAML. The sweep needs a dev server
 * running before it can look at anything, and `capture.mjs` deliberately does
 * NOT start one (a script that boots and kills a server hides the server's own
 * errors, which are usually the interesting ones — see its header).
 *
 * That left the two halves joined by hand, differently, in every place they
 * were run. A gate that is invoked one way locally and another way in CI is a
 * gate with two behaviours, and the one that matters is whichever nobody
 * checked. So the joining lives here, in the repository, and CI runs the SAME
 * command a person runs.
 *
 * WHAT IT DOES, IN ORDER, AND WHY EACH STEP FAILS LOUDLY:
 *   1. start the harness dev server
 *   2. wait for it to actually answer — a timeout is a FAILURE, never a skip,
 *      because "the server never came up" must not read as "nothing to report"
 *   3. run the sweep across every scene at every viewport
 *   4. stop the server, and exit with the SWEEP's code, not the server's
 *
 * ⚠ THE EXIT CODE IS THE WHOLE POINT. Anything that makes this exit 0 when the
 * sweep found something — a swallowed error, a `|| true`, a timeout treated as
 * success — turns the gate into decoration. `uiGateCannotBeBypassed.test.ts`
 * asserts the shape of this file for exactly that reason.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { spawn } from "node:child_process";

const BASE = process.env.UI_HARNESS_BASE ?? "http://127.0.0.1:5199";
const READY_URL = `${BASE}/uiharness.html`;
const READY_TIMEOUT_MS = 180_000;
const POLL_MS = 1000;

/** Forwarded to the sweep, so `npm run ui:gate -- calendar-dob` works. */
const passthrough = process.argv.slice(2);

const log = (m) => console.log(`[ui:gate] ${m}`);

let server = null;
function stopServer() {
  if (!server || server.killed) return;
  try { process.kill(-server.pid, "SIGTERM"); } catch { /* already gone */ }
  server = null;
}
// A crash or a Ctrl-C must not leave a port-5199 process behind for the next run.
process.on("exit", stopServer);
process.on("SIGINT", () => { stopServer(); process.exit(130); });
process.on("SIGTERM", () => { stopServer(); process.exit(143); });

async function waitForServer() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastErr = "no attempt made";
  while (Date.now() < deadline) {
    if (server && server.exitCode !== null) {
      throw new Error(`the dev server exited early with code ${server.exitCode}`);
    }
    try {
      const res = await fetch(READY_URL);
      if (res.ok) return;
      lastErr = `HTTP ${res.status}`;
    } catch (e) {
      lastErr = String(e.message ?? e).slice(0, 120);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  // A FAILURE, not a skip. See the header.
  throw new Error(`the harness never answered at ${READY_URL} within ${READY_TIMEOUT_MS}ms (last: ${lastErr})`);
}

function runSweep() {
  return new Promise((resolve) => {
    const sweep = spawn(
      process.execPath,
      ["tools/uishot/capture.mjs", ...passthrough],
      { stdio: "inherit", env: { ...process.env, UI_HARNESS_BASE: BASE } },
    );
    sweep.on("exit", (code) => resolve(code ?? 1));
    sweep.on("error", (e) => { console.error(`[ui:gate] could not run the sweep: ${e.message}`); resolve(1); });
  });
}

log(`starting the harness on ${BASE}`);
// `detached` so the whole process group can be signalled — Vite spawns children
// and killing only the parent leaves the port held.
server = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", "5199", "--strictPort"], {
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
// Kept, not discarded: if the sweep fails because the app would not compile,
// the reason is in here and nowhere else.
const serverLog = [];
const keep = (b) => { const s = b.toString(); serverLog.push(s); if (serverLog.length > 200) serverLog.shift(); };
server.stdout.on("data", keep);
server.stderr.on("data", keep);

let exitCode = 1;
try {
  await waitForServer();
  log("harness is up; sweeping every scene at every viewport");
  exitCode = await runSweep();
} catch (e) {
  console.error(`[ui:gate] FAILED: ${e.message}`);
  console.error("[ui:gate] --- dev server output ---");
  console.error(serverLog.join("").slice(-4000));
  exitCode = 1;
} finally {
  stopServer();
}

log(exitCode === 0 ? "PASS" : `FAIL (exit ${exitCode})`);
process.exit(exitCode);
