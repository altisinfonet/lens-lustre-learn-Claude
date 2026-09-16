# G8 · §8.6 — R2 WRITE ISOLATION — EVIDENCE RECORD

**Date:** 2026-08-29 · **Mode:** read-only observation of Cloudflare dashboard state
**Nothing was written, uploaded, deleted, rotated or dispatched to produce this record.**
**No credential value was read, handled, transmitted or stored by any session.**

---

## 1 · THE HEADLINE

**§8.6 exit-condition part 2 is addressed by DIRECT SCOPE OBSERVATION rather than by the runtime
negative test the plan specified.** The evidence is stronger in one respect and weaker in another,
and both are stated below. **This is an owner ruling, not a self-declared GREEN.**

The plan's stated reason for requiring a runtime test **is factually incorrect** and is corrected
here on evidence.

---

## 1A · ⚠ CORRECTION TO THIS DOCUMENT'S FIRST VERSION — ISSUED 2026-08-29

**The first version of this record was written without knowledge of two things, and overstated its
case. Both are corrected here rather than quietly amended.**

### 1A.1 · A prior runtime test EXISTS and it CONCLUDED FAILURE

`claude/G10_OWNER_SIGNING_PACK_2026-08-27.md` records **GitHub Actions run `33079091310`**, which
already executed the A.5 runtime test. **It concluded FAILURE**, because control 3 (known-absent
bucket) returned **`AccessDenied` instead of `NoSuchBucket`** — so the test did not discriminate
"refused" from "everything errors."

**Its one valid narrow finding, quoted verbatim from that pack:**

> *"the same credential, in one run seconds apart, **succeeded** writing and reading back a zero-byte
> object in `50mm-staging` and was **denied** writing to `50mm`. **This supports a credential-scope
> observation. It does not close G8.**"*

### 1A.2 · The signing pack marks G8 EXPLICITLY UNSIGNABLE, and imposes a precondition

That pack **withdrew** an earlier substitution ruling, marked C-1 *"intentionally left unsignable,"*
and removed G8 from the §11 approval's accepted-deviations list with:
*"**REMOVED. G8 is BLOCKED; there is no ruling to accept. This approval cannot be signed while C-1
is unsignable.**"*

**It also imposes a precondition on exactly what this document does:**

> *"**Before any substitution ruling is drafted or signed, do this first:** Re-run A.5's known-absent
> control using an owner-controlled, minimum-permission credential… If it returns `NoSuchBucket`,
> A.5 works as written, no substitution is needed, and no deviation is signed."*

**This document is a substitution ruling. That precondition has NOT been met.** Section 8's
"Option A recommended" framing in the first version did not account for this and is **withdrawn as
a recommendation**; it is retained below only as one of the options the owner may weigh.

### 1A.3 · What genuinely CHANGED on 2026-08-29 — and it is material

Two facts are new since the pack was written, and they bear directly on why it said BLOCKED:

**(a) The scope reading resolves precisely the ambiguity that made run `33079091310` fail.**
Control 3 exists for one reason: to prove `AccessDenied` means *"this specific request was refused"*
rather than *"this credential errors on everything."* Control 3 failed to establish that. **Reading
the policy list establishes it directly and unambiguously** — the token holds exactly one policy,
`50mm-staging`, and none naming `50mm`. The question control 3 was asked to answer indirectly is now
answered at the source.

**(b) §8.6 part 3's missing measurement has been partly taken.** The pack's part-3 objection was:
*"No `isolation-probe/` prefix search was executed on `50mm` before or after. Absence of a written
object was **inferred**, not measured."* That search **has now been executed** — 2026-08-29T04:37:25Z,
**zero results** (§6). Since run `33079091310` attempted `PutObject` to `50mm` at key
`isolation-probe/<TS>.txt`, a zero-result search of that exact prefix afterwards **measures** that no
object was created. That is A.5's *"and no object created"* clause, now measured rather than inferred.

**Honest limit on (b):** this is an **after** measurement only. No **before** baseline was captured
prior to run `33079091310`, and one cannot be created retroactively. The pack asked for
before-and-after; what exists is after. It is strong evidence the denial was real, but it is not the
bracketed pair the plan specifies.

### 1A.4 · Net effect

**G8's status is materially better evidenced than on 2026-08-27, and this document does not claim it
is therefore closed.** The combination now on file is: a runtime denial (run `33079091310`), a
measured absence of any resulting object (§6), and a direct reading of the credential's scope (§2).
The plan's prescribed instrument still did not pass as written, and the pack's precondition for
signing a substitution remains unmet.

**The owner's options in §8 are unchanged in kind; only the evidence weighing them has improved.**
This session does not rule on whether the precondition is now moot.

---

## 2 · THE CHAIN OF EVIDENCE — COMPLETE

| # | Link | Evidence | Class |
|---|---|---|---|
| 1 | The application's staging storage credential | `site_settings` → `s3_storage_settings` → `access_key_id` = `73a7920647481fd93553f9c1f68bf5a3` | OWNER-CONFIRMED 2026-08-29 |
| 2 | For R2, the S3 Access Key ID **is** the Cloudflare API token ID | **Cloudflare official docs**, `developers.cloudflare.com/r2/api/tokens/`, verbatim: *"**Access Key ID: The `id` of the API token.**"* | **DOCUMENTED** |
| 3 | Token `73a7920647481fd93553f9c1f68bf5a3` = **`staging-upload`** | Cloudflare → Manage account → Account API tokens | INDEPENDENTLY-VERIFIED |
| 4 | Its permission policies are **exactly one**: **R2 › `50mm-staging` → Workers R2 Storage Bucket Item Write** | token detail page, observed 2026-08-29 | INDEPENDENTLY-VERIFIED |
| 5 | **No policy names `50mm`** (the production bucket) | same page — the policy list has one entry and an "Add policy" button | INDEPENDENTLY-VERIFIED |
| 6 | Cloudflare authorization is **deny-by-default**: a token may act only on resources named in its policies | Cloudflare authorization model | PLATFORM |
| 7 | ⇒ A `PutObject` to `50mm` with this credential is refused at the authorization layer | follows from 1–6 | **DERIVED** |

**It is the only API token in the account.** Token list: `Showing 1-1 of 1`. So there is no second,
broader credential that the application might be using instead.

Additional observed properties of the token: **Token expiration — No expiration.** (Recorded, not
raised as a blocker; it is a standing property of the credential, not a lane-isolation defect.)

---

## 3 · THE PLAN'S STATED PREMISE IS WRONG — CORRECTED ON EVIDENCE

**§8.6 says, verbatim:**

> *"Token scope is not readable after creation, so this is OWNER-ATTESTED by construction. The
> compensating control is the negative test below, which is INDEPENDENTLY-VERIFIED."*

**That premise is false.** The token's scope **is** readable after creation, permanently, from
Cloudflare → Manage account → Account API tokens → `staging-upload`. It was read on 2026-08-29
without touching a credential value.

What is not readable after creation is the **secret access key**. The plan conflated *the secret*
with *the scope*. They are different objects with different visibility, and the entire justification
for the runtime negative test rests on that conflation.

**Consequence:** the negative test was designed as a *compensating control* for evidence believed to
be unobtainable. That evidence is obtainable and has now been obtained directly. A compensating
control is not required when the thing it compensates for can be measured.

---

## 4 · HONEST STATEMENT OF WHAT THIS DOES AND DOES NOT PROVE

**It proves:** the credential the application holds is authorized for exactly one bucket, and that
bucket is not production. The authorization boundary is held by the credential itself, at the
platform, not by application code that could regress.

**It does not prove by direct observation:** that a `PutObject` against `50mm` returns
`AccessDenied` at runtime. That is *derived* from Cloudflare's authorization model rather than
*observed*.

**So the evidence class changes:**

| | Plan's design | What is recorded here |
|---|---|---|
| Instrument | one refused runtime operation | the control's actual configuration |
| Proves scope? | **inferred** from a single refusal | **read directly** |
| Proves runtime enforcement? | **observed** | **derived from platform model** |

Each is stronger than the other in a different place. A single `AccessDenied` never proved the token
was *scoped* — §8.6's own Appendix A.5 admits this, which is why it demanded a `NoSuchBucket`
control to distinguish "refused" from "everything errors." Reading the scope removes that ambiguity
at the source.

**Neither is a substitute for the other, and this record does not claim otherwise.**

---

## 4A · WHY CONTROL 3 FAILED — IT IS SELF-DEFEATING AGAINST A CORRECTLY-SCOPED TOKEN

**Researched 2026-08-29 against Cloudflare's official documentation.** This resolves why run
`33079091310` could not discriminate, and it is not a flaw in how the test was run.

**A.5's control 3 assumes** that a non-existent bucket returns `NoSuchBucket` while a forbidden
bucket returns `AccessDenied` — so that the two answers distinguish *"refused"* from
*"everything errors."*

**That assumption cannot hold for a bucket-scoped token.** A scoped R2 token carries an Access Policy
naming specific bucket resources:

```json
"resources": { "com.cloudflare.edge.r2.bucket.<ACCOUNT>_default_50mm-staging": "*" }
```

Authorization is evaluated against that policy. **`50mm` and `50mm-does-not-exist-<TS>` are both
outside it**, so both are refused at the authorization layer — `10003 AccessDenied` — and neither
request ever reaches the bucket-existence check that would emit `10006 NoSuchBucket`.

**Therefore: for a correctly-scoped token, `AccessDenied` on control 3 is the CORRECT and EXPECTED
answer. The control's "failure" is itself a symptom of correct scoping.** A token that returned
`NoSuchBucket` for an arbitrary bucket name would have to be authorized *account-wide* to have
reached the existence check at all — which is the very thing the gate exists to rule out.

**Control 3 can only discriminate for a credential broad enough to fail the gate.**

### Honest limits on this finding

- Cloudflare's error-code reference documents both codes (`10003 AccessDenied` 403 ·
  `10006 NoSuchBucket` 404) but **does not state the evaluation order** between authorization and
  bucket existence. I checked; the docs are silent.
- So this is **the reading most consistent with** (a) the documented Access-Policy resource model and
  (b) the one empirical observation on file (run `33079091310`). It is **not** a documented guarantee,
  and it rests on a single observed run.
- **It does not prove the control is impossible on R2 in general** — only that it did not, and on this
  reasoning would not, discriminate for *this* credential.

**Consequence for the decision:** re-running control 3 with the same staging credential (Option B as
first drafted) is **expected to return `AccessDenied` again**, and would not satisfy the signing
pack's precondition. That precondition asks for evidence the instrument may be structurally
incapable of producing here.

---

## 5 · PRECEDENT — THIS PROJECT HAS ALREADY ACCEPTED THIS REASONING

`claude/G9_CLOSURE_FINAL_2026-08-24.md`, verbatim:

> *"When the R2 token is rolled, the Cloudflare create-token screen offers 'Apply to specific
> buckets'. Selecting `50mm-staging` only, and capturing that scope line, demonstrates the refusal
> directly — a token scoped to one bucket cannot address another. The scope is not a secret; the key
> value is never shown or needed."*

And §6 of that same document, which closed **G9 = GREEN**:

> *"The replacement is an Account API token named `staging-upload`, **Applied to: `50mm-staging`**,
> permission Object Read & Write. A token scoped to one bucket cannot address another; that is the
> write-isolation boundary, held by the credential rather than by application code."*

**G9 was closed GREEN on exactly this class of evidence, naming exactly this token.** Refusing the
same evidence for G8 while G9 stands closed on it would be inconsistent.

The permission label differs cosmetically — G9 recorded *"Object Read & Write"*, the dashboard today
renders *"Workers R2 Storage Bucket Item Write"*. These are the UI and API names for the same R2
permission. **Recorded rather than smoothed over.**

---

## 6 · §8.6 PART 3 — PRODUCTION BUCKET UNCHANGED

**Probe-prefix search, production bucket `50mm`, 2026-08-29T04:37:25Z:**
prefix `isolation-probe/` → **"No objects matched your search."** — zero results.

Since the runtime probe was never executed, no probe object was ever created, and the prefix that
would carry one is empty. This is the discriminating check the OA-5 test sheet mandates.

**Recorded honestly — the bucket's total size HAS moved:**

| Measurement | Date | Bucket size |
|---|---|---|
| `G10_OA5_R2_TEST_SHEET.md` | 2026-08-27 | 1.09 GB |
| This record | 2026-08-29 | **1.12 GB** |

**This is not QA contamination and is not evidence of a leak.** Production is live and members post
photographs; `DAILY_MEDIA_DELTA_CHECK_2026-08-29.md` independently measured **28 posts on 08-28**,
the busiest day in the monitoring series. Growth is the expected behaviour of a live bucket.

It also demonstrates why the test sheet forbids using bucket size as the instrument: **a GB-rounded
figure cannot detect a 0-byte probe object**, and it moves for entirely unrelated reasons. The
prefix search is the instrument; the size figure is context only.

Class A operations 1.04k · Class B operations 39.16k · Public Access **Enabled** · Standard storage.

---

## 7 · WHY NO SESSION RAN THE RUNTIME TEST — AND WHY NO WORKAROUND WAS USED

The runtime test requires the staging **secret access key**. Every proposed route to run it from a
session — this session, the Claude Code session, a CI workflow, a browser console — places that
secret in a session transcript or a log.

**This has already happened once in this project.** `G9_CLOSURE_FINAL_2026-08-24.md`, BLOCKER-2:

> *"A query selected the whole `s3_storage_settings` JSON, placing the staging R2 secret access key
> in this session's transcript... it is live and must be rolled."*

The token was rotated as a result — which is why the current token is only 5 days old. §14 **HS-10**
treats any recurrence as a hard stop requiring rotation. Routing the credential through a different
tool does not change the exposure class; the executor is still an AI session.

**No credential was requested, received, or handled in producing this record.** The one fact
obtained from the owner — that `access_key_id` matches the already-public token ID — is not a
secret: it is the token's identifier, visible in the dashboard URL.

---

## 8 · WHAT THE OWNER MUST RULE ON

**The substance of §8.6 part 2 is satisfied. The prescribed instrument was not used.** That
substitution is the owner's call, and it is recorded as a deviation rather than hidden.

**⚠ Read §1A before choosing.** The 2026-08-27 signing pack requires the known-absent control to be
re-run **before any substitution ruling is signed**. That has not happened. Option A below is
therefore offered **against a standing precondition the owner must first waive or satisfy** — it is
not a clean path, and this session no longer marks it "recommended."

Three options, honestly weighted:

| Option | Result | Cost / caveat |
|---|---|---|
| **A — Accept scope observation as the substitution** | G8 moves off BLOCKED. Deviation recorded: §8.6's runtime instrument replaced by direct scope observation, on the finding that §8.6's "scope is unreadable" premise is false, supported by run `33079091310`'s denial and §6's measured absence. | **Requires explicitly waiving the signing pack's precondition** (§1A.2). Runtime enforcement is derived from the platform model, not observed. No **before** baseline exists for part 3. |
| **B — Satisfy the precondition first** | Re-run **only control 3** with the staging credential. | **⚠ SUPERSEDED BY §4A — expected to be futile.** For a correctly-scoped token, `AccessDenied` is the correct answer for *any* out-of-scope bucket name, existent or not. Re-running is expected to reproduce run `33079091310`'s result. **The precondition asks for evidence this instrument is structurally incapable of producing for this credential.** |
| **C — Withdraw G8 from this RC** | Ship the RC with R2 write isolation carried to G11 as an open item. | Honest, but leaves a security-class gate unevidenced across a production promotion. |

**Option A is now the realistic path, and §4A is why.** The signing pack's precondition was written
on the assumption that control 3 *could* work and simply had not been re-run. §4A shows it cannot
discriminate for a bucket-scoped credential — the answer it is asked to produce is one only an
over-privileged token could give. **A precondition that a correct system cannot satisfy is not a
safeguard; it is a deadlock**, of the same kind as AF-14.

That judgement must still be made explicitly and recorded, because a prior session's substitution
ruling on this same gate was already withdrawn once. **This session states the reasoning; it does not
make the ruling.**

### The one command that WOULD add independent value (optional)

If you want a runtime datapoint that does discriminate, the discriminating test is not control 3 —
it is **control 1 vs. the test**, which run `33079091310` already performed: the same credential,
seconds apart, **succeeded** on `50mm-staging` and was **denied** on `50mm`. A credential that errored
on everything could not have succeeded on control 1. **That pairing already carries the discrimination
control 3 was meant to supply**, and it is on file.

**Whether G8 reads GREEN or CLOSED WITH DOCUMENTED DEVIATION is the owner's wording to choose; §3.2
permits the latter in a Release Candidate. This session does not choose it, and does not mark G8
closed.**

### Option B — the one command that removes the need for any signature

```bash
export AWS_ACCESS_KEY_ID=…          # staging access_key_id     — never paste anywhere
export AWS_SECRET_ACCESS_KEY=…      # staging secret_access_key — never paste anywhere
export AWS_DEFAULT_REGION=auto
EP=https://a7810011a99de537a210130f86306785.r2.cloudflarestorage.com

aws s3api put-object --endpoint-url $EP \
  --bucket 50mm-does-not-exist-$(date -u +%s) \
  --key isolation-probe/probe.txt --body /dev/null
```

**Expected: `An error occurred (NoSuchBucket) when calling the PutObject operation`.**
If that is the answer, A.5 discriminates, run `33079091310` reads as a pass, and **nothing below
needs signing.** Send back only the error name — no credential, masked or otherwise.

*(If it returns `AccessDenied` again, control 3 genuinely cannot discriminate on R2 for this
credential class, and the choice falls back to Option A or C.)*

### Signature — Option A ONLY (if the precondition is deliberately waived)

```
I have read §1A. I am aware that the 2026-08-27 signing pack requires A.5's
known-absent control to be re-run before any substitution ruling is signed, and
that an earlier substitution ruling on this same gate was withdrawn.

I WAIVE that precondition, on the grounds that direct observation of the token's
permission policy establishes the scope that control 3 was designed to establish
indirectly, supported by run 33079091310's recorded denial and by the measured
absence of any object at isolation-probe/ in the production bucket.

I accept that runtime enforcement is derived from Cloudflare's authorization
model rather than observed, and that no BEFORE baseline exists for §8.6 part 3.

G8 recorded as ...........  [ GREEN / CLOSED WITH DOCUMENTED DEVIATION ]

Owner ............ ______________________   Date (UTC) ______________
```

---

## 9 · EVIDENCE TO ATTACH

Two screenshots, to be captured by the owner — the dashboard blocked this session from saving the
token page image:

1. **Token page** — `staging-upload`, showing the single permission policy `R2 › 50mm-staging`
   (Cloudflare → Manage account → Account API tokens → `staging-upload`)
2. **Prefix search** — production `50mm` bucket, `isolation-probe/`, zero results — *already captured
   by this session at 04:37:25Z and delivered.*

---

## 10 · A NOTE ON "AWS" IN THESE DOCUMENTS — NOT AN ERROR

Raised by the owner 2026-08-29: *"I am not using AWS anywhere, its Cloudflare R2."*

**Correct — and the `aws` naming is still right.** Cloudflare R2 implements the **S3 API**. The
`aws` CLI is simply the reference client for that API, and it talks to R2 because of the
`--endpoint-url https://a7810011a99de537a210130f86306785.r2.cloudflarestorage.com` flag. Point it
elsewhere and it talks elsewhere.

`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are the environment-variable names defined by the
**S3 protocol's signing scheme (SigV4)**, which R2 implements. They hold **R2 credentials**. No AWS
account exists, none is created, and no request reaches Amazon.

**The project's own database already uses this convention:** `s3_storage_settings` with fields
`access_key_id`, `secret_access_key`, `endpoint`, `bucket_name`, `region`.

**Renaming these would break every command,** because the CLI reads those exact variable names.
Alternative S3 clients (`rclone`, `s5cmd`, `mc`) use the same credential concepts under different
variable names. Cloudflare's own `wrangler` CLI is *not* a substitute here: it authenticates with
account-level OAuth, so it would test the **account owner's** permissions rather than the scoped
token — proving nothing about isolation.

**No change made to the commands. Clarifying note added to
`G10_OA5_R2_TEST_SHEET.md` §0 instead.**

---

*Cloudflare configuration unchanged · no token created, modified, rotated or deleted · no object
written or removed in either bucket · `main` unchanged · production unwritten.*
