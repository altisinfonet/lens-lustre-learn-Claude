/**
 * A3 (Owner order 2026-11-07): every post address carries the member's name —
 * /<handle>/post/<id> — built by ONE rule, src/lib/posts/postPath.ts (Deno copy
 * supabase/functions/_shared/postPath.ts). This fails on any hand-built
 * `/post/${…}` anywhere else, and if the two copies of the rule drift.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { postPath, postPathOf } from "@/lib/posts/postPath";
import { postPath as denoPostPath } from "../../supabase/functions/_shared/postPath";
import { normaliseRoute } from "@/lib/telemetry";

const ROOT = join(__dirname, "../..");
const ID = "d530d466-f8f9-4c8d-9f18-1b7ab2d34c86";

describe("postPath — the one rule", () => {
  it.each<[string | null | undefined, string]>([
    ["neil.basu", `/neil.basu/post/${ID}`],
    ["anusmit_05", `/anusmit_05/post/${ID}`],
    [null, `/post/${ID}`],
    [undefined, `/post/${ID}`],
    ["", `/post/${ID}`],
    ["ab", `/post/${ID}`],                 // too short for a handle
    [".dot", `/post/${ID}`],               // leading dot
    ["a..b", `/post/${ID}`],               // double dot
    ["Upper.Case", `/post/${ID}`],         // handles are lower case
    ["../admin", `/post/${ID}`],           // never a path trick
    ["0b3c5d1e-aaaa-bbbb-cccc-1234567890ab", `/post/${ID}`], // a user id is not a handle
  ])("handle %j → %s, same in the Deno copy", (handle, want) => {
    expect(postPath(ID, handle)).toBe(want);
    expect(denoPostPath(ID, handle)).toBe(want);
  });

  it("postPathOf reads the handle under its usual names", () => {
    expect(postPathOf({ id: ID, author_handle: "neil.basu" })).toBe(`/neil.basu/post/${ID}`);
    expect(postPathOf({ id: ID, profiles: { custom_url: "neil.basu" } })).toBe(`/neil.basu/post/${ID}`);
    expect(postPathOf({ id: ID })).toBe(`/post/${ID}`);
  });

  it("telemetry counts the long form as a post page", () => {
    expect(normaliseRoute(`/neil.basu/post/${ID}`)).toBe("/post/:x");
    expect(normaliseRoute(`/post/${ID}`)).toBe("/post/:x");
  });
});

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(p);
  }
  return out;
}

describe("postPath — no hand-built post address", () => {
  const RULE_FILES = [join("src", "lib", "posts", "postPath.ts"), join("supabase", "functions", "_shared", "postPath.ts")];
  const all = [...files(join(ROOT, "src")), ...files(join(ROOT, "functions")), ...files(join(ROOT, "supabase", "functions"))]
    .filter((f) => !RULE_FILES.some((r) => f.endsWith(sep + r)));

  it("nothing outside postPath builds `/post/${…}` or \"/post/\" + …", () => {
    const hits: string[] = [];
    for (const f of all) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (/^\s*(\*|\/\/)/.test(line)) return; // comments describe routes; they build nothing
        if (/`\/post\/\$\{|["']\/post\/["']\s*\+/.test(line)) hits.push(`${f.slice(ROOT.length)}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  }, 30_000); // scans every source file; slow disks need more than 5 s
});
