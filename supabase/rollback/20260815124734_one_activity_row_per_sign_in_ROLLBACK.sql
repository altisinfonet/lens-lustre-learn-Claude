-- ROLLBACK for 20260815124734_one_activity_row_per_sign_in.
--
-- FULLY REVERSIBLE, and unusually so: this migration added an index and
-- nothing else. It wrote no rows, changed no rows, and deleted no rows — the
-- 5,702 historical login rows were deliberately left outside the index by its
-- partial WHERE clause, so there is nothing to restore.
--
-- WHAT COMES BACK IF YOU RUN THIS: the flood. Repeated `SIGNED_IN` events will
-- again be able to write a row each — 8.3 per real sign-in on the measured
-- evidence, and up to 233. The client-side guard in useAuth.tsx would still
-- reduce it, but a guard is a promise and this index is arithmetic.
--
-- Rows written WHILE the index existed are untouched by dropping it. They stay
-- correct; they simply stop being protected.

DROP INDEX IF EXISTS public.activity_logs_one_row_per_sign_in;
