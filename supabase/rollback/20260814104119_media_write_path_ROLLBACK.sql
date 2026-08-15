-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20260814104119_media_write_path.sql
--
-- ⚠ THIS RESTORES A CONSTRAINT THAT CANNOT BE SATISFIED HONESTLY.
--
-- The forward migration replaced
--     CHECK (state = 'pending' OR verified_at IS NOT NULL)
-- with
--     CHECK (state IN ('pending','quarantined') OR verified_at IS NOT NULL)
-- because quarantine is what happens when hash verification FAILS, and at that
-- moment `verified_at` must legitimately be NULL. Rolling back reinstates the
-- original, so any future quarantine of a never-verified row would have to
-- write a `verified_at` asserting a verification that did not happen.
--
-- Rolling back therefore requires first deciding what to do with any
-- quarantined rows that have no `verified_at`. This file REFUSES rather than
-- guessing — see the assertion below. It does not invent a timestamp, and it
-- does not silently drop the rows.
--
-- ⚠ IT ALSO REMOVES THE STATE MACHINE. After this runs, `media_objects.state`
-- is governed only by its CHECK constraint, which permits any value in the
-- enumeration — including `pending -> ready`, skipping verification entirely.
-- The `post_media` gate from 20260814084711 still refuses non-`ready` media, but
-- it has no way to know whether `ready` was reached legitimately.
--
-- The only acceptable next step after running this is a corrected forward
-- migration in the same session.
--
-- ───────────────────────────────────────────────────────────────────────────
-- ORDER: functions before the column they read, constraints last. The
-- quarantine_reason column is dropped AFTER media_quarantine(), because the
-- function body references it.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE _n bigint;
BEGIN
  IF to_regclass('public.media_objects') IS NULL THEN
    RAISE NOTICE 'public.media_objects does not exist; nothing to roll back';
    RETURN;
  END IF;

  -- The restored constraint would reject exactly these rows.
  EXECUTE $q$
    SELECT count(*) FROM public.media_objects
     WHERE state = 'quarantined' AND verified_at IS NULL
  $q$ INTO _n;

  IF _n > 0 THEN
    RAISE EXCEPTION 'ROLLBACK ABORTED: % quarantined row(s) have no verified_at. '
      'The pre-migration constraint forbids them, and this file will not '
      'fabricate a verification timestamp or delete the rows. Decide '
      'deliberately, then re-run.', _n;
  END IF;

  -- The restored constraint set has no ready-needs-derivatives rule, so those
  -- rows survive the rollback; nothing to check. Same for quarantine_reason.
END $$;

-- ── Functions. Dropped by FULL signature: `DROP FUNCTION public.media_mark_ready`
-- without the argument list is ambiguous the moment an overload exists.
DROP FUNCTION IF EXISTS public.media_quarantine(uuid, text);
DROP FUNCTION IF EXISTS public.media_mark_ready(uuid, jsonb);
DROP FUNCTION IF EXISTS public.media_mark_verified(uuid);
DROP FUNCTION IF EXISTS public.media_begin_upload(bytea, int, int, bigint, text);

-- ── The state machine.
DROP TRIGGER  IF EXISTS trg_media_state_transition ON public.media_objects;
DROP FUNCTION IF EXISTS public.tg_media_state_transition();

-- ── Constraints added by the forward migration.
ALTER TABLE public.media_objects DROP CONSTRAINT IF EXISTS media_objects_quarantine_has_reason;
ALTER TABLE public.media_objects DROP CONSTRAINT IF EXISTS media_objects_ready_has_derivatives;

-- ── The column, now that media_quarantine() no longer reads it.
ALTER TABLE public.media_objects DROP COLUMN IF EXISTS quarantine_reason;

-- ── And the constraint swap, back the way it was.
ALTER TABLE public.media_objects DROP CONSTRAINT IF EXISTS media_objects_verified_has_ts;
ALTER TABLE public.media_objects
  ADD CONSTRAINT media_objects_verified_has_ts
  CHECK (state = 'pending' OR verified_at IS NOT NULL);

COMMIT;
