import { useUserRoles } from "@/hooks/profile/useUserRoles";

/**
 * Single source of truth for "should this viewer bypass the judging watermark?"
 *
 * Policy (locked 2026-04-18):
 *   ┌──────────────────────────┬──────────────┐
 *   │ Viewer                   │ Watermark?   │
 *   ├──────────────────────────┼──────────────┤
 *   │ Public / regular user    │ ✅ YES       │
 *   │ Entry owner              │ ✅ YES       │
 *   │ Judge (any competition)  │ ❌ NO bypass │
 *   │ Admin                    │ ❌ NO bypass │
 *   └──────────────────────────┴──────────────┘
 *
 * Rationale: judges and admins must evaluate/moderate clean, unobstructed
 * imagery. The watermark exists to deter public leaks/screenshots during the
 * judging phase — not to obstruct workflow for the people doing the judging.
 *
 * Implementation notes:
 *   - Reuses `useUserRoles()` which already fetches all roles in a single
 *     React-Query-cached request (5 min staleTime, shared across the app).
 *     No additional network cost.
 *   - Judge scope is GLOBAL (any user with the `judge` role), per locked
 *     policy. Future tightening to per-competition assignment would happen
 *     here only — call sites do NOT need to change.
 *   - While roles are loading we return `false` (do NOT bypass). This is
 *     the safe default: a brief watermark flash for an authorised viewer is
 *     acceptable; an unauthorised leak is not.
 */
export function useCanBypassWatermark(): {
  canBypass: boolean;
  loading: boolean;
} {
  const { hasRole, loading } = useUserRoles();

  const canBypass = !loading && (hasRole("admin") || hasRole("judge"));

  return { canBypass, loading };
}
