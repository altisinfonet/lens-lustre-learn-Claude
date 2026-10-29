// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(__dirname, "../../../..");
const wf = fs.readFileSync(path.join(ROOT, ".github/workflows/s3-media-backfill.yml"), "utf8");

interface Step { name: string; text: string; env: string; run: string }

/** Steps of the one job, in order: name, raw text, its own env block, its run script (block or one line). */
function steps(): Step[] {
  const jobSteps = wf.slice(wf.indexOf("\n    steps:\n"));
  return jobSteps.split(/\n {6}- /).slice(1).map((t) => {
    const name = (t.match(/^name: (.*)$/m) || t.match(/^(uses: .*)$/m) || ["", ""])[1].trim();
    const envM = t.match(/\n {8}env:\n((?: {10}.*\n)+)/);
    let run = "";
    const block = t.match(/\n {8}run: \|\n((?: {10}.*\n|\n)+)/);
    if (block) run = block[1].split("\n").map((l) => l.slice(10)).join("\n");
    else run = (t.match(/\n {8}run: (.*)/) || ["", ""])[1];
    return { name, text: t, env: envM ? envM[1] : "", run };
  });
}
const step = (prefix: string) => {
  const s = steps().find((x) => x.name.startsWith(prefix));
  if (!s) throw new Error(`no step ${prefix}`);
  return s;
};
const bash = (script: string, env: Record<string, string>) =>
  spawnSync("bash", ["-c", script], { env: { PATH: process.env.PATH ?? "", ...env }, encoding: "utf8" });

describe("S3-e backfill workflow — fences", () => {
  it("workflow_dispatch is the ONLY trigger", () => {
    const on = wf.slice(wf.indexOf("\non:\n") + 5, wf.indexOf("\nconcurrency:"));
    const keys = [...on.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]);
    expect(keys).toEqual(["workflow_dispatch"]);
  });

  it("the environment is the target; the ref is the full branch ref (a tag named main does not pass)", () => {
    expect(wf).toMatch(/\n {4}environment: \$\{\{ inputs\.target \}\}\n/);
    expect(wf).toMatch(/\n {6}BRANCH_REF: \$\{\{ github\.ref \}\}\n/);
    const lane = step("The branch must match the target").run;
    const ok = (t: string, r: string) => bash(lane, { TARGET_LANE: t, BRANCH_REF: r, MODE: "dry-run", MAX_IN: "0", GITHUB_ENV: path.join(os.tmpdir(), `s3e-env-${t}`) }).status;
    expect(ok("staging", "refs/heads/staging")).toBe(0);
    expect(ok("production", "refs/heads/main")).toBe(0);
    expect(ok("staging", "refs/heads/main")).toBe(1);
    expect(ok("production", "refs/heads/staging")).toBe(1);
    expect(ok("production", "refs/tags/main")).toBe(1);
    expect(ok("production", "main")).toBe(1);
    expect(bash(lane, { TARGET_LANE: "staging", BRANCH_REF: "refs/heads/staging", MODE: "write", MAX_IN: "0", GITHUB_ENV: "/dev/null" }).status).toBe(1);
    const canary = path.join(os.tmpdir(), `s3e-canary-${process.pid}`);
    expect(bash(lane, { TARGET_LANE: "staging", BRANCH_REF: "refs/heads/staging", MODE: "run", MAX_IN: `5; touch ${canary}`, GITHUB_ENV: "/dev/null" }).status).toBe(1);
    expect(fs.existsSync(canary)).toBe(false);
  });

  it("each lane's anon key belongs to that lane's Supabase project, and the site is that lane's", () => {
    const lane = step("The branch must match the target").run;
    for (const [t, r, ref, site] of [
      ["staging", "refs/heads/staging", "fpszggreishhuvdpkmdr", "https://staging.50mmretina.com"],
      ["production", "refs/heads/main", "jtdtehuqtinjxropkkcn", "https://www.50mmretina.com"],
    ]) {
      const f = path.join(os.tmpdir(), `s3e-env-${t}-${process.pid}`);
      fs.writeFileSync(f, "");
      expect(bash(lane, { TARGET_LANE: t, BRANCH_REF: r, MODE: "run", MAX_IN: "0", GITHUB_ENV: f }).status).toBe(0);
      const env = Object.fromEntries(fs.readFileSync(f, "utf8").trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
      expect(env.SITE).toBe(site);
      expect(env.SB_URL).toBe(`https://${ref}.supabase.co`);
      const claims = JSON.parse(Buffer.from(env.SB_ANON.split(".")[1], "base64url").toString("utf8"));
      expect([claims.ref, claims.role]).toEqual([ref, "anon"]);
    }
  });

  it("no ${{ inside any run script", () => {
    const all = steps();
    expect(all.filter((s) => s.run).length).toBeGreaterThanOrEqual(6);
    for (const s of all) expect(s.run).not.toContain("${{");
  });

  it("the worker secrets are bound only on the two steps that need them, never job-wide", () => {
    const jobEnv = wf.slice(wf.indexOf("\n    env:\n"), wf.indexOf("\n    steps:\n"));
    expect(jobEnv).not.toContain("secrets.");
    const holders = steps().filter((s) => s.env.includes("secrets.")).map((s) => s.name);
    expect(holders).toEqual(["Refuse to start without the worker account", "Sign in as the worker account (token masked, 0600 file)"]);
    // Every expression that touches secrets names exactly one: no toJSON(secrets), no secrets[...].
    const exprs = [...wf.matchAll(/\$\{\{([^}]*)\}\}/g)].map((m) => m[1].trim()).filter((e) => /\bsecrets\b/.test(e));
    for (const e of exprs) expect(e).toMatch(/^secrets\.[A-Z_]+$/);
    expect(wf.match(/secrets\.[A-Z_]+/g)?.sort()).toEqual([
      "secrets.MEDIA_WORKER_EMAIL", "secrets.MEDIA_WORKER_EMAIL", "secrets.MEDIA_WORKER_PASSWORD", "secrets.MEDIA_WORKER_PASSWORD",
    ]);
  });

  it("refuses to start when either secret is missing", () => {
    const refuse = step("Refuse to start without the worker account").run;
    expect(bash(refuse, { TARGET_LANE: "staging", WORKER_EMAIL: "", WORKER_PASSWORD: "x" }).status).toBe(1);
    expect(bash(refuse, { TARGET_LANE: "staging", WORKER_EMAIL: "x", WORKER_PASSWORD: "" }).status).toBe(1);
    expect(bash(refuse, { TARGET_LANE: "staging", WORKER_EMAIL: "x", WORKER_PASSWORD: "y" }).status).toBe(0);
  });

  it("the password never reaches a command line; the token is masked first, kept 0600 and removed", () => {
    const signIn = step("Sign in as the worker account").run;
    expect(signIn).not.toMatch(/\$WORKER_PASSWORD|\$\{WORKER_PASSWORD\}/); // only jq's env.WORKER_PASSWORD reads it
    expect(signIn).toContain("env.WORKER_PASSWORD");
    expect(signIn).toContain("--data-binary @-");
    expect(signIn).toContain("umask 077");
    expect(signIn.indexOf("::add-mask::$TOKEN")).toBeGreaterThan(0);
    expect(signIn.indexOf("::add-mask::$TOKEN")).toBeLessThan(signIn.indexOf("worker.jwt"));
    const printing = signIn.split("\n").filter((l) => /\b(echo|printf)\s[^;]*\$TOKEN/.test(l)).map((l) => l.trim());
    expect(printing).toEqual(['echo "::add-mask::$TOKEN"', `printf '%s' "$TOKEN" > "$RUNNER_TEMP/worker.jwt"`]);
    for (const s of steps()) {
      expect(s.run).not.toMatch(/set -x|\b(cat|tee|head|tail)\b[^\n]*(worker\.jwt|auth\.json|MEDIA_WORKER_JWT_FILE)/);
    }
    const forget = step("Forget the token");
    expect(forget.text).toMatch(/\n {8}if: always\(\)\n/);
    expect(forget.run).toContain('"$RUNNER_TEMP/worker.jwt"');
    expect(forget.run).toContain('"$RUNNER_TEMP/auth.json"');
  });

  it("dry-run maps to --dry-run; the tool exists", () => {
    expect(step("Run the backfill tool").run).toContain('[ "$MODE" = "dry-run" ] && ARGS+=(--dry-run)');
    expect(fs.existsSync(path.join(ROOT, "tools/media-derivatives/run.mjs"))).toBe(true);
  });
});
