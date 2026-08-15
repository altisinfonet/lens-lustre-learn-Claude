/**
 * A SWITCH THAT SAVES ITS VALUE LOOKS EXACTLY LIKE A SWITCH THAT WORKS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MEASURED ON PRODUCTION, 2026-08-15 — see
 * docs/notification-recipient-integrity-matrix.md.
 *
 * The Notification Settings page renders 21 toggles. Each one writes to
 * `notification_preferences` and reads back correctly, so every one of them
 * *appears* to work: flip it, reload, it stayed flipped. Five of them are read
 * by nothing at all — four in-app category switches, and a Weekly Digest switch
 * for a digest that was never built. The member turns the switch off and the
 * notifications keep coming, with no error and nothing to see.
 *
 * WHY THIS IS ITS OWN GATE rather than a line in the audit: the failure is
 * INVISIBLE FROM BOTH ENDS. The member sees a switch that holds its position.
 * The developer sees a column that exists, a form that saves, and a hook that
 * loads. Nothing in either view says "and then somebody has to consult it".
 * The four `inapp_*` columns have been dead since the day they were created,
 * 2026-04-07, and the page has shipped that whole time.
 *
 * The proof that this is an omission and not a policy is on the same page: the
 * PUSH switches beside them are read by `push_on_notification()`, and the file
 * carries a comment recording that they "had simply never been on screen, so
 * the 12 members with a registered device had no way to turn them off."
 * Somebody checked the wiring for push. Nobody checked it for in-app.
 *
 * WHAT THIS TEST DOES NOT DO: it does not demand the five be fixed. There are
 * two honest answers — wire the switch, or take it off the page — and they are
 * different products. Choosing one inside a test would be making the owner's
 * decision by default. So each is named below with the decision it is waiting
 * on, and the gate's job is only that a SIXTH cannot appear in silence.
 *
 * The toggle list is read out of the page at run time, never hardcoded —
 * trap #8. Adding a switch to the page adds it to this test automatically,
 * which is the entire point.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SETTINGS_PAGE = "src/pages/NotificationSettings.tsx";
const PREFS_HOOK = "src/hooks/notifications/useNotificationPreferences.ts";
const MATRIX_DOC = join(ROOT, "docs/notification-recipient-integrity-matrix.md");

/**
 * Not evidence that anybody consults the column:
 *  - the page that renders the switch and the hook that loads it — those are
 *    the two ends that already work, and counting them would make every dead
 *    switch look wired;
 *  - `types.ts`, which is generated from the schema, so it lists every column
 *    whether or not a line of logic ever reads one;
 *  - tests, which would let a test assert a column into looking alive.
 */
const NOT_A_CONSUMER = new Set([SETTINGS_PAGE, PREFS_HOOK, "src/integrations/supabase/types.ts"]);

const SEARCH_ROOTS = ["supabase/migrations", "supabase/functions", "src"];

/**
 * The five that are dead today, each with the decision it is blocked on.
 * A fix removes the line; it is not meant to live here indefinitely.
 */
const UNWIRED_TOGGLES: Record<string, string> = {
  inapp_reactions:
    "OWNER DECISION: either the bell starts hiding reaction notifications for members who switch this off, or the switch comes off the page. Dead since the CREATE TABLE that added it on 2026-04-07",
  inapp_comments:
    "OWNER DECISION: same choice as inapp_reactions — wire the bell to it or remove the control. Dead since 2026-04-07",
  inapp_social:
    "OWNER DECISION: same choice as inapp_reactions; covers follows and friend requests. Dead since 2026-04-07",
  inapp_competitions:
    "OWNER DECISION: same choice as inapp_reactions; covers competition activity. Dead since 2026-04-07",
  email_weekly_digest:
    "OWNER DECISION: there is no weekly digest feature anywhere in the codebase, so this switch controls something that does not exist. Build the digest, or remove the switch",
};

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(sql|ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const searchFiles = SEARCH_ROOTS.flatMap((r) => walk(join(ROOT, r)))
  .map((p) => p.slice(ROOT.length + 1))
  .filter((p) => !NOT_A_CONSUMER.has(p) && !p.includes(".test."));

/**
 * The line that CREATES the column is not a reader of it. Without this, every
 * dead column would look alive purely because the migration that added it
 * mentions it — which is exactly the shape of the bug being caught.
 */
const isDeclaration = (line: string, col: string) =>
  new RegExp(`^\\s*(ADD\\s+COLUMN\\s+(IF\\s+NOT\\s+EXISTS\\s+)?)?${col}\\s+boolean\\b`, "i").test(line);

const pageSource = readFileSync(join(ROOT, SETTINGS_PAGE), "utf8");

/** Every column the page actually renders a control for, read from the page. */
const toggledColumns = [...pageSource.matchAll(/toggle\("([a-z_]+)"\)/g)].map((m) => m[1]).sort();

function consumersOf(col: string): string[] {
  const found: string[] = [];
  for (const rel of searchFiles) {
    const text = readFileSync(join(ROOT, rel), "utf8");
    if (!text.includes(col)) continue;
    if (text.split("\n").some((l) => l.includes(col) && !isDeclaration(l, col))) found.push(rel);
  }
  return found;
}

describe("every notification switch on screen is connected to something", () => {
  it("reads the toggle list off the page (vacuity guard)", () => {
    // If the page is refactored to build toggles another way, this scanner
    // finds nothing and every assertion below passes by checking nothing.
    expect(toggledColumns.length).toBeGreaterThanOrEqual(15);
    expect(searchFiles.length).toBeGreaterThanOrEqual(200);
  });

  it("each rendered switch has a reader, or is declared unwired with a reason", () => {
    const silentlyDead: string[] = [];
    for (const col of toggledColumns) {
      if (consumersOf(col).length > 0) continue;
      const reason = UNWIRED_TOGGLES[col];
      if (!reason || reason.trim().length <= 20) silentlyDead.push(col);
    }
    expect(
      silentlyDead,
      `These switches are rendered on the Notification Settings page, save their value, and are read by ` +
        `NOTHING — no migration, no edge function, no client code: ${silentlyDead.join(", ")}. The member ` +
        `turns them off and nothing changes. Either give the column a reader, or add it to UNWIRED_TOGGLES ` +
        `with the decision it is waiting on. See docs/notification-recipient-integrity-matrix.md.`,
    ).toEqual([]);
  });

  it("the unwired list does not outlive the switches it describes", () => {
    // Two ways to go stale, and both are quietly wrong: an entry for a switch
    // that got wired (the exemption now hides a working control from review),
    // and an entry for a switch that was removed from the page (the next column
    // to take that name inherits a pass nobody granted it).
    const stale = Object.keys(UNWIRED_TOGGLES).filter(
      (col) => !toggledColumns.includes(col) || consumersOf(col).length > 0,
    );
    expect(
      stale,
      `UNWIRED_TOGGLES entries that are no longer true — either the switch now has a reader, or it is no ` +
        `longer on the page: ${stale.join(", ")}. Delete them.`,
    ).toEqual([]);
  });

  it("the push switches are still wired (positive control)", () => {
    // Not decoration. These prove the scanner can tell a live column from a
    // dead one — without them, a broken scanner would report "all clear" and
    // read exactly like a healthy settings page.
    for (const col of ["push_enabled", "push_reactions", "push_comments"]) {
      expect(toggledColumns).toContain(col);
      expect(consumersOf(col).length, `${col} lost its reader`).toBeGreaterThan(0);
    }
  });

  it("keeps the matrix that justifies every exemption", () => {
    expect(existsSync(MATRIX_DOC)).toBe(true);
  });
});
