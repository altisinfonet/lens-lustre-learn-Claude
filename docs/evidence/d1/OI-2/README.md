# OI-2 · `email_exists(text)` — close the enumeration oracle to `authenticated`

**Status: NOT APPLIED anywhere.** Written, fixture-proved, PR open. Staging apply
is blocked on a merge (see §5).

## 1 · The caller set, proved before proposing — the Auditor's condition

Measured by D1, 2026-09-05, at staging HEAD, over the whole repository:

| searched | result |
|---|---|
| `supabase/functions/` — **114 files** | **zero** references to `email_exists` |
| `functions/` — **8 files** | **zero** references |
| whole tree, **no filename filter**, excluding `node_modules` and `.git` | `src/pages/ForgotPassword.tsx:39` — the only runtime caller; `src/pages/verifyCertificateErrors.ts:37` — a comment, not a call |

**Auth context of that one caller:** `src/App.tsx:376` routes `/forgot-password`
alongside `/login` and `/signup`, outside any protected wrapper. An
**anonymous-visitor flow**. A signed-in user has no reason to be there.

**And it is fail-open**, in source at `ForgotPassword.tsx:37-52` — a refusal sets
`checkError`, the assignment is skipped, `exists` stays `null`, and
`null === false` is false, so the reset still sends. Two independent mechanisms.
The Auditor confirmed the same shape in the live production bundle,
`ForgotPassword-BJl06yD9.js`, across all 141 chunks.

**Conclusion: no caller requires `authenticated`, and the one caller cannot
break when the grant is withdrawn — because it already cannot break when the
call fails.**

## 2 · ⚠ This exceeds the frozen list, and the list is now out of step

Frozen revocation list §2.1 authorises `FROM public, anon` **and no more**. P30
refused to vary and raised the gap instead. The Auditor gave the call on
2026-09-05. **§2.1 still reads "public, anon", so a reader comparing the two
finds a migration exceeding its authorising document.** D1 cannot edit the
frozen list — it is the Auditor's, and the freeze is the point. **The list
should be revised to match.** Recorded in the migration header, not only here.

## 3 · Why `authenticated` was never a real bar

Anyone may create an account. `authenticated` is a **turnstile, not a wall**: an
attacker signs up once and asks about every address they like. What it does buy
— attributability and rate-limitability — is a reason to prefer it over `anon`,
not a reason to leave the door open once no caller needs it.

## 4 · C-34 — the probe shown failing first

Fixture: PostgreSQL 16, `email_exists` built in **production's post-P30 shape**
(`anon` closed, `authenticated` open).

```
fixture acl : postgres=X/postgres | authenticated=X/postgres | service_role=X/postgres
              anon=false authenticated=true service_role=true

STEP 1  probe BEFORE the migration
  ERROR: D2 FAILED — authenticated can still EXECUTE public.email_exists (oid 16387)
  exit code: 3

STEP 2  migration applied
  acl now: postgres=X/postgres | service_role=X/postgres

STEP 3  probe AFTER
  D5 ok — exactly one public.email_exists, oid 16387
  D3 ok — PUBLIC entries = 0, so the per-role readings below mean something
  D2 ok — authenticated CANNOT execute (the unit)
  D1 ok — anon still cannot execute (P30 has not regressed)
  D4 ok — service_role retains EXECUTE (not an over-revoke)
  exit code: 0
```

**Every assertion demonstrated capable of firing:**

| control | result |
|---|---|
| rollback restores `authenticated` | **D2 red again** — and `anon` stays closed, so P30 is not reopened |
| `service_role` stripped (over-revoke) | **D4 red** |
| PUBLIC regains EXECUTE (F-66 re-armed) | **D3 red** |
| an overload created | **D5 red** — refuses to continue |

### ⚠ A defect in my own probe, found by the control and fixed

The PUBLIC control first fired **D2, not D3**. A function has only one privilege,
so when PUBLIC holds EXECUTE, `has_function_privilege('authenticated', …)` is
true **by inheritance** — D2 fires every time and **D3 was unreachable**.

Worse than dead code, it was a **wrong diagnosis**: D2's message sends the reader
hunting for a stray `GRANT` to `authenticated` when the real cause is a
`DROP`+`CREATE` reopening the function to PUBLIC (F-66). **The cause must be
reported before the symptom**, so the probe now orders D5 → **D3** → D2 → D1 → D4.
Re-run of the control then produced D3 correctly.

Recorded rather than quietly reordered: a negative control that finds a hole in
the instrument is the control doing its job.

## 5 · What is NOT done, and why

**The staging apply.** `apply-migration.yml` enforces
`target=staging ⇒ branch must be staging`, so the file must be **merged into
`staging`** before it can be applied there. This PR is that merge. The apply, and
the authenticated + anon HTTP proofs the Auditor asked for, follow it.

**No HTTP proof yet** — neither authenticated nor anon. The catalogue probe is
half the proof and says so in its own header.
