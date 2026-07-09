/**
 * _shared/stageCatalog.ts — server-side mirror of `v3_stage_catalog`.
 *
 * Plan Phase 4 / Task 4.1 (16-Key Frozen Contract v3) — 2026-05-01.
 *
 * Used by edge fns that need:
 *   - Catalog row lookup by stage_key (e.g. complete-round, submit-judge-decision)
 *   - Validation that a candidate stage_key is currently active
 *   - Round 4 award label/decision_token resolution
 *
 * Loads the catalog ONCE per cold start and caches it in-process. Callers
 * pass an admin (service-role) client. If the live DB query fails the
 * fallback constants below ship with byte-identical labels to the contract,
 * so a transient DB hiccup never bricks judging.
 *
 * IMPORTANT: this file contains ONLY type/structure mirrors and pass-through
 * lookups. The byte-identical contract labels live in
 * `src/lib/judging/participantWording.ts` (client) and the DB; this file is
 * the *server* mirror.
 */

export interface CatalogRow {
  stage_key: string;
  round_number: 1 | 2 | 3 | 4;
  family: string;
  decision_token: string;
  tag_label_canonical: string;
  cert_eligible: boolean;
  is_active: boolean;
}

/**
 * Hardcoded fallback — byte-identical to the live DB after Phase 1
 * catalog resync. Used iff the DB query fails. 16 active rows.
 */
const FALLBACK_ACTIVE: ReadonlyArray<CatalogRow> = [
  // R1
  { stage_key: "r1_accepted",            round_number: 1, family: "progression_pass", decision_token: "accept",             tag_label_canonical: "Accepted",                       cert_eligible: true,  is_active: true },
  { stage_key: "r1_shortlisted_r2",      round_number: 1, family: "progression_pass", decision_token: "shortlist",          tag_label_canonical: "Qualified for Round 2",          cert_eligible: true,  is_active: true },
  { stage_key: "r1_needs_verification",  round_number: 1, family: "verification",     decision_token: "needs_verification", tag_label_canonical: "Verification Required",         cert_eligible: false, is_active: true },
  { stage_key: "r1_rejected",            round_number: 1, family: "rejection",        decision_token: "reject",             tag_label_canonical: "Rejected",                       cert_eligible: false, is_active: true },
  // R2
  { stage_key: "r2_accepted",            round_number: 2, family: "progression_pass", decision_token: "accept",             tag_label_canonical: "Accepted in Round 2",            cert_eligible: true,  is_active: true },
  { stage_key: "r2_qualified_r3",        round_number: 2, family: "progression_pass", decision_token: "qualified_r3",       tag_label_canonical: "Qualified for Round 3",          cert_eligible: true,  is_active: true },
  // R3
  { stage_key: "r3_accepted",            round_number: 3, family: "progression_pass", decision_token: "accept",             tag_label_canonical: "Accepted in Round 3",            cert_eligible: true,  is_active: true },
  { stage_key: "r3_qualified_final",     round_number: 3, family: "progression_pass", decision_token: "qualified_final",    tag_label_canonical: "Qualified for Final Round",      cert_eligible: true,  is_active: true },
  // R4 (8 awards)
  { stage_key: "r4_winner",              round_number: 4, family: "award",            decision_token: "winner",             tag_label_canonical: "Winner",                         cert_eligible: true,  is_active: true },
  { stage_key: "r4_runner_up_1",         round_number: 4, family: "award",            decision_token: "runner_up_1",        tag_label_canonical: "1st Runner-Up",                  cert_eligible: true,  is_active: true },
  { stage_key: "r4_runner_up_2",         round_number: 4, family: "award",            decision_token: "runner_up_2",        tag_label_canonical: "2nd Runner-Up",                  cert_eligible: true,  is_active: true },
  { stage_key: "r4_honorary_mention",    round_number: 4, family: "award",            decision_token: "honorary_mention",   tag_label_canonical: "Honorary Mention",               cert_eligible: true,  is_active: true },
  { stage_key: "r4_special_jury",        round_number: 4, family: "award",            decision_token: "special_jury",       tag_label_canonical: "Special Jury Award",             cert_eligible: true,  is_active: true },
  { stage_key: "r4_top_50",              round_number: 4, family: "award",            decision_token: "top_50",             tag_label_canonical: "Top 50 Global Photographer",     cert_eligible: true,  is_active: true },
  { stage_key: "r4_top_100",             round_number: 4, family: "award",            decision_token: "top_100",            tag_label_canonical: "Top 100 Global Photographer",    cert_eligible: true,  is_active: true },
  { stage_key: "r4_finalist",            round_number: 4, family: "award",            decision_token: "finalist_only",      tag_label_canonical: "Qualified for Final",            cert_eligible: true,  is_active: true },
] as const;

/**
 * Sync, dependency-free byte-identical lookup of the v3 contract label.
 *
 * Plan Phase 6 / Task 6.1 — used by React Email templates rendered inside
 * `process-email-queue`. The dispatcher renders synchronously, so we cannot
 * `await loadActiveStageCatalog()` from inside a template component.
 * `LABEL_BY_STAGE_KEY` is sourced from the same FALLBACK_ACTIVE constant
 * that the runtime cache falls back to, so templates always render the
 * frozen-contract wording even if the DB is unreachable.
 *
 * Templates SHOULD prefer this helper over hardcoded English strings.
 */
export const LABEL_BY_STAGE_KEY: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(FALLBACK_ACTIVE.map((r) => [r.stage_key, r.tag_label_canonical])),
);

const PARTICIPANT_LABEL_BY_STAGE_KEY: Readonly<Record<string, string>> = Object.freeze({
  r2_accepted: 'Qualified for Round 2',
  r2_qualified_r3: 'Shortlisted for Round 3',
  r3_accepted: 'Qualified for Round 3',
  r3_qualified_final: 'Shortlisted for Final Round',
});

export function labelForStageKey(stage_key: string | null | undefined): string | null {
  if (!stage_key) return null;
  return PARTICIPANT_LABEL_BY_STAGE_KEY[stage_key] ?? LABEL_BY_STAGE_KEY[stage_key] ?? null;
}

let _cache: ReadonlyArray<CatalogRow> | null = null;
let _cacheAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

/** Force-clear the cache (test hook). */
export function _resetCatalogCache(): void {
  _cache = null;
  _cacheAt = 0;
}

/**
 * Loads the active catalog from the live DB (or returns the cached copy).
 * On any error returns the fallback. Always returns AT LEAST the fallback.
 */
export async function loadActiveStageCatalog(admin: any): Promise<ReadonlyArray<CatalogRow>> {
  const now = Date.now();
  if (_cache && now - _cacheAt < CACHE_TTL_MS) return _cache;

  try {
    const { data, error } = await admin
      .from("v3_stage_catalog")
      .select("stage_key, round_number, family, decision_token, tag_label_canonical, cert_eligible, is_active")
      .eq("is_active", true);
    if (error || !Array.isArray(data) || data.length === 0) {
      console.warn("[stageCatalog] DB query empty/failed — using fallback", error?.message);
      _cache = FALLBACK_ACTIVE;
    } else {
      _cache = data as CatalogRow[];
    }
  } catch (e) {
    console.error("[stageCatalog] DB query threw — using fallback", e);
    _cache = FALLBACK_ACTIVE;
  }
  _cacheAt = now;
  return _cache;
}

/** Lookup an active stage by stage_key. Returns undefined if unknown/inactive. */
export async function getStageByKey(admin: any, stage_key: string): Promise<CatalogRow | undefined> {
  const cat = await loadActiveStageCatalog(admin);
  return cat.find((r) => r.stage_key === stage_key);
}

/** Returns the canonical participant-facing label for an active stage_key. */
export async function getStageLabel(admin: any, stage_key: string): Promise<string | null> {
  const row = await getStageByKey(admin, stage_key);
  return row?.tag_label_canonical ?? null;
}

/** True if `stage_key` is in the active catalog. */
export async function isActiveStageKey(admin: any, stage_key: string): Promise<boolean> {
  return (await getStageByKey(admin, stage_key)) !== undefined;
}
