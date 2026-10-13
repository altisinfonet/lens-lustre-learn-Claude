/**
 * 50mm Retina World · the video converter worker (CONVERTER-DESIGN.md v2).
 *
 *   node worker.mjs                     the service (deploy/converter.service)
 *   node worker.mjs --selftest          convert synthetic videos in the sandbox, print one JSON line, exit 0/1
 *   node worker.mjs --netcheck <url>    (deploy check) DNS + HTTPS egress work, the link-local metadata address does not
 *
 * Bundled to ONE file by `npm run converter:build` (converter/build.mjs).
 */
import { existsSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { connect } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { Api } from "./api";
import { readCredentialsFile, Session } from "./auth";
import { loadConfig, type Config } from "./config";
import { storageUrlRule } from "./download";
import { scrub } from "./failures";
import { DirectLauncher, SystemdLauncher, type Launcher } from "./launcher";
import { jsonLogger, type Log } from "./log";
import { selfTest } from "./selftest";
import { ClaimStateStore } from "./state";
import { sweepJobsRoot, workerLoop } from "./worker";

export const VERSION = "1.1.0";

function launcherFor(c: Config): Launcher {
  return c.launcher === "systemd"
    ? new SystemdLauncher({ jobsRoot: c.jobsRoot })
    : new DirectLauncher({ ffmpeg: c.ffmpeg, ffprobe: c.ffprobe });
}

/** Can a TCP connection to host:port be opened within `ms`? */
function canConnect(host: string, port: number, ms: number): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const s = connect({ host, port });
    const done = (r: { ok: boolean; error?: string }) => { s.destroy(); resolve(r); };
    s.setTimeout(ms, () => done({ ok: false, error: "timeout" }));
    s.once("connect", () => done({ ok: true }));
    s.once("error", (e: NodeJS.ErrnoException) => done({ ok: false, error: e.code ?? e.message }));
  });
}

/**
 * The deploy check for converter.service's IPAddressDeny=link-local: names
 * still resolve and HTTPS still goes out, while the cloud metadata address
 * (169.254.169.254 — OCI's and Azure's alike) cannot be reached.
 */
async function netcheck(url: string, log: Log): Promise<number> {
  const host = new URL(url).hostname;
  const dns = await lookup(host).then((a) => ({ ok: true, address: a.address }), (e: Error) => ({ ok: false, address: scrub(e.message) }));
  const egress = await fetch(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(15_000) })
    .then((r) => ({ ok: true, status: r.status }), (e: Error) => ({ ok: false, status: scrub(String((e as { cause?: unknown }).cause ?? e.message)) }));
  const metadata = await canConnect("169.254.169.254", 80, 3000);
  const ok = dns.ok && egress.ok && !metadata.ok;
  log("worker.netcheck", { ok, host, dns: dns.ok, egress_status: egress.status, metadata_reachable: metadata.ok, metadata_error: metadata.error ?? null });
  return ok ? 0 : 1;
}

async function main(argv: string[]): Promise<number> {
  const log = jsonLogger();
  if (argv[0] === "--netcheck") return netcheck(argv[1] ?? "https://example.com", log);
  const selftestOnly = argv.includes("--selftest");
  let c: Config;
  try {
    c = loadConfig(process.env, { requireNetwork: !selftestOnly });
  } catch (e) {
    log("worker.config_error", { error: scrub((e as Error).message) });
    return 2;
  }
  if (existsSync(c.noUpdatesMarker)) {
    // setup.sh found Ubuntu Pro esm-apps off (review of #420, M4).
    log("worker.warning", { level: "WARNING", warning: "ffmpeg receives no security updates: Ubuntu Pro esm-apps is not enabled (deploy/README.md)" });
  }
  const launcher = launcherFor(c);
  if (launcher instanceof SystemdLauncher && !selftestOnly) {
    const stray = await launcher.stopStrayRuns().catch((e) => { log("worker.stray_error", { error: scrub(String(e)) }); return [] as string[]; });
    if (stray.length) log("worker.stray_runs_stopped", { count: stray.length });
  }
  const runSelfTest = () => selfTest({ launcher, jobsRoot: c.jobsRoot, preset: c.preset, log });

  if (selftestOnly || c.startupSelfTest) {
    const r = await runSelfTest();
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
  const session = new Session({
    supabaseUrl: c.supabaseUrl, anonKey: c.anonKey, credentials: () => readCredentialsFile(c.credentialsFile),
    onRefreshRefused: (status, message) => log("auth.refresh_refused", {
      level: "WARNING", status, error: scrub(message),
      note: "the refresh token was refused (revoked, expired, or reused — possible theft); signing in with the password",
    }),
  });
  const api = new Api({ apiBase: c.apiBase, supabaseUrl: c.supabaseUrl, anonKey: c.anonKey, session });
  const state = new ClaimStateStore(c.stateFile);

  const stop = new AbortController();
  const onSignal = (sig: string) => { log("worker.stopping", { signal: sig }); stop.abort(new Error(sig)); };
  process.once("SIGTERM", () => onSignal("SIGTERM"));
  process.once("SIGINT", () => onSignal("SIGINT"));

  const swept = await sweepJobsRoot(c.jobsRoot, log);
  log("worker.start", { version: VERSION, launcher: c.launcher, preset: c.preset, api: c.apiBase, r2_host: c.r2Host, swept });
  await workerLoop({
    api, state, launcher, jobsRoot: c.jobsRoot, preset: c.preset, heartbeatMs: c.heartbeatMs,
    pollMs: c.pollMs, pollMaxMs: c.pollMaxMs, log,
    sleep: (ms) => delay(ms).then(() => undefined),
    allowUrl: storageUrlRule(c.r2Host, c.r2Bucket),
    selfTest: async () => { const r = await runSelfTest(); log("worker.selftest", { ...r }); return r; },
  }, stop.signal);
  log("worker.stopped", {});
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (e) => { process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), event: "worker.crash", error: scrub(String((e as Error)?.stack ?? e)) })}\n`); process.exitCode = 1; },
);
