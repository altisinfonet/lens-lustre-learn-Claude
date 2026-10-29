// @vitest-environment node
/**
 * S11 · android-build.yml edits the generated Android project with `sed`.
 * A `sed` that matches nothing exits 0, so a template that changed shape used
 * to build an app with the wrong SDK levels, the wrong toolchain or the wrong
 * version — silently. These tests run the workflow's own steps (extracted from
 * the file, not copied) against a fixture shaped like the Capacitor 8.5.0
 * template, and against shapes that must be refused.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(__dirname, "../../../..");
const wf = fs.readFileSync(path.join(ROOT, ".github/workflows/android-build.yml"), "utf8");

function steps(): { name: string; body: string }[] {
  return wf.split(/\n {6}- name: /).slice(1).map((chunk) => {
    const nl = chunk.indexOf("\n");
    return { name: chunk.slice(0, nl).trim(), body: chunk.slice(nl + 1) };
  });
}
function runBlock(name: string): string {
  const s = steps().find((x) => x.name.startsWith(name));
  if (!s) throw new Error(`no step ${name}`);
  const i = s.body.indexOf("run: |\n");
  const out: string[] = [];
  for (const l of s.body.slice(i + "run: |\n".length).split("\n")) {
    if (l.trim() === "") { out.push(""); continue; }
    if (!l.startsWith("          ")) break;
    out.push(l.slice(10));
  }
  return out.join("\n");
}

/** Files exactly as `npx cap add android` writes them with @capacitor/cli 8.5.0. */
const TEMPLATE: Record<string, string> = {
  "android/variables.gradle": "ext {\n    minSdkVersion = 24\n    compileSdkVersion = 36\n    targetSdkVersion = 36\n    androidxActivityVersion = '1.11.0'\n}\n",
  "android/build.gradle": "buildscript {\n    dependencies {\n        classpath 'com.android.tools.build:gradle:8.13.0'\n        classpath 'com.google.gms:google-services:4.4.4'\n    }\n}\n",
  "android/gradle/wrapper/gradle-wrapper.properties": "distributionBase=GRADLE_USER_HOME\ndistributionUrl=https\\://services.gradle.org/distributions/gradle-8.14.3-all.zip\nzipStorePath=wrapper/dists\n",
  "android/gradle.properties": "org.gradle.jvmargs=-Xmx1536m\n",
  "android/app/build.gradle": "android {\n    defaultConfig {\n        applicationId \"com.fiftymmretina.app\"\n        versionCode 1\n        versionName \"1.0\"\n    }\n}\n",
};

function project(edit: Record<string, (s: string) => string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s11-abg-"));
  for (const [f, body] of Object.entries(TEMPLATE)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), edit[f] ? edit[f](body) : body);
  }
  return dir;
}
const run = (script: string, cwd: string, env: Record<string, string> = {}) =>
  spawnSync("bash", ["-e", "-c", script], { cwd, env: { PATH: process.env.PATH ?? "", ...env }, encoding: "utf8" });
const read = (dir: string, f: string) => fs.readFileSync(path.join(dir, f), "utf8");

describe("S11 android-build guards — SDK and toolchain edits are proven, not assumed", () => {
  const sdk = () => runBlock("Configure Android SDK and AGP versions");

  it("today's template: passes, and the files say what the step promises", () => {
    const d = project();
    const r = run(sdk(), d);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(read(d, "android/variables.gradle")).toMatch(/^ {4}minSdkVersion = 24$/m);
    expect(read(d, "android/variables.gradle")).toMatch(/^ {4}compileSdkVersion = 36$/m);
    expect(read(d, "android/variables.gradle")).toMatch(/^ {4}targetSdkVersion = 36$/m);
    expect(read(d, "android/build.gradle")).toContain("com.android.tools.build:gradle:8.12.3'");
    expect(read(d, "android/gradle/wrapper/gradle-wrapper.properties")).toMatch(/gradle-8\.13-all\.zip$/m);
  });

  it("an older template (minSdk 23, compileSdk 35) is still lifted and passes", () => {
    const d = project({ "android/variables.gradle": (s) => s.replace("= 24", "= 23").replace("compileSdkVersion = 36", "compileSdkVersion = 35") });
    expect(run(sdk(), d).status).toBe(0);
    expect(read(d, "android/variables.gradle")).toMatch(/^ {4}minSdkVersion = 24$/m);
  });

  for (const [what, edit] of [
    ["a minSdk the edit does not know (26)", { "android/variables.gradle": (s: string) => s.replace("= 24", "= 26") }],
    ["a compileSdk the edit does not know (37)", { "android/variables.gradle": (s: string) => s.replace("compileSdkVersion = 36", "compileSdkVersion = 37") }],
    ["targetSdk moved out of variables.gradle", { "android/variables.gradle": (s: string) => s.replace(/ {4}targetSdkVersion = 36\n/, "") }],
    ["AGP written with double quotes", { "android/build.gradle": (s: string) => s.replace("'com.android.tools.build:gradle:8.13.0'", "\"com.android.tools.build:gradle:8.13.0\"") }],
    ["AGP moved to a version catalog", { "android/build.gradle": (s: string) => s.replace(/ {8}classpath 'com\.android\.tools\.build:gradle:8\.13\.0'\n/, "") }],
    ["a wrapper URL the edit does not match", { "android/gradle/wrapper/gradle-wrapper.properties": (s: string) => s.replace("gradle-8.14.3-all.zip", "gradle-8.14.3-all.zip?x=1") }],
  ] as const) {
    it(`refuses: ${what}`, () => {
      const r = run(sdk(), project(edit));
      expect(r.status, r.stdout).not.toBe(0);
      expect(r.stdout + r.stderr).toMatch(/::error::/);
    });
  }
});

describe("S11 android-build guards — the app version is exactly the derived one", () => {
  const ver = () => runBlock("Set app version").split("${{ github.run_number }}").join("150");

  it("today's template: versionCode 1150, one semantic versionName that is not the template's 1.0", () => {
    const d = project();
    const r = run(ver(), d);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const g = read(d, "android/app/build.gradle");
    expect(g.match(/^\s*versionCode .*$/gm)).toEqual(["        versionCode 1150"]);
    const names = g.match(/^\s*versionName "([^"]*)"$/gm) ?? [];
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/"\d+\.\d+\.\d+"$/);
  });

  it("refuses versionCode 10 (the unanchored edit made it 11500)", () => {
    const r = run(ver(), project({ "android/app/build.gradle": (s) => s.replace("versionCode 1\n", "versionCode 10\n") }));
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/::error::.*versionCode/);
  });

  it("refuses a template whose versionName is not \"1.0\" (the name would silently stay unbumped)", () => {
    const r = run(ver(), project({ "android/app/build.gradle": (s) => s.replace('versionName "1.0"', 'versionName "1.0.0"') }));
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/::error::.*versionName/);
  });
});

describe("S11 android-build guards — the synced app is THIS commit's web build", () => {
  const prove = () => runBlock("Prove the synced app is TODAY'S app");
  const SHA = "0123456789abcdef0123456789abcdef01234567";
  const MARKERS = "get_contributor_scores Top Contributor All categories Photojournalism Pinned comment caretPlaced";

  function synced(stamp: string | null): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "s11-pub-"));
    const pub = path.join(d, "android/app/src/main/assets/public");
    fs.mkdirSync(path.join(pub, "assets"), { recursive: true });
    fs.writeFileSync(path.join(pub, "assets/index-abc.js"), MARKERS);
    const meta = stamp === null ? "" : `<meta name="build-commit" content="${stamp}" />`;
    fs.writeFileSync(path.join(pub, "index.html"), `<!doctype html><html><head>${meta}</head><body></body></html>`);
    return d;
  }

  it("passes when the synced index.html names the commit being built", () => {
    const r = run(prove(), synced(SHA), { GITHUB_SHA: SHA });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
  it("refuses another commit's build", () => {
    const r = run(prove(), synced("fedcba9876543210fedcba9876543210fedcba98"), { GITHUB_SHA: SHA });
    expect(r.status).not.toBe(0);
    expect(r.stdout).toMatch(/::error::.*build-commit/);
  });
  it("refuses an unstamped or 'unknown' build", () => {
    expect(run(prove(), synced(null), { GITHUB_SHA: SHA }).status).not.toBe(0);
    expect(run(prove(), synced("unknown"), { GITHUB_SHA: SHA }).status).not.toBe(0);
  });
  it("refuses when GITHUB_SHA itself is missing (nothing to compare with)", () => {
    expect(run(prove(), synced(SHA), {}).status).not.toBe(0);
  });
});

describe("S11 android-build guards — one build file", () => {
  it("the stale root-level android-build.yml (never run by GitHub) is gone", () => {
    expect(fs.existsSync(path.join(ROOT, "android-build.yml"))).toBe(false);
  });
});
