/**
 * rpc-consensus-vocabulary.spec.ts — Phase 6 / Finding F7 parity guard.
 *
 * Asserts that EVERY `status` value emitted by `get_per_photo_consensus`
 * and `get_per_photo_placement` belongs to the allowed RPC vocabulary:
 *
 *   ALLOWED = PARTICIPANT_LABELS keys (16 Frozen Contract v3 stage_keys)
 *           ∪ { "pending_consensus" }            // sentinel: no consensus / pre-publish
 *           ∪ { "r1_needs_review" }              // R1-only NR (not in PARTICIPANT_LABELS)
 *           ∪ { "winner", "finalist" }           // R4 back-compat aliases still emitted by consensus RPC
 *
 * 16 + 2 + 2 = 20 total. Anything else is a vocabulary contract violation.
 *
 * The fixture below is hand-curated to mirror EVERY status the live RPCs
 * return as of 2026-05-02 (verified via DISTINCT query against prod).
 * If a future RPC change adds a new status key, this test fails until
 * either:
 *   (a) the new key is added to PARTICIPANT_LABELS + STAGE_CATALOG, OR
 *   (b) the key is explicitly added to ALLOWED_EXTRAS below with a comment.
 *
 * Live drift (a status appears in the DB that is NOT in this fixture) is
 * caught by `scripts/audits/rpc_contract_parity.mjs` in CI.
 */
import { describe, it, expect } from "vitest";
import { PARTICIPANT_LABELS } from "@/lib/judging/participantWording";

/** Sentinels emitted by the consensus or placement RPC but intentionally
 *  NOT in PARTICIPANT_LABELS. Phase 6 closure (2026-05-02) — strict 16+2
 *  contract: dropped 'winner' / 'finalist' R4 legacy aliases from the
 *  consensus RPC's CASE branches (R4 awards are owned exclusively by the
 *  placement RPC). */
const ALLOWED_EXTRAS = new Set<string>([
  "pending_consensus",   // no-consensus / pre-publish sentinel
  "r1_needs_review",     // R1-only NR; UI maps to "Needs Review"
]);

/** Hand-curated fixture mirroring live RPC output as of 2026-05-02
 *  (post Phase-6-closure migration). The consensus RPC now emits exactly
 *  9 keys: 4 R1 canonical + 2 R2 canonical + 2 R3 canonical + the
 *  pending_consensus sentinel. R4 collapses to pending_consensus —
 *  placement RPC owns all R4 award keys. */
const RPC_CONSENSUS_FIXTURE = [
  { status: "pending_consensus" },
  { status: "r1_accepted" },
  { status: "r1_shortlisted_r2" },
  { status: "r1_needs_review" },
  { status: "r1_rejected" },
  { status: "r2_accepted" },
  { status: "r2_qualified_r3" },
  { status: "r3_accepted" },
  { status: "r3_qualified_final" },
];

const RPC_PLACEMENT_FIXTURE = [
  { status: "r4_winner" },
  { status: "r4_runner_up_1" },
  { status: "r4_runner_up_2" },
  { status: "r4_top_50" },
  { status: "r4_top_100" },
  { status: "r4_finalist" },
  { status: "r4_honorary_mention" },
  { status: "r4_special_jury" },
];

function buildAllowed(): Set<string> {
  const s = new Set<string>(Object.keys(PARTICIPANT_LABELS));
  for (const k of ALLOWED_EXTRAS) s.add(k);
  return s;
}

describe("RPC consensus vocabulary contract (Phase 6 / F7 — strict 16+2)", () => {
  const allowed = buildAllowed();

  it("ALLOWED set is exactly 16 + 2 = 18 keys (strict contract)", () => {
    // 16 PARTICIPANT_LABELS + 2 ALLOWED_EXTRAS (pending_consensus,
    // r1_needs_review). The previous 'winner' / 'finalist' R4 aliases
    // were retired by the Phase-6-closure migration on 2026-05-02 —
    // R4 awards are now sourced exclusively from get_per_photo_placement.
    expect(Object.keys(PARTICIPANT_LABELS)).toHaveLength(16);
    expect(ALLOWED_EXTRAS.size).toBe(2);
    expect(allowed.size).toBe(18);
  });

  it("consensus RPC fixture excludes 'winner' and 'finalist' (R4 owned by placement)", () => {
    const consensusKeys = new Set(RPC_CONSENSUS_FIXTURE.map((r) => r.status));
    expect(consensusKeys.has("winner")).toBe(false);
    expect(consensusKeys.has("finalist")).toBe(false);
  });

  it("every consensus RPC fixture status is in ALLOWED", () => {
    for (const row of RPC_CONSENSUS_FIXTURE) {
      expect(
        allowed.has(row.status),
        `consensus RPC emitted unknown status '${row.status}' — add to PARTICIPANT_LABELS or ALLOWED_EXTRAS`,
      ).toBe(true);
    }
  });

  it("every placement RPC fixture status is in ALLOWED", () => {
    for (const row of RPC_PLACEMENT_FIXTURE) {
      expect(
        allowed.has(row.status),
        `placement RPC emitted unknown status '${row.status}' — add to PARTICIPANT_LABELS or ALLOWED_EXTRAS`,
      ).toBe(true);
    }
  });

  it("no ALLOWED_EXTRAS key shadows a PARTICIPANT_LABELS key", () => {
    for (const k of ALLOWED_EXTRAS) {
      expect(
        PARTICIPANT_LABELS[k],
        `'${k}' is in ALLOWED_EXTRAS but also in PARTICIPANT_LABELS — pick one`,
      ).toBeUndefined();
    }
  });
});
