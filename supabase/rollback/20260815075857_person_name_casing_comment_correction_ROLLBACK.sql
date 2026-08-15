-- ============================================================================
-- ROLLBACK for 20260815075857_person_name_casing_comment_correction.sql
--
-- There is deliberately NOTHING to roll back.
--
-- That migration changed only two comment blocks inside format_person_name().
-- Its behaviour is byte-identical to 20260815075526's: same guards, same
-- branches, same output for every input. Rolling it back would restore a
-- comment asserting that initcap('50mm') is '50Mm', which is false and was
-- verified false on this database.
--
-- If the FUNCTION itself must be removed, that is the job of
-- 20260815075526_person_name_casing_ROLLBACK.sql, which drops the trigger and
-- both functions. This file exists so the rollback-coverage check finds a
-- matching file and so the reasoning is on the record rather than inferred
-- from an absence.
-- ============================================================================

-- Intentionally empty. See above.
SELECT 1;
