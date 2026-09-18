# Run #70 — production's live source, measured at last

Probe: `supabase/migrations/PROBE_process_referral_reward_source_dump_readonly.sql`
Run: #70, target=production, **success**, 2026-09-12T18:34:52Z. Read-only; the
log ends `COMMIT` with nothing written.
Server: PostgreSQL 17.6.

## The readings

| | 2-arg (oid 20345) | 3-arg (oid 20346) |
|---|---|---|
| `prosrc` md5 | `7999749b88688973dc95680d68ae5e86` | `5a69d3fa10a09745b9bfd1a5a7d48690` |
| bytes | 1416 | 2224 |
| parameter defaults | 0 | **1** |
| SECURITY DEFINER | t | t |
| volatility | v | v |
| `proconfig` | `search_path=public` | `search_path=public` |
| `proacl` | `postgres=X/postgres \| service_role=X/postgres \| authenticated=X/postgres` | same |

Both bodies carry `-- BUG-049: lock the pending referral …` with `FOR UPDATE`,
and `-- BUG-047: never reward a self-referral.` with
`IF _referral.referrer_id = _referred_user_id THEN RETURN; END IF;`.

## Against 0024's gate — every body expectation CONFIRMED

| gate | expected | measured | |
|---|---|---|---|
| P1 | exactly two overloads, resolvable by signature | 2, oids 20345 / 20346 | ✅ |
| P2a | 2-arg `7999749b…` / 1416 | same | ✅ measured already at run #69 |
| P2b | 3-arg `5a69d3fa…` / 2224 | same | ✅ **the inference was correct** |
| P3 | 3-arg has exactly 1 parameter default | 1 | ✅ |

**This was not the disagreement case for the bodies.** The inference that
production carried the same bootstrap-snapshot body on both overloads — drawn
from the 2-arg matching — held. 0024's precondition gate will pass as written.

## The one reading that DID disagree: the ACL

It was listed as unmeasured, and the assumption behind it was wrong.

```
postgres=X/postgres | service_role=X/postgres | authenticated=X/postgres
```

**No PUBLIC entry. No anon entry.** Production is *not* on Supabase's default
ACL for a function in schema `public`. It had already closed both, by some route
that left no migration on main — the same way it acquired BUG-047 and BUG-049.

### What that does and does not change

**0024 itself: nothing.** Its declared end state is `authenticated` +
`service_role` and no PUBLIC/anon, which is exactly what production already has.
The ACL statements in section 3 become a no-op, and the end-state gate still
proves the result rather than assuming it. Applied, the ACL is unchanged.

**0024's ROLLBACK: it was wrong, and in the dangerous direction.** It granted

```sql
GRANT EXECUTE ON FUNCTION … TO PUBLIC, anon, authenticated, service_role;
```

on the assumption that the pre-state was the Supabase default. It is not. That
grant would not have restored the pre-state — it would have **added PUBLIC and
anon** to a VOLATILE `SECURITY DEFINER` function that calls
`wallet_transaction()`, on a database that had already closed them. A rollback
that leaves the system more open than it found it is not a rollback.

Corrected: it now revokes from every role and grants only `authenticated,
service_role` — the ACL run #70 measured.

A regression test pins it (`restores the ACL run #70 MEASURED — never grants
PUBLIC or anon`), and the mutation run confirms it goes red if the old grant, or
an anon-only variant, or a missing REVOKE is reintroduced.

### The general lesson, which this family keeps teaching

"The default" is not a measurement. The only reason this was caught before it
ran is that the ACL was written down as **UNMEASURED** rather than quietly
assumed, and someone then went and measured it. The gate that refused run #69
bought the same thing for the bodies.

## Also changed in 0024

* The header's measured/inferred section now reflects run #70 instead of
  claiming the 3-arg and the DEFAULT are unknown.
* P2b's failure message no longer says "this expectation was inferred" — it is a
  measured check now, so a failure means production changed after 2026-09-12.
* **P4 added**: records the pre-ACL of both overloads as a `RAISE NOTICE`.
  Deliberately *not* an assertion — correcting the ACL is part of this file's
  job, so refusing because the ACL is wrong would refuse the very case it exists
  to fix. Recording it puts the before-state in the same audit-trailed log as
  the after-state, which is what a rollback author needs, and what this unit got
  wrong once already.
* A standing instruction: if 0024 is re-dispatched after a delay, run the
  source-dump probe again first. These readings are from 2026-09-12.

## Still not measured

Whether production's PostgREST actually returns `PGRST203` for a two-key call.
Both overloads and the DEFAULT are now confirmed present, so the inference is
better supported than it was — but **no production HTTP request has ever been
issued**. It stays labelled as an inference.

## Two things about main that are not this unit's to fix

Found while running the suite; reported rather than bundled.

1. **#232 and #234 were both merged.** #232 was meant to be closed unmerged. So
   `20260910_0023_f105de_…` and its rollback are on main.
   ⚠ **0023's rollback must never be run**: it restores main's stale
   `20260228*` bodies, which would strip BUG-049 and BUG-047 from production,
   and it re-grants PUBLIC and anon. 0023's migration itself is harmless — its
   own P2 would refuse — but it is superseded.
2. **`src/lib/__tests__/referralRewardProductionClose.test.ts` is red on main**
   (1 assertion, pre-existing, present in the `origin/main` baseline). Cause:
   #234 replaced the shared gate probe, which both units read under the same
   filename, and #232's test asserts wording the new version does not carry.

   That filename reuse was my deliberate call, on the reasoning that a
   double-merge would surface as a loud git conflict. It did not: the merges
   were sequential, so #234's version simply won and the breakage surfaced as a
   red test instead. The intent — loud rather than silent — held; the mechanism
   I predicted did not.

**Suggested follow-up, as its own unit:** rename both 0023 files with the
repository's existing `UNAPPLIED_` prefix (the convention already used by
`UNAPPLIED_20260820140000_classF_repoint_originals_ROLLBACK.sql` and others),
and retire #232's test with it. Deliberately not done here — one unit per PR,
and deleting or renaming another unit's files inside a correction PR is how
scope falls off.

## Verified here — source and tests only

| check | result |
|---|---|
| `referralRewardProductionRederive.test.ts` | **34 passed** |
| mutation: rollback re-grants PUBLIC+anon | red |
| mutation: rollback grants anon only | red |
| mutation: rollback drops its REVOKE | red |
| mutation: P4 made a refusal instead of a record | red |
| mutation: header still claims the 3-arg is unmeasured | red |
| full suite, this branch | 13 failed files / 191 failed tests, of 3437 |
| full suite, `origin/main` baseline | 13 failed files / 191 failed tests, of 3433 |
| → new failures introduced | **zero** — identical file list and counts |
| typecheck · lint | clean |
