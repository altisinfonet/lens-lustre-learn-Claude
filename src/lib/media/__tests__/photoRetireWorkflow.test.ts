// @vitest-environment node
/**
 * U6 / U7 · photo-retire.yml — the only workflow that deletes photo files.
 * Its fences, read from the file (as backfillWorkflow.test.ts does for S3-e).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(__dirname, "../../../..");
const wf = fs.readFileSync(path.join(ROOT, ".github/workflows/photo-retire.yml"), "utf8").replace(/\r\n/g, "\n");
const runOf = (name: string) => {
  const at = wf.indexOf(`- name: ${name}`);
  const block = wf.slice(at).match(/\n {8}run: \|\n((?: {10}.*\n|\n)+)/);
  return block ? block[1].split("\n").map((l) => l.slice(10)).join("\n") : "";
};
const gate = (env: Record<string, string>) =>
  spawnSync("bash", ["-c", runOf("The branch must match the target")], {
    env: { PATH: process.env.PATH ?? "", GITHUB_ENV: "/dev/null", ...env }, encoding: "utf8",
  });

describe("photo-retire.yml fences", () => {
  it("runs on a daily schedule and by hand — nothing else", () => {
    const on = wf.slice(wf.indexOf("\non:\n") + 5, wf.indexOf("\nconcurrency:"));
    expect([...on.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1])).toEqual(["schedule", "workflow_dispatch"]);
    expect(on).toContain("- cron: '10 5 * * *'");
    expect(on).toMatch(/mode:[\s\S]*?default: dry-run/);
  });

  it("a scheduled run is production + run + comp_full only (never old post files)", () => {
    expect(wf).toContain("TARGET_LANE: ${{ inputs.target || 'production' }}");
    expect(wf).toContain("KIND: ${{ inputs.kind || 'comp_full' }}");
    const base = { TARGET_LANE: "production", BRANCH_REF: "refs/heads/main", MODE: "run", EVENT: "schedule" };
    expect(gate({ ...base, KIND: "comp_full" }).status).toBe(0);
    expect(gate({ ...base, KIND: "post_old" }).status).not.toBe(0);
    expect(gate({ ...base, KIND: "all" }).status).not.toBe(0);
  });

  it("the branch must match the lane; mode and kind come from a fixed list", () => {
    const d = { MODE: "dry-run", KIND: "post_old", EVENT: "workflow_dispatch" };
    expect(gate({ ...d, TARGET_LANE: "staging", BRANCH_REF: "refs/heads/staging" }).status).toBe(0);
    expect(gate({ ...d, TARGET_LANE: "production", BRANCH_REF: "refs/heads/staging" }).status).not.toBe(0);
    expect(gate({ ...d, TARGET_LANE: "staging", BRANCH_REF: "refs/tags/staging" }).status).not.toBe(0);
    expect(gate({ ...d, TARGET_LANE: "staging", BRANCH_REF: "refs/heads/staging", MODE: "yes" }).status).not.toBe(0);
    expect(gate({ ...d, TARGET_LANE: "staging", BRANCH_REF: "refs/heads/staging", KIND: "avatars" }).status).not.toBe(0);
  });

  it("no ${{ inside any run script; secrets bound only on the two steps that need them; dry-run maps to --dry-run", () => {
    const runs = [...wf.matchAll(/\n {8}run: \|\n((?: {10}.*\n|\n)+)/g)].map((m) => m[1]);
    expect(runs.length).toBe(4);
    expect(wf).toContain('run: rm -f "$RUNNER_TEMP/worker.jwt" "$RUNNER_TEMP/auth.json"');
    for (const r of runs) expect(r).not.toContain("${{");
    expect((wf.match(/secrets\.MEDIA_WORKER_PASSWORD/g) ?? []).length).toBe(2);
    expect(wf.slice(0, wf.indexOf("    steps:"))).not.toContain("${{ secrets.");
    expect(runOf("Run the deleter")).toContain('[ "$MODE" = "dry-run" ] && ARGS+=(--dry-run)');
    expect(runOf("Run the deleter")).toContain("node tools/media-derivatives/retire.mjs");
    expect(fs.existsSync(path.join(ROOT, "tools/media-derivatives/retire.mjs"))).toBe(true);
  });
});
