/**
 * S11 drills D1 / D9 (RPO half) — the backup inventory workflow can only READ.
 *
 * `.github/workflows/d1-backup-inventory.yml` holds the Owner's
 * SUPABASE_ACCESS_TOKEN. A restore or a new project costs money and changes
 * a lane, so the workflow must never be able to do either: every call is a
 * plain GET to the Management API, it is manual-only, the lane is fixed by
 * the target and its branch, and no `${{ … }}` reaches a `run:` block
 * (inputs are bound once, in `env:`, as in apply-migration.yml).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const path = join(process.cwd(), ".github/workflows/d1-backup-inventory.yml");
const text = readFileSync(path, "utf8");

/** The bodies of every `run: |` block. */
function runBlocks(src: string): string[] {
  const lines = src.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)run:\s*\|\s*$/);
    if (!m) continue;
    const indent = m[1].length;
    const body: string[] = [];
    for (i = i + 1; i < lines.length; i++) {
      const l = lines[i];
      if (l.trim() !== "" && l.search(/\S/) <= indent) { i--; break; }
      body.push(l);
    }
    out.push(body.join("\n"));
  }
  return out;
}

describe("d1-backup-inventory.yml is read-only", () => {
  it("is manual-only (workflow_dispatch, no push / schedule / pull_request trigger)", () => {
    const on = text.slice(text.indexOf("\non:"), text.indexOf("\njobs:"));
    expect(on).toMatch(/workflow_dispatch:/);
    expect(on).not.toMatch(/^\s+(push|schedule|pull_request|pull_request_target|workflow_run):/m);
  });

  it("every curl is a GET to api.supabase.com (no -X/--request, no body, no other host)", () => {
    const blocks = runBlocks(text);
    expect(blocks.length).toBeGreaterThan(0);
    // one logical command per line: join backslash-continued lines
    const commands = blocks.join("\n").replace(/\\\n/g, " ").split("\n");
    const curls = commands.filter((l) => /(^|[\s$(|])curl\s/.test(l));
    expect(curls.length).toBeGreaterThan(0);
    for (const c of curls) {
      expect(c).not.toMatch(/(^|\s)(-X|--request)\s/);
      expect(c).not.toMatch(/(^|\s)(-d|--data|--data-raw|--data-binary|-F|--form|-T|--upload-file)\s/);
      expect(c).not.toMatch(/https?:\/\/(?!api\.supabase\.com\/v1\/projects\/\$PROJECT_REF)/);
    }
  });

  it("no ${{ … }} inside any run: block", () => {
    for (const b of runBlocks(text)) expect(b).not.toContain("${{");
  });

  it("the lane is fixed by target + branch (production from main, staging from staging)", () => {
    expect(text).toMatch(/production\)\s+WANT=main;\s+REF=jtdtehuqtinjxropkkcn/);
    expect(text).toMatch(/staging\)\s+WANT=staging;\s+REF=fpszggreishhuvdpkmdr/);
    expect(text).toMatch(/BRANCH_REF" != "\$WANT"/);
  });
});
