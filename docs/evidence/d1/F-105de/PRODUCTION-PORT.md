# F-105d + F-105e — the production port, and exactly how far it has been verified

Unit: `supabase/migrations/20260910_0023_f105de_referral_reward_production_close.sql`
Rollback: `supabase/rollback/20260910_0023_..._ROLLBACK.sql`
Probe: `supabase/migrations/PROBE_f105de_referral_reward_production_closed.sql`
Test: `src/lib/__tests__/referralRewardProductionClose.test.ts`
Branch: `d1/P01-f105de-production-close`, cut from `origin/main` at `c424285`.
Date: 2026-09-12.

Owner authorisation for preparing this, verbatim: **"yes"**, to preparing the
production-side migration now. **Applying it is not this author's action** — it
is the Owner's/Auditor's, through `apply-migration.yml` against the production
environment, as 0019, 0020 and 0021 were.

This targets `main` rather than `staging` as a deliberate, Owner-authorised
exception to "branch off staging only", on the same footing as 0019/0020/0021.

## Objects reserved

`public.process_referral_reward(uuid, text)` ·
`public.process_referral_reward(uuid, text, numeric)`

## Why one file

`apply-migration.yml` runs one file per dispatch, each dispatch waits on its own
production environment approval, and psql runs **without**
`--single-transaction`. 0020's header makes this argument for the birthday pair;
here it is sharper, because the two fixes pull against each other:

* F-105e **requires** a DROP — a default cannot be removed by
  `CREATE OR REPLACE` (`42P13 cannot remove parameter defaults from existing
  function`, measured on a throwaway function).
* A DROP resets the ACL: the built-in EXECUTE-to-PUBLIC default lands (F-66) and
  `ALTER DEFAULT PRIVILEGES` re-grants anon, authenticated and service_role.

Ported as two dispatches, the F-105e half would republish a VOLATILE
SECURITY DEFINER function that calls `wallet_transaction()` **to anon**, and
leave it there until a human approved the next dispatch. In one transaction the
window is zero.

## The thing that changed the file: production has drifted from staging

Checking rather than assuming caught this. Main's definitions are **not**
staging's:

| | main (production lane) | staging |
|---|---|---|
| `FOR UPDATE` on the pending-referral SELECT | absent | present (BUG-049) |
| self-referral guard | absent | present (BUG-047) |

Staging carries both, inherited through the 2026-09-11 bootstrap snapshot of the
**old** staging project. Nothing on main introduces them.

So lifting staging's finished bodies would have smuggled two behaviour fixes
into production inside a security migration. **This file ports the fix, not the
body**: the guard block sliced from staging's `20260910_0019_f105d`, grafted
onto main's own bodies from `20260228101821` and `20260228102118`.

Whether production should also get BUG-047/BUG-049 is a real question and a
**separate unit** with its own gate. It is not decided here.

## How the slicing was verified

| check | result |
|---|---|
| guard sliced verbatim from staging 0019 | 1051 bytes, md5 `d9b6a218aaeaa4aeb37c3ff3d0caeaf1` |
| guard identical in both of staging's overloads | yes |
| 2-arg body in the finished file, guard removed, vs main `20260228101821` | byte-identical |
| 3-arg body in the finished file, guard removed, vs main `20260228102118` | byte-identical |
| deltas from main | the guard, one `_caller uuid;` declaration, the removed DEFAULT — nothing else |

### A correction worth recording

The first generated version of this file was **wrong, and the test caught it.**
The slice regex was non-greedy and terminated at the first
`USING ERRCODE = '42501'` — which is the NULL-caller check — so the guard was
truncated at 799 bytes and **the self-or-admin check was missing entirely**.

The bodies still compiled. They still round-tripped back to main's source when
the slice was removed. They still contained something that looked like a guard.
They authorised nothing.

The round-trip check proved **reversibility** and was mistaken for proof of
**sufficiency**. Those are different properties, and only the test asserting the
guard's *contents* distinguished them. A regression test now pins it directly
(`the guard grafted into each body is COMPLETE, not truncated`), and the
generator asserts the same fragments before writing.

## The precondition gate

This file was written **without production database access**. Its bodies come
from main's migration source, which records what was *dispatched*, not what is
*running* — and this very unit found two lanes disagreeing about the same
function.

So the transaction opens by asserting, before changing anything:

* P1 — exactly two overloads, both resolvable by signature;
* P2 — the live `prosrc` md5s equal main's source: 2-arg
  `a82168c949cbc3eef0dad32e17961730` (1371 bytes), 3-arg
  `12b13af9a3bfce42f6294d12d3e7d9cf` (2356 bytes);
* P3 — the 3-arg still carries exactly one default, i.e. the unfixed state.

If production has drifted again, P2 fails and the whole file rolls back. **That
is the correct outcome, not a malfunction** — without it, `CREATE OR REPLACE`
would overwrite the live body with main's and silently revert the difference.
The remedy is to re-derive this migration from the live `prosrc`, never to
weaken the check.

## Verified here — source and tests only

| check | result |
|---|---|
| `referralRewardProductionClose.test.ts` | **32 passed** |
| mutation check: guard truncated | red (4 tests) |
| mutation check: `DEFAULT 0` left on the 3-arg | red (2) |
| mutation check: staging body smuggled in (`FOR UPDATE`) | red (1) |
| mutation check: precondition gate removed | red (3) |
| mutation check: split into two transactions | red (3) |
| mutation check: grants moved before the CREATE (F-66) | red (1) |
| full suite on this branch | **0 failed, 2587 passed** |
| typecheck (`tsc -p tsconfig.app.json --noEmit`) | clean |
| lint (eslint, new file) | clean |

## NOT verified — read before signing off

**No part of this has been run against production. This lane has no production
database access and no route to the production REST endpoint.**

Specifically unmeasured:

1. **That production's live bodies match main's source.** The precondition gate
   turns this from an assumption into a check, but that check has never been
   executed. It may fail on first run.
2. **That production's PostgREST returns PGRST203 for the two-key call.**
   Inferred from main carrying the same two overloads with the same DEFAULT, the
   same two-key call site in `AdminReferrals.tsx`, and no removing migration. No
   production request has been issued.
3. **That production's current ACL on these functions is what this file
   expects.** The end-state gate asserts the ACL this file *leaves* — which is
   what matters for safety — and deliberately asserts nothing about what it
   found.

What **was** measured, on staging (`fpszggreishhuvdpkmdr`), by the same fixes
this file ports: the 300 → 401 transition over real HTTP through PostgREST; the
cross-member call refused and the self-call still admitted; the ACL surviving
the DROP+CREATE. See `docs/evidence/d1/F-105e/OVERLOAD-RESOLUTION-HTTP.md` and
apply-migration runs #61, #63, #64, #65, #66, #67.

**A run of this file against production is also the first measurement of it.**
The gates are written to make that safe, not to pretend it already happened.

## Suggested apply order (Owner/Auditor)

1. `PROBE_f105de_referral_reward_production_closed.sql` — **expect red.** G2/G3
   (F-105e) and G5/G7 (F-105d) should fail. That is the C-34 fail-first reading
   and, here, the first real measurement of production. If it comes back green,
   stop: production is not in the state this unit assumes.
2. `20260910_0023_f105de_referral_reward_production_close.sql`. If P2 fails,
   **do not force it** — re-derive from the live `prosrc`.
3. `PROBE_f105de_referral_reward_production_closed.sql` again — expect all nine
   gates green.
4. Optionally re-take the HTTP reading with the production publishable key, the
   two-key body with the three-key body as its control, to close the one thing
   the in-database probe cannot see.

## Filename

0020 and 0021 are taken on main; staging holds 0019 and 0022. **0023** is the
next ordinal free on both branches, and `f105de` collides with no file on
either. (main and staging already hold a different `20260910_0019` each — known
and accepted, see `docs/evidence/d1/F-105e/OVERLOAD-RESOLUTION-HTTP.md`.)
