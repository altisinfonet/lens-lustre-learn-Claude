# P31 (database half) — `search_certificates` off `anon`. Evidence.

**Unit:** P31 · Phase 1 · D1 · branch `d1/P31-search-certificates-revoke-20260910` off `staging` (`38ee368`)
**Authority:** `docs/gates/P1-revocation-list.md` rev 2 (blob `88c08093`) §2.2 — which **BLOCKS** this
revoke on a client fix. This unit is **PREPARED, NOT AUTHORISED, NOT APPLIED.**

---

## 1 · ⚠ THE PRECONDITION, FIRST, BECAUSE IT IS THE POINT OF THE UNIT

§2.2 blocks `search_certificates` because all four verification pages collapse *error* and *empty*
into one branch — `VerifyCertificate.tsx:81`, `:103`, `CertificateVerifyByToken.tsx:46`,
`IDVerification.tsx:63`. Applied today, **a real certificate holder is told, calmly and confidently,
that their certificate could not be verified.** That reads as a forgery and gets reported by nobody.
**A silent wrong answer is worse than an error.**

**Apply precondition:** D2's client fix merged and live on the lane being changed, then the Auditor
authorises, staging first. The purpose of this unit is that when D2 lands, **the revoke is a decision
and not a project.**

---

## 2 · The gate, verbatim, and what this unit does with each clause

> **P31** — name-based certificate search removed from `anon`; verification by token retained and
> tested; `verify_staff_id` placed behind a session or a rate limit.

| clause | this unit | instrument |
|---|---|---|
| 1 · name search off `anon` | **closes it on apply** | probe **C2** — `has_function_privilege('anon', oid, 'EXECUTE') = false`, per function, per lane |
| 2 · verify-by-token retained **and tested** | **tests it** | probe **C6** (still anon-executable) and **C7** (still returns a row for a real token). *"Retained" is a thing to be shown still working, not left alone and assumed.* |
| 3 · `verify_staff_id` behind a session or rate limit | **NOT touched** | out of scope by instruction, and not a revocation at all — C-60. Separate unit. |

**P31 does not close until all three close.**

---

## 3 · ⚠ THE DIFFERENCE FROM P30: HERE F-62 GENUINELY BITES

Measured by D1 2026-09-04, `SELECT` only, **both lanes**:

| object | production oid | staging oid | `proacl` | PUBLIC EXECUTE entries |
|---|---|---|---|---|
| `search_certificates` | 22560 | 17985 | `{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}` | **1** |
| `verify_certificate_by_token` | 22558 | 18037 | same shape | **1** |
| `verify_certificate` | 25132 | 18036 | same shape | **1** |
| `increment_managed_page_view` | 25056 | 17866 | `{postgres=X,anon=X,authenticated=X,service_role=X}` | **0** |

**The leading `=X/postgres` is the PUBLIC grant** — the entry with no grantee name. A reader skimming
for `anon` sees `anon=X` and stops; the empty-left-hand-side entry is the one that decides it.

**Lane comparison, since a divergence would itself be a finding: there is none.** Identical ACL
strings on both lanes for all four objects; oids differ, as expected. Reported as a measurement, not
as an absence assumed.

**So unlike `email_exists` (P30, 0 PUBLIC entries, where D1 said plainly that F-62 did *not* apply),
here the anon-only revoke is a genuine no-op.** PART C of the transcript demonstrates it on the live
object shape:

```
REVOKE EXECUTE ON FUNCTION public.search_certificates(text,text,date) FROM anon;

  proacl            : {=X/postgres,postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
  anon can execute? : t   <- STILL TRUE. Closed NOTHING.
  anon searching 'a': 3 row(s)   <- the directory is still open
```

The statement **succeeded**. anon's own ACL entry **is gone**. anon still executes, through PUBLIC.
In P30 this trap had to be shown on a synthetic function; **here it is the live shape.**

---

## 4 · What `search_certificates` actually exposes — read from the body

```sql
WHERE (at least one of _name / _course_title / _issued_date is non-blank)
  AND (_name IS NULL OR p.full_name ILIKE '%' || _name || '%')
  ... ORDER BY c.issued_at DESC LIMIT 50
```

**A substring match on a person's full name, up to 50 rows**, returning recipient name, title,
description, type, issued date, `certificate_id` and revocation status. Measured on the fixture: a
search for the single letter `a` returns rows; a blank search returns **0**, because the first
predicate blocks the all-blank bulk dump. **So somebody thought about this once — and a one-character
search walks straight past the guard.** That is not verification; it is a browsable directory of who
won what, reachable with the public API key.

**⚠ One thing it does NOT do, and the list should record it: it does not leak the verification
token.** The select list is `NULL::text AS verification_token`. Confirmed in practice on the fixture:
`verification_token IS NULL` for every row returned. **The capability model is intact and this revoke
is not needed to protect the token.** Claiming otherwise would have been an easy and wrong assumption.

**Scale**, because a finding without its scale is not a measurement: production 2026-09-04 —
**11 certificates**, 11 with tokens, 11 distinct, **0 revoked**. Eleven people. Not a breach today,
and the day a cohort is issued the exposure is real and nothing will announce it.

---

## 5 · C-34 — shown failing before it was shown passing, in both directions

`P31-fixture-transcript.txt`, reproducible via `P31-fixture-harness.sh` + `P31-fixture-schema.sql`.
Scratch PostgreSQL **16.13**, **not a lane** (F-65). Function bodies copied verbatim from production
`pg_get_functiondef`. **The fixture ACL is byte-identical to the measured lane ACL, PUBLIC entry
included** — not a clean one.

| part | what runs | probe exit |
|---|---|---|
| **B** | probe **before** the revoke | **3 — C2 FAILED** ← negative control |
| **C** | `REVOKE … FROM anon` **alone** | anon still `t`, directory still open — **F-62 on the real shape** |
| **D** | the apply migration (PUBLIC first) | anon `f`; `permission denied for function search_certificates` |
| **E** | probe **after** | **0 — all seven pass**, including C6/C7 |
| **F** | the rollback | **3 — C2 FAILED again**; PUBLIC entry restored to 1 |

And the half that must keep working, in the same run:

```
verify_certificate_by_token
  anon can execute? : t   <- UNTOUCHED, as the gate requires
  anon verifying a real token: 1 row(s) returned
  anon direct SELECT on public.certificates: permission denied for table certificates
```

The DEFINER function is the only way in, so its `WHERE` clause really is the only control.

### 5.1 A defect in D1's own harness, recorded rather than silently fixed

The first run printed `ERROR: permission denied for table certificates` **underneath a line claiming
verification still worked** — because the harness sub-selected the token *inside the anon session*,
and anon correctly has no read on that table. **The narration was not supported by its own output.**
The harness was wrong, not the product: the token is now read as `postgres` and passed in, and the
anon-side denial is shown deliberately as its own finding. Same class as the P30 rollback's
"byte-identical" claim — caught by running the thing rather than by reading it.

---

## 6 · Filename — F-75

`20260910_0001` is **taken** by P30 (merged at `12090ab`). The directory's next free slot is `_0002`,
**but the frozen list §4.2 reserves `20260910_0002`** for the P32 recompute re-cut, which is not in
the tree yet — so the directory alone would have said `_0002` was free and would have been wrong.
This unit takes **`_0003`**. A numbering gap costs nothing; a collision costs an ordering ambiguity
and a merge conflict. The stranded patch `5689cfb`, which named this file `_0001`, **is not in this
repository** (confirmed: `git cat-file -t 5689cfb` → not found) and its number is wrong regardless.

---

## 7 · Scope — and one object found outside it

**In scope: `search_certificates` only.** Not `increment_managed_page_view` (§2.2 BLOCKED, D2's
rejection handler not merged, separate unit). Not `verify_certificate_by_token` — see
`OI-3-verify_certificate_by_token-reading.md`, which is **a reading, not a revoke**, and recommends
leaving it public.

**⚠ A third function found during that reading: `verify_certificate(_cert_id text)`** — DEFINER,
anon-executable, PUBLIC-granted, and **on the frozen list nowhere**, exactly like
`verify_certificate_by_token`. Lookup by the ID printed on the certificate; does not return the
token. Same class as `verify_staff_id` (C-60): its gate is a **rate limit**, not a revoke. **Not acted
on.** Flagged so the register stops being silently incomplete.

---

## 8 · Not applied

**Committing is not applying.** Nothing in this unit has been run against either lane. Every lane
reading was `SELECT`-only; every state change happened on a scratch fixture in the D1 container. The
apply is blocked on D2's client fix and then on the Auditor's authorisation, staging first.
