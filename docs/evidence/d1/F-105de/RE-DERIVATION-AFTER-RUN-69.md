# F-105d + F-105e — re-derived after run #69 refused 0023

Supersedes: `20260910_0023_f105de_…` (PR #232), to be closed unmerged.
Unit: `supabase/migrations/20260910_0024_f105de_referral_reward_production_close.sql`
Rollback: `supabase/rollback/20260910_0024_…_ROLLBACK.sql`
Gate probe: `supabase/migrations/PROBE_f105de_referral_reward_production_closed.sql`
Source dump: `supabase/migrations/PROBE_process_referral_reward_source_dump_readonly.sql`
Test: `src/lib/__tests__/referralRewardProductionRederive.test.ts`
Branch: `d1/P01-f105de-production-rederive`, cut from `origin/main` at `c424285`.
Date: 2026-09-12.

**Prepared, not applied.** Applying is the Owner's/Auditor's action through
`apply-migration.yml` against the production environment.

## What run #69 established

0023 was dispatched against production and **refused itself** at P2:

```
P2 FAILED — the live 2-arg body is md5 7999749b88688973dc95680d68ae5e86 (1416 bytes),
not a82168c949cbc3eef0dad32e17961730 (1371 bytes) as main's 20260228101821 defines it.
```

Nothing was applied. The transaction rolled back. **That is the gate working.**
The remedy 0023's own header prescribes — re-derive from the live prosrc, never
weaken the check — is what this unit does.

## The correction, and it inverts what 0023 believed

`7999749b88688973dc95680d68ae5e86` / 1416 bytes is not an unknown value. It is
**byte-for-byte the 2-arg body in staging's `20260911101721` bootstrap
snapshot** — the snapshot of the *old* staging project. Recomputed from that
file rather than recognised:

| | md5 | bytes |
|---|---|---|
| production, live (run #69) | `7999749b88688973dc95680d68ae5e86` | 1416 |
| staging bootstrap snapshot, 2-arg | `7999749b88688973dc95680d68ae5e86` | 1416 |

So production runs the same body staging inherited, which means:

> **Production already has BUG-049 (the `FOR UPDATE` lock) and BUG-047 (the
> self-referral guard).**

0023's header asserted the opposite — that production lacked both, and that
porting staging's bodies would smuggle two behaviour fixes into production
inside a security migration. **That reasoning was sound and its premise was
wrong.** Main's `20260228101821` and `20260228102118` do not describe
production; they are **stale**. The drift is in the repository, not the
database. Whatever applied BUG-047/BUG-049 to both lanes left no migration on
main.

This is the fourth time in this project a claim repeated from a document has had
to be corrected against the running thing (C-38, C-42, C-44, C-45). It is the
first time the correction cost nothing, because the check was written before the
claim was acted on.

### The hazard has inverted too

0023 was built to avoid *adding* BUG-047/049 to production. The live hazard is
now the exact opposite: a file built from main's stale source would **silently
strip them**. Two tests pin that directly, and the mutation run confirms they go
red when the stale bodies are substituted.

The same applies to the rollback. **0023's rollback must not be run** — it would
restore main's stale bodies and remove BUG-047/049 from production. 0024's
rollback restores the bootstrap bodies, which is what production actually has.

## What this unit installs

Because production's pre-state is staging's pre-state, the finished bodies are
staging's finished bodies. Sliced from the migrations that produced the running
objects on staging — not retyped, not reconstructed from the catalogue:

| overload | sliced from | md5 | bytes |
|---|---|---|---|
| 2-arg | staging `20260910_0019_f105d` | `f7242f2cc0989c74ff3731abfc2500ba` | 2483 |
| 3-arg | staging `20260910_0022_f105e` | `df71a90afca03692c1873846c72771cc` | 3291 |

Both re-verified against staging's **live** `pg_proc` before this file was
written. There is no grafting and no body surgery in 0024 — 0023 needed both
because it was fitting a guard onto a different body; the two lanes agree, so
the whole class of error that truncated 0023's first guard cannot occur here.

Applied, production and staging hold byte-identical definitions of both
overloads.

## Measured on production vs still inferred

**Measured** — the only production readings that exist, all from run #69's
refusal:

* exactly **two** overloads, both resolvable by the identity signatures this
  unit uses (P1 passed);
* the 2-arg body is `7999749b88688973dc95680d68ae5e86`, 1416 bytes.

**Not measured**, because P2 raised before reaching them:

* the 3-arg body — 0024 expects the bootstrap's `5a69d3fa…` / 2224 bytes, which
  is an **inference** from the 2-arg matching, not a reading;
* whether the DEFAULT is still present on the 3-arg (P3 never ran);
* the ACL on either overload;
* whether production's PostgREST returns PGRST203. Still inferred; no production
  HTTP request has ever been issued.

0024's gate separates these: **P2a** is the measured 2-arg check, **P2b** the
inferred 3-arg one, and P2b's failure message says so in terms, so a red gate
there reads as *the inference was wrong* rather than as a fault in the file.

## The source-dump probe

`PROBE_process_referral_reward_source_dump_readonly.sql` exists so the remaining
inferences can be turned into readings **without anybody handling the production
credential** — the thing this repository's whole apply-migration design exists
to avoid.

| property | how it holds |
|---|---|
| writes nothing | no DDL, DML, GRANT, function or policy; asserted in the test against the file's *code*, not its prose |
| reads no member data | only `pg_proc` / `pg_get_functiondef()`; no `referrals`, `wallet_transactions`, `profiles`, `site_settings`, `auth.users` |
| no credential exposure | nothing reads, prints or derives from `$DB_URL`; the only identifier printed is `current_database()`, which is `postgres` on every Supabase project |
| output is code, not data | both definitions are already public in this repository; what is *not* public is which version production runs, and that is the one question it answers |

Validated by running both of its sections against **staging** before shipping —
section 1's SELECT returned the expected catalogue row per overload, and the
`DO $dump$` block executed without error.

⚠ A green run of it proves nothing about any migration. It reports what is
there.

## Verified here — source and tests only

| check | result |
|---|---|
| `referralRewardProductionRederive.test.ts` | **30 passed** |
| mutation: main's stale bodies substituted (strips BUG-047/049) | red (4) |
| mutation: gate re-pinned to main's disproved md5s | red (2) |
| mutation: guard truncated on the 3-arg | red (2) |
| mutation: `DEFAULT 0` left on the 3-arg | red (6) |
| mutation: dump probe given a write | red (1) |
| mutation: dump probe made to read member data | red (1) |
| full suite on this branch | **0 failed, 2585 passed** |
| typecheck · lint | clean |

## Suggested order (Owner/Auditor)

1. **`PROBE_process_referral_reward_source_dump_readonly.sql`** — read-only.
   Turns the three remaining inferences into readings. Compare its output
   against 0024's P2a/P2b/P3 expectations.
2. If the 3-arg body or the default count disagrees, **re-derive from that
   output**. The 2-arg is confirmed and can be left alone. Do not weaken the
   gate; do not force the file.
3. `PROBE_f105de_referral_reward_production_closed.sql` — **expect red** (G2/G3
   for F-105e, G5/G7 for F-105d). If it comes back green, stop: production is
   not in the state this unit assumes.
4. `20260910_0024_f105de_referral_reward_production_close.sql`.
5. `PROBE_f105de_referral_reward_production_closed.sql` again — expect all nine
   gates green.
6. Optionally re-take the HTTP reading with the production publishable key (the
   two-key body, with the three-key body as its control) to close the one thing
   an in-database probe cannot see.

## Filenames

0023 is taken by the superseded attempt (PR #232); 0020 and 0021 are taken on
main; staging holds 0019 and 0022. **0024** is the next ordinal free on every
branch. Should 0023 and 0024 somehow both land, they are defended in depth:
0023's P2 would refuse against the state 0024 leaves.

The gate probe deliberately keeps the **same filename** as #232's. Exactly one
of the two PRs should ever merge; an identical path makes a double-merge a loud
git conflict rather than two near-identical probes landing silently.
