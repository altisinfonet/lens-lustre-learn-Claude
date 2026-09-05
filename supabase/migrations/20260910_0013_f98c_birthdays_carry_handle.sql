-- ═══════════════════════════════════════════════════════════════════════════
-- F-98c — THE BIRTHDAY NAMES CARRY THEIR HANDLE.
--
-- WHAT WAS WRONG. `get_todays_birthdays` returns the people whose birthday is
-- today, and 20260804160000_todays_birthdays_rpc.sql declared it
--
--     RETURNS TABLE (id uuid, full_name text, avatar_url text)
--
-- so every birthday name in the sidebar reached the browser with no address
-- attached and was rendered as dead text. This is one of six sources found by
-- the auditor on 2026-09-05; the other five are all in
-- supabase/functions/dashboard-init/index.ts and are select lists and object
-- literals. This one is the only one that is a function signature.
--
-- WHY THIS IS A DROP AND NOT A `CREATE OR REPLACE`. Postgres refuses to change
-- the return type of an existing function: adding a column to RETURNS TABLE is
-- exactly that. CREATE OR REPLACE fails with "cannot change return type of
-- existing function". The original migration is already applied and must not be
-- rewritten, so the drop and the recreate live here, in a new file.
--
-- WHY THIS IS SAFE TO APPLY BEFORE THE EDGE FUNCTION IS REDEPLOYED. The only
-- caller is dashboard-init, which does
--     admin.rpc("get_todays_birthdays", { _viewer: targetUserId })
-- and spreads whole rows into the response. An EXTRA column is ignored by the
-- currently deployed version and consumed by the next one, so the two orders of
-- deployment are both correct and there is no window in which the sidebar
-- breaks. The DROP and the CREATE are in one transaction — a migration is
-- wrapped in one — so no caller can observe the gap between them.
--
-- WHAT IS DELIBERATELY UNCHANGED. Everything else, to the character: the
-- privacy predicate on privacy_settings->>'dob_day_month' with its 'friends'
-- default, the friendship EXISTS clause, the UTC day boundary, the absence of a
-- row limit, ORDER BY p.full_name NULLS LAST, STABLE, SECURITY DEFINER, the
-- search_path pin, and the grants. The auditor's instruction was select lists
-- and object literals only, and the spirit of it holds here: this migration
-- adds one column to a projection and changes no logic, no limit and no
-- security boundary.
--
-- LANE. supabase/** is D1's. This is an AUDITOR-GRANTED CROSS-LANE EXCEPTION,
-- given by the Auditor on 2026-09-05 with D1 idle and the fix one column wide,
-- scoped to dashboard-init/index.ts and this RPC and nothing else under
-- supabase/. Flagged for D1 to review before promotion to main.
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.get_todays_birthdays(uuid);

CREATE FUNCTION public.get_todays_birthdays(_viewer uuid)
RETURNS TABLE (id uuid, full_name text, avatar_url text, custom_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.id, p.full_name, p.avatar_url, p.custom_url
  FROM public.profiles p
  WHERE p.is_suspended = false
    AND p.date_of_birth IS NOT NULL
    AND to_char(p.date_of_birth, 'MM-DD') = to_char(now(), 'MM-DD')
    AND (
      -- You always see your own.
      p.id = _viewer
      -- Explicitly public.
      OR COALESCE(NULLIF(p.privacy_settings->>'dob_day_month', ''), 'friends') = 'public'
      -- Friends-only (and the DEFAULT, because that is what Edit Profile shows
      -- a member who has never touched the control).
      OR (
        COALESCE(NULLIF(p.privacy_settings->>'dob_day_month', ''), 'friends') = 'friends'
        AND EXISTS (
          SELECT 1 FROM public.friendships f
          WHERE f.status = 'accepted'
            AND (
              (f.requester_id = _viewer AND f.addressee_id = p.id)
              OR (f.addressee_id = _viewer AND f.requester_id = p.id)
            )
        )
      )
      -- 'only_me' falls through to nothing, which is the point.
    )
  ORDER BY p.full_name NULLS LAST;
$$;

COMMENT ON FUNCTION public.get_todays_birthdays(uuid) IS
  'Members whose birthday is today, filtered by their own privacy_settings->>''dob_day_month'' (default: friends). No row limit — replaces a LIMIT 50 in dashboard-init that hid 28 of 68 members. Returns custom_url (F-98c) so the name can be a link.';

-- Grants are NOT inherited by a recreated function. Restated verbatim from
-- 20260804160000_todays_birthdays_rpc.sql: anonymous callers must never receive
-- PII-derived data, and dashboard-init returns an empty array for them, so this
-- keeps that true at the DB edge too. Dropping the function without restoring
-- these would silently GRANT EXECUTE TO PUBLIC by default — which is why they
-- are here and not left to be remembered.
REVOKE ALL ON FUNCTION public.get_todays_birthdays(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_todays_birthdays(uuid) TO service_role;
