/**
 * S11 drills D1 / D9 (RPO half) — the backup inventory workflow can only READ.
 *
 * `.github/workflows/d1-backup-inventory.yml` holds the Owner's
 * SUPABASE_ACCESS_TOKEN. A restore or a new project costs money and changes
 * a lane, so the workflow must never be able to do either. This test is an
 * ALLOW-LIST, not a deny-list: no `uses:` steps at all, every `run:` line must
 * be one of a few known shapes, and the only network calls are two plain
 * `curl -sS -o … -w … -H "Authorization: Bearer …" "https://api.supabase.com/v1/projects/$PROJECT_REF[/database/backups]"`.
 * Also: manual-only trigger, `permissions: contents: read`, the lane fixed by
 * target + full branch ref, and no `${{ }}` inside any `run:` block.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const text = readFileSync(join(process.cwd(), ".github/workflows/d1-backup-inventory.yml"), "utf8");
const lines = text.split("\n");

/** Every run: block, in any YAML form (| |- > >- or a single line). */
function runBlocks(): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)(?:-\s+)?run:\s*(.*)$/);
    if (!m) continue;
    const indent = m[1].length;
    const rest = m[2].trim();
    if (rest && !/^[|>][-+]?$/.test(rest)) { out.push(rest); continue; }
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

/** Logical shell lines (backslash continuations joined), comments and blanks dropped. */
const shellLines = runBlocks()
  .join("\n")
  .replace(/\\\n/g, " ")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

const SAFE_CURL =
  /^code=\$\(curl -sS -o \/tmp\/[a-z]+\.json -w '%\{http_code\}' -H "Authorization: Bearer \$SUPABASE_ACCESS_TOKEN" "https:\/\/api\.supabase\.com\/v1\/projects\/\$PROJECT_REF(?:\/database\/backups)?"\)$/;

/** Shapes a line may have. Anything else fails the test and needs a reviewed edit here. */
const ALLOWED: RegExp[] = [
  SAFE_CURL,
  /^set -euo pipefail$/,
  /^case "\$TARGET_LANE" in$/, /^esac$/, /^fi$/, /^\{$/, /^\} \| tee -a "\$GITHUB_STEP_SUMMARY"$/,
  /^production\) WANT=refs\/heads\/main;\s+REF=jtdtehuqtinjxropkkcn ;;$/,
  /^staging\)\s+WANT=refs\/heads\/staging; REF=fpszggreishhuvdpkmdr ;;$/,
  /^\*\) echo "::error::[^"`$]*'\$TARGET_LANE'[^"`$]*"; exit 1 ;;$/,
  /^if \[ "\$BRANCH_REF" != "\$WANT" \]; then$/,
  /^if \[ -z "\$SUPABASE_ACCESS_TOKEN" \]; then$/,
  /^if \[ "\$code" != "200" \]; then$/,
  /^exit 1$/,
  /^echo "PROJECT_REF=\$REF" >> "\$GITHUB_ENV"$/,
  /^echo( "[^"`]*")?$/,                               // plain echo of fixed text / env names
  /^jq -r '[^']*' \/tmp\/proj\.json$/,
  /^jq -r '$/,                                        // start of the multi-line jq program …
  /^' \/tmp\/backups\.json$/,                          // … and its end
];

/** Lines inside the multi-line jq program (between `jq -r '` and `' /tmp/backups.json`). */
function withoutJqProgram(ls: string[]): string[] {
  const out: string[] = [];
  let inJq = false;
  for (const l of ls) {
    if (l === "jq -r '") { inJq = true; out.push(l); continue; }
    if (inJq && l === "' /tmp/backups.json") { inJq = false; out.push(l); continue; }
    if (inJq) {
      // jq is a pure filter over the saved file; it cannot open a socket. Keep it free of $( and backticks.
      expect(l).not.toMatch(/\$\(|`/);
      continue;
    }
    out.push(l);
  }
  return out;
}

describe("d1-backup-inventory.yml is read-only", () => {
  it("is manual-only (workflow_dispatch and nothing else)", () => {
    const on = text.slice(text.search(/^["']?on["']?:/m), text.search(/^concurrency:/m));
    expect(on).toMatch(/^\s+workflow_dispatch:/m);
    const triggers = on.split("\n").filter((l) => /^ {2}\S/.test(l)).map((l) => l.trim().replace(/:.*$/, ""));
    expect(triggers).toEqual(["workflow_dispatch"]);
    expect(text).not.toMatch(/^["']?on["']?:\s*\[/m);
  });

  it("has no uses: steps and only contents: read permission", () => {
    expect(text).not.toMatch(/^\s*-?\s*uses:/m);
    expect(text).toMatch(/^permissions:\n {2}contents: read\n/m);
  });

  it("every run: line is an allowed shape; the only network calls are the two GETs", () => {
    const ls = withoutJqProgram(shellLines);
    const unknown = ls.filter((l) => !ALLOWED.some((re) => re.test(l)));
    expect(unknown).toEqual([]);
    expect(ls.filter((l) => /curl/.test(l)).every((l) => SAFE_CURL.test(l))).toBe(true);
    expect(ls.filter((l) => SAFE_CURL.test(l))).toHaveLength(2);
  });

  it("nothing verbose that could print the token (set -x, -v, --trace)", () => {
    const all = runBlocks().join("\n");
    expect(all).not.toMatch(/set -[a-z]*x|(^|\s)(-v|--verbose|--trace\S*)(\s|$)/m);
  });

  it("no ${{ … }} inside any run: block", () => {
    for (const b of runBlocks()) expect(b).not.toContain("${{");
  });

  it("the lane is fixed by target + full branch ref", () => {
    expect(text).toMatch(/BRANCH_REF: \$\{\{ github\.ref \}\}/);
    expect(text).not.toMatch(/github\.ref_name/);
  });
});
