/**
 * resolveStageKey — strict, deterministic mapping from
 * (round_number, decision_token) → canonical `stage_key`.
 *
 * Master Fix Plan — Phase 1 (Stage-Key Enforcement).
 *
 * Source of truth: `STAGE_CATALOG` in `./stageCatalog.ts`. We never invent or
 * fall back to a guessed stage_key — unknown combinations throw a typed
 * `StageKeyResolutionError` so calling code is forced to handle the gap
 * explicitly instead of silently producing wrong UI buckets / cache entries.
 *
 * USAGE:
 *   const stageKey = resolveStageKey(2, "qualified_r3");   // "r2_qualified_r3"
 *   const safe     = tryResolveStageKey(2, "qualified_r3"); // string | null
 *
 * NOTE: This module is **lookup only** — it does NOT write to the DB, mutate
 * the catalog, or perform alias normalization. Alias normalization (e.g.
 * "Reject" → "reject") belongs in the dedicated mappers
 * (`tagLabelToDecision`, `normalizeDecisionRow`).
 */

import { STAGE_CATALOG, type DecisionToken, type StageCatalogEntry } from "./stageCatalog";

export type RoundNumber = 1 | 2 | 3 | 4;

export class StageKeyResolutionError extends Error {
  readonly round_number: number | null;
  readonly decision_token: string | null;
  constructor(message: string, ctx: { round_number: number | null; decision_token: string | null }) {
    super(message);
    this.name = "StageKeyResolutionError";
    this.round_number = ctx.round_number;
    this.decision_token = ctx.decision_token;
  }
}

/**
 * Build (round_number, decision_token) → StageCatalogEntry index from the
 * **active** catalog rows only. Retired rows are intentionally excluded so
 * they can never resurface via this resolver.
 *
 * If a future catalog migration ever introduces a duplicate (round, token),
 * the build-time `assertResolverParity` IIFE below throws at module load —
 * we never want this resolver to silently pick "the first one found".
 */
const RESOLVER_INDEX: ReadonlyMap<string, StageCatalogEntry> = (() => {
  const m = new Map<string, StageCatalogEntry>();
  for (const row of STAGE_CATALOG) {
    if (!row.is_active) continue;
    const key = `${row.round_number}::${row.decision_token}`;
    const dup = m.get(key);
    if (dup) {
      throw new Error(
        `[resolveStageKey] duplicate (round=${row.round_number}, token='${row.decision_token}') in STAGE_CATALOG: '${dup.stage_key}' vs '${row.stage_key}'`,
      );
    }
    m.set(key, row);
  }
  return m;
})();

function indexKey(round: number, token: string): string {
  return `${round}::${token}`;
}

/**
 * Strict resolver. Throws `StageKeyResolutionError` for unknown combinations.
 * Use this in code paths where an unknown stage_key represents a contract
 * violation (e.g. server response, edge fn payload, trigger output).
 */
export function resolveStageKey(round_number: RoundNumber | number, decision_token: DecisionToken | string): string {
  const r = Number(round_number);
  const t = String(decision_token || "").trim();
  if (!Number.isInteger(r) || r < 1 || r > 4) {
    throw new StageKeyResolutionError(
      `resolveStageKey: invalid round_number '${round_number}' (expected 1..4)`,
      { round_number: Number.isFinite(r) ? r : null, decision_token: t || null },
    );
  }
  if (!t) {
    throw new StageKeyResolutionError(
      `resolveStageKey: empty decision_token for round ${r}`,
      { round_number: r, decision_token: null },
    );
  }
  const hit = RESOLVER_INDEX.get(indexKey(r, t));
  if (!hit) {
    throw new StageKeyResolutionError(
      `resolveStageKey: no active stage_key for (round=${r}, decision_token='${t}')`,
      { round_number: r, decision_token: t },
    );
  }
  return hit.stage_key;
}

/**
 * Soft resolver. Returns `null` instead of throwing — use ONLY in display
 * paths where an unknown decision should fall back to a generic bucket
 * (e.g. judge-side optimistic update before catalog cache warms).
 *
 * **DO NOT** use this in cache invalidation, edge fn input validation, or
 * progression writes — those must use `resolveStageKey` so a contract
 * violation surfaces immediately.
 */
export function tryResolveStageKey(
  round_number: RoundNumber | number | null | undefined,
  decision_token: DecisionToken | string | null | undefined,
): string | null {
  if (round_number == null || decision_token == null) return null;
  const r = Number(round_number);
  const t = String(decision_token).trim();
  if (!Number.isInteger(r) || r < 1 || r > 4 || !t) return null;
  return RESOLVER_INDEX.get(indexKey(r, t))?.stage_key ?? null;
}

/**
 * Reverse helper — returns the catalog entry for a stage_key, or null.
 * Identical to `getStageByKey` but limited to ACTIVE rows so retired keys
 * cannot leak into Phase 1 enforcement paths.
 */
export function getActiveStageByKey(stage_key: string | null | undefined): StageCatalogEntry | null {
  if (!stage_key) return null;
  for (const row of STAGE_CATALOG) {
    if (row.stage_key === stage_key && row.is_active) return row;
  }
  return null;
}

/**
 * Build-time invariant: every active catalog row MUST be resolvable via
 * (round_number, decision_token). Throws at module load if drift is detected.
 */
(function assertResolverParity(): void {
  for (const row of STAGE_CATALOG) {
    if (!row.is_active) continue;
    const got = RESOLVER_INDEX.get(indexKey(row.round_number, row.decision_token));
    if (!got || got.stage_key !== row.stage_key) {
      throw new Error(
        `[resolveStageKey] parity drift: active catalog row '${row.stage_key}' not resolvable via (${row.round_number}, '${row.decision_token}')`,
      );
    }
  }
})();
