-- ═══════════════════════════════════════════════════════════════════════════
-- CLOSE THE MAX-ENTRIES RACE: COUNT-THEN-INSERT BECOMES LOCK-COUNT-INSERT.
--
-- Found during the Competition Engine gate and DEMONSTRATED on the harness
-- with the verbatim production trigger: two concurrent transactions for the
-- same member both counted 0 existing entries and both committed — 2 rows
-- under max_entries_per_user = 1. READ COMMITTED lets both counts run before
-- either insert is visible; a COUNT-based gate is a suggestion under
-- concurrency, not a rule.
--
-- THE FIX: a transaction-scoped advisory lock on (user_id, competition_id)
-- taken BEFORE the count. Two submissions by the same member to the same
-- competition serialize; everyone else is untouched (different members or
-- different competitions hash to different locks). The lock releases at
-- commit/rollback automatically — nothing to clean up, nothing to leak.
--
-- hashtextextended over both uuids gives a 64-bit lock key; collisions across
-- different (member, competition) pairs are possible in principle and cost
-- only needless serialization of two unrelated submissions — never a wrong
-- admission decision, because the count re-runs under the lock either way.
--
-- CREATE OR REPLACE preserves the function's existing ACL; no grant changes.
-- Everything else in the function is byte-identical to production on purpose:
-- one variable per change, and the variable here is the lock.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.enforce_max_entries_per_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _max_entries int;
  _current_count int;
BEGIN
  SELECT max_entries_per_user INTO _max_entries
  FROM public.competitions
  WHERE id = NEW.competition_id;

  IF _max_entries IS NOT NULL THEN
    -- Serialize same-member-same-competition submissions. Taken only when a
    -- limit exists, so unlimited competitions pay nothing.
    PERFORM pg_advisory_xact_lock(
      hashtextextended(NEW.user_id::text || ':' || NEW.competition_id::text, 0)
    );

    SELECT COUNT(*) INTO _current_count
    FROM public.competition_entries
    WHERE user_id = NEW.user_id
      AND competition_id = NEW.competition_id;

    IF _current_count >= _max_entries THEN
      RAISE EXCEPTION 'Entry limit exceeded. Maximum % entries per user allowed.', _max_entries;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
