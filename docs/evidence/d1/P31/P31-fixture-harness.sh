set -u
REPO=/home/user/lens-lustre-learn-Claude
PSQL="psql -h /var/tmp/p31 -p 5601 -U postgres -X -q"
run(){ $PSQL -v ON_ERROR_STOP=1 -c "$1" 2>&1; }
runf(){ $PSQL -v ON_ERROR_STOP=1 -f "$1" 2>&1; }
acl(){ $PSQL -Atc "SELECT COALESCE(proacl::text,'NULL') FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='$1'"; }
anonx(){ $PSQL -Atc "SELECT has_function_privilege('anon', p.oid,'EXECUTE') FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname='$1'"; }
pubn(){ $PSQL -Atc "SELECT count(*) FROM pg_proc p, aclexplode(p.proacl) a WHERE p.pronamespace='public'::regnamespace AND p.proname='$1' AND a.grantee=0 AND a.privilege_type='EXECUTE'"; }
probe(){ runf "$REPO/supabase/migrations/PROBE_p31_search_certificates_closed.sql" | grep -E 'NOTICE:|ERROR:' | sed 's/^psql:[^ ]* //'; echo "   probe exit status: ${PIPESTATUS[0]}"; }
searchas(){ $PSQL -Atc "SET ROLE anon; SELECT count(*) FROM public.search_certificates('$1', NULL, NULL);" 2>&1 | tail -1; }

echo "P31 · fixture transcript — search_certificates revoked from anon; verify-by-token retained"
echo "Scratch PostgreSQL in the D1 container. F-65: grant controls run on fixtures, not on a lane."
echo "server: $($PSQL -Atc 'select version()')"
echo "date:   $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo
echo "================================================================================"
echo "PART A — the MEASURED pre-revoke state, reproduced. Note the leading =X/postgres."
echo "================================================================================"
echo "  fixture search_certificates : $(acl search_certificates)"
echo "  lane    (BOTH lanes)        : {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"
echo "     production jtdtehuqtinjxropkkcn oid 22560 · staging ztzutckwdhetphwghuzj oid 17985"
echo "     read by D1 2026-09-04, SELECT only. Identical ACL on both lanes; oids differ, as expected."
echo "  -> byte-identical, INCLUDING the PUBLIC entry. PUBLIC EXECUTE entries: $(pubn search_certificates)"
echo
echo "  ⚠ THE LEADING \`=X/postgres\` IS THE PUBLIC GRANT — the entry with no grantee name."
echo "    This is the difference from P30, where email_exists had NO public entry."
echo
echo "  anon can execute search_certificates?         $(anonx search_certificates)"
echo "  anon searching for the single letter 'a':     $(searchas a) row(s) returned"
echo "  -> a one-character substring returns real people and what they were awarded."
echo "     The all-blank bulk dump IS blocked by the function's first predicate:"
echo "     anon searching for '' (blank):              $(searchas '') row(s)"
echo "  -> so somebody thought about this once; a one-character search walks past it."
echo
echo "  Does the directory leak the verification token? Checking the select list in practice:"
$PSQL -Atc "SET ROLE anon; SELECT 'verification_token returned as NULL for all rows: '||bool_and(verification_token IS NULL)::text FROM public.search_certificates('a',NULL,NULL);" 2>&1 | sed 's/^/    /'
echo "  -> NO. The body selects NULL::text AS verification_token. The capability model is intact,"
echo "     and this revoke is NOT needed to protect the token. Stated because the opposite would"
echo "     have been an easy and wrong assumption."
echo
echo "================================================================================"
echo "PART B — NEGATIVE CONTROL. The probe BEFORE the revoke. It must FAIL. (C-34)"
echo "================================================================================"
probe
echo
echo "================================================================================"
echo "PART C — F-62 ON THE REAL OBJECT. THIS IS THE P30 DIFFERENCE."
echo "         In P30 this trap had to be shown on a synthetic function because"
echo "         email_exists carried no PUBLIC grant. Here it is the live shape."
echo "================================================================================"
echo "  the obvious one-liner, the one a hurried operator reaches for:"
run "REVOKE EXECUTE ON FUNCTION public.search_certificates(text,text,date) FROM anon;"
echo "    after REVOKE ... FROM anon:"
echo "      proacl            : $(acl search_certificates)"
echo "      anon can execute? : $(anonx search_certificates)   <- STILL TRUE. Closed NOTHING."
echo "      anon still searching 'a': $(searchas a) row(s)     <- the directory is still open"
echo
echo "  -> The statement SUCCEEDED. The catalogue LOOKS changed — anon's own entry is gone."
echo "     anon keeps EXECUTE through PUBLIC. This is F-62, on the live object shape,"
echo "     and it is why the migration revokes FROM public FIRST."
echo
echo "  restoring the fixture to the measured pre-revoke state before applying properly:"
run "GRANT EXECUTE ON FUNCTION public.search_certificates(text,text,date) TO anon;" >/dev/null
echo "      proacl restored   : $(acl search_certificates)"
echo
echo "================================================================================"
echo "PART D — apply supabase/migrations/20260910_0003_p31_search_certificates_revoke.sql"
echo "================================================================================"
runf "$REPO/supabase/migrations/20260910_0003_p31_search_certificates_revoke.sql"
echo "  proacl after          : $(acl search_certificates)"
echo "  PUBLIC EXECUTE entries: $(pubn search_certificates)"
echo "  anon                  : $(anonx search_certificates)"
echo "  anon searching 'a'    :"
$PSQL -Atc "SET ROLE anon; SELECT count(*) FROM public.search_certificates('a',NULL,NULL);" 2>&1 | tail -1 | sed 's/^/    /'
echo
echo "  AND THE HALF THAT MUST KEEP WORKING — verify_certificate_by_token:"
echo "    proacl            : $(acl verify_certificate_by_token)"
echo "    anon can execute? : $(anonx verify_certificate_by_token)   <- UNTOUCHED, as the gate requires"
# ⚠ The token must be read as postgres and PASSED IN, not sub-selected as anon.
# anon has no SELECT on public.certificates - correctly - so a sub-select inside
# the anon session fails on the TABLE and says nothing about the FUNCTION. An
# earlier draft of this harness did exactly that and printed "permission denied
# for table certificates" under a line claiming verification still worked. The
# claim was not supported by its own output; the harness was wrong, not the
# product. Fixed here, and recorded rather than silently corrected.
TOKEN=$($PSQL -Atc "SELECT verification_token FROM public.certificates ORDER BY issued_at LIMIT 1")
$PSQL -Atc "SET ROLE anon; SELECT 'anon verifying a real token: '||count(*)||' row(s) returned' FROM public.verify_certificate_by_token('$TOKEN');" 2>&1 | sed 's/^/    /'
echo "    -> anon CAN still verify a real certificate by token. Token value never printed."
echo "    -> and note anon has NO direct SELECT on public.certificates:"
$PSQL -Atc "SET ROLE anon; SELECT count(*) FROM public.certificates;" 2>&1 | tail -1 | sed 's/^/       /'
echo "       which is correct: the DEFINER function is the only way in, and its WHERE"
echo "       clause (exact match on a 256-bit token) is the only control."
echo
echo "================================================================================"
echo "PART E — the probe AFTER the revoke. Same file, same instrument. It must PASS."
echo "================================================================================"
probe
echo
echo "================================================================================"
echo "PART F — apply the ROLLBACK. The probe must FAIL again, at C2 and C3."
echo "         Sensitive in BOTH directions, not green-on-green."
echo "================================================================================"
runf "$REPO/supabase/rollback/20260910_0003_p31_search_certificates_revoke_ROLLBACK.sql"
echo "  proacl after rollback : $(acl search_certificates)"
echo "  PUBLIC EXECUTE entries: $(pubn search_certificates)   <- restored, as the pre-revoke state had it"
echo "  anon                  : $(anonx search_certificates)"
echo "  grantee/privilege set after rollback (the correct set-wise instrument):"
$PSQL -Atc "SELECT '      '||COALESCE(NULLIF(a.grantee::regrole::text,'-'),'PUBLIC')||'/'||a.privilege_type FROM pg_proc p, aclexplode(p.proacl) a WHERE p.pronamespace='public'::regnamespace AND p.proname='search_certificates' ORDER BY 1"
echo "  -> privilege-equivalent to the pre-apply lane reading (element ORDER differs; grants do not)."
probe
