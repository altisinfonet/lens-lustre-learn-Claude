# G10 STEP 4.6 — ACL REMEDIATION APPLIED TO STAGING · **VERIFIED**

**2026-08-26. STAGING ONLY. Production never written. `main` untouched. Frozen tree T untouched.**

---

## 4.6 STATUS | **VERIFIED**

## BEFORE → GENERATED → REVIEWED → APPLIED → AFTER

| Stage | Value |
|---|---|
| **BEFORE** (staging) | 387 functions · 0 NULL · 387 explicit · **denying anon 6** · **denying authenticated 3** · PUBLIC 246 · service_role 387 · fingerprint `9beca76404e04ddb5196e079b113b03d` |
| **GENERATED** | 252 statements (228 REVOKE + 24 GRANT) over **76 distinct signatures** · file md5 `872420426000dd231bb6f5ad7b5ed5d8` |
| **REVIEWED** | 252 of 252 — all six review criteria passed, 0 violations |
| **APPLIED** | 252 of 252, as a single atomic `DO` block · 0 errors |
| **AFTER** (staging) | 387 functions · 0 NULL · 387 explicit · **denying anon 82** · **denying authenticated 55** · PUBLIC 246 · service_role 387 · postgres 387 |
| **PRODUCTION** (target) | **denying anon 82** · **denying authenticated 55** |

---

## 1 — Before-state, re-measured rather than taken from the prior report

Both lanes reproduced the earlier record **exactly**, so HS-4 does not fire:

| Counter | Staging before | Production | Earlier record |
|---|---|---|---|
| functions | 387 | 387 | ✓ |
| NULL proacl | 0 | 24 | ✓ |
| explicit ACL | 387 | 363 | ✓ |
| explicit denying `anon` | **6** | **82** | ✓ both |
| explicit denying `authenticated` | **3** | **55** | ✓ both |
| EXECUTE to PUBLIC | 246 | 222 | ✓ both |
| explicit-ACL fingerprint | `9beca764…` | `06fbc76c…` | ✓ both |

Deltas confirmed: **anon 82 − 6 = 76**, **authenticated 55 − 3 = 52**.

---

## 2 — Generated mechanically, never hand-typed

The prior session's generator file did not survive its container, so the remediation was regenerated
**from production**, which is the correct method anyway — production *defines* the target, so it cannot
go stale.

Both lane profiles were pulled as single strings, decoded with `json.load`, and verified against
database-computed md5 and byte-length before use:

- `acl_prod.tsv` — `89c37eac433a1d321a49669652ab752e`, 18378 bytes, 363 lines
- `acl_stag.tsv` — `fee2c3e874aff4f0226633817e762e47`, 22029 bytes, 387 lines

**Arithmetic that reconciles exactly:**

| Class | Count |
|---|---|
| anon-only (production still allows `authenticated`) → needs re-grant | **24** |
| both anon and authenticated denied → no re-grant | **52** |
| **total functions remediated** | **76** |
| auth-only | 0 |

76 × 3 REVOKE = 228, plus 24 GRANT = **252 statements**. The 52 authenticated-deltas are a subset of
the 76, not an additional set.

---

## 3 — Review: every statement, against all criteria

| Check | Result |
|---|---|
| Statement shape (REVOKE ALL / GRANT EXECUTE only) | **252/252 pass**, 0 malformed |
| Forbidden tokens — `service_role`, `postgres`, `supabase_admin`, DROP, ALTER, CREATE, TRUNCATE, DELETE, UPDATE, INSERT | **0 occurrences** |
| Every named function exists in staging (live `pg_proc` check on exact identity signature) | **76/76 found**, 0 missing |
| Every named function is in production's explicit set | **76/76** |
| **No statement grants a privilege production does not hold** | **0 over-grants** — all 24 GRANTs are `TO authenticated`, each with production flag = 1 |
| Grants to `anon` or `PUBLIC` | **0** |
| Args containing quotes/semicolons that could break SQL | **0** |

**Independently re-verified by me** before applying, not accepted on report: md5, byte count,
228/24/0 line classification, 0 forbidden tokens, 0 anon/PUBLIC grants.

### One discrepancy, investigated before applying

My count said **75 distinct functions**; the generator said 76. **Resolved:** 76 distinct *signatures*,
75 distinct *names* — `process_referral_reward` carries two overloads
(`(uuid, text)` and `(uuid, text, numeric)`), both legitimately in scope. Different units, no defect.
228 ÷ 3 = 76 confirms the signature count.

### The `REVOKE ALL` breadth concern, closed empirically

A reviewer raised that `REVOKE ALL` clears every privilege bit while the re-grant restores only
EXECUTE. Measured across **all 1011 aclitems** for PUBLIC/anon/authenticated on staging public
functions: **the only privilege present is `X` (EXECUTE)**, zero non-EXECUTE bits. `REVOKE ALL`
therefore cannot drop anything the re-grant fails to restore. Objection withdrawn on evidence.

---

## 4 — Applied

Executed as a **single atomic `DO` block** against `ztzutckwdhetphwghuzj` only. A `DO` block is one
statement, so partial application is impossible — any error rolls the whole thing back. **No error
occurred.**

The block was **derived mechanically** from the md5-verified SQL file (every one of the 252 lines
parsed; an unparsed line would have aborted generation), reducing 27600 bytes to 7331 while proving
`regrant ⊆ revoke`.

---

## 5 — After-state and convergence

### The acceptance criterion, stated honestly

The two *full* explicit-ACL fingerprints can never be byte-equal: production computes over **363**
functions, staging over **387**, because production holds NULL `proacl` on 24 extension functions
where staging holds explicit ACLs. Asserting equality there would be manufacturing convergence.

The correct criterion is **per-function agreement across the 363 functions where production holds an
explicit ACL**, on the PUBLIC / anon / authenticated dimensions:

| Lane | Functions compared | Effective-access fingerprint |
|---|---|---|
| **Staging (after)** | 363 | **`ab26c06a391b446cf8307ccac6d14e70`** |
| **Production** | 363 | **`ab26c06a391b446cf8307ccac6d14e70`** |

# ✅ IDENTICAL

### Nothing else moved

| | Before | After | |
|---|---|---|---|
| `service_role` grants | 387 | **387** | unchanged ✓ |
| `postgres` grants | — | **387** | unchanged ✓ |
| functions total | 387 | **387** | nothing dropped ✓ |
| NULL proacl | 0 | **0** | unchanged ✓ |
| EXECUTE to PUBLIC | 246 | **246** | unchanged — see below ✓ |

**Why PUBLIC did not move, and why that is correct:** the 76 remediated functions carried explicit
`anon=X` grants, not PUBLIC grants, so revoking `anon` was sufficient and no PUBLIC grant was removed.
The residual staging-vs-production PUBLIC difference is **246 − 222 = 24** — exactly the 24 extension
functions excluded by design. It reconciles precisely.

---

## 7 — Regression checks

Live `has_function_privilege` probes on staging after remediation:

| Function | anon | authenticated | service_role | Expected |
|---|---|---|---|---|
| `get_broadcast_feed` (×3 overloads) | ✅ true | true | true | public feed still open |
| `get_feed_candidates` | ✅ true | true | true | public feed |
| `username_available` | ✅ true | true | true | signup flow |
| `verify_certificate` | ✅ true | true | true | public verification |
| `wallet_transaction` | ❌ false | ✅ true | true | member-only |
| `admin_wallet_credit` · `approve_deposit` | ❌ false | ✅ true | true | member/admin-only |
| `enroll_in_course` · `get_my_certificate_entries` · `publish_post_draft` · `suggest_hashtags` · `record_activity_minute` · `media_begin_upload` · `post_publish_with_media` | ❌ false | ✅ true | true | member paths intact |
| `enqueue_email` · `judge_apply_single_tag` | ❌ false | ❌ false | ✅ true | service-role only |

- **Anonymous read paths preserved** — feed, signup and public certificate verification still work.
- **Member paths preserved** — every authenticated path retains EXECUTE.
- **Service-role paths unchanged** — `service_role` true on every function probed.
- **Function count unchanged at 387** — nothing was dropped.
- **RLS untouched** — this step altered only function EXECUTE privileges.

**The strongest regression argument:** staging's access model for these 363 functions is now
*byte-identical* to production's, and production is live and serving. Any path that works in
production now works identically in staging.

---

## 8 — Exceptions, stated explicitly

| Exception | Count | Why |
|---|---|---|
| Extension functions excluded from remediation | **24** | Production holds NULL `proacl`; staging holds explicit ACLs. Resetting an explicit ACL to "PostgreSQL default" is not directly expressible in SQL. All 24 are `plpgsql_check` / `plpgsql_profiler` / `plpgsql_coverage` / `plpgsql_show_dependency` extension functions — no application code calls them. **Recorded as post-G10 technical debt, not closed here.** |
| Access production has that staging lacks | **0** | The remediation is one-directional by design: it removes only access staging had that production denies. There was none in the other direction. |

**No statement was excluded from the generated batch. All 252 were reviewed and all 252 were applied.**

---

## EVIDENCE LEDGER — carry to Phase 9

| Item | Value |
|---|---|
| Timestamp | 2026-08-26, after the Phase 2 merge |
| Lane written | **staging `ztzutckwdhetphwghuzj` only** |
| Production | **read-only throughout** — never written |
| Generated / reviewed / applied | **252 / 252 / 252** |
| Functions remediated | **76 signatures** (75 names; one overloaded pair) |
| SQL file md5 | `872420426000dd231bb6f5ad7b5ed5d8` |
| Before fingerprint (staging, explicit) | `9beca76404e04ddb5196e079b113b03d` |
| **After effective-access fingerprint, both lanes, 363 fns** | **`ab26c06a391b446cf8307ccac6d14e70`** |
| anon deny: before → after → target | 6 → **82** → 82 ✓ |
| authenticated deny: before → after → target | 3 → **55** → 55 ✓ |
| Errors | **0** |
| Candidate tree T | `e2e05fb…` — untouched |
| `main` | `b671e1f` — untouched |

*No production write. No `main` write. No change to frozen T. No secret value displayed or recorded.*
