/**
 * Step 6 · how ffprobe/ffmpeg are run (CONVERTER-DESIGN.md v2 §6, [R1]).
 *
 * PRODUCTION (`systemd`): every run is the root-owned template unit
 * `converter-ff@<job>.service` (converter/deploy/converter-ff@.service): user
 * `ffjob`, no network, the secrets made inaccessible, write access to THAT
 * job's directory only, no capabilities, a system-call filter, memory / CPU /
 * task caps, a time cap. The worker cannot change any of that: it may only
 * START or STOP units named `converter-ff@<uuid>.service` (polkit rule
 * deploy/50-converter-ff.rules). What to run is handed over in the job
 * directory — `.run/tool` (ffmpeg | ffprobe), `.run/args` (NUL-separated),
 * `.run/timeout` (seconds) — and deploy/ffjob-run (root-owned, inside the
 * sandbox) runs it and leaves `.run/stdout`, `.run/stderr` (last 64 KiB) and
 * `.run/exit`.
 *
 * Why not `systemd-run --uid=ffjob -p …` from the worker: starting a
 * TRANSIENT unit is the polkit action manage-units with no unit name or
 * property the rule could check, so a worker allowed to do it could start a
 * unit as root with any properties — the stolen-VM case of §2 would become
 * root on the VM. With a template unit the properties live in a root-owned
 * file and the grant is limited to one unit-name pattern and two verbs. The
 * property list is the one §6 names (RuntimeMaxSec is the per-run `timeout`
 * inside ffjob-run, because RuntimeMaxSec has no effect on Type=oneshot).
 *
 * TESTS / DEV (`direct`): the binary is spawned directly, same arguments,
 * same result shape.
 */
import { spawn } from "node:child_process";
import { promises as fs, constants as fsc } from "node:fs";
import path from "node:path";

export type Tool = "ffmpeg" | "ffprobe";

export interface RunSpec {
  tool: Tool;
  args: string[];
  /** absolute; the run's working directory and its only writable place */
  jobDir: string;
  timeoutS: number;
  signal?: AbortSignal;
}

export interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** killed from outside: aborted, out of memory, the unit's own limits */
  killed: boolean;
}

export interface Launcher {
  run(spec: RunSpec): Promise<RunResult>;
}

export const STDOUT_MAX = 4 * 1024 * 1024;
export const STDERR_MAX = 64 * 1024;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Read a file the sandbox may have written: never through a symlink, only a
 * regular file, at most `max` bytes (a hostile FFmpeg must not be able to make
 * the worker read the secrets, or a huge file).
 */
export async function readJobFile(file: string, max: number): Promise<Uint8Array> {
  const h = await fs.open(file, fsc.O_RDONLY | (fsc.O_NOFOLLOW ?? 0));
  try {
    const st = await h.stat();
    if (!st.isFile()) throw new Error(`${path.basename(file)} is not a regular file`);
    if (st.size > max) throw new Error(`${path.basename(file)} is ${st.size} bytes, above ${max}`);
    const buf = Buffer.alloc(st.size);
    let off = 0;
    while (off < st.size) {
      const { bytesRead } = await h.read(buf, off, st.size - off, off);
      if (bytesRead === 0) break;
      off += bytesRead;
    }
    return new Uint8Array(buf.buffer, buf.byteOffset, off);
  } finally {
    await h.close();
  }
}

function tail(chunks: Buffer[], max: number): string {
  const all = Buffer.concat(chunks);
  return all.subarray(Math.max(0, all.length - max)).toString("utf8");
}

/** Spawn the binary directly (tests, dev, and machines without the deploy/ units). */
export class DirectLauncher implements Launcher {
  constructor(private readonly bins: Record<Tool, string>) {}

  run(spec: RunSpec): Promise<RunResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.bins[spec.tool], spec.args, { cwd: spec.jobDir, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      const out: Buffer[] = [], err: Buffer[] = [];
      let outBytes = 0, errBytes = 0, timedOut = false, killed = false;
      child.stdout.on("data", (d: Buffer) => { if (outBytes < STDOUT_MAX + 1) { out.push(d); outBytes += d.length; } });
      child.stderr.on("data", (d: Buffer) => {
        err.push(d); errBytes += d.length;
        if (errBytes > STDERR_MAX * 4) { const s = Buffer.concat(err); err.length = 0; err.push(s.subarray(s.length - STDERR_MAX)); errBytes = STDERR_MAX; }
      });
      const kill = () => { try { child.kill("SIGKILL"); } catch { /* gone */ } };
      const timer = setTimeout(() => { timedOut = true; kill(); }, Math.max(1, spec.timeoutS) * 1000);
      const onAbort = () => { killed = true; kill(); };
      spec.signal?.addEventListener("abort", onAbort, { once: true });
      if (spec.signal?.aborted) onAbort();
      child.on("error", (e) => { clearTimeout(timer); spec.signal?.removeEventListener("abort", onAbort); reject(e); });
      child.on("close", (code) => {
        clearTimeout(timer);
        spec.signal?.removeEventListener("abort", onAbort);
        if (outBytes > STDOUT_MAX) { resolve({ exitCode: code, stdout: "", stderr: `stdout above ${STDOUT_MAX} bytes`, timedOut, killed: true }); return; }
        resolve({ exitCode: timedOut || killed ? null : code, stdout: Buffer.concat(out).toString("utf8"), stderr: tail(err, STDERR_MAX), timedOut, killed });
      });
    });
  }
}

/** What runs a command for the systemd launcher (injectable for tests). */
export type Exec = (cmd: string, args: string[], signal?: AbortSignal) => Promise<{ code: number | null; stderr: string; stdout?: string }>;

export const execFileSimple: Exec = (cmd, args, signal) => new Promise((resolve, reject) => {
  const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], signal });
  const out: Buffer[] = [], err: Buffer[] = [];
  child.stdout.on("data", (d: Buffer) => { if (out.length < 256) out.push(d); });
  child.stderr.on("data", (d: Buffer) => { if (err.length < 64) err.push(d); });
  child.on("error", (e) => { if ((e as { name?: string }).name === "AbortError") resolve({ code: null, stderr: "aborted" }); else reject(e); });
  child.on("close", (code) => resolve({ code, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8").slice(0, 2000) }));
});

/** Production: the sandboxed template unit, one run at a time per job. */
export class SystemdLauncher implements Launcher {
  constructor(
    private readonly opts: { jobsRoot: string; unitPrefix?: string; systemctl?: string },
    private readonly exec: Exec = execFileSimple,
  ) {}

  /**
   * At start-up: stop sandbox runs a crashed worker left running (their job
   * directories are about to be swept). Listing needs no privilege; stopping
   * is what the polkit rule allows for exactly these names.
   */
  async stopStrayRuns(): Promise<string[]> {
    const systemctl = this.opts.systemctl ?? "/usr/bin/systemctl";
    const prefix = this.opts.unitPrefix ?? "converter-ff";
    const r = await this.exec(systemctl, ["list-units", "--plain", "--no-legend", "--no-pager", "--state=active,activating,deactivating", `${prefix}@*.service`]);
    const pattern = new RegExp(`^${prefix}@[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.service$`);
    const units = String(r.stdout ?? "").split("\n").map((l) => l.trim().split(/\s+/)[0]).filter((u) => pattern.test(u));
    for (const u of units) await this.exec(systemctl, ["--no-ask-password", "stop", u]);
    return units;
  }

  private unit(jobDir: string): string {
    const inst = path.basename(jobDir);
    if (!UUID_RE.test(inst) || path.resolve(path.dirname(jobDir)) !== path.resolve(this.opts.jobsRoot)) {
      throw new Error("the job directory must be <jobs root>/<uuid>");
    }
    return `${this.opts.unitPrefix ?? "converter-ff"}@${inst}.service`;
  }

  async run(spec: RunSpec): Promise<RunResult> {
    const unit = this.unit(spec.jobDir);
    const systemctl = this.opts.systemctl ?? "/usr/bin/systemctl";
    const runDir = path.join(spec.jobDir, ".run");
    await fs.rm(runDir, { recursive: true, force: true });
    // Group convjob and set-group-ID come from the job directory (inherited, see job.ts prepareJobDir).
    await fs.mkdir(runDir, { mode: 0o770 });
    for (const a of spec.args) if (a.includes("\0")) throw new Error("an argument contains NUL");
    await fs.writeFile(path.join(runDir, "tool"), spec.tool, { mode: 0o640 });
    await fs.writeFile(path.join(runDir, "args"), spec.args.map((a) => `${a}\0`).join(""), { mode: 0o640 });
    await fs.writeFile(path.join(runDir, "timeout"), String(Math.max(10, Math.min(21_600, Math.ceil(spec.timeoutS)))), { mode: 0o640 });

    let aborted = false;
    const stop = () => { aborted = true; void this.exec(systemctl, ["--no-ask-password", "stop", unit]).catch(() => undefined); };
    spec.signal?.addEventListener("abort", stop, { once: true });
    // A margin over ffjob-run's own `timeout`, in case the unit itself hangs.
    const guard = setTimeout(stop, (Math.ceil(spec.timeoutS) + 120) * 1000);
    let started: { code: number | null; stderr: string };
    try {
      if (spec.signal?.aborted) stop();
      // Type=oneshot: `start` returns when the run has finished.
      started = aborted ? { code: null, stderr: "aborted" } : await this.exec(systemctl, ["--no-ask-password", "start", unit]);
    } finally {
      clearTimeout(guard);
      spec.signal?.removeEventListener("abort", stop);
    }

    const read = async (name: string, max: number) => {
      try { return Buffer.from(await readJobFile(path.join(runDir, name), max)).toString("utf8"); } catch { return null; }
    };
    const exitText = await read("exit", 16);
    const stdout = (await read("stdout", STDOUT_MAX)) ?? "";
    const stderr = (await read("stderr", STDERR_MAX * 2)) ?? (started.code !== 0 ? `systemctl: ${started.stderr}` : "");
    const exit = exitText !== null && /^\d{1,3}\s*$/.test(exitText) ? Number(exitText.trim()) : null;
    // timeout(1): 124 = timed out (TERM), 137 = timed out and KILLed.
    const timedOut = exit === 124 || exit === 137;
    // No exit file: the unit was stopped or killed (memory cap, TimeoutStartSec, abort).
    const killed = aborted || exit === null;
    return { exitCode: timedOut || killed ? null : exit, stdout, stderr, timedOut, killed };
  }
}
