/**
 * STAGE L2 (F-REV4-8) — THE FEED IS DEALT PER REFRESH, AND THE NEWEST POSTS
 * LEAD ONLY UNTIL THE MEMBER HAS SEEN THEM.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Owner, 13 Oct 2026: "every refresh, like Facebook/Instagram should show new
 * posts; ours shows the same images, a fixed screen." R-LIVE-5 ("YES"): newest
 * posts first on refresh applies only until the member has seen them.
 *
 * Two of the three causes are in get_broadcast_feed (the third — "seen" never
 * recorded — is the client half):
 *   cause 2  the order is seeded by the clock hour, so every refresh inside an
 *            hour returns the same order;
 *   cause 3  the 3 newest posts are pinned on top whether or not seen.
 *
 * This guard reads the NEWEST migration that defines the function (resolved at
 * run time — never a fixed path, see feedFreshness.test.ts for why) and fails if
 * the fix is reverted or its safety properties drift. Behaviour is proven on
 * PGlite against production's own function bodies:
 * docs/evidence/d1/L2-feed-freshness/pglite-l2-feed.mjs (CI: d1-l2-feed-freshness.yml).
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { migrationsInSequence } from "@/test-utils/migrations";

const ROOT = process.cwd();
const DIR = join(ROOT, "supabase/migrations");
const defines = (f: string) => /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.get_broadcast_feed\s*\(/.test(readFileSync(join(DIR, f), "utf8"));
const latest = migrationsInSequence(DIR).filter(defines).pop()!;
const raw = readFileSync(join(DIR, latest), "utf8").replace(/\r\n/g, "\n");
const sql = raw.replace(/^\s*--.*$/gm, "");

/** The text of one `CREATE … FUNCTION public.get_broadcast_feed(<args>` up to its closing $function$. */
function fnText(argsStartRe: RegExp): string {
  const m = argsStartRe.exec(sql);
  if (!m) return "";
  const open = sql.indexOf("$function$", m.index);
  const close = sql.indexOf("$function$", open + 10);
  return open < 0 || close < 0 ? "" : sql.slice(m.index, close + 10);
}
const five = fnText(/CREATE\s+FUNCTION\s+public\.get_broadcast_feed\s*\(\s*_exclude_ids\s+uuid\[\],\s*_limit\s+integer,\s*_newest_first\s+integer,\s*_categories\s+text\[\],\s*_session_seed\s+text/);
const four = fnText(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.get_broadcast_feed\(_exclude_ids uuid\[\], _limit integer, _newest_first integer, _categories text\[\]\)/);
const cte = (name: string, next: string) => {
  const a = five.indexOf(`${name} AS`);
  const b = five.indexOf(`${next} AS`, a + name.length + 3);
  return a < 0 || b < 0 ? "" : five.slice(a, b);
};

describe("L2 · the newest feed migration carries the session seed", () => {
  it("defines the 5-argument overload (_session_seed text)", () => {
    expect(five.length, `${latest} does not define get_broadcast_feed(..., _session_seed text)`).toBeGreaterThan(500);
  });

  it("gives _session_seed NO default — with the 4-argument overload present a default makes every current call ambiguous", () => {
    expect(five.length, "the 5-argument overload is not defined, so there is nothing to judge").toBeGreaterThan(500);
    const header = five.slice(0, five.indexOf("RETURNS"));
    expect(header).toMatch(/_session_seed\s+text/);
    expect(header).not.toMatch(/_session_seed[^,)]*DEFAULT/i);
  });

  it("keeps today's hourly seed, byte for byte, when no seed is sent", () => {
    expect(cte("seed", "lim")).toContain("to_char(now(), 'YYYYMMDDHH24') || coalesce(auth.uid()::text, 'anon')");
  });

  it("a sent seed is still bound to the viewer, so two members never share an order", () => {
    expect(cte("seed", "lim")).toMatch(/left\(btrim\(_session_seed\), 64\)\s*\|\|\s*':'\s*\|\|\s*coalesce\(auth\.uid\(\)::text, 'anon'\)/);
  });

  it("pins the newest posts only while the member has NOT seen them (R-LIVE-5)", () => {
    const newest = cte("newest", "unseen_ranked");
    expect(newest, "newest CTE not found").not.toBe("");
    // the N newest are taken first, THEN the seen ones are dropped
    expect(newest).toMatch(/ORDER BY v0\.created_at DESC, v0\.id\s+LIMIT/);
    expect(newest).toMatch(/WHERE NOT EXISTS \(SELECT 1 FROM seen s WHERE s\.post_id = v\.id\)/);
  });

  it("limits any one author to 2 consecutive places, carried across pages from _exclude_ids", () => {
    expect(five).toMatch(/\(\(r\.user_id = pk\.a1 AND pk\.a1 = pk\.a2\) IS TRUE\) ASC, r\.ord ASC/);
    expect(cte("tail", "pick")).toMatch(/_exclude_ids\[array_upper\(_exclude_ids, 1\)\]/);
  });

  it("reads a tail post's author only when the caller may see that post (the page order must not confirm who wrote a post they cannot read)", () => {
    // SECURITY DEFINER bypasses RLS: this predicate is the only control on the
    // one place the function reads a post named by the CALLER. Without it the
    // PGlite test "an id the caller cannot see in _exclude_ids" fails.
    const tail = cte("tail", "pick");
    // The whole predicate, from the join: a `true OR …` slipped in front of it
    // would otherwise still "contain" every clause (planted defect 3 in
    // docs/evidence/d1/L2-feed-freshness/failfirst-vitest-guard.txt).
    expect(tail).toMatch(/JOIN public\.posts p\s+ON p\.id = t\.pid\s+AND \(\s+p\.is_public\s+OR p\.user_id = auth\.uid\(\)\s+OR \(p\.privacy = 'friends' AND EXISTS \(/);
    expect(tail).toMatch(/f\.status = 'accepted'/);
    expect(tail).toMatch(/f\.requester_id = auth\.uid\(\) AND f\.addressee_id = p\.user_id/);
    expect(tail).toMatch(/f\.addressee_id = auth\.uid\(\) AND f\.requester_id = p\.user_id/);
    // never the bare lookup by id that was there first
    expect(tail).not.toMatch(/WHERE p\.id = _exclude_ids\[/);
  });

  it("reads only the caller's own events (one member's 'seen' never reaches another member's page)", () => {
    const mine = cte("my_events", "seen");
    expect(mine).toMatch(/WHERE fe\.user_id = auth\.uid\(\)/);
    expect(five).not.toMatch(/feed_events(?![\s\S]{0,120}fe\.user_id = auth\.uid\(\))/);
  });

  it("clamps _limit (NULL used to mean 'no limit' on a SECURITY DEFINER function)", () => {
    expect(cte("lim", "pool")).toContain("LEAST(GREATEST(coalesce(_limit, 10), 0), 50)");
  });

  it("the 4-argument overload is a one-line wrapper that passes NULL", () => {
    expect(four).toContain("SELECT * FROM public.get_broadcast_feed(_exclude_ids, _limit, _newest_first, _categories, NULL::text);");
  });

  it("grants the new overload exactly what production grants the others: authenticated + service_role, never PUBLIC or anon", () => {
    const sig = String.raw`public\.get_broadcast_feed\(uuid\[\], integer, integer, text\[\], text\)`;
    expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC, anon;`));
    expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION ${sig} TO authenticated, service_role;`));
    expect(sql).not.toMatch(new RegExp(`GRANT[^;]*ON FUNCTION ${sig}[^;]*\\b(anon|PUBLIC)\\b`));
  });

  it("adds no index and touches no table (measured, then left out — C-2 forbids dropping one again)", () => {
    // The covering index for my_events was built and measured at 1,000,000
    // events: fewer buffers, no time won, +26 % on every "seen" write. The
    // numbers are in the migration header; a later unit re-measures on real
    // volume. Until then this file changes two functions and nothing else.
    expect(five.length, "the 5-argument overload is not defined, so there is nothing to judge").toBeGreaterThan(500);
    expect(sql).not.toMatch(/CREATE\s+(?:UNIQUE\s+)?INDEX/i);
    expect(sql).not.toMatch(/\b(?:ALTER|CREATE|DROP)\s+TABLE\b/i);
    expect(sql).not.toMatch(/\b(?:CREATE|ALTER|DROP)\s+POLICY\b/i);
    expect(sql).not.toMatch(/\bGRANT\b[^;]*\bON\s+(?:TABLE\s+)?public\.(?!get_broadcast_feed)/i);
  });

  it("is lane-guarded, and its PROBE is read-only", () => {
    expect(sql).toMatch(/current_setting\('p32\.lane', true\), ''\) NOT IN \('staging', 'production'\)/);
    const base = latest.replace(/\.sql$/, "");
    const probe = join(DIR, `PROBE_${base}.sql`);
    expect(existsSync(probe), `PROBE_${base}.sql missing`).toBe(true);
    const p = readFileSync(probe, "utf8");
    expect(p).toMatch(/^BEGIN READ ONLY;/m);
    expect(p.trimEnd()).toMatch(/ROLLBACK;$/);
  });

  it("has a rollback that restores production's 4-argument body and drops the new overload", () => {
    const base = latest.replace(/\.sql$/, "");
    const rb = join(ROOT, "supabase/rollback", `${base}_ROLLBACK.sql`);
    expect(existsSync(rb), `${base}_ROLLBACK.sql missing`).toBe(true);
    const t = readFileSync(rb, "utf8");
    expect(t).toContain("96a65d7037ecc5351da75a28f8cace73");
    expect(t).toContain("to_char(now(), 'YYYYMMDDHH24') || coalesce(auth.uid()::text, 'anon') AS s");
    expect(t).toMatch(/DROP FUNCTION public\.get_broadcast_feed\(uuid\[\], integer, integer, text\[\], text\);/);
  });
});
