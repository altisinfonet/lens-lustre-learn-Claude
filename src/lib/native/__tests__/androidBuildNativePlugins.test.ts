// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const ROOT = path.resolve(__dirname, "../../../..");
const wf = fs.readFileSync(path.join(ROOT, ".github/workflows/android-build.yml"), "utf8");

/** The workflow's steps as { name, body } in file order (split on "      - name:"). */
function steps(): { name: string; body: string }[] {
  return wf.split(/\n {6}- name: /).slice(1).map((chunk) => {
    const nl = chunk.indexOf("\n");
    return { name: chunk.slice(0, nl).trim(), body: chunk.slice(nl + 1) };
  });
}
const idx = (pred: (s: { name: string; body: string }) => boolean) => steps().findIndex(pred);

/** The `run: |` block of a step, de-indented, ready for bash. */
function runBlock(body: string): string {
  const i = body.indexOf("run: |\n");
  const lines = body.slice(i + "run: |\n".length).split("\n");
  const out: string[] = [];
  for (const l of lines) {
    if (l.trim() === "") { out.push(""); continue; }
    if (!l.startsWith("          ")) break;
    out.push(l.slice(10));
  }
  return out.join("\n");
}

describe("S2 native exits — android-build.yml runs the plugin step and proves it shipped", () => {
  it("installs the app's own plugins after `cap add android` and before `cap sync android` (by step, not by text)", () => {
    const add = idx((s) => /^\s*run: npx cap add android\s*$/m.test(s.body));
    const install = idx((s) => /^\s*run: node scripts\/android-native-plugins\.mjs android\s*$/m.test(s.body));
    const sync = idx((s) => /^\s*run: npx cap sync android\s*$/m.test(s.body));
    expect(add).toBeGreaterThanOrEqual(0);
    expect(install).toBe(add + 1);
    expect(sync).toBeGreaterThan(install);
  });

  const dexStep = () => steps().find((s) => s.name.startsWith("Prove the ExitInfo plugin is inside the RELEASE bundle"));

  it("the dex check runs after bundleRelease, unconditionally and blocking", () => {
    const i = idx((s) => s.name.startsWith("Prove the ExitInfo plugin is inside the RELEASE bundle"));
    const build = idx((s) => /\.\/gradlew bundleRelease/.test(runBlock(s.body)));
    expect(build).toBeGreaterThanOrEqual(0);
    expect(i).toBeGreaterThan(build);
    const head = dexStep()!.body.slice(0, dexStep()!.body.indexOf("run: |"));
    expect(head).not.toMatch(/continue-on-error|^\s*if:/m);
  });

  function bundle(dexBytes: Buffer): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s2-aab-"));
    fs.mkdirSync(path.join(dir, "base/dex"), { recursive: true });
    fs.mkdirSync(path.join(dir, "android/app/build/outputs/bundle/release"), { recursive: true });
    fs.writeFileSync(path.join(dir, "base/dex/classes.dex"), dexBytes);
    fs.writeFileSync(path.join(dir, "base/dex/classes2.dex"), Buffer.alloc(1024, 7));
    const z = spawnSync("zip", ["-q", "-0", "-r", "android/app/build/outputs/bundle/release/app-release.aab", "base"], { cwd: dir });
    expect(z.status).toBe(0);
    return dir;
  }
  // Node starts children with SIGPIPE ignored, which would hide the CI failure mode; restore the default.
  const run = (cwd: string) =>
    spawnSync("env", ["--default-signal=PIPE", "bash", "-c", runBlock(dexStep()!.body)], { cwd, encoding: "utf8" });

  it("passes a real-sized bundle whose dex names the plugin EARLY (no SIGPIPE false failure)", () => {
    // Random bytes, like a real dex: they contain line breaks, so grep -q would stop early.
    const dex = Buffer.concat([Buffer.from("dex\n035\0Lcom/fiftymmretina/app/ExitInfoPlugin;"), randomBytes(4 * 1024 * 1024)]);
    const r = run(bundle(dex));
    expect(r.stdout + r.stderr).toContain("OK: ExitInfoPlugin is in base/dex/classes.dex");
    expect(r.status).toBe(0);
  });

  it("fails a bundle without the plugin", () => {
    const r = run(bundle(randomBytes(2 * 1024 * 1024)));
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain("ExitInfoPlugin is not in the release bundle");
  });
});
