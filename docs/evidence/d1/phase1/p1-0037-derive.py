#!/usr/bin/env python3
"""D1 · U3 · 20260910_0037 — derive the closing set from the production reading.

20260910_0037 is the only Phase-1 unit whose target lane cannot be measured from
any session: production is unreachable. Its object lists therefore come from ONE
artefact, p1-0037-production-reading-20260925.json, and this file derives them
mechanically instead of transcribing them by hand -- because a hand-typed list of
29 signatures is exactly the kind of thing that is wrong by two and nobody
notices (C-A21, below).

WHAT IT CHECKS, AND WHY EACH CHECK EARNS ITS PLACE
==================================================

  1. the reading contains exactly 33 anon-executable VOLATILE functions.
     That is R-50's headline number for production. If the reading does not
     reproduce it, the reading was transcribed wrong and nothing downstream is
     worth building.

  2. the two groups the Auditor named, taken as NAMES, resolve against the
     reading to exactly 21 + 8 = 29 signatures.

  3. closing set + the 4 justified retentions == the 33, exactly. Set equality,
     both directions. This is the check that matters: it proves the command's
     lists cover everything that is open on production and nothing that is not.
     A missing signature shows up as a leftover; an invented one shows up as a
     name that does not resolve.

  4. every group-A function still has a named `authenticated` grant after the
     revoke, so `FROM PUBLIC, anon` cannot silently take authenticated with it
     (four of them reach anon THROUGH PUBLIC: register_push_token,
     unregister_push_token, claim_username, change_custom_url).

CORRECTION C-A21, accepted by the Auditor 2026-09-25
----------------------------------------------------
R-50 described the 0035-class subset as "the 17 names / 19 signatures". Checked
against the committed staging evidence (P32-0035-signatures-20260925.tsv) and
against this reading, it is **15 names / 17 signatures** -- get_broadcast_feed
supplies 3 of the 17. The Auditor confirmed the typo and ruled that the explicit
object lists govern. They reconcile: 17 + 4 = 21, plus 7 + 1 = 8, is 29, which is
R-50's own "29 to close" and 33 minus the 4 justified retentions.

    python3 docs/evidence/d1/phase1/p1-0037-derive.py [--emit-revokes]
"""
import json, os, re, sys
sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
R = json.load(open(os.path.join(HERE, 'p1-0037-production-reading-20260925.json'), encoding='utf-8'))

# --- the four retentions, justified in docs/evidence/d1/phase1/p32-dispositions.md
JUSTIFIED = ['increment_managed_page_view', 'log_app_event', 'log_client_error', 'record_test_agent_run']

# --- R-50's group A: revoke FROM PUBLIC, anon. `authenticated` is KEPT.
GROUP_A_NAMES = [
    # the 0035 class present on production (15 names -> 17 signatures; C-A21)
    'get_broadcast_feed', 'fix_certificate_readiness_admin', 'fix_gift_drift_admin',
    'submit_competition_entry', 'get_judging_tag_assignment_counts', 'get_judge_collusion_admin',
    'admin_flag_entry_for_review', 'get_certificate_drift_admin', 'admin_rewind_stage',
    'backfill_judging_notifications', 'admin_set_photo_rejected', 'fix_referral_drift_admin',
    'backfill_tag_decision_drift_admin', 'register_push_token', 'unregister_push_token',
    # named additions
    'request_withdrawal', 'admin_search_users', 'change_custom_url', 'claim_username',
]
# --- R-50's group B: revoke FROM PUBLIC, anon, authenticated.
GROUP_B_NAMES = [
    # the 0034 class present on production (7)
    'apply_decision_to_remaining', '_gen_competition_order_no', 'recompute_entry_from_tag_assignments',
    'recompute_entry_public_status', 'set_write_path', 'get_derived_status_drift_admin',
    'judging_write_decision_atomic',
    # staging parity: service_role only
    'clear_custom_url',
]

def name_of(sig):           return sig[:sig.index('(')]
def acl_items(acl):         return [x for x in acl.strip('{}').split(',') if x]
def has_public(acl):        return any(i.startswith('=') for i in acl_items(acl))
def has_named(acl, role):   return any(i.startswith(role + '=') for i in acl_items(acl))
def anon_exec(acl):         return has_public(acl) or has_named(acl, 'anon')

vol_anon = [(s, a) for (s, v, a) in R['functions'] if v == 'v' and anon_exec(a)]
A = [(s, a) for (s, a) in vol_anon if name_of(s) in GROUP_A_NAMES]
B = [(s, a) for (s, a) in vol_anon if name_of(s) in GROUP_B_NAMES]
K = [(s, a) for (s, a) in vol_anon if name_of(s) in JUSTIFIED]

ok = True
def check(label, cond, detail=''):
    global ok
    if not cond: ok = False
    print(f"  {'PASS' if cond else 'FAIL'}  {label}" + (f"  {detail}" if detail else ''))

print("D1 · U3 · 20260910_0037 — CLOSING SET DERIVED FROM THE PRODUCTION READING")
print(f"reading: {R['measured_at_utc']}Z · {len(R['functions'])} functions · {len(R['tables'])} relations\n")

check("the reading reproduces R-50's 33 anon-executable VOLATILE functions",
      len(vol_anon) == 33, f"got {len(vol_anon)}")
check("group A resolves to 21 signatures", len(A) == 21, f"got {len(A)}")
check("group B resolves to 8 signatures",  len(B) == 8,  f"got {len(B)}")
check("29 signatures to close", len(A) + len(B) == 29, f"got {len(A)+len(B)}")
check("the 4 justified retentions are all present and anon-executable",
      len(K) == 4, f"got {len(K)}")

covered  = {s for s, _ in A} | {s for s, _ in B} | {s for s, _ in K}
allanon  = {s for s, _ in vol_anon}
check("closing set + retentions == the 33, exactly (set equality, both ways)",
      covered == allanon,
      ("leftover " + str(sorted(allanon - covered)) if allanon - covered else '') +
      ("  invented " + str(sorted(covered - allanon)) if covered - allanon else ''))

unresolved = [n for n in GROUP_A_NAMES + GROUP_B_NAMES
              if not any(name_of(s) == n for s, _ in vol_anon)]
check("every name the command lists resolves in the reading", not unresolved, str(unresolved))

noauth = [s for s, a in A if not has_named(a, 'authenticated')]
check("every group-A function keeps a NAMED authenticated grant after the revoke",
      not noauth, str(noauth))

pub_a = [s for s, a in A + B if has_public(a)]
print(f"\n  reach anon THROUGH PUBLIC (so `FROM anon` alone would be a no-op — F-62): {len(pub_a)}")
for s in pub_a: print(f"      {s}")

print(f"\nGROUP A — REVOKE EXECUTE … FROM PUBLIC, anon   (authenticated KEPT)   {len(A)}")
for s, a in sorted(A): print(f"    {s}")
print(f"\nGROUP B — REVOKE EXECUTE … FROM PUBLIC, anon, authenticated            {len(B)}")
for s, a in sorted(B): print(f"    {s}")
print(f"\nRETAINED, justified in p32-dispositions.md                             {len(K)}")
for s, a in sorted(K): print(f"    {s}")

if '--emit-revokes' in sys.argv:
    print("\n-- GROUP A")
    for s, _ in sorted(A): print(f"REVOKE EXECUTE ON FUNCTION public.{s} FROM PUBLIC, anon;")
    print("\n-- GROUP B")
    for s, _ in sorted(B): print(f"REVOKE EXECUTE ON FUNCTION public.{s} FROM PUBLIC, anon, authenticated;")

print(f"\n  ALL CHECKS PASS: {ok}")
sys.exit(0 if ok else 1)
