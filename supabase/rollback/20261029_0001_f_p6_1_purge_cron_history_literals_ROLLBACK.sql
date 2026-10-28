-- ROLLBACK for 20261029_0001 (F-P6-1 purge) — a deliberate no-op.
-- The apply file deletes scheduler run-log rows that held literal credentials.
-- Those rows cannot be restored, and restoring them would re-expose the values.
-- Nothing else was changed, so there is nothing to undo.
BEGIN;
DO $noop$ BEGIN RAISE NOTICE 'F-P6-1 rollback: nothing to undo (deleted run-log rows are not restorable by design).'; END $noop$;
COMMIT;
