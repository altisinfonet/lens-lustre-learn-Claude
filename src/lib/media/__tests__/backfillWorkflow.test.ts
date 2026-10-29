// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../../..");
const FILE = path.join(ROOT, ".github/workflows/s3-media-backfill.yml");

describe("S3-e backfill workflow — fences", () => {
  const wf = fs.readFileSync(FILE, "utf8");
  const body = wf.split("\njobs:")[1] ?? "";
  const runs = [...body.matchAll(/run: \|\n((?: {10}.*\n|\n)+)/g)].map((m) => m[1]);

  it("is manual only: no push, pull_request or schedule trigger", () => {
    const on = wf.slice(wf.indexOf("\non:"), wf.indexOf("\nconcurrency:"));
    expect(on).toContain("workflow_dispatch:");
    expect(on).not.toMatch(/\b(push|pull_request|schedule):/);
  });

  it("production only from main, staging only from staging; the site and keys come from the choice", () => {
    expect(wf).toMatch(/production\) WANT=main;\s+SITE=https:\/\/www\.50mmretina\.com;\s+SB=https:\/\/jtdtehuqtinjxropkkcn\.supabase\.co/);
    expect(wf).toMatch(/staging\)\s+WANT=staging; SITE=https:\/\/staging\.50mmretina\.com; SB=https:\/\/fpszggreishhuvdpkmdr\.supabase\.co/);
    expect(wf).toMatch(/if \[ "\$BRANCH_REF" != "\$WANT" \]/);
  });

  it("no ${{ inside any run block; secrets reach the job only through env", () => {
    expect(runs.length).toBeGreaterThanOrEqual(4);
    for (const r of runs) expect(r).not.toContain("${{");
    expect(wf.match(/secrets\.[A-Z_]+/g)?.sort()).toEqual(["secrets.MEDIA_WORKER_EMAIL", "secrets.MEDIA_WORKER_PASSWORD"]);
  });

  it("the token is masked, kept in a 0600 file, removed at the end, and never echoed", () => {
    const signIn = runs.find((r) => r.includes("grant_type=password"))!;
    expect(signIn).toContain("umask 077");
    expect(signIn).toContain('echo "::add-mask::$TOKEN"');
    expect(signIn.indexOf("::add-mask::")).toBeLessThan(signIn.indexOf("worker.jwt"));
    const echoes = signIn.split("\n").filter((l) => /\b(echo|printf)\s[^;]*\$TOKEN/.test(l));
    expect(echoes.map((l) => l.trim())).toEqual(['echo "::add-mask::$TOKEN"', `printf '%s' "$TOKEN" > "$RUNNER_TEMP/worker.jwt"`]);
    expect(wf).toMatch(/if: always\(\)\n\s+run: rm -f "\$RUNNER_TEMP\/worker\.jwt"/);
  });

  it("dry-run maps to --dry-run; max must be a whole number", () => {
    expect(wf).toContain('[ "$MODE" = "dry-run" ] && ARGS+=(--dry-run)');
    expect(wf).toContain("''|*[!0-9]*) echo \"::error::max must be a whole number\"");
    expect(fs.existsSync(path.join(ROOT, "tools/media-derivatives/run.mjs"))).toBe(true);
  });
});
