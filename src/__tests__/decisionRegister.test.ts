/**
 * A DELIBERATE REMOVAL MUST BE WRITTEN DOWN, OR IT IS INDISTINGUISHABLE FROM
 * DAMAGE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS, 2026-08-19. The owner found the Only Me / Friends / Public
 * chooser missing and asked when it had been broken. It had not been broken —
 * it was withheld on 2026-08-16 for a sound reason (the CDN cannot enforce a
 * post's privacy, so the control would have promised something untrue). But the
 * reasoning lived only in a comment inside `WallPosts.tsx` and in a test named
 * after the thing it was hiding. Nobody told him. From where he stood a working
 * control vanished between builds with no explanation, and the cost was not the
 * feature — it was that he could no longer tell which other changes were
 * intentional.
 *
 * `docs/DECISIONS.md` is where that gets recorded. This file is what makes the
 * register true rather than aspirational, because a document nobody is forced
 * to update is a document that goes stale and then lies.
 *
 * WHAT IT ENFORCES, in both directions:
 *   • every registered decision carries every field a reader needs — including
 *     a RESTORE CONDITION somebody can actually check;
 *   • every ACTIVE decision's pinning test exists, and that test carries an
 *     `@decision D-NNN` marker pointing back at its entry;
 *   • every `@decision` marker anywhere in `src/` names a decision that is
 *     really in the register — so an entry cannot be quietly deleted while the
 *     test that enforces it stays behind, still green, guarding a rule that no
 *     longer has a written reason.
 *
 * ⚠ WHEN THIS FAILS, THE FIX IS TO WRITE THE ENTRY, NOT TO DELETE THE CHECK.
 * A withholding nobody can find is the exact failure this repository already
 * paid for once.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const REGISTER = join(ROOT, "docs/DECISIONS.md");
/** This file necessarily contains the marker pattern; it must not scan itself. */
const SELF = "src/__tests__/decisionRegister.test.ts";

const MARKER = /@decision\s+(D-\d{3})/g;

type Decision = {
  id: string;
  title: string;
  status: string;
  decided: string;
  decidedBy: string;
  pinnedBy: string;
  restoreWhen: string;
  body: string;
};

function field(body: string, label: string): string {
  // - **Status:** ACTIVE
  const m = new RegExp(`^-\\s+\\*\\*${label}:\\*\\*\\s*(.+)$`, "m").exec(body);
  return m ? m[1].trim() : "";
}

function parseRegister(src: string): Decision[] {
  const out: Decision[] = [];
  // Sections start at a level-2 heading naming an id: "## D-001 — title"
  const parts = src.split(/^## (D-\d{3})\s+[—-]\s+(.+)$/m);
  for (let i = 1; i < parts.length; i += 3) {
    const id = parts[i], title = parts[i + 1], body = parts[i + 2] ?? "";
    out.push({
      id,
      title: title.trim(),
      status: field(body, "Status"),
      decided: field(body, "Decided"),
      decidedBy: field(body, "Decided by"),
      pinnedBy: field(body, "Pinned by").replace(/`/g, "").trim(),
      restoreWhen: field(body, "Restore when"),
      body,
    });
  }
  return out;
}

function walk(dir: string, hits: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, hits);
    else if (/\.(ts|tsx)$/.test(name)) hits.push(p);
  }
  return hits;
}

const registerSrc = existsSync(REGISTER) ? readFileSync(REGISTER, "utf8") : "";
const decisions = parseRegister(registerSrc);

describe("the decision register is real, not aspirational", () => {
  it("docs/DECISIONS.md exists and explains itself", () => {
    expect(
      existsSync(REGISTER),
      "docs/DECISIONS.md is gone. It is the only place a deliberate removal is " +
        "explained to the owner; without it a withheld feature is indistinguishable " +
        "from a bug.",
    ).toBe(true);
    expect(registerSrc.length).toBeGreaterThan(800);
  });

  it("holds at least one decision, so the checks below are not vacuous", () => {
    // Without this, emptying the file would make every assertion below pass.
    expect(decisions.length).toBeGreaterThan(0);
  });

  it("gives every decision a unique id", () => {
    const ids = decisions.map((d) => d.id);
    expect(ids).toEqual([...new Set(ids)]);
  });

  it("fills in every field a reader needs, for every decision", () => {
    for (const d of decisions) {
      expect(d.title, `${d.id} has no title`).not.toBe("");
      expect(["ACTIVE", "CLOSED", "SUPERSEDED"], `${d.id} status "${d.status}"`)
        .toContain(d.status);
      expect(d.decided, `${d.id} has no decision date`).toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(d.decidedBy, `${d.id} does not say who decided it`).not.toBe("");
      expect(d.pinnedBy, `${d.id} names no pinning test`).not.toBe("");
      // The condition that ENDS the decision is the field most likely to be
      // skipped and the one that matters most: without it nobody can tell
      // whether the reason still holds.
      expect(
        d.restoreWhen.length,
        `${d.id} has no checkable restore condition — a decision with no way out ` +
          `is permanent by accident`,
      ).toBeGreaterThan(25);
    }
  });

  it("every decision still in force names a pinning test that exists", () => {
    /**
     * ACTIVE and SUPERSEDED both require the file to be there, for different
     * reasons: an ACTIVE decision is held by its own pin, and a SUPERSEDED one
     * handed its pin to the successor — which is exactly what D-001 did when
     * D-002 replaced it, so the file it names is the successor's and must
     * exist. CLOSED is the opposite case and is checked below.
     *
     * ⚠ SUPERSEDED WAS FOUND MISSING BY MUTATION, 2026-08-19. Pointing D-001's
     * "Pinned by" at a file that does not exist left the suite green, because
     * the rule only covered ACTIVE. A register entry naming a file nobody can
     * open is the register describing a safeguard that is not there.
     */
    for (const d of decisions.filter((x) => x.status === "ACTIVE" || x.status === "SUPERSEDED")) {
      expect(
        existsSync(join(ROOT, d.pinnedBy)),
        `${d.id} (${d.status}) names "${d.pinnedBy}", which does not exist`,
      ).toBe(true);
    }
  });

  it("every ACTIVE decision's pinning test points back at it", () => {
    for (const d of decisions.filter((x) => x.status === "ACTIVE")) {
      const src = readFileSync(join(ROOT, d.pinnedBy), "utf8");
      expect(
        src.includes(`@decision ${d.id}`),
        `${d.pinnedBy} does not carry "@decision ${d.id}". The register and the test ` +
          `have drifted apart, so deleting one would leave the other silently orphaned.`,
      ).toBe(true);
    }
  });

  it("a CLOSED decision has had its pinning test deleted", () => {
    /**
     * ⚠ FOUND BY MUTATION, 2026-08-19, and it was a real hole. Marking D-002
     * CLOSED while the privacy-gap notice and its pinning test both still stood
     * left every other assertion green — so the register would have said the
     * gap was closed and the product would still have had it. A register that
     * can say that is the "document nobody is forced to update, which goes
     * stale and then lies" this file exists to prevent, arriving through the
     * status field instead of through a missing entry.
     *
     * CLOSED means the condition in "Restore when" was met and the withholding
     * ended — at which point the pin has nothing left to hold and is deleted in
     * the same commit. If the pin is still there, the closure is not true yet.
     *
     * SUPERSEDED is deliberately NOT covered: supersession hands the pin to the
     * successor entry, which is exactly what D-001 did when D-002 replaced it,
     * and that file must keep existing.
     */
    for (const d of decisions.filter((x) => x.status === "CLOSED")) {
      expect(
        existsSync(join(ROOT, d.pinnedBy)),
        `${d.id} is marked CLOSED but its pinning test "${d.pinnedBy}" still exists. ` +
          `Either the decision is not actually closed — in which case the status is wrong and ` +
          `the register is now claiming something untrue about the product — or the test should ` +
          `have been deleted in the same commit that closed it.`,
      ).toBe(false);
    }
  });

  it("no test pins a decision that is not in the register", () => {
    const known = new Set(decisions.map((d) => d.id));
    const orphans: string[] = [];
    for (const file of walk(join(ROOT, "src"))) {
      const rel = file.slice(ROOT.length + 1).replace(/\\/g, "/");
      if (rel === SELF) continue;
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(MARKER)) {
        if (!known.has(m[1])) orphans.push(`${rel} pins ${m[1]}, which is not registered`);
      }
    }
    expect(
      orphans,
      "a test is enforcing a decision whose written reasoning has been deleted — " +
        "which is how a rule survives with nobody able to say why it is there",
    ).toEqual([]);
  });
});
