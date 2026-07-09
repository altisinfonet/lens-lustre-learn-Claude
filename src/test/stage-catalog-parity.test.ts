/**
 * Build-time parity guard — Plan Phase 2 / Task 2.3.
 *
 * Asserts that the local TS mirror `STAGE_CATALOG` matches the
 * 16-Key Frozen Contract (v3) snapshot of `v3_stage_catalog` taken
 * on 2026-05-01 (post Phase 1 catalog resync).
 *
 * Also asserts that `PARTICIPANT_LABELS` (Phase 2 / Task 2.2) is
 * byte-identical to the catalog `tag_label_canonical` for every
 * active row.
 *
 * If you legitimately added/removed/edited a catalog row via migration:
 *   1. Update SNAPSHOT_2026_05_01 below.
 *   2. Update STAGE_CATALOG in src/lib/judging/stageCatalog.ts.
 *   3. Update PARTICIPANT_LABELS in src/lib/judging/participantWording.ts.
 *   4. Bump the snapshot date in all three file headers.
 * All four must move together — otherwise this test fails.
 */
import { describe, it, expect } from "vitest";
import { STAGE_CATALOG } from "@/lib/judging/stageCatalog";
import { PARTICIPANT_LABELS } from "@/lib/judging/participantWording";

interface SnapRow {
  stage_key: string;
  round_number: number;
  family: string;
  decision_token: string;
  tag_label_canonical: string;
  cert_eligible: boolean;
}

/** 16 active rows — byte-identical to Judging_Master_Reference_16Keys_v3. */
const SNAPSHOT_2026_05_01: SnapRow[] = [
  // ── Round 1 ──
  { stage_key: "r1_accepted",            round_number: 1, family: "progression_pass", decision_token: "accept",             tag_label_canonical: "Accepted",                       cert_eligible: true  },
  { stage_key: "r1_shortlisted_r2",      round_number: 1, family: "progression_pass", decision_token: "shortlist",          tag_label_canonical: "Qualified for Round 2",          cert_eligible: true  },
  { stage_key: "r1_needs_verification",  round_number: 1, family: "verification",     decision_token: "needs_verification", tag_label_canonical: "Verification Required",         cert_eligible: false },
  { stage_key: "r1_rejected",            round_number: 1, family: "rejection",        decision_token: "reject",             tag_label_canonical: "Rejected",                       cert_eligible: false },
  // ── Round 2 ──
  { stage_key: "r2_accepted",            round_number: 2, family: "progression_pass", decision_token: "accept",             tag_label_canonical: "Accepted in Round 2",            cert_eligible: true  },
  { stage_key: "r2_qualified_r3",        round_number: 2, family: "progression_pass", decision_token: "qualified_r3",       tag_label_canonical: "Qualified for Round 3",          cert_eligible: true  },
  // ── Round 3 ──
  { stage_key: "r3_accepted",            round_number: 3, family: "progression_pass", decision_token: "accept",             tag_label_canonical: "Accepted in Round 3",            cert_eligible: true  },
  { stage_key: "r3_qualified_final",     round_number: 3, family: "progression_pass", decision_token: "qualified_final",    tag_label_canonical: "Qualified for Final Round",      cert_eligible: true  },
  // ── Round 4 (8 awards) ──
  { stage_key: "r4_winner",              round_number: 4, family: "award",            decision_token: "winner",             tag_label_canonical: "Winner",                         cert_eligible: true  },
  { stage_key: "r4_runner_up_1",         round_number: 4, family: "award",            decision_token: "runner_up_1",        tag_label_canonical: "1st Runner-Up",                  cert_eligible: true  },
  { stage_key: "r4_runner_up_2",         round_number: 4, family: "award",            decision_token: "runner_up_2",        tag_label_canonical: "2nd Runner-Up",                  cert_eligible: true  },
  { stage_key: "r4_honorary_mention",    round_number: 4, family: "award",            decision_token: "honorary_mention",   tag_label_canonical: "Honorary Mention",               cert_eligible: true  },
  { stage_key: "r4_special_jury",        round_number: 4, family: "award",            decision_token: "special_jury",       tag_label_canonical: "Special Jury Award",             cert_eligible: true  },
  { stage_key: "r4_top_50",              round_number: 4, family: "award",            decision_token: "top_50",             tag_label_canonical: "Top 50 Global Photographer",     cert_eligible: true  },
  { stage_key: "r4_top_100",             round_number: 4, family: "award",            decision_token: "top_100",            tag_label_canonical: "Top 100 Global Photographer",    cert_eligible: true  },
  { stage_key: "r4_finalist",            round_number: 4, family: "award",            decision_token: "finalist_only",      tag_label_canonical: "Qualified for Final",            cert_eligible: true  },
];

describe("v3_stage_catalog TS↔snapshot parity (Phase 2 / 16-Key Frozen Contract v3)", () => {
  it("has exactly 16 active rows matching the snapshot", () => {
    const active = STAGE_CATALOG.filter((s) => s.is_active);
    expect(active.length).toBe(SNAPSHOT_2026_05_01.length);
    expect(active.length).toBe(16);
  });

  it("matches every snapshot row field-for-field", () => {
    const tsByKey = new Map(STAGE_CATALOG.map((s) => [s.stage_key, s]));
    for (const snap of SNAPSHOT_2026_05_01) {
      const ts = tsByKey.get(snap.stage_key);
      expect(ts, `missing stage_key in TS catalog: ${snap.stage_key}`).toBeDefined();
      if (!ts) continue;
      expect(ts.round_number,        `${snap.stage_key} round_number`).toBe(snap.round_number);
      expect(ts.family,              `${snap.stage_key} family`).toBe(snap.family);
      expect(ts.decision_token,      `${snap.stage_key} decision_token`).toBe(snap.decision_token);
      expect(ts.tag_label_canonical, `${snap.stage_key} tag_label_canonical`).toBe(snap.tag_label_canonical);
      expect(ts.cert_eligible,       `${snap.stage_key} cert_eligible`).toBe(snap.cert_eligible);
      expect(ts.is_active,           `${snap.stage_key} should be active`).toBe(true);
    }
  });

  it("has no extra ACTIVE TS rows not in snapshot", () => {
    const snapKeys = new Set(SNAPSHOT_2026_05_01.map((s) => s.stage_key));
    const extras = STAGE_CATALOG
      .filter((s) => s.is_active && !snapKeys.has(s.stage_key))
      .map((s) => s.stage_key);
    expect(extras, `unexpected ACTIVE stage_keys in TS catalog: ${extras.join(", ")}`).toEqual([]);
  });

  it("has no duplicate stage_keys", () => {
    const seen = new Set<string>();
    for (const s of STAGE_CATALOG) {
      expect(seen.has(s.stage_key), `duplicate stage_key: ${s.stage_key}`).toBe(false);
      seen.add(s.stage_key);
    }
  });

  // Phase 2 / Findings #1+2+3 — R4 Decision Token Collision Lock.
  // Mirrors DB index `v3_stage_catalog_active_round_token_uniq`:
  // within any active round, no two rows may share decision_token.
  it("has no two active rows sharing (round_number, decision_token)", () => {
    const seen = new Map<string, string>();
    for (const s of STAGE_CATALOG) {
      if (!s.is_active) continue;
      const key = `${s.round_number}::${s.decision_token}`;
      const prev = seen.get(key);
      expect(
        prev,
        `decision_token collision in round ${s.round_number}: ${s.stage_key} and ${prev} both use '${s.decision_token}'`,
      ).toBeUndefined();
      seen.set(key, s.stage_key);
    }
  });

  // Phase 2 / Finding #4 — R2/R3 Specific-Shortlist Ratification (Option R-A).
  // The generic `shortlist` decision_token is reserved for R1 only. R2 must use
  // `qualified_r3` and R3 must use `qualified_final`. The legacy
  // `judge_decisions.decision = 'shortlist'` enum stays generic on purpose
  // (it is the cross-round promotion contract consumed by complete-round /
  // publish-round edge fns) — this test guards only the CATALOG side.
  it("reserves the generic 'shortlist' decision_token for Round 1 only", () => {
    const offenders = STAGE_CATALOG
      .filter((s) => s.is_active && s.decision_token === "shortlist" && s.round_number !== 1)
      .map((s) => `${s.stage_key} (round ${s.round_number})`);
    expect(
      offenders,
      `generic 'shortlist' token leaked outside R1: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});

describe("PARTICIPANT_LABELS ↔ STAGE_CATALOG parity (Phase 2 / Task 2.2)", () => {
  it("has exactly 16 entries", () => {
    expect(Object.keys(PARTICIPANT_LABELS).length).toBe(16);
  });

  // Participant labels are intentionally DECOUPLED from tag_label_canonical
  // per final_judging_plan-6_corrected_v2: judges see operational labels
  // (e.g. "Accepted in Round 2"), participants see qualification labels
  // (e.g. "Qualified for Round 2"). Only R2/R3 progression rows differ;
  // every other active row stays byte-identical to the catalog label.
  const PARTICIPANT_LABEL_OVERRIDES: Record<string, string> = {
    r2_accepted:        "Qualified for Round 2",
    r2_qualified_r3:    "Shortlisted for Round 3",
    r3_accepted:        "Qualified for Round 3",
    r3_qualified_final: "Shortlisted for Final Round",
  };

  it("matches expected participant wording for every active row", () => {
    for (const entry of STAGE_CATALOG) {
      if (!entry.is_active) continue;
      const wording = (PARTICIPANT_LABELS as Record<string, string>)[entry.stage_key];
      expect(wording, `missing PARTICIPANT_LABELS for ${entry.stage_key}`).toBeDefined();
      const expected =
        PARTICIPANT_LABEL_OVERRIDES[entry.stage_key] ?? entry.tag_label_canonical;
      expect(wording).toBe(expected);
    }
  });

  it("has no orphan labels without an active catalog row", () => {
    const activeKeys = new Set(
      STAGE_CATALOG.filter((s) => s.is_active).map((s) => s.stage_key),
    );
    const orphans = Object.keys(PARTICIPANT_LABELS).filter((k) => !activeKeys.has(k));
    expect(orphans, `orphan labels: ${orphans.join(", ")}`).toEqual([]);
  });
});
