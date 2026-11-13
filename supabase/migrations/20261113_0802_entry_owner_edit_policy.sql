-- ═══════════════════════════════════════════════════════════════════════════
-- 20261113_0802 · THE OWNER CAN EDIT THEIR ENTRY AGAIN (while entries are open)
--
-- MEASURED (PROBE 0801 staging run 43444508933, PROBE 0800 runs 43440954038 /
-- 43444685143): every UPDATE of competition_entries by a member fails with
--   42P17 infinite recursion detected in policy for relation "competition_entries"
-- — the title edit the app offers (useUpdateCompetitionEntry) included. Cause:
-- the WITH CHECK of "Users can update own metadata only" (20260619120842) locks
-- columns by reading competition_entries from inside its own policy
-- ((SELECT ce2.status FROM competition_entries ce2 …) × 12), which Postgres
-- refuses. So the column lock "worked" only by refusing every edit.
--
-- 0800 put the column lock where it can work: trg_0_entry_member_write_guard
-- (allow-list: title, description, photos, photo_thumbnails, photo_meta,
-- exif_data, updated_at — stricter than the 12 columns the policy named).
-- This file keeps the policy's row rule exactly (own entry, competition taking
-- entries, not archived/cancelled) and drops only the self-reading column part.
-- It REFUSES to run unless the 0800 guard is installed and enabled.
--
-- Rollback: supabase/rollback/20261113_0802_entry_owner_edit_policy_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261113_0800_member_write_guards.sql
--           (N1 owner edit must say "works"; A1–A4 refused by the guard, 42501)
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $pre$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'APPLY REFUSED — p32.lane is not asserted as staging or production. Dispatch apply-migration.yml.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                  WHERE t.tgname = 'trg_0_entry_member_write_guard' AND t.tgenabled = 'O'
                    AND t.tgrelid = 'public.competition_entries'::regclass) THEN
    RAISE EXCEPTION 'APPLY REFUSED — trg_0_entry_member_write_guard (0800) is not installed; without it this would open the result columns.';
  END IF;
END
$pre$;

DROP POLICY "Users can update own metadata only" ON public.competition_entries;

CREATE POLICY "Users can update own metadata only"
ON public.competition_entries
FOR UPDATE
TO authenticated
USING (
  user_id = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.competitions c
    WHERE c.id = competition_entries.competition_id
      AND c.phase = 'submission_open'
      AND now() <= c.ends_at
      AND c.status NOT IN ('archived', 'cancelled')
  )
)
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.competitions c
    WHERE c.id = competition_entries.competition_id
      AND c.phase = 'submission_open'
      AND now() <= c.ends_at
      AND c.status NOT IN ('archived', 'cancelled')
  )
);

COMMIT;
