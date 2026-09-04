/**
 * P31 · Telling "this search is closed" apart from "no certificate matched".
 *
 * VerifyCertificate.tsx used to collapse both into one branch:
 *
 *     if (error || !data || data.length === 0) setNotFound(true);
 *
 * On the day anon's EXECUTE on search_certificates is revoked, that branch
 * tells a member holding a REAL certificate that no certificate matched.
 * That reads as a forgery, and nobody reports a forgery — they quietly stop
 * trusting us. A silent wrong answer is worse than an error.
 *
 * WHY TWO CODES AND NOT ONE — both are reachable and they are not the same
 * failure:
 *
 *   42501   PostgREST reached the function and Postgres refused the caller
 *           (insufficient_privilege).
 *   PGRST202 PostgREST's schema cache no longer lists the function for this
 *           role, so the call never reaches Postgres at all.
 *
 * Which one a caller gets depends on whether the schema cache has reloaded
 * since the revoke. Handling only 42501 would leave the original defect live
 * for the whole window the other one covers.
 *
 * The message fallback is a deliberate last resort for a proxy that strips the
 * code. Codes are the contract; prose is not — so prose is checked last and
 * only for the one phrase Postgres itself emits.
 *
 * SCOPE, stated so it is not assumed away: this predicate answers exactly one
 * question — "was this refusal a withdrawn grant?" It is deliberately false
 * for transport failures ("Failed to fetch") and for PGRST116 (zero rows from
 * a single-row read), because neither is a withdrawn grant.
 *
 * The P31 revoke migration is NOT yet written and is D1's lane, so this file
 * names the unit rather than guessing a filename. (F-75: the earlier draft of
 * this comment cited 20260910_0001_revoke_public_search_certificates.sql; that
 * number is already taken by P30's email_exists revoke, and two migrations
 * cannot share it.)
 *
 * WHY ITS OWN MODULE — eslint react-refresh/only-export-components forbids a
 * page file from exporting a non-component, and a control that can only be
 * exercised through a full page render is a control that stops being run.
 */

/** The shape supabase-js hands back on `{ data, error }`; all fields optional
 *  because a stripping proxy is exactly the case the fallback exists for. */
export interface SearchRpcError {
  code?: string | null;
  message?: string | null;
}

/** Postgres insufficient_privilege — the function ran and refused the caller. */
const PG_INSUFFICIENT_PRIVILEGE = "42501";

/** PostgREST: no such function in the schema cache for this role. */
const PGRST_FUNCTION_NOT_EXPOSED = "PGRST202";

/**
 * True only when the lookup failed because the caller's grant was withdrawn.
 *
 * Returns false for null/undefined, non-objects, transport failures and
 * PGRST116 — a caller must not show "search unavailable" for those.
 */
export function isSearchUnavailableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const { code, message } = error as SearchRpcError;

  if (code === PG_INSUFFICIENT_PRIVILEGE) return true;
  if (code === PGRST_FUNCTION_NOT_EXPOSED) return true;

  // Last resort only — a proxy that dropped the code. Postgres emits this
  // exact phrase for 42501 ("permission denied for function ...").
  if (typeof message === "string" && message.toLowerCase().includes("permission denied")) {
    return true;
  }

  return false;
}
