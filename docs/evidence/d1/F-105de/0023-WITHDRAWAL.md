# 0023 withdrawn — the file whose refusal produced 0024

Unit: withdraw `20260910_0023_f105de_…` and its rollback from the runnable set.
Branch: `d1/P01-withdraw-0023`, cut from `origin/main` at `d0c18e1`.
Date: 2026-09-12.

No SQL is applied by this unit. It changes filenames, adds two headers, and
repoints one test.

## Why

Both #232 (0023) and #234 (0024) were merged; #232 was meant to be closed
unmerged. So main carries a superseded migration, its rollback, and a test that
had gone red.

`0023` was dispatched against production as **run #69** and refused itself at
its own P2 precondition gate — the live 2-arg body was
`7999749b88688973dc95680d68ae5e86` (1416 bytes), not the
`a82168c949cbc3eef0dad32e17961730` (1371) main's `20260228101821` defines.
Nothing applied. **Run #70's source dump** then showed why: production runs the
bootstrap-snapshot bodies, carrying BUG-049's `FOR UPDATE` lock and BUG-047's
self-referral guard. Main's `20260228*` files are stale.

## The rollback is the actual hazard

0023's migration protects itself — its P2 gate refuses, which is exactly what
run #69 demonstrated. **Its rollback carries no gate.** Run by hand against
production it would, in one transaction and without objecting:

1. replace both bodies with main's stale versions, **stripping BUG-049 and
   BUG-047**; and
2. `GRANT EXECUTE … TO PUBLIC, anon, authenticated, service_role` on a VOLATILE
   `SECURITY DEFINER` function that calls `wallet_transaction()` — where run #70
   measured `postgres | service_role | authenticated`, with **no PUBLIC and no
   anon**.

A rollback that leaves the system more open than it found it is not a rollback.

## What was done

| change | why |
|---|---|
| `supabase/migrations/20260910_0023_…sql` → `UNAPPLIED_20260910_0023_…sql` | the repository's existing marker for SQL kept in the tree but not for dispatch |
| `supabase/rollback/20260910_0023_…_ROLLBACK.sql` → `UNAPPLIED_…_ROLLBACK.sql` | same |
| withdrawal banner at the top of both | so the reason travels with the file, not just with a PR nobody reads twice |
| `referralRewardProductionClose.test.ts` → `referralReward0023Withdrawn.test.ts`, rewritten | see below |

The `UNAPPLIED_` prefix is not invented here: it is already carried by
`UNAPPLIED_20260824000000_admin_user_list_pagination.sql`,
`UNAPPLIED_20260820140000_classF_repoint_originals_ROLLBACK.sql` and others.

### Renaming this file is not the thing we refused to do to 0019

Staging's `20260910_0019` was deliberately **not** renamed, even though it
shares an ordinal with a different file on main, because it **has been applied**
— run #61 — and renaming an applied migration leaves the repository holding a
name that does not match what the run log says ran.

`0023` **never applied**. Run #69 rolled back. Nothing in any run log becomes
untrue by renaming it, and run #69 itself is preserved in git history and in
PR #232. The distinction is the whole reason one was refused and the other is
right.

### The test was repointed, not deleted

`referralRewardProductionClose.test.ts` was 32 assertions pinning 0023's
internals, and was red on main: #234 replaced the gate probe both units read
under the same filename, and the old test asserted wording the new probe does
not carry.

**Deleting a red test to get a clean run is the one move this project forbids
outright**, so it was not deleted. It was rewritten to assert what is now worth
asserting — that 0023 stays withdrawn:

* neither directory contains a runnable `0023_f105de` filename;
* both files carry their withdrawal banner, and the rollback's is the stronger
  one because it has no gate;
* the superseding 0024 is present and runnable — withdrawing 0023 is only safe
  because it exists;
* the rollback **still contains** the `TO PUBLIC, anon, …` grant and main's
  stale bodies. Withdrawn means *kept as it was, out of reach*, not *quietly
  fixed* — if someone softens the file, the banner would be describing
  something that no longer exists, and that must fail.

## Verified

| check | result |
|---|---|
| `referralReward0023Withdrawn.test.ts` | **10 passed** |
| mutation: runnable migration filename restored | red |
| mutation: runnable rollback filename restored | red |
| mutation: banner dropped from the rollback | red (2) |
| mutation: rollback "quietly fixed" instead of withdrawn | red |
| mutation: superseding 0024 goes missing | red |
| full suite, this branch | **12 failed files / 190 failed tests**, of 3415 |
| full suite, `origin/main` @ `d0c18e1` | **13 failed files / 191 failed tests**, of 3437 |
| → delta | **−1 file, −1 test: exactly the red test retired.** Every other failing file and count identical; no new failures |
| typecheck · lint | clean |

The two migration-scanning gates (`newTableGrants`, `securityDefinerGrants`)
filter on a 14-digit filename prefix, which `20260910_0023_…` never matched, so
these files were already outside their scope and the rename cannot shift those
counts. Checked before the rename, not after.

## Not done here

The 149 + 27 failures in `newTableGrants` / `securityDefinerGrants`, and the
other ten red files, are pre-existing and unrelated — they come from the
2026-09-11 staging bootstrap reaching main. Untouched, and not this unit's.
