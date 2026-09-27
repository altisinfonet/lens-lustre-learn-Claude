/**
 * P10 · NO TIMER UNDER ONE SECOND, AND NO REPEATING TIMER THAT SURVIVES A
 * BACKGROUNDED TAB.
 *
 * ── WHY THIS IS A SOURCE SCAN AND NOT A BEHAVIOURAL TEST ─────────────────────
 * P10's gate is a property of the whole client, not of one component: "no timer
 * fires more often than once a second; every repeating timer is cleared on
 * `visibilitychange`." A behavioural test proves one call site. This proves the
 * population, which is what the gate asks about, and it is the same instrument
 * the 0-D2-03 baseline inventory used to produce the before-figure — so the
 * before and after numbers are comparable.
 *
 * ── THE SECOND ASSERTION IS THE VISIBILITY CLAUSE ────────────────────────────
 * "Cleared on visibilitychange" cannot be checked per call site by grepping for
 * the word: `AdZone.tsx` contained `visibilitychange` and still failed, because
 * the listener was doing something else. So the rule here is structural
 * instead: **the only code allowed to call `setInterval` is the one control
 * that stops and restarts on visibility**, plus the heartbeat that already
 * implements the same pattern and is the reference P10 copies. Every other
 * timer goes through `useVisibilityInterval`, and therefore cannot exist
 * without the teardown.
 *
 * ── FAIL-FIRST ───────────────────────────────────────────────────────────────
 * Run against `staging` 7ebdbf4 before any fix, this file goes red with 21
 * `setInterval` sites, two of them under a second (200 ms and ~30 ms). The run
 * is committed at docs/evidence/d2/phase2/p10-fail-first.txt.
 *
 * ── WHAT IT CANNOT SEE, SAID PLAINLY ─────────────────────────────────────────
 * A delay held in a variable that this scan cannot resolve, a timer created
 * inside a dependency, and `setTimeout` chains that re-arm themselves. The
 * third is a real hole and is named in the after-inventory rather than left for
 * someone to find.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { stripComments } from "@/test-utils/sourceText";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

/** The floor P10 names. */
const MIN_INTERVAL_MS = 1000;
/** The floor this unit applies to react-query polling. */
const MIN_REFETCH_MS = 30_000;

/**
 * The only two files permitted to call `setInterval` directly. Each needs a
 * reason, and the last test in this file pins the list so it cannot quietly
 * grow: adding a third entry is a decision somebody has to make on purpose.
 */
const RAW_INTERVAL_EXEMPT: Record<string, string> = {
  "src/lib/timers/visibilityInterval.ts":
    "It is the control. This file IS the setInterval that every other site now goes through.",
  "src/hooks/core/useEngagementHeartbeat.ts":
    "The reference implementation P10 is told to copy. It already stops on visibilitychange and on Capacitor appStateChange, refuses to tick while hidden, and resolves the two-tab problem in the database. Rewriting it to call the helper would rewrite the pattern the helper was derived from.",
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "test" || name === "test-utils") continue;
      sourceFiles(full, out);
    } else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const FILES = sourceFiles(SRC).map((f) => ({
  path: relative(ROOT, f).split(sep).join("/"),
  code: stripComments(readFileSync(f, "utf8")),
  raw: readFileSync(f, "utf8"),
}));

/** Every `setInterval(` call site, with the numeric delay when it is a literal. */
const intervalSites = FILES.flatMap(({ path, code }) =>
  [...code.matchAll(/setInterval\s*\(([\s\S]*?)\)\s*;/g)].map((m) => {
    const args = m[1];
    // The delay is the last top-level argument. A literal, an underscore
    // literal (30_000), or an arithmetic product of literals is resolvable;
    // anything else is reported as unresolved rather than assumed fine.
    const tail = args.slice(args.lastIndexOf(",") + 1).trim();
    const literal = /^[\d_ *+]+$/.test(tail) && tail.length > 0
      ? Number(Function(`"use strict";return (${tail.replace(/_/g, "")})`)())
      : null;
    return { path, delayMs: Number.isFinite(literal as number) ? (literal as number) : null, tail };
  }),
);

describe("P10 · setInterval", () => {
  it("is called directly by nothing except the two files that are allowed to", () => {
    const offenders = [...new Set(intervalSites.map((s) => s.path))]
      .filter((p) => !(p in RAW_INTERVAL_EXEMPT))
      .sort();

    expect(
      offenders,
      `These files call setInterval directly. A raw setInterval has no teardown on ` +
        `visibilitychange, so it keeps waking a backgrounded tab — the 580,000-requests ` +
        `problem in miniature. Route them through useVisibilityInterval ` +
        `(src/lib/timers/visibilityInterval.ts), which stops on hide and restarts on show. ` +
        `If one genuinely cannot, it needs a new entry in RAW_INTERVAL_EXEMPT with a written ` +
        `reason, and that is a decision, not a fix.`,
    ).toEqual([]);
  });

  it("never runs more often than once a second, anywhere in src/**", () => {
    const tooFast = intervalSites
      .filter((s) => s.delayMs !== null && s.delayMs < MIN_INTERVAL_MS)
      .map((s) => `${s.path} — ${s.delayMs} ms`)
      .sort();

    expect(
      tooFast,
      `P10's floor is ${MIN_INTERVAL_MS} ms. A sub-second repeating timer costs battery on a ` +
        `mid-range Android for a visual nobody is watching; derive the displayed value from a ` +
        `timestamp at render time, or use requestAnimationFrame where a continuous visual is ` +
        `genuinely needed.`,
    ).toEqual([]);
  });

  it("has no delay this scan cannot resolve (an unreadable delay is not a passing one)", () => {
    const unresolved = intervalSites
      .filter((s) => s.delayMs === null)
      .filter((s) => !(s.path in RAW_INTERVAL_EXEMPT))
      .map((s) => `${s.path} — delay expression: ${s.tail}`)
      .sort();

    expect(
      unresolved,
      `This scan could not read these delays, so it cannot say they are ≥ ${MIN_INTERVAL_MS} ms. ` +
        `A guard that silently passes what it cannot read is the C-34 failure. Use a literal, or ` +
        `a named constant defined as a literal in the same file.`,
    ).toEqual([]);
  });

  it("GUARD the exempt list is exactly the two files, and both still exist", () => {
    // Without this, the first assertion is passed by adding a line to a map.
    expect(Object.keys(RAW_INTERVAL_EXEMPT).sort()).toEqual([
      "src/hooks/core/useEngagementHeartbeat.ts",
      "src/lib/timers/visibilityInterval.ts",
    ]);
    for (const p of Object.keys(RAW_INTERVAL_EXEMPT)) {
      expect(existsSync(join(ROOT, p)), `${p} is exempt but does not exist`).toBe(true);
      expect(RAW_INTERVAL_EXEMPT[p].length, `${p} is exempt without a real reason`).toBeGreaterThan(60);
    }
  });
});

describe("P10 · react-query polling", () => {
  /**
   * A justification is the contiguous comment block directly above the line,
   * not only the single line above it: a reason worth writing is usually more
   * than sixty characters, and forcing it onto one line would be a rule that
   * rewards terseness over explanation. The block stops at the first line that
   * is neither a comment nor blank, so a comment attached to something else
   * cannot be borrowed.
   */
  const refetchSites = FILES.flatMap(({ path, raw }) => {
    const lines = raw.split("\n");
    return lines
      .map((line, i) => {
        const above: string[] = [];
        for (let j = i - 1; j >= 0 && i - j <= 10; j--) {
          const t = lines[j].trim();
          if (t === "" || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) {
            above.push(lines[j]);
            continue;
          }
          break;
        }
        return { path, line, n: i + 1, above: above.join("\n") };
      })
      .filter((l) => /refetchInterval\s*:/.test(l.line));
  });

  it("polls no faster than 30 s", () => {
    const tooFast = refetchSites
      .filter((l) => {
        const m = l.line.match(/(\d[\d_]*)\s*\*?\s*(\d+)?/g);
        const nums = (l.line.match(/\d[\d_]*(\s*\*\s*\d+)*/g) ?? [])
          .map((x) => Number(Function(`"use strict";return (${x.replace(/_/g, "")})`)()))
          .filter((n) => Number.isFinite(n) && n > 1);
        return nums.length > 0 && Math.max(...nums) < MIN_REFETCH_MS;
      })
      .map((l) => `${l.path}:${l.n} — ${l.line.trim()}`);

    expect(tooFast, `P10's floor for a background poll is ${MIN_REFETCH_MS} ms.`).toEqual([]);
  });

  it("every poll carries a written justification the reader can find", () => {
    const unjustified = refetchSites
      .filter((l) => !/P10:/.test(l.line) && !/P10:/.test(l.above))
      .map((l) => `${l.path}:${l.n} — ${l.line.trim()}`)
      .sort();

    expect(
      unjustified,
      `"Justify or slow each" — a poll that stays needs its reason on the line, or in the ` +
        `comment block directly above it, marked "P10:", so the next reader does not have to ` +
        `guess why a network request repeats forever. Leave the reason in the file.`,
    ).toEqual([]);
  });
});
