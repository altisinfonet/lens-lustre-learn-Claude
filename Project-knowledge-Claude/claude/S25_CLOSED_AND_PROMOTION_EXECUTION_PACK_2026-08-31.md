# §25 CLOSED BY OWNER ACCEPTANCE · and the PROMOTION EXECUTION PACK

Issued 2026-08-31 by the compiler/audit session, on the owner's statement of 2026-08-31: **"note that I signed all."**

---

## 1. §25 — recorded, with its class stated exactly

**Owner statement, recorded verbatim:** *"note that I signed all."*

**Effect:** §25.7.3's second limb — *"every §25.3 row is either verified or recorded as a named residual risk the owner has accepted in writing"* — is satisfied by the owner's own ruling. **§25 moves PARTIAL → CLOSED BY ACCEPTANCE.**

| | |
|---|---|
| Route taken | **§25.7.3 second limb — written owner acceptance.** The D-12 / B13 pattern |
| Route NOT taken | verification by a separate auditor holding read-only access |
| Class of every one of the eight rows | **OWNER-ATTESTED.** Not VERIFIED, and the ledger must not say VERIFIED |
| Rows | 1, 2, 3, 4, 5 (re-drafted), 6a, 6b, 6c |

**§11 is now unblocked from the §25 side.**

### ⚠ The one thing I have not seen, and will not assert

**I have the owner's statement that the eight are signed. I have not seen the signed artefact.**

Under rule 17, and under the standard this whole engagement runs on, those are different facts. The acceptance draft carries a signature block — *Ruled by / Date (UTC)* — and **§25.7.3 says "in writing."**

**Action, and it takes a minute:** put the signed copy where the record can hold it — attach it here, or save it into the project. Until it exists as an artefact, the record reads *"the owner stated on 2026-08-31 that all eight are signed"*, which is an attestation about a signature rather than the signature itself.

**This does not block anything below.** It is the difference between a closed row and a closed row with its evidence attached, and it should be settled before the tag rather than after.

### And the sentence that must travel into the ledger unchanged

> **These eight rows are closed by acceptance, not by verification. No row was verified by a second party. This is the weaker of the two routes §25.7.3 allows, and it was chosen because no separate auditor with read-only access was available.**

A future reader must be able to tell an accepted risk from a verified one at a glance. **Every failure this engagement recorded came from that distinction being blurred.**

---

## 2. Where the release actually stands — measured, 2026-08-31

| | |
|---|---|
| `main` | `b671e1fb0c5bcf145d442076c229eca888afd674` — **unmoved all engagement** |
| Candidate | `5ca0d256a994fcab9e5beecfae8b8513d2799446` |
| Tags on `origin` | **0** |
| Ledger sha256 | `f00f612a057477146f4047f5af9235337f857d31887bb10e5bb56c98a9cd5943` |
| PR #104 | Open · **All checks passed · 15 successful · 2 skipped (named) · 0 failing** · No conflicts · 138 files · +10,234 / −1,299 · 51 commits |

### §24.2 step 8 is ALREADY SATISFIED — measured, not assumed

Step 8 says *"Resolve the certificate conflict → staging's blue (D-6). This creates a commit; the merged tree will differ from T."*

```
git merge-base b671e1fb 5ca0d256  →  b671e1fb0c5bcf145d442076c229eca888afd674
```

**`main` IS the merge-base — `main` is an ancestor of the candidate.** The D-6 conflict was resolved by merge `9faf5a17`, which is already in the candidate's history. **There is no conflict to resolve and step 8 creates no promotion-time commit.** GitHub agrees: *"No conflicts with base branch."*

**Consequence, and it is a good one:** the tree at the tag and the tree on `main` after the merge will be **identical**, so §24.2 step 10's tree-equality assertion is a straightforward check rather than a reconciliation.

---

## 3. What still blocks the tag — two items, and neither is a decision

**§25 is closed. §11 has one blocker left, not two.**

| # | Item | Status | Who |
|---|---|---|---|
| **A** | **runbook §5.3 probe — RE-RUN at the new candidate** | Prior run passed but is **5 days stale and belongs to a different candidate**. §5.3.6, §12.4 step 7 and §19 all say re-taken, never inherited | push-capable session, **immediately before the merge** |
| **B** | **§26 blocker 9 — the 138-file review** | Test suite re-run: **done**. My 43 files: **done**. Developer 1's 44 and Developer 2's 51 claim rows: **not yet published** | Developers 1 & 2 |

**On B, an honest note the owner should weigh rather than have decided for him:** the *review work* substantially exists — Developer 1 verified the patch and reviewed the functions, Developer 2 ran the suite and the database rows. What is missing is the **published per-file claim rows** that make it checkable. Blocker 9's words are *"No round reviewed the 138 changed files or re-ran the test suite."* The suite is re-run and the files are reviewed; **the artefact that proves it is incomplete.** That is a real gap and a smaller one than the blocker's wording suggests, and it is the owner's call whether to close it on the work or hold it for the rows.

---

## 4. THE PROMOTION SEQUENCE — exact, in order, with commands

**Do not reorder these. Steps 2–5 must be one continuous session with no commits in between.**

### STEP 1 · Re-run the probe *(A above)*

Choose the design first — they are not interchangeable:

| | Simple *(this is what passed on 2026-08-26)* | Revision 6 |
|---|---|---|
| `environment:` key | **none** — the absence IS the test | bound, both lanes, three sentinels |
| Proves | the secret is unreachable from a non-lane branch | a job bound to one lane cannot read the *other* lane's secrets |
| Residue | a branch and a run record | **deployment records that CANNOT be deleted**, and your previous deployment may flip to `inactive` |

**Recommended: the simple one.** It is the design that has actually executed, it answers G3's stated exit condition, and it costs no irreversible repository event. If the richer proof is wanted, run it *after* promotion as a hardening item.

```
git checkout -b scratch/g10-53-secret-isolation-20260831 5ca0d256
# add .github/workflows/g10-secret-probe.yml exactly as at 9478cf76 (verified verbatim, §3 of C-30)
git push origin scratch/g10-53-secret-isolation-20260831
# open the run → expand the "Probe" step → READ THE LITERAL WORD. It must say EMPTY.
git push origin --delete scratch/g10-53-secret-isolation-20260831
```

**Record: run id · UTC · the literal log line · the job conclusion · branch deleted.** A `success` conclusion without the log line is what the prior run left, and it is why it could not close G3.

### STEP 2 · Sign §11 and record the identity — ONE commit

§28.2 permits this: exception (a) covers *"an identity… a finding… an owner ruling, a signature"*, exception (b) covers *"the entries §11/§19/§20 require at promotion."* **One commit, not several.** It must carry:

1. **The new RC identity** — `RC-20260829-05` / `a42b209e` **superseded**; application candidate is now `5ca0d256a994fcab9e5beecfae8b8513d2799446`, with the three patched paths and the reason.
2. **§25 CLOSED BY ACCEPTANCE**, with the sentence in §1 above, verbatim.
3. **§11 G3 sub-row** — the probe result from step 1.
4. **§11 G6** — corrected from *"NOT ESTABLISHED"* to **AMBER**, citing `claude/G6_VERIFICATION_AND_G3_5.3_CARD_2026-08-22.md`: six executed negative tests with a discriminating control; the Cloudflare Pages variable half remains OWNER-ATTESTED and unread.
5. **F-47** — `web-build.yml` lane-guard, LATENT, deliberately not patched, post-promotion list.
6. **C-30 and C-31** — my two errors today, with the corrections. **Preserve the original wording; do not overwrite.**
7. **Standing rules 16 and 17.**
8. **The §11 approval signature**, dated, naming `5ca0d256`.

### STEP 3 · FREEZE

**No further commits to `staging`. None.** §3.5 rule 3.

### STEP 4 · Tag — against the head *after* step 2, not against `5ca0d256`

```
git fetch origin
git rev-parse origin/staging          # this is the tag target — NOT 5ca0d256
git tag -a <tag> <that SHA> -m "..."
git push origin <tag>
git ls-remote --tags origin           # must show exactly 1
```

**Step 2 creates a commit, so the head moves. Tagging `5ca0d256` would tag a tree that predates your own signature.** The tag must exist **before** the merge (§17-10).

### STEP 5 · Merge PR #104

Then §24.2 step 10 — **assert tree equality against the tag, not against `a42b209e`**:

```
git fetch origin
git rev-parse origin/main^{tree}
git rev-parse <tag>^{tree}            # the two must be identical
```

Then step 11 — verify the production build and deployment.

### STEP 6 · 🔴 POST-PROMOTION, and this one is not optional

**Apply M2 to production immediately:** `20260828082136_ad_comment_ban_and_visibility_policies.sql` via `apply-migration.yml`, `target=production`, dispatched **from `main`**.

**Until it runs, both RLS gaps stay open in production even though the file is on `main`** — a banned user can comment on ads, and ad comments are readable regardless of the parent creative's visibility. **Verify:** `pg_policies` on `ad_creative_comments` returns **9 rows**.

**And note what has changed for the better:** you are dispatching that migration through a workflow whose injection path was closed this morning. Before the patch, that same dispatch ran free-text input as shell with the production database URL already in the job environment.

### The rest of the post-promotion list

N2 cross-lane test *(N2 only — never N1 as written)* · §18 regression suite · the G9 edge-function deployment **under B13's four binding preconditions (15a–15d), including the prohibition on a blanket staging→production deploy** · F-47 · F-36 · `ANDROID_*` secret scoping · least-privilege on the 15 `verify_jwt=false` service-role functions · R2 token TTL and IP restriction · `national-ids/` under public bucket access · C-14-L · the seven functions carrying both header mechanisms · the ledger→project traceability gap · §28.3 tidy list.

---

## 5. What is true about this release, stated once, plainly

**Verified by measurement, most of it twice:** the 138-file scope, member for member, symmetric difference empty · production's shipped `_headers`, `robots.txt` and `sitemap.xml` **byte-identical after the merge**, proven by execution and corroborated by a nine-day-old independent measurement neither party knew of · the injection path closed in both workflows, 11→0 and 5→0, confirmed by two parties with independent instruments · the JSON-LD escape, confirmed by `od -c` and an executed payload test · CI green at the freeze head with both skips named · zero new dependencies · `main` untouched throughout.

**Carried as accepted risk, not as verification:** all eight §25 rows · G9's excluded function work and `submit-judge-decision` still answering `*` · G6's Cloudflare Pages half · the fact that the security patch's author and its first checker were the same party, mitigated by a specification published before the code and by Developer 1's independent re-measurement afterwards.

**Still to do before the merge:** one probe re-run, one signature commit, one tag.

---

## 6. Standing

**Nothing in this document closes a row, and it authorises nothing.** No merge, no tag, no deployment, no migration, no probe run, no production write, no provider change, no ledger commit has been performed by this session. The only repository state changes in this entire engagement are the two commits of 2026-08-31 that the owner explicitly ruled, and the owner's own creation of `SUPABASE_DB_URL` on the `staging` environment.

**`main` = `b671e1fb0c5bcf145d442076c229eca888afd674` · candidate = `5ca0d256a994fcab9e5beecfae8b8513d2799446` · tags = 0.**
