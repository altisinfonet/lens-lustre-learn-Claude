/**
 * normalizeDecisionRow — Master Fix Plan Phase 1 (Stage-Key Enforcement).
 *
 * Wraps a raw `judge_decisions`-shaped row (or any (round_number,
 * decision_token) tuple coming from the server / consensus RPC / realtime
 * payload) and produces a typed shape that ALWAYS carries a resolved
 * `stage_key` derived from `STAGE_CATALOG`.
 *
 * Why this exists:
 *   - Multiple call sites (usePhotoDecisions, useJudgePhotoData,
 *     submission-detail aggregation) used to compute their own
 *     "round + decision → bucket" mapping inline. Drift between those
 *     copies is the root cause of BUG-02 (R2 saved rows counted under
 *     `shortlist` but not under `qualified_r3`).
 *   - By forcing every consumer through this normalizer, the resolution
 *     rule lives in exactly one place (`resolveStageKey`).
 *
 * STRICT MODE (default):
 *   Throws `StageKeyResolutionError` for unknown (round, decision) tuples.
 *   Use this in code paths that mutate caches, write to the DB, or feed
 *   admin tooling — silent fallbacks are forbidden there.
 *
 * SAFE MODE (`{ strict: false }`):
 *   Returns the row with `stage_key: null` and `stage: null` instead of
 *   throwing. Use ONLY in pure display paths where an unresolvable row
 *   should render as "—" rather than crash the screen.
 *
 * This module is read-only — it never writes to the catalog or DB.
 */

import {
  resolveStageKey,
  tryResolveStageKey,
  getActiveStageByKey,
  StageKeyResolutionError,
} from "./resolveStageKey";
import type { StageCatalogEntry } from "./stageCatalog";

export interface RawDecisionRow {
  round_number: number | null | undefined;
  /**
   * The DB-side `judge_decisions.decision` value OR the catalog
   * `decision_token`. Both share the same vocabulary post-Phase-1
   * (e.g. "accept", "shortlist", "qualified_r3", "qualified_final").
   */
  decision: string | null | undefined;
  // Pass-through fields preserved verbatim on the normalized row.
  judge_id?: string | null;
  entry_id?: string | null;
  photo_index?: number | null;
  [extra: string]: unknown;
}

export interface NormalizedDecisionRow extends RawDecisionRow {
  /** Canonical stage_key from STAGE_CATALOG, or null in safe mode on miss. */
  stage_key: string | null;
  /** Full active catalog entry (cert_eligible, family, label), or null. */
  stage: StageCatalogEntry | null;
}

export interface NormalizeOptions {
  /** Default true. When false, unresolvable rows get stage_key:null instead of throwing. */
  strict?: boolean;
}

export function normalizeDecisionRow(
  row: RawDecisionRow,
  opts: NormalizeOptions = {},
): NormalizedDecisionRow {
  const strict = opts.strict !== false;
  let stage_key: string | null = null;

  if (strict) {
    // resolveStageKey throws StageKeyResolutionError on miss — propagate.
    stage_key = resolveStageKey(row.round_number as number, row.decision as string);
  } else {
    stage_key = tryResolveStageKey(row.round_number, row.decision);
  }

  const stage = stage_key ? getActiveStageByKey(stage_key) : null;
  return { ...row, stage_key, stage };
}

/**
 * Bulk variant. In SAFE mode, unresolvable rows are kept with
 * `stage_key: null`. In STRICT mode, the FIRST unresolvable row throws.
 */
export function normalizeDecisionRows(
  rows: ReadonlyArray<RawDecisionRow>,
  opts: NormalizeOptions = {},
): NormalizedDecisionRow[] {
  const out: NormalizedDecisionRow[] = [];
  for (const r of rows) out.push(normalizeDecisionRow(r, opts));
  return out;
}

export { StageKeyResolutionError };
