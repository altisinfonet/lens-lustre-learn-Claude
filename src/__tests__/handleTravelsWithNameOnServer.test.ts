import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * F-98c — THE HANDLE MUST TRAVEL WITH THE NAME ON THE SERVER TOO.
 *
 * WHY THIS FILE HAD TO EXIST. Every instrument this project owned looked at
 * src/. The tree-wide client rule in nameAlwaysLinksToHandle.test.ts asserts
 * that no client .select() fetches full_name without custom_url, and it was
 * SATISFIED — zero violations — at the same instant six member names were dead
 * on /discover. Both were true because on those pages the name does not come
 * from a client select at all. There was no select in src/ to widen, so there
 * was nothing for that rule to catch.
 *
 * The rendered probe (docs/evidence/d2/F-98b/deadnames.prepared.mjs) cannot
 * cover it either, and this is worth stating plainly rather than discovering
 * later: the probe walks the UI harness, the harness is fed by
 * src/uiharness/fixtures.ts, and the fixtures are a hand-written copy of the
 * shape the server sends. If dashboard-init dropped custom_url again tomorrow,
 * the fixture would still carry it and the probe would stay green.
 *
 * So the server file is read HERE, as text, in the client's test suite. That is
 * a lane crossing and it is deliberate: the defect crosses the lane, so the
 * check has to. It reads and asserts; it changes nothing.
 *
 * WHAT IT ASSERTS, and each one is a source the auditor found on 2026-09-05:
 *
 *   A  every select in dashboard-init that fetches full_name also fetches
 *      custom_url                                        (sources 1, 2, 4)
 *   B  every object literal that puts a member's NAME on the wire also puts an
 *      address on the wire                            (sources 1, 2, 4, 5)
 *   C  get_todays_birthdays returns custom_url             (source 3)
 *
 * Rule B is the one that matters most, because source 5 — the winners row —
 * would have passed rule A. Nothing was queried wrongly there. Two properties
 * were read off an object that already had the third.
 */

const EDGE = "supabase/functions/dashboard-init/index.ts";

/**
 * Blank out comments, KEEPING every character position.
 *
 * This is not tidiness, it is the check's first false positive and it was mine.
 * Rule A reported a violation at index.ts:331 — which is a COMMENT I had just
 * written, reading `// F-98c — was .select("id, full_name").` A scanner that
 * reads an explanation of a fix as the fault it describes will cry wolf for
 * ever, and the auditor withdrew his own v1 id-link scanner earlier the same
 * day for exactly this. A false red costs the same trust as a false green.
 *
 * Comment bodies become spaces rather than being deleted, so every reported
 * line number still points at the real line.
 */
function stripComments(text: string, sqlDashes = false): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  let out = text.replace(/\/\*[\s\S]*?\*\//g, blank);
  out = out.replace(/\/\/[^\n]*/g, blank);
  if (sqlDashes) out = out.replace(/--[^\n]*/g, blank);
  return out;
}

const src = () => stripComments(readFileSync(join(process.cwd(), EDGE), "utf8"));

/** Anything that can carry a member's address on the wire. */
const HANDLE_TOKENS = ["custom_url", "photographer_handle", "user_custom_url"];
const hasHandle = (text: string) => HANDLE_TOKENS.some((t) => text.includes(t));

/**
 * The innermost `{ … }` around `index`, brace-matched rather than regexed.
 *
 * A regex cannot do this. The literals in question span ten to twenty lines and
 * contain nested objects and template strings; every line-window heuristic I
 * tried either bridged two literals or stopped inside one, and a check that
 * reads the wrong block is worse than no check because it reports confidently.
 */
export function enclosingBlock(text: string, index: number): string {
  let depth = 0;
  let start = -1;
  for (let i = index; i >= 0; i--) {
    const c = text[i];
    if (c === "}") depth++;
    else if (c === "{") {
      if (depth === 0) { start = i; break; }
      depth--;
    }
  }
  if (start === -1) return "";
  depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}

/** Every place a member's name is written into an outgoing object. */
function nameEmissionSites(text: string): Array<{ line: number; excerpt: string; block: string }> {
  const out: Array<{ line: number; excerpt: string; block: string }> = [];
  /*
   * TWO SHAPES, and the second one is the one that matters.
   *
   *   full_name: p.full_name          the key IS the name
   *   user_name: profiles[id]?.full_name   the key is something else entirely
   *
   * The first version of this pattern only walked dotted paths, so it could not
   * see a bracket index — and source 5, the winners row, is exactly
   * `user_name: profiles[e.user_id]?.full_name`. Rule B PASSED on the real file
   * while being structurally unable to see the worst of the six sources. Caught
   * by the self-test below, not by reading, which is the only reason it is not
   * still passing vacuously.
   */
  const re = /^.*(?:full_name:|:\s*[A-Za-z_$][\w$[\]().?]*\.full_name).*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const excerpt = m[0].trim();
    // A `.select("…full_name…")` string is rule A's business, not rule B's.
    if (/\.select\(/.test(excerpt)) continue;
    // A type annotation emits nothing.
    if (/^\s*(\/\/|\*|interface|type )/.test(excerpt)) continue;
    out.push({
      line: text.slice(0, m.index).split("\n").length,
      excerpt,
      block: enclosingBlock(text, m.index),
    });
  }
  return out;
}

describe("F-98c — dashboard-init puts an address on the wire beside every name", () => {
  it("A: no select fetches full_name without custom_url", () => {
    const hits = [...src().matchAll(/\.select\("([^"]*full_name[^"]*)"\)/g)]
      .map((m) => m[1])
      .filter((cols) => !cols.includes("custom_url"));
    expect(
      hits,
      `${hits.length} select(s) in ${EDGE} fetch a member's name without their ` +
        `handle:\n${hits.map((h) => `  .select("${h}")`).join("\n")}\n\n` +
        `Every one of them becomes a name on a page. Where the handle does not ` +
        `arrive with it, that name is dead text and no client can rescue it.`,
    ).toEqual([]);
  });

  it("B: every object literal carrying a name also carries an address", () => {
    const text = src();
    const sites = nameEmissionSites(text);
    // If this ever reads zero, the regex has drifted and the check has stopped
    // checking — the exact failure this file was written to prevent elsewhere.
    expect(sites.length, "found no name-emission sites at all — the scan is broken").toBeGreaterThan(2);

    const dead = sites.filter((s) => !hasHandle(s.block));
    expect(
      dead.map((d) => `${EDGE}:${d.line}  ${d.excerpt}`),
      `${dead.length} object literal(s) put a member's NAME on the wire with no ` +
        `address beside it. This is source 5 (the winners row), where nothing ` +
        `had to be queried: the handle was already in the variable and two of ` +
        `three properties were read off it.`,
    ).toEqual([]);
  });

  it("C: get_todays_birthdays returns custom_url", () => {
    const dir = join(process.cwd(), "supabase/migrations");
    // The LATEST definition wins — 20260804160000 created it without the
    // column and 20260910_0013 dropped and recreated it with one. Reading the
    // first match would report the state of a superseded migration.
    const defining = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .filter((f) =>
        /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.get_todays_birthdays/i.test(
          stripComments(readFileSync(join(dir, f), "utf8"), true),
        ),
      )
      .sort();
    expect(defining.length, "no migration defines get_todays_birthdays").toBeGreaterThan(0);

    /*
     * Comments stripped here too, and for the same reason as above: the new
     * migration's header QUOTES the old signature —
     *   --     RETURNS TABLE (id uuid, full_name text, avatar_url text)
     * — to explain what was wrong with it, and the first version of this check
     * matched that quotation and reported the fix as the defect.
     */
    const latest = stripComments(
      readFileSync(join(dir, defining[defining.length - 1]), "utf8"),
      true,
    );
    const returns = latest.match(/RETURNS TABLE\s*\(([^)]*)\)/i);
    expect(returns, `no RETURNS TABLE in ${defining[defining.length - 1]}`).not.toBeNull();
    expect(
      returns![1],
      `get_todays_birthdays returns [${returns![1].replace(/\s+/g, " ").trim()}] — ` +
        `no custom_url, so every birthday name reaches the browser with no ` +
        `address attached. Adding it changes the return type, so it needs a ` +
        `DROP and CREATE in a NEW migration, not a CREATE OR REPLACE.`,
    ).toContain("custom_url");
  });
});

describe("F-98c — this check can fail", () => {
  /*
   * C-90: no green counts until the instrument has been broken deliberately
   * and watched to fail. The plants against the real file are recorded in
   * docs/evidence/d2/F-98c/. These exercise the machinery itself, so a future
   * edit that guts enclosingBlock() or the scan regex is caught here rather
   * than by everything silently passing.
   */
  it("brace matching finds the innermost literal, not the file", () => {
    const text = `const a = { outer: 1, inner: { full_name: x, custom_url: y } };`;
    const block = enclosingBlock(text, text.indexOf("full_name"));
    expect(block).toBe("{ full_name: x, custom_url: y }");
  });

  it("a literal with a name and no address is reported", () => {
    const bad = `push({\n  id: p.id,\n  full_name: p.full_name,\n  avatar_url: p.avatar_url,\n});`;
    const sites = nameEmissionSites(bad);
    expect(sites).toHaveLength(1);
    expect(hasHandle(sites[0].block)).toBe(false);
  });

  it("a literal that READS .full_name off another object is still seen", () => {
    // Source 5's exact shape: the key is user_name, not full_name.
    const winners = `({\n  user_id: e.user_id,\n  user_name: profiles[e.user_id]?.full_name ?? null,\n})`;
    const sites = nameEmissionSites(winners);
    expect(sites).toHaveLength(1);
    expect(hasHandle(sites[0].block)).toBe(false);
  });

  it("a literal that carries an address passes", () => {
    const good = `({\n  full_name: p.full_name,\n  custom_url: p.custom_url,\n})`;
    const sites = nameEmissionSites(good);
    expect(sites).toHaveLength(1);
    expect(hasHandle(sites[0].block)).toBe(true);
  });
});
