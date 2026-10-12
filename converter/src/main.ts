/**
 * 50mm Retina World · the video converter worker (CONVERTER-DESIGN.md v2).
 *
 *   node worker.mjs              the service (deploy/converter.service)
 *   node worker.mjs --selftest   convert a synthetic video in the sandbox, print one JSON line, exit 0/1
 *
 * Bundled to ONE file by `npm run converter:build` (converter/build.mjs).
 */
import { setTimeout as delay } from "node:timers/promises";
import { Api } from "./api";
import { readCredentialsFile, Session } from "./auth";
import { loadConfig, type Config } from "./config";
import { scrub } from "./failures";
import { DirectLauncher, SystemdLauncher, type Launcher } from "./launcher";
import { jsonLogger } from "./log";
import { selfTest } from "./selftest";
import { ClaimStateStore } from "./state";
import { sweepJobsRoot, workerLoop } from "./worker";

export const VERSION = "1.0.0";

function launcherFor(c: Config): Launcher {
  return c.launcher === "systemd"
    ? new SystemdLauncher({ jobsRoot: c.jobsRoot })
    : new DirectLauncher({ ffmpeg: c.ffmpeg, ffprobe: c.ffprobe });
}

async function main(argv: string[]): Promise<number> {
  const log = jsonLogger();
  const selftestOnly = argv.includes("--selftest");
  let c: Config;
  try {
    c = loadConfig(process.env, { requireNetwork: !selftestOnly });
  } catch (e) {
    log("worker.config_error", { error: scrub((e as Error).message) });
    return 2;
  }
  const launcher = launcherFor(c);
  if (launcher instanceof SystemdLauncher && !selftestOnly) {
    const stray = await launcher.stopStrayRuns().catch((e) => { log("worker.stray_error", { error: scrub(String(e)) }); return [] as string[]; });
    if (stray.length) log("worker.stray_runs_stopped", { count: stray.length });
  }

  if (selftestOnly || c.startupSelfTest) {
    const r = await selfTest({ launcher, jobsRoot: c.jobsRoot, preset: c.preset, log });
    log("worker.selftest", { ...r });
    if (selftestOnly) return r.ok ? 0 : 1;
    if (!r.ok) return 1; // systemd restarts us after RestartSec; nothing is claimed by a broken VM
  }

  // The password is read when a sign-in needs it, never kept beside the session, never logged.
  try {
    await readCredentialsFile(c.credentialsFile);
  } catch (e) {
    log("worker.credentials_error", { error: scrub((e as Error).message) });
    return 3;
  }
  const session = new Session({ supabaseUrl: c.supabaseUrl, anonKey: c.anonKey, credentials: () => readCredentialsFile(c.credentialsFile) });
  const api = new Api({ apiBase: c.apiBase, supabaseUrl: c.supabaseUrl, anonKey: c.anonKey, session });
  const state = new ClaimStateStore(c.stateFile);

  const stop = new AbortController();
  const onSignal = (sig: string) => { log("worker.stopping", { signal: sig }); stop.abort(new Error(sig)); };
  process.once("SIGTERM", () => onSignal("SIGTERM"));
  process.once("SIGINT", () => onSignal("SIGINT"));

  const swept = await sweepJobsRoot(c.jobsRoot, log);
  log("worker.start", { version: VERSION, launcher: c.launcher, preset: c.preset, api: c.apiBase, swept });
  await workerLoop({
    api, state, launcher, jobsRoot: c.jobsRoot, preset: c.preset, heartbeatMs: c.heartbeatMs,
    pollMs: c.pollMs, pollMaxMs: c.pollMaxMs, log,
    sleep: (ms) => delay(ms).then(() => undefined),
  }, stop.signal);
  log("worker.stopped", {});
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (e) => { process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), event: "worker.crash", error: scrub(String((e as Error)?.stack ?? e)) })}\n`); process.exitCode = 1; },
);
