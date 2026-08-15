/**
 * THE DELETION PROTOCOL IS A RULE WITH AN ALARM, NOT A PARAGRAPH.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AI_CONTROL.md (2026-08-14) adopted the standing rule: no cleanup job may
 * delete an object unless the reference/live-id graph enumerated SUCCESSFULLY
 * (fail-loud), and the run followed dry-run → expected count → sample →
 * maximum-deletion threshold → execute → post-delete verification.
 *
 * The rule earned its alarm the hard way. When the purge function was read
 * against the protocol, THE DELETING FILE ITSELF violated it three ways:
 *
 *   1. `const { data: comps } = await ...select("id")` — error ignored. A
 *      transient failure reading `competitions` yielded an EMPTY live-id set,
 *      classifying EVERY uuid folder in the store as an orphan. On a non-dry
 *      run: the whole competition archive.
 *   2. The live-id reads were un-paginated. PostgREST caps un-ranged selects,
 *      so past 1,000 entries every additional entry's folder would be "not
 *      live" — deleted. Survivable today only because the platform has not
 *      crossed 1,000 entries.
 *   3. No cap, no expected-count, no post-delete verification.
 *
 * This file asserts the protocol on every BULK-delete-capable function, so the
 * next cleanup tool anyone writes is born with the guard rather than
 * retrofitted after its own near-miss.
 *
 * Scope note, deliberate: TARGETED deletes are exempt and listed below with
 * the reason. A targeted delete's blast radius is bounded by an explicit
 * argument (one competition id, one storage key); the protocol governs sweeps
 * whose scope is derived from a reference graph, because that derivation is
 * where all three near-misses lived.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const FN_DIR = join(process.cwd(), "supabase/functions");

/** Targeted deleters, exempt by design — each with its bounding argument. */
const TARGETED_EXEMPT = new Set([
  // Deletes exactly one admin-named archived competition; residue-verified
  // per BUG-070. Blast radius = the competition_id argument.
  "hard-delete-competition",
  // Deletes specific caller-named keys (own-content flows). Single-object.
  "s3-delete",
]);

const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Every function whose code can bulk-delete from the object store. */
function bulkDeleters(): { name: string; code: string }[] {
  const out: { name: string; code: string }[] = [];
  for (const entry of readdirSync(FN_DIR)) {
    const idx = join(FN_DIR, entry, "index.ts");
    if (!statSync(join(FN_DIR, entry)).isDirectory() || !existsSync(idx)) continue;
    const code = strip(readFileSync(idx, "utf8"));
    // Batch-delete signature: the S3 multi-object delete, or the shared helper.
    if (/deleteS3Objects\s*\(|deleteS3Keys\s*\(|\?delete=/.test(code)) {
      out.push({ name: entry, code });
    }
  }
  return out;
}

describe("every bulk-delete-capable function implements the Deletion Protocol", () => {
  it("finds at least one bulk deleter (guards a vacuous pass)", () => {
    // If detection matches nothing, every assertion below iterates an empty
    // list and the protocol is 'enforced' on nobody.
    expect(bulkDeleters().length).toBeGreaterThan(0);
  });

  it("purge-s3-orphans is detected as a bulk deleter (guards detection drift)", () => {
    expect(bulkDeleters().map((f) => f.name)).toContain("purge-s3-orphans");
  });

  for (const { name, code } of bulkDeleters()) {
    if (TARGETED_EXEMPT.has(name)) continue;

    describe(`${name}`, () => {
      it("defaults to dry-run", () => {
        expect(
          /dryRun\s*=\s*true|dry_run\s*=\s*true/.test(code),
          `${name}: dry_run must default to true — execution is the explicit path.`,
        ).toBe(true);
      });

      it("has a maximum-deletion threshold with a hard ceiling", () => {
        expect(
          /MAX_DELETE/.test(code),
          `${name}: no deletion threshold. One bad run may delete an unbounded ` +
            `number of objects.`,
        ).toBe(true);
        expect(
          /HARD_MAX_DELETE/.test(code),
          `${name}: the caller-supplied cap has no hard ceiling — a typo in the ` +
            `request body can raise it arbitrarily.`,
        ).toBe(true);
      });

      it("requires expected_count at execution time", () => {
        expect(
          /expected_count/.test(code),
          `${name}: execution does not require the operator to state the count ` +
            `from a prior dry run. Stale information deletes fresh files.`,
        ).toBe(true);
      });

      it("reads its live-id / reference set fail-loud and paginated", () => {
        // The exact defect that was live: destructure data, ignore error.
        const badShape = /const\s*\{\s*data\s*:\s*\w+\s*\}\s*=\s*await\s+\w+Client\s*\.from\([^)]+\)\.select\("id"\);/;
        expect(
          badShape.test(code),
          `${name}: a live-id select ignores its error — a transient DB failure ` +
            `becomes an empty live set, which classifies everything as an orphan.`,
        ).toBe(false);
        expect(
          /\.range\(/.test(code),
          `${name}: live-id reads are un-paginated. PostgREST truncates un-ranged ` +
            `selects, and every row past the cap becomes a deleted folder.`,
        ).toBe(true);
        expect(
          /liveIds\.size\s*===\s*0/.test(code),
          `${name}: no empty-set refusal. An implausibly empty live-id set means ` +
            `a broken read or the wrong project — deleting on it is the near-miss ` +
            `with a worse ending.`,
        ).toBe(true);
      });

      it("verifies the store after deleting", () => {
        expect(
          /post_delete_verification|residue/.test(code),
          `${name}: nothing checks the store after the delete. A half-failed ` +
            `batch leaves an unknown state reported as success.`,
        ).toBe(true);
      });
    });
  }

  it("the shared batch-delete helper is fail-loud", () => {
    const shared = strip(readFileSync(join(FN_DIR, "_shared/s3.ts"), "utf8"));
    expect(
      /throw new Error\(\s*`S3 batch delete failed/.test(shared),
      "_shared/s3.ts deleteS3Objects swallows batch failures. A deletion job " +
        "that half-succeeds silently reports a fabricated total.",
    ).toBe(true);
  });

  it("the exemption list only names functions that actually exist", () => {
    // A stale exemption is a future bulk deleter silently skipping the rules.
    for (const name of TARGETED_EXEMPT) {
      expect(
        existsSync(join(FN_DIR, name, "index.ts")),
        `${name} is exempted but does not exist — remove it from TARGETED_EXEMPT.`,
      ).toBe(true);
    }
  });
});
