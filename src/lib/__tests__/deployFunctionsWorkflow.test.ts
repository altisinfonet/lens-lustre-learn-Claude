// @vitest-environment node
/**
 * d1-deploy-functions.yml installs the Supabase CLI at `version: latest`.
 * Run 41490540929 (2026-11-02, staging, detect-orphan-files) refused with
 * "Confirmation required: Deploy 1 Function … This run can't ask because stdout
 * is not a terminal. Nothing was changed. Re-run with --yes to confirm." — a
 * newer CLI asks before deploying. The workflow already made its own
 * confirmation (functions + confirm inputs must be the same list), so the CLI
 * call must answer yes itself, or no function can be deployed at all.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const wf = fs.readFileSync(path.join(ROOT, ".github/workflows/d1-deploy-functions.yml"), "utf8");

describe("d1-deploy-functions.yml deploy call", () => {
  const calls = wf.split("\n").filter((l) => /^\s*supabase functions deploy\b/.test(l));

  it("has exactly one deploy call, inside the named-functions loop", () => {
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('"$n"');
  });

  it("answers the CLI's own confirmation (--yes), since the workflow confirmed already", () => {
    expect(calls[0]).toMatch(/\s--yes(\s|$)/);
  });

  it("still names the lane's project explicitly", () => {
    expect(calls[0]).toContain('"$PROJECT_REF"');
  });
});
