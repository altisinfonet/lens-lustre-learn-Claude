/**
 * A SUBSCRIPTION TO AN UNPUBLISHED TABLE REPORTS SUCCESS AND RECEIVES NOTHING,
 * FOREVER.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MEASURED ON PRODUCTION, 2026-08-15 — see docs/realtime-firehose-decision.md.
 *
 * `postgres_changes` delivers nothing for a table that is not in the
 * `supabase_realtime` publication. The channel still connects, `.subscribe()`
 * still reports `SUBSCRIBED`, and nothing anywhere raises an error. Silence is
 * indistinguishable from "nothing has changed yet" — which is the normal state
 * of most tables most of the time, so it never looks wrong.
 *
 * 13 of the 52 subscriptions in this codebase are in that state. It was not an
 * oversight in the publication: two migrations on 2026-05-26 DROPPED five
 * judging tables and `site_settings` from it, in five lines of SQL with not one
 * word of explanation, and the client code that depended on them was left
 * running. On 2026-07-22 another migration put three back "so the Admin panel
 * can watch judge markings live" — and did NOT put back
 * `judge_tag_assignments`, which under Judging v5 is the table every decision
 * is written to. So live updates were restored for the SUPERSEDED decision
 * tables and left off the current one.
 *
 * WHAT THIS TEST ASKS FOR: a subscription names a table the repository's own
 * migrations have published, or it is listed below with what it is waiting on.
 * It does NOT decide which of the thirteen get published and which get deleted
 * — that is the owner's call (D1 in the audit), and a test that picked would be
 * making it by default.
 *
 * THE EXPECTED PUBLICATION IS DERIVED FROM THE MIGRATIONS AT RUN TIME, never
 * hardcoded — ADDs minus later DROPs, in filename order. A hardcoded list would
 * be a snapshot of a belief; this is the SQL itself. On the day it was written
 * the derived set matched the live publication exactly: 29 tables, no drift in
 * either direction.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const AUDIT_DOC = join(ROOT, "docs/realtime-firehose-decision.md");

/**
 * The thirteen that cannot fire today, each with the decision it awaits.
 * A fix — publishing the table, or deleting the subscription — removes the
 * entry. It is not meant to live here.
 */
const DEAD_SUBSCRIPTIONS: Record<string, string> = {
  judge_tag_assignments:
    "OWNER DECISION D1: dropped from the publication 2026-05-26 with no reason recorded, and NOT restored by the 2026-07-22 repair that put judge_scores/judge_decisions back. Under Judging v5 this is the table every decision is written to, so a judge sees the tag state from when they opened the photograph and nothing after. Recommend publishing — EntryTagStamps already filters by entry_id, so it adds no firehose load",
  judge_sessions:
    "OWNER DECISION D1: same 2026-05-26 drop. Backs useMultiJudgeProgress, the multi-judge coordination view, so that view is not live either",
  site_settings:
    "OWNER DECISION D1: dropped 2026-05-26 in a one-line migration with no reason. liveAdminSync's whole purpose is pushing an admin's setting change to connected clients; that leg is dead while its user_roles leg in the same channel works. Either publish it or delete the leg — today it is neither",
  admin_notifications:
    "OWNER DECISION D1: recommend DELETING these three subscriptions rather than publishing. One of them (useRealtimeFeed.ts:281) is an admin table subscribed from a member-facing hook",
  admin_vote_adjustments:
    "OWNER DECISION D1: never in the publication at all. Two subscriptions wait on a table that has never broadcast",
  judge_comments:
    "OWNER DECISION D1: same 2026-05-26 drop; not restored by the 2026-07-22 repair",
  judging_preflight_log:
    "OWNER DECISION D1: never published. PreflightStatusBadge waits for events that cannot arrive",
  badge_definitions:
    "OWNER DECISION D1: a small admin-curated config table (6 rows). Live updates are a nicety, not a defect — deleting the subscription is the honest and cheap answer",
  role_display_config:
    "OWNER DECISION D1: a small admin-curated config table (7 rows), same reasoning as badge_definitions",
};

const ADD = /ALTER\s+PUBLICATION\s+supabase_realtime\s+ADD\s+TABLE\s+(?:public\.)?([a-z0-9_]+)/gi;
const DROP = /ALTER\s+PUBLICATION\s+supabase_realtime\s+DROP\s+TABLE\s+(?:public\.)?([a-z0-9_]+)/gi;
const stripSql = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--.*$/gm, " ");

/** ADDs minus later DROPs, applied in migration order. */
function publishedTables(): Set<string> {
  const published = new Set<string>();
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const sql = stripSql(readFileSync(join(MIGRATIONS, f), "utf8"));
    // Order within one file matters as little as it does in practice — no
    // migration both adds and drops the same table — but ADD is applied first
    // so a file that does both ends DROPped, matching Postgres.
    for (const m of sql.matchAll(ADD)) published.add(m[1]);
    for (const m of sql.matchAll(DROP)) published.delete(m[1]);
  }
  return published;
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !name.includes(".test.")) out.push(p);
  }
  return out;
}

interface Sub { table: string; file: string; line: number; filtered: boolean }

function subscriptions(): Sub[] {
  const out: Sub[] = [];
  for (const abs of walk(join(ROOT, "src"))) {
    const rel = abs.slice(ROOT.length + 1).replace(/\\/g, "/");
    const src = readFileSync(abs, "utf8");
    if (!src.includes("postgres_changes")) continue;
    for (const m of src.matchAll(/\.on\(\s*["']postgres_changes["']\s*,\s*\{([^}]*)\}/g)) {
      const cfg = m[1].replace(/\s+/g, " ");
      const table = cfg.match(/table\s*:\s*["']([\w]+)["']/)?.[1];
      if (!table) continue;
      out.push({
        table,
        file: rel,
        line: src.slice(0, m.index!).split("\n").length,
        filtered: /filter\s*:/.test(cfg),
      });
    }
  }
  return out;
}

const published = publishedTables();
const subs = subscriptions();

describe("every realtime subscription can actually receive something", () => {
  it("finds migrations and subscriptions at all (vacuity guard)", () => {
    // Without this, a refactor that moved either would make the assertions
    // below pass by examining nothing at all.
    expect(published.size).toBeGreaterThanOrEqual(20);
    expect(subs.length).toBeGreaterThanOrEqual(30);
  });

  it("subscribes only to published tables, or declares why not", () => {
    const silent = [...new Set(subs.filter((s) => !published.has(s.table)).map((s) => s.table))]
      .filter((t) => {
        const reason = DEAD_SUBSCRIPTIONS[t];
        return !reason || reason.trim().length <= 20;
      });
    expect(
      silent,
      `These tables are subscribed with postgres_changes but are NOT in the supabase_realtime ` +
        `publication, so the handlers can never fire — and nothing reports it, because .subscribe() ` +
        `succeeds and silence looks like "nothing has changed yet": ${silent.join(", ")}. Either add ` +
        `the table to the publication in a migration, delete the subscription, or add it to ` +
        `DEAD_SUBSCRIPTIONS with what it is waiting on. See docs/realtime-firehose-decision.md.`,
    ).toEqual([]);
  });

  it("the dead list does not outlive the subscriptions it describes", () => {
    // Two ways to go stale, both quietly wrong: an entry for a table that got
    // published (the exemption now hides a working subscription from review),
    // and an entry for a subscription that was deleted (the next dead one to
    // use that table inherits a pass nobody granted it).
    const subscribedTables = new Set(subs.map((s) => s.table));
    const stale = Object.keys(DEAD_SUBSCRIPTIONS).filter(
      (t) => published.has(t) || !subscribedTables.has(t),
    );
    expect(
      stale,
      `DEAD_SUBSCRIPTIONS entries that are no longer true — the table is now published, or nothing ` +
        `subscribes to it any more: ${stale.join(", ")}. Delete them.`,
    ).toEqual([]);
  });

  it("still recognises published tables as published (positive control)", () => {
    // A derivation broken toward "nothing is published" would make the test
    // above fail loudly, which is safe. A derivation broken toward "everything
    // is published" would report all clear and read exactly like a healthy
    // codebase. These four are ADDed by migrations and were verified live.
    for (const t of ["posts", "post_reactions", "user_notifications", "judge_scores"]) {
      expect(published.has(t), `${t} is no longer derived as published`).toBe(true);
    }
    // judge_scores is the sharp one: DROPPED on 2026-05-26 and re-ADDED on
    // 2026-07-22. If the derivation ever applied drops after adds regardless of
    // migration order, this would read as unpublished — and the whole gate
    // would be wrong in the reassuring direction. That is what this pins.
    //
    // Its mirror: judge_tag_assignments was dropped on the same day and never
    // re-added. When D1 is decided and it IS published, THIS ASSERTION IS
    // SUPPOSED TO FAIL — flip it and delete the DEAD_SUBSCRIPTIONS entry in the
    // same change, so the record moves with the decision instead of after it.
    expect(
      published.has("judge_tag_assignments"),
      "judge_tag_assignments is now published — good. Flip this expectation to true and remove its " +
        "DEAD_SUBSCRIPTIONS entry; see D1 in docs/realtime-firehose-decision.md.",
    ).toBe(false);
  });

  it("keeps the audit the decision rests on", () => {
    expect(existsSync(AUDIT_DOC)).toBe(true);
  });
});
