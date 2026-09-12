-- ═══════════════════════════════════════════════════════════════════════════
-- SOURCE DUMP PROBE — READS NO MEMBER DATA, WRITES NOTHING, CHANGES NOTHING.
--
-- WHY THIS FILE EXISTS.
--
-- Run #69 dispatched 20260910_0023_f105de against PRODUCTION and was refused by
-- its own P2 precondition gate:
--
--   live 2-arg process_referral_reward body md5 7999749b88688973dc95680d68ae5e86
--   (1416 bytes), not the expected a82168c949cbc3eef0dad32e17961730 (1371 bytes)
--   that main's 20260228101821 defines.
--
-- The transaction rolled back cleanly; nothing was applied. **The gate did its
-- job**, and the correct response to it is the one written into 0023's own
-- header: re-derive from the live prosrc, never weaken the check.
--
-- To re-derive, someone has to be able to SEE the live source. Until now the
-- only way to read it would have been for a person to hold the production
-- database credential and query it by hand — which is precisely the thing this
-- repository's whole apply-migration design exists to avoid (see that
-- workflow's header: "applying a migration requires the production database
-- credential, and an assistant should never hold that").
--
-- So: this file. It is the smallest thing that puts the live function source
-- into an audit-trailed Actions log without anybody handling the credential.
--
-- ═══ WHAT IT READS, AND WHAT IT DELIBERATELY DOES NOT ═══
--
-- READS: the system catalogue only — pg_proc and pg_get_functiondef() for
-- exactly two functions, both named public.process_referral_reward.
--
-- DOES NOT READ: any member data. It does not touch public.referrals,
-- public.wallet_transactions, public.profiles, public.site_settings or any
-- other table. There is no SELECT against a data table anywhere in this file.
--
-- DOES NOT EXPOSE THE CREDENTIAL: apply-migration.yml never echoes $DB_URL, and
-- nothing here reads it, prints it, or derives anything from it. The only
-- identifying value printed is current_database(), which is 'postgres' on every
-- Supabase project and is not a secret.
--
-- WHAT IT PRINTS IS CODE, NOT DATA. A function definition is source text. These
-- two functions' source is already public in this repository (main's
-- 20260228101821 and 20260228102118; staging's 20260910_0019 and 0022) and
-- contains no keys, no tokens, no connection strings and no personal data —
-- checked before this file was written, not assumed. What is NOT already in the
-- repository is *which* of those versions production is actually running, and
-- that is the single question this file answers.
--
-- WRITES NOTHING: no DDL, no DML, no GRANT, no function, no policy. Run it
-- twice, a hundred times, against either lane — the database is byte for byte
-- what it was before. It is wrapped in BEGIN/COMMIT only to match
-- PROBE_credential_connectivity_readonly.sql, whose pattern this follows.
--
-- ═══ HOW TO USE THE OUTPUT ═══
--
-- Section 2 prints each definition line by line via RAISE NOTICE, so it can be
-- copied out of the Actions log verbatim. Section 1 prints the catalogue facts
-- a re-derivation needs: the md5 and byte length that a precondition gate must
-- pin, whether the DEFAULT is present, and the ACL.
--
-- ⚠ A GREEN RUN OF THIS FILE PROVES NOTHING ABOUT ANY MIGRATION. It reports
-- what is there. It does not assert that what is there is correct, and nothing
-- in its output should ever be read as a gate having passed.
--
-- The `PROBE_` prefix follows the existing convention in this directory: a name
-- that tells any future reader, at a glance, that the file is not part of the
-- migration sequence.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. CATALOGUE FACTS — everything a precondition gate needs to pin. ──
SELECT
  p.oid                                            AS oid,
  pg_get_function_identity_arguments(p.oid)        AS identity_args,
  p.pronargs                                       AS n_args,
  p.pronargdefaults                                AS n_defaults,
  p.prosecdef                                      AS security_definer,
  p.provolatile                                    AS volatility,
  coalesce(array_to_string(p.proconfig, ','), '(none)')            AS proconfig,
  coalesce(array_to_string(p.proacl, ' | '), '(null = default)')   AS acl,
  md5(p.prosrc)                                    AS prosrc_md5,
  length(p.prosrc)                                 AS prosrc_bytes
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname = 'process_referral_reward'
ORDER BY p.pronargs;

-- ── 2. THE FULL DEFINITIONS, one log line per source line. ──
-- pg_get_functiondef() in a plain SELECT renders as one enormous wrapped cell
-- that cannot be copied back out cleanly. Split, it is paste-ready.
DO $dump$
DECLARE
  _r    record;
  _line text;
  _i    int;
  _n    int := 0;
BEGIN
  RAISE NOTICE '=== process_referral_reward — LIVE SOURCE @ % UTC ===',
    to_char(clock_timestamp() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  RAISE NOTICE 'database = %, server = %',
    current_database(), current_setting('server_version');

  FOR _r IN
    SELECT p.oid,
           pg_get_function_identity_arguments(p.oid) AS args,
           md5(p.prosrc)    AS md5,
           length(p.prosrc) AS len,
           p.pronargdefaults AS ndef,
           pg_get_functiondef(p.oid) AS def
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname = 'process_referral_reward'
     ORDER BY p.pronargs
  LOOP
    _n := _n + 1;
    RAISE NOTICE ' ';
    RAISE NOTICE '───────────────────────────────────────────────────────────';
    RAISE NOTICE 'OVERLOAD % — oid %  (%)', _n, _r.oid, _r.args;
    RAISE NOTICE 'prosrc md5 = %   bytes = %   parameter defaults = %',
      _r.md5, _r.len, _r.ndef;
    RAISE NOTICE '───────────────────────────────────────────────────────────';

    _i := 0;
    FOREACH _line IN ARRAY string_to_array(_r.def, E'\n') LOOP
      _i := _i + 1;
      RAISE NOTICE '%|%', lpad(_i::text, 4), _line;
    END LOOP;
  END LOOP;

  IF _n = 0 THEN
    RAISE NOTICE ' ';
    RAISE NOTICE '⚠ NO public.process_referral_reward EXISTS ON THIS DATABASE.';
    RAISE NOTICE '  That is itself the answer, and a surprising one: both the';
    RAISE NOTICE '  admin Approve button and the competition-entry reward path';
    RAISE NOTICE '  call it by name. Do not re-derive anything from an absence —';
    RAISE NOTICE '  find out what happened to it first.';
  END IF;

  RAISE NOTICE ' ';
  RAISE NOTICE '=== END SOURCE DUMP — % overload(s) found, nothing written ===', _n;
END
$dump$;

COMMIT;
