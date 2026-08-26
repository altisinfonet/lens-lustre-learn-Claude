-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for UNAPPLIED_20260825060000_certificate_types_and_admin_search.sql
--
-- Reverses, in reverse order of creation:
--   1. index  idx_certificates_issued_at_id_desc
--   2. function admin_list_certificates(text, text, integer, integer)
--   3. function admin_search_certificate_recipients(text, integer)
--   4. the CHECK constraint certificates_type_check, back to its 14 values
--
-- ⚠ READ THIS BEFORE RUNNING — STEP 4 CAN REFUSE, AND THAT REFUSAL IS CORRECT.
--
-- The forward migration ADDED two permitted types: 'achievement' and 'custom'.
-- If any certificate has been issued with either type since, restoring the
-- 14-value constraint would contradict live data, and PostgreSQL will refuse
-- the ALTER rather than corrupt the table. That is the database protecting you.
--
-- Check FIRST, read-only:
--
--   select type, count(*) from public.certificates
--    where type in ('achievement','custom') group by type;
--
-- Zero rows  -> step 4 will succeed.
-- Any rows   -> STOP. Rolling back the constraint would orphan real
--               certificates. Decide with the owner what happens to those
--               rows before touching the constraint. Steps 1-3 are still safe
--               to run on their own.
--
-- ⚠ STEP 2 NOTE. If migration `certificate_custom_heading` has also been
-- applied, admin_list_certificates is its 12-column version (it returns
-- `heading`). The input signature is unchanged, so this DROP still removes it —
-- but it removes the NEWER function. Roll back that migration first if you want
-- its 11-column predecessor restored.
--
-- Baseline measured on production jtdtehuqtinjxropkkcn, 2026-08-25:
--   certificates rows ......... 23
--   distinct types in use ...... 8, none of them 'achievement' or 'custom'
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. The ordering index.
drop index if exists public.idx_certificates_issued_at_id_desc;

-- 2 and 3. The two admin RPCs. Signatures are the INPUT arguments only.
drop function if exists public.admin_list_certificates(text, text, integer, integer);
drop function if exists public.admin_search_certificate_recipients(text, integer);

-- 4. The CHECK constraint, restored to the exact 14 values read from
--    production's pg_constraint on 2026-08-25 before the forward migration.
alter table public.certificates drop constraint if exists certificates_type_check;

alter table public.certificates add constraint certificates_type_check check (
  type = any (array[
    'course_completion'::text,
    'competition_winner'::text,
    'competition_runner_up_1'::text,
    'competition_runner_up_2'::text,
    'competition_honorary_mention'::text,
    'competition_special_jury'::text,
    'competition_top_50'::text,
    'competition_top_100'::text,
    'winner'::text,
    'finalist'::text,
    'participation_r1'::text,
    'participation_r2'::text,
    'participation_r3'::text,
    'participation_r4'::text
  ])
);

-- ═══════════════════════════════════════════════════════════════════════════
-- RE-MEASUREMENT 2026-08-26 (read-only). The 2026-08-25 baseline above is
-- retained unaltered as evidence of that date; these are today's figures.
--   production certificates rows ............................. 0   (was 23)
--   certificates carrying type 'achievement' or 'custom' ..... 0
--     -> step 4 (restore the 14-value constraint) will SUCCEED today.
--   certificates_type_check, BOTH lanes ...................... 16 values, identical
--   idx_certificates_issued_at_id_desc, BOTH lanes ........... present
--   admin_list_certificates def md5, BOTH lanes .............. 10d5b0a1075b2fbeb0dfec9a1a817212
--   admin_search_certificate_recipients def md5, BOTH lanes .. 4015ab9289cecf9510ee2e9d95ed32bf
--
-- ⚠ DEPENDENCY IMPACT, measured 2026-08-26. Step 2 drops
-- admin_list_certificates and step 3 drops admin_search_certificate_recipients.
-- Both are called by the admin certificate screens in candidate tree 702e5ce
-- and in shipped main b671e1f. Running steps 2-3 without rolling the
-- application back leaves those screens calling functions that do not exist.
-- No production EDGE function calls either one (checked against the deployed
-- function list, 2026-08-26).
-- ═══════════════════════════════════════════════════════════════════════════
