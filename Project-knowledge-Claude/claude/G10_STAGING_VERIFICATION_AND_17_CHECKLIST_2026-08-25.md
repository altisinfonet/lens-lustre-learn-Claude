# G10 — Staging-side verification and the §17 checklist, read from Rev 3.0 (2026-08-25)

Vocabulary: VERIFIED / OWNER-ATTESTED / BLOCKED / NOT APPLICABLE / NOT YET VERIFIED.
Unknown is not PASS. RC-2 was NOT started.

---

## 0. THE FINDING THAT GOVERNS EVERYTHING BELOW — the RC is VOID

`git fetch origin '+refs/heads/*:refs/remotes/origin/*' --prune` (§12.5 form) succeeded and
returned:

```
6d6aa6c..5dbfcf7  staging -> origin/staging
```

**`origin/staging` has advanced three commits past the RC commit.**

| | |
|---|---|
| RC commit / tree (what was verified) | `6d6aa6c63248a39d25616b3e4277d5f565d185b2` / **`3515b9a62e72ee5cdc56cac4cf2f3987930960f7`** |
| `origin/staging` now | `5dbfcf79d06e1d210d288ae85aee118fababf9c4` / tree `1d0f590c1020c6d4d0bd2e1860dd70e9d1ba8df8` |
| `origin/main` | `6ebe6c3d03787411e0aa900fab6589545cad4e92` / tree `25016e3a210642941e5563bfad289ffbf13c61e2` |
| merge base | `32930e75b1d87d361f44e4b4f90dabf9deeda3e1` |

New commits on staging after the RC tree was captured:

```
cba8dae  STAGING — certificates: six admin defects (types, delete, recipient search, paging, PDF) (#96)
7380e28  STAGING — certificate view: draw the preview instead of framing a PDF (#98)
5dbfcf7  STAGING — certificates: delete unbroken, all 16 types worded, description printed (#99)
11 files changed, 2065 insertions(+), 224 deletions(-)
```

Rev 3.0 §12.4 step 1: *"FREEZE. Announce and record that staging is frozen. **Any commit
after this point voids the RC.**"*
Rev 3.0 §11, Validity: *"This approval covers exactly the named tree. **Any further commit
to staging voids it and requires a new RC.**"*

No FREEZE was ever announced or recorded for this RC, and staging moved. The candidate
identified by tree `3515b9a6…` is therefore **VOID as a promotion object**. Everything
verified against it remains true *about that tree* and is recorded below as such — it is not
transferable to the current staging tip. — VERIFIED.

### 0.1 The new tip carries two more unapplied migrations and two RPCs production lacks

```
supabase/migrations/UNAPPLIED_20260825060000_certificate_types_and_admin_search.sql
supabase/migrations/UNAPPLIED_20260825120000_certificate_delete_removes_notifications.sql
```

Guard inventory on the new tip: **105 distinct RPC names, 122 call sites, 122
argument-compatible checks, 0 name-only** — two names added versus the RC tree:

| RPC | Staging `ztzutckwdhetphwghuzj` | Production `jtdtehuqtinjxropkkcn` |
|---|---|---|
| `admin_list_certificates(_query, _type, _limit, _offset)` | present | **ABSENT** |
| `admin_search_certificate_recipients(_query, _limit)` | present | **ABSENT** |

Promoting the current staging tip today would 404 both at runtime. This is the same class of
defect the guard was built for, arriving a second time — which is the argument for the guard
being a gate rather than a one-off check. — VERIFIED.

`UNAPPLIED_20260824000000_admin_user_list_pagination.sql` is **still named UNAPPLIED on
staging** although it is now applied to production. §12.4 step 4 (RECONCILE MIGRATIONS,
"never execute a production migration merely because its file exists on main") makes this a
manifest-reconciliation item for the next RC, not a cosmetic one.

---

## 1. Schema guard vs STAGING on the exact tree `3515b9a6…` — evidence

Run at 2026-08-25 on `/home/claude/repo/work`, `git status --porcelain` = 0 lines,
`git rev-parse HEAD^{tree}` = `3515b9a62e72ee5cdc56cac4cf2f3987930960f7` immediately before
and after the run.

```
SCHEMA-GUARD PASS - target ref ztzutckwdhetphwghuzj
Scanned /home/claude/repo/work/src/
Catalog: out-of-band catalog, md5 361bf226a3946479a930e74a65c6b9dc verified against the
         digest computed by ztzutckwdhetphwghuzj
Every referenced RPC exists on the target and every call site was checked at argument level.

COVERAGE
  distinct RPC names: 103
  call sites: 120
  argument-compatible checks: 120
  name-only checks: 0
    (of the argument-compatible checks, 19 are calls that pass no
     arguments and are verified callable with none)
exit 0
```

| Required | Result | Status |
|---|---|---|
| 103 distinct RPC names | 103 | VERIFIED |
| 120 call sites | 120 | VERIFIED |
| 120 argument-compatible checks | 120 | VERIFIED |
| 0 name-only | 0 | VERIFIED |
| 0 missing | 0 | VERIFIED |
| 0 incompatible | 0 | VERIFIED |
| catalog digest = database-produced digest | `md5sum` of the local file = `361bf226a3946479a930e74a65c6b9dc` = the digest `ztzutckwdhetphwghuzj` computed over the same bytes; the guard recomputes it and refuses on mismatch | VERIFIED |
| 41/41 harness | `41/41 cases passed, 0 failed.` exit 0 | VERIFIED |

**Scope limit, stated:** this is the tree `3515b9a6…`, which §0 has just shown is no longer
staging's tip. It is valid evidence about that tree and about the guard; it is **not**
evidence about the promotable state of staging today.

---

## 2. §17 Final G10 Checklist — read from Rev 3.0, table §17

Rev 3.0 §17 contains **twelve** numbered lines, not eleven. All twelve are reported.
§17 preamble: *"Every line is checked immediately before promotion, in this order, on the day
of promotion. A line that was true last week is not checked."*

| # | §17 check | Passes when (Rev 3.0) | Finding | Status |
|---|---|---|---|---|
| 1 | §15 testing matrix complete, including every §15.2 refusal | no row blank, no row marked "expected" | No per-RC §15 matrix record exists. The Email-behaviour row cannot be completed: the staging email policy is an OPEN owner decision (§19, §8.8). N1–N8 have evidence scattered across G2/G3/G6/G9 records, never assembled as the §15 release artifact. | **NOT YET VERIFIED** |
| 2 | Change Ledger for this release closed | every entry has a verification outcome; none UNINTENDED | No release-scoped ledger has been opened for this RC. Individual CHG-* entries exist for earlier gates. | **NOT YET VERIFIED** |
| 3 | No §14 hard stop live | each explicitly checked, not assumed absent | **HS-12 is LIVE** — branch protection on `main` is recorded OPEN/never configured (§19) and cannot be read from this session. **HS-10 unresolved** — secret values were pasted into chat on three occasions; rotation of `sbp_417b…` is not confirmed to this session. HS-7 not yet applicable (no approval exists). HS-1..HS-6, HS-8, HS-9, HS-11 not observed. | **BLOCKED (HS-12 live; HS-10 unresolved)** |
| 4 | Isolation guard passes on both lanes with host rules active | **both CI runs named by run ID, with job-level results** | No CI run exists for tree `3515b9a6…`. This session cannot read or trigger Actions: `gh auth status` → token invalid; `api.github.com` → HTTP 403; `git push` → 403 (repo not in the session's authorized set). Local execution is explicitly not a substitute where the checklist asks for CI evidence. | **BLOCKED — capability unavailable** |
| 5 | Mutation harness holds every mutant | mutants held = mutants defined, from a run **on this tree** | Executed on tree `3515b9a6…` today: `node scripts/test-isolation-guard.mjs` → **Mutations detected/held: 21/21**, exit 0. Includes W1–W21 and the R13 / supabase-functions cases. | **VERIFIED** (for tree `3515b9a6…`; void with the RC) |
| 6 | Release Candidate record (§10) complete | it names a tree, not only a branch | No §10 record exists. The §10 schema has 24 mandatory fields (CI evidence, migration manifest, §8.10 production fingerprints, §5.3 re-test, §15 results, rollback target, attested/verified lists, approval). | **NOT YET VERIFIED** |
| 7 | Branch protection on `main` active | **re-attested by the owner at this moment**; OWNER-ATTESTED under §3.1, never recorded as independently verified; this is HS-12 | Not attested. §19 records it OPEN — never configured. Not readable from this session (403). | **BLOCKED — OWNER ACTION** |
| 8 | Production build job's environment values unchanged from the recorded baseline | compared field by field against the pre-change fingerprint | Cloudflare Pages environment variables are owner-only and not readable from this session; the Cloudflare connector exposes R2/KV/D1/Workers only — no Pages. No field-by-field comparison has been made for this RC. | **BLOCKED — capability unavailable** |
| 9 | Production rollback target identified and itself verified | named by tree, verification evidence on file | None exists. Rev 3.0 §20.4 states this plainly, and nothing has changed it. The pre-promotion `main` tree `a0c3f34d…` / commit `32930e75…` is a *candidate*, but has not itself been verified to the standard of §13/§17-9. | **NOT YET VERIFIED** |
| 10 | Owner approval (§11) recorded and names the approved tree | signed and dated **before** the merge | Not recorded. And per §0 the tree it would name is now void. | **NOT YET VERIFIED — OWNER ACTION** |
| 11 | Promotion merge performed per §12 | tree equality asserted after the merge against the tag created before it — §12.4 steps 9→11 in that order | Not started. No `approved/<YYYY-MM-DD>-<n>` tag exists. | **NOT STARTED** |
| 12 | §18 post-production checks pass | compared against the pre-release production baseline | Cannot run before a promotion exists. | **NOT APPLICABLE until §17-11 completes** |

---

## 3. §5.3 secret-isolation negative test — fresh, not inherited

Rev 3.0 §5.3.1 method, verbatim requirements: throwaway branch outside both lanes · a
push-triggered workflow echoing only EMPTY / NON-EMPTY, never the value or its length ·
push from a session holding push rights — *"this session does not (§19)"* · observe the run ·
record run ID and the literal log line · delete the branch — *"an owner action (§19), as
branch deletion is not available to this session"* · **re-run at G10 immediately before
promotion, as a separate record with its own timestamp.**

Capability measured now, not recalled (2026-08-25):

```
git push --dry-run origin HEAD:refs/heads/tool/secret-isolation-check-g10
  remote: access denied by the git proxy: altisinfonet/lens-lustre-learn-Claude is not in
          this session's authorized repository set, so the proxy will not inject a
          credential for it.
  fatal: ... The requested URL returned error: 403

gh auth status        ->  X Failed to log in to github.com using token (GH_TOKEN)
                          The token in GH_TOKEN is invalid.
curl api.github.com   ->  HTTP 403

git fetch origin '+refs/heads/*:...' --prune   ->  SUCCEEDED (read access exists)
```

The boundary is exact: **read yes, write no.** Branch creation, workflow dispatch, run-log
reading and branch deletion are all unavailable. §5.3 cannot be executed here.

No substitute was accepted. G3's evidence was not inherited; §12.4 step 7 and §5.3 both
forbid it. No owner statement was recorded in its place.

**Status: BLOCKED — capability unavailable (owner action §19, row 7).**

---

## 4. Branch protection (§17-7 / HS-12)

Not claimed. Per §17 the check is *"re-attested by the owner at this moment"*, and Rev 3.0
§3.1 / the "what owner-attested means" note forbid upgrading a probe of a consequence into a
reading of the setting. This session's GitHub access is read-only over git and 403 over the
API, so the rule cannot be read at all.

The owner must attest, at the moment of promotion, that the `main` protection rule:
applies to `main` · prevents direct pushes · carries the PR/review restrictions §17 requires.

**Status: BLOCKED — OWNER ACTION. Until attested, HS-12 is live and §17-3 fails.**

---

## 5. RC approval (§17-10 / §11)

Approval must restate **both** SHAs and name the tree, not a branch. The tree that would have
been named — `3515b9a62e72ee5cdc56cac4cf2f3987930960f7` — is void under §11 Validity because
staging advanced (§0). A new RC must be cut from a frozen staging tip and re-verified before
any approval is meaningful.

**Status: NOT YET VERIFIED — OWNER ACTION, and currently unapprovable.**

---

## 6. CI evidence (§17-4, §12.4 step 5, §10 "CI evidence")

§10 requires *"Every run ID with its conclusion AND its job-level results. A workflow that was
skipped is recorded as skipped, with why."* §17-4 requires both lanes' isolation-guard runs
named by run ID.

No CI run exists for tree `3515b9a6…`, and this session can neither read nor trigger runs
(§3 measurements). **BLOCKED — capability unavailable.** Local runs performed in this session
are recorded as local and are not offered as CI evidence.

---

## 7. The three schema-guard files — what the governing document actually says

Searched Rev 3.0 in full — all 334 paragraphs and all 63 tables — for `schema-dependency`,
`verify-schema`, `schema guard`, `RPC`, `admin_search_users`: **zero matches.**

- §17-4's "the isolation guard … with host rules active" is `scripts/verify-bundle-isolation.mjs`
  (rules R1–R13, host rules R7–R10). It is not the schema-dependency guard.
- The schema-dependency guard was created during G10 run 1 and postdates Rev 3.0. **The
  governing document does not require it to gate this promotion.**
- §12.4 step 12: *"No unrelated commit and **no additional file** may enter in the same
  merge."* Adding the three files to RC-2 would breach that clause directly.
- §11 Validity: any further commit to staging voids the approval — so committing them to a
  frozen staging tip would void the RC they were meant to protect.

**Decision, from the document and not from convenience: the three files must NOT be added to
RC-2.** They are their own change, with their own Change ID, landing on staging **before the
next RC is frozen** — at which point they are in the tree legitimately and can gate the RC
after it. They are not post-G10 by preference; they are outside this RC by rule.

Files, unchanged and uncommitted:
`scripts/verify-schema-dependencies.mjs` · `scripts/test-schema-dependencies.mjs` ·
`.github/workflows/verify-schema-dependencies.yml`

---

## 8. Not started, deliberately

Node 20 · bun/npm · svgo · branch aliases · stale `Main` rule · health task · unrelated
cleanup · G1–G9 hostile reconciliation. None is named in §17 or §12.4; all remain post-G10.
