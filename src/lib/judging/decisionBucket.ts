/**
 * decisionBucket — Master Fix Plan Phase 2 (Status-Mapper Unification).
 *
 * Single source of truth for mapping a `(round_number, decision_token)`
 * tuple to one or more UI sidebar/aggregation buckets.
 *
 * BUG-02 (R2 saved rows counted under `shortlist` but not `qualified_r3`)
 * is rooted in inline mappers that disagreed about whether a Round 2
 * `qualified_r3` decision belongs to the "qualified" bucket only, the
 * "shortlisted" bucket only, or both. This module returns an EXPLICIT,
 * ordered list of buckets so every consumer aggregates the same way.
 *
 * RULES:
 *   1. Resolution goes through STAGE_CATALOG (`resolveStageKey`). Unknown
 *      tuples in STRICT mode throw — no silent fallback.
 *   2. The bucket list ALWAYS includes the most specific bucket first
 *      (e.g. "qualified_r3"), followed by any broader buckets the row
 *      should also count under (e.g. "shortlisted" — because a R2
 *      qualified_r3 row IS a "qualified for next round" outcome).
 *   3. Pure display paths may use `tryDecisionBuckets` for soft fallback.
 *
 * This module is read-only — it never writes to the catalog or DB.
 */

import {
  resolveStageKey,
  tryResolveStageKey,
  getActiveStageByKey,
  StageKeyResolutionError,
} from "./resolveStageKey";
import type { SidebarView } from "@/hooks/judging/types";

/** Subset of SidebarView used by the aggregator. Kept loose to permit award keys. */
export type DecisionBucket = SidebarView | string;

/**
 * Explicit (round, decision_token) → ordered bucket list.
 *
 * The first entry is the MOST SPECIFIC bucket (used as the "primary"
 * bucket for sidebar counts). Any subsequent entries are broader buckets
 * the row should also be counted under (e.g. R2 `qualified_r3` also
 * counts as a "shortlisted" progression outcome — fixing BUG-02).
 *
 * Keys are `${round_number}::${decision_token}`.
 */
const BUCKETS_BY_ROUND_DECISION: Readonly<Record<string, ReadonlyArray<DecisionBucket>>> = Object.freeze({
  // ─── Round 1 ─────────────────────────────────────────────────────────
  "1::accept":             ["accepted"],
  "1::shortlist":          ["shortlisted"],
  "1::needs_verification": ["needs_review"],
  "1::reject":             ["rejected"],

  // ─── Round 2 ─────────────────────────────────────────────────────────
  // R2 accept = "Accepted in Round 2" (stays at this round, no progression)
  "2::accept":             ["accepted"],
  // R2 qualified_r3 = qualified-for-next AND counts under shortlisted bucket.
  // BUG-02 FIX: aggregators that filter by "shortlisted" must include this row.
  "2::qualified_r3":       ["qualified", "shortlisted"],

  // ─── Round 3 ─────────────────────────────────────────────────────────
  "3::accept":             ["accepted"],
  // R3 qualified_final advances to R4. Counts as both "finalist" and "shortlisted".
  "3::qualified_final":    ["finalist", "shortlisted"],

  // ─── Round 4 (awards) ────────────────────────────────────────────────
  "4::winner":             ["winner"],
  "4::runner_up_1":        ["runner_up_1"],
  "4::runner_up_2":        ["runner_up_2"],
  "4::honorary_mention":   ["honorary_mention"],
  "4::special_jury":       ["special_jury"],
  "4::top_50":             ["shortlisted"],
  "4::top_100":            ["shortlisted"],
  "4::finalist_only":      ["finalist"],
});

function indexKey(round: number, token: string): string {
  return `${round}::${token}`;
}

/**
 * STRICT bucket resolver. Throws `StageKeyResolutionError` for unknown
 * (round, decision_token) tuples — use in aggregation/admin paths where
 * a missing mapping is a contract violation.
 *
 * Always returns at least one bucket. The first element is the primary
 * (most-specific) bucket; subsequent elements are broader buckets the
 * row should also count under.
 */
export function decisionBuckets(
  round_number: number,
  decision_token: string,
): ReadonlyArray<DecisionBucket> {
  // Force catalog validation first — guarantees the row is a known active stage.
  resolveStageKey(round_number, decision_token);
  const hit = BUCKETS_BY_ROUND_DECISION[indexKey(Number(round_number), String(decision_token).trim())];
  if (!hit || hit.length === 0) {
    throw new StageKeyResolutionError(
      `decisionBuckets: catalog row exists but no bucket mapping for (round=${round_number}, decision_token='${decision_token}')`,
      { round_number: Number(round_number), decision_token: String(decision_token) },
    );
  }
  return hit;
}

/** Soft variant — returns `null` instead of throwing. UI display only. */
export function tryDecisionBuckets(
  round_number: number | null | undefined,
  decision_token: string | null | undefined,
): ReadonlyArray<DecisionBucket> | null {
  const stage_key = tryResolveStageKey(round_number, decision_token);
  if (!stage_key) return null;
  const hit = BUCKETS_BY_ROUND_DECISION[indexKey(Number(round_number), String(decision_token).trim())];
  return hit && hit.length > 0 ? hit : null;
}

/** Convenience: primary (most-specific) bucket only, or null in soft mode. */
export function primaryDecisionBucket(
  round_number: number | null | undefined,
  decision_token: string | null | undefined,
): DecisionBucket | null {
  const list = tryDecisionBuckets(round_number, decision_token);
  return list ? list[0] : null;
}

/**
 * Resolve buckets directly from a stage_key (e.g. when the row was
 * already normalized through `normalizeDecisionRow`). Returns null in
 * soft mode if the stage_key is unknown/inactive.
 */
export function bucketsForStageKey(stage_key: string | null | undefined): ReadonlyArray<DecisionBucket> | null {
  const row = getActiveStageByKey(stage_key);
  if (!row) return null;
  return tryDecisionBuckets(row.round_number, row.decision_token);
}

/** Build-time invariant: every active catalog row MUST have a bucket mapping. */
import { STAGE_CATALOG } from "./stageCatalog";
(function assertBucketParity(): void {
  for (const row of STAGE_CATALOG) {
    if (!row.is_active) continue;
    const hit = BUCKETS_BY_ROUND_DECISION[indexKey(row.round_number, row.decision_token)];
    if (!hit || hit.length === 0) {
      throw new Error(
        `[decisionBucket] missing bucket mapping for active stage '${row.stage_key}' (round=${row.round_number}, decision_token='${row.decision_token}')`,
      );
    }
  }
})();

export { StageKeyResolutionError };
