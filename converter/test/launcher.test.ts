// @vitest-environment node
/**
 * Step 6 · the launchers. `systemd` (production) hands the run to the
 * root-owned template unit through the job directory and only ever asks
 * systemctl to start/stop `converter-ff@<uuid>.service`; `direct` (tests,
 * dev) spawns the binary. Both answer the same shape.
 */
import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { DirectLauncher, readJobFile, SystemdLauncher, type Exec } from "../src/launcher";
import { tempDir } from "./helpers";

const JOB = "55555555-5555-4555-8555-555555555555";
const dirs: string[] = [];
afterEach(async () => { for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true }); });

async function jobDir(): Promise<{ root: string; dir: string }> {
  const root = await tempDir();
  dirs.push(root);
  const dir = path.join(root, JOB);
  await fs.mkdir(dir);
  return { root, dir };
}

describe("converter · SystemdLauncher (production)", () => {
  it("writes tool / NUL-separated args / timeout, starts ONLY converter-ff@<job>.service, reads exit/stdout/stderr", async () => {
    const { root, dir } = await jobDir();
    const calls: string[][] = [];
    let handed: { tool: string; args: string[]; timeout: string } | null = null;
    const exec: Exec = async (cmd, args) => {
      calls.push([cmd, ...args]);
      const run = path.join(dir, ".run");
      handed = {
        tool: await fs.readFile(path.join(run, "tool"), "utf8"),
        args: (await fs.readFile(path.join(run, "args"), "utf8")).split("\0").slice(0, -1),
        timeout: await fs.readFile(path.join(run, "timeout"), "utf8"),
      };
      // what deploy/ffjob-run leaves behind
      await fs.writeFile(path.join(run, "stdout"), '{"format":{}}');
      await fs.writeFile(path.join(run, "stderr"), "warn");
      await fs.writeFile(path.join(run, "exit"), "0\n");
      return { code: 0, stderr: "" };
    };
    const l = new SystemdLauncher({ jobsRoot: root }, exec);
    const r = await l.run({ tool: "ffprobe", args: ["-i", "source", "a b", "-x=\"q\""], jobDir: dir, timeoutS: 120 });
    expect(calls).toEqual([["/usr/bin/systemctl", "--no-ask-password", "start", `converter-ff@${JOB}.service`]]);
    expect(handed).toEqual({ tool: "ffprobe", args: ["-i", "source", "a b", "-x=\"q\""], timeout: "120" });
    expect(r).toEqual({ exitCode: 0, stdout: '{"format":{}}', stderr: "warn", timedOut: false, killed: false });
  });

  it("timeout(1)'s 124 → timedOut; no exit file (stopped, out of memory) → killed", async () => {
    const { root, dir } = await jobDir();
    const exitWith = (text: string | null): Exec => async () => {
      if (text !== null) await fs.writeFile(path.join(dir, ".run", "exit"), text);
      return { code: text === null ? 1 : 0, stderr: "Job failed" };
    };
    expect(await new SystemdLauncher({ jobsRoot: root }, exitWith("124")).run({ tool: "ffmpeg", args: [], jobDir: dir, timeoutS: 30 }))
      .toMatchObject({ exitCode: null, timedOut: true });
    expect(await new SystemdLauncher({ jobsRoot: root }, exitWith(null)).run({ tool: "ffmpeg", args: [], jobDir: dir, timeoutS: 30 }))
      .toMatchObject({ exitCode: null, killed: true });
    expect(await new SystemdLauncher({ jobsRoot: root }, exitWith("1")).run({ tool: "ffmpeg", args: [], jobDir: dir, timeoutS: 30 }))
      .toMatchObject({ exitCode: 1, killed: false, timedOut: false });
  });

  it("the time cap handed over is clamped to 10 s .. 6 h", async () => {
    const { root, dir } = await jobDir();
    const seen: string[] = [];
    const exec: Exec = async () => { seen.push(await fs.readFile(path.join(dir, ".run", "timeout"), "utf8")); return { code: 0, stderr: "" }; };
    const l = new SystemdLauncher({ jobsRoot: root }, exec);
    await l.run({ tool: "ffmpeg", args: [], jobDir: dir, timeoutS: 1 });
    await l.run({ tool: "ffmpeg", args: [], jobDir: dir, timeoutS: 99_999 });
    expect(seen).toEqual(["10", "21600"]);
  });

  it("an abort stops the unit", async () => {
    const { root, dir } = await jobDir();
    const calls: string[][] = [];
    const ac = new AbortController();
    const exec: Exec = async (_c, args) => {
      calls.push(args);
      if (args[1] === "start") { ac.abort(); await new Promise((r) => setTimeout(r, 20)); return { code: 1, stderr: "" }; }
      return { code: 0, stderr: "" };
    };
    const r = await new SystemdLauncher({ jobsRoot: root }, exec).run({ tool: "ffmpeg", args: [], jobDir: dir, timeoutS: 60, signal: ac.signal });
    expect(calls.map((c) => c[1])).toEqual(["start", "stop"]);
    expect(r.killed).toBe(true);
  });

  it("start-up: stops only converter-ff@<uuid>.service runs a crashed worker left behind", async () => {
    const { root } = await jobDir();
    const calls: string[][] = [];
    const exec: Exec = async (_c, args) => {
      calls.push(args);
      if (args[0] === "list-units") {
        return { code: 0, stderr: "", stdout: `converter-ff@${JOB}.service loaded active running Converter FFmpeg run\nconverter-ff@evil;rm.service loaded active running x\nssh.service loaded active running OpenSSH\n` };
      }
      return { code: 0, stderr: "" };
    };
    expect(await new SystemdLauncher({ jobsRoot: root }, exec).stopStrayRuns()).toEqual([`converter-ff@${JOB}.service`]);
    expect(calls.slice(1)).toEqual([["--no-ask-password", "stop", `converter-ff@${JOB}.service`]]);
  });

  it("refuses a job directory that is not <jobs root>/<uuid>, and NUL inside an argument", async () => {
    const { root, dir } = await jobDir();
    const l = new SystemdLauncher({ jobsRoot: root }, async () => ({ code: 0, stderr: "" }));
    await expect(l.run({ tool: "ffmpeg", args: [], jobDir: path.join(root, "not-a-uuid"), timeoutS: 30 })).rejects.toThrow(/uuid/);
    await expect(l.run({ tool: "ffmpeg", args: [], jobDir: path.join(path.dirname(root), JOB), timeoutS: 30 })).rejects.toThrow(/uuid/);
    await expect(l.run({ tool: "ffmpeg", args: ["a\0b"], jobDir: dir, timeoutS: 30 })).rejects.toThrow(/NUL/);
  });
});

describe("converter · readJobFile (what the sandbox wrote)", () => {
  it("reads a regular file, refuses one above the cap", async () => {
    const { dir } = await jobDir();
    await fs.writeFile(path.join(dir, "a"), "12345");
    expect(Buffer.from(await readJobFile(path.join(dir, "a"), 10)).toString()).toBe("12345");
    await expect(readJobFile(path.join(dir, "a"), 4)).rejects.toThrow(/above 4/);
  });

  it.skipIf(process.platform === "win32")("never follows a symlink (a hostile FFmpeg pointing 240p.mp4 at the secrets)", async () => {
    const { dir } = await jobDir();
    await fs.writeFile(path.join(dir, "secret"), "password");
    await fs.symlink(path.join(dir, "secret"), path.join(dir, "240p.mp4"));
    await expect(readJobFile(path.join(dir, "240p.mp4"), 1000)).rejects.toThrow();
  });
});

describe("converter · DirectLauncher (tests, dev)", () => {
  const node = process.execPath;
  it("runs the binary in the job directory and returns exit code, stdout and stderr", async () => {
    const { dir } = await jobDir();
    const l = new DirectLauncher({ ffmpeg: node, ffprobe: node });
    const r = await l.run({ tool: "ffprobe", args: ["-e", "process.stdout.write(process.cwd()); process.stderr.write('e'); process.exit(3)"], jobDir: dir, timeoutS: 30 });
    expect(r.exitCode).toBe(3);
    expect(path.resolve(r.stdout)).toBe(path.resolve(dir));
    expect(r.stderr).toBe("e");
  });

  it("kills a run that outlives its cap", async () => {
    const { dir } = await jobDir();
    const r = await new DirectLauncher({ ffmpeg: node, ffprobe: node }).run({ tool: "ffmpeg", args: ["-e", "setTimeout(() => {}, 60000)"], jobDir: dir, timeoutS: 1 });
    expect(r).toMatchObject({ exitCode: null, timedOut: true });
  });
});
