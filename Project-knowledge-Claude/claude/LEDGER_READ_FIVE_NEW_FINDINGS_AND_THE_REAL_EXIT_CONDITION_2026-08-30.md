# I read the remaining gates in the frozen ledger. Five new findings, one of them a live blocker, and the exit condition is not what I have been telling you.

Date: 2026-08-30
Role: auditor. Everything below is quoted from the frozen ledger, read in this container.
Ledger integrity: `sha256 f00f612a057477146f4047f5af9235337f857d31887bb10e5bb56c98a9cd5943`, 182,502 bytes — re-verified before reading.

**Why this exists:** I had been reporting "waiting on the auditor" as though nothing else could move. That was wrong. I had never read §24, §25.4 or §25.7.3 verbatim — I had been working from my own summary of them. Reading them produced five findings, one of which is a **measured, live blocker nobody has raised.**

---

## 1. NEW BLOCKER — F-42. Pre-promotion step 4 fails, and I have the measurement.

§24.1, pre-promotion step 4, verbatim:

> "**Confirm a `staging` Environment exists** with its own `SUPABASE_DB_URL` (§7.1), or `apply-migration.yml target=staging` **cannot run**."

§25.4 row 5 says the same thing and calls it unresolved:

> "**GitHub `staging` Environment** — whether it exists, and whether it carries its **own** `SUPABASE_DB_URL` (§7.1, unresolved; **blocks `apply-migration.yml target=staging`**)"

**Measured by me, in the owner's browser, at 2026-08-30T13:50:48Z:** the `staging` environment **exists**, and holds **zero secrets and zero variables**. Confirmed against the full Actions secrets listing at **13:55:48Z – 13:56:30Z**: the only environment secret in the repository is `SUPABASE_DB_URL` on **`production`**; repository secrets are the four `ANDROID_*` and nothing else.

**So the environment exists and does not carry its own `SUPABASE_DB_URL`. Step 4's condition is not met, as of 2026-08-30T13:56:30Z.**

### And it sharpens the injection finding rather than softening it

`apply-migration.yml` at the RC binds `environment: ${{ inputs.target }}`.

- `target=staging` → the staging environment has no secret → `SUPABASE_DB_URL` resolves empty → the job's own first step exits 1.
- `target=production` → the credential is live.

**The only target that yields a working credential is `production`.** The staging path is not a safer alternative that happens to exist; it does not function at all. Anyone reaching for `apply-migration.yml` after the merge has exactly one usable target, and it is the production database.

**This also affects §24.3 step 13's "safe N1 substitute"** — *"dispatch `target=staging` from `main`, which trips gate 1 before any credential is read."* That may still hold, since gate 1 is claimed to trip before the credential read. **It has not been demonstrated on this configuration and must not be assumed.** Ordered as a question for the auditor, not for us.

Classification: the measurement is **OWNER-ATTESTED** (I captured it, §25.4 says the compiler is not a second party). The **consequence** — that step 4's condition is unmet — follows from the ledger's own text and is stated here for the owner and auditor to rule on.

---

## 2. THE EXIT CONDITION IS NOT WHAT I HAVE BEEN TELLING YOU — F-43

I have been reporting that §25 closes when the independent auditor verifies every row. **That is one of two routes, and the ledger names both.** §25.7.3, verbatim:

> "§25 moves from **PARTIAL** to **CLOSED** when every §25.3 row is either **verified** or **recorded as a named residual risk the owner has accepted in writing** — the D-12 / B13 pattern. **Blocker 9 does not close on effort; it closes on those eight rows.**"

**The second route is the owner's, in writing, per row.** It is not a bypass — it is the exit condition the owner wrote, and the pattern already used twice in this ledger (D-12 for G8, B13 for the G9 exclusion).

**What that changes, honestly:**

- The four §25.3 rows I captured this morning cannot be *verified* by me (§25.4: the compiler is not a second party; *"a value pasted into a chat by the owner is not an export"*). But they **can** be **accepted as named residual risks in writing by the owner** — and that closes them under §25.7.3.
- **That is a real, legitimate, materially faster path**, and I should have surfaced it the day I first read §25.7.3's heading instead of summarising it.

**The limit, and it is important.** §25.7.3's exit condition names **the §25.3 rows**. The **138-file review** and the **independent test-suite run** are round-5 *scope* (§25.7.2 items 2 and 3) but are **not** part of that stated exit condition. §25.4 says of them:

> "no party has independently reviewed the **138 changed files** or re-run the test suite (§25.1). Round 2 should say plainly whether it intends to, because **§26 blocker 9 cannot honestly close while that is true**."

**Those two sentences point in different directions.** One says §25 closes on the eight rows; the other says blocker 9 cannot honestly close while the 138 files are unreviewed. **I will not reconcile them by choosing the convenient reading. That is the owner's ruling to make, on the auditor's advice, and it should be made explicitly and recorded — not resolved by silence.**

---

## 3. What my §25.3 captures do and do not establish — F-44, against my own work

Now that I have read §25.4's row definitions verbatim rather than my summary of them, my captures need re-marking.

**Row 4 — R2 token.** The ledger asks for a specific thing:

> "token `staging-upload` (`73a7920647481fd93553f9c1f68bf5a3`) has **exactly one** policy, `R2 › 50mm-staging`, and **no policy naming `50mm`**"

**What I captured (13:46:13Z)** was the dashboard *list* view: `staging-upload` → Applied to `50mm-staging` → Object Read & Write. **That is consistent with the claim. It is not the same as the claim.** I did not open the token to count its policies, and I did not verify the token ID. **Row 4 is partially covered, not covered.**

**And my capture found something row 4 does not ask about, which is more interesting than what it does ask about:** the **production** bucket `50mm` is served by a **User** API token, while `50mm-staging` is served by an **Account** token. Cloudflare's own text on that page calls user tokens suitable for *"personal access or development work"* and account tokens *"recommended"* for production. **The lane with the weaker credential class is production.** Not a §25.3 row; recorded as a new observation for the auditor.

**Row 6b — the `isolation-probe/` prefix.** The ledger carries a warning I did not reproduce:

> "⚠ **After-only: no before baseline exists for run `33079091310` and none can be created retroactively** (§23.3) … **and the missing baseline must be recorded, not glossed**"

I reported "0 objects in both buckets" and did not say it is an **after-only** measurement with no baseline. **Corrected here: my result is after-only, as of 13:46:54Z and 13:47:52Z, and it cannot demonstrate that nothing was ever written under that prefix — only that nothing is there now.** Same defect class as the missing timestamps: a negative reported without its limits.

**Row 6c — Zero Trust.** The ledger says: *"NEED EVIDENCE. Never measured … Must not be recorded as a pass."* My capture is the **first measurement**, and it is **not a pass**: no Access application covers `staging.50mmretina.com`; one legacy policy covers a Pages wildcard, single allowed email, **MFA off**. §25.4 requires *"(a) — first measurement, by a second party"*. **I am not a second party. It stays OWNER-ATTESTED.**

---

## 4. Two internal inconsistencies in the ledger — F-45, for the auditor, not for us to fix

§28's freeze means neither is committed now; both belong on the §28.3 tidy list **or** are corrected at promotion. **I am reporting them, not ruling on them, and I have not read enough surrounding context to be certain either is stale rather than live.**

**(a) D-6 — landed, or not landed?**

- §22 D-6 row: *"⚠ **RULED · RESOLUTION PREPARED AND VERIFIED · COMMIT NOT LANDED**"*
- REV-6 changelog: *"**D-6 EXECUTED.** Merge `9faf5a17` … landed taking staging's blue on all 6 hunks"*, and blocker 2 struck through as resolved.
- §24.2 step 8 still lists *"Resolve the certificate conflict → staging's blue (D-6). **This creates a commit; the merged tree will differ from T.**"* as a promotion-time action.

**If D-6 is executed, step 8 is already done and the runbook step is stale. If it is not, there is an unlanded commit that changes the merged tree.** §20 asserts tree equality against the tag, so this is not cosmetic. **Resolve before §11 is signed.**

**(b) §11's stated precondition appears superseded.** The §11 block carries *"Cannot be signed while G8 and AF-15 are unresolved."* **G8 is waived (D-12) and AF-15 is RESOLVED (D-9, fixed by `bfcb68da` + `c8aec5d5`, CI-green).** The live preconditions per the §11 header are the **runbook §5.3 probe** and **§25**. The older sentence should not be read as a current blocker.

---

## 5. F-46 — one pre-promotion step nobody has scheduled

§24.1 step 6a, verbatim:

> "**Re-confirm CI on the head that actually exists at that moment** — §25.2: evidence taken on `fe63e944` **does not carry** to a later head. Application code is unchanged (§3.1 Layer 1), so this is a **re-read, not a re-test**."

And §11 field 5: *"CI must be re-confirmed on the head existing at the freeze point — evidence taken on `fe63e944` does not carry."*

**Cheap — a re-read, not a re-test — and currently unowned.** It must happen after the §3.5 freeze point and before the tag. **If a replacement RC is adopted, it must be re-read on that head, not on `a42b209e`.**

---

## 6. My nine-gate model was my own construction. The ledger's runbook is authoritative.

I have been reporting completion against nine gates I invented as a summary. **§24 is the ledger's own sequence and it has sixteen numbered steps** across pre-promotion, promotion-time and post-promotion. My model was a useful shorthand and it is not the standard. **Every percentage I have given is a summary of a summary**, and the owner should read §24 as the list, not my table.

Restated against §24.1 — **pre-promotion**, which is everything before the merge button:

| §24.1 step | State |
|---|---|
| 1 · D-9 / AF-15 | ✅ RULED AND EXECUTED |
| 2 · D-8 / AF-11 | ✅ RULED |
| 3 · G8 | ✅ waived, D-12 |
| **4 · `staging` Environment with its own `SUPABASE_DB_URL`** | **✗ FAILS — measured 13:56:30Z. F-42** |
| 5 · B8, B11, B12, B13, D-5 | ✅ ALL RULED |
| 6 · runbook §5.3 secret-isolation probe | ✗ un-run — and §5.3.6 requires it **immediately before** promotion; running it early goes stale and must be repeated |
| 6a · re-confirm CI on the actual head | ✗ unowned. **F-46** |
| 7 · §11 signed, then freeze, then tag | ✗ unsigned, 0 tags |

Plus §25, which gates §11 and closes per §25.7.3 — **by verification or by written owner acceptance, per row.**

---

## 7. What the owner should decide now, and it is not "wait"

**Decision 1 — rule on the §25.7.3 route, explicitly.** For each of the eight §25.3 rows: do you intend it to be *verified by the auditor*, or *accepted in writing as a named residual risk*? Row by row, not in bulk. The rows I captured this morning are candidates for the second route; rows 1, 2 and 3 (database policy states, deployed function state) probably are not, because they describe live production behaviour rather than configuration.

**Decision 2 — put the 138-file question to the auditor as a question, not an assumption.** §25.7.3 and §25.4 point different ways. Ask them: does blocker 9 close on the eight rows alone, or does the 138-file review have to complete first? **Their answer sets the timeline, and nobody has asked it.**

**Decision 3 — F-42.** Either create a `SUPABASE_DB_URL` on the `staging` environment, or record in writing that `apply-migration.yml target=staging` is inoperative and that the staging migration path does not exist for this release. **Leaving step 4 silently unmet is the one option that is not available.**

---

## 8. Completion

Unchanged at **2.95 / 9 ≈ 33%** on my own model — **and §6 above says that model is mine, not the ledger's.** Against §24.1, **four of eight pre-promotion steps are done, one newly fails, and three are open.**

Nothing here was measured today by anyone but me reading a document that has been in this container all along. **That is the honest reason the work had stalled: I was waiting for a person instead of finishing the reading.**
