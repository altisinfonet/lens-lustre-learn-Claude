set -u
REPO=/home/user/lens-lustre-learn-Claude
PSQL="psql -h /var/tmp/p30 -p 5599 -U postgres -X -q"
run(){ $PSQL -v ON_ERROR_STOP=1 -c "$1" 2>&1; }
runf(){ $PSQL -v ON_ERROR_STOP=1 -f "$1" 2>&1; }
acl(){ $PSQL -Atc "SELECT COALESCE(proacl::text,'NULL') FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='email_exists'"; }
priv(){ $PSQL -Atc "SELECT has_function_privilege('$1', p.oid,'EXECUTE') FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname='email_exists'"; }
probe(){ runf "$REPO/supabase/migrations/PROBE_p30_email_exists_closed.sql" | grep -E 'NOTICE:|ERROR:' | sed 's/^psql:[^ ]* //'; echo "   probe exit status: ${PIPESTATUS[0]}"; }
aclset(){ $PSQL -Atc "SELECT '      '||a.grantee::regrole::text||'/'||a.privilege_type FROM pg_proc p, aclexplode(p.proacl) a WHERE p.pronamespace='public'::regnamespace AND p.proname='email_exists' ORDER BY 1"; }
pubrows(){ $PSQL -Atc "SELECT count(*) FROM pg_proc p, aclexplode(p.proacl) a WHERE p.pronamespace='public'::regnamespace AND p.proname='email_exists' AND a.grantee=0"; }
callas(){ $PSQL -Atc "SET ROLE $1; SELECT public.email_exists('member@example.com');" 2>&1 | tail -2; }

echo "P30 · fixture transcript — email_exists(text) revoke, shown failing before and passing after"
echo "Scratch PostgreSQL in the D1 container. F-65 rule: grant controls run on fixtures, not on a lane."
echo "server: $($PSQL -Atc 'select version()')"
echo "date:   $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo
echo "================================================================================"
echo "PART A — the measured pre-revoke state, reproduced"
echo "================================================================================"
run "DROP FUNCTION IF EXISTS public.email_exists(text);" >/dev/null
runf /var/tmp/p30/fixture_refresh.sql >/dev/null
echo "  fixture proacl : $(acl)"
echo "  lane proacl    : {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"
echo "                   (staging ztzutckwdhetphwghuzj oid 17719 and production jtdtehuqtinjxropkkcn oid 34459,"
echo "                    read by D1 2026-09-04, SELECT only — identical on both lanes)"
echo "  -> byte-identical. PUBLIC entries: $($PSQL -Atc "SELECT count(*) FROM pg_proc p, aclexplode(p.proacl) a WHERE p.pronamespace='public'::regnamespace AND p.proname='email_exists' AND a.grantee=0")"
echo
echo "  anon can execute?          $(priv anon)"
echo "  anon calling it for real:  $(callas anon)"
echo "  -> the enumeration oracle, answering a question about a named person to an anonymous caller."
echo
echo "================================================================================"
echo "PART B — THE NEGATIVE CONTROL. The probe BEFORE the revoke. It must FAIL."
echo "         A test that could not have failed is not evidence (C-34)."
echo "================================================================================"
probe
echo
echo "================================================================================"
echo "PART C — apply supabase/migrations/20260910_0001_p30_email_exists_revoke.sql"
echo "================================================================================"
runf "$REPO/supabase/migrations/20260910_0001_p30_email_exists_revoke.sql"
echo "  proacl after   : $(acl)"
echo "  anon           : $(priv anon)"
echo "  authenticated  : $(priv authenticated)   <- deliberately UNCHANGED, frozen list authorised public+anon only"
echo "  service_role   : $(priv service_role)   <- deliberately UNCHANGED"
echo "  anon calling it for real:"
callas anon | sed 's/^/    /'
echo
echo "================================================================================"
echo "PART D — the probe AFTER the revoke. Same file, same instrument. It must PASS."
echo "================================================================================"
probe
echo
echo "================================================================================"
echo "PART E — apply supabase/rollback/20260910_0001_..._ROLLBACK.sql"
echo "         The probe must FAIL again: the rollback genuinely reopens the gate,"
echo "         and the probe is sensitive in BOTH directions, not just green-on-green."
echo "================================================================================"
runf "$REPO/supabase/rollback/20260910_0001_p30_email_exists_revoke_ROLLBACK.sql"
echo "  proacl after rollback : $(acl)"
echo "  proacl before apply   : {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"
echo
echo "  ⚠ NOT byte-equal: anon is re-appended at the END of the array, because REVOKE removes"
echo "    the aclitem and GRANT adds a new one. The GRANTS are identical; only element order moved."
echo "    proacl::text string equality is the wrong instrument. The right one is set-wise:"
echo "    grantee/privilege set after rollback:"
aclset
echo "    PUBLIC (grantee 0) rows: $(pubrows) -- the rollback must NOT re-grant PUBLIC, which held nothing before"
echo "    -> privilege-equivalent to the pre-apply lane reading. This is the honest claim."
echo "  anon calling it for real:  $(callas anon)"
probe

echo
echo "================================================================================"
echo "PART F — F-62 / F-66, DEMONSTRATED RATHER THAN ASSERTED."
echo "         Why 20260910_0001 revokes FROM public FIRST even though email_exists"
echo "         carries a clean grant on both lanes today."
echo "================================================================================"
echo "  email_exists TODAY has zero PUBLIC entries on both lanes, so anon-only WOULD have"
echo "  worked. F-62's register row says the same. The public-first form is written for the"
echo "  state the function enters the moment anyone recreates it (F-66). Building that state:"
echo
run "DROP FUNCTION IF EXISTS public.f66_recreated(text);" >/dev/null
run "CREATE FUNCTION public.f66_recreated(_email text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS \$fn\$ select exists (select 1 from auth.users where lower(email)=lower(_email)); \$fn\$;" >/dev/null
f66acl(){ $PSQL -Atc "SELECT COALESCE(proacl::text,'NULL') FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='f66_recreated'"; }
f66priv(){ $PSQL -Atc "SELECT has_function_privilege('anon', p.oid,'EXECUTE') FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname='f66_recreated'"; }
echo "  fresh CREATE FUNCTION, no grants issued at all:"
echo "    proacl              : $(f66acl)"
echo "    anon can execute?   : $(f66priv)   <- NULL proacl is the BUILT-IN DEFAULT = EXECUTE TO PUBLIC."
echo "                                          It is not 'no grants'. That is the trap."
echo
echo "  now the obvious command, the one a hurried operator reaches for:"
run "REVOKE ALL ON FUNCTION public.f66_recreated(text) FROM anon;"
echo "    after REVOKE ... FROM anon:"
echo "    proacl              : $(f66acl)"
echo "    anon can execute?   : $(f66priv)   <- STILL TRUE. The statement succeeded and closed NOTHING."
echo "                                          anon inherits EXECUTE through PUBLIC. This is F-62."
echo
echo "  now the form 20260910_0001 actually uses — FROM public first, then FROM anon:"
run "REVOKE ALL ON FUNCTION public.f66_recreated(text) FROM public;"
run "REVOKE ALL ON FUNCTION public.f66_recreated(text) FROM anon;"
echo "    proacl              : $(f66acl)"
echo "    anon can execute?   : $(f66priv)   <- closed."
echo
echo "  -> The two-line form is a no-op today on email_exists and the correct form the day the"
echo "     function is recreated. That is why the frozen list mandates it and why it is written"
echo "     that way here, without claiming F-62 currently bites this particular function."
