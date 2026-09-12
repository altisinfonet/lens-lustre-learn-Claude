# OI-3 · `verify_certificate_by_token(text)` — disarm the F-62 trap, change nothing else

**Status: NOT APPLIED anywhere.** Written, fixture-proved, PR open. Staging apply
is blocked on a merge (see §5).

## 1 · This function MUST stay anon-callable. That is the requirement, not a risk

Public certificate verification is the feature: someone handed a certificate must
be able to check it without an account. P31's probe asserts it at **C6/C7**, and
P31's migration says *"Verify-by-unguessable-token stays public via
verify_certificate_by_token; search-by-identity does not."*

**So OI-3 closes nothing.** It removes one redundant ACL entry and leaves
observable behaviour byte-for-byte identical.

## 2 · What is actually wrong — the F-62 shape

The Auditor's reading on production, 2026-09-05:

```
acl = =X/postgres | postgres=X | anon=X | authenticated=X | service_role=X
       ^^^^^^^^^^                ^^^^^^
       PUBLIC grant              explicit anon grant
```

**Both** are present. `anon` executes twice over. Nothing is broken today — the
trap is what happens next. The day anyone decides this function should stop being
anon-callable, they will write `REVOKE … FROM anon`, it will succeed, the
catalogue will look changed, and **anon will still execute through PUBLIC**.

That is not hypothetical. It is exactly how F-62 was found, on
`get_top_contributors_v2`, by a negative control that failed to fail.

**Removing PUBLIC now means that future statement would work. The door stays
open; the lock starts working.**

## 3 · Why it cannot change behaviour — asserted, not argued

`PUBLIC` and `anon` are separate grantees. After the migration `anon` still holds
its own explicit entry, so every caller sees the same thing. The probe **requires
`has_function_privilege('anon', …)` to be TRUE after the migration** and requires
a real token to still return a row. **A migration that closed public verification
would fail its own probe.**

⚠ If `anon` did *not* hold an explicit grant, this file would be an outage. It
does, on both lanes. The probe's **E2** asserts it so a future lane where it is
not true fails loudly instead of going dark.

**The one caller:** `src/pages/CertificateVerifyByToken.tsx:44`, an
anonymous-visitor route. Zero references in `supabase/functions/` or `functions/`.

## 4 · C-34 — the trap demonstrated, then disarmed

Fixture: PostgreSQL 16, reproducing **production's exact ACL shape**.

```
fixture acl : =X/postgres | postgres=X/postgres | anon=X/postgres
              | authenticated=X/postgres | service_role=X/postgres

THE TRAP, LIVE
  REVOKE ALL ON FUNCTION ... FROM anon;
  -> anon can execute? TRUE
  ^ F-62: the revoke succeeded and closed NOTHING

STEP 1  probe BEFORE
  ERROR: E3 FAILED — PUBLIC still holds EXECUTE on oid 16402 (1 entry)
  exit code: 3

STEP 2  migration applied
  acl now: postgres=X/postgres | authenticated=X/postgres
           | service_role=X/postgres | anon=X/postgres

STEP 3  probe AFTER
  E4 ok — a real token still returns 1 row(s)
  E1 ok — exactly one public.verify_certificate_by_token, oid 16402
  E3 ok — PUBLIC entries = 0 (F-62 trap disarmed)
  E2 ok — anon CAN still execute, through its own explicit grant (the feature)

STEP 4  and NOW the future revoke actually works
  REVOKE ALL ON FUNCTION ... FROM anon;
  -> anon can execute? FALSE          ^ the lock works
  (restored immediately — anon MUST keep it)
```

**Controls:**

| control | result |
|---|---|
| `anon` loses its grant (the outage case) | **E2 red** — *"PUBLIC CERTIFICATE VERIFICATION IS DOWN"* |
| rollback re-arms the trap | **E3 red** |

**E4 is the assertion that matters most.** A grant is not a feature: E2 says anon
is *allowed* to call it, E4 says calling it still *answers*. E4 skips **loudly**
when a lane holds no certificate with a token — a probe that silently passes on
an empty table is a probe that stopped testing.

**Assertion order is deliberate:** E3 (PUBLIC) is checked before E2 (anon),
because while PUBLIC holds the grant the anon reading is true for the wrong
reason. It only means what it says once E3 has passed. This is the same ordering
lesson the OI-2 control taught — see `docs/evidence/d1/OI-2/README.md` §4.

## 5 · What is NOT done

**The staging apply.** `apply-migration.yml` enforces
`target=staging ⇒ branch must be staging`, so the file must be **merged into
`staging`** first. This PR is that merge; the apply and the anon HTTP proof
follow it.

**F-66 is not fixed and this file does not pretend to fix it.** A future
`DROP`+`CREATE` re-applies the built-in EXECUTE-to-PUBLIC default and the PUBLIC
entry returns, re-arming the trap. No migration prevents that — only a re-apply
and a re-proof after any recreate. The probe is the instrument for noticing.
